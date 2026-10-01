const express = require('express');
const router = express.Router();
const { verifyAdminKey } = require('../middleware/adminMiddleware');
const { deleteIronArcUser, listUsers, disableUser } = require('../services/adminService');

// ── DELETE /api/admin/user/:userId ─────────────────────────────────────
// Completely removes a user from Iron Arc — Auth + all Firestore data
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

    const fullyDeleted = result.authDeleted &&
      result.workoutsDeleted &&
      result.weightsDeleted &&
      result.profileDeleted &&
      result.rootDocDeleted;

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
