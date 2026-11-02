const { EXERCISE_DB, isValidExerciseId, equipmentTagsFor, findSimilarExercise, exerciseOrderTier } = require("./exerciseDatabase");
const { aiText } = require("./aiText");
const { WEEKDAYS } = require("./planChat");

/**
 * Validates and sanitizes a plan before it is saved or sent to the app. Every
 * AI-written plan and every AI change goes through here, so nothing the model
 * writes (or is talked into writing) reaches the user unbounded.
 *
 * Edge Cases:
 * - Malformed structure → throws INVALID_PLAN_STRUCTURE (caller handles retry)
 * - Made-up exercise IDs → replaced with a known exercise for the same day's
 *   muscles and the user's equipment
 * - Every exercise gets its one fixed name from the exercise database, and a
 *   progression note that fits its reps when it has none
 * - Hard limits: 1–6 sets, 30–300 s rest, sessions of 15–120 minutes, at most
 *   8 exercises, reps as a real rep or time range (else "8-12")
 * - Unknown muscles dropped; AI-written notes cleaned and capped
 * - Exercises in training order: big compound lifts first, isolation and core last
 *   (stable, so the AI's order is kept within each tier)
 * weekProblems() adds the week-level rules an AI change must also pass.
 */
/** Equipment that makes an exercise "weighted": its progression adds load rather than reps. */
const LOAD_EQUIPMENT = ["barbell", "dumbbells", "cables", "machines"];
const KNOWN_MUSCLES = new Set(Object.values(EXERCISE_DB).flatMap((ex) => ex.muscles));

const LIMITS = {
  sets: [1, 6],
  restSeconds: [30, 300],
  minutes: [15, 120],
  exercisesPerDay: 8,
  trainingDaysPerWeek: 6,
  reps: [1, 30],
  seconds: [5, 180],
  repMinutes: [1, 10],
};

const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n));
/** A whole number from the AI (it may send "4" or "4 sets"), bounded; `fallback` when there's none. */
const boundedInt = (value, range, fallback) => {
  const n = parseInt(value, 10);
  return clamp(Number.isFinite(n) ? n : fallback, range);
};

/**
 * Reps as a range the app can show and progress: "8", "8-12", "30-45s",
 * "1 min", "10 per side", or "AMRAP". Numbers are bounded; anything else
 * (prose, instructions, absurd values) becomes "8-12".
 */
function normalizeReps(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^amrap$/.test(text)) return "AMRAP";
  const m = text.match(/^(\d{1,4})(?:\s*(?:-|–|to)\s*(\d{1,4}))?\s*(s|sec|secs|seconds|min|mins|minutes)?(\s+(?:per|each)\s+(?:side|leg|arm))?$/);
  if (!m) return "8-12";
  const unit = m[3] ? (m[3].startsWith("m") ? "min" : "s") : "";
  const range = unit === "min" ? LIMITS.repMinutes : unit === "s" ? LIMITS.seconds : LIMITS.reps;
  const low = clamp(Number(m[1]), range);
  const high = m[2] ? clamp(Number(m[2]), [low, range[1]]) : low;
  return `${low}${high !== low ? `-${high}` : ""}${unit === "min" ? " min" : unit}${m[4] ?? ""}`;
}

/**
 * A progression note for an exercise without one (new, or its sets and reps
 * just changed): move on once every set reaches the top of the rep range.
 */
function progressionNoteFor(exerciseId, reps) {
  const text = String(reps);
  const top = text.match(/(\d+)\D*$/)?.[1];
  if (!top) return "";
  if (/\d\s*s(ec)?\b|min/i.test(text)) return `Hold 5–10 seconds longer once every set reaches ${top} seconds`;
  const weighted = (EXERCISE_DB[exerciseId]?.equipment ?? []).some((tag) => LOAD_EQUIPMENT.includes(tag));
  return weighted ? `Add 2.5 kg once every set reaches ${top} reps` : `Add 2 reps or slow the lowering once every set reaches ${top} reps`;
}

