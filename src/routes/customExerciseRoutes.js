const express = require("express");
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, customExerciseSchema } = require("../middleware/validation");
const customExerciseService = require("../services/customExerciseService");

const router = express.Router();
router.use(verifyFirebaseToken);

router.post("/", requireEmailVerified, validate(customExerciseSchema), async (req, res) => {
  const { exercise, newlyUnlocked } = await customExerciseService.createExercise(req.user.dbUser.id, req.body);
  res.status(201).json({ success: true, data: exercise, newlyUnlocked });
});

// ?category= to list one category only.
router.get("/", async (req, res) => {
  const exercises = await customExerciseService.getExercises(req.user.dbUser.id, req.query.category);
  res.json({ success: true, data: exercises });
});

router.delete("/:id", requireEmailVerified, async (req, res) => {
  await customExerciseService.deleteExercise(req.user.dbUser.id, req.params.id);
  res.json({ success: true, message: "Exercise deleted" });
});

module.exports = router;
