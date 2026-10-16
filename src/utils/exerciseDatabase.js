/**
 * The exercises the AI planner may use. Used to check the ids the AI returns
 * (it can invent names) and to find a similar exercise to swap in. The app has
 * its own, larger exercise list; this one only has to cover what plans use.
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
 * The equipment tags each training-profile choice gives access to (the
 * "equipment" lists above). A pull-up bar and a rope are assumed everywhere.
 * No choice yet means a full gym, as in the plan prompt.
 */
const EQUIPMENT_TAGS = {
  full_gym: ['barbell', 'dumbbells', 'cables', 'machines', 'pull_up_bar', 'jump_rope'],
  dumbbells: ['dumbbells', 'pull_up_bar', 'jump_rope'],
  bodyweight: ['pull_up_bar', 'jump_rope'],
};

function equipmentTagsFor(equipment) {
  return EQUIPMENT_TAGS[equipment] ?? EQUIPMENT_TAGS.full_gym;
}

/**
 * The first exercise that trains one of these muscles with this equipment,
 * skipping the ids in `exclude`. Falls back to a push-up, which needs nothing.
 */
function findSimilarExercise(muscles, equipmentTags, exclude = []) {
  const match = Object.entries(EXERCISE_DB).find(([id, ex]) =>
    !exclude.includes(id) &&
    ex.equipment.every((tag) => equipmentTags.includes(tag)) &&
    ex.muscles.some((m) => muscles.includes(m)),
  );
  return match ? match[0] : 'push_up';
}

/** A different exercise for the same muscles, usable with this equipment. */
function getSubstituteExerciseId(originalId, equipmentTags) {
  return findSimilarExercise(EXERCISE_DB[originalId]?.muscles ?? [], equipmentTags, [originalId]);
}

/*
 * Training order within a session: heavy compound lifts first, then
 * secondary compounds, then isolation work, then core and conditioning.
 */
const ORDER_TIERS = {
  1: ["squat", "deadlift", "bench_press", "incline_press", "overhead_press", "barbell_row", "pull_up"],
  2: ["dumbbell_press", "db_shoulder_press", "push_up", "tricep_dip", "lat_pulldown", "dumbbell_row", "seated_cable_row", "rdl", "leg_press", "goblet_squat", "lunge", "bodyweight_squat"],
  3: ["lateral_raise", "tricep_pushdown", "bicep_curl", "db_bicep_curl", "leg_curl", "calf_raise"],
  4: ["plank", "crunch", "leg_raise", "russian_twist", "jump_rope", "burpee", "mountain_climber"],
};
const ORDER_OF = new Map(Object.entries(ORDER_TIERS).flatMap(([tier, ids]) => ids.map((id) => [id, Number(tier)])));

/** 1 (big compound) … 4 (core/conditioning); unknown exercises sit with isolation work. */
function exerciseOrderTier(id) {
  return ORDER_OF.get(id) ?? 3;
}

module.exports = {
  EXERCISE_DB,
  isValidExerciseId,
  equipmentTagsFor,
  findSimilarExercise,
  getSubstituteExerciseId,
  exerciseOrderTier,
};
