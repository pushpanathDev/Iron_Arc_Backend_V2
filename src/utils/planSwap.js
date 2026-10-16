/**
 * Finding and swapping one exercise in a plan. An exercise can be asked for
 * by its id or its name, in any letter case.
 */

function isExercise(ex, wanted) {
  const target = String(wanted).toLowerCase();
  return [ex.exerciseId, ex.id, ex.name].some((v) => typeof v === "string" && v.toLowerCase() === target);
}

const allExercises = (planData) => (planData?.weeks ?? []).flatMap((week) => (week.days ?? []).flatMap((day) => day.exercises ?? []));

function planHasExercise(planData, wanted) {
  return allExercises(planData).some((ex) => isExercise(ex, wanted));
}

/** The plan's own name for an exercise (the first match), or null. */
function exerciseNameIn(planData, wanted) {
  return allExercises(planData).find((ex) => isExercise(ex, wanted) && ex.name)?.name ?? null;
}

/**
 * A copy of the plan with every match of `wanted` replaced by the new
 * exercise. Each swapped entry remembers what it was (substitutedFrom) and why.
 */
function applySubstitution(planData, wanted, replacement) {
  const updated = structuredClone(planData);
  for (const week of updated.weeks ?? []) {
    for (const day of week.days ?? []) {
      if (!Array.isArray(day.exercises)) continue;
      day.exercises = day.exercises.map((ex) =>
        isExercise(ex, wanted)
          ? {
              ...ex,
              exerciseId: replacement.id,
              id: replacement.id,
              name: replacement.name,
              substitutedFrom: ex.exerciseId ?? ex.id ?? ex.name,
              substitutionReason: replacement.reason,
            }
          : ex,
      );
    }
  }
  return updated;
}

module.exports = { planHasExercise, exerciseNameIn, applySubstitution };
