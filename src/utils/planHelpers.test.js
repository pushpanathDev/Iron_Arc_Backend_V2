const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EXERCISE_DB, allowedExerciseIds, equipmentTagsFor } = require("./exerciseDatabase");
const { buildGeneratePlanPrompt, buildSubstitutePrompt } = require("./planPrompts");
const { chatOf, withoutChat, withChat } = require("./planChat");
const { planHasExercise, exerciseNameIn, applySubstitution } = require("./planSwap");
const { substituteSchema } = require("../middleware/validation");

const idsFor = (equipment) => allowedExerciseIds(equipmentTagsFor(equipment));

test("each equipment choice gets only exercises it can do", () => {
  assert.equal(idsFor("full_gym").length, Object.keys(EXERCISE_DB).length);
  for (const id of idsFor("dumbbells")) {
    assert.ok(EXERCISE_DB[id].equipment.every((tag) => ["dumbbells", "pull_up_bar", "jump_rope"].includes(tag)), id);
  }
  assert.ok(idsFor("bodyweight").includes("push_up"));
  assert.ok(!idsFor("bodyweight").includes("goblet_squat"));
});

test("the dumbbell plan prompt no longer offers barbell or machine exercises", () => {
  const prompt = buildGeneratePlanPrompt({ fitnessGoal: "muscle", weeklyGoal: 3, equipment: "dumbbells" }, [], {});
  // The list is the line after the "ALLOWED EXERCISE IDs" heading and its divider.
  const pool = prompt.split("ALLOWED EXERCISE IDs")[1].split("\n")[2].split(", ");
  assert.deepEqual(pool, idsFor("dumbbells"));
  for (const id of ["bicep_curl", "rdl", "leg_curl", "incline_press", "squat"]) assert.ok(!pool.includes(id), id);
});

test("the swap prompt says when the user gave no reason", () => {
  assert.match(buildSubstitutePrompt("squat", undefined, { fitnessGoal: "muscle" }, idsFor("full_gym")), /Reason: not given/);
});

test("a swap without a reason (the app sends 'user_request') has none", () => {
  assert.equal(substituteSchema.parse({ exerciseId: "squat", reason: "user_request" }).reason, undefined);
  assert.equal(substituteSchema.parse({ exerciseId: "squat", reason: "knee hurts" }).reason, "knee hurts");
});

test("the coach chat lives inside the plan data and keeps the last 40 messages", () => {
  const plan = { weeks: [], _chatHistory: [{ content: "hi" }] };
  assert.deepEqual(chatOf(plan), [{ content: "hi" }]);
  assert.equal("_chatHistory" in withoutChat(plan), false);
  const history = Array.from({ length: 39 }, (_, i) => ({ content: `m${i}` }));
  const saved = withChat({ weeks: [] }, history, [{ content: "q" }, { content: "a" }]);
  assert.equal(saved._chatHistory.length, 40);
  assert.equal(saved._chatHistory.at(-1).content, "a");
  assert.equal(saved._chatHistory[0].content, "m1");
});

const plan = {
  weeks: [
    { week: 1, days: [{ day: "monday", exercises: [{ exerciseId: "squat", name: "Back Squat" }] }, { day: "tuesday", sessionType: "rest" }] },
    { week: 2, days: [{ day: "monday", exercises: [{ exerciseId: "squat", name: "Back Squat" }] }] },
  ],
};

test("an exercise is found by id or name, in any letter case", () => {
  assert.ok(planHasExercise(plan, "SQUAT"));
  assert.ok(planHasExercise(plan, "back squat"));
  assert.ok(!planHasExercise(plan, "bench_press"));
  assert.equal(exerciseNameIn(plan, "squat"), "Back Squat");
});

test("a swap replaces every week's copy, remembers what it was, and leaves rest days alone", () => {
  const swapped = applySubstitution(plan, "squat", { id: "leg_press", name: "Leg Press", reason: "knees" });
  const firsts = swapped.weeks.map((w) => w.days[0].exercises[0]);
  assert.deepEqual(firsts.map((e) => [e.exerciseId, e.name, e.substitutedFrom, e.substitutionReason]), [
    ["leg_press", "Leg Press", "squat", "knees"],
    ["leg_press", "Leg Press", "squat", "knees"],
  ]);
  assert.equal("exercises" in swapped.weeks[0].days[1], false);
  assert.equal(plan.weeks[0].days[0].exercises[0].exerciseId, "squat", "the original plan is untouched");
});
