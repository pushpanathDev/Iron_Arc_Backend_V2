const { prisma } = require("../../config/database");
const { safeModeOf } = require("../../utils/healthCheck");
const { validateAndSanitizePlan, saferFrom } = require("../../utils/planValidator");
const { dateKey } = require("../../utils/dates");
const { equipmentTagsFor, avoidAreasOf } = require("../../utils/exerciseDatabase");
const { SPLIT_NAMES, firstWeekStartsOn } = require("../../utils/planSchedule");
const { claimFreePlan } = require("../billingService");
const { evaluateAchievementsSafely } = require("../achievementService");
const { settingsFor, aiWeekOnSchedule } = require("./shared");

/** "Push Pull Legs 2": the split's name, numbered after the first plan. */
function planNameFor(split, existingPlans) {
  const base = SPLIT_NAMES[split] ?? "My Plan";
  return existingPlans === 0 ? base : `${base} ${existingPlans + 1}`;
}

/**
 * A new plan, written one week at a time: this makes week 1 on the server's
 * schedule (planSchedule), and "next week" adds each week after it. It becomes
 * the active plan.
 * `today` is the user's date ("YYYY-MM-DD"); week 1 is this calendar week, or
 * next week's when made at the weekend. `freePlan`: the user has no Pro, so
 * the plan uses their free one (refused if another request took it meanwhile).
 */
async function generatePlan(user, criteria = {}, today = dateKey(), { freePlan = false } = {}) {
  const settings = settingsFor(user, criteria);
  const { days, planExplanation } = await aiWeekOnSchedule(user, settings, "Couldn't build your plan right now. Please try again in a moment.");
  const validated = validateAndSanitizePlan(
    { planExplanation, totalWeeks: settings.totalWeeks, weekStartsOn: firstWeekStartsOn(today), weeks: [{ week: 1, isDeloadWeek: false, days }] },
    equipmentTagsFor(settings.equipment),
    { avoid: avoidAreasOf(user) },
  );
  const planData = safeModeOf(user) ? saferFrom(validated) : validated;

  const plan = await prisma.$transaction(async (tx) => {
    if (freePlan) await claimFreePlan(tx, user.id);
    const existingPlans = await tx.plan.count({ where: { userId: user.id } });
    await tx.plan.updateMany({ where: { userId: user.id, isActive: true }, data: { isActive: false } });
    // Append-only log for the "plans generated" badges (plans themselves can be deleted).
    await tx.planGeneration.create({ data: { userId: user.id } });
    return tx.plan.create({
      data: { userId: user.id, name: planNameFor(settings.split, existingPlans), criteria, planData, isActive: true, weekNumber: 1 },
    });
  });

  const newlyUnlocked = await evaluateAchievementsSafely(user.id, "plan");
  return { plan, newlyUnlocked };
}

module.exports = { generatePlan };
