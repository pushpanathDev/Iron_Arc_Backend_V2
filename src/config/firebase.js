const admin = require("firebase-admin");

function createFirebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT.trim();

    try {
      const serviceAccount = rawServiceAccount.startsWith("{")
        ? JSON.parse(rawServiceAccount)
        : JSON.parse(Buffer.from(rawServiceAccount, "base64").toString("utf8"));

      return admin.credential.cert(serviceAccount);
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT value: ${error.message}`);
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }

  return admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Render and most CI/CD systems serialize the private key as a single
    // line with literal \n characters. This replacement restores real newlines.
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  });
}

// Guard against re-initialization on Nodemon hot reload
// Without this check, every file save crashes the server with
// "Firebase app already exists" error
if (!admin.apps.length) {
  admin.initializeApp({
    credential: createFirebaseCredential(),
  });
}

const auth = admin.auth();

module.exports = { auth };
