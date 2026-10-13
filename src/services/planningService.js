const { prisma } = require("../config/database");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { validateAndSanitizePlan } = require("../utils/planValidator");
const { EXERCISE_DB, isValidExerciseId, getSubstituteExerciseId } = require("../utils/exerciseDatabase");
const {
  callGroqWithRetry,
  buildGeneratePlanPrompt,
  buildRecalibratePlanPrompt,
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
async function recalibratePlan(firebaseUid, planId) {
  const user = await fetchUserProfile(firebaseUid);
  const plan = await prisma.plan.findFirst({
    where: { id: planId, userId: user.id },
  });
  if (!plan) throw new Error("PLAN_NOT_FOUND");

  const anonymized = anonymizeIronArcProfile(user, user.id);
  const recentWorkouts = await fetchRecentWorkouts(user.id, 7);

  const prompt = buildRecalibratePlanPrompt(
    anonymized,
    plan.planData,
    recentWorkouts,
  );

  const rawPlan = await callGroqWithRetry(prompt);
  const validatedPlan = validateAndSanitizePlan(rawPlan, []);

  const updatedPlanData = {
    ...validatedPlan,
    weekNumber: (plan.weekNumber || 1) + 1,
    lastRecalibratedAt: new Date().toISOString(),
    status: "active",
  };

  const updated = await prisma.plan.update({
    where: { id: planId },
    data: {
      planData: updatedPlanData,
      weekNumber: (plan.weekNumber || 1) + 1,
    },
  });

  return updated;
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
  const rawSubstitute = await callGroqWithRetry(prompt);
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

  const updatedPlan = await prisma.plan.update({
    where: { id: planId },
    data: { planData: validatedPlanData },
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
  const prompt = buildPlanChatPrompt(planDataForPrompt, history, userMessage, anonymized);
  let response;
  try {
    response = await callGroqWithRetry(prompt);
  } catch (error) {
    console.warn(`[planChat] AI call failed: ${error.message}`);
    throw new Error("AI_UNAVAILABLE");
  }

  let aiMessage = response?.message ?? "I've processed your request.";
  let modifiedPlan = response?.modifiedPlan ?? null;

  // A malformed or cut-off plan from the AI must not lose the reply: keep the
  // current plan and say the change couldn't be applied.
  if (modifiedPlan) {
    try {
      validateAndSanitizePlan(modifiedPlan, []);
    } catch {
      console.warn("[planChat] AI returned an invalid plan; keeping the current one");
      modifiedPlan = null;
      aiMessage = `${aiMessage} (I couldn't apply that change to your plan this time. Try asking for one change at a time.)`;
    }
  }

  // Append to chat history (keep last 40 messages to avoid bloat)
  const newHistory = [
    ...history,
    { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    { role: "assistant", content: aiMessage, timestamp: new Date().toISOString() },
  ].slice(-40);

  // Merge: use AI-modified plan structure if provided, then embed history
  const basePlanData = modifiedPlan ?? existingPlanData;
  const validatedPlanData = validateAndSanitizePlan(basePlanData, []);
  const updatedPlanData = {
    ...validatedPlanData,
    _chatHistory: newHistory,
  };

  await prisma.plan.update({
    where: { id: planId },
    data: { planData: updatedPlanData },
  });

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
