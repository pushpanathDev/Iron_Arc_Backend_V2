const rateLimit = require('express-rate-limit');

// ── Plan Generation Limiter ────────────────────────────────────────────
// Strict limiter — Groq calls are expensive, limit plan generation per user
const planGenerationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: parseInt(process.env.MAX_PLAN_GENERATIONS_PER_HOUR) || 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Plan generation limit reached. Your current plan is still active.',
  },
  keyGenerator: (req) => req.user?.uid || req.ip,
});

// ── Authenticated User Limiter ─────────────────────────────────────────
// Per-user cap across every authenticated /api route. Runs at the end of
// verifyFirebaseToken, so req.user.uid is always set.
const userLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.user.uid,
});

// ── Admin Limiter ──────────────────────────────────────────────────────
// Strict per-IP cap on /api/admin (static-key auth, so throttle guessing).
// Relies on app.set('trust proxy', 1) for the real client IP behind Render.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests.' },
});

// ── Plan Coach Chat Limiter ─────────────────────────────────────────────
// Chat messages are short AI calls; they get their own budget so a few
// messages never block generating a plan (and vice versa).
const planChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: parseInt(process.env.MAX_PLAN_CHATS_PER_HOUR) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Coach message limit reached for this hour. Your plan is unchanged.',
  },
  keyGenerator: (req) => req.user?.uid || req.ip,
});

module.exports = { planGenerationLimiter, planChatLimiter, userLimiter, adminLimiter };
