const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitFor, weekSchedule, planSettings, assembleWeek, withNextWeek, planLength } = require("./planSchedule");

const sessions = (schedule) => schedule.map((s) => `${s.day.slice(0, 3)}:${s.session}`);
const ex = (exerciseId) => ({ exerciseId, name: exerciseId, sets: 3, reps: "8-12", restSeconds: 90 });

test("Push / Pull / Legs on Mon–Sat runs twice, Sunday is rest", () => {
  assert.deepEqual(sessions(weekSchedule([1, 2, 3, 4, 5, 6], "push_pull_legs")), [
    "mon:Push", "tue:Pull", "wed:Legs", "thu:Push", "fri:Pull", "sat:Legs",
  ]);
});

test("each split follows the chosen weekdays", () => {
  assert.deepEqual(sessions(weekSchedule([1, 2, 4, 5], "upper_lower")), ["mon:Upper", "tue:Lower", "thu:Upper", "fri:Lower"]);
  assert.deepEqual(sessions(weekSchedule([1, 3, 5], "full_body")), ["mon:Full body", "wed:Full body", "fri:Full body"]);
  assert.deepEqual(sessions(weekSchedule([1, 2, 4, 5], "body_part")), ["mon:Chest & triceps", "tue:Back & biceps", "thu:Legs", "fri:Shoulders & arms"]);
});

test("a split that needs more days than chosen falls back to the automatic one", () => {
  assert.equal(splitFor("push_pull_legs", 2), "full_body");
  assert.equal(splitFor("push_pull_legs", 3), "push_pull_legs");
  assert.equal(splitFor(undefined, 6), "push_pull_legs", "automatic, like the app shows");
});

test("plan length and lighter weeks follow the progression", () => {
  assert.equal(planSettings({ trainingDays: [1, 3, 5], experienceLevel: "beginner" }).totalWeeks, 8);
  assert.equal(planSettings({ trainingDays: [1, 3, 5] }, { progressionStyle: "block" }).totalWeeks, 12);
});

// The plan from 16 Oct: a 6-day Push/Pull/Legs profile, but the AI wrote only Mon–Wed.
test("days the AI leaves out get the same session, never a silent rest day", () => {
  const schedule = weekSchedule([1, 2, 3, 4, 5, 6], "push_pull_legs");
  const ai = [
    { day: "monday", exercises: [ex("bench_press")] },
    { day: "tuesday", exercises: [ex("pull_up")] },
    { day: "wednesday", exercises: [ex("squat")] },
  ];
  const week = assembleWeek(schedule, ai, 90);
  assert.deepEqual(week.map((d) => d.sessionType), ["training", "training", "training", "training", "training", "training", "rest"]);
  assert.deepEqual(week.map((d) => d.exercises?.[0].exerciseId ?? "-"), ["bench_press", "pull_up", "squat", "bench_press", "pull_up", "squat", "-"]);
  assert.deepEqual(week[3].targetMuscles, ["chest", "shoulders", "triceps"]);
  assert.equal(week[0].estimatedDurationMinutes, 90);
});

test("a session the AI skipped entirely makes the week unusable (the user is asked to retry)", () => {
  const schedule = weekSchedule([1, 2, 3], "push_pull_legs");
  assert.equal(assembleWeek(schedule, [{ day: "monday", exercises: [ex("bench_press")] }], 60), null);
  assert.equal(assembleWeek(schedule, undefined, 60), null);
});

test("days the AI adds outside the schedule are ignored", () => {
  const schedule = weekSchedule([1], "full_body");
  const week = assembleWeek(schedule, [{ day: "monday", exercises: [ex("squat")] }, { day: "sunday", exercises: [ex("plank")] }], 60);
  assert.equal(week[6].sessionType, "rest");
});

test("next week starts as a copy of this week; week 4 is a deload", () => {
  const plan = { totalWeeks: 8, weeks: [1, 2, 3].map((n) => ({ week: n, days: [{ day: "monday", exercises: [ex("squat")] }] })) };
  const withFour = withNextWeek(plan, 4);
  assert.equal(withFour.weeks.length, 4);
  assert.deepEqual([withFour.weeks[3].week, withFour.weeks[3].isDeloadWeek], [4, true]);
  assert.deepEqual(withFour.weeks[3].days, plan.weeks[2].days);
  assert.notEqual(withFour.weeks[3].days, plan.weeks[2].days, "a copy, not the same object");
  assert.equal(plan.weeks.length, 3, "the original plan is untouched");
});

test("older plans that hold every week keep their planned next week and their length", () => {
  const old = { weeks: [1, 2, 3, 4].map((n) => ({ week: n, days: [] })) };
  assert.equal(withNextWeek(old, 2), old);
  assert.equal(planLength(old), 4);
  assert.equal(planLength({ totalWeeks: 8, weeks: [{}] }), 8);
});
