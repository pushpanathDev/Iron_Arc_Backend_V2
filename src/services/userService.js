const { auth } = require("../config/firebase");
const { prisma } = require("../config/database");

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

async function findOrCreateUser(firebaseUid, email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error("Email is required to create or locate a user record.");
  }

  const existingByUid = await prisma.user.findUnique({
    where: { firebaseUid },
  });

  if (existingByUid) {
    if (existingByUid.email !== normalizedEmail) {
      console.log(
        `[userService] Updated email for existing UID ${firebaseUid} -> ${normalizedEmail}`,
      );
      return prisma.user.update({
        where: { firebaseUid },
        data: { email: normalizedEmail },
      });
    }

    console.log(
      `[userService] Reused existing profile for UID ${firebaseUid} (${normalizedEmail})`,
    );
    return existingByUid;
  }

  const existingByEmail = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingByEmail) {
    if (existingByEmail.firebaseUid !== firebaseUid) {
      console.log(
        `[userService] Reclaiming existing profile for ${normalizedEmail} -> ${firebaseUid}`,
      );
      return prisma.user.update({
        where: { email: normalizedEmail },
        data: {
          firebaseUid,
          email: normalizedEmail,
        },
      });
    }

    return existingByEmail;
  }

  try {
    console.log(
      `[userService] Creating new profile for ${firebaseUid} (${normalizedEmail})`,
    );
    return await prisma.user.create({
      data: { firebaseUid, email: normalizedEmail },
    });
  } catch (error) {
    if (error.code === "P2002") {
      const userByEmail = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });

      if (userByEmail) {
        if (userByEmail.firebaseUid !== firebaseUid) {
          return prisma.user.update({
            where: { email: normalizedEmail },
            data: {
              firebaseUid,
              email: normalizedEmail,
            },
          });
        }

        return userByEmail;
      }

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
  ];

  const filtered = {};
  for (const key of allowed) {
    if (data[key] !== undefined) {
      filtered[key] = data[key];
    }
  }

  console.log("[userService] Updating profile", {
    firebaseUid,
    updates: filtered,
  });

  const user = await prisma.user.update({
    where: { firebaseUid },
    data: filtered,
  });

  console.log("[userService] Profile updated", {
    firebaseUid,
    id: user.id,
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
  findOrCreateUser,
  getProfile,
  updateProfile,
  deleteAccount,
};
