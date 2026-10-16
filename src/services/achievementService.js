const { prisma } = require("../config/database");
const {
  TRIGGER_EVENTS,
  ACHIEVEMENT_DEFINITIONS,
  CATALOG_KEYS,
  toPublicDefinition,
} = require("../utils/achievementDefinitions");
const {
  METRIC_SOURCE,
  computeWorkoutMetrics,
  computeWeightMetrics,
  evaluateDefinitions,
} = require("../utils/achievementEvaluator");

/**
 * Server "today" for the current-streak display. The server does not know
 * the user's timezone; the evaluator treats a workout dated today or
 * yesterday as keeping the streak alive, which absorbs positive offsets.
 */
function serverTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function sourcesFor(definitions) {
  const sources = new Set();
  for (const def of definitions) {
    sources.add(METRIC_SOURCE[def.metric]);
    if (def.progressMetric) sources.add(METRIC_SOURCE[def.progressMetric]);
  }
  return sources;
}

/**
 * Plans ever generated: the append-only log (plans can be deleted), or the
 * plans that exist if that's more (plans made before the log was added).
 */
async function countPlansGenerated(db, userId) {
  const [generated, existingPlans] = await Promise.all([
    db.planGeneration.count({ where: { userId } }),
    db.plan.count({ where: { userId } }),
  ]);
  return Math.max(generated, existingPlans);
}

/** Days per week for the weekly streak: chosen training days, else the weekly goal (max 6). */
async function weeklyGoalOf(db, userId) {
  try {
    const user = await db.user.findUnique({ where: { id: userId }, select: { weeklyGoal: true, trainingDays: true } });
    const days = user?.trainingDays?.length || user?.weeklyGoal || 3;
    return Math.min(6, Math.max(1, days));
  } catch {
    return 3;
  }
}

/** Load only the data the given definitions need, using non-deleted rows. */
async function loadMetrics(db, userId, definitions) {
  const sources = sourcesFor(definitions);
  const metrics = {};

  if (sources.has("workout")) {
    const goal = await weeklyGoalOf(db, userId);
    const workouts = await db.workout.findMany({
      where: { userId, deletedAt: null },
      select: {
        date: true,
        createdAt: true,
        exercise: true,
        category: true,
        sets: { select: { reps: true, weight: true } },
      },
    });
    Object.assign(metrics, computeWorkoutMetrics(workouts, serverTodayKey(), goal));
  }

  if (sources.has("weight")) {
    const entries = await db.bodyWeight.findMany({
      where: { userId, deletedAt: null },
      select: { date: true },
    });
    Object.assign(metrics, computeWeightMetrics(entries));
  }

  if (sources.has("custom_exercise")) {
    metrics.customExercises = await db.customExercise.count({ where: { userId } });
  }

  if (sources.has("plan")) {
    metrics.plansGenerated = await countPlansGenerated(db, userId);
  }

  return metrics;
}

async function earnedKeys(db, userId) {
  const rows = await db.achievement.findMany({
    where: { userId },
    select: { badgeKey: true },
  });
  return new Set(rows.map((r) => r.badgeKey).filter((key) => CATALOG_KEYS.has(key)));
}

/**
 * Evaluate badges for one trigger event. Idempotent and append-only:
 * qualifying badges are inserted once with unlockedAt = now(); nothing is
 * ever deleted or updated. Returns the badge keys newly earned by this call.
 *
 * @param {string} userId
 * @param {"workout"|"weight"|"plan"|"custom_exercise"|"all"} triggerEvent
 */
async function evaluateAchievements(userId, triggerEvent, db = prisma) {
  if (triggerEvent !== "all" && !TRIGGER_EVENTS.includes(triggerEvent)) {
    throw new Error(`Unknown achievement trigger event: ${triggerEvent}`);
  }

  const before = await earnedKeys(db, userId);
  const candidates = ACHIEVEMENT_DEFINITIONS.filter(
    (def) =>
      !before.has(def.key) &&
      (triggerEvent === "all" || def.triggerEvents.includes(triggerEvent)),
  );
  if (candidates.length === 0) return [];

  const metrics = await loadMetrics(db, userId, candidates);
  const qualifying = evaluateDefinitions(candidates, metrics).filter((r) => r.earned);
  if (qualifying.length === 0) return [];

  await db.achievement.createMany({
    data: qualifying.map(({ key }) => ({ userId, badgeKey: key })),
    skipDuplicates: true, // concurrent requests: never overwrite unlockedAt
  });

  const after = await earnedKeys(db, userId);
  return [...after].filter((key) => !before.has(key));
}

/**
 * Best-effort wrapper for save paths: an evaluation failure must never turn
 * a successful save into an error response.
 */
async function evaluateAchievementsSafely(userId, triggerEvent) {
  try {
    return await evaluateAchievements(userId, triggerEvent);
  } catch (error) {
    console.warn(`[achievements] Evaluation failed (${triggerEvent}) for user ${userId}: ${error.message}`);
    return [];
  }
}

/**
 * Every badge in the catalog merged with the user's progress.
 * Locked:  { ...definition, progress: <current value>, unlockedAt: null }
 * Earned:  { ...definition, progress: targetValue,     unlockedAt }
 *
 * Also back-fills badges whose criteria are already met (e.g. for users with
 * data from before this catalog existed) — append-only, like any evaluation.
 * The user's data is read once and used for both.
 */
async function getAchievements(userId) {
  const metrics = await loadMetrics(prisma, userId, ACHIEVEMENT_DEFINITIONS);
  const results = new Map(evaluateDefinitions(ACHIEVEMENT_DEFINITIONS, metrics).map((r) => [r.key, r]));

  const met = [...results.values()].filter((r) => r.earned);
  if (met.length > 0) {
    try {
      await prisma.achievement.createMany({
        data: met.map(({ key }) => ({ userId, badgeKey: key })),
        skipDuplicates: true, // badges already earned keep their unlockedAt
      });
    } catch (error) {
      console.warn(`[achievements] Back-fill failed for user ${userId}: ${error.message}`);
    }
  }

  const rows = await prisma.achievement.findMany({ where: { userId } });
  const unlockedAtByKey = new Map(rows.map((r) => [r.badgeKey, r.unlockedAt]));

  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const unlockedAt = unlockedAtByKey.get(def.key) ?? null;
    return {
      ...toPublicDefinition(def),
      progress: unlockedAt ? def.targetValue : results.get(def.key).progress,
      unlockedAt,
    };
  });
}

module.exports = {
  evaluateAchievements,
  evaluateAchievementsSafely,
  getAchievements,
};
