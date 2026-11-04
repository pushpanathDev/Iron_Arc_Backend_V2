const { createHash, randomUUID } = require("node:crypto");
const { prisma } = require("../../config/database");
const { HttpError } = require("../../utils/httpError");
const { anonymizeIronArcProfile } = require("../../utils/anonymizer");
const { safeModeOf } = require("../../utils/healthCheck");
const { dangerSign, outOfScope, leaksInstructions, NUTRITION_REPLY, LEAK_REPLY } = require("../../utils/safetyTriage");
const { validateAndSanitizePlan, weekProblems } = require("../../utils/planValidator");
const { aiText } = require("../../utils/aiText");
const { weekChangeReply, parseReply } = require("../../utils/aiReplies");
const { compactWeek, changedDays, chatOf, withoutChat, withChat, weekSoFar, pendingChangeOf, settleProposal } = require("../../utils/planChat");
const { diffPlanWeek, dayShortName } = require("../../utils/planDiff");
const { dateKey, addDays, withWeekday } = require("../../utils/dates");
const { avoidAreasOf, allowedExerciseIds, ruledOutIn, goEasySwapNote } = require("../../utils/exerciseDatabase");
const { buildPlanChatPrompt } = require("../../utils/planPrompts");
const { weekTrainingDays, trainingWeekdays, planLength, weekStartsOn } = require("../../utils/planSchedule");
const { now, findOwnPlan, askAi, equipmentOf, workoutLine, workoutsSince, checkedWeekChange } = require("./shared");

/*
 * The plan coach. A reply that changes the plan doesn't change it yet: the
 * change waits as a proposal (planData._pendingChange) until the user applies
 * or dismisses it. A newer proposal replaces an older one.
 */

const CHANGED_WHILE_REPLYING = "Your plan changed while the coach was replying. Please send your message again.";
const CHANGED_JUST_NOW = "Your plan changed just now. Please try again.";

/** "Push ×2, Pull ×2, Legs ×2 (6 training days)": how often each session runs in a week. */
function sessionsPerWeek(days) {
  const training = days.filter((d) => d.sessionType !== "rest" && d.exercises?.length > 0);
  const counts = new Map();
  for (const day of training) counts.set(dayShortName(day), (counts.get(dayShortName(day)) ?? 0) + 1);
  return `${[...counts].map(([name, n]) => `${name} ×${n}`).join(", ")} (${training.length} training days)`;
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

/**
 * One message to the coach. A change in the reply is saved as a proposal;
 * when applied, it replaces this week and the ones after it (earlier weeks
 * are history). `today` is the user's date ("YYYY-MM-DD"); the server's is
 * used without it.
 */
async function chatWithPlan(user, planId, userMessage, today = dateKey()) {
  const plan = await findOwnPlan(user.id, planId);
  const history = chatOf(plan.planData);
  const planOnly = withoutChat(plan.planData);
  const asked = { role: "user", content: userMessage, timestamp: now() };

  // Danger signs get a fixed, careful reply instead of coaching, without the AI.
  const sign = dangerSign(userMessage);
  if (sign) {
    console.warn(`[planChat] danger sign (${sign.kind}): fixed safety reply`);
    const safetyReply = { role: "assistant", kind: "safety", content: sign.reply, timestamp: now() };
    const planData = withChat(planOnly, history, [asked, safetyReply], pendingChangeOf(plan.planData));
    await saveIfUnchanged(plan, { planData }, CHANGED_WHILE_REPLYING);
    return { message: sign.reply, planUpdated: false, proposal: null, profileUpdated: false, safety: true, chatHistory: planData._chatHistory, planData };
  }

  // What the coach is told: this week and last, so far, and the last 7 days' log.
  const equipment = equipmentOf(user, plan.criteria);
  const avoid = avoidAreasOf(user);
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
    exerciseIds: allowedExerciseIds(equipment, avoid),
    ruledOut: ruledOutIn(thisWeek, avoid),
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
  const reply = replacement ? null : parseReply(weekChangeReply, raw);
  let changedPlan = null;
  const days = reply ? changedDays(reply) : null;
  if (days) {
    const checked = checkedWeekChange(planOnly, plan.weekNumber, days, equipment, { safeMode: safeModeOf(user), avoid });
    if (checked.plan) {
      changedPlan = checked.plan;
      const note = goEasySwapNote(checked.swaps, avoid);
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
  } else if (!reply && !replacement && Array.isArray(raw?.modifiedDays) && raw.modifiedDays.length > 0) {
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
    pending = { id: randomUUID(), weekNumber: current, basedOn: planFingerprint(planOnly, plan.weekNumber), weeks: changedPlan.weeks, createdAt: now() };
    if (waiting) chat = settleProposal(history, waiting.id, "replaced");
  }
  const coachReply = {
    role: "assistant",
    content: message,
    timestamp: now(),
    ...(changedPlan ? { proposal: { id: pending.id, status: "pending" }, changes } : {}),
  };
  const planData = withChat(planOnly, chat, [asked, coachReply], pending);
  await saveIfUnchanged(plan, { planData }, CHANGED_WHILE_REPLYING);

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
    await saveIfUnchanged(plan, { planData: withChat(planOnly, settleProposal(history, proposalId, "expired"), []) }, CHANGED_JUST_NOW);
    throw new HttpError(409, "Your plan changed since this suggestion, so it wasn't applied. Ask the coach again.");
  }

  const planData = withChat(applied, settleProposal(history, proposalId, "applied"), []);
  await saveIfUnchanged(plan, { planData }, CHANGED_JUST_NOW);
  const profileUpdated = plan.isActive ? await followTrainingDays(user, applied.weeks?.[week - 1]?.days) : false;
  return { planData, chatHistory: planData._chatHistory, profileUpdated };
}

/** Leaves the plan as it is; the proposal's chat entry says it wasn't applied. */
async function dismissProposal(user, planId, proposalId) {
  const plan = await findOwnPlan(user.id, planId);
  proposalFor(plan, proposalId);
  const planData = withChat(withoutChat(plan.planData), settleProposal(chatOf(plan.planData), proposalId, "dismissed"), []);
  await saveIfUnchanged(plan, { planData }, CHANGED_JUST_NOW);
  return { planData, chatHistory: planData._chatHistory };
}

module.exports = { chatWithPlan, applyProposal, dismissProposal };
