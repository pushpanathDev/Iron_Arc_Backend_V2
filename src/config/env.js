function validateRequiredEnv() {
  const missing = [];

  if (!process.env.DATABASE_URL) {
    missing.push("DATABASE_URL");
  }

  // Used by the Prisma CLI (prisma.config.ts) for migrations.
  if (!process.env.DIRECT_URL) {
    missing.push("DIRECT_URL");
  }

  // Guards /api/admin.
  if (!process.env.ADMIN_SECRET_KEY) {
    missing.push("ADMIN_SECRET_KEY");
  }

  if (!process.env.GROQ_API_KEY) {
    missing.push("GROQ_API_KEY");
  }

  const hasServiceAccount = Boolean(process.env.FIREBASE_SERVICE_ACCOUNT);
  const hasApplicationDefault = Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  const hasSplitCredentials = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_CLIENT_EMAIL",
    "FIREBASE_PRIVATE_KEY",
  ].every((name) => process.env[name]);

  if (!hasServiceAccount && !hasApplicationDefault && !hasSplitCredentials) {
    missing.push(
      "Firebase Admin credentials (FIREBASE_SERVICE_ACCOUNT, GOOGLE_APPLICATION_CREDENTIALS, or the split FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY variables)"
    );
  }

  if (missing.length > 0) {
    throw new Error(`[Iron Arc] Missing required environment variables: ${missing.join(", ")}`);
  }
}

module.exports = { validateRequiredEnv };