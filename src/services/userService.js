const { auth } = require("../config/firebase");
const { prisma } = require("../config/database");

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

/** The user row for a signed-in Firebase account, created on first sign-in. */
async function upsertUserByFirebaseUid(firebaseUid, email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw new Error("Email is required to sync a user record.");
  }

  const existing = await prisma.user.findUnique({ where: { firebaseUid } });
  if (existing?.email === normalizedEmail) return existing;

  try {
    return await saveUser(existing, firebaseUid, normalizedEmail);
  } catch (error) {
    if (error.code !== "P2002") throw error;

    // Two requests created this new user at the same time: the other one won.
    const created = await prisma.user.findUnique({ where: { firebaseUid } });
    if (created?.email === normalizedEmail) return created;

    // The email is still on the row of an account deleted outside the app
    // (e.g. in the Firebase console). Free it, or every request would fail.
    if (!(await releaseEmailOfDeletedAccount(normalizedEmail))) throw error;
    return saveUser(existing ?? created, firebaseUid, normalizedEmail);
  }
}

function saveUser(existing, firebaseUid, email) {
  if (existing) {
    console.log(`[userService] Updated email for existing UID ${firebaseUid}`);
    return prisma.user.update({ where: { firebaseUid }, data: { email } });
  }
  console.log(`[userService] Creating new profile for ${firebaseUid}`);
  return prisma.user.create({ data: { firebaseUid, email } });
}

/**
 * Frees an email held by a user row whose Firebase account no longer exists.
 * That row and its data stay, under a placeholder email. A live account's
 * row is never touched (returns false).
 */
async function releaseEmailOfDeletedAccount(email) {
  const holder = await prisma.user.findUnique({ where: { email } });
  if (!holder) return false;

  try {
    await auth.getUser(holder.firebaseUid);
    return false;
  } catch (error) {
    if (error.code !== "auth/user-not-found") throw error;
  }

  await prisma.user.update({
    where: { id: holder.id },
    data: { email: `released-${holder.id}@deleted.invalid` },
  });
  console.warn(`[userService] Released the email of deleted account ${holder.firebaseUid}`);
  return true;
}

/**
 * Profile fields the app can change. Body weight isn't one: it always mirrors
 * the latest weight log entry (bodyWeightService), so the app logs it there.
 */
const EDITABLE_FIELDS = [
  "displayName",
  "avatarUrl",
  "authProvider",
  "height",
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

async function updateProfile(userId, data) {
  const changes = {};
  for (const key of EDITABLE_FIELDS) {
    if (data[key] !== undefined) changes[key] = data[key];
  }
  // Training days are the source of truth for "days per week" when given.
  if (Array.isArray(changes.trainingDays)) {
    changes.trainingDays = [...changes.trainingDays].sort((a, b) => a - b);
    if (changes.trainingDays.length > 0) changes.weeklyGoal = changes.trainingDays.length;
  }

  return prisma.user.update({ where: { id: userId }, data: changes });
}

/**
 * Deletes a user's data (every table cascades from the user row) and their
 * Firebase sign-in. Already gone counts as deleted. Tries both and reports
 * what failed, so an admin can see a partial deletion.
 */
async function deleteUserEverywhere(firebaseUid) {
  const result = { postgresDeleted: false, authDeleted: false, errors: [] };

  try {
    await prisma.user.delete({ where: { firebaseUid } });
    result.postgresDeleted = true;
  } catch (error) {
    if (error.code === "P2025") result.postgresDeleted = true;
    else result.errors.push(`postgres: ${error.message}`);
  }

  try {
    await auth.deleteUser(firebaseUid);
    result.authDeleted = true;
  } catch (error) {
    if (error.code === "auth/user-not-found") result.authDeleted = true;
    else result.errors.push(`auth: ${error.message}`);
  }

  console.log(`[userService] Deleted ${firebaseUid}: data ${result.postgresDeleted}, sign-in ${result.authDeleted}`);
  return result;
}

/** The user deleting their own account: signs out every device first. */
async function deleteAccount(firebaseUid) {
  try {
    await auth.revokeRefreshTokens(firebaseUid);
  } catch (error) {
    console.warn(`[userService] Could not revoke tokens for ${firebaseUid}: ${error.message}`);
  }

  const { errors } = await deleteUserEverywhere(firebaseUid);
  if (errors.length > 0) throw new Error(`Account deletion incomplete: ${errors.join("; ")}`);
}

module.exports = {
  upsertUserByFirebaseUid,
  updateProfile,
  deleteUserEverywhere,
  deleteAccount,
};
