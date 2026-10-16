const crypto = require("crypto");

const digest = (value) => crypto.createHash("sha256").update(String(value)).digest();

/**
 * Guards /api/admin with a static secret key, sent as the header
 * x-admin-key: <ADMIN_SECRET_KEY>. A missing and a wrong key get the same
 * 403, so the response never says which it was. The comparison takes the
 * same time whatever was sent (on hashes, so the lengths always match), so
 * timing can't hint at the key either.
 */
function verifyAdminKey(req, res, next) {
  const adminKey = req.headers["x-admin-key"];

  if (!adminKey || !crypto.timingSafeEqual(digest(adminKey), digest(process.env.ADMIN_SECRET_KEY))) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  next();
}

module.exports = { verifyAdminKey };
