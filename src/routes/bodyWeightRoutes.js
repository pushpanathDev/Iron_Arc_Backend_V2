const express = require("express");
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, bodyWeightSchema } = require("../middleware/validation");
const { pageFromQuery } = require("../utils/paging");
const bodyWeightService = require("../services/bodyWeightService");

const router = express.Router();
router.use(verifyFirebaseToken);

// One entry per day: logging the same date again replaces it.
router.post("/", requireEmailVerified, validate(bodyWeightSchema), async (req, res) => {
  const { entry, newlyUnlocked } = await bodyWeightService.logWeight(req.user.dbUser.id, req.body);
  res.status(201).json({ success: true, data: entry, newlyUnlocked });
});

// ?page=&limit=&startDate=&endDate=, newest first.
router.get("/", async (req, res) => {
  const { startDate, endDate } = req.query;
  const result = await bodyWeightService.getWeights(req.user.dbUser.id, { ...pageFromQuery(req.query, 30), startDate, endDate });
  res.json({ success: true, ...result });
});

router.get("/latest", async (req, res) => {
  const entry = await bodyWeightService.getLatestWeight(req.user.dbUser.id);
  res.json({ success: true, data: entry });
});

router.delete("/:id", requireEmailVerified, async (req, res) => {
  const { newlyUnlocked } = await bodyWeightService.deleteWeight(req.user.dbUser.id, req.params.id);
  res.json({ success: true, message: "Weight entry deleted", newlyUnlocked });
});

module.exports = router;
