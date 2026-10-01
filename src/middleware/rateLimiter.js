const rateLimit = require('express-rate-limit');

// ── General Limiter ────────────────────────────────────────────────────
// Applied to all routes — prevents general API abuse
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute window
  max: parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please slow down.' },
  keyGenerator: (req) => req.user?.uid || req.ip,
});

// ── Plan Generation Limiter ────────────────────────────────────────────
// Strict limiter — Gemini calls are expensive, limit plan generation per user
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

module.exports = { generalLimiter, planGenerationLimiter };
