const express = require("express");
const { latestRelease } = require("../utils/appRelease");

// Public, no sign-in: the app asks on start (even signed out) whether there's
// a newer version, and whether it must update. The answer comes from the
// latest GitHub release of the releases repo (utils/appRelease.js).
const router = express.Router();

router.get("/version", async (req, res) => {
  // Never kept by the phone: "Check again" must ask again (the GitHub answer is cached here instead).
  res.set("Cache-Control", "no-store");
  res.json({ success: true, data: await latestRelease() });
});

module.exports = router;
