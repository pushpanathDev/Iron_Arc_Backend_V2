const { createHash, randomUUID } = require("node:crypto");
const { prisma } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { safeModeOf } = require("../utils/healthCheck");
const { claimFreePlan } = require("./billingService");
const { dangerSign, outOfScope, leaksInstructions, NUTRITION_REPLY, LEAK_REPLY } = require("../utils/safetyTriage");
const { validateAndSanitizePlan, weekProblems, saferFrom } = require("../utils/planValidator");
const { aiText, promptText } = require("../utils/aiText");
const { firstWeekReply, weekChangeReply, substituteReply, parseReply } = require("../utils/aiReplies");
const { compactWeek, applyWeekChange, changedDays, chatOf, withoutChat, withChat, weekSoFar, pendingChangeOf, settleProposal } = require("../utils/planChat");
const { diffPlanWeek, dayShortName } = require("../utils/planDiff");
const { dateKey, addDays, withWeekday, mondayOf, shortDay } = require("../utils/dates");
const { planHasExercise, exerciseNameIn, applySubstitution } = require("../utils/planSwap");
const { EXERCISE_DB, equipmentTagsFor, avoidAreasOf, allowedExerciseIds, getSubstituteExerciseId, ruledOutIn, goEasySwapNote } = require("../utils/exerciseDatabase");
const { buildFirstWeekPrompt, buildNextWeekPrompt, buildSubstitutePrompt, buildPlanChatPrompt } = require("../utils/planPrompts");
const {
  SPLIT_NAMES,
  planSettings,
  assembleWeek,
  withNextWeek,
  withWeek,
  moveSessions,
  weekTrainingDays,
  trainingWeekdays,
  planLength,
  isDeloadWeek,
  firstWeekStartsOn,
  weekStartsOn,
} = require("../utils/planSchedule");
const { askForJson } = require("./aiClient");
const { checkAiBudget, recordAiUsage } = require("./aiBudget");
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
function equipmentOf(user, criteria) {
  return equipmentTagsFor(criteria?.equipment ?? user.equipment);
}

const now = () => new Date().toISOString();

/** A logged workout as one line for a prompt: "Wed 2026-10-14 Bench Press: 60×10, 62.5×8". The name may be one the user typed, so it's cleaned. */
function workoutLine(w) {
  const sets = w.sets.map((x) => (x.weight ? `${x.weight}×${x.reps}` : `${x.reps}`)).join(", ");
  return `${withWeekday(dateKey(new Date(w.date)))} ${promptText(w.exercise, 100)}: ${sets}`;
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

/** Workouts dated from `since` ("YYYY-MM-DD") on, oldest first. */
function workoutsSince(userId, since) {
  return prisma.workout.findMany({
    where: { userId, deletedAt: null, date: { gte: new Date(`${since}T00:00:00Z`) } },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "asc" },
    take: 120,
  });
}

/** Everything logged in the 7 days up to `today`, one line each (for next-week adjustments). */
async function loggedLastWeek(userId, today = dateKey()) {
  return (await workoutsSince(userId, addDays(today, -7))).map(workoutLine);
}

/** Testing only (ALLOW_EARLY_NEXT_WEEK=true): start the next week before its Monday. */
const earlyNextWeekAllowed = () => process.env.ALLOW_EARLY_NEXT_WEEK === "true";

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
 * A new plan, written one week at a time: this makes week 1 on the server's
 * schedule (planSchedule), and "next week" adds each week after it.
 */
/** planSettings, with conservative intensity in Safe mode. */
function settingsFor(user, criteria) {
  const settings = planSettings(user, criteria);
  return safeModeOf(user) ? { ...settings, intensity: "conservative" } : settings;
}

