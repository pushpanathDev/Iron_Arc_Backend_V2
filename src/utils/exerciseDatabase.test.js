const { test } = require("node:test");
const assert = require("node:assert/strict");
const { equipmentTagsFor, getSubstituteExerciseId, EXERCISE_DB } = require("./exerciseDatabase");
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
  assert.equal(getSubstituteExerciseId("bench_press", equipmentTagsFor("full_gym")), "dumbbell_press");
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

test("known exercises keep the AI's name", () => {
  const plan = validateAndSanitizePlan(trainingDay(["chest"], [{ exerciseId: "bench_press", name: "Paused Bench Press" }]));
  assert.equal(exercisesOf(plan)[0].name, "Paused Bench Press");
});
