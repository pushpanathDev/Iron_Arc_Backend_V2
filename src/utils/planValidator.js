const { isValidExerciseId, getSubstituteExerciseId } = require('./exerciseDatabase');

/**
 * Validates and sanitizes the JSON plan returned by Gemini before
 * it is saved to Firestore or returned to the Iron Arc React Native app.
 *
 * Edge Cases:
 * - Malformed structure → throws INVALID_PLAN_STRUCTURE (caller handles retry)
 * - Hallucinated exercise IDs → silently substituted with valid equivalents
 * - Negative sets/reps → corrected to minimum safe values
 * - More than 8 exercises in one session → trimmed (volume safety)
 * - Missing optional fields → safe defaults applied
 */
function validateAndSanitizePlan(rawPlan, availableEquipment = []) {
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
        return {
          day: day.day || 'training',
          sessionType: day.sessionType || 'training',
          targetMuscles: day.targetMuscles || [],
          estimatedDurationMinutes: Math.max(15, parseInt(day.estimatedDurationMinutes) || 45),
          exercises: (day.exercises || [])
            .slice(0, 8) // Max 8 exercises per session (volume safety)
            .map(ex => {
              // Validate exercise ID — substitute if hallucinated
              const exerciseId = isValidExerciseId(ex.exerciseId)
                ? ex.exerciseId
                : getSubstituteExerciseId(ex.exerciseId, availableEquipment);

              return {
                exerciseId,
                name: ex.name || exerciseId,
                sets: Math.max(1, parseInt(ex.sets) || 3),
                reps: ex.reps || '8-12',
                restSeconds: Math.max(30, parseInt(ex.restSeconds) || 60),
                targetWeight_kg: ex.targetWeight_kg ?? null,
                progressionNote: ex.progressionNote || '',
                substitutes: Array.isArray(ex.substitutes)
                  ? ex.substitutes.filter(s => isValidExerciseId(s))
                  : [],
              };
            }),
        };
      }),
    })),
  };
}

module.exports = { validateAndSanitizePlan };
