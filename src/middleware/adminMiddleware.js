/**
 * Guards /api/admin with a static secret key, sent as the header
 * x-admin-key: <ADMIN_SECRET_KEY>. A missing and a wrong key get the same
 * 403, so the response never says which it was.
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
