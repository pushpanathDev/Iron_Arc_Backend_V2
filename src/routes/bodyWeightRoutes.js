const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, bodyWeightSchema } = require("../middleware/validation");
const bodyWeightService = require("../services/bodyWeightService");

const MAX_PAGE_SIZE = 1000;

router.use(verifyFirebaseToken);

router.post("/", requireEmailVerified, validate(bodyWeightSchema), async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const { entry, newlyUnlocked } = await bodyWeightService.logWeight(userId, req.body);
    res.status(201).json({ success: true, data: entry, newlyUnlocked });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const { page, limit, startDate, endDate } = req.query;

    const result = await bodyWeightService.getWeights(userId, {
      page: Math.max(parseInt(page) || 1, 1),
      // Hard cap 1000 rows per page; clients page through totalPages for more.
      limit: Math.min(Math.max(parseInt(limit) || 30, 1), MAX_PAGE_SIZE),
      startDate,
      endDate,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// GET /api/weights/stats — aggregates over all non-deleted entries.
router.get("/stats", async (req, res, next) => {
  try {
    const stats = await bodyWeightService.getWeightStats(req.user.dbUser.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

router.get("/latest", async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
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
    const userId = req.user.dbUser.id;
    const result = await bodyWeightService.deleteWeight(userId, req.params.id);

    if (!result) {
      return res.status(404).json({ success: false, message: "Weight entry not found" });
    }

    res.json({ success: true, message: "Weight entry deleted", newlyUnlocked: result.newlyUnlocked });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
