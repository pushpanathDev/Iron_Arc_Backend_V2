const { prisma } = require("../config/database");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { validateAndSanitizePlan } = require("../utils/planValidator");
const {
  callGeminiWithRetry,
  buildGeneratePlanPrompt,
  buildRecalibratePlanPrompt,
  buildSubstitutePrompt,
  buildPlanChatPrompt,
} = require("./geminiService");

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
  return plans;
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
  const rawPlan = await callGeminiWithRetry(prompt);
  const validatedPlan = validateAndSanitizePlan(rawPlan, []);

  // Auto-name based on split preference and count
  const existingCount = await prisma.plan.count({ where: { userId: user.id } });
  const splitLabel = criteria.splitPreference
    ? criteria.splitPreference.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "My Plan";
  const planName = existingCount === 0 ? splitLabel : `${splitLabel} ${existingCount + 1}`;

  // Deactivate all existing plans
  await prisma.plan.updateMany({
    where: { userId: user.id, isActive: true },
    data: { isActive: false },
  });

  // Create new Plan record
  const planRecord = await prisma.plan.create({
    data: {
      userId: user.id,
      name: planName,
      criteria: criteria,
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

  // Mirror to user.activePlan for profile API backwards-compat
  await prisma.user.update({
    where: { firebaseUid },
    data: { activePlan: planRecord.planData },
  });

  return planRecord;
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

  const rawPlan = await callGeminiWithRetry(prompt);
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

  // Mirror to user.activePlan if this is the active plan
  if (plan.isActive) {
    await prisma.user.update({
      where: { firebaseUid },
      data: { activePlan: updatedPlanData },
    });
  }

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
        id.toLowerCase() === oldExerciseId.toLowerCase()
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
  const substitute = await callGeminiWithRetry(prompt);

  // Apply the substitution to the actual plan data
  const { updatedPlanData, applied } = applySubstitution(plan.planData, exerciseId, substitute);

  const updatedPlan = await prisma.plan.update({
    where: { id: planId },
    data: { planData: updatedPlanData },
  });

  // Mirror to user.activePlan if this is the active plan
  if (plan.isActive) {
    await prisma.user.update({
      where: { firebaseUid },
      data: { activePlan: updatedPlanData },
    });
  }

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

  // Deactivate all others
  await prisma.plan.updateMany({
    where: { userId: user.id, isActive: true },
    data: { isActive: false },
  });

  const activated = await prisma.plan.update({
    where: { id: planId },
    data: { isActive: true },
  });

  // Mirror to user.activePlan
  await prisma.user.update({
    where: { firebaseUid },
    data: { activePlan: activated.planData },
  });

  return activated;
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

  await prisma.plan.delete({ where: { id: planId } });

  // If it was the active plan, clear user.activePlan
  if (plan.isActive) {
    // Try to activate the most recently created remaining plan
    const next = await prisma.plan.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
    });
    await prisma.user.update({
      where: { firebaseUid },
      data: { activePlan: next ? next.planData : null },
    });
    if (next) {
      await prisma.plan.update({
        where: { id: next.id },
        data: { isActive: true },
      });
    }
  }
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
  const response = await callGeminiWithRetry(prompt);

  const aiMessage = response?.message ?? "I've processed your request.";
  const modifiedPlan = response?.modifiedPlan ?? null;

  // Append to chat history (keep last 40 messages to avoid bloat)
  const newHistory = [
    ...history,
    { role: "user", content: userMessage, timestamp: new Date().toISOString() },
    { role: "assistant", content: aiMessage, timestamp: new Date().toISOString() },
  ].slice(-40);

  // Merge: use AI-modified plan structure if provided, then embed history
  const basePlanData = modifiedPlan ?? existingPlanData;
  const updatedPlanData = {
    ...basePlanData,
    _chatHistory: newHistory,
  };

  await prisma.plan.update({
    where: { id: planId },
    data: { planData: updatedPlanData },
  });

  // Mirror to user.activePlan if this is the active plan
  if (plan.isActive && modifiedPlan) {
    await prisma.user.update({
      where: { firebaseUid },
      data: { activePlan: updatedPlanData },
    });
  }

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
