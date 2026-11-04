const express = require("express");
const {
  verifyFirebaseToken,
  verifyFirebaseTokenWithRevocation,
  requireEmailVerified,
  requireRecentSignIn,
} = require("../middleware/authMiddleware");
const { validate, profileUpdateSchema, healthCheckSchema, clearanceSchema, preferencesSchema } = require("../middleware/validation");
const userService = require("../services/userService");
const { withProStatus } = require("../services/billingService");
const { welcomeIfReady } = require("../services/welcomeService");
const { dangerSign } = require("../utils/safetyTriage");
const { HttpError } = require("../utils/httpError");

const router = express.Router();
// Signing in also creates or updates the user's row (see authMiddleware). The profile
// comes with `pro` (Iron Arc Pro) and `freePlan` (the free AI plan allowance).
router.use(verifyFirebaseToken);

// Called by the app after sign-in; the row is already up to date by now.
router.post("/sync", requireEmailVerified, async (req, res) => {
  res.json({ success: true, data: await withProStatus(req.user.dbUser) });
});

router.get("/profile", async (req, res) => {
  res.json({ success: true, data: await withProStatus(req.user.dbUser) });
});

router.patch("/profile", requireEmailVerified, validate(profileUpdateSchema), async (req, res) => {
  // A danger sign in "Go easy on → Other" ("chest pain when I lift") gets the
  // coach's safety reply instead of being saved for plans to work around.
  const sign = req.body.avoidNote && dangerSign(req.body.avoidNote);
  if (sign) throw new HttpError(422, sign.reply, "SAFETY_STOP");
  const updated = await userService.updateProfile(req.user.dbUser.id, req.body);
  // The save that completes onboarding sends "Welcome to Iron Arc" (once, in the background).
  void welcomeIfReady(updated, { emailVerified: req.user.emailVerified });
  res.json({ success: true, data: await withProStatus(updated) });
});

// The coach's health check and AI terms; any "yes" turns on Safe mode. Can be redone any time.
router.put("/health-check", requireEmailVerified, validate(healthCheckSchema), async (req, res) => {
  const updated = await userService.saveHealthCheck(req.user.dbUser.id, req.body.answers);
  res.json({ success: true, data: await withProStatus(updated) });
});

// The app's settings for this account (theme, kg/lb, go-to reps, bars), applied on every sign-in.
router.patch("/preferences", requireEmailVerified, validate(preferencesSchema), async (req, res) => {
  const updated = await userService.savePreferences(req.user.dbUser.id, req.body);
  res.json({ success: true, data: await withProStatus(updated) });
});

// Safe mode off with a doctor's clearance (or back on). The yes/no answers stay; redoing the check asks again.
router.put("/health-check/clearance", requireEmailVerified, validate(clearanceSchema), async (req, res) => {
  const updated = await userService.setHealthClearance(req.user.dbUser, req.body.cleared);
  res.json({ success: true, data: await withProStatus(updated) });
});

// Needs a sign-in from the last 5 minutes and a token that hasn't been revoked.
router.delete("/account", verifyFirebaseTokenWithRevocation, requireRecentSignIn, requireEmailVerified, async (req, res) => {
  await userService.deleteAccount(req.user.uid);
  res.json({ success: true, message: "Account deleted" });
});

module.exports = router;
