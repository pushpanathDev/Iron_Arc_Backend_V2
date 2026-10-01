const { auth } = require("../config/firebase");
const { prisma } = require("../config/database");

async function deleteIronArcUser(targetFirebaseUid) {
  const result = {
    postgresDeleted: false,
    authDeleted: false,
    errors: [],
  };

  try {
    await prisma.user.delete({
      where: { firebaseUid: targetFirebaseUid },
    });
    result.postgresDeleted = true;
  } catch (error) {
    if (error.code === "P2025") {
      result.postgresDeleted = true;
    } else {
      result.errors.push(`postgres: ${error.message}`);
    }
  }

  try {
    await auth.deleteUser(targetFirebaseUid);
    result.authDeleted = true;
  } catch (error) {
    if (error.code === "auth/user-not-found") {
      result.authDeleted = true;
    } else {
      result.errors.push(`auth: ${error.message}`);
    }
  }

  return result;
}

async function listUsers(maxResults = 50, pageToken = undefined) {
  const result = await auth.listUsers(maxResults, pageToken);

  return {
    users: result.users.map((u) => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      emailVerified: u.emailVerified,
      authProvider: u.providerData?.[0]?.providerId || "unknown",
      createdAt: u.metadata.creationTime,
      lastSignIn: u.metadata.lastSignInTime,
      disabled: u.disabled,
    })),
    nextPageToken: result.pageToken || null,
  };
}

async function disableUser(targetFirebaseUid) {
  await auth.updateUser(targetFirebaseUid, { disabled: true });

  await prisma.user.update({
    where: { firebaseUid: targetFirebaseUid },
    data: { isActive: false },
  });
}

module.exports = { deleteIronArcUser, listUsers, disableUser };
