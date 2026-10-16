const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diffPlanWeek } = require("./planDiff");
const { validateAndSanitizePlan } = require("./planValidator");

const ex = (exerciseId, name, sets = 3, reps = "8-12") => ({ exerciseId, name, sets, reps, restSeconds: 90 });
const plan = (days) => ({ weeks: [{ week: 1, days }] });
const push = { day: "monday", sessionType: "training", targetMuscles: ["chest", "triceps"], exercises: [ex("bench_press", "Barbell Bench Press", 4, "6-8"), ex("tricep_pushdown", "Tricep Pushdown")] };
const rest = (day) => ({ day, sessionType: "rest" });

test("no change → nothing to list", () => {
  assert.deepEqual(diffPlanWeek(plan([push]), plan([push]), 1), []);
});

test("a swap, an added exercise and a new sets×reps are each listed", () => {
  const after = plan([{ ...push, exercises: [ex("bench_press", "Barbell Bench Press", 3, "8-10"), ex("tricep_dip", "Tricep Dip"), ex("lateral_raise", "Lateral Raise")] }]);
  assert.deepEqual(
    diffPlanWeek(plan([push]), after, 1).map((c) => c.text),
    ["Mon: Tricep Pushdown → Tricep Dip", "Mon: + Lateral Raise", "Mon: Barbell Bench Press 4×6-8 → 3×8-10"],
  );
});

test("an exercise that only got its fixed name isn't a change", () => {
  const renamed = { ...push, exercises: [ex("bench_press", "Barbell Bench Press", 4, "6-8"), ex("tricep_pushdown", "Triceps Pushdown")] };
  assert.deepEqual(diffPlanWeek(plan([push]), plan([renamed]), 1), []);
});

test("training → rest", () => {
  assert.deepEqual(diffPlanWeek(plan([push]), plan([rest("monday")]), 1), [{ dayIndex: 0, text: "Mon is now a rest day" }]);
});

test("rest → training names the session", () => {
  assert.deepEqual(diffPlanWeek(plan([rest("thursday")]), plan([{ ...push, day: "thursday" }]), 1), [{ dayIndex: 3, text: "Thu: Push, 2 exercises" }]);
});

test("the validator orders a session and keeps the swap trail and the chat", () => {
  const messy = {
    weeks: [{ week: 1, days: [{ day: "monday", sessionType: "training", exercises: [
      ex("lateral_raise", "Lateral Raise"),
      ex("crunch", "Crunch"),
      ex("dumbbell_press", "Dumbbell Bench Press"),
      ex("bench_press", "Barbell Bench Press"),
      { ...ex("db_shoulder_press", "Dumbbell Shoulder Press"), substitutedFrom: "overhead_press", substitutionReason: "no barbell" },
    ] }] }],
    _chatHistory: [{ role: "user", content: "hi" }],
  };
  const clean = validateAndSanitizePlan(messy);
  // Compound first, isolation then core last; stable within a tier.
  assert.deepEqual(clean.weeks[0].days[0].exercises.map((e) => e.exerciseId), ["bench_press", "dumbbell_press", "db_shoulder_press", "lateral_raise", "crunch"]);
  assert.equal(clean.weeks[0].days[0].exercises[2].substitutedFrom, "overhead_press");
  assert.equal(clean._chatHistory.length, 1);
});
