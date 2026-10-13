const { auth } = require("../config/firebase");
const { prisma } = require("../config/database");

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

async function upsertUserByFirebaseUid(firebaseUid, email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error("Email is required to sync a user record.");
  }

  const existingByUid = await prisma.user.findUnique({
    where: { firebaseUid },
  });

  if (existingByUid) {
    if (existingByUid.email !== normalizedEmail) {
      console.log(`[userService] Updated email for existing UID ${firebaseUid}`);
      return prisma.user.update({
        where: { firebaseUid },
        data: { email: normalizedEmail },
      });
    }

    return existingByUid;
  }

  try {
    console.log(`[userService] Creating new profile for ${firebaseUid}`);
    return await prisma.user.create({
      data: { firebaseUid, email: normalizedEmail },
    });
  } catch (error) {
    if (error.code === "P2002") {
      const userByUid = await prisma.user.findUnique({
        where: { firebaseUid },
      });

      if (userByUid) return userByUid;
    }

    throw error;
  }
}

async function getProfile(firebaseUid) {
  const user = await prisma.user.findUnique({
    where: { firebaseUid },
  });

  if (!user) return null;
  return user;
}

async function updateProfile(firebaseUid, data) {
  const allowed = [
    "displayName",
    "avatarUrl",
    "authProvider",
    "height",
    "weight",
    "age",
    "fitnessGoal",
    "weeklyGoal",
    "targetWeight",
    "experienceLevel",
    "equipment",
    "sessionMinutes",
    "trainingDays",
    "avoidAreas",
  ];

  const filtered = {};
  for (const key of allowed) {
    if (data[key] !== undefined && key !== "weight") {
      filtered[key] = data[key];
    }
  }
  // Training days are the source of truth for "days per week" when given.
  if (Array.isArray(filtered.trainingDays)) {
    filtered.trainingDays = [...filtered.trainingDays].sort((a, b) => a - b);
    if (filtered.trainingDays.length > 0) filtered.weeklyGoal = filtered.trainingDays.length;
  }

  const user = await prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { firebaseUid },
      select: { id: true },
    });

    if (!existingUser) throw new Error("User not found");

    const latestWeight = await tx.bodyWeight.findFirst({
      where: { userId: existingUser.id, deletedAt: null },
      orderBy: { date: "desc" },
    });

    if (!latestWeight && data.weight !== undefined && data.weight !== null) {
      const today = new Date(new Date().toISOString().slice(0, 10));
      await tx.bodyWeight.upsert({
        where: { userId_date: { userId: existingUser.id, date: today } },
        update: {
          weight: data.weight,
          deletedAt: null,
        },
        create: {
          userId: existingUser.id,
          date: today,
          weight: data.weight,
        },
      });
    }

    const currentWeight = await tx.bodyWeight.findFirst({
      where: { userId: existingUser.id, deletedAt: null },
      orderBy: { date: "desc" },
    });

    return tx.user.update({
      where: { id: existingUser.id },
      data: {
        ...filtered,
        weight: currentWeight?.weight ?? null,
      },
    });
  });

  return user;
}

async function deleteAccount(firebaseUid) {
  console.log(`[userService] Starting account deletion for ${firebaseUid}`);

  try {
    await auth.revokeRefreshTokens(firebaseUid);
    console.log(`[userService] Refresh tokens revoked for ${firebaseUid}`);
  } catch (error) {
    console.warn(`Could not revoke tokens for ${firebaseUid}:`, error.message);
  }

  try {
    await prisma.user.delete({
      where: { firebaseUid },
    });
    console.log(`[userService] Postgres user deleted for ${firebaseUid}`);
  } catch (error) {
    if (error.code !== "P2025") throw error;
  }

  try {
    await auth.deleteUser(firebaseUid);
    console.log(`[userService] Firebase Auth user deleted for ${firebaseUid}`);
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }
}

module.exports = {
  upsertUserByFirebaseUid,
  getProfile,
  updateProfile,
  deleteAccount,
};
