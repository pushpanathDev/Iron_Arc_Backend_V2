const { test } = require("node:test");
const assert = require("node:assert/strict");
const { compactWeek, expandDays, applyWeekChange, weekSoFar } = require("./planChat");
const { dayShortName } = require("./planDiff");

const bench = { exerciseId: "bench_press", name: "Barbell Bench Press", sets: 4, reps: "6-8", restSeconds: 90, progressionNote: "Add 2.5 kg", substitutes: ["dumbbell_press"] };
const squat = { exerciseId: "squat", name: "Barbell Squat", sets: 4, reps: "5", restSeconds: 120 };
const week = (n) => ({
  week: n,
  isDeloadWeek: n === 4,
  days: [
    { day: "monday", sessionType: "training", targetMuscles: ["chest"], estimatedDurationMinutes: 60, exercises: [bench] },
    { day: "tuesday", sessionType: "rest", recoveryNote: "Walk" },
    { day: "wednesday", sessionType: "training", targetMuscles: ["legs"], estimatedDurationMinutes: 60, exercises: [squat] },
  ],
});
const plan = { planExplanation: "x", weeks: [week(1), week(2), week(3), week(4)], _chatHistory: [] };

// The coach's reply: Monday gets both lifts, Wednesday becomes a rest day.
const changed = [
  { d: "monday", m: ["chest", "legs"], min: 75, x: [{ id: "bench_press", n: "Barbell Bench Press", s: 3, r: "6-8", rest: 90 }, { id: "squat", n: "Barbell Squat", s: 3, r: "5", rest: 120 }] },
  { d: "wednesday", t: "rest" },
];

test("compact week: short keys, current week only", () => {
  assert.deepEqual(compactWeek(plan, 2), [
    { d: "monday", m: ["chest"], min: 60, x: [{ id: "bench_press", n: "Barbell Bench Press", s: 4, r: "6-8", rest: 90 }] },
    { d: "tuesday", t: "rest" },
    { d: "wednesday", m: ["legs"], min: 60, x: [{ id: "squat", n: "Barbell Squat", s: 4, r: "5", rest: 120 }] },
  ]);
});

test("compact JSON is far smaller than the pretty plan", () => {
  assert.ok(JSON.stringify(compactWeek(plan, 1)).length * 3 < JSON.stringify(plan, null, 2).length);
});

test("expanded days: all 7 weekdays in order", () => {
  const days = expandDays(changed, week(1).days);
  assert.deepEqual(days.map((d) => `${d.day}:${d.sessionType}`), [
    "monday:training", "tuesday:rest", "wednesday:rest", "thursday:rest", "friday:rest", "saturday:rest", "sunday:rest",
  ]);
});

test("an exercise whose sets or reps changed drops its old note; an unchanged one keeps it", () => {
  const days = expandDays(changed, week(1).days);
  const benchChanged = days[0].exercises[0];
  assert.deepEqual([benchChanged.sets, "progressionNote" in benchChanged, benchChanged.substitutes], [3, false, ["dumbbell_press"]]);

  const same = expandDays([{ d: "monday", m: ["chest"], min: 60, x: [{ id: "bench_press", n: "Barbell Bench Press", s: 4, r: "6-8", rest: 90 }] }], week(1).days);
  assert.equal(same[0].exercises[0].progressionNote, "Add 2.5 kg");
});

test("a rest day keeps its recovery note", () => {
  assert.equal(expandDays(changed, week(1).days)[1].recoveryNote, "Walk");
});

test("this week so far: logged, not logged, today and coming up", () => {
  // Friday 16 Oct 2026; Monday is the 12th.
  const days = [
    { day: "monday", sessionType: "training", targetMuscles: ["chest", "triceps"], exercises: [{ exerciseId: "bench_press", name: "Barbell Bench Press" }, { exerciseId: "push_up", name: "Push Ups" }] },
    { day: "tuesday", sessionType: "training", targetMuscles: ["back", "biceps"], exercises: [{ exerciseId: "pull_up", name: "Pull Ups" }] },
    { day: "friday", sessionType: "training", targetMuscles: ["back", "biceps"], exercises: [{ exerciseId: "pull_up", name: "Pull Ups" }] },
    { day: "saturday", sessionType: "training", targetMuscles: ["quads", "glutes"], exercises: [{ exerciseId: "squat", name: "Barbell Back Squat" }] },
    { day: "sunday", sessionType: "rest" },
  ];
  const logged = [
    { date: "2026-10-12", exercise: "barbell bench press" },
    { date: "2026-10-16", exercise: "Pull Ups" }, // Tuesday's Pull, done on Friday: Friday's
  ];
  assert.deepEqual(weekSoFar(days, logged, "2026-10-16", dayShortName), [
    "Mon 2026-10-12 · Push: logged (1 of 2 exercises)",
    "Tue 2026-10-13 · Pull: not logged",
    "Fri 2026-10-16 · Pull: logged (1 of 1 exercises)",
    "Sat 2026-10-17 · Legs: coming up",
  ]);
  assert.deepEqual(weekSoFar(days.slice(2, 3), [], "2026-10-16", dayShortName), ["Fri 2026-10-16 · Pull: not logged yet (today)"]);
});

test("a change applies to this week and the later ones; earlier weeks are history", () => {
  const applied = applyWeekChange(plan, 2, changed);
  assert.deepEqual(applied.weeks[0], week(1));
  assert.deepEqual(
    applied.weeks.slice(1).map((w) => [w.week, w.isDeloadWeek, w.days[0].exercises.length, w.days[2].sessionType]),
    [[2, false, 2, "rest"], [3, false, 2, "rest"], [4, true, 2, "rest"]],
  );
});

test("onlyThisWeek (next-week adjustments) changes just that week", () => {
  const fourWeeks = { weeks: [1, 2, 3, 4].map((n) => ({ week: n, days: [week(n).days[0]] })) };
  const nextOnly = applyWeekChange(fourWeeks, 2, [{ d: "monday", t: "rest" }], { onlyThisWeek: true });
  assert.deepEqual(nextOnly.weeks.map((w) => w.days.find((d) => d.day === "monday").sessionType), ["training", "rest", "training", "training"]);
});
