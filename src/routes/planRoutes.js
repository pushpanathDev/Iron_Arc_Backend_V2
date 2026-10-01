const express = require('express');
const router = express.Router();
const { verifyFirebaseToken } = require('../middleware/authMiddleware');
const { generalLimiter, planGenerationLimiter } = require('../middleware/rateLimiter');
const { validate, substituteSchema } = require('../middleware/validation');
const {
  generatePlan,
  recalibratePlan,
  substituteExercise,
  listPlans,
  getPlanById,
  renamePlan,
  activatePlan,
  deletePlan,
  chatWithPlan,
} = require('../services/planningService');

router.use(generalLimiter);

/* ── GET /api/plans ─────────────────────────────────────────────────────
   List all plans for the authenticated user (newest first)
────────────────────────────────────────────────────────────────────────── */
router.get('/', verifyFirebaseToken, async (req, res, next) => {
  try {
    const plans = await listPlans(req.user.uid);
    res.status(200).json({ success: true, data: plans });
  } catch (error) {
    next(error);
  }
});

/* ── POST /api/plans/generate ───────────────────────────────────────────
   Generate a new AI plan — saved to plans table and set as active
   Also mirrors to user.activePlan for backwards-compat with profile API
────────────────────────────────────────────────────────────────────────── */
router.post('/generate', verifyFirebaseToken, planGenerationLimiter, async (req, res, next) => {
  try {
    const criteria = req.body?.criteria ?? {};
    const plan = await generatePlan(req.user.uid, criteria);
    res.status(201).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'PROFILE_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'User profile not found.' });
    }
    if (error.message === 'INVALID_PLAN_STRUCTURE') {
      return res.status(503).json({ success: false, message: 'Could not generate a valid plan. Please try again.' });
    }
    next(error);
  }
});

/* ── POST /api/plans/recalibrate (legacy — recalibrates the active plan) */
router.post('/recalibrate', verifyFirebaseToken, planGenerationLimiter, async (req, res, next) => {
  try {
    const plans = await listPlans(req.user.uid);
    const active = plans.find((p) => p.isActive) ?? plans[0];
    if (!active) {
      return res.status(404).json({ success: false, message: 'No active plan found. Generate a plan first.' });
    }
    const plan = await recalibratePlan(req.user.uid, active.id);
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

/* ── POST /api/plans/substitute (legacy — substitutes in the active plan) */
router.post('/substitute', verifyFirebaseToken, validate(substituteSchema), async (req, res, next) => {
  try {
    const { exerciseId, reason } = req.body;
    const plans = await listPlans(req.user.uid);
    const active = plans.find((p) => p.isActive) ?? plans[0];
    if (!active) {
      return res.status(404).json({ success: false, message: 'No active plan found.' });
    }
    const result = await substituteExercise(req.user.uid, active.id, exerciseId, reason);
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/* ── GET /api/plans/:id ─────────────────────────────────────────────────
   Get a specific plan by ID
────────────────────────────────────────────────────────────────────────── */
router.get('/:id', verifyFirebaseToken, async (req, res, next) => {
  try {
    const plan = await getPlanById(req.user.uid, req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    next(error);
  }
});

/* ── POST /api/plans/:id/recalibrate ────────────────────────────────────
   Recalibrate a specific plan
────────────────────────────────────────────────────────────────────────── */
router.post('/:id/recalibrate', verifyFirebaseToken, planGenerationLimiter, async (req, res, next) => {
  try {
    const plan = await recalibratePlan(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    next(error);
  }
});

/* ── POST /api/plans/:id/substitute ─────────────────────────────────────
   Substitute an exercise within a specific plan
────────────────────────────────────────────────────────────────────────── */
router.post('/:id/substitute', verifyFirebaseToken, validate(substituteSchema), async (req, res, next) => {
  try {
    const { exerciseId, reason } = req.body;
    const result = await substituteExercise(req.user.uid, req.params.id, exerciseId, reason);
    if (!result.applied) {
      return res.status(422).json({
        success: false,
        message: `Exercise "${exerciseId}" was not found in this plan.`,
        substitute: result.substitute,
      });
    }
    res.status(200).json({ success: true, data: result.plan, substitute: result.substitute });
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    next(error);
  }
});

/* ── PATCH /api/plans/:id/name ──────────────────────────────────────────
   Rename a plan
────────────────────────────────────────────────────────────────────────── */
router.patch('/:id/name', verifyFirebaseToken, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ success: false, message: 'A non-empty name is required.' });
    }
    const plan = await renamePlan(req.user.uid, req.params.id, name.trim().slice(0, 60));
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    next(error);
  }
});

/* ── PATCH /api/plans/:id/activate ─────────────────────────────────────
   Set a plan as active (deactivates all others for this user)
────────────────────────────────────────────────────────────────────────── */
router.patch('/:id/activate', verifyFirebaseToken, async (req, res, next) => {
  try {
    const plan = await activatePlan(req.user.uid, req.params.id);
    res.status(200).json({ success: true, data: plan });
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    next(error);
  }
});

/* ── DELETE /api/plans/:id ──────────────────────────────────────────────
   Delete a plan (cannot delete the only plan if it's active)
────────────────────────────────────────────────────────────────────────── */
router.delete('/:id', verifyFirebaseToken, async (req, res, next) => {
  try {
    await deletePlan(req.user.uid, req.params.id);
    res.status(200).json({ success: true, message: 'Plan deleted.' });
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    next(error);
  }
});

/* ── POST /api/plans/:id/chat ───────────────────────────────────────────
   Send a chat message to customise a plan via AI
────────────────────────────────────────────────────────────────────────── */
router.post('/:id/chat', verifyFirebaseToken, planGenerationLimiter, async (req, res, next) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ success: false, message: 'Message is required.' });
    }
    if (message.trim().length > 1000) {
      return res.status(400).json({ success: false, message: 'Message is too long (max 1000 characters).' });
    }
    const result = await chatWithPlan(req.user.uid, req.params.id, message.trim());
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    if (error.message === 'PLAN_NOT_FOUND') {
      return res.status(404).json({ success: false, message: 'Plan not found.' });
    }
    next(error);
  }
});

module.exports = router;
