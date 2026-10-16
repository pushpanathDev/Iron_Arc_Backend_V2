/**
 * Runnable check for plan change summaries, exercise order and next-week edits (not a test framework).
 *   node src/utils/planDiff.test.js
 */
const { diffPlanWeek } = require("./planDiff");
const { validateAndSanitizePlan } = require("./planValidator");
const { applyWeekChange } = require("./planChat");

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

const ex = (exerciseId, name, sets = 3, reps = "8-12") => ({ exerciseId, name, sets, reps, restSeconds: 90 });
const plan = (days) => ({ weeks: [{ week: 1, days }] });
const push = { day: "monday", sessionType: "training", targetMuscles: ["chest", "triceps"], exercises: [ex("bench_press", "Barbell Bench Press", 4, "6-8"), ex("tricep_pushdown", "Tricep Pushdown")] };
const rest = (day) => ({ day, sessionType: "rest" });

// ── diffPlanWeek ──
check("no change → nothing", diffPlanWeek(plan([push]), plan([push]), 1), []);
check(
  "swap, add, scheme change",
  diffPlanWeek(
    plan([push]),
    plan([{ ...push, exercises: [ex("bench_press", "Barbell Bench Press", 3, "8-10"), ex("tricep_dip", "Tricep Dip"), ex("lateral_raise", "Lateral Raise")] }]),
    1,
  ).map((c) => c.text),
  ["Mon: Tricep Pushdown → Tricep Dip", "Mon: + Lateral Raise", "Mon: Barbell Bench Press 4×6-8 → 3×8-10"],
);
check("training → rest", diffPlanWeek(plan([push]), plan([rest("monday")]), 1), [{ dayIndex: 0, text: "Mon is now a rest day" }]);
check(
  "rest → training names the session",
  diffPlanWeek(plan([rest("thursday")]), plan([{ ...push, day: "thursday" }]), 1),
  [{ dayIndex: 3, text: "Thu: Push, 2 exercises" }],
);

// ── validator: training order and swap trail ──
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
const clean = validateAndSanitizePlan(messy, []);
check(
  "compound first, isolation then core last (stable within a tier)",
  clean.weeks[0].days[0].exercises.map((e) => e.exerciseId),
  ["bench_press", "dumbbell_press", "db_shoulder_press", "lateral_raise", "crunch"],
);
check("swap trail kept", clean.weeks[0].days[0].exercises[2].substitutedFrom, "overhead_press");
check("chat history kept through validation", clean._chatHistory.length, 1);

// ── next week only ──
const fourWeeks = { weeks: [1, 2, 3, 4].map((n) => ({ week: n, days: [push] })) };
const nextOnly = applyWeekChange(fourWeeks, 2, [{ d: "monday", t: "rest" }], { onlyThisWeek: true });
check(
  "onlyThisWeek changes just that week",
  nextOnly.weeks.map((w) => w.days.find((d) => d.day === "monday").sessionType),
  ["training", "rest", "training", "training"],
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
