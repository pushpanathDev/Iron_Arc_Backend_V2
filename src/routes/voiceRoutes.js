const express = require("express");
const { verifyFirebaseToken, requireEmailVerified } = require("../middleware/authMiddleware");
const { voiceLimiter } = require("../middleware/rateLimiter");
const { proAccessError, proGateOn } = require("../utils/billing");
const { proStatus } = require("../services/billingService");
const { transcribe } = require("../services/voiceService");

const router = express.Router();
router.use(verifyFirebaseToken);

/** Speak your sets is part of Iron Arc Pro. */
async function requireVoicePro(req, res, next) {
  if (!proGateOn()) return next();
  const closed = proAccessError("voice", await proStatus(req.user.dbUser));
  next(closed ?? undefined);
}

/** The exercise names that steer spelling: `?exercises=` as a JSON list, ignored when it isn't one. */
function exercisesFrom(query) {
  try {
    const list = JSON.parse(String(query.exercises ?? "[]"));
    return Array.isArray(list) ? list.slice(0, 30) : [];
  } catch {
    return [];
  }
}

// A short WAV clip (the request body itself) to text. 4 MB is about two minutes of the app's audio.
router.post(
  "/transcribe",
  requireEmailVerified,
  voiceLimiter,
  requireVoicePro,
  express.raw({ type: "audio/wav", limit: "4mb" }),
  async (req, res) => {
    const text = await transcribe(req.body, { exercises: exercisesFrom(req.query) });
    res.json({ success: true, data: { text } });
  },
);

module.exports = router;
