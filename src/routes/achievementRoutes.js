const express = require("express");
const router = express.Router();
const { verifyFirebaseToken } = require("../middleware/authMiddleware");
const achievementService = require("../services/achievementService");

router.use(verifyFirebaseToken);

// GET /api/achievements - list all achievements for current user
router.get("/", async (req, res, next) => {
  try {
    const achievements = await achievementService.getAchievements(req.user.dbUser.id);
    res.json({ success: true, data: achievements });
    
  } catch (error) {
    next(error);
  }
});

module.exports = router;
