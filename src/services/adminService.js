const { auth } = require("../config/firebase");
const { prisma } = require("../config/database");

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

module.exports = { listUsers, disableUser };
