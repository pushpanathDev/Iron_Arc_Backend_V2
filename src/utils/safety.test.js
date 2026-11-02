// The coach's safety layer that doesn't depend on the AI: danger-sign triage,
// the scope check on replies, Safe mode limits and the health check gate.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { dangerSign, outOfScope } = require("./safetyTriage");
const { saferReps, saferDays, weekProblems } = require("./planValidator");
const { coachAccessError, safeModeOf, newHealthCheck, HEALTH_CHECK_QUESTIONS } = require("./healthCheck");
const { anonymizeIronArcProfile } = require("./anonymizer");
const { buildPlanChatPrompt } = require("./planPrompts");

const allNo = Object.fromEntries(HEALTH_CHECK_QUESTIONS.map((key) => [key, false]));

test("danger signs are caught, by kind", () => {
  const kinds = {
    "I got chest pain halfway through my squats": "emergency",
    "felt tightness in my chest on the treadmill": "emergency",
    "I passed out after deadlifts yesterday": "emergency",
    "my heart keeps racing even when resting": "emergency",
    "I heard a pop in my knee and now it's swollen": "injury",
    "I think I tore my hamstring": "injury",
    "sudden sharp pain in my lower back on rows": "injury",
    "I can't put weight on my ankle": "injury",
    "honestly I want to die": "crisis",
    "I've been hurting myself again": "crisis",
    "I make myself throw up after big meals": "eating",
    "I haven't eaten for 3 days to cut weight": "eating",
  };
  for (const [text, kind] of Object.entries(kinds)) assert.equal(dangerSign(text)?.kind, kind, text);
});

test("gym talk and negations aren't danger signs", () => {
  for (const text of [
    "I broke my PR on bench today!",
    "leg day killed me",
    "no chest pain, just sore pecs after chest day",
    "I didn't faint, just felt a bit tired",
    "Make it 3 days a week",
    "how do I stop my knees caving in on squats?",
    "my chest is sore after bench",
  ]) {
    assert.equal(dangerSign(text), null, text);
  }
});

test("each danger sign gets its fixed reply: emergency help, a professional, or a helpline", () => {
  assert.match(dangerSign("chest pain on the bike").reply, /emergency number/);
  assert.match(dangerSign("I heard a pop in my shoulder").reply, /physiotherapist/);
  assert.match(dangerSign("I want to kill myself").reply, /findahelpline\.com/);
  assert.match(dangerSign("I've been purging after meals").reply, /won't give nutrition advice/);
});

test("replies beyond general nutrition guidance are caught", () => {
  for (const text of [
    "Aim for 2,400 calories a day.",
    "Eat about 1800 kcal on rest days.",
    "A deficit of 500 calories works well.",
    "Take 400 mg of caffeine before training.",
    "Vitamin D at 5000 IU daily helps.",
    "A beginner steroid cycle is",
    "SARMs can help you recover.",
  ]) {
    assert.equal(outOfScope(text), true, text);
  }
  for (const text of ["Aim for 1.6-2.2 g of protein per kg of body weight a day.", "Creatine is well studied and safe for most adults.", "Drink water through your session."]) {
    assert.equal(outOfScope(text), false, text);
  }
});

test("Safe mode reps: no AMRAP and no sets under 8 reps; holds and higher ranges stay", () => {
  assert.equal(saferReps("AMRAP"), "10-12");
  assert.equal(saferReps("3-5"), "8-12");
  assert.equal(saferReps("5"), "8-12");
  assert.equal(saferReps("6-15"), "8-15");
  assert.equal(saferReps("6 per side"), "8-12 per side");
  assert.equal(saferReps("8-12"), "8-12");
  assert.equal(saferReps("30-45s"), "30-45s");
});

test("Safe mode days: at most 4 sets, at least 60 s rest, and a progression note that fits new reps", () => {
  const [day] = saferDays([{ day: "monday", sessionType: "training", exercises: [{ exerciseId: "squat", sets: 6, reps: "3-5", restSeconds: 30, progressionNote: "Add 5 kg every set of 5" }] }]);
  const ex = day.exercises[0];
  assert.deepEqual([ex.sets, ex.reps, ex.restSeconds], [4, "8-12", 60]);
  assert.match(ex.progressionNote, /12 reps/);
  assert.deepEqual(saferDays([{ day: "sunday", sessionType: "rest" }]), [{ day: "sunday", sessionType: "rest" }]);
});

test("Safe mode weeks grow at most 10% in sets; outside Safe mode, no such rule", () => {
  const week = (sets) => [{ day: "monday", sessionType: "training", exercises: [{ sets }] }, { day: "sunday", sessionType: "rest" }];
  assert.deepEqual(weekProblems(week(22), { safeMode: true, before: week(20) }), []);
  assert.deepEqual(weekProblems(week(23), { safeMode: true, before: week(20) }), ["too big a jump"]);
  assert.deepEqual(weekProblems(week(40), { before: week(20) }), []);
});

test("the coach is for adults who've done the current health check", () => {
  const done = newHealthCheck(allNo);
  assert.equal(coachAccessError({ age: 30, healthCheck: done }), null);
  assert.equal(coachAccessError({ age: 17, healthCheck: done }).code, "COACH_ADULTS_ONLY");
  assert.equal(coachAccessError({ age: null, healthCheck: done }).code, "COACH_ADULTS_ONLY");
  assert.equal(coachAccessError({ age: 30, healthCheck: null }).code, "HEALTH_CHECK_REQUIRED");
  assert.equal(coachAccessError({ age: 30, healthCheck: { ...done, version: 0 } }).code, "HEALTH_CHECK_REQUIRED");
  assert.equal(coachAccessError({ age: 30, healthCheck: { ...done, consentedAt: undefined } }).code, "HEALTH_CHECK_REQUIRED");
});

test("any yes turns on Safe mode; the AI sees only that, never the answers", () => {
  assert.equal(safeModeOf({ healthCheck: newHealthCheck(allNo) }), false);
  const flagged = { age: 40, healthCheck: newHealthCheck({ ...allNo, medication: true }) };
  assert.equal(safeModeOf(flagged), true);
  const profile = anonymizeIronArcProfile(flagged);
  assert.equal(profile.safeMode, true);
  assert.equal(JSON.stringify(profile).includes("medication"), false);
  assert.equal(profile.healthCheck, undefined);
});

test("the prompt carries the Safe mode rules only in Safe mode, and the danger-sign rules always", () => {
  const meta = { exerciseIds: ["squat"] };
  const normal = buildPlanChatPrompt([], [], "hi", { safeMode: false }, meta).system;
  const safe = buildPlanChatPrompt([], [], "hi", { safeMode: true }, meta).system;
  assert.doesNotMatch(normal, /SAFE MODE/);
  assert.match(safe, /SAFE MODE/);
  assert.match(safe, /At most 4 sets/);
  for (const system of [normal, safe]) {
    assert.match(system, /Danger signs/);
    assert.match(system, /under 18/);
  }
});
