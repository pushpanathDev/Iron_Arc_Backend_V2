/**
 * Pure achievement metrics — no database access, so it can be unit-tested
 * with synthetic data (see achievementEvaluator.test.js).
 *
 * Dates are calendar-day keys ("YYYY-MM-DD"). Workout and body-weight dates
 * are stored as Postgres DATE values, so the key is the user's local
 * calendar date as logged by the app. Day arithmetic is done on keys in UTC
 * to avoid any server-timezone shift.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Workout categories → the six canonical muscle groups. Unmapped → ignored. */
const MUSCLE_GROUP_MAP = {
  chest: "Chest",
  back: "Back",
  lats: "Back",
  shoulders: "Shoulders",
  delts: "Shoulders",
  arms: "Arms",
  biceps: "Arms",
  triceps: "Arms",
  forearms: "Arms",
  legs: "Legs",
  quads: "Legs",
  hamstrings: "Legs",
  glutes: "Legs",
  calves: "Legs",
  core: "Core",
  abs: "Core",
};

/** Which data source a metric needs (used to load only what's required). */
const METRIC_SOURCE = {
  currentStreak: "workout",
  longestStreak: "workout",
  bestWeekDays: "workout",
  consecutive4xWeeks: "workout",
  workoutDays: "workout",
  totalVolume: "workout",
  prExercises: "workout",
  muscleGroups: "workout",
  distinctExercises: "workout",
  weekendDays: "workout",
  maxWorkoutsInDay: "workout",
  comebackSessions: "workout",
  weightEntries: "weight",
  weightDistinctDays: "weight",
  customExercises: "custom_exercise",
  plansGenerated: "plan",
};

