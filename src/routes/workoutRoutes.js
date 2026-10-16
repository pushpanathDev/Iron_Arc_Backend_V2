const express = require("express");
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, workoutSchema, workoutBatchSchema, workoutUpdateSchema } = require("../middleware/validation");
const { pageFromQuery } = require("../utils/paging");
const workoutService = require("../services/workoutService");

const router = express.Router();
router.use(verifyFirebaseToken);

router.post("/", requireEmailVerified, validate(workoutSchema), async (req, res) => {
  const { workout, newlyUnlocked } = await workoutService.createWorkout(req.user.dbUser.id, req.body);
  res.status(201).json({ success: true, data: workout, newlyUnlocked });
});

// A whole logged session in one transaction: every entry is saved, or none.
// Body: { date, entries: [{ exercise, category, notes?, sets }] }.
router.post("/batch", requireEmailVerified, validate(workoutBatchSchema), async (req, res) => {
  const { workouts, newlyUnlocked } = await workoutService.createWorkoutBatch(req.user.dbUser.id, req.body);
  res.status(201).json({ success: true, data: workouts, newlyUnlocked });
});

// ?page=&limit=&category=&startDate=&endDate=, newest first.
router.get("/", async (req, res) => {
  const { category, startDate, endDate } = req.query;
  const result = await workoutService.getWorkouts(req.user.dbUser.id, { ...pageFromQuery(req.query, 20), category, startDate, endDate });
  res.json({ success: true, ...result });
});

router.get("/:id", async (req, res) => {
  const workout = await workoutService.getWorkout(req.user.dbUser.id, req.params.id);
  res.json({ success: true, data: workout });
});

router.patch("/:id", requireEmailVerified, validate(workoutUpdateSchema), async (req, res) => {
  const { workout, newlyUnlocked } = await workoutService.updateWorkout(req.user.dbUser.id, req.params.id, req.body);
  res.json({ success: true, data: workout, newlyUnlocked });
});

router.delete("/:id", requireEmailVerified, async (req, res) => {
  const { newlyUnlocked } = await workoutService.deleteWorkout(req.user.dbUser.id, req.params.id);
  res.json({ success: true, message: "Workout deleted", newlyUnlocked });
});

module.exports = router;
