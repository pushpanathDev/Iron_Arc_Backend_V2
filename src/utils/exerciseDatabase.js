/**
 * The exercises the AI planner may use: the lists in every plan prompt, the
 * check on ids the AI returns (it can invent names), swaps, and the order of
 * a session. The app has its own, larger exercise list; this one only has to
 * cover what plans use.
 *
 * name: the one name a plan ever shows, whatever the AI wrote. It must match
 * the app's exercise catalogue (data/exercises.ts) exactly: the app finds
 * past sets, done days and the "Chest · Barbell" label by name.
 *
 * order: where it goes in a session. 1 heavy compound lifts, 2 secondary
 * compounds, 3 isolation, 4 core and conditioning.
 * equipment: what it needs (see EQUIPMENT_TAGS); none means bodyweight.
 */
const EXERCISE_DB = {
  // ── Push (Chest / Shoulders / Triceps) ──────────────────────────────
  bench_press:       { name: "Barbell Bench Press",     order: 1, muscles: ["chest", "triceps", "shoulders"], equipment: ["barbell"] },
  dumbbell_press:    { name: "Dumbbell Bench Press",    order: 2, muscles: ["chest", "triceps"],              equipment: ["dumbbells"] },
  incline_press:     { name: "Incline Barbell Bench Press", order: 1, muscles: ["chest", "shoulders"],            equipment: ["barbell"] },
  push_up:           { name: "Push Ups",                order: 2, muscles: ["chest", "triceps"],              equipment: [] },
  overhead_press:    { name: "Barbell Overhead Press",  order: 1, muscles: ["shoulders", "triceps"],          equipment: ["barbell"] },
  db_shoulder_press: { name: "Dumbbell Shoulder Press", order: 2, muscles: ["shoulders", "triceps"],          equipment: ["dumbbells"] },
  lateral_raise:     { name: "Lateral Raise",           order: 3, muscles: ["shoulders"],                     equipment: ["dumbbells"] },
  tricep_dip:        { name: "Dips (Triceps)",          order: 2, muscles: ["triceps", "chest"],              equipment: [] },
  tricep_pushdown:   { name: "Tricep Pushdown",         order: 3, muscles: ["triceps"],                       equipment: ["cables"] },

  // ── Pull (Back / Biceps) ─────────────────────────────────────────────
  pull_up:           { name: "Pull Ups",                order: 1, muscles: ["back", "biceps"],                equipment: ["pull_up_bar"] },
  lat_pulldown:      { name: "Lat Pulldown",            order: 2, muscles: ["back", "biceps"],                equipment: ["cables"] },
  barbell_row:       { name: "Barbell Row",             order: 1, muscles: ["back", "biceps"],                equipment: ["barbell"] },
  dumbbell_row:      { name: "Dumbbell Row",            order: 2, muscles: ["back"],                          equipment: ["dumbbells"] },
  seated_cable_row:  { name: "Seated Cable Row",        order: 2, muscles: ["back", "biceps"],                equipment: ["cables"] },
  bicep_curl:        { name: "Barbell Curl",            order: 3, muscles: ["biceps"],                        equipment: ["barbell"] },
  db_bicep_curl:     { name: "Dumbbell Curl",           order: 3, muscles: ["biceps"],                        equipment: ["dumbbells"] },

  // ── Legs ─────────────────────────────────────────────────────────────
  squat:             { name: "Barbell Back Squat",      order: 1, muscles: ["quads", "glutes", "hamstrings"], equipment: ["barbell"] },
  goblet_squat:      { name: "Goblet Squat",            order: 2, muscles: ["quads", "glutes"],               equipment: ["dumbbells"] },
  bodyweight_squat:  { name: "Bodyweight Squat",        order: 2, muscles: ["quads", "glutes"],               equipment: [] },
  deadlift:          { name: "Deadlift",                order: 1, muscles: ["hamstrings", "glutes", "back"],  equipment: ["barbell"] },
  rdl:               { name: "Romanian Deadlift",       order: 2, muscles: ["hamstrings", "glutes"],          equipment: ["barbell"] },
  leg_press:         { name: "Leg Press",               order: 2, muscles: ["quads", "glutes"],               equipment: ["machines"] },
  lunge:             { name: "Walking Lunges",          order: 2, muscles: ["quads", "glutes"],               equipment: ["dumbbells"] },
  leg_curl:          { name: "Lying Leg Curl",          order: 3, muscles: ["hamstrings"],                    equipment: ["machines"] },
  calf_raise:        { name: "Standing Calf Raise",     order: 3, muscles: ["calves"],                        equipment: [] },

  // ── Core ─────────────────────────────────────────────────────────────
  plank:             { name: "Plank",                   order: 4, muscles: ["core"],                          equipment: [] },
  crunch:            { name: "Crunches",                order: 4, muscles: ["core"],                          equipment: [] },
  leg_raise:         { name: "Leg Raise",               order: 4, muscles: ["core"],                          equipment: [] },
  russian_twist:     { name: "Russian Twist",           order: 4, muscles: ["core"],                          equipment: [] },

  // ── Cardio / Conditioning ─────────────────────────────────────────────
  jump_rope:         { name: "Jump Rope",               order: 4, muscles: [],                                equipment: ["jump_rope"] },
  burpee:            { name: "Burpees",                 order: 4, muscles: ["full_body"],                     equipment: [] },
  mountain_climber:  { name: "Mountain Climbers",       order: 4, muscles: ["core", "full_body"],             equipment: [] },
};

