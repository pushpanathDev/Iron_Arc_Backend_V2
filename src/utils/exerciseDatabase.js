/**
 * The exercises the AI planner may use: the lists in every plan prompt, the
 * check on ids the AI returns (it can invent names), swaps, and the order of
 * a session. The app has its own, larger exercise list (171); this one holds
 * the ones plans use.
 *
 * name: the one name a plan ever shows, whatever the AI wrote. It must match
 * the app's exercise catalogue (data/exercises.ts) exactly: the app finds
 * past sets, done days and the "Chest · Barbell" label by name.
 *
 * order: where it goes in a session. 1 heavy compound lifts, 2 secondary
 * compounds, 3 isolation, 4 core and conditioning.
 * equipment: what it needs (see EQUIPMENT_TAGS); none means bodyweight.
 * stress: joints it loads hard (knees, lower_back, shoulders, wrists). A user
 * who goes easy on one of them never gets these: they're left out of the
 * AI's list, replaced if the AI uses one anyway, and skipped by swaps.
 *
 * The ids of exercises already in plans never change (ids are stored in plans).
 */
const EXERCISE_DB = {
  // ── Chest ───────────────────────────────────────────────────────────
  bench_press:          { name: "Barbell Bench Press",         order: 1, muscles: ["chest", "triceps", "shoulders"], equipment: ["barbell"] },
  incline_press:        { name: "Incline Barbell Bench Press", order: 1, muscles: ["chest", "shoulders"],            equipment: ["barbell"] },
  close_grip_bench:     { name: "Close-Grip Bench Press",      order: 2, muscles: ["triceps", "chest"],              equipment: ["barbell"], stress: ["wrists"] },
  dumbbell_press:       { name: "Dumbbell Bench Press",        order: 2, muscles: ["chest", "triceps"],              equipment: ["dumbbells"] },
  incline_db_press:     { name: "Incline Dumbbell Press",      order: 2, muscles: ["chest", "shoulders"],            equipment: ["dumbbells"] },
  chest_press_machine:  { name: "Chest Press Machine",         order: 2, muscles: ["chest", "triceps"],              equipment: ["machines"] },
  db_fly:               { name: "Dumbbell Fly",                order: 3, muscles: ["chest"],                         equipment: ["dumbbells"], stress: ["shoulders"] },
  incline_db_fly:       { name: "Incline Dumbbell Fly",        order: 3, muscles: ["chest"],                         equipment: ["dumbbells"], stress: ["shoulders"] },
  cable_crossover:      { name: "Cable Crossover",             order: 3, muscles: ["chest"],                         equipment: ["cables"] },
  low_cable_crossover:  { name: "Low Cable Crossover",         order: 3, muscles: ["chest"],                         equipment: ["cables"] },
  pec_deck:             { name: "Pec Deck Machine",            order: 3, muscles: ["chest"],                         equipment: ["machines"] },
  push_up:              { name: "Push Ups",                    order: 2, muscles: ["chest", "triceps"],              equipment: [], stress: ["wrists"] },
  incline_push_up:      { name: "Incline Push Ups",            order: 2, muscles: ["chest", "triceps"],              equipment: [], stress: ["wrists"] },
  diamond_push_up:      { name: "Diamond Push Ups",            order: 3, muscles: ["triceps", "chest"],              equipment: [], stress: ["wrists"] },
  chest_dip:            { name: "Dips (Chest)",                order: 2, muscles: ["chest", "triceps"],              equipment: [], stress: ["shoulders"] },

  // ── Shoulders ───────────────────────────────────────────────────────
  overhead_press:       { name: "Barbell Overhead Press",      order: 1, muscles: ["shoulders", "triceps"],          equipment: ["barbell"], stress: ["shoulders"] },
  db_shoulder_press:    { name: "Dumbbell Shoulder Press",     order: 2, muscles: ["shoulders", "triceps"],          equipment: ["dumbbells"] },
  arnold_press:         { name: "Arnold Press",                order: 2, muscles: ["shoulders"],                     equipment: ["dumbbells"], stress: ["shoulders"] },
  machine_shoulder_press: { name: "Machine Shoulder Press",    order: 2, muscles: ["shoulders", "triceps"],          equipment: ["machines"] },
  landmine_press:       { name: "Landmine Press",              order: 2, muscles: ["shoulders", "chest"],            equipment: ["barbell"] },
  pike_push_up:         { name: "Pike Push Ups",               order: 2, muscles: ["shoulders", "triceps"],          equipment: [], stress: ["shoulders", "wrists"] },
  lateral_raise:        { name: "Lateral Raise",               order: 3, muscles: ["shoulders"],                     equipment: ["dumbbells"] },
  cable_lateral_raise:  { name: "Cable Lateral Raise",         order: 3, muscles: ["shoulders"],                     equipment: ["cables"] },
  front_raise:          { name: "Front Raise",                 order: 3, muscles: ["shoulders"],                     equipment: ["dumbbells"] },
  rear_delt_fly:        { name: "Rear Delt Fly",               order: 3, muscles: ["shoulders", "back"],             equipment: ["dumbbells"] },
  face_pull:            { name: "Face Pull",                   order: 3, muscles: ["shoulders", "back"],             equipment: ["cables"] },
  reverse_pec_deck:     { name: "Reverse Pec Deck",            order: 3, muscles: ["shoulders", "back"],             equipment: ["machines"] },
  db_shrug:             { name: "Dumbbell Shrugs",             order: 3, muscles: ["back"],                          equipment: ["dumbbells"] },
  barbell_shrug:        { name: "Barbell Shrugs",              order: 3, muscles: ["back"],                          equipment: ["barbell"] },

  // ── Back ────────────────────────────────────────────────────────────
  pull_up:              { name: "Pull Ups",                    order: 1, muscles: ["back", "biceps"],                equipment: ["pull_up_bar"] },
  chin_up:              { name: "Chin Ups",                    order: 1, muscles: ["back", "biceps"],                equipment: ["pull_up_bar"] },
  barbell_row:          { name: "Barbell Row",                 order: 1, muscles: ["back", "biceps"],                equipment: ["barbell"], stress: ["lower_back"] },
  tbar_row:             { name: "T-Bar Row",                   order: 1, muscles: ["back", "biceps"],                equipment: ["barbell"], stress: ["lower_back"] },
  lat_pulldown:         { name: "Lat Pulldown",                order: 2, muscles: ["back", "biceps"],                equipment: ["cables"] },
  close_grip_pulldown:  { name: "Close Grip Lat Pulldown",     order: 2, muscles: ["back", "biceps"],                equipment: ["cables"] },
  dumbbell_row:         { name: "Dumbbell Row",                order: 2, muscles: ["back"],                          equipment: ["dumbbells"] },
  seated_cable_row:     { name: "Seated Cable Row",            order: 2, muscles: ["back", "biceps"],                equipment: ["cables"] },
  one_arm_cable_row:    { name: "One Arm Cable Row",           order: 2, muscles: ["back"],                          equipment: ["cables"] },
  machine_row:          { name: "Machine Row",                 order: 2, muscles: ["back", "biceps"],                equipment: ["machines"] },
  inverted_row:         { name: "Inverted Row",                order: 2, muscles: ["back", "biceps"],                equipment: ["pull_up_bar"] },
  straight_arm_pulldown: { name: "Straight Arm Pulldown",      order: 3, muscles: ["back"],                          equipment: ["cables"] },
  hyperextension:       { name: "Hyperextension",              order: 3, muscles: ["back", "glutes", "hamstrings"],  equipment: ["machines"], stress: ["lower_back"] },

  // ── Legs ────────────────────────────────────────────────────────────
  squat:                { name: "Barbell Back Squat",          order: 1, muscles: ["quads", "glutes", "hamstrings"], equipment: ["barbell"], stress: ["knees", "lower_back"] },
  front_squat:          { name: "Front Squat",                 order: 1, muscles: ["quads", "glutes"],               equipment: ["barbell"], stress: ["knees", "wrists"] },
  deadlift:             { name: "Deadlift",                    order: 1, muscles: ["hamstrings", "glutes", "back"],  equipment: ["barbell"], stress: ["lower_back"] },
  goblet_squat:         { name: "Goblet Squat",                order: 2, muscles: ["quads", "glutes"],               equipment: ["dumbbells"] },
  bodyweight_squat:     { name: "Bodyweight Squat",            order: 2, muscles: ["quads", "glutes"],               equipment: [] },
  hack_squat:           { name: "Hack Squat",                  order: 2, muscles: ["quads", "glutes"],               equipment: ["machines"], stress: ["knees"] },
  leg_press:            { name: "Leg Press",                   order: 2, muscles: ["quads", "glutes"],               equipment: ["machines"] },
  bulgarian_split_squat: { name: "Bulgarian Split Squat",      order: 2, muscles: ["quads", "glutes"],               equipment: ["dumbbells"], stress: ["knees"] },
  lunge:                { name: "Walking Lunges",              order: 2, muscles: ["quads", "glutes"],               equipment: ["dumbbells"], stress: ["knees"] },
  reverse_lunge:        { name: "Reverse Lunges",              order: 2, muscles: ["quads", "glutes"],               equipment: [] },
  step_up:              { name: "Step Ups",                    order: 2, muscles: ["quads", "glutes"],               equipment: [] },
  rdl:                  { name: "Romanian Deadlift",           order: 2, muscles: ["hamstrings", "glutes"],          equipment: ["barbell"], stress: ["lower_back"] },
  hip_thrust:           { name: "Hip Thrust",                  order: 2, muscles: ["glutes", "hamstrings"],          equipment: ["barbell"] },
  leg_extension:        { name: "Leg Extension",               order: 3, muscles: ["quads"],                         equipment: ["machines"], stress: ["knees"] },
  leg_curl:             { name: "Lying Leg Curl",              order: 3, muscles: ["hamstrings"],                    equipment: ["machines"] },
  seated_leg_curl:      { name: "Seated Leg Curl",             order: 3, muscles: ["hamstrings"],                    equipment: ["machines"] },
  glute_bridge:         { name: "Glute Bridge",                order: 3, muscles: ["glutes", "hamstrings"],          equipment: [] },
  cable_pull_through:   { name: "Cable Pull Through",          order: 3, muscles: ["glutes", "hamstrings"],          equipment: ["cables"] },
  calf_raise:           { name: "Standing Calf Raise",         order: 3, muscles: ["calves"],                        equipment: [] },
  seated_calf_raise:    { name: "Seated Calf Raise",           order: 3, muscles: ["calves"],                        equipment: ["machines"] },
  wall_sit:             { name: "Wall Sit",                    order: 4, muscles: ["quads"],                         equipment: [], stress: ["knees"] },

  // ── Arms ────────────────────────────────────────────────────────────
  bicep_curl:           { name: "Barbell Curl",                order: 3, muscles: ["biceps"],                        equipment: ["barbell"], stress: ["wrists"] },
  ez_bar_curl:          { name: "EZ Bar Curl",                 order: 3, muscles: ["biceps"],                        equipment: ["barbell"] },
  preacher_curl:        { name: "Preacher Curl",               order: 3, muscles: ["biceps"],                        equipment: ["barbell"] },
  db_bicep_curl:        { name: "Dumbbell Curl",               order: 3, muscles: ["biceps"],                        equipment: ["dumbbells"] },
  hammer_curl:          { name: "Hammer Curl",                 order: 3, muscles: ["biceps"],                        equipment: ["dumbbells"] },
  incline_db_curl:      { name: "Incline Dumbbell Curl",       order: 3, muscles: ["biceps"],                        equipment: ["dumbbells"] },
  concentration_curl:   { name: "Concentration Curl",          order: 3, muscles: ["biceps"],                        equipment: ["dumbbells"] },
  cable_curl:           { name: "Cable Curl",                  order: 3, muscles: ["biceps"],                        equipment: ["cables"] },
  tricep_dip:           { name: "Dips (Triceps)",              order: 2, muscles: ["triceps", "chest"],              equipment: [], stress: ["shoulders"] },
  skull_crusher:        { name: "Skull Crushers",              order: 3, muscles: ["triceps"],                       equipment: ["barbell"], stress: ["wrists"] },
  overhead_tricep_ext:  { name: "Overhead Tricep Extension",   order: 3, muscles: ["triceps"],                       equipment: ["dumbbells"] },
  db_kickback:          { name: "Dumbbell Kickback",           order: 3, muscles: ["triceps"],                       equipment: ["dumbbells"] },
  tricep_pushdown:      { name: "Tricep Pushdown",             order: 3, muscles: ["triceps"],                       equipment: ["cables"] },
  rope_pushdown:        { name: "Rope Pushdown",               order: 3, muscles: ["triceps"],                       equipment: ["cables"] },

  // ── Core ────────────────────────────────────────────────────────────
  plank:                { name: "Plank",                       order: 4, muscles: ["core"],                          equipment: [] },
  side_plank:           { name: "Side Plank",                  order: 4, muscles: ["core"],                          equipment: [] },
  dead_bug:             { name: "Dead Bug",                    order: 4, muscles: ["core"],                          equipment: [] },
  hollow_hold:          { name: "Hollow Body Hold",            order: 4, muscles: ["core"],                          equipment: [] },
  crunch:               { name: "Crunches",                    order: 4, muscles: ["core"],                          equipment: [] },
  bicycle_crunch:       { name: "Bicycle Crunch",              order: 4, muscles: ["core"],                          equipment: [] },
  reverse_crunch:       { name: "Reverse Crunch",              order: 4, muscles: ["core"],                          equipment: [] },
  leg_raise:            { name: "Leg Raise",                   order: 4, muscles: ["core"],                          equipment: [] },
  hanging_leg_raise:    { name: "Hanging Leg Raise",           order: 4, muscles: ["core"],                          equipment: ["pull_up_bar"] },
  cable_crunch:         { name: "Cable Crunch",                order: 4, muscles: ["core"],                          equipment: ["cables"] },
  russian_twist:        { name: "Russian Twist",               order: 4, muscles: ["core"],                          equipment: [] },

  // ── Conditioning ────────────────────────────────────────────────────
  farmers_walk:         { name: "Farmer's Walk",               order: 4, muscles: ["full_body"],                     equipment: ["dumbbells"] },
  rowing_machine:       { name: "Rowing Machine",              order: 4, muscles: ["full_body"],                     equipment: ["machines"] },
  stationary_bike:      { name: "Stationary Bike",             order: 4, muscles: [],                                equipment: ["machines"] },
  jump_rope:            { name: "Jump Rope",                   order: 4, muscles: [],                                equipment: ["jump_rope"], stress: ["knees"] },
  jumping_jacks:        { name: "Jumping Jacks",               order: 4, muscles: ["full_body"],                     equipment: [], stress: ["knees"] },
  burpee:               { name: "Burpees",                     order: 4, muscles: ["full_body"],                     equipment: [], stress: ["knees", "wrists"] },
  mountain_climber:     { name: "Mountain Climbers",           order: 4, muscles: ["core", "full_body"],             equipment: [], stress: ["wrists"] },
};

