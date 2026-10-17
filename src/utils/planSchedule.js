/**
 * The shape of a plan, decided here rather than by the AI: which weekdays are
 * training days, which session each one gets (e.g. Push / Pull / Legs twice
 * on Mon–Sat), how long the plan runs and which weeks are lighter. The AI only
 * fills in the exercises, so it can't drop or move days.
 *
 * Plans are built one week at a time: week 1 when the plan is generated, each
 * later week by "next week" from what the user logged.
 *
 * Plan weeks are calendar weeks, Monday to Sunday. Each week knows its Monday
 * (weekStartsOn); the next one can start from the Monday after, and is written
 * then, so the coach sees the whole week before it.
 */
const { WEEKDAYS } = require("./planChat");
const { addDays, dateKey, mondayOf, weekdayOf } = require("./dates");

/** The muscles each session trains (the exercise database's names). */
const SESSION_MUSCLES = {
  "Full body": ["chest", "back", "quads", "hamstrings", "glutes", "shoulders", "core"],
  Upper: ["chest", "back", "shoulders", "biceps", "triceps"],
  Lower: ["quads", "hamstrings", "glutes", "calves", "core"],
  Push: ["chest", "shoulders", "triceps"],
  Pull: ["back", "biceps"],
  Legs: ["quads", "hamstrings", "glutes", "calves"],
  Chest: ["chest", "triceps"],
  Back: ["back", "biceps"],
  Shoulders: ["shoulders", "core"],
  Arms: ["biceps", "triceps"],
  "Chest & triceps": ["chest", "triceps"],
  "Back & biceps": ["back", "biceps"],
  "Legs & shoulders": ["quads", "hamstrings", "glutes", "shoulders"],
  "Shoulders & arms": ["shoulders", "biceps", "triceps"],
};

/** A body-part split for each number of training days (1–6). */
const BODY_PART_WEEKS = {
  1: ["Full body"],
  2: ["Upper", "Lower"],
  3: ["Chest & triceps", "Back & biceps", "Legs & shoulders"],
  4: ["Chest & triceps", "Back & biceps", "Legs", "Shoulders & arms"],
  5: ["Chest", "Back", "Legs", "Shoulders", "Arms"],
  6: ["Chest", "Back", "Legs", "Shoulders", "Arms", "Legs"],
};

/** The sessions a split repeats through the training days, in order. */
const SPLIT_SESSIONS = {
  full_body: ["Full body"],
  upper_lower: ["Upper", "Lower"],
  push_pull_legs: ["Push", "Pull", "Legs"],
};

const SPLIT_NAMES = {
  full_body: "Full Body",
  upper_lower: "Upper Lower",
  push_pull_legs: "Push Pull Legs",
  body_part: "Body Part",
};

/** Weekdays (1 = Monday) when the profile has a weekly goal but no chosen days. */
const SPREAD_WEEKDAYS = { 1: [1], 2: [1, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 5, 6], 6: [1, 2, 3, 4, 5, 6] };

/** How each progression style runs; both prompts quote it. */
const PROGRESSION_RULES = {
  linear: "Add 2.5–5kg (or 1 rep) to each exercise every week. If the user can complete all sets with perfect form, increase the load.",
  undulating: "Week 1: heavy/low reps (4×4-6). Week 2: moderate/medium reps (4×8-10). Week 3: light/high reps (3×12-15). Week 4: deload (3×8 at 60% load). Repeat pattern with increased loads.",
  block: "Phase 1 (weeks 1-4): hypertrophy focus, 3×10-12. Phase 2 (weeks 5-8): strength focus, 4×4-6 compound heavy. Phase 3 (weeks 9-12): peaking/intensification, 5×2-4. Then deload.",
};

/** Plan length in weeks: block progression has three 4-week phases. */
const PLAN_WEEKS = { linear: 8, undulating: 8, block: 12 };

/** Every 4th week is lighter, to recover. */
const isDeloadWeek = (week) => week % 4 === 0;

/** Split from the number of training days when the user didn't choose one (the app shows the same). */
function defaultSplit(days) {
  if (days <= 3) return "full_body";
  if (days === 4) return "upper_lower";
  return "push_pull_legs";
}

/** The chosen split, unless there are too few days for it (Push/Pull/Legs on 2 days would skip legs). */
function splitFor(chosen, days) {
  const needs = { full_body: 1, upper_lower: 2, push_pull_legs: 3, body_part: 1 }[chosen];
  return needs && days >= needs ? chosen : defaultSplit(days);
}

function trainingWeekdays(profile) {
  if (Array.isArray(profile.trainingDays) && profile.trainingDays.length > 0) {
    return [...profile.trainingDays].sort((a, b) => a - b);
  }
  return SPREAD_WEEKDAYS[Math.min(6, Math.max(1, profile.weeklyGoal || 3))];
}

/** Training days in weekday order: [{ day: "monday", session: "Push", muscles: [...] }, ...]. */
function weekSchedule(weekdays, split) {
  const sessions = split === "body_part" ? BODY_PART_WEEKS[weekdays.length] : SPLIT_SESSIONS[split];
  return weekdays.map((weekday, i) => {
    const session = sessions[i % sessions.length];
    return { day: WEEKDAYS[weekday - 1], session, muscles: SESSION_MUSCLES[session] };
  });
}

/**
 * Everything a new plan is built from: the plan form's choices, else the
 * training profile, else sensible defaults.
 */
