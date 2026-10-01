const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, customExerciseSchema } = require("../middleware/validation");
const userService = require("../services/userService");
const customExerciseService = require("../services/customExerciseService");

router.use(verifyFirebaseToken);

async function ensureUser(req) {
  const user = await userService.findOrCreateUser(req.user.uid, req.user.email);
  return user.id;
}

router.post("/", requireEmailVerified, validate(customExerciseSchema), async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const exercise = await customExerciseService.createExercise(userId, req.body);
    res.status(201).json({ success: true, data: exercise });
  } catch (error) {
    if (error.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Exercise already exists in this category",
      });
    }
    next(error);
  }
});

router.get("/", async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const { category } = req.query;
    const exercises = await customExerciseService.getExercises(userId, category);
    res.json({ success: true, data: exercises });
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", requireEmailVerified, async (req, res, next) => {
  try {
    const userId = await ensureUser(req);
    const exercise = await customExerciseService.deleteExercise(userId, req.params.id);

    if (!exercise) {
      return res.status(404).json({ success: false, message: "Exercise not found" });
    }

    res.json({ success: true, message: "Exercise deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
