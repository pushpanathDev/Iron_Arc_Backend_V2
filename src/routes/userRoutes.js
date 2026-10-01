const express = require("express");
const router = express.Router();
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { auth } = require("../config/firebase");
const { validate, profileUpdateSchema } = require("../middleware/validation");
const userService = require("../services/userService");

router.use(verifyFirebaseToken);

router.get("/profile", async (req, res, next) => {
  try {
    let user = await userService.getProfile(req.user.uid);

    if (!user) {
      user = await userService.findOrCreateUser(req.user.uid, req.user.email);
    }

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

router.patch("/profile", requireEmailVerified, validate(profileUpdateSchema), async (req, res, next) => {
  try {
    let user = await userService.getProfile(req.user.uid);

    if (!user) {
      user = await userService.findOrCreateUser(req.user.uid, req.user.email);
    }

    const updated = await userService.updateProfile(req.user.uid, req.body);
    res.json({ success: true, data: updated });
  } catch (error) {
    next(error);
  }
});

router.delete("/account", requireEmailVerified, async (req, res, next) => {
  try {
    console.log(`[user] Account deletion requested for ${req.user.uid}`);
    await userService.deleteAccount(req.user.uid);
    console.log(`[user] Account deletion completed for ${req.user.uid}`);
    res.json({ success: true, message: "Account deleted" });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    console.log(`[user] Logout requested for ${req.user.uid}`);
    await auth.revokeRefreshTokens(req.user.uid);
    console.log(`[user] Refresh tokens revoked for ${req.user.uid}`);
    res.json({ success: true, message: "Logged out successfully." });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
