const { prisma } = require("../config/database");
const { HttpError } = require("../utils/httpError");

/*
 * Daily AI budgets, kept in the database (ai_usage) so they hold across
 * restarts and server instances, unlike the in-memory rate limiters (which
 * still stop bursts). Two checks run before every AI call:
 *   - per user: calls and tokens a day, so one account can't use up the AI;
 *   - for everyone: a daily token cap set below the provider's own limit, so
 *     the coach pauses with a clear message instead of failing for all users.
 * Days are UTC. Each call is recorded with the tokens the provider reports,
 * failed attempts included (they cost tokens too).
 */

const int = (name, fallback) => {
  const value = parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Read when checked, so tests and a config change apply without a restart. */
function limits() {
  return {
    userCalls: int("AI_USER_DAILY_CALLS", 40),
    userTokens: int("AI_USER_DAILY_TOKENS", 80_000),
    globalTokens: int("AI_DAILY_TOKEN_BUDGET", 400_000),
  };
}

/** Today in UTC, "YYYY-MM-DD". */
const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);

/**
 * Throws when this user, or everyone together, has used today's AI budget:
 * 429 for the user's own allowance, 503 when the coach is paused for everyone.
 */
async function checkAiBudget(userId, now = new Date()) {
  const day = utcDay(now);
  const { userCalls, userTokens, globalTokens } = limits();
  const [mine, all] = await Promise.all([
    prisma.aiUsage.findUnique({ where: { userId_day: { userId, day } } }),
    prisma.aiUsage.aggregate({ where: { day }, _sum: { tokensIn: true, tokensOut: true } }),
  ]);
  if (mine && (mine.calls >= userCalls || mine.tokensIn + mine.tokensOut >= userTokens)) {
    throw new HttpError(429, "You've reached today's limit for the AI coach. It resets at midnight UTC; your plan and logging work as usual.");
  }
  if ((all._sum.tokensIn ?? 0) + (all._sum.tokensOut ?? 0) >= globalTokens) {
    console.warn(`[aiBudget] daily token budget reached for ${day}`);
    throw new HttpError(503, "The AI coach is resting for today. It's back tomorrow; your plan and logging work as usual.");
  }
}

/** Adds one call (and its tokens) to the user's day. Best-effort: a failed count never fails the request. */
async function recordAiUsage(userId, { tokensIn = 0, tokensOut = 0 } = {}, now = new Date()) {
  const day = utcDay(now);
  try {
    await prisma.aiUsage.upsert({
      where: { userId_day: { userId, day } },
      create: { userId, day, calls: 1, tokensIn, tokensOut },
      update: { calls: { increment: 1 }, tokensIn: { increment: tokensIn }, tokensOut: { increment: tokensOut } },
    });
  } catch (error) {
    console.warn(`[aiBudget] couldn't record usage: ${error.message}`);
  }
}

module.exports = { checkAiBudget, recordAiUsage, limits };
