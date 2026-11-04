const { test } = require("node:test");
const assert = require("node:assert/strict");
const { equipmentTagsFor, getSubstituteExerciseId, EXERCISE_DB, allowedExerciseIds, avoidAreasOf, STRESS_AREAS, ruledOutIn, goEasySwapNote } = require("./exerciseDatabase");
const { validateAndSanitizePlan } = require("./planValidator");

const trainingDay = (targetMuscles, exercises) => ({ weeks: [{ week: 1, days: [{ day: "monday", sessionType: "training", targetMuscles, exercises }] }] });
const exercisesOf = (plan) => plan.weeks[0].days[0].exercises;
const fits = (id, equipment) => EXERCISE_DB[id].equipment.every((tag) => equipmentTagsFor(equipment).includes(tag));

test("no equipment choice yet means a full gym", () => {
  assert.deepEqual(equipmentTagsFor(null), equipmentTagsFor("full_gym"));
});

test("a swap fits the user's equipment and trains the same muscles", () => {
  for (const equipment of ["full_gym", "dumbbells", "bodyweight"]) {
    const swap = getSubstituteExerciseId("bench_press", equipmentTagsFor(equipment));
    assert.notEqual(swap, "bench_press");
    assert.ok(fits(swap, equipment), `${swap} needs equipment a ${equipment} user lacks`);
    assert.ok(EXERCISE_DB[swap].muscles.some((m) => EXERCISE_DB.bench_press.muscles.includes(m)));
  }
});

test("a gym user's swap can use gym equipment (it used to be bodyweight only)", () => {
  const gym = getSubstituteExerciseId("bench_press", equipmentTagsFor("full_gym"));
  assert.ok(gym !== "bench_press" && EXERCISE_DB[gym].muscles.includes("chest") && EXERCISE_DB[gym].equipment.length > 0, gym);
  assert.equal(getSubstituteExerciseId("bench_press", equipmentTagsFor("bodyweight")), "push_up");
});

test("a made-up exercise is replaced for that day's muscles, and named after the replacement", () => {
  const plan = validateAndSanitizePlan(trainingDay(["back"], [{ exerciseId: "cable_pullover", name: "Cable Pullover", sets: 3, reps: "10" }]), equipmentTagsFor("dumbbells"));
  const [ex] = exercisesOf(plan);
  assert.ok(EXERCISE_DB[ex.exerciseId].muscles.includes("back"));
  assert.ok(fits(ex.exerciseId, "dumbbells"));
  assert.equal(ex.name, EXERCISE_DB[ex.exerciseId].name);
});

test("the replacement isn't an exercise the day already has", () => {
  const plan = validateAndSanitizePlan(
    trainingDay(["back"], [
      { exerciseId: "pull_up", name: "Pull Up" },
      { exerciseId: "made_up_row", name: "Made-up Row" },
    ]),
    equipmentTagsFor("full_gym"),
  );
  const ids = exercisesOf(plan).map((e) => e.exerciseId);
  assert.equal(new Set(ids).size, ids.length);
});

test("known exercises always get their one name, whatever the AI wrote", () => {
  const plan = validateAndSanitizePlan(trainingDay(["back"], [{ exerciseId: "pull_up", name: "Pull-Up" }, { exerciseId: "barbell_row", name: "BB Row" }]));
  assert.deepEqual(exercisesOf(plan).map((e) => e.name), ["Pull Ups", "Barbell Row"]);
});

test("an exercise without a progression note gets one that fits its reps", () => {
  const plan = validateAndSanitizePlan(trainingDay(["back"], [
    { exerciseId: "barbell_row", sets: 4, reps: "8-10" },
    { exerciseId: "pull_up", sets: 3, reps: "6-8" },
    { exerciseId: "plank", sets: 3, reps: "30-45s" },
    { exerciseId: "lat_pulldown", sets: 3, reps: "10", progressionNote: "The AI's own note" },
  ]));
  // In session order: row and pull-up (big lifts), pulldown, then plank.
  assert.deepEqual(exercisesOf(plan).map((e) => [e.exerciseId, e.progressionNote]), [
    ["barbell_row", "Add 2.5 kg once every set reaches 10 reps"],
    ["pull_up", "Add 2 reps or slow the lowering once every set reaches 8 reps"],
    ["lat_pulldown", "The AI's own note"],
    ["plank", "Hold 5–10 seconds longer once every set reaches 45 seconds"],
  ]);
});

