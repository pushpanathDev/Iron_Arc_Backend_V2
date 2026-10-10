/**
 * Server-side exercise database for Iron Arc backend.
 *
 * Purpose:
 * 1. Validate exercise IDs returned by Groq (Groq may hallucinate names)
 * 2. Find biomechanically equivalent substitutes
 *
 * This is the backend safety net. It does NOT need to match exercises.ts
 * in the React Native app exactly — it just needs to cover common exercises
 * so Groq's output can be validated and corrected before reaching the app.
 *
 * Iron Arc's app can also override/extend exercises via exerciseCatalog/v1
 * in Firestore — that is a separate client-side concern, not this file's job.
 */
const EXERCISE_DB = {
  // ── Push (Chest / Shoulders / Triceps) ──────────────────────────────
  bench_press:       { name: 'Barbell Bench Press',     muscles: ['chest', 'triceps', 'shoulders'], equipment: ['barbell'] },
  dumbbell_press:    { name: 'Dumbbell Bench Press',    muscles: ['chest', 'triceps'],              equipment: ['dumbbells'] },
  incline_press:     { name: 'Incline Barbell Press',   muscles: ['chest', 'shoulders'],            equipment: ['barbell'] },
  push_up:           { name: 'Push Up',                 muscles: ['chest', 'triceps'],              equipment: [] },
  overhead_press:    { name: 'Overhead Press',          muscles: ['shoulders', 'triceps'],          equipment: ['barbell'] },
  db_shoulder_press: { name: 'Dumbbell Shoulder Press', muscles: ['shoulders', 'triceps'],          equipment: ['dumbbells'] },
  lateral_raise:     { name: 'Lateral Raise',           muscles: ['shoulders'],                     equipment: ['dumbbells'] },
  tricep_dip:        { name: 'Tricep Dip',              muscles: ['triceps', 'chest'],              equipment: [] },
  tricep_pushdown:   { name: 'Tricep Pushdown',         muscles: ['triceps'],                       equipment: ['cables'] },

  // ── Pull (Back / Biceps) ─────────────────────────────────────────────
  pull_up:           { name: 'Pull Up',                 muscles: ['back', 'biceps'],                equipment: ['pull_up_bar'] },
  lat_pulldown:      { name: 'Lat Pulldown',            muscles: ['back', 'biceps'],                equipment: ['cables'] },
  barbell_row:       { name: 'Barbell Row',             muscles: ['back', 'biceps'],                equipment: ['barbell'] },
  dumbbell_row:      { name: 'Dumbbell Row',            muscles: ['back'],                          equipment: ['dumbbells'] },
  seated_cable_row:  { name: 'Seated Cable Row',        muscles: ['back', 'biceps'],                equipment: ['cables'] },
  bicep_curl:        { name: 'Barbell Bicep Curl',      muscles: ['biceps'],                        equipment: ['barbell'] },
  db_bicep_curl:     { name: 'Dumbbell Bicep Curl',     muscles: ['biceps'],                        equipment: ['dumbbells'] },

  // ── Legs ─────────────────────────────────────────────────────────────
  squat:             { name: 'Barbell Squat',           muscles: ['quads', 'glutes', 'hamstrings'], equipment: ['barbell'] },
  goblet_squat:      { name: 'Goblet Squat',            muscles: ['quads', 'glutes'],               equipment: ['dumbbells'] },
  bodyweight_squat:  { name: 'Bodyweight Squat',        muscles: ['quads', 'glutes'],               equipment: [] },
  deadlift:          { name: 'Deadlift',                muscles: ['hamstrings', 'glutes', 'back'],  equipment: ['barbell'] },
  rdl:               { name: 'Romanian Deadlift',       muscles: ['hamstrings', 'glutes'],          equipment: ['barbell'] },
  leg_press:         { name: 'Leg Press',               muscles: ['quads', 'glutes'],               equipment: ['machines'] },
  lunge:             { name: 'Dumbbell Lunge',          muscles: ['quads', 'glutes'],               equipment: ['dumbbells'] },
  leg_curl:          { name: 'Leg Curl',                muscles: ['hamstrings'],                    equipment: ['machines'] },
  calf_raise:        { name: 'Calf Raise',              muscles: ['calves'],                        equipment: [] },

  // ── Core ─────────────────────────────────────────────────────────────
  plank:             { name: 'Plank',                   muscles: ['core'],                          equipment: [] },
  crunch:            { name: 'Crunch',                  muscles: ['core'],                          equipment: [] },
  leg_raise:         { name: 'Leg Raise',               muscles: ['core'],                          equipment: [] },
  russian_twist:     { name: 'Russian Twist',           muscles: ['core'],                          equipment: [] },

  // ── Cardio / Conditioning ─────────────────────────────────────────────
  jump_rope:         { name: 'Jump Rope',               muscles: [],                                equipment: ['jump_rope'] },
  burpee:            { name: 'Burpee',                  muscles: ['full_body'],                     equipment: [] },
  mountain_climber:  { name: 'Mountain Climber',        muscles: ['core', 'full_body'],             equipment: [] },
};

/**
 * Checks if an exercise ID exists in the server-side database.
 * @param {string} id — exercise ID to validate
 * @returns {boolean}
 */
function isValidExerciseId(id) {
  return Object.prototype.hasOwnProperty.call(EXERCISE_DB, id);
}

/**
 * Finds a biomechanically equivalent substitute exercise.
 *
 * Logic:
 * 1. Find the original exercise's primary muscles
 * 2. Find candidates that share at least one muscle AND are equipment-compatible
 * 3. Return the first match, or 'push_up' as the ultimate safe fallback
 *
 * @param {string} originalId — the exercise to replace
 * @param {string[]} availableEquipment — equipment the user has access to
 * @returns {string} — a valid exercise ID
 */
function getSubstituteExerciseId(originalId, availableEquipment = []) {
  const original = EXERCISE_DB[originalId];

  if (!original) return 'push_up'; // Ultimate safe fallback

  const candidates = Object.entries(EXERCISE_DB).filter(([id, ex]) => {
    if (id === originalId) return false;

    // Must share at least one target muscle
    const sharesMuscle = ex.muscles.some(m => original.muscles.includes(m));

    // Must be bodyweight OR use equipment the user has
    const equipmentCompatible = ex.equipment.length === 0 ||
      ex.equipment.every(e => availableEquipment.includes(e));

    return sharesMuscle && equipmentCompatible;
  });

  return candidates.length > 0 ? candidates[0][0] : 'push_up';
}

module.exports = { EXERCISE_DB, isValidExerciseId, getSubstituteExerciseId };