/**
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

/* ─────────────────────────────────────────────────────────────
   Next week
───────────────────────────────────────────────────────────── */
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
    exerciseIds: allowedExerciseIds(equipment, avoidAreasOf(user)),
  });
  /** The AI's next week, checked ({ plan, swaps }), or null when it sent none or an unusable one. */
  const adjust = (reply) => {
    const days = changedDays(reply);
    const checked = days ? checkedWeekChange(planOnly, next, days, equipment, { onlyThisWeek: true, safeMode, avoid: avoidAreasOf(user) }) : null;
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
  const swapNote = checked ? goEasySwapNote(checked.swaps, avoidAreasOf(user)) : null;
  if (swapNote) message = `${message} ${swapNote}`;
  if (!adjusted) {
    adjusted = validateAndSanitizePlan(planOnly, equipment, { avoid: avoidAreasOf(user), fromWeek: next });
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

/* ─────────────────────────────────────────────────────────────
   Swap an exercise
───────────────────────────────────────────────────────────── */
/** Replaces one exercise everywhere in the plan with one the AI picks. `reason` is the user's, if they gave one. */
async function substituteExercise(user, planId, exerciseId, reason) {
  const plan = await findOwnPlan(user.id, planId);
  if (!planHasExercise(plan.planData, exerciseId)) {
    throw new HttpError(422, `Exercise "${exerciseId}" was not found in this plan.`);
  }
  // A danger sign in the reason ("sharp pain in my knee") gets the chat's fixed
  // safety reply instead of a swap, without the AI. It's kept in the coach chat.
  const sign = dangerSign(reason);
  if (sign) {
    console.warn(`[swap] danger sign (${sign.kind}) in the reason: no swap`);
    const asked = { role: "user", content: `Swap ${exerciseNameIn(plan.planData, exerciseId) ?? exerciseId}: ${reason}`, timestamp: now() };
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
    await askAi(prompt, {
      userId: user.id,
      maxTokens: 400,
      unavailable: "Couldn't find a replacement right now. Please try again in a moment.",
    }),
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
   Safe mode on a plan made before it
───────────────────────────────────────────────────────────── */
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
 * When the coach moves the active plan's training days ("make it 3 days a
 * week"), the profile follows, so Home, reminders and next week agree.
 * True when the profile changed. 1–6 days only, like the profile allows.
 */
async function followTrainingDays(user, days) {
  const weekdays = weekTrainingDays(days);
  if (weekdays.length === 0 || weekdays.length > 6 || weekdays.join() === trainingWeekdays(user).join()) return false;
  await prisma.user.update({ where: { id: user.id }, data: { trainingDays: weekdays, weeklyGoal: weekdays.length } });
  return true;
}

/** Identifies a plan's weeks as they stand, so a proposal can tell if the plan changed under it. */
function planFingerprint(planOnly, weekNumber) {
  return createHash("sha256").update(JSON.stringify({ weekNumber: weekNumber || 1, weeks: planOnly.weeks ?? [] })).digest("hex");
}

/**
 * Saves the plan only if nobody changed it since `plan` was read (a second
 * device, a double tap); otherwise a 409 so the user can try again on the latest.
 */
async function saveIfUnchanged(plan, data, conflictMessage) {
  const { count } = await prisma.plan.updateMany({ where: { id: plan.id, updatedAt: plan.updatedAt }, data });
  if (count === 0) throw new HttpError(409, conflictMessage);
}

/**
 * One message to the coach. When the reply changes the plan, nothing changes
 * yet: the change is saved as a proposal (planData._pendingChange) for the user
 * to apply or dismiss. A newer proposal replaces an older one. When applied, it
 * replaces this week and the ones after it (earlier weeks are history).
 * `today` is the user's date ("YYYY-MM-DD"); the server's is used without it.
 */
async function chatWithPlan(user, planId, userMessage, today = dateKey()) {
  const plan = await findOwnPlan(user.id, planId);
  const history = chatOf(plan.planData);
  const planOnly = withoutChat(plan.planData);

  // Danger signs get a fixed, careful reply instead of coaching, without the AI.
  const sign = dangerSign(userMessage);
  if (sign) {
    console.warn(`[planChat] danger sign (${sign.kind}): fixed safety reply`);
    const safetyReply = { role: "assistant", kind: "safety", content: sign.reply, timestamp: now() };
    const planData = withChat(planOnly, history, [{ role: "user", content: userMessage, timestamp: now() }, safetyReply], pendingChangeOf(plan.planData));
    await saveIfUnchanged(plan, { planData }, "Your plan changed while the coach was replying. Please send your message again.");
    return { message: sign.reply, planUpdated: false, proposal: null, profileUpdated: false, safety: true, chatHistory: planData._chatHistory, planData };
  }
  const equipment = equipmentOf(user, plan.criteria);
  const current = plan.weekNumber || 1;
  const thisWeek = planOnly.weeks?.[current - 1]?.days ?? [];
  const startsOn = weekStartsOn(plan);
  const lastWeek = planOnly.lastWeek?.startsOn ? planOnly.lastWeek : null;
  const since = [addDays(today, -7), startsOn, lastWeek?.startsOn].filter(Boolean).sort()[0];
  const workouts = await workoutsSince(user.id, since);
  const dated = workouts.map((w) => ({ date: dateKey(new Date(w.date)), exercise: w.exercise }));
  /** A plan week as the coach sees it: its dates and one line per training day. */
  const describeWeek = (number, days, monday) => ({
    number,
    range: `${withWeekday(monday)} to ${withWeekday(addDays(monday, 6))}`,
    lines: weekSoFar(days, dated, monday, today, dayShortName),
    over: today > addDays(monday, 6),
  });

  const prompt = buildPlanChatPrompt(compactWeek(planOnly, plan.weekNumber), history, userMessage, anonymizeIronArcProfile(user), {
    weeks: planLength(planOnly),
    weekNumber: plan.weekNumber,
    today: withWeekday(today),
    sessionsPerWeek: sessionsPerWeek(thisWeek),
    thisWeek: describeWeek(current, thisWeek, startsOn),
    lastWeek: lastWeek ? describeWeek(lastWeek.number, planOnly.weeks?.[lastWeek.number - 1]?.days ?? [], lastWeek.startsOn) : null,
    logged: workouts.filter((w) => dateKey(new Date(w.date)) >= addDays(today, -7)).map(workoutLine),
    exerciseIds: allowedExerciseIds(equipment, avoidAreasOf(user)),
    ruledOut: ruledOutIn(thisWeek, avoidAreasOf(user)),
  });
  const unavailable = "The coach couldn't answer right now. Please try again in a moment.";
  const raw = await askAi(prompt, { userId: user.id, maxTokens: 3000, unavailable });

  // No usable message is the same as no answer. A malformed or unsafe change
  // must not lose the reply: the plan stays as it was and the reply says so.
  let message = aiText(raw?.message, 700);
  if (!message) throw new HttpError(503, unavailable);
  // A reply that quotes the coach's instructions, or goes beyond general nutrition
  // guidance (a calorie target, a dose, drugs), is replaced, with no change.
  const replacement = leaksInstructions(message) ? LEAK_REPLY : outOfScope(message) ? NUTRITION_REPLY : null;
  if (replacement) {
    console.warn("[planChat] reply replaced by a guard");
    message = replacement;
  }
  const replaced = !!replacement;
  const reply = replaced ? null : parseReply(weekChangeReply, raw);
  let changedPlan = null;
  const days = reply ? changedDays(reply) : null;
  if (days) {
    const checked = checkedWeekChange(planOnly, plan.weekNumber, days, equipment, { safeMode: safeModeOf(user), avoid: avoidAreasOf(user) });
    if (checked.plan) {
      changedPlan = checked.plan;
      const note = goEasySwapNote(checked.swaps, avoidAreasOf(user));
      if (note) message = `${message} ${note}`;
    } else if (checked.problems.includes("too big a jump")) {
      console.warn("[planChat] Safe mode: AI change added too much at once; keeping the current plan");
      message = `${message} (I kept your plan as it was: in Safe mode, a change can only add a little training at a time.)`;
    } else if (checked.problems.includes("no rest day")) {
      console.warn("[planChat] AI change left no rest day; keeping the current plan");
      message = `${message} (I kept your plan as it was: every week needs at least one rest day.)`;
    } else {
      console.warn("[planChat] AI returned an invalid week; keeping the current plan");
      message = `${message} (I couldn't apply that change to your plan this time. Try asking for one change at a time.)`;
    }
  } else if (!reply && !replaced && Array.isArray(raw?.modifiedDays) && raw.modifiedDays.length > 0) {
    console.warn("[planChat] AI returned a malformed week; keeping the current plan");
    message = `${message} (I couldn't apply that change to your plan this time. Try asking for one change at a time.)`;
  }

  // A change becomes a proposal; an answer keeps any proposal still waiting.
  const waiting = pendingChangeOf(plan.planData);
  let pending = waiting;
  let chat = history;
  let changes;
  if (changedPlan) {
    changes = diffPlanWeek(planOnly, changedPlan, plan.weekNumber);
    pending = { id: randomUUID(), weekNumber: plan.weekNumber || 1, basedOn: planFingerprint(planOnly, plan.weekNumber), weeks: changedPlan.weeks, createdAt: now() };
    if (waiting) chat = settleProposal(history, waiting.id, "replaced");
  }
  const coachReply = {
    role: "assistant",
    content: message,
    timestamp: now(),
    ...(changedPlan ? { proposal: { id: pending.id, status: "pending" }, changes } : {}),
  };
  const planData = withChat(planOnly, chat, [{ role: "user", content: userMessage, timestamp: now() }, coachReply], pending);
  await saveIfUnchanged(plan, { planData }, "Your plan changed while the coach was replying. Please send your message again.");

  return {
    message,
    planUpdated: false,
    proposal: changedPlan ? { id: pending.id, changes } : null,
    profileUpdated: false,
    chatHistory: planData._chatHistory,
    planData,
  };
}

/** The proposal the user asked for, or a 409 when it's gone (applied, dismissed, replaced or expired). */
function proposalFor(plan, proposalId) {
  const pending = pendingChangeOf(plan.planData);
  if (!pending || pending.id !== proposalId) throw new HttpError(409, "This suggestion is no longer available. Ask the coach again.");
  return pending;
}

/**
 * Applies the coach's proposal, checked again first: it must be for the plan
 * as it is now (no swap or next week since) and still pass the plan limits.
 * Otherwise it's marked out of date and nothing changes (409). When the active
 * plan's training days move, the profile follows.
 */
async function applyProposal(user, planId, proposalId) {
  const plan = await findOwnPlan(user.id, planId);
  const pending = proposalFor(plan, proposalId);
  const planOnly = withoutChat(plan.planData);
  const history = chatOf(plan.planData);
  const week = plan.weekNumber || 1;

  let applied = null;
  if (pending.basedOn === planFingerprint(planOnly, plan.weekNumber)) {
    try {
      const candidate = validateAndSanitizePlan({ ...planOnly, weeks: pending.weeks }, equipmentOf(user, plan.criteria), { avoid: avoidAreasOf(user), fromWeek: week });
      if (weekProblems(candidate.weeks?.[week - 1]?.days).length === 0) applied = candidate;
    } catch {
      applied = null;
    }
  }
  if (!applied) {
    await saveIfUnchanged(plan, { planData: withChat(planOnly, settleProposal(history, proposalId, "expired"), []) }, "Your plan changed just now. Please try again.");
    throw new HttpError(409, "Your plan changed since this suggestion, so it wasn't applied. Ask the coach again.");
  }

  const planData = withChat(applied, settleProposal(history, proposalId, "applied"), []);
  await saveIfUnchanged(plan, { planData }, "Your plan changed just now. Please try again.");
  const profileUpdated = plan.isActive ? await followTrainingDays(user, applied.weeks?.[week - 1]?.days) : false;
  return { planData, chatHistory: planData._chatHistory, profileUpdated };
}

/** Leaves the plan as it is; the proposal's chat entry says it wasn't applied. */
async function dismissProposal(user, planId, proposalId) {
  const plan = await findOwnPlan(user.id, planId);
  proposalFor(plan, proposalId);
  const planData = withChat(withoutChat(plan.planData), settleProposal(chatOf(plan.planData), proposalId, "dismissed"), []);
  await saveIfUnchanged(plan, { planData }, "Your plan changed just now. Please try again.");
  return { planData, chatHistory: planData._chatHistory };
}

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
