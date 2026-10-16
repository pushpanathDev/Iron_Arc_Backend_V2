const express = require("express");
const { verifyFirebaseToken } = require("../middleware/authMiddleware");
const achievementService = require("../services/achievementService");

const router = express.Router();
router.use(verifyFirebaseToken);

// Every badge, earned or not, with the user's progress toward it.
router.get("/", async (req, res) => {
  const achievements = await achievementService.getAchievements(req.user.dbUser.id);
  res.json({ success: true, data: achievements });
});

module.exports = router;
