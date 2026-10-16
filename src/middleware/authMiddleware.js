const { auth } = require("../config/firebase");
const userService = require("../services/userService");
const { userLimiter } = require("./rateLimiter");

/**
 * Verifies the Firebase ID token from the React Native app.
 *
 * Iron Arc's React Native app uses Firebase Web SDK with initializeAuth +
 * getReactNativePersistence(AsyncStorage). The ID token it produces is a
 * standard Firebase JWT — verified here using Firebase Admin SDK.
 *
 * Token is sent as: Authorization: Bearer <idToken>
 *
 * Edge Cases:
 * - Expired token → 401 with re-login message (token auto-refreshes in app)
 * - Tampered/invalid token → 401
 * - Missing header → 401
 */
function createTokenVerifier({ checkRevoked = false } = {}) {
  return async function verifyFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication required.",
      });
    }

    // Only token verification failures are authentication errors (401).
    let decodedToken;
    try {
      const idToken = authHeader.split("Bearer ")[1];
      decodedToken = await auth.verifyIdToken(idToken, checkRevoked);
    } catch (error) {
      if (error.code === "auth/id-token-expired") {
        return res.status(401).json({
          success: false,
          message: "Session expired. Please log in again.",
        });
      }
      if (error.code === "auth/id-token-revoked") {
        return res.status(401).json({
          success: false,
          message: "Session revoked. Please log in again.",
        });
      }
      return res.status(401).json({
        success: false,
        message: "Invalid authentication token.",
      });
    }

    // Database failures (outage, pool exhaustion, cold start) are server
    // errors: hand them to the central errorHandler as 5xx, not 401.
    let dbUser;
    try {
      dbUser = checkRevoked && req.user?.dbUser
        ? req.user.dbUser
        : await userService.upsertUserByFirebaseUid(
            decodedToken.uid,
            decodedToken.email,
          );
    } catch (error) {
      return next(error);
    }

    if (dbUser.isActive === false) {
      return res.status(403).json({
        success: false,
        message: "This account is disabled.",
      });
    }

    // Attach Firebase claims and the resolved Postgres user for downstream handlers.
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified ?? false,
      authTime: decodedToken.auth_time,
      dbUser,
    };

    // Per-user rate limit on every authenticated route. The revocation
    // verifier is chained after the plain one, so skip it to avoid counting
    // the same request twice.
    if (checkRevoked) return next();
    return userLimiter(req, res, next);
  };
}

const verifyFirebaseToken = createTokenVerifier();
const verifyFirebaseTokenWithRevocation = createTokenVerifier({ checkRevoked: true });

async function requireEmailVerified(req, res, next) {
  if (!req.user?.emailVerified) {
    console.warn(`[auth] Blocked write for unverified email: ${req.user?.uid || "unknown"}`);
    return res.status(403).json({
      success: false,
      message: "Email verification required. Please verify your email address.",
    });
  }

  next();
}

function requireRecentSignIn(req, res, next) {
  const authTime = req.user?.authTime;
  const recentSignInWindowSeconds = 5 * 60;
  const ageSeconds = authTime ? Math.floor(Date.now() / 1000) - authTime : Infinity;

  if (ageSeconds > recentSignInWindowSeconds) {
    return res.status(401).json({
      success: false,
      code: "REAUTHENTICATION_REQUIRED",
      message: "Recent sign-in required. Please re-authenticate and try again.",
    });
  }

  next();
}

module.exports = {
  verifyFirebaseToken,
  verifyFirebaseTokenWithRevocation,
  requireEmailVerified,
  requireRecentSignIn,
};
