/*
 * AI plans, one file per job:
 *   generate   a new plan (week 1 on the server's schedule)
 *   nextWeek   the next week, tuned to what was logged
 *   swap       one exercise for another the AI picks
 *   safeMode   an older plan made gentler, without the AI
 *   chat       the plan coach and its suggestions
 *   actions    list, get, rename, activate, delete
 *   shared     ownership checks, asking the AI, checking an AI week
 *
 * Every function gets the signed-in user's row (req.user.dbUser) or its id,
 * and only touches that user's plans. Every plan change made by the AI goes
 * through the validator, and is noted in the coach chat with what changed
 * (planDiff), so the user can always see what happened.
 */
const { generatePlan } = require("./generate");
const { recalibratePlan } = require("./nextWeek");
const { substituteExercise } = require("./swap");
const { makePlanSafer } = require("./safeMode");
const { chatWithPlan, applyProposal, dismissProposal } = require("./chat");
const { listPlans, getPlan, renamePlan, activatePlan, deletePlan } = require("./actions");

module.exports = {
  listPlans,
  getPlan,
  generatePlan,
  recalibratePlan,
  substituteExercise,
  makePlanSafer,
  renamePlan,
  activatePlan,
  deletePlan,
  chatWithPlan,
  applyProposal,
  dismissProposal,
};
