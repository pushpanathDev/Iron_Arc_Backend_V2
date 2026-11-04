const express = require("express");
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { validate, checkoutSchema, changePlanSchema } = require("../middleware/validation");
const billingService = require("../services/billingService");

// Iron Arc Pro with test payments: nothing is charged. Every answer is the
// whole billing state (Pro, the free plan, the plans on offer, receipts).
const router = express.Router();
router.use(verifyFirebaseToken);

router.get("/", async (req, res) => {
  res.json({ success: true, data: await billingService.billingOf(req.user.dbUser) });
});

// Starts the free trial (the first time) or Pro with a test payment. A repeated key changes nothing.
router.post("/checkout", requireEmailVerified, validate(checkoutSchema), async (req, res) => {
  res.json({ success: true, data: await billingService.checkout(req.user.dbUser, req.body) });
});

// Stops renewing; Pro stays until the period ends.
router.post("/cancel", requireEmailVerified, async (req, res) => {
  res.json({ success: true, data: await billingService.cancel(req.user.dbUser) });
});

router.post("/resume", requireEmailVerified, async (req, res) => {
  res.json({ success: true, data: await billingService.resume(req.user.dbUser) });
});

// Monthly or yearly from the next renewal; the current plan undoes a switch.
router.post("/change-plan", requireEmailVerified, validate(changePlanSchema), async (req, res) => {
  res.json({ success: true, data: await billingService.changePlan(req.user.dbUser, req.body.plan) });
});

module.exports = router;