function isValidExerciseId(id) {
  return Object.prototype.hasOwnProperty.call(EXERCISE_DB, id);
}

/**
 * The equipment tags each training-profile choice gives access to. A pull-up
 * bar and a rope are assumed everywhere. No choice yet means a full gym, as in
 * the plan prompt.
 */
const EQUIPMENT_TAGS = {
  full_gym: ["barbell", "dumbbells", "cables", "machines", "pull_up_bar", "jump_rope"],
  dumbbells: ["dumbbells", "pull_up_bar", "jump_rope"],
  bodyweight: ["pull_up_bar", "jump_rope"],
};

function equipmentTagsFor(equipment) {
  return EQUIPMENT_TAGS[equipment] ?? EQUIPMENT_TAGS.full_gym;
}

const usableWith = (equipmentTags) => (ex) => ex.equipment.every((tag) => equipmentTags.includes(tag));

/** Every exercise id this equipment allows, in the order above (the list the AI picks from). */
function allowedExerciseIds(equipmentTags) {
  return Object.keys(EXERCISE_DB).filter((id) => usableWith(equipmentTags)(EXERCISE_DB[id]));
}

/**
 * The first exercise that trains one of these muscles with this equipment,
 * skipping the ids in `exclude`. Falls back to a push-up, which needs nothing.
 */
function findSimilarExercise(muscles, equipmentTags, exclude = []) {
  const match = Object.entries(EXERCISE_DB).find(([id, ex]) =>
    !exclude.includes(id) &&
    usableWith(equipmentTags)(ex) &&
    ex.muscles.some((m) => muscles.includes(m)),
  );
  return match ? match[0] : "push_up";
}

/** A different exercise for the same muscles, usable with this equipment. */
function getSubstituteExerciseId(originalId, equipmentTags) {
  return findSimilarExercise(EXERCISE_DB[originalId]?.muscles ?? [], equipmentTags, [originalId]);
}

/** Where an exercise goes in a session (1–4, see above); unknown ones sit with isolation work. */
function exerciseOrderTier(id) {
  return EXERCISE_DB[id]?.order ?? 3;
}

module.exports = {
  EXERCISE_DB,
  isValidExerciseId,
  equipmentTagsFor,
  allowedExerciseIds,
  findSimilarExercise,
  getSubstituteExerciseId,
  exerciseOrderTier,
};
