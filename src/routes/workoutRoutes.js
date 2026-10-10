const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, workoutSchema, workoutUpdateSchema } = require("../middleware/validation");
const workoutService = require("../services/workoutService");

const MAX_PAGE_SIZE = 1000;

router.use(verifyFirebaseToken);

router.post("/", requireEmailVerified, validate(workoutSchema), async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const { workout, newlyUnlocked } = await workoutService.createWorkout(userId, req.body);
    res.status(201).json({ success: true, data: workout, newlyUnlocked });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const { page, limit, category, startDate, endDate } = req.query;

    const result = await workoutService.getWorkouts(userId, {
      page: Math.max(parseInt(page) || 1, 1),
      // Hard cap 1000 rows per page; clients page through totalPages for more.
      limit: Math.min(Math.max(parseInt(limit) || 20, 1), MAX_PAGE_SIZE),
      category,
      startDate,
      endDate,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

// GET /api/workouts/stats — aggregates over the user's full history.
// Must be registered before "/:id" so "stats" is not treated as an id.
router.get("/stats", async (req, res, next) => {
  try {
    const stats = await workoutService.getWorkoutStats(req.user.dbUser.id);
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const workout = await workoutService.getWorkoutById(userId, req.params.id);

    if (!workout) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }

    res.json({ success: true, data: workout });
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", requireEmailVerified, validate(workoutUpdateSchema), async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const result = await workoutService.updateWorkout(userId, req.params.id, req.body);

    if (!result) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }

    res.json({ success: true, data: result.workout, newlyUnlocked: result.newlyUnlocked });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireEmailVerified, async (req, res, next) => {
  try {
    const userId = req.user.dbUser.id;
    const result = await workoutService.deleteWorkout(userId, req.params.id);

    if (!result) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }

    res.json({ success: true, message: "Workout deleted", newlyUnlocked: result.newlyUnlocked });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
