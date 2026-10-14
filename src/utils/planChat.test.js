/**
 * Runnable check for the plan coach helpers (not a test framework).
 *   node src/utils/planChat.test.js
 */
const { compactWeek, expandDays, applyWeekChange } = require("./planChat");

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

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

check("compact week: short keys, current week only", compactWeek(plan, 2), [
  { d: "monday", m: ["chest"], min: 60, x: [{ id: "bench_press", n: "Barbell Bench Press", s: 4, r: "6-8", rest: 90 }] },
  { d: "tuesday", t: "rest" },
  { d: "wednesday", m: ["legs"], min: 60, x: [{ id: "squat", n: "Barbell Squat", s: 4, r: "5", rest: 120 }] },
]);
check("compact JSON is far smaller than the pretty plan",
  JSON.stringify(compactWeek(plan, 1)).length * 3 < JSON.stringify(plan, null, 2).length, true);

const changed = [
  { d: "monday", m: ["chest", "legs"], min: 75, x: [{ id: "bench_press", n: "Barbell Bench Press", s: 3, r: "6-8", rest: 90 }, { id: "squat", n: "Barbell Squat", s: 3, r: "5", rest: 120 }] },
  { d: "wednesday", t: "rest" },
];
const days = expandDays(changed, week(1).days);
check("expanded: all 7 weekdays in order", days.map((d) => `${d.day}:${d.sessionType}`), [
  "monday:training", "tuesday:rest", "wednesday:rest", "thursday:rest", "friday:rest", "saturday:rest", "sunday:rest",
]);
check("kept exercise keeps its note and substitutes", [days[0].exercises[0].progressionNote, days[0].exercises[0].substitutes, days[0].exercises[0].sets], ["Add 2.5 kg", ["dumbbell_press"], 3]);
check("rest day keeps its old recovery note", days[1].recoveryNote, "Walk");

const applied = applyWeekChange(plan, 2, changed);
check("week 1 (history) untouched", applied.weeks[0], week(1));
check("weeks 2–4 get the change, keeping week number and deload flag",
  applied.weeks.slice(1).map((w) => [w.week, w.isDeloadWeek, w.days[0].exercises.length, w.days[2].sessionType]),
  [[2, false, 2, "rest"], [3, false, 2, "rest"], [4, true, 2, "rest"]]);

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed > 0 ? 1 : 0;
