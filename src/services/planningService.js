const { prisma } = require("../config/database");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { validateAndSanitizePlan } = require("../utils/planValidator");
const { compactWeek, applyWeekChange } = require("../utils/planChat");
const { diffPlanWeek } = require("../utils/planDiff");
const { EXERCISE_DB, isValidExerciseId, getSubstituteExerciseId } = require("../utils/exerciseDatabase");
const {
  callGroqWithRetry,
  buildGeneratePlanPrompt,
  buildNextWeekPrompt,
  buildSubstitutePrompt,
  buildPlanChatPrompt,
} = require("./groqService");
const { evaluateAchievementsSafely } = require("./achievementService");

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */
async function fetchUserProfile(firebaseUid) {
  const user = await prisma.user.findUnique({ where: { firebaseUid } });
  if (!user) throw new Error("PROFILE_NOT_FOUND");
  return user;
}

async function fetchRecentWorkouts(userId, limit = 5) {
  const workouts = await prisma.workout.findMany({
    where: { userId, deletedAt: null },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "desc" },
    take: limit,
  });
  return workouts.map(({ userId: _, ...safeData }) => safeData);
}

/** Chat log kept inside planData (no schema migration); last 40 entries. */
const CHAT_HISTORY_MAX = 40;
const chatHistoryOf = (planData) => (Array.isArray(planData?._chatHistory) ? planData._chatHistory : []);
const withHistory = (planData, entries) => ({
  ...planData,
  _chatHistory: [...chatHistoryOf(planData), ...entries].slice(-CHAT_HISTORY_MAX),
});

/** Logged sets from the last 7 days, one compact line per exercise per day (for next-week adjustments). */
async function loggedLastWeek(userId) {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const workouts = await prisma.workout.findMany({
    where: { userId, deletedAt: null, date: { gte: since } },
    include: { sets: { orderBy: { setNumber: "asc" } } },
    orderBy: { date: "asc" },
    take: 60,
  });
  return workouts.map((w) => {
    const day = new Date(w.date).toISOString().slice(0, 10);
    const sets = w.sets.map((x) => (x.weight ? `${x.weight}×${x.reps}` : `${x.reps}`)).join(", ");
    return `${day} ${w.exercise}: ${sets}`;
  });
}

/** Strip planData from plan record for list views — keeps payload small */
function stripPlanData(plan) {
  const { planData, ...meta } = plan;
  return meta;
}

/* ─────────────────────────────────────────────────────────────
   Read operations
───────────────────────────────────────────────────────────── */
async function listPlans(firebaseUid) {
  const user = await fetchUserProfile(firebaseUid);
  const plans = await prisma.plan.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
  });
  return plans.map(stripPlanData);
}

async function getPlanById(firebaseUid, planId) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  return plan ?? null;
}

/* ─────────────────────────────────────────────────────────────
   Generate
───────────────────────────────────────────────────────────── */
async function generatePlan(firebaseUid, criteria = {}) {
  const user = await fetchUserProfile(firebaseUid);
  const anonymized = anonymizeIronArcProfile(user, user.id);
  const recentWorkouts = await fetchRecentWorkouts(user.id, 5);

  const prompt = buildGeneratePlanPrompt(anonymized, recentWorkouts, criteria);
  const rawPlan = await callGroqWithRetry(prompt);
  const validatedPlan = validateAndSanitizePlan(rawPlan, []);

  const plan = await prisma.$transaction(async (tx) => {
    const existingCount = await tx.plan.count({ where: { userId: user.id } });
    const splitLabel = criteria.splitPreference
      ? criteria.splitPreference.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : "My Plan";
    const planName = existingCount === 0 ? splitLabel : `${splitLabel} ${existingCount + 1}`;

    await tx.plan.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false },
    });

    return tx.plan.create({
      data: {
        userId: user.id,
        name: planName,
        criteria,
        planData: {
          ...validatedPlan,
          generatedAt: new Date().toISOString(),
          weekNumber: 1,
          status: "active",
        },
        isActive: true,
        weekNumber: 1,
      },
    });
  });

  // Append-only generation log for the "plans generated" badges (plans can be
  // deleted). Outside the transaction and best-effort, so a missing
  // plan_generations table (migration not yet applied) never fails generation.
  try {
    await prisma.planGeneration.create({ data: { userId: user.id } });
  } catch (error) {
    console.warn(`[planning] Could not record plan generation: ${error.message}`);
  }

  const newlyUnlocked = await evaluateAchievementsSafely(user.id, "plan");
  return { plan, newlyUnlocked };
}

