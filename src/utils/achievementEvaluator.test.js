/**
 * Runnable check for the achievement evaluator (not a test framework).
 *   node src/utils/achievementEvaluator.test.js
 * Uses synthetic data only — no database or Firebase. The Prisma module is
 * replaced with an in-memory fake before achievementService is loaded.
 */
const path = require("path");
const {
  computeStreaks,
  computeWeekly,
  countPrExercises,
  computePersonalRecords,
  muscleGroupsCovered,
  computeComeback,
  computeWorkoutMetrics,
  computeWeightMetrics,
  evaluateDefinitions,
  METRIC_SOURCE,
} = require("./achievementEvaluator");
const { ACHIEVEMENT_DEFINITIONS, TRIGGER_EVENTS } = require("./achievementDefinitions");

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

// Helpers -------------------------------------------------------------------
function addDays(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function days(start, count) {
  return Array.from({ length: count }, (_, i) => addDays(start, i));
}
function workout(date, exercise, category, sets, createdAt) {
  return { date, exercise, category, sets, createdAt: createdAt || `${date}T10:00:00Z` };
}

// ── Catalog ─────────────────────────────────────────────────────────────────
console.log("\n# Catalog");
check("28 badges", ACHIEVEMENT_DEFINITIONS.length, 28);
check("keys are unique", new Set(ACHIEVEMENT_DEFINITIONS.map((d) => d.key)).size, 28);
check(
  "categories (8 sections in the approved catalog)",
  [...new Set(ACHIEVEMENT_DEFINITIONS.map((d) => d.category))].sort(),
  ["ai_plans", "body_weight", "consistency", "fun", "records", "variety", "volume", "workouts"],
);
check(
  "every tier is bronze/silver/gold",
  ACHIEVEMENT_DEFINITIONS.every((d) => ["bronze", "silver", "gold"].includes(d.tier)),
  true,
);
check(
  "every trigger event is known",
  ACHIEVEMENT_DEFINITIONS.every((d) => d.triggerEvents.every((e) => TRIGGER_EVENTS.includes(e))),
  true,
);
check(
  "every metric has a data source",
  ACHIEVEMENT_DEFINITIONS.every((d) => METRIC_SOURCE[d.metric] && (!d.progressMetric || METRIC_SOURCE[d.progressMetric])),
  true,
);

// ── Streaks ─────────────────────────────────────────────────────────────────
console.log("\n# Streaks");
check("empty history", computeStreaks([], "2026-10-10"), { currentStreak: 0, longestStreak: 0 });
check("alive (trained today), duplicates ignored",
  computeStreaks(["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-10"], "2026-10-10"),
  { currentStreak: 3, longestStreak: 3 });
check("alive (trained yesterday)",
  computeStreaks(["2026-10-08", "2026-10-09"], "2026-10-10"),
  { currentStreak: 2, longestStreak: 2 });
check("broken: current 0, longest kept from history",
  computeStreaks([...days("2026-09-01", 7), "2026-10-01"], "2026-10-10"),
  { currentStreak: 0, longestStreak: 7 });
check("gap breaks the streak",
  computeStreaks(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-10"], "2026-10-10"),
  { currentStreak: 3, longestStreak: 3 });
check("across month boundary",
  computeStreaks(["2026-09-29", "2026-09-30", "2026-10-01"], "2026-10-01"),
  { currentStreak: 3, longestStreak: 3 });
check("latest day one ahead of server today (UTC+ user) counts as alive",
  computeStreaks(["2026-10-10", "2026-10-11"], "2026-10-10"),
  { currentStreak: 2, longestStreak: 2 });

// ── Weekly consistency (Mon–Sun) ────────────────────────────────────────────
console.log("\n# Weekly");
// 2026-10-05 is a Monday.
check("4 days in one week", computeWeekly(["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-11"]),
  { bestWeekDays: 4, consecutive4xWeeks: 1 });
check("4 days split across Sun/Mon boundary is not one week",
  computeWeekly(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]),
  { bestWeekDays: 2, consecutive4xWeeks: 0 });
const fourWeeks = [0, 7, 14, 21].flatMap((offset) => [0, 1, 2, 3].map((d) => addDays("2026-09-07", offset + d)));
check("4 consecutive 4x weeks", computeWeekly(fourWeeks).consecutive4xWeeks, 4);
const withGapWeek = fourWeeks.filter((k) => k < "2026-09-14" || k >= "2026-09-21");
check("a weak week breaks the run", computeWeekly(withGapWeek).consecutive4xWeeks, 2);

// ── Personal records ────────────────────────────────────────────────────────
console.log("\n# Personal records");
check("first time is not a PR", countPrExercises([workout("2026-10-01", "Bench", "Chest", [{ reps: 5, weight: 60 }, { reps: 5, weight: 80 }])]), 0);
check("heavier later set is a PR", countPrExercises([
  workout("2026-10-01", "Bench", "Chest", [{ reps: 5, weight: 60 }]),
  workout("2026-10-03", "Bench", "Chest", [{ reps: 5, weight: 62.5 }]),
]), 1);
check("equal weight is not a PR", countPrExercises([
  workout("2026-10-01", "Bench", "Chest", [{ reps: 5, weight: 60 }]),
  workout("2026-10-03", "Bench", "Chest", [{ reps: 8, weight: 60 }]),
]), 0);
check("exercise names are case/space-insensitive", countPrExercises([
  workout("2026-10-01", "Bench Press", "Chest", [{ reps: 5, weight: 60 }]),
  workout("2026-10-03", " bench press ", "Chest", [{ reps: 5, weight: 70 }]),
]), 1);
check("counts exercises, not PR events", countPrExercises([
  workout("2026-10-01", "Squat", "Legs", [{ reps: 5, weight: 100 }]),
  workout("2026-10-02", "Squat", "Legs", [{ reps: 5, weight: 105 }]),
  workout("2026-10-03", "Squat", "Legs", [{ reps: 5, weight: 110 }]),
  workout("2026-10-01", "Row", "Back", [{ reps: 5, weight: 50 }]),
  workout("2026-10-04", "Row", "Back", [{ reps: 5, weight: 55 }]),
]), 2);
check("same-day order uses createdAt", countPrExercises([
  workout("2026-10-01", "Curl", "Arms", [{ reps: 10, weight: 15 }], "2026-10-01T18:00:00Z"),
  workout("2026-10-01", "Curl", "Arms", [{ reps: 10, weight: 12 }], "2026-10-01T09:00:00Z"),
]), 1);

// ── Comeback ────────────────────────────────────────────────────────────────
console.log("\n# Comeback");
check("no gap", computeComeback(days("2026-09-01", 10)), 0);
check("13 rest days is not a break", computeComeback(["2026-09-01", "2026-09-15", "2026-09-16", "2026-09-17"]), 0);
check("14 rest days then 3 sessions", computeComeback(["2026-09-01", "2026-09-16", "2026-09-17", "2026-09-19"]), 3);
check("14 rest days then 2 sessions", computeComeback(["2026-09-01", "2026-09-16", "2026-09-18"]), 2);

// ── Full workout metrics ────────────────────────────────────────────────────
console.log("\n# Workout metrics");
const sample = [
  workout("2026-10-03", "Bench", "Chest", [{ reps: 10, weight: 50 }, { reps: 8, weight: 60 }]), // Sat
  workout("2026-10-03", "Pull Up", "Back", [{ reps: 8, weight: 0 }]),                          // same day
  workout("2026-10-04", "OHP", "Shoulders", [{ reps: 5, weight: 40 }]),                         // Sun
  workout("2026-10-05", "Curl", "Arms", [{ reps: 12, weight: 10 }]),
  workout("2026-10-06", "Squat", "Legs", [{ reps: 5, weight: 100 }]),
  workout("2026-10-07", "Plank", "Abs", [{ reps: 1, weight: 0 }]),
  workout("2026-10-08", "Run", "Cardio", [{ reps: 1, weight: 0 }]),
];
const m = computeWorkoutMetrics(sample, "2026-10-08");
check("distinct workout days", m.workoutDays, 6);
check("total volume (kg)", m.totalVolume, 10 * 50 + 8 * 60 + 5 * 40 + 12 * 10 + 5 * 100);
check("6 canonical muscle groups (Abs→Core, Cardio ignored)", m.muscleGroups, 6);
check("distinct exercises", m.distinctExercises, 7);
check("weekend days", m.weekendDays, 2);
check("max workouts in a day", m.maxWorkoutsInDay, 2);
check("current = longest streak", [m.currentStreak, m.longestStreak], [6, 6]);

// ── Stats helpers (GET /api/workouts/stats) ─────────────────────────────────
console.log("\n# Stats helpers");
check("personal records: best lift per exercise with first date reached",
  computePersonalRecords([
    workout("2026-10-01", "Bench", "Chest", [{ reps: 5, weight: 60 }]),
    workout("2026-10-03", "bench ", "Chest", [{ reps: 5, weight: 70 }]),
    workout("2026-10-05", "Bench", "Chest", [{ reps: 3, weight: 70 }]),
    workout("2026-10-02", "Pull Up", "Back", [{ reps: 8, weight: 0 }]),
  ]),
  [{ exerciseName: "bench", maxWeight: 70, date: "2026-10-03" }]);
check("muscle groups covered, fixed order, unmapped ignored",
  muscleGroupsCovered([
    workout("2026-10-01", "Squat", "Legs", []),
    workout("2026-10-01", "Plank", "Abs", []),
    workout("2026-10-01", "Bench", "Chest", []),
    workout("2026-10-01", "Run", "Cardio", []),
  ]),
  ["Chest", "Legs", "Core"]);

// ── Weight metrics ──────────────────────────────────────────────────────────
console.log("\n# Weight metrics");
check("entries and distinct days",
  computeWeightMetrics([{ date: "2026-10-01" }, { date: "2026-10-02" }, { date: new Date("2026-10-03T00:00:00Z") }]),
  { weightEntries: 3, weightDistinctDays: 3 });

// ── Definitions ─────────────────────────────────────────────────────────────
console.log("\n# Definitions");
const byKey = Object.fromEntries(
  evaluateDefinitions(ACHIEVEMENT_DEFINITIONS, { ...m, longestStreak: 7, currentStreak: 0 }).map((r) => [r.key, r]),
);
check("streak_7 earned from LONGEST streak", byKey.streak_7.earned, true);
check("streak_14 locked, progress shows CURRENT streak", [byKey.streak_14.earned, byKey.streak_14.progress], [false, 0]);
check("muscle_groups_6 earned", byKey.muscle_groups_6.earned, true);
check("double_session earned", byKey.double_session.earned, true);
check("volume_1k earned (1,800 kg)", byKey.volume_1k.earned, true);
check("volume_10k locked with progress", [byKey.volume_10k.earned, byKey.volume_10k.progress], [false, 1800]);

// ── Service: append-only evaluation against an in-memory fake DB ────────────
async function serviceChecks() {
  console.log("\n# Service (fake DB)");
  const state = { workouts: [], weights: [], achievements: [], customExercises: 0, plans: 0, generations: 0 };
  const fakeDb = {
    workout: { findMany: async () => state.workouts.filter((w) => !w.deletedAt) },
    bodyWeight: { findMany: async () => state.weights.filter((w) => !w.deletedAt) },
    customExercise: { count: async () => state.customExercises },
    plan: { count: async () => state.plans },
    planGeneration: { count: async () => state.generations },
    achievement: {
      findMany: async () => state.achievements.map((a) => ({ ...a })),
      createMany: async ({ data }) => {
        for (const row of data) {
          if (!state.achievements.some((a) => a.badgeKey === row.badgeKey)) {
            state.achievements.push({ ...row, unlockedAt: new Date("2026-10-10T12:00:00Z") });
          }
        }
      },
    },
  };

  const dbPath = require.resolve(path.join(__dirname, "..", "config", "database.js"));
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fakeDb } };
  const { evaluateAchievements } = require("../services/achievementService");

  state.workouts.push(workout("2026-10-10", "Bench", "Chest", [{ reps: 10, weight: 60 }]));
  const first = await evaluateAchievements("u1", "workout");
  check("first workout unlocks workout_1", first.includes("workout_1"), true);

  const again = await evaluateAchievements("u1", "workout");
  check("re-evaluating returns no new keys (idempotent)", again, []);

  const unlockedAt = state.achievements.find((a) => a.badgeKey === "workout_1").unlockedAt.toISOString();
  state.workouts[0].deletedAt = new Date();
  await evaluateAchievements("u1", "workout");
  check("deleting the workout does not revoke workout_1",
    state.achievements.some((a) => a.badgeKey === "workout_1"), true);
  check("unlockedAt is never changed",
    state.achievements.find((a) => a.badgeKey === "workout_1").unlockedAt.toISOString(), unlockedAt);

  state.weights.push({ date: "2026-10-10" });
  const viaWorkout = await evaluateAchievements("u1", "workout");
  check("workout trigger does not evaluate weight badges (weight exists)", viaWorkout.includes("weight_first"), false);
  check("weight trigger unlocks weight_first", await evaluateAchievements("u1", "weight"), ["weight_first"]);

  state.plans = 1; // one plan left after deleting others…
  state.generations = 3; // …but 3 were generated
  const plan = await evaluateAchievements("u1", "plan");
  check("plan trigger uses generation count (3)", plan.sort(), ["ai_plan_1", "ai_plan_3"]);

  state.customExercises = 1;
  check("custom_exercise trigger", await evaluateAchievements("u1", "custom_exercise"), ["custom_exercise_1"]);

  let threw = false;
  try { await evaluateAchievements("u1", "bogus"); } catch { threw = true; }
  check("unknown trigger event is rejected", threw, true);
}

serviceChecks()
  .catch((error) => {
    failed += 1;
    console.log(`FAIL  service checks threw: ${error.stack}`);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exitCode = failed > 0 ? 1 : 0;
  });