// ── The bigger catalogue and "Go easy on" ─────────────────────────────────
test("every exercise is well formed: a known order, muscles, equipment and stress areas", () => {
  const tags = new Set(equipmentTagsFor("full_gym"));
  for (const [id, ex] of Object.entries(EXERCISE_DB)) {
    assert.ok([1, 2, 3, 4].includes(ex.order), id);
    assert.ok(ex.equipment.every((t) => tags.has(t)), id);
    assert.ok((ex.stress ?? []).every((a) => STRESS_AREAS.includes(a)), id);
  }
});

test("a full gym gets flies, crossovers and machine work; dumbbells and bodyweight only what they can do", () => {
  const gym = allowedExerciseIds(equipmentTagsFor("full_gym"));
  for (const id of ["db_fly", "cable_crossover", "pec_deck", "face_pull", "leg_extension", "hip_thrust", "hammer_curl", "skull_crusher"]) assert.ok(gym.includes(id), id);
  assert.ok(allowedExerciseIds(equipmentTagsFor("dumbbells")).every((id) => EXERCISE_DB[id].equipment.every((t) => ["dumbbells", "pull_up_bar", "jump_rope"].includes(t))));
  assert.ok(!allowedExerciseIds(equipmentTagsFor("bodyweight")).includes("db_fly"));
});

test("going easy on knees leaves out squats, lunges and jumps, and keeps the leg press", () => {
  const ids = allowedExerciseIds(equipmentTagsFor("full_gym"), ["knees"]);
  for (const id of ["squat", "front_squat", "lunge", "bulgarian_split_squat", "leg_extension", "jump_rope", "burpee"]) assert.ok(!ids.includes(id), id);
  for (const id of ["leg_press", "leg_curl", "hip_thrust", "glute_bridge"]) assert.ok(ids.includes(id), id);
});

test("an exercise the user goes easy on is replaced, for the same muscles, even when the AI names it", () => {
  const plan = validateAndSanitizePlan(trainingDay(["quads", "glutes"], [{ exerciseId: "squat", name: "Barbell Back Squat", sets: 3, reps: "8" }]), equipmentTagsFor("full_gym"), { avoid: ["knees"] });
  const [ex] = exercisesOf(plan);
  assert.notEqual(ex.exerciseId, "squat");
  assert.ok(!(EXERCISE_DB[ex.exerciseId].stress ?? []).includes("knees"), ex.exerciseId);
  assert.ok(EXERCISE_DB[ex.exerciseId].muscles.includes("quads"), ex.exerciseId);
});

test("two exercises replaced in one day never become the same one", () => {
  const plan = validateAndSanitizePlan(
    trainingDay(["quads", "glutes"], [
      { exerciseId: "squat", name: "Barbell Back Squat" },
      { exerciseId: "lunge", name: "Walking Lunges" },
      { exerciseId: "bulgarian_split_squat", name: "Bulgarian Split Squat" },
    ]),
    equipmentTagsFor("full_gym"),
    { avoid: ["knees"] },
  );
  const ids = exercisesOf(plan).map((ex) => ex.exerciseId);
  assert.equal(new Set(ids).size, ids.length, ids.join(", "));
});