/* ─────────────────────────────────────────────────────────────
   Recalibrate
───────────────────────────────────────────────────────────── */
/**
 * "Next week": moves the plan to its next week and tunes that week to what the
 * user logged in the last 7 days. Later weeks stay as planned. The change is
 * recorded in the coach chat so it can be found later.
 */
async function recalibratePlan(firebaseUid, planId) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  const planData = plan.planData ?? {};
  const weekCount = Array.isArray(planData.weeks) ? planData.weeks.length : 1;
  const current = plan.weekNumber || 1;
  if (current >= weekCount) throw new Error("PLAN_FINISHED");
  const next = current + 1;

  const anonymized = anonymizeIronArcProfile(user, user.id);
  const logged = await loggedLastWeek(user.id);
  const { _chatHistory: _omit, ...planForPrompt } = planData;
  const prompt = buildNextWeekPrompt(compactWeek(planForPrompt, current), compactWeek(planForPrompt, next), logged, anonymized, {
    weekNumber: current,
  });
  console.log(`[nextWeek] prompt ${prompt.length} chars · week ${current} → ${next} · ${logged.length} logged line(s)`);

  let response;
  try {
    response = await callGroqWithRetry(prompt, 2, { maxTokens: 3000 });
  } catch (error) {
    console.warn(`[nextWeek] AI call failed: ${error.message}`);
    throw new Error("AI_UNAVAILABLE");
  }

  let adjusted = Array.isArray(response?.modifiedDays) && response.modifiedDays.length > 0
    ? applyWeekChange(planForPrompt, next, response.modifiedDays, { onlyThisWeek: true })
    : planForPrompt;
  let message = response?.message || `Week ${next} is ready.`;
  try {
    adjusted = validateAndSanitizePlan(adjusted, []);
  } catch {
    console.warn("[nextWeek] AI returned an invalid week; keeping next week as planned");
    adjusted = validateAndSanitizePlan(planForPrompt, []);
    message = `Week ${next} is ready, as planned. (I couldn't adjust it from your log this time.)`;
  }

  const changes = diffPlanWeek(planForPrompt, adjusted, next);
  // The earlier chat stays (the prompt copy left it out), plus a note of this change.
  const updatedPlanData = withHistory(
    { ...adjusted, _chatHistory: chatHistoryOf(planData), weekNumber: next, lastRecalibratedAt: new Date().toISOString(), status: "active" },
    [{ role: "assistant", kind: "nextWeek", content: `Moved to week ${next}. ${message}`, timestamp: new Date().toISOString(), planUpdated: true, changes }],
  );

  return prisma.plan.update({
    where: { id: planId },
    data: { planData: updatedPlanData, weekNumber: next },
  });
}

/* ─────────────────────────────────────────────────────────────
   Substitute exercise — helpers
───────────────────────────────────────────────────────────── */

/**
 * Walk the plan JSON and swap out one exercise by id/name.
 * Returns the modified plan clone plus a flag indicating whether
 * the exercise was actually found and replaced.
 */
