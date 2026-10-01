const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const achievementService = require("../services/achievementService");

router.use(verifyFirebaseToken);

// GET /api/achievements - list all achievements for current user
router.get("/", async (req, res, next) => {
  try {
    const achievements = await achievementService.getAchievements(req.user.uid);
    res.json({ success: true, data: achievements });
    
  } catch (error) {
    next(error);
  }
});

// POST /api/achievements/unlock - unlock a single badge
router.post("/unlock", requireEmailVerified, async (req, res, next) => {
  try {
    const { badgeKey } = req.body;
    if (!badgeKey || typeof badgeKey !== "string") {
      return res.status(400).json({ success: false, message: "badgeKey is required" });
    }
    const achievement = await achievementService.unlockAchievement(req.user.uid, badgeKey);
    res.json({ success: true, data: achievement });
  } catch (error) {
    next(error);
  }
});

// POST /api/achievements/sync - bulk sync achievements from client
router.post("/sync", requireEmailVerified, async (req, res, next) => {
  try {
    const { badgeKeys } = req.body;
    if (!Array.isArray(badgeKeys)) {
      return res.status(400).json({ success: false, message: "badgeKeys must be an array" });
    }
    const result = await achievementService.syncAchievements(req.user.uid, badgeKeys);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
