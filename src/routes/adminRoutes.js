const express = require('express');
const router = express.Router();
const { verifyAdminKey } = require('../middleware/adminMiddleware');
const { deleteIronArcUser, listUsers, disableUser } = require('../services/adminService');

// ── DELETE /api/admin/user/:userId ─────────────────────────────────────
// Removes a user completely: their Firebase sign-in and all their data
router.delete('/user/:userId', verifyAdminKey, async (req, res, next) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'userId is required.',
      });
    }

    const result = await deleteIronArcUser(userId);

    const fullyDeleted = result.postgresDeleted && result.authDeleted;

    if (!fullyDeleted) {
      return res.status(207).json({
        success: false,
        message: 'Partial deletion. Review errors for remaining data.',
        data: result,
      });
    }

    res.status(200).json({
      success: true,
      message: 'Iron Arc user completely deleted.',
      data: result,
    });
  } catch (error) {
    next(error);
  }
});

// ── GET /api/admin/users ───────────────────────────────────────────────
// Lists all Iron Arc users for admin panel
router.get('/users', verifyAdminKey, async (req, res, next) => {
  try {
    const maxResults = Math.min(parseInt(req.query.maxResults) || 50, 100);
    const pageToken = req.query.pageToken || undefined;
    const result = await listUsers(maxResults, pageToken);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

// ── POST /api/admin/user/:userId/disable ───────────────────────────────
// Soft-bans a user without deleting their data
router.post('/user/:userId/disable', verifyAdminKey, async (req, res, next) => {
  try {
    await disableUser(req.params.userId);
    res.status(200).json({ success: true, message: 'User disabled.' });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
