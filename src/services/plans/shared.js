const { prisma } = require("../../config/database");
const { HttpError } = require("../../utils/httpError");
const { anonymizeIronArcProfile } = require("../../utils/anonymizer");
const { safeModeOf } = require("../../utils/healthCheck");
const { validateAndSanitizePlan, weekProblems, saferFrom } = require("../../utils/planValidator");
const { aiText, promptText } = require("../../utils/aiText");
const { firstWeekReply, parseReply } = require("../../utils/aiReplies");
const { applyWeekChange } = require("../../utils/planChat");
const { dateKey, withWeekday } = require("../../utils/dates");
const { equipmentTagsFor } = require("../../utils/exerciseDatabase");
const { buildFirstWeekPrompt } = require("../../utils/planPrompts");
const { planSettings, assembleWeek } = require("../../utils/planSchedule");
const { askForJson } = require("../aiClient");
const { checkAiBudget, recordAiUsage } = require("../aiBudget");

/* What the plan services share: ownership checks, asking the AI, and checking an AI week. */

const now = () => new Date().toISOString();

/** One of the user's plans, or a 404. */
async function findOwnPlan(userId, planId) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw new HttpError(404, "Plan not found.");
  return plan;
}

/** The same check without loading the plan itself (rename, activate, delete). */
async function checkOwnPlan(userId, planId) {
  const plan = await prisma.plan.findFirst({ where: { id: planId, userId }, select: { id: true, isActive: true } });
  if (!plan) throw new HttpError(404, "Plan not found.");
  return plan;
}

/**
 * The AI's JSON reply, for `userId`. The daily budgets are checked first (their
 * 429 or 503 reaches the user as it is), and the call is counted after, tokens
 * of every attempt included. If the AI can't answer (down, rate-limited,
 * cut-off reply), the user gets `unavailable` as a 503 and can simply try again.
 */
async function askAi(prompt, { userId, unavailable, maxTokens }) {
  await checkAiBudget(userId);
  const spent = { tokensIn: 0, tokensOut: 0 };
  const onUsage = ({ tokensIn, tokensOut }) => {
    spent.tokensIn += tokensIn;
    spent.tokensOut += tokensOut;
  };
  try {
    return await askForJson(prompt, { maxTokens, onUsage });
  } catch (error) {
    console.warn(`[AI] call failed: ${error.message}`);
    throw new HttpError(503, unavailable);
  } finally {
    await recordAiUsage(userId, spent);
  }
}

/** Equipment tags a plan may use: what it was built with, else the user's profile. */
const equipmentOf = (user, criteria) => equipmentTagsFor(criteria?.equipment ?? user.equipment);

/** planSettings, with conservative intensity in Safe mode. */
function settingsFor(user, criteria) {
  const settings = planSettings(user, criteria);
  return safeModeOf(user) ? { ...settings, intensity: "conservative" } : settings;
}

/** A logged workout as one line for a prompt: "Wed 2026-10-14 Bench Press: 60×10, 62.5×8". The name may be one the user typed, so it's cleaned. */
function workoutLine(w) {
  const sets = w.sets.map((x) => (x.weight ? `${x.weight}×${x.reps}` : `${x.reps}`)).join(", ");
  return `${withWeekday(dateKey(new Date(w.date)))} ${promptText(w.exercise, 100)}: ${sets}`;
}

/** Workouts dated from `since` ("YYYY-MM-DD") on, oldest first. */
function workoutsSince(userId, since) {
  return prisma.workout.findMany({
    where: { userId, deletedAt: null, date: { gte: new Date(`${since}T00:00:00Z`) } },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "asc" },
    take: 120,
  });
}

/** The last 5 workouts, oldest first, as context for a new plan. */
async function recentWorkouts(userId) {
  const workouts = await prisma.workout.findMany({
    where: { userId, deletedAt: null },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "desc" },
    take: 5,
  });
  return workouts.reverse().map(workoutLine);
}

/**
 * A week written by the AI on the server's schedule (`settings` from
 * planSettings): { days, planExplanation }. A reply that leaves out a whole
 * session gets one more try; after that the user is asked to retry (503).
 */
async function aiWeekOnSchedule(user, settings, unavailable) {
  const prompt = buildFirstWeekPrompt(anonymizeIronArcProfile(user), settings, await recentWorkouts(user.id));
  // One week of sessions fits well inside 4,000 tokens; the prompt plus this cap stays under Groq's per-minute limit.
  const ask = async () => parseReply(firstWeekReply, await askAi(prompt, { userId: user.id, maxTokens: 4000, unavailable }));

  let reply = await ask();
  let days = assembleWeek(settings.schedule, reply?.days, settings.minutes);
  if (!days) {
    console.warn("[week] AI left out a session; asking once more");
    reply = await ask();
    days = assembleWeek(settings.schedule, reply?.days, settings.minutes);
  }
  if (!days) throw new HttpError(503, "Could not generate a valid plan. Please try again.");
  return { days, planExplanation: aiText(reply.planExplanation, 400) };
}

/**
 * An AI change to one week, checked: the plan with it applied and the
 * exercises the validator swapped in that week, or why it can't be used.
 * The change must pass the validator's limits and the week rules (a rest day).
 * In Safe mode it's bounded further and may add only a little to the week.
 */
function checkedWeekChange(planOnly, weekNumber, days, equipment, { safeMode = false, avoid = [], ...options } = {}) {
  try {
    const week = weekNumber || 1;
    const swaps = [];
    const onSwap = (swap) => swap.week === week && swaps.push(swap);
    const validated = validateAndSanitizePlan(applyWeekChange(planOnly, weekNumber, days, options), equipment, { avoid, fromWeek: week, onSwap });
    const plan = safeMode ? saferFrom(validated, week) : validated;
    const problems = weekProblems(plan.weeks?.[week - 1]?.days, { safeMode, before: planOnly.weeks?.[week - 1]?.days });
    return problems.length > 0 ? { problems } : { plan, swaps };
  } catch {
    return { problems: ["invalid week"] };
  }
}

module.exports = {
  now,
  findOwnPlan,
  checkOwnPlan,
  askAi,
  equipmentOf,
  settingsFor,
  workoutLine,
  workoutsSince,
  aiWeekOnSchedule,
  checkedWeekChange,
};
