const express = require("express");
const {
  verifyFirebaseToken,
  verifyFirebaseTokenWithRevocation,
  requireEmailVerified,
  requireRecentSignIn,
} = require("../middleware/authMiddleware");
const { validate, profileUpdateSchema } = require("../middleware/validation");
const userService = require("../services/userService");

const router = express.Router();
// Signing in also creates or updates the user's row (see authMiddleware).
router.use(verifyFirebaseToken);

// Called by the app after sign-in; the row is already up to date by now.
router.post("/sync", requireEmailVerified, (req, res) => {
  res.json({ success: true, data: req.user.dbUser });
});

router.get("/profile", (req, res) => {
  res.json({ success: true, data: req.user.dbUser });
});

router.patch("/profile", requireEmailVerified, validate(profileUpdateSchema), async (req, res) => {
  const updated = await userService.updateProfile(req.user.dbUser.id, req.body);
  res.json({ success: true, data: updated });
});

// Needs a sign-in from the last 5 minutes and a token that hasn't been revoked.
router.delete("/account", verifyFirebaseTokenWithRevocation, requireRecentSignIn, requireEmailVerified, async (req, res) => {
  await userService.deleteAccount(req.user.uid);
  res.json({ success: true, message: "Account deleted" });
});

module.exports = router;