function validateAndSanitizePlan(rawPlan, equipmentTags = equipmentTagsFor(null)) {
  if (!rawPlan || !rawPlan.weeks || !Array.isArray(rawPlan.weeks)) {
    throw new Error("INVALID_PLAN_STRUCTURE");
  }

  if (rawPlan.weeks.length === 0) {
    throw new Error("INVALID_PLAN_STRUCTURE");
  }

  return {
    ...rawPlan,
    planExplanation: aiText(rawPlan.planExplanation, 400) || "AI-generated fitness plan.",
    weeks: rawPlan.weeks.map((week, weekIdx) => ({
      week: week.week || weekIdx + 1,
      isDeloadWeek: week.isDeloadWeek || false,
      days: (week.days || []).map((day) => {
        // Rest days pass through, with their note cleaned
        if (day.sessionType === "rest") {
          return {
            day: day.day || "rest",
            sessionType: "rest",
            recoveryNote: aiText(day.recoveryNote, 160) || "Rest and recover.",
          };
        }

        // Training days get validated
        const targetMuscles = (Array.isArray(day.targetMuscles) ? day.targetMuscles : []).filter((m) => KNOWN_MUSCLES.has(m));
        const dayIds = (day.exercises || []).map((ex) => ex.exerciseId);
        return {
          day: day.day || "training",
          sessionType: day.sessionType || "training",
          targetMuscles,
          estimatedDurationMinutes: boundedInt(day.estimatedDurationMinutes, LIMITS.minutes, 45),
          exercises: (day.exercises || [])
            .slice(0, LIMITS.exercisesPerDay)
            .map((ex) => {
              const known = isValidExerciseId(ex.exerciseId);
              const exerciseId = known ? ex.exerciseId : findSimilarExercise(targetMuscles, equipmentTags, dayIds);

              const reps = normalizeReps(ex.reps ?? "8-12");
              const weight = Number(ex.targetWeight_kg);
              return {
                exerciseId,
                name: EXERCISE_DB[exerciseId].name,
                sets: boundedInt(ex.sets, LIMITS.sets, 3),
                reps,
                restSeconds: boundedInt(ex.restSeconds, LIMITS.restSeconds, 60),
                targetWeight_kg: ex.targetWeight_kg != null && Number.isFinite(weight) && weight >= 0 && weight <= 500 ? weight : null,
                progressionNote: aiText(ex.progressionNote, 140) || progressionNoteFor(exerciseId, reps),
                substitutes: Array.isArray(ex.substitutes) ? ex.substitutes.filter((s) => isValidExerciseId(s)) : [],
                // Keep the swap trail ("Swapped from …") through later edits.
                ...(ex.substitutedFrom ? { substitutedFrom: String(ex.substitutedFrom).slice(0, 80) } : {}),
                ...(ex.substitutionReason ? { substitutionReason: aiText(ex.substitutionReason, 160) } : {}),
              };
            })
            .map((ex, i) => ({ ex, i }))
            .sort((a, b) => exerciseOrderTier(a.ex.exerciseId) - exerciseOrderTier(b.ex.exerciseId) || a.i - b.i)
            .map(({ ex }) => ex),
        };
      }),
    })),
  };
}

/**
 * Why a week (seven plan days) can't be used as an AI change, or [] when it can.
 * The validator already bounds each exercise; these are the rules for the week
 * as a whole, so a change talked into "train every day" is refused.
 */
function weekProblems(days) {
  const problems = [];
  const training = (days ?? []).filter((d) => d.sessionType !== "rest" && d.exercises?.length > 0);
  if (training.length > LIMITS.trainingDaysPerWeek) problems.push("no rest day");
  const names = (days ?? []).map((d) => String(d.day).toLowerCase());
  if (names.some((n) => !WEEKDAYS.includes(n)) || new Set(names).size !== names.length) problems.push("unknown or repeated days");
  return problems;
}

module.exports = { validateAndSanitizePlan, progressionNoteFor, normalizeReps, weekProblems, LIMITS };
