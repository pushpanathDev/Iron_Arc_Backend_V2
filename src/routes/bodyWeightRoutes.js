const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, bodyWeightSchema } = require("../middleware/validation");
const userService = require("../services/userService");
const bodyWeightService = require("../services/bodyWeightService");

router.use(verifyFirebaseToken);

async function ensureUser(req) {
  const user = await userService.findOrCreateUser(req.user.uid, req.user.email);
  return user.id;
}

router.post("/", requireEmailVerified, validate(bodyWeightSchema), async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const entry = await bodyWeightService.logWeight(userId, req.body);
    res.status(201).json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const { page, limit, startDate, endDate } = req.query;

    const result = await bodyWeightService.getWeights(userId, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 30, 100),
      startDate,
      endDate,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get("/latest", async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const entry = await bodyWeightService.getLatestWeight(userId);

    if (!entry) {
      return res.status(404).json({ success: false, message: "No weight entries found" });
    }

    res.json({ success: true, data: entry });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireEmailVerified, async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const entry = await bodyWeightService.deleteWeight(userId, req.params.id);

    if (!entry) {
      return res.status(404).json({ success: false, message: "Weight entry not found" });
    }

    res.json({ success: true, message: "Weight entry deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