function planSettings(profile, criteria = {}) {
  const weekdays = trainingWeekdays(profile);
  const split = splitFor(criteria.splitPreference, weekdays.length);
  const experience = criteria.experienceLevel ?? profile.experienceLevel ?? "intermediate";
  const progression = PROGRESSION_RULES[criteria.progressionStyle]
    ? criteria.progressionStyle
    : { beginner: "linear", intermediate: "undulating", advanced: "block" }[experience] || "linear";
  return {
    minutes: criteria.sessionDuration ?? profile.sessionMinutes ?? 60,
    equipment: criteria.equipment ?? profile.equipment ?? "full_gym",
    experience,
    split,
    progression,
    intensity: criteria.intensity ?? "moderate",
    priorityMuscles: Array.isArray(criteria.priorityMuscles) ? criteria.priorityMuscles : [],
    schedule: weekSchedule(weekdays, split),
    totalWeeks: PLAN_WEEKS[progression],
  };
}

const REST_DAY = (day) => ({ day, sessionType: "rest", recoveryNote: "Rest day: an easy walk or some stretching helps you recover." });

/**
 * A full week (Monday to Sunday) from the AI's sessions. Every scheduled day
 * gets its session and muscles; the other days are rest. A training day the
 * AI skipped gets the same session from another day, so a short reply can't
 * turn training days into rest days. Null if a session is missing entirely.
 */
function assembleWeek(schedule, aiDays, minutes) {
  const exercisesByDay = new Map(
    (Array.isArray(aiDays) ? aiDays : [])
      .filter((d) => typeof d?.day === "string" && Array.isArray(d.exercises) && d.exercises.length > 0)
      .map((d) => [d.day.toLowerCase(), d.exercises]),
  );
  const exercisesBySession = new Map();
  for (const { day, session } of schedule) {
    if (exercisesByDay.has(day) && !exercisesBySession.has(session)) exercisesBySession.set(session, exercisesByDay.get(day));
  }

  const days = WEEKDAYS.map((day) => {
    const planned = schedule.find((s) => s.day === day);
    if (!planned) return REST_DAY(day);
    const exercises = exercisesByDay.get(day) ?? exercisesBySession.get(planned.session);
    if (!exercises) return null;
    return { day, sessionType: "training", targetMuscles: planned.muscles, estimatedDurationMinutes: minutes, exercises };
  });
  return days.includes(null) ? null : days;
}

/**
 * The plan with week `next` in it: as planned when the plan already holds it
 * (plans made before weekly generation hold every week), else a copy of the
 * week before for "next week" to adjust.
 */
function withNextWeek(plan, next) {
  const weeks = plan.weeks ?? [];
  if (weeks[next - 1]) return plan;
  const before = weeks[next - 2];
  return { ...plan, weeks: [...weeks, { week: next, isDeloadWeek: isDeloadWeek(next), days: structuredClone(before?.days ?? []) }] };
}

/** The ISO weekdays (1 = Monday) a week trains on. */
function weekTrainingDays(days) {
  return (days ?? [])
    .filter((d) => d.sessionType !== "rest" && d.exercises?.length > 0)
    .map((d) => WEEKDAYS.indexOf(String(d.day).toLowerCase()) + 1)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
}

const sameMuscles = (a = [], b = []) => a.length === b.length && a.every((m) => b.includes(m));

/**
 * This week's sessions moved onto a new schedule (new training days): each
 * scheduled day takes the exercises of this week's day that trains the same
 * muscles. Null when a session has no match (the split changed), so the AI
 * has to write that week.
 */
function moveSessions(days, schedule, minutes) {
  const training = (days ?? []).filter((d) => d.sessionType !== "rest" && d.exercises?.length > 0);
  const carried = schedule
    .map((s) => ({ day: s.day, exercises: training.find((d) => sameMuscles(d.targetMuscles, s.muscles))?.exercises }))
    .filter((d) => d.exercises);
  return assembleWeek(schedule, carried, minutes);
}

/** The plan with week `number` set to `days` (replacing it, or added as the next week). */
function withWeek(plan, number, days) {
  const weeks = [...(plan.weeks ?? [])];
  weeks[number - 1] = { week: number, isDeloadWeek: isDeloadWeek(number), days };
  return { ...plan, weeks };
}

/** Week 1's Monday for a plan made on `today`: this week's, or next week's when it's made at the weekend. */
function firstWeekStartsOn(today) {
  return weekdayOf(today) >= 5 ? addDays(mondayOf(today), 7) : mondayOf(today);
}

/**
 * The Monday of the plan's current week. Each week stores it; plans from
 * before that have the time their week started, or count weeks from when they
 * were made.
 */
function weekStartsOn(plan) {
  const data = plan.planData ?? {};
  if (data.weekStartsOn) return data.weekStartsOn;
  if (data.weekStartedAt) return mondayOf(dateKey(new Date(data.weekStartedAt)));
  return addDays(firstWeekStartsOn(dateKey(new Date(plan.createdAt))), 7 * ((plan.weekNumber || 1) - 1));
}

/** How many weeks a plan runs: set when it was made, or every week it holds (older plans). */
const planLength = (planData) => planData?.totalWeeks ?? planData?.weeks?.length ?? 1;

module.exports = {
  SPLIT_NAMES,
  PROGRESSION_RULES,
  isDeloadWeek,
  defaultSplit,
  splitFor,
  weekSchedule,
  firstWeekStartsOn,
  weekStartsOn,
  trainingWeekdays,
  weekTrainingDays,
  moveSessions,
  withWeek,
  planSettings,
  assembleWeek,
  withNextWeek,
  planLength,
};
