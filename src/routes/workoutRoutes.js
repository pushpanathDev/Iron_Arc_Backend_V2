const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, workoutSchema, workoutUpdateSchema } = require("../middleware/validation");
const userService = require("../services/userService");
const workoutService = require("../services/workoutService");

router.use(verifyFirebaseToken);

async function ensureUser(req) {
  const user = await userService.findOrCreateUser(req.user.uid, req.user.email);
  return user.id;
}

router.post("/", requireEmailVerified, validate(workoutSchema), async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const workout = await workoutService.createWorkout(userId, req.body);
    res.status(201).json({ success: true, data: workout });
  } catch (error) {
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const { page, limit, category, startDate, endDate } = req.query;

    const result = await workoutService.getWorkouts(userId, {
      page: parseInt(page) || 1,
      limit: Math.min(parseInt(limit) || 20, 100),
      category,
      startDate,
      endDate,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
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
    const userId = await ensureUser(req);
    const workout = await workoutService.updateWorkout(userId, req.params.id, req.body);

    if (!workout) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }

    res.json({ success: true, data: workout });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireEmailVerified, async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const workout = await workoutService.deleteWorkout(userId, req.params.id);

    if (!workout) {
      return res.status(404).json({ success: false, message: "Workout not found" });
    }

    res.json({ success: true, message: "Workout deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