function toDateKey(value) {
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

/** Days since epoch for a "YYYY-MM-DD" key (timezone-independent). */
function dayIndex(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

/** 0 = Sunday … 6 = Saturday, for a day index. */
function weekdayOf(index) {
  return new Date(index * DAY_MS).getUTCDay();
}

function uniqueSortedDays(dateKeys) {
  return [...new Set(dateKeys.map(dayIndex))].sort((a, b) => a - b);
}

/**
 * Streaks over distinct calendar days. The current streak is alive if the
 * latest workout is today or yesterday (same rule as the app's calculateStreak).
 */
function computeStreaks(dateKeys, todayKey) {
  const days = uniqueSortedDays(dateKeys);
  if (days.length === 0) return { currentStreak: 0, longestStreak: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    run = days[i] === days[i - 1] + 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  // `run` is now the length of the streak ending at the latest day.
  const today = dayIndex(todayKey);
  const latest = days[days.length - 1];
  const currentStreak = latest >= today - 1 ? run : 0;

  return { currentStreak, longestStreak: longest };
}

/** Distinct workout days per Mon–Sun week. */
function computeWeekly(dateKeys) {
  const perWeek = new Map();
  for (const day of uniqueSortedDays(dateKeys)) {
    const weekStart = day - ((weekdayOf(day) + 6) % 7); // back to Monday
    perWeek.set(weekStart, (perWeek.get(weekStart) || 0) + 1);
  }

  let bestWeekDays = 0;
  const qualifying = [];
  for (const [weekStart, count] of perWeek) {
    if (count > bestWeekDays) bestWeekDays = count;
    if (count >= 4) qualifying.push(weekStart);
  }

  qualifying.sort((a, b) => a - b);
  let consecutive4xWeeks = 0;
  let run = 0;
  for (let i = 0; i < qualifying.length; i++) {
    run = i > 0 && qualifying[i] === qualifying[i - 1] + 7 ? run + 1 : 1;
    if (run > consecutive4xWeeks) consecutive4xWeeks = run;
  }

  return { bestWeekDays, consecutive4xWeeks };
}

function normalizeExercise(name) {
  return String(name || "").trim().toLowerCase();
}

/**
 * Exercises with at least one PR. A PR is a set heavier than every earlier
 * set of that exercise; the first workout of an exercise only sets the baseline.
 */
function countPrExercises(workouts) {
  const byExercise = new Map();
  for (const w of workouts) {
    const name = normalizeExercise(w.exercise);
    if (!name) continue;
    if (!byExercise.has(name)) byExercise.set(name, []);
    byExercise.get(name).push(w);
  }

  let count = 0;
  for (const list of byExercise.values()) {
    list.sort((a, b) => {
      const byDate = dayIndex(toDateKey(a.date)) - dayIndex(toDateKey(b.date));
      if (byDate !== 0) return byDate;
      return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
    });

    let best = null;
    for (const w of list) {
      const top = Math.max(0, ...(w.sets || []).map((s) => Number(s.weight) || 0));
      if (best === null) {
        best = top; // first time doing the exercise: baseline, not a PR
        continue;
      }
      if (top > best) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

/**
 * Best lift per exercise: the heaviest set weight and the date it was first
 * reached. Exercises are grouped case/space-insensitively; the name returned
 * is the one used on that date. Bodyweight-only exercises (max 0) are omitted.
 */
function computePersonalRecords(workouts) {
  const best = new Map();
  for (const w of workouts) {
    const name = normalizeExercise(w.exercise);
    if (!name) continue;
    const top = Math.max(0, ...(w.sets || []).map((s) => Number(s.weight) || 0));
    if (top <= 0) continue;

    const date = toDateKey(w.date);
    const current = best.get(name);
    if (!current || top > current.maxWeight || (top === current.maxWeight && date < current.date)) {
      best.set(name, { exerciseName: String(w.exercise).trim(), maxWeight: top, date });
    }
  }
  return [...best.values()].sort((a, b) => a.exerciseName.localeCompare(b.exerciseName));
}

/** Canonical muscle groups trained at least once, in a fixed order. */
function muscleGroupsCovered(workouts) {
  const found = new Set();
  for (const w of workouts) {
    const group = MUSCLE_GROUP_MAP[String(w.category || "").trim().toLowerCase()];
    if (group) found.add(group);
  }
  return ["Chest", "Back", "Shoulders", "Arms", "Legs", "Core"].filter((g) => found.has(g));
}

/** Max sessions after any break of 14+ rest days (i.e. a gap of ≥15 days). */
function computeComeback(dateKeys) {
  const days = uniqueSortedDays(dateKeys);
  let best = 0;
  let current = 0;
  for (let i = 1; i < days.length; i++) {
    if (days[i] - days[i - 1] >= 15) current = 1;
    else if (current > 0) current += 1;
    if (current > best) best = current;
  }
  return best;
}

function computeWorkoutMetrics(workouts, todayKey) {
  const dateKeys = workouts.map((w) => toDateKey(w.date));

  const perDay = new Map();
  for (const key of dateKeys) perDay.set(key, (perDay.get(key) || 0) + 1);

  let totalVolume = 0;
  for (const w of workouts) {
    for (const s of w.sets || []) {
      totalVolume += (Number(s.reps) || 0) * (Number(s.weight) || 0);
    }
  }

  const weekendDays = [...perDay.keys()].filter((key) => {
    const weekday = weekdayOf(dayIndex(key));
    return weekday === 0 || weekday === 6;
  }).length;

  return {
    ...computeStreaks(dateKeys, todayKey),
    ...computeWeekly(dateKeys),
    workoutDays: perDay.size,
    totalVolume: Math.round(totalVolume * 10) / 10,
    prExercises: countPrExercises(workouts),
    muscleGroups: muscleGroupsCovered(workouts).length,
    distinctExercises: new Set(workouts.map((w) => normalizeExercise(w.exercise)).filter(Boolean)).size,
    weekendDays,
    maxWorkoutsInDay: perDay.size ? Math.max(...perDay.values()) : 0,
    comebackSessions: computeComeback(dateKeys),
  };
}

function computeWeightMetrics(entries) {
  return {
    weightEntries: entries.length,
    weightDistinctDays: new Set(entries.map((e) => toDateKey(e.date))).size,
  };
}

/** Evaluate definitions against metrics: value used for earning + progress shown. */
function evaluateDefinitions(definitions, metrics) {
  return definitions.map((def) => {
    const value = metrics[def.metric] ?? 0;
    return {
      key: def.key,
      earned: value >= def.targetValue,
      progress: metrics[def.progressMetric || def.metric] ?? 0,
    };
  });
}

module.exports = {
  MUSCLE_GROUP_MAP,
  METRIC_SOURCE,
  toDateKey,
  computeStreaks,
  computeWeekly,
  countPrExercises,
  computePersonalRecords,
  muscleGroupsCovered,
  computeComeback,
  computeWorkoutMetrics,
  computeWeightMetrics,
  evaluateDefinitions,
};
