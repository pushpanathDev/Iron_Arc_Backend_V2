const { prisma } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { validateAndSanitizePlan } = require("../utils/planValidator");
const { compactWeek, applyWeekChange, changedDays, chatOf, withoutChat, withChat, weekSoFar } = require("../utils/planChat");
const { diffPlanWeek, dayShortName } = require("../utils/planDiff");
const { dateKey, addDays, withWeekday } = require("../utils/dates");
const { planHasExercise, exerciseNameIn, applySubstitution } = require("../utils/planSwap");
const { EXERCISE_DB, equipmentTagsFor, allowedExerciseIds, getSubstituteExerciseId } = require("../utils/exerciseDatabase");
const { buildFirstWeekPrompt, buildNextWeekPrompt, buildSubstitutePrompt, buildPlanChatPrompt } = require("../utils/planPrompts");
const { SPLIT_NAMES, planSettings, assembleWeek, withNextWeek, planLength, isDeloadWeek } = require("../utils/planSchedule");
const { askForJson } = require("./aiClient");
const { evaluateAchievementsSafely } = require("./achievementService");

/*
 * AI plans: generate, "next week", exercise swaps and the coach chat, plus
 * the plain plan actions (list, rename, activate, delete).
 *
 * Every function gets the signed-in user's row (req.user.dbUser) or its id,
 * and only ever touches that user's plans. Every plan change made by the AI
 * goes through the validator, and is noted in the coach chat with a list of
 * what changed (planDiff), so the user can always see what happened.
 */

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
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
 * The AI's JSON reply. If the AI can't answer (down, rate-limited, cut-off
 * reply), the user gets `unavailable` as a 503 and can simply try again.
 */
async function askAi(prompt, { unavailable, maxTokens }) {
  try {
    return await askForJson(prompt, { maxTokens });
  } catch (error) {
    console.warn(`[AI] call failed: ${error.message}`);
    throw new HttpError(503, unavailable);
  }
}

/** Equipment tags a plan may use: what it was built with, else the user's profile. */
function equipmentOf(user, criteria) {
  return equipmentTagsFor(criteria?.equipment ?? user.equipment);
}

const now = () => new Date().toISOString();

/** A logged workout as one line for a prompt: "Wed 2026-10-14 Bench Press: 60×10, 62.5×8". */
function workoutLine(w) {
  const sets = w.sets.map((x) => (x.weight ? `${x.weight}×${x.reps}` : `${x.reps}`)).join(", ");
  return `${withWeekday(dateKey(new Date(w.date)))} ${w.exercise}: ${sets}`;
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

/** Workouts from the 7 days up to `today` ("YYYY-MM-DD"), oldest first. */
function workoutsOfLastWeek(userId, today) {
  return prisma.workout.findMany({
    where: { userId, deletedAt: null, date: { gte: new Date(`${addDays(today, -7)}T00:00:00Z`) } },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "asc" },
    take: 60,
  });
}

/** Everything logged in the last 7 days, one line each (for next-week adjustments). */
async function loggedLastWeek(userId, today = dateKey()) {
  return (await workoutsOfLastWeek(userId, today)).map(workoutLine);
}

/** "Push ×2, Pull ×2, Legs ×2 (6 training days)": how often each session runs in a week. */
function sessionsPerWeek(days) {
  const training = days.filter((d) => d.sessionType !== "rest" && d.exercises?.length > 0);
  const counts = new Map();
  for (const day of training) counts.set(dayShortName(day), (counts.get(dayShortName(day)) ?? 0) + 1);
  return `${[...counts].map(([name, n]) => `${name} ×${n}`).join(", ")} (${training.length} training days)`;
}

/** "Push Pull Legs 2": the split's name, numbered after the first plan. */
function planNameFor(split, existingPlans) {
  const base = SPLIT_NAMES[split] ?? "My Plan";
  return existingPlans === 0 ? base : `${base} ${existingPlans + 1}`;
}

/* ─────────────────────────────────────────────────────────────
   Read
───────────────────────────────────────────────────────────── */
async function listPlans(userId) {
  // The list doesn't need the plans themselves, so they aren't even read.
  return prisma.plan.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    omit: { planData: true },
  });
}

const getPlan = findOwnPlan;

/* ─────────────────────────────────────────────────────────────
   Generate
───────────────────────────────────────────────────────────── */
/**
 * A new plan, written one week at a time: this makes week 1 on the server's
 * schedule (planSchedule), and "next week" adds each week after it.
 */
