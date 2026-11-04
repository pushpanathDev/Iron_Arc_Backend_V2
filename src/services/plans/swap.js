const { prisma } = require("../../config/database");
const { HttpError } = require("../../utils/httpError");
const { anonymizeIronArcProfile } = require("../../utils/anonymizer");
const { dangerSign } = require("../../utils/safetyTriage");
const { validateAndSanitizePlan } = require("../../utils/planValidator");
const { aiText } = require("../../utils/aiText");
const { substituteReply, parseReply } = require("../../utils/aiReplies");
const { chatOf, withoutChat, withChat, pendingChangeOf } = require("../../utils/planChat");
const { diffPlanWeek } = require("../../utils/planDiff");
const { planHasExercise, exerciseNameIn, applySubstitution } = require("../../utils/planSwap");
const { EXERCISE_DB, avoidAreasOf, allowedExerciseIds, getSubstituteExerciseId } = require("../../utils/exerciseDatabase");
const { buildSubstitutePrompt } = require("../../utils/planPrompts");
const { now, findOwnPlan, askAi, equipmentOf } = require("./shared");

/** Replaces one exercise everywhere in the plan with one the AI picks. `reason` is the user's, if they gave one. */
async function substituteExercise(user, planId, exerciseId, reason) {
  const plan = await findOwnPlan(user.id, planId);
  if (!planHasExercise(plan.planData, exerciseId)) {
    throw new HttpError(422, `Exercise "${exerciseId}" was not found in this plan.`);
  }
  const name = exerciseNameIn(plan.planData, exerciseId) ?? exerciseId;

  // A danger sign in the reason ("sharp pain in my knee") gets the chat's fixed
  // safety reply instead of a swap, without the AI. It's kept in the coach chat.
  const sign = dangerSign(reason);
  if (sign) {
    console.warn(`[swap] danger sign (${sign.kind}) in the reason: no swap`);
    const asked = { role: "user", content: `Swap ${name}: ${reason}`, timestamp: now() };
    const safetyReply = { role: "assistant", kind: "safety", content: sign.reply, timestamp: now() };
    const planData = withChat(withoutChat(plan.planData), chatOf(plan.planData), [asked, safetyReply], pendingChangeOf(plan.planData));
    await prisma.plan.update({ where: { id: planId }, data: { planData } });
    throw new HttpError(422, sign.reply, "SAFETY_STOP");
  }

  const equipment = equipmentOf(user, plan.criteria);
  const avoid = avoidAreasOf(user);
  const allowed = allowedExerciseIds(equipment, avoid);
  const prompt = buildSubstitutePrompt(exerciseId, reason, anonymizeIronArcProfile(user), allowed);
  const reply = parseReply(
    substituteReply,
    await askAi(prompt, { userId: user.id, maxTokens: 400, unavailable: "Couldn't find a replacement right now. Please try again in a moment." }),
  );

  // The AI's pick if it's a different exercise the user can do, else the closest one we know.
  const pick = reply?.substituteExerciseId;
  const newId = allowed.includes(pick) && pick !== exerciseId ? pick : getSubstituteExerciseId(exerciseId, equipment, avoid);
  const newName = EXERCISE_DB[newId].name;

  const swapped = validateAndSanitizePlan(
    applySubstitution(plan.planData, exerciseId, { id: newId, name: newName, reason: aiText(reply?.reason, 160) || reason || "Exercise substitution" }),
    equipment,
    { avoid, fromWeek: plan.weekNumber || 1 },
  );
  const note = {
    role: "assistant",
    kind: "swap",
    content: `Swapped ${name} for ${newName}${reason ? ` (you said: "${reason}")` : ""}.`,
    timestamp: now(),
    planUpdated: true,
    changes: diffPlanWeek(plan.planData, swapped, plan.weekNumber),
  };
  return prisma.plan.update({
    where: { id: planId },
    data: { planData: withChat(swapped, chatOf(plan.planData), [note]) },
  });
}

module.exports = { substituteExercise };