function applySubstitution(planData, oldExerciseId, substitute) {
  const updated = JSON.parse(JSON.stringify(planData));
  let applied = false;

  const swapInList = (exercises) => {
    if (!Array.isArray(exercises)) return;
    for (let i = 0; i < exercises.length; i++) {
      const ex = exercises[i];
      const id = ex.exerciseId ?? ex.id ?? "";
      if (
        id === oldExerciseId ||
        ex.name === oldExerciseId ||
        (typeof id === "string" && typeof oldExerciseId === "string" &&
          id.toLowerCase() === oldExerciseId.toLowerCase())
      ) {
        exercises[i] = {
          ...ex,
          exerciseId: substitute.substituteExerciseId,
          id: substitute.substituteExerciseId,
          name: substitute.substituteName,
          substitutedFrom: id || ex.name,
          substitutionReason: substitute.reason,
        };
        applied = true;
      }
    }
  };

  if (Array.isArray(updated.weeks)) {
    for (const week of updated.weeks) {
      for (const day of week.days ?? []) swapInList(day.exercises);
    }
  } else {
    for (const day of updated.days ?? []) swapInList(day.exercises);
  }

  return { updatedPlanData: updated, applied };
}

/** The plan's display name for an exercise id (first match). */
function findExerciseName(planData, exerciseId) {
  for (const week of planData?.weeks ?? []) {
    for (const day of week.days ?? []) {
      const hit = (day.exercises ?? []).find((e) => e.exerciseId === exerciseId || e.id === exerciseId);
      if (hit?.name) return hit.name;
    }
  }
  return null;
}

/* ─────────────────────────────────────────────────────────────
   Substitute exercise
───────────────────────────────────────────────────────────── */
async function substituteExercise(firebaseUid, planId, exerciseId, reason) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  const anonymized = anonymizeIronArcProfile(user, user.id);
  const prompt = buildSubstitutePrompt(exerciseId, reason, anonymized);
  let rawSubstitute;
  try {
    rawSubstitute = await callGroqWithRetry(prompt, 2, { maxTokens: 400 });
  } catch (error) {
    console.warn(`[swap] AI call failed: ${error.message}`);
    throw new Error("AI_UNAVAILABLE");
  }
  const fallbackExerciseId = getSubstituteExerciseId(exerciseId, []);
  const substituteExerciseId = isValidExerciseId(rawSubstitute?.substituteExerciseId)
    ? rawSubstitute.substituteExerciseId
    : fallbackExerciseId;
  const substitute = {
    ...rawSubstitute,
    substituteExerciseId,
    substituteName: EXERCISE_DB[substituteExerciseId].name,
    reason: rawSubstitute?.reason || reason || "Exercise substitution",
  };

  // Apply the substitution to the actual plan data
  const { updatedPlanData, applied } = applySubstitution(plan.planData, exerciseId, substitute);

  if (!applied) {
    return { plan, substitute, applied: false };
  }

  const validatedPlanData = validateAndSanitizePlan(updatedPlanData, []);
  const oldName = findExerciseName(plan.planData, exerciseId) || exerciseId;
  const changes = diffPlanWeek(plan.planData, validatedPlanData, plan.weekNumber);
  const note = {
    role: "assistant",
    kind: "swap",
    content: `Swapped ${oldName} for ${substitute.substituteName}${reason ? ` (you said: "${reason}")` : ""}.`,
    timestamp: new Date().toISOString(),
    planUpdated: true,
    changes,
  };

  const updatedPlan = await prisma.plan.update({
    where: { id: planId },
    data: { planData: withHistory(validatedPlanData, [note]) },
  });

  return {
    plan: updatedPlan,
    substitute,
    applied,
  };
}

/* ─────────────────────────────────────────────────────────────
   Rename
───────────────────────────────────────────────────────────── */
async function renamePlan(firebaseUid, planId, name) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  return await prisma.plan.update({
    where: { id: planId },
    data: { name },
  });
}