async function generatePlan(user, criteria = {}) {
  const settings = planSettings(user, criteria);
  const prompt = buildFirstWeekPrompt(anonymizeIronArcProfile(user), settings, await recentWorkouts(user.id));
  const ask = () =>
    // One week of sessions fits well inside 4,000 tokens; the prompt plus this cap stays under Groq's per-minute limit.
    askAi(prompt, { maxTokens: 4000, unavailable: "Couldn't build your plan right now. Please try again in a moment." });

  // A reply that leaves out a whole session gets one more try before the user is asked to retry.
  let reply = await ask();
  let days = assembleWeek(settings.schedule, reply?.days, settings.minutes);
  if (!days) {
    console.warn("[generate] AI left out a session; asking once more");
    reply = await ask();
    days = assembleWeek(settings.schedule, reply?.days, settings.minutes);
  }
  let planData;
  try {
    if (!days) throw new Error("the reply is missing a session");
    planData = validateAndSanitizePlan(
      { planExplanation: reply.planExplanation, totalWeeks: settings.totalWeeks, weekStartedAt: now(), weeks: [{ week: 1, isDeloadWeek: false, days }] },
      equipmentTagsFor(settings.equipment),
    );
  } catch (error) {
    console.warn(`[generate] AI returned an unusable week: ${error.message}`);
    throw new HttpError(503, "Could not generate a valid plan. Please try again.");
  }

  const plan = await prisma.$transaction(async (tx) => {
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

/* ─────────────────────────────────────────────────────────────
   Next week
───────────────────────────────────────────────────────────── */
/**
 * Moves the plan to its next week, written from this week and tuned to what
 * the user logged in the last 7 days. (Plans made before weekly generation
 * already hold every week; their next week is tuned the same way.)
 */
async function recalibratePlan(user, planId) {
  const plan = await findOwnPlan(user.id, planId);
  const current = plan.weekNumber || 1;
  const totalWeeks = planLength(plan.planData);
  if (current >= totalWeeks) {
    throw new HttpError(409, "You're on the last week of this plan. Generate a new plan to keep progressing.");
  }
  const next = current + 1;
  const planOnly = withNextWeek(withoutChat(plan.planData), next);
  const equipment = equipmentOf(user, plan.criteria);

  const prompt = buildNextWeekPrompt(compactWeek(planOnly, current), compactWeek(planOnly, next), await loggedLastWeek(user.id), anonymizeIronArcProfile(user), {
    weekNumber: current,
    totalWeeks,
    progression: planSettings(user, plan.criteria ?? {}).progression,
    deload: isDeloadWeek(next),
    exerciseIds: allowedExerciseIds(equipment),
  });
  const reply = await askAi(prompt, {
    maxTokens: 3000,
    unavailable: "The coach couldn't prepare next week right now. Please try again in a moment.",
  });

  // A broken week from the AI must not block the move: next week then stays as planned.
  let message = reply?.message || `Week ${next} is ready.`;
  let adjusted;
  try {
    const days = changedDays(reply);
    adjusted = validateAndSanitizePlan(days ? applyWeekChange(planOnly, next, days, { onlyThisWeek: true }) : planOnly, equipment);
  } catch {
    console.warn("[nextWeek] AI returned an invalid week; keeping next week as planned");
    adjusted = validateAndSanitizePlan(planOnly, equipment);
    message = `Week ${next} is ready, as planned. (I couldn't adjust it from your log this time.)`;
  }

  const note = {
    role: "assistant",
    kind: "nextWeek",
    content: `Moved to week ${next}. ${message}`,
    timestamp: now(),
    planUpdated: true,
    changes: diffPlanWeek(planOnly, adjusted, next),
  };
  return prisma.plan.update({
    where: { id: planId },
    data: { planData: withChat({ ...adjusted, weekStartedAt: now() }, chatOf(plan.planData), [note]), weekNumber: next },
  });
}

/* ─────────────────────────────────────────────────────────────
   Swap an exercise
───────────────────────────────────────────────────────────── */
/** Replaces one exercise everywhere in the plan with one the AI picks. `reason` is the user's, if they gave one. */
async function substituteExercise(user, planId, exerciseId, reason) {
  const plan = await findOwnPlan(user.id, planId);
  if (!planHasExercise(plan.planData, exerciseId)) {
    throw new HttpError(422, `Exercise "${exerciseId}" was not found in this plan.`);
  }
  const equipment = equipmentOf(user, plan.criteria);
  const allowed = allowedExerciseIds(equipment);

  const prompt = buildSubstitutePrompt(exerciseId, reason, anonymizeIronArcProfile(user), allowed);
  const reply = await askAi(prompt, {
    maxTokens: 400,
    unavailable: "Couldn't find a replacement right now. Please try again in a moment.",
  });

  // The AI's pick if it's a different exercise the user can do, else the closest one we know.
  const pick = reply?.substituteExerciseId;
  const newId = allowed.includes(pick) && pick !== exerciseId ? pick : getSubstituteExerciseId(exerciseId, equipment);
  const newName = EXERCISE_DB[newId].name;

  const swapped = validateAndSanitizePlan(
    applySubstitution(plan.planData, exerciseId, { id: newId, name: newName, reason: reply?.reason || reason || "Exercise substitution" }),
    equipment,
  );
  const note = {
    role: "assistant",
    kind: "swap",
    content: `Swapped ${exerciseNameIn(plan.planData, exerciseId) ?? exerciseId} for ${newName}${reason ? ` (you said: "${reason}")` : ""}.`,
    timestamp: now(),
    planUpdated: true,
    changes: diffPlanWeek(plan.planData, swapped, plan.weekNumber),
  };
  return prisma.plan.update({
    where: { id: planId },
    data: { planData: withChat(swapped, chatOf(plan.planData), [note]) },
  });
}

/* ─────────────────────────────────────────────────────────────
   Rename, activate, delete
───────────────────────────────────────────────────────────── */
async function renamePlan(userId, planId, name) {
  await checkOwnPlan(userId, planId);
  return prisma.plan.update({ where: { id: planId }, data: { name } });
}

/** Makes this the active plan; the others become inactive. */
async function activatePlan(userId, planId) {
  await checkOwnPlan(userId, planId);
  return prisma.$transaction(async (tx) => {
    await tx.plan.updateMany({ where: { userId, isActive: true }, data: { isActive: false } });
    return tx.plan.update({ where: { id: planId }, data: { isActive: true } });
  });
}

/** If the deleted plan was active, the newest remaining plan takes over. */
async function deletePlan(userId, planId) {
  const plan = await checkOwnPlan(userId, planId);
  await prisma.$transaction(async (tx) => {
    await tx.plan.delete({ where: { id: planId } });
    if (!plan.isActive) return;
    const newest = await tx.plan.findFirst({ where: { userId }, orderBy: { createdAt: "desc" } });
    if (newest) await tx.plan.update({ where: { id: newest.id }, data: { isActive: true } });
  });
}

/* ─────────────────────────────────────────────────────────────
   Coach chat
───────────────────────────────────────────────────────────── */
/**
 * One message to the coach. The reply may change this week, which then
 * replaces this week and the ones after it (earlier weeks are history).
 * `today` is the user's date ("YYYY-MM-DD"); the server's is used without it.
 */
async function chatWithPlan(user, planId, userMessage, today = dateKey()) {
  const plan = await findOwnPlan(user.id, planId);
  const history = chatOf(plan.planData);
  const planOnly = withoutChat(plan.planData);
  const equipment = equipmentOf(user, plan.criteria);
  const thisWeek = planOnly.weeks?.[Math.max(0, (plan.weekNumber || 1) - 1)]?.days ?? [];
  const workouts = await workoutsOfLastWeek(user.id, today);

  const prompt = buildPlanChatPrompt(compactWeek(planOnly, plan.weekNumber), history, userMessage, anonymizeIronArcProfile(user), {
    weeks: planLength(planOnly),
    weekNumber: plan.weekNumber,
    today: withWeekday(today),
    weekStartedOn: planOnly.weekStartedAt ? withWeekday(dateKey(new Date(planOnly.weekStartedAt))) : null,
    sessionsPerWeek: sessionsPerWeek(thisWeek),
    weekSoFar: weekSoFar(
      thisWeek,
      workouts.map((w) => ({ date: dateKey(new Date(w.date)), exercise: w.exercise, createdAt: w.createdAt })),
      today,
      dayShortName,
      planOnly.weekStartedAt,
    ),
    logged: workouts.map(workoutLine),
    exerciseIds: allowedExerciseIds(equipment),
  });
  const reply = await askAi(prompt, {
    maxTokens: 3000,
    unavailable: "The coach couldn't answer right now. Please try again in a moment.",
  });

  // A malformed or cut-off change from the AI must not lose the reply: the
  // plan stays as it was and the reply says the change didn't go through.
  let message = reply?.message ?? "I've processed your request.";
  let changedPlan = null;
  const days = changedDays(reply);
  if (days) {
    try {
      changedPlan = validateAndSanitizePlan(applyWeekChange(planOnly, plan.weekNumber, days), equipment);
    } catch {
      console.warn("[planChat] AI returned an invalid week; keeping the current plan");
      message = `${message} (I couldn't apply that change to your plan this time. Try asking for one change at a time.)`;
    }
  }

  const coachReply = {
    role: "assistant",
    content: message,
    timestamp: now(),
    ...(changedPlan ? { planUpdated: true, changes: diffPlanWeek(planOnly, changedPlan, plan.weekNumber) } : {}),
  };
  const planData = withChat(changedPlan ?? planOnly, history, [{ role: "user", content: userMessage, timestamp: now() }, coachReply]);
  await prisma.plan.update({ where: { id: planId }, data: { planData } });

  return {
    message,
    planUpdated: Boolean(changedPlan),
    chatHistory: planData._chatHistory,
    planData,
  };
}

module.exports = {
  listPlans,
  getPlan,
  generatePlan,
  recalibratePlan,
  substituteExercise,
  renamePlan,
  activatePlan,
  deletePlan,
  chatWithPlan,
};
