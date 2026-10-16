const express = require("express");
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { planGenerationLimiter, planChatLimiter } = require("../middleware/rateLimiter");
const { validate, substituteSchema, renamePlanSchema, planChatSchema } = require("../middleware/validation");
const planningService = require("../services/planningService");

const router = express.Router();
router.use(verifyFirebaseToken);

// Every plan, newest first, without the plan itself (the list stays small).
router.get("/", async (req, res) => {
  const plans = await planningService.listPlans(req.user.dbUser.id);
  res.json({ success: true, data: plans });
});

// A new AI plan from the profile and the plan form; it becomes the active plan.
router.post("/generate", requireEmailVerified, planGenerationLimiter, async (req, res) => {
  const { plan, newlyUnlocked } = await planningService.generatePlan(req.user.dbUser, req.body?.criteria ?? {});
  res.status(201).json({ success: true, data: plan, newlyUnlocked });
});

router.get("/:id", async (req, res) => {
  const plan = await planningService.getPlan(req.user.dbUser.id, req.params.id);
  res.json({ success: true, data: plan });
});

// "Next week": moves the plan on a week, tuned to the last 7 days of training.
router.post("/:id/recalibrate", requireEmailVerified, planGenerationLimiter, async (req, res) => {
  const plan = await planningService.recalibratePlan(req.user.dbUser, req.params.id);
  res.json({ success: true, data: plan });
});

// Swap one exercise for another the AI picks (same muscles, the user's equipment).
router.post("/:id/substitute", requireEmailVerified, validate(substituteSchema), async (req, res) => {
  const { exerciseId, reason } = req.body;
  const plan = await planningService.substituteExercise(req.user.dbUser, req.params.id, exerciseId, reason);
  res.json({ success: true, data: plan });
});

router.patch("/:id/name", requireEmailVerified, validate(renamePlanSchema), async (req, res) => {
  const plan = await planningService.renamePlan(req.user.dbUser.id, req.params.id, req.body.name);
  res.json({ success: true, data: plan });
});

// Make this the active plan; the others become inactive.
router.patch("/:id/activate", requireEmailVerified, async (req, res) => {
  const plan = await planningService.activatePlan(req.user.dbUser.id, req.params.id);
  res.json({ success: true, data: plan });
});

// If the deleted plan was active, the newest remaining plan takes over.
router.delete("/:id", requireEmailVerified, async (req, res) => {
  await planningService.deletePlan(req.user.dbUser.id, req.params.id);
  res.json({ success: true, message: "Plan deleted." });
});

// A message to the plan coach: an answer, and maybe a change to the plan.
router.post("/:id/chat", requireEmailVerified, validate(planChatSchema), planChatLimiter, async (req, res) => {
  const result = await planningService.chatWithPlan(req.user.dbUser, req.params.id, req.body.message, req.body.today);
  res.json({ success: true, data: result });
});

module.exports = router;
