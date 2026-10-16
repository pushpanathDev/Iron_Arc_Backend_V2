const express = require("express");
const router = express.Router();
const {
  verifyFirebaseToken,
  verifyFirebaseTokenWithRevocation,
  requireEmailVerified,
  requireRecentSignIn,
} = require("../middleware/authMiddleware");
const { validate, profileUpdateSchema } = require("../middleware/validation");
const userService = require("../services/userService");

router.use(verifyFirebaseToken);

router.post("/sync", requireEmailVerified, async (req, res, next) => {
  try {
    const user = await userService.upsertUserByFirebaseUid(req.user.uid, req.user.email);
    req.user.dbUser = user;
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

router.get("/profile", async (req, res, next) => {
  try {
    res.json({ success: true, data: req.user.dbUser });
  } catch (error) {
    next(error);
  }
});

router.patch("/profile", requireEmailVerified, validate(profileUpdateSchema), async (req, res, next) => {
  try {
    const updated = await userService.updateProfile(req.user.uid, req.body);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/account", verifyFirebaseTokenWithRevocation, requireRecentSignIn, requireEmailVerified, async (req, res, next) => {
  try {
    console.log(`[user] Account deletion requested for ${req.user.uid}`);
    await userService.deleteAccount(req.user.uid);
    console.log(`[user] Account deletion completed for ${req.user.uid}`);
    res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
