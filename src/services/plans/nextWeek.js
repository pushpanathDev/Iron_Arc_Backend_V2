const { prisma } = require("../../config/database");
const { HttpError } = require("../../utils/httpError");
const { anonymizeIronArcProfile } = require("../../utils/anonymizer");
const { safeModeOf } = require("../../utils/healthCheck");
const { validateAndSanitizePlan, saferFrom } = require("../../utils/planValidator");
const { aiText } = require("../../utils/aiText");
const { weekChangeReply, parseReply } = require("../../utils/aiReplies");
const { compactWeek, changedDays, chatOf, withoutChat, withChat } = require("../../utils/planChat");
const { diffPlanWeek } = require("../../utils/planDiff");
const { dateKey, addDays, mondayOf, shortDay } = require("../../utils/dates");
const { avoidAreasOf, allowedExerciseIds, goEasySwapNote } = require("../../utils/exerciseDatabase");
const { buildNextWeekPrompt } = require("../../utils/planPrompts");
const { withNextWeek, withWeek, moveSessions, weekTrainingDays, trainingWeekdays, planLength, isDeloadWeek, weekStartsOn } = require("../../utils/planSchedule");
const { now, findOwnPlan, askAi, equipmentOf, settingsFor, workoutLine, workoutsSince, aiWeekOnSchedule, checkedWeekChange } = require("./shared");

/** Testing only (ALLOW_EARLY_NEXT_WEEK=true): start the next week before its Monday. */
const earlyNextWeekAllowed = () => process.env.ALLOW_EARLY_NEXT_WEEK === "true";

/** Everything logged in the 7 days up to `today`, one line each. */
async function loggedLastWeek(userId, today = dateKey()) {
  return (await workoutsSince(userId, addDays(today, -7))).map(workoutLine);
}

/**
 * Moves the plan to its next week, written from this week and tuned to what
 * the user logged in the last 7 days. Plan weeks are calendar weeks: the next
 * one starts from the Monday after this one (`today` is the user's date). If
 * the training days changed in the profile, next week moves to the new days.
 * (Plans made before weekly generation already hold every week; their next
 * week is tuned the same way.)
 */
async function recalibratePlan(user, planId, today = dateKey()) {
  const plan = await findOwnPlan(user.id, planId);
  const current = plan.weekNumber || 1;
  const totalWeeks = planLength(plan.planData);
  if (current >= totalWeeks) {
    throw new HttpError(409, "You're on the last week of this plan. Generate a new plan to keep progressing.");
  }
  const next = current + 1;
  const startsOn = weekStartsOn(plan);
  if (mondayOf(today) <= startsOn && !earlyNextWeekAllowed()) {
    throw new HttpError(409, `Week ${next} starts on Monday ${shortDay(addDays(startsOn, 7))}. Until then, keep going with week ${current}.`);
  }
  const equipment = equipmentOf(user, plan.criteria);
  const avoid = avoidAreasOf(user);
  const settings = settingsFor(user, plan.criteria ?? {});
  const safeMode = safeModeOf(user);
  const unavailable = "The coach couldn't prepare next week right now. Please try again in a moment.";

  // Next week as it stands: this week copied, on the profile's training days.
  let planOnly = withoutChat(plan.planData);
  const thisWeek = planOnly.weeks?.[current - 1]?.days ?? [];
  const newDays = weekTrainingDays(thisWeek).join() !== trainingWeekdays(user).join();
  if (newDays) {
    const moved = moveSessions(thisWeek, settings.schedule, settings.minutes) ?? (await aiWeekOnSchedule(user, settings, unavailable)).days;
    planOnly = withWeek(planOnly, next, moved);
  } else {
    planOnly = withNextWeek(planOnly, next);
  }

  const prompt = buildNextWeekPrompt(compactWeek(planOnly, current), compactWeek(planOnly, next), await loggedLastWeek(user.id, today), anonymizeIronArcProfile(user), {
    weekNumber: current,
    totalWeeks,
    progression: settings.progression,
    deload: isDeloadWeek(next),
    exerciseIds: allowedExerciseIds(equipment, avoid),
  });
  /** The AI's next week, checked ({ plan, swaps }), or null when it sent none or an unusable one. */
  const adjust = (reply) => {
    const days = changedDays(reply);
    const checked = days ? checkedWeekChange(planOnly, next, days, equipment, { onlyThisWeek: true, safeMode, avoid }) : null;
    return checked?.plan ? checked : null;
  };
  const ask = async () => parseReply(weekChangeReply, await askAi(prompt, { userId: user.id, maxTokens: 3000, unavailable }));

  // Next week must carry the progression, so a reply without it gets one more try.
  let reply = await ask();
  let checked = adjust(reply);
  if (!checked) {
    console.warn("[nextWeek] AI sent no usable week; asking once more");
    reply = await ask();
    checked = adjust(reply);
  }
  // Still nothing: the move goes ahead with next week as it stands, and says so.
  let adjusted = checked?.plan ?? null;
  let message = aiText(reply?.message, 700) || `Week ${next} is ready.`;
  const swapNote = checked ? goEasySwapNote(checked.swaps, avoid) : null;
  if (swapNote) message = `${message} ${swapNote}`;
  if (!adjusted) {
    adjusted = validateAndSanitizePlan(planOnly, equipment, { avoid, fromWeek: next });
    if (safeMode) adjusted = saferFrom(adjusted, next);
    message = `Week ${next} is ready, as planned. (I couldn't adjust it from your log this time.)`;
  }
  if (newDays) message = `${message} It's on your new training days.`;

  // The new week runs from this Monday; the one before is kept for the coach's
  // "last week". Test mode starts it early, in this same week, so the week before
  // is then treated as last week (dated the week before this one).
  const newStartsOn = mondayOf(today);
  const lastStartsOn = startsOn < newStartsOn ? startsOn : addDays(newStartsOn, -7);
  const note = {
    role: "assistant",
    kind: "nextWeek",
    week: next,
    weekStartsOn: newStartsOn,
    content: `Moved to week ${next}. ${message}`,
    timestamp: now(),
    planUpdated: true,
    changes: diffPlanWeek(planOnly, adjusted, next),
  };
  const planData = { ...adjusted, weekStartedAt: undefined, weekStartsOn: newStartsOn, lastWeek: { number: current, startsOn: lastStartsOn } };
  return prisma.plan.update({
    where: { id: planId },
    data: { planData: withChat(planData, chatOf(plan.planData), [note]), weekNumber: next },
  });
}

module.exports = { recalibratePlan };