/* ─────────────────────────────────────────────────────────────
   Activate
───────────────────────────────────────────────────────────── */
async function activatePlan(firebaseUid, planId) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  return prisma.$transaction(async (tx) => {
    await tx.plan.updateMany({
      where: { userId: user.id, isActive: true },
      data: { isActive: false },
    });

    return tx.plan.update({
      where: { id: planId },
      data: { isActive: true },
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   Delete
───────────────────────────────────────────────────────────── */
async function deletePlan(firebaseUid, planId) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  await prisma.$transaction(async (tx) => {
    await tx.plan.delete({ where: { id: planId } });

    if (plan.isActive) {
      const next = await tx.plan.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
      });
      if (next) {
        await tx.plan.update({
          where: { id: next.id },
          data: { isActive: true },
        });
      }
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   Chat with plan
───────────────────────────────────────────────────────────── */
async function chatWithPlan(firebaseUid, planId, userMessage) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  // Chat history is stored inside planData._chatHistory to avoid a schema migration
  const existingPlanData = plan.planData ?? {};
  const history = Array.isArray(existingPlanData._chatHistory)
    ? existingPlanData._chatHistory
    : [];

  const anonymized = anonymizeIronArcProfile(user, user.id);

  // Build prompt from plan data without the internal _chatHistory key
  const { _chatHistory: _omit, ...planDataForPrompt } = existingPlanData;
  const weeks = Array.isArray(planDataForPrompt.weeks) ? planDataForPrompt.weeks.length : 0;
  const prompt = buildPlanChatPrompt(compactWeek(planDataForPrompt, plan.weekNumber), history, userMessage, anonymized, {
    weeks,
    weekNumber: plan.weekNumber,
  });
  console.log(`[planChat] prompt ${prompt.length} chars · plan ${weeks} week(s) · history ${history.length} messages`);
  let response;
  try {
    response = await callGroqWithRetry(prompt, 2, { maxTokens: 3000 });
    console.log(
      `[planChat] AI reply keys: ${Object.keys(response || {}).join(", ") || "(none)"} · modifiedDays: ${
        Array.isArray(response?.modifiedDays) ? `${response.modifiedDays.length} day(s)` : "null"
      }`,
    );
  } catch (error) {
    console.warn(`[planChat] AI call failed: ${error.message}`);
    throw new Error("AI_UNAVAILABLE");
  }

  let aiMessage = response?.message ?? "I've processed your request.";
  // The changed week, applied to the current and later weeks (older replies may still send a full plan).
  let modifiedPlan = Array.isArray(response?.modifiedDays) && response.modifiedDays.length > 0
    ? applyWeekChange(planDataForPrompt, plan.weekNumber, response.modifiedDays)
    : response?.modifiedPlan ?? null;

  // A malformed or cut-off plan from the AI must not lose the reply: keep the
  // current plan and say the change couldn't be applied.
  if (modifiedPlan) {
    try {
      validateAndSanitizePlan(modifiedPlan, []);
    } catch {
      console.warn(`[planChat] AI returned an invalid plan (keys: ${Object.keys(modifiedPlan).join(", ")}); keeping the current one`);
      modifiedPlan = null;
      aiMessage = `${aiMessage} (I couldn't apply that change to your plan this time. Try asking for one change at a time.)`;
    }
  }

  // Merge: use AI-modified plan structure if provided, then embed history
  const basePlanData = modifiedPlan ?? existingPlanData;
  const validatedPlanData = validateAndSanitizePlan(basePlanData, []);
  const changes = modifiedPlan ? diffPlanWeek(planDataForPrompt, validatedPlanData, plan.weekNumber) : undefined;

  // Append to chat history (keep the last 40 entries to avoid bloat)
  const newHistory = [
    ...history,
    { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    {
      role: "assistant",
      content: aiMessage,
      timestamp: new Date().toISOString(),
      ...(modifiedPlan ? { planUpdated: true, changes } : {}),
    },
  ].slice(-CHAT_HISTORY_MAX);
  const updatedPlanData = {
    ...validatedPlanData,
    _chatHistory: newHistory,
  };

  await prisma.plan.update({
    where: { id: planId },
    data: { planData: updatedPlanData },
  });
  console.log(`[planChat] saved · planUpdated=${Boolean(modifiedPlan)} · history now ${newHistory.length}`);

  return {
    message: aiMessage,
    planUpdated: Boolean(modifiedPlan),
    chatHistory: newHistory,
    planData: updatedPlanData,
  };
}

module.exports = {
  generatePlan,
  recalibratePlan,
  substituteExercise,
  listPlans,
  getPlanById,
  renamePlan,
  activatePlan,
  deletePlan,
  chatWithPlan,
};
