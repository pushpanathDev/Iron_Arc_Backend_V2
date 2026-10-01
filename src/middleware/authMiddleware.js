const { auth } = require('../config/firebase');

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
async function verifyFirebaseToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.',
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decodedToken = await auth.verifyIdToken(idToken);

    // Attach user info to request object for downstream route handlers
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified ?? false,
    };

    console.log(
      `[auth] Verified token for ${decodedToken.uid} (emailVerified=${req.user.emailVerified})`
    );

    next();
  } catch (error) {
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid authentication token.',
    });
  }
}

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

module.exports = { verifyFirebaseToken, requireEmailVerified };
