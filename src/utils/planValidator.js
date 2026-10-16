const { EXERCISE_DB, isValidExerciseId, equipmentTagsFor, findSimilarExercise, exerciseOrderTier } = require('./exerciseDatabase');

/**
 * Validates and sanitizes the JSON plan returned by the AI before it is
 * saved or sent to the app.
 *
 * Edge Cases:
 * - Malformed structure → throws INVALID_PLAN_STRUCTURE (caller handles retry)
 * - Made-up exercise IDs → replaced with a known exercise for the same day's
 *   muscles and the user's equipment (named after the replacement)
 * - Negative sets/reps → corrected to minimum safe values
 * - More than 8 exercises in one session → trimmed (volume safety)
 * - Missing optional fields → safe defaults applied
 * - Exercises in training order: big compound lifts first, isolation and core last
 *   (stable, so the AI's order is kept within each tier)
 */
function validateAndSanitizePlan(rawPlan, equipmentTags = equipmentTagsFor(null)) {
  if (!rawPlan || !rawPlan.weeks || !Array.isArray(rawPlan.weeks)) {
    throw new Error('INVALID_PLAN_STRUCTURE');
  }

  if (rawPlan.weeks.length === 0) {
    throw new Error('INVALID_PLAN_STRUCTURE');
  }

  return {
    ...rawPlan,
    planExplanation: rawPlan.planExplanation || 'AI-generated fitness plan.',
    weeks: rawPlan.weeks.map((week, weekIdx) => ({
      week: week.week || weekIdx + 1,
      isDeloadWeek: week.isDeloadWeek || false,
      days: (week.days || []).map(day => {
        // Rest days pass through unchanged
        if (day.sessionType === 'rest') {
          return {
            day: day.day || 'rest',
            sessionType: 'rest',
            recoveryNote: day.recoveryNote || 'Rest and recover.',
          };
        }

        // Training days get validated
        const dayIds = (day.exercises || []).map((ex) => ex.exerciseId);
        return {
          day: day.day || 'training',
          sessionType: day.sessionType || 'training',
          targetMuscles: day.targetMuscles || [],
          estimatedDurationMinutes: Math.max(15, parseInt(day.estimatedDurationMinutes) || 45),
          exercises: (day.exercises || [])
            .slice(0, 8) // Max 8 exercises per session (volume safety)
            .map(ex => {
              const known = isValidExerciseId(ex.exerciseId);
              const exerciseId = known
                ? ex.exerciseId
                : findSimilarExercise(day.targetMuscles || [], equipmentTags, dayIds);

              return {
                exerciseId,
                name: known ? ex.name || EXERCISE_DB[exerciseId].name : EXERCISE_DB[exerciseId].name,
                sets: Math.max(1, parseInt(ex.sets) || 3),
                reps: ex.reps || '8-12',
                restSeconds: Math.max(30, parseInt(ex.restSeconds) || 60),
                targetWeight_kg: ex.targetWeight_kg ?? null,
                progressionNote: ex.progressionNote || '',
                substitutes: Array.isArray(ex.substitutes)
                  ? ex.substitutes.filter(s => isValidExerciseId(s))
                  : [],
                // Keep the swap trail ("Swapped from …") through later edits.
                ...(ex.substitutedFrom ? { substitutedFrom: ex.substitutedFrom } : {}),
                ...(ex.substitutionReason ? { substitutionReason: ex.substitutionReason } : {}),
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

module.exports = { validateAndSanitizePlan };
