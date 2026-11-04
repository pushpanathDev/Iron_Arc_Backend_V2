const { prisma } = require("../../config/database");
const { HttpError } = require("../../utils/httpError");
const { safeModeOf } = require("../../utils/healthCheck");
const { saferFrom } = require("../../utils/planValidator");
const { chatOf, withoutChat, withChat } = require("../../utils/planChat");
const { diffPlanWeek } = require("../../utils/planDiff");
const { now, findOwnPlan } = require("./shared");

/**
 * Brings a plan within Safe mode's limits from this week on (at most 4 sets,
 * 8+ reps, 60 s rest; planValidator's SAFE_LIMITS), without the AI. For a plan
 * made before the health check turned Safe mode on. Noted in the coach chat;
 * `changed` is false when it already fit.
 */
async function makePlanSafer(user, planId) {
  if (!safeModeOf(user)) throw new HttpError(409, "Safe mode is off, so your plan can stay as it is.", "SAFE_MODE_OFF");
  const plan = await findOwnPlan(user.id, planId);
  const week = plan.weekNumber || 1;
  const planOnly = withoutChat(plan.planData);
  const safer = saferFrom(planOnly, week);
  const changes = diffPlanWeek(planOnly, safer, week);
  if (changes.length === 0) return { plan, changed: false };

  const note = {
    role: "assistant",
    kind: "safeMode",
    content: "Made your plan gentler for Safe mode: at most 4 sets, 8 or more reps and at least 60 seconds' rest, from this week on.",
    timestamp: now(),
    planUpdated: true,
    changes,
  };
  // A suggestion waiting from before no longer fits the plan, so it expires.
  const updated = await prisma.plan.update({ where: { id: planId }, data: { planData: withChat(safer, chatOf(plan.planData), [note]) } });
  return { plan: updated, changed: true };
}

module.exports = { makePlanSafer };
