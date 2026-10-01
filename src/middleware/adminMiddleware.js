/**
 * Protects admin routes using a static secret key.
 * Iron Arc uses adminUsers/allowlist in Firestore to identify admins,
 * but for server-to-server admin API calls, a secret key is simpler and safer.
 *
 * Send as header: x-admin-key: <ADMIN_SECRET_KEY>
 *
 * Edge Case: Always return the same 403 regardless of WHY it failed.
 * Never reveal whether the key was missing vs wrong — same response both ways.
 */
function verifyAdminKey(req, res, next) {
  const adminKey = req.headers['x-admin-key'];

  if (!adminKey || adminKey !== process.env.ADMIN_SECRET_KEY) {
    return res.status(403).json({
      success: false,
      message: 'Access denied.',
    });
  }

  next();
}

module.exports = { verifyAdminKey };