test("going easy on an area leaves past weeks as they were logged (fromWeek)", () => {
  const legs = (week) => ({ week, days: [{ day: "monday", sessionType: "training", targetMuscles: ["quads", "glutes"], exercises: [{ exerciseId: "squat", name: "Barbell Back Squat" }] }] });
  const plan = validateAndSanitizePlan({ weeks: [legs(1), legs(2), legs(3)] }, equipmentTagsFor("full_gym"), { avoid: ["knees"], fromWeek: 2 });
  assert.equal(plan.weeks[0].days[0].exercises[0].exerciseId, "squat", "week 1 is past");
  assert.notEqual(plan.weeks[1].days[0].exercises[0].exerciseId, "squat");
  assert.notEqual(plan.weeks[2].days[0].exercises[0].exerciseId, "squat");
});

test("an exercise the equipment can't do is replaced too (not only made-up ones)", () => {
  const plan = validateAndSanitizePlan(trainingDay(["chest"], [{ exerciseId: "pec_deck", name: "Pec Deck Machine" }]), equipmentTagsFor("dumbbells"));
  assert.ok(fits(exercisesOf(plan)[0].exerciseId, "dumbbells"));
});

test("cardio is swapped for cardio, not a push-up", () => {
  const cardio = (id) => EXERCISE_DB[id].muscles.includes("cardio");
  assert.ok(cardio(getSubstituteExerciseId("jump_rope", equipmentTagsFor("bodyweight"), ["knees"])));
  assert.ok(cardio(getSubstituteExerciseId("stationary_bike", equipmentTagsFor("dumbbells"))));
  assert.ok(cardio(getSubstituteExerciseId("rowing_machine", equipmentTagsFor("dumbbells"))));
  assert.ok(cardio(getSubstituteExerciseId("jumping_jacks", equipmentTagsFor("full_gym"), ["knees"])));
});

test("swaps stay kind to the areas the user goes easy on", () => {
  const swap = getSubstituteExerciseId("bench_press", equipmentTagsFor("bodyweight"), ["wrists"]);
  assert.ok(!(EXERCISE_DB[swap].stress ?? []).includes("wrists"), swap);
  assert.deepEqual(avoidAreasOf({ avoidAreas: ["knees", "elbows"] }), ["knees"]);
  assert.deepEqual(avoidAreasOf({}), []);
});

test("the coach is told what an older plan has that go easy on now rules out, and a swap it made is spelled out", () => {
  const days = [{ day: "tuesday", exercises: [{ exerciseId: "squat" }, { exerciseId: "leg_curl" }] }];
  assert.deepEqual(ruledOutIn(days, ["knees"]), ["Barbell Back Squat (knees)"]);
  assert.deepEqual(ruledOutIn(days, []), []);

  const swaps = [
    { week: 1, from: "squat", to: "leg_press" },
    { week: 1, from: "lunge", to: "goblet_squat" },
  ];
  assert.equal(goEasySwapNote(swaps, ["knees"]), "To go easy on your knees, this uses Leg Press instead of Barbell Back Squat and Goblet Squat instead of Walking Lunges.");
  assert.equal(goEasySwapNote([], ["knees"]), null, "nothing swapped");
  assert.equal(goEasySwapNote(swaps, []), null);
});

test("the go easy on note names the real swap when another was for equipment", () => {
  // Dumbbells only, going easy on knees: Leg Press goes for the equipment, the squat for the knees.
  const swaps = [];
  const day = { day: "tuesday", sessionType: "training", targetMuscles: ["quads"], exercises: [{ exerciseId: "leg_press" }, { exerciseId: "squat" }] };
  const plan = validateAndSanitizePlan({ weeks: [{ week: 1, days: [day] }] }, equipmentTagsFor("dumbbells"), { avoid: ["knees"], onSwap: (swap) => swaps.push(swap) });
  assert.equal(swaps.length, 2);
  const forKnees = swaps.find((s) => s.from === "squat");
  assert.ok(plan.weeks[0].days[0].exercises.some((ex) => ex.exerciseId === forKnees.to));
  // Only the knee swap is named, with what really replaced the squat.
  assert.equal(goEasySwapNote(swaps, ["knees"]), `To go easy on your knees, this uses ${EXERCISE_DB[forKnees.to].name} instead of Barbell Back Squat.`);
});