/** The joints "Go easy on" can protect (the profile's avoidAreas). */
const STRESS_AREAS = ["knees", "lower_back", "shoulders", "wrists"];
const AREA_NAMES = { knees: "knees", lower_back: "lower back", shoulders: "shoulders", wrists: "wrists" };

/** The areas among `avoid` this exercise loads hard. */
const stressedAreas = (id, avoid) => (EXERCISE_DB[id]?.stress ?? []).filter((area) => avoid.includes(area));

/**
 * The exercises in `plan`'s week that the areas to go easy on rule out (a
 * plan made before they were set), as "Barbell Back Squat (knees)". For the
 * coach, so it replaces them and says why.
 */
function ruledOutIn(days, avoid) {
  const found = new Map();
  for (const day of days ?? []) for (const ex of day.exercises ?? []) {
    const areas = stressedAreas(ex.exerciseId, avoid);
    if (areas.length > 0) found.set(ex.exerciseId, `${EXERCISE_DB[ex.exerciseId].name} (${areas.map((a) => AREA_NAMES[a]).join(", ")})`);
  }
  return [...found.values()];
}

/**
 * When the validator swapped exercises the AI chose that "go easy on" rules
 * out, the line that says so ("To go easy on your knees, this uses Goblet
 * Squat instead of Barbell Back Squat."), so the coach's message never names
 * an exercise the suggestion doesn't have. `aiDays` are the AI's short-key
 * days, `days` the checked week. Null when nothing was swapped.
 */
