const { initializeApp, cert, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

/**
 * Firebase Admin credentials, from the first of these that is set:
 * FIREBASE_SERVICE_ACCOUNT (JSON or base64 JSON), GOOGLE_APPLICATION_CREDENTIALS,
 * or the three split FIREBASE_PROJECT_ID / CLIENT_EMAIL / PRIVATE_KEY variables.
 */
function createFirebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT.trim();

    try {
      const serviceAccount = rawServiceAccount.startsWith("{")
        ? JSON.parse(rawServiceAccount)
        : JSON.parse(Buffer.from(rawServiceAccount, "base64").toString("utf8"));

      return cert(serviceAccount);
    } catch (error) {
      throw new Error(`Invalid FIREBASE_SERVICE_ACCOUNT value: ${error.message}`, { cause: error });
    }
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return applicationDefault();
  }

  return cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    // Render and most CI/CD systems serialize the private key as a single
    // line with literal \n characters. This replacement restores real newlines.
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  });
}

const app = initializeApp({ credential: createFirebaseCredential() });

// Sign-in checks and account management (verify tokens, delete or disable users).
const auth = getAuth(app);

module.exports = { auth };
