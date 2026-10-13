/**
 * Achievement catalog (v2) — 28 badges in 7 categories.
 *
 * Badges are permanent once earned. Each badge is earned when its `metric`
 * (computed by utils/achievementEvaluator.js) reaches `targetValue`.
 * `progressMetric`, when present, is what locked badges show as progress
 * (streak badges unlock from the longest streak but display the current one).
 *
 * triggerEvents: which save events re-evaluate the badge.
 *   workout          — workout create / update / delete
 *   weight           — body-weight log / delete
 *   plan             — AI plan generate
 *   custom_exercise  — custom exercise create
 */

const TRIGGER_EVENTS = ["workout", "weight", "plan", "custom_exercise"];

const ACHIEVEMENT_DEFINITIONS = [
  // ── Consistency / streaks ────────────────────────────────────────────
  // Weekly streaks: weeks in a row meeting the weekly goal (the app's streak). Keys kept from the
  // old daily-streak badges so anything already earned stays earned.
  { key: "streak_3", title: "Momentum", description: "Meet your weekly goal 2 weeks in a row.", tier: "bronze", category: "consistency", targetValue: 2, triggerEvents: ["workout"], metric: "longestWeekStreak", progressMetric: "currentWeekStreak" },
  { key: "streak_7", title: "Week Warrior", description: "Meet your weekly goal 4 weeks in a row.", tier: "silver", category: "consistency", targetValue: 4, triggerEvents: ["workout"], metric: "longestWeekStreak", progressMetric: "currentWeekStreak" },
  { key: "streak_14", title: "Two-Month Grind", description: "Meet your weekly goal 8 weeks in a row.", tier: "silver", category: "consistency", targetValue: 8, triggerEvents: ["workout"], metric: "longestWeekStreak", progressMetric: "currentWeekStreak" },
  { key: "streak_30", title: "Quarter Strong", description: "Meet your weekly goal 12 weeks in a row.", tier: "gold", category: "consistency", targetValue: 12, triggerEvents: ["workout"], metric: "longestWeekStreak", progressMetric: "currentWeekStreak" },
  { key: "streak_60", title: "Relentless", description: "Meet your weekly goal 26 weeks in a row.", tier: "gold", category: "consistency", targetValue: 26, triggerEvents: ["workout"], metric: "longestWeekStreak", progressMetric: "currentWeekStreak" },
  { key: "streak_100", title: "Year of Iron", description: "Meet your weekly goal 52 weeks in a row.", tier: "gold", category: "consistency", targetValue: 52, triggerEvents: ["workout"], metric: "longestWeekStreak", progressMetric: "currentWeekStreak" },
  { key: "weekly_4x_once", title: "Consistent", description: "Train on 4 different days in one week (Mon–Sun).", tier: "bronze", category: "consistency", targetValue: 4, triggerEvents: ["workout"], metric: "bestWeekDays" },
  { key: "weekly_4x_4", title: "Consistency King", description: "Train on 4+ days a week for 4 weeks in a row.", tier: "silver", category: "consistency", targetValue: 4, triggerEvents: ["workout"], metric: "consecutive4xWeeks" },

  // ── Workout count (distinct workout days) ────────────────────────────
  { key: "workout_1", title: "First Step", description: "Log your first workout day.", tier: "bronze", category: "workouts", targetValue: 1, triggerEvents: ["workout"], metric: "workoutDays" },
  { key: "workout_10", title: "Getting Started", description: "Work out on 10 different days.", tier: "bronze", category: "workouts", targetValue: 10, triggerEvents: ["workout"], metric: "workoutDays" },
  { key: "workout_50", title: "Committed", description: "Work out on 50 different days.", tier: "silver", category: "workouts", targetValue: 50, triggerEvents: ["workout"], metric: "workoutDays" },
  { key: "workout_100", title: "Century Lifter", description: "Work out on 100 different days.", tier: "gold", category: "workouts", targetValue: 100, triggerEvents: ["workout"], metric: "workoutDays" },

  // ── Volume (kg) ──────────────────────────────────────────────────────
  { key: "volume_1k", title: "1 Tonne Club", description: "Lift 1,000 kg in total.", tier: "bronze", category: "volume", targetValue: 1000, triggerEvents: ["workout"], metric: "totalVolume" },
  { key: "volume_10k", title: "10 Tonne Titan", description: "Lift 10,000 kg in total.", tier: "silver", category: "volume", targetValue: 10000, triggerEvents: ["workout"], metric: "totalVolume" },
  { key: "volume_50k", title: "50 Tonne Beast", description: "Lift 50,000 kg in total.", tier: "gold", category: "volume", targetValue: 50000, triggerEvents: ["workout"], metric: "totalVolume" },

  // ── Personal records ─────────────────────────────────────────────────
  { key: "pr_1", title: "First PR", description: "Set a personal record on any exercise.", tier: "bronze", category: "records", targetValue: 1, triggerEvents: ["workout"], metric: "prExercises" },
  { key: "pr_10", title: "Record Breaker", description: "Set personal records on 10 different exercises.", tier: "gold", category: "records", targetValue: 10, triggerEvents: ["workout"], metric: "prExercises" },

  // ── Variety ──────────────────────────────────────────────────────────
  { key: "muscle_groups_6", title: "All-Rounder", description: "Train chest, back, shoulders, arms, legs and core.", tier: "silver", category: "variety", targetValue: 6, triggerEvents: ["workout"], metric: "muscleGroups" },
  { key: "exercises_10", title: "Exercise Explorer", description: "Use 10 different exercises.", tier: "bronze", category: "variety", targetValue: 10, triggerEvents: ["workout"], metric: "distinctExercises" },
  { key: "custom_exercise_1", title: "Make It Yours", description: "Create a custom exercise.", tier: "bronze", category: "variety", targetValue: 1, triggerEvents: ["custom_exercise"], metric: "customExercises" },

  // ── Body weight ──────────────────────────────────────────────────────
  { key: "weight_first", title: "First Check-In", description: "Log your body weight.", tier: "bronze", category: "body_weight", targetValue: 1, triggerEvents: ["weight"], metric: "weightEntries" },
  { key: "weight_entries_10", title: "Tracking In", description: "Log your body weight 10 times.", tier: "bronze", category: "body_weight", targetValue: 10, triggerEvents: ["weight"], metric: "weightEntries" },
  { key: "weight_entries_30", title: "Weight Watcher", description: "Log your body weight on 30 different days.", tier: "silver", category: "body_weight", targetValue: 30, triggerEvents: ["weight"], metric: "weightDistinctDays" },

  // ── AI plans ─────────────────────────────────────────────────────────
  { key: "ai_plan_1", title: "Blueprint Built", description: "Generate an AI plan.", tier: "bronze", category: "ai_plans", targetValue: 1, triggerEvents: ["plan"], metric: "plansGenerated" },
  { key: "ai_plan_3", title: "Plan Collector", description: "Generate 3 AI plans.", tier: "silver", category: "ai_plans", targetValue: 3, triggerEvents: ["plan"], metric: "plansGenerated" },

  // ── Fun ──────────────────────────────────────────────────────────────
  { key: "weekend_warrior", title: "Weekend Warrior", description: "Train on 4 different weekend days.", tier: "silver", category: "fun", targetValue: 4, triggerEvents: ["workout"], metric: "weekendDays" },
  { key: "double_session", title: "Double Down", description: "Log 2 or more workouts on the same day.", tier: "bronze", category: "fun", targetValue: 2, triggerEvents: ["workout"], metric: "maxWorkoutsInDay" },
  { key: "comeback_kid", title: "Comeback Kid", description: "Train 3 times after a break of 14+ days.", tier: "gold", category: "fun", targetValue: 3, triggerEvents: ["workout"], metric: "comebackSessions" },
];

const CATALOG_KEYS = new Set(ACHIEVEMENT_DEFINITIONS.map(({ key }) => key));

/** Definition as exposed by the API (internal metric names stripped). */
function toPublicDefinition({ metric, progressMetric, ...definition }) {
  return definition;
}

module.exports = {
  TRIGGER_EVENTS,
  ACHIEVEMENT_DEFINITIONS,
  CATALOG_KEYS,
  toPublicDefinition,
};