function goEasySwapNote(aiDays, days, avoid) {
  if (avoid.length === 0 || !Array.isArray(aiDays)) return null;
  const pairs = new Map();
  const areas = new Set();
  for (const aiDay of aiDays) {
    const asked = (aiDay?.x ?? []).map((x) => x?.id);
    const out = asked.filter((id) => stressedAreas(id, avoid).length > 0);
    if (out.length === 0) continue;
    const day = (days ?? []).find((d) => d.day === aiDay.d);
    const added = (day?.exercises ?? []).map((ex) => ex.exerciseId).filter((id) => !asked.includes(id));
    out.forEach((id, i) => {
      if (!added[i]) return;
      pairs.set(`${added[i]}<${id}`, `${EXERCISE_DB[added[i]].name} instead of ${EXERCISE_DB[id].name}`);
      stressedAreas(id, avoid).forEach((area) => areas.add(AREA_NAMES[area]));
    });
  }
  if (pairs.size === 0) return null;
  const list = (items) => (items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items.at(-1)}` : items[0]);
  return `To go easy on your ${list([...areas])}, this uses ${list([...pairs.values()])}.`;
}

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

/** The areas to go easy on, from a profile's avoidAreas (unknown ones ignored). */
const avoidAreasOf = (user) => (Array.isArray(user?.avoidAreas) ? user.avoidAreas.filter((a) => STRESS_AREAS.includes(a)) : []);

/** Usable with this equipment and kind to these areas. */
const allowedBy = (equipmentTags, avoid = []) => (ex) => ex.equipment.every((tag) => equipmentTags.includes(tag)) && !(ex.stress ?? []).some((area) => avoid.includes(area));

/** Every exercise id this equipment allows and the areas to go easy on don't rule out, in the order above (the list the AI picks from). */
function allowedExerciseIds(equipmentTags, avoid = []) {
  return Object.keys(EXERCISE_DB).filter((id) => allowedBy(equipmentTags, avoid)(EXERCISE_DB[id]));
}

/** True when this id may appear in a plan with this equipment and these areas. */
const isAllowedExercise = (id, equipmentTags, avoid = []) => isValidExerciseId(id) && allowedBy(equipmentTags, avoid)(EXERCISE_DB[id]);

/**
 * The allowed exercise closest to these muscles (the first is the main one),
 * skipping the ids in `exclude`: muscles shared, the same main muscle (a
 * squat's stand-in works the quads), then the same place in a session
 * (`order`), then the list's order. Falls back to a push-up, or a plank when
 * push-ups are ruled out.
 */
function findSimilarExercise(muscles, equipmentTags, exclude = [], { avoid = [], order } = {}) {
  let best = null;
  let bestScore = 0;
  for (const [id, ex] of Object.entries(EXERCISE_DB)) {
    if (exclude.includes(id) || !allowedBy(equipmentTags, avoid)(ex)) continue;
    const shared = ex.muscles.filter((m) => muscles.includes(m)).length;
    if (shared === 0) continue;
    const score = shared * 2 + (ex.muscles[0] === muscles[0] ? 2 : 0) + (order && ex.order === order ? 1 : 0);
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  if (best) return best;
  return allowedBy(equipmentTags, avoid)(EXERCISE_DB.push_up) && !exclude.includes("push_up") ? "push_up" : "plank";
}

/** A different exercise for the same muscles and place in a session, usable with this equipment and kind to these areas. */
function getSubstituteExerciseId(originalId, equipmentTags, avoid = []) {
  const original = EXERCISE_DB[originalId];
  return findSimilarExercise(original?.muscles ?? [], equipmentTags, [originalId], { avoid, order: original?.order });
}

/** Where an exercise goes in a session (1–4, see above); unknown ones sit with isolation work. */
function exerciseOrderTier(id) {
  return EXERCISE_DB[id]?.order ?? 3;
}

module.exports = {
  EXERCISE_DB,
  STRESS_AREAS,
  ruledOutIn,
  goEasySwapNote,
  isValidExerciseId,
  isAllowedExercise,
  equipmentTagsFor,
  avoidAreasOf,
  allowedExerciseIds,
  findSimilarExercise,
  getSubstituteExerciseId,
  exerciseOrderTier,
};
