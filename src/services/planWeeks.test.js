// Plans written one week at a time, through the real plan service. The AI and
// the database are fakes: the AI's reply is set per test, saves are recorded.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");

let aiReply;
let queuedReplies = []; // used first, in order, before aiReply
let prompts;
let workouts = [];
stub("config/groq.js", {
  GROQ_MODEL: "test",
  groqClient: {
    chat: {
      completions: {
        create: async ({ messages }) => {
          prompts.push(messages[1].content);
          const reply = queuedReplies.length > 0 ? queuedReplies.shift() : aiReply;
          return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(reply) } }], usage: {} };
        },
      },
    },
  },
});

let storedPlan;
let profileUpdates = [];
const tx = {
  plan: {
    count: async () => 0,
    updateMany: async () => ({}),
    create: async ({ data }) => (storedPlan = { id: "plan-1", ...data }),
  },
  planGeneration: { create: async () => ({}) },
};
stub("config/database.js", {
  prisma: {
    $transaction: async (fn) => fn(tx),
    workout: { findMany: async () => workouts },
    user: { update: async ({ data }) => profileUpdates.push(data) },
    plan: {
      findFirst: async () => storedPlan,
      update: async ({ data }) => (storedPlan = { ...storedPlan, ...data }),
    },
  },
});
stub("services/achievementService.js", { evaluateAchievementsSafely: async () => [] });

const { generatePlan, recalibratePlan } = require("./planningService");

// Most tests here move on several weeks in one go, so they use the testing
// switch; the calendar rule itself is tested on its own at the end.
process.env.ALLOW_EARLY_NEXT_WEEK = "true";

// The profile behind the 16 Oct plan: Mon–Sat, 90 minutes, full gym.
const user = { id: "user-1", fitnessGoal: "muscle", experienceLevel: "intermediate", equipment: "full_gym", sessionMinutes: 90, trainingDays: [1, 2, 3, 4, 5, 6], weeklyGoal: 6 };
const ex = (exerciseId, name) => ({ exerciseId, name, sets: 4, reps: "6-8", restSeconds: 90, progressionNote: "Add 2.5 kg" });
const trainingDays = (week) => week.days.filter((d) => d.sessionType === "training").map((d) => d.day.slice(0, 3));

beforeEach(() => {
  prompts = [];
  queuedReplies = [];
  workouts = [];
  profileUpdates = [];
  storedPlan = null;
});

test("a 6-day Push/Pull/Legs plan gets all 6 days, even when the AI writes only 3", async () => {
  aiReply = {
    planExplanation: "Push, pull and legs twice a week.",
    days: [
      { day: "monday", exercises: [ex("bench_press", "Barbell Bench Press")] },
      { day: "tuesday", exercises: [ex("pull_up", "Pull Up")] },
      { day: "wednesday", exercises: [ex("squat", "Barbell Squat")] },
    ],
  };
  const { plan } = await generatePlan(user, { splitPreference: "push_pull_legs" });

  assert.equal(plan.name, "Push Pull Legs");
  assert.equal(plan.planData.weeks.length, 1, "one week at a time");
  assert.equal(plan.planData.totalWeeks, 8);
  assert.deepEqual(trainingDays(plan.planData.weeks[0]), ["mon", "tue", "wed", "thu", "fri", "sat"]);
  assert.equal(plan.planData.weeks[0].days[3].exercises[0].exerciseId, "bench_press", "Thursday is the second Push day");
  // The prompt itself already listed all six days.
  assert.match(prompts[0], /- Thursday: Push \(chest, shoulders, triceps\)/);
  assert.match(prompts[0], /- Saturday: Legs/);
});

test("an automatic split is named after the split it used", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("squat", "Barbell Squat")] })) };
  const { plan } = await generatePlan(user);
  assert.equal(plan.name, "Push Pull Legs");
});

test("a reply missing a session is asked once more", async () => {
  queuedReplies = [{ planExplanation: "x", days: [{ day: "monday", exercises: [ex("bench_press", "Barbell Bench Press")] }] }];
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("squat", "Barbell Squat")] })) };
  const { plan } = await generatePlan(user, { splitPreference: "push_pull_legs" });
  assert.equal(prompts.length, 2);
  assert.deepEqual(trainingDays(plan.planData.weeks[0]), ["mon", "tue", "wed", "thu", "fri", "sat"]);
});

test("two replies without the sessions are a 503 to try again", async () => {
  aiReply = { planExplanation: "x", days: [] };
  await assert.rejects(generatePlan(user), { status: 503 });
  assert.equal(prompts.length, 2);
});

test("next week adds week 2 from week 1 and the log; the plan grows a week at a time", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("squat", "Barbell Squat")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" });

  aiReply = { message: "Up one rep on squats.", modifiedDays: null };
  const updated = await recalibratePlan(user, "plan-1");
  assert.equal(updated.weekNumber, 2);
  assert.equal(updated.planData.weeks.length, 2);
  assert.deepEqual(trainingDays(updated.planData.weeks[1]), ["mon", "tue", "wed", "thu", "fri", "sat"]);
  assert.match(prompts.at(-1), /next week is week 2 of 8/);
  assert.equal(updated.planData._chatHistory.at(-1).kind, "nextWeek");
});

test("week 4 is announced to the AI as a deload week", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("squat", "Barbell Squat")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  aiReply = { message: "ok", modifiedDays: null };
  for (let i = 0; i < 3; i++) await recalibratePlan(user, "plan-1");
  assert.equal(storedPlan.weekNumber, 4);
  assert.match(prompts.at(-1), /Next week is a deload week/);
  assert.equal(storedPlan.planData.weeks[3].isDeloadWeek, true);
});

test("the last week of the plan is a 409, as before", async () => {
  storedPlan = { id: "plan-1", userId: "user-1", weekNumber: 8, criteria: {}, planData: { totalWeeks: 8, weeks: [{ week: 8, days: [] }] } };
  await assert.rejects(recalibratePlan(user, "plan-1"), { status: 409 });
});

test("the coach sees the last 7 days of the log", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("squat", "Barbell Squat")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" }, "2026-10-16");
  workouts = [{ date: new Date("2026-10-13T00:00:00Z"), createdAt: new Date(), exercise: "Barbell Squat", sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }] }];
  const { chatWithPlan } = require("./planningService");
  aiReply = { message: "Solid week: squats nearly all there.", modifiedDays: null };
  await chatWithPlan(user, "plan-1", "How did my week go?", "2026-10-16");
  const prompt = prompts.at(-1);
  assert.match(prompt, /TODAY: Fri 2026-10-16/);
  assert.match(prompt, /EACH WEEK: Push ×2, Pull ×2, Legs ×2 \(6 training days\)/);
  assert.match(prompt, /THIS WEEK \(week 1, Mon 2026-10-12 to Sun 2026-10-18\):/);
  assert.doesNotMatch(prompt, /LAST WEEK \(/, "week 1 has no last week");
  // The squat was logged on Tuesday, a Pull day, so no Legs day counts it.
  assert.ok(
    prompt.includes(
      [
        "Mon 2026-10-12 · Push: not logged",
        "Tue 2026-10-13 · Pull: not logged",
        "Wed 2026-10-14 · Legs: not logged",
        "Thu 2026-10-15 · Push: not logged",
        "Fri 2026-10-16 · Pull: not logged yet (today)",
        "Sat 2026-10-17 · Legs: coming up",
      ].join("\n"),
    ),
  );
  assert.match(prompt, /LOGGED IN THE LAST 7 DAYS[^]*Tue 2026-10-13 Barbell Squat: 100×5, 100×4/);
  assert.match(prompt, /Never say a session was done unless it's logged/);
});

// ── Plan weeks are calendar weeks ─────────────────────────────────────────
test("next week starts on the Monday after this one, not before", async () => {
  delete process.env.ALLOW_EARLY_NEXT_WEEK;
  try {
    aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("bench_press", "Barbell Bench Press")] })) };
    await generatePlan(user, { splitPreference: "push_pull_legs" }, "2026-10-14"); // a Wednesday: week 1 is 12–18 Oct
    assert.equal(storedPlan.planData.weekStartsOn, "2026-10-12");
    aiReply = { message: "ok", modifiedDays: null };
    await assert.rejects(recalibratePlan(user, "plan-1", "2026-10-18"), { status: 409, message: /Week 2 starts on Monday 19 Oct/ });

    const updated = await recalibratePlan(user, "plan-1", "2026-10-19");
    assert.equal(updated.weekNumber, 2);
    assert.equal(updated.planData.weekStartsOn, "2026-10-19");
    assert.deepEqual(updated.planData.lastWeek, { number: 1, startsOn: "2026-10-12" });
    assert.deepEqual([updated.planData._chatHistory.at(-1).week, updated.planData._chatHistory.at(-1).weekStartsOn], [2, "2026-10-19"]);
  } finally {
    process.env.ALLOW_EARLY_NEXT_WEEK = "true";
  }
});

test("a plan made at the weekend starts the following Monday", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("bench_press", "Barbell Bench Press")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" }, "2026-10-17"); // a Saturday
  assert.equal(storedPlan.planData.weekStartsOn, "2026-10-19");
});

test("right after moving on, the coach sees the new week and last week by their dates", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("bench_press", "Barbell Bench Press")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" }, "2026-10-14");
  aiReply = { message: "ok", modifiedDays: null };
  await recalibratePlan(user, "plan-1", "2026-10-19");
  // Monday's Push was done in week 1.
  workouts = [{ date: new Date("2026-10-12T00:00:00Z"), exercise: "Barbell Bench Press", sets: [{ weight: 60, reps: 10 }] }];

  const { chatWithPlan } = require("./planningService");
  await chatWithPlan(user, "plan-1", "How did my week go?", "2026-10-19");
  const prompt = prompts.at(-1);
  assert.ok(prompt.includes("THIS WEEK (week 2, Mon 2026-10-19 to Sun 2026-10-25):\nMon 2026-10-19 · Push: not logged yet (today)"));
  assert.ok(prompt.includes("LAST WEEK (week 1, Mon 2026-10-12 to Sun 2026-10-18):\nMon 2026-10-12 · Push: logged (1 of 1 exercises)\nTue 2026-10-13 · Pull: not logged"));
  assert.match(prompt, /a question about "my week" is about LAST WEEK/);
});

// ── Next week always carries the progression ──────────────────────────────
const sixDayWeek = ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("bench_press", "Barbell Bench Press")] }));
const shortWeek = (days) => days.map(([d, id]) => (id ? { d, m: ["chest"], min: 90, x: [{ id, n: id, s: 5, r: "8-10", rest: 90 }] } : { d, t: "rest" }));

test("next week without a week from the AI is asked once more, then moves on as planned", async () => {
  aiReply = { planExplanation: "x", days: sixDayWeek };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  aiReply = { message: "Looks good as is.", modifiedDays: null };
  const before = prompts.length;
  const updated = await recalibratePlan(user, "plan-1");
  assert.equal(prompts.length - before, 2, "asked twice");
  assert.equal(updated.weekNumber, 2);
  assert.match(updated.planData._chatHistory.at(-1).content, /as planned/);
  assert.match(prompts.at(-1), /Always return it/);
});

test("next week uses the AI's week when it sends one", async () => {
  aiReply = { planExplanation: "x", days: sixDayWeek };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].map((d) => [d, "bench_press"]).concat([["sunday"]]);
  aiReply = { message: "One more set on bench.", modifiedDays: shortWeek(days) };
  const updated = await recalibratePlan(user, "plan-1");
  assert.equal(updated.planData.weeks[1].days[0].exercises[0].sets, 5);
  assert.match(updated.planData._chatHistory.at(-1).content, /One more set on bench/);
});

// ── New training days in the profile ──────────────────────────────────────
test("training days changed in the profile: next week moves the sessions to them", async () => {
  aiReply = { planExplanation: "x", days: sixDayWeek };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  const threeDays = { ...user, trainingDays: [1, 3, 5], weeklyGoal: 3 };
  aiReply = { message: "ok", modifiedDays: null };
  const before = prompts.length;
  const updated = await recalibratePlan(threeDays, "plan-1");
  assert.deepEqual(trainingDays(updated.planData.weeks[1]), ["mon", "wed", "fri"]);
  assert.deepEqual(updated.planData.weeks[1].days.filter((d) => d.sessionType === "training").map((d) => d.targetMuscles[0]), ["chest", "back", "quads"], "Push, Pull, Legs");
  assert.equal(prompts.length - before, 2, "no extra AI call to move matching sessions (just next week, twice)");
  assert.match(updated.planData._chatHistory.at(-1).content, /new training days/);
});

test("a split change (fewer days than the split needs) gets fresh sessions from the AI", async () => {
  aiReply = { planExplanation: "x", days: sixDayWeek };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  const twoDays = { ...user, trainingDays: [1, 4], weeklyGoal: 2 };
  queuedReplies = [{ planExplanation: "x", days: ["monday", "thursday"].map((day) => ({ day, exercises: [ex("squat", "Barbell Squat")] })) }];
  aiReply = { message: "ok", modifiedDays: null };
  const updated = await recalibratePlan(twoDays, "plan-1");
  assert.deepEqual(trainingDays(updated.planData.weeks[1]), ["mon", "thu"]);
  assert.match(prompts.find((p) => p.includes("- Monday: Full body")) ?? "", /- Thursday: Full body/, "full body on 2 days, written by the AI");
});

// ── The coach's day changes reach the profile ─────────────────────────────
test("the coach moving the active plan to 3 days updates the profile's training days", async () => {
  aiReply = { planExplanation: "x", days: sixDayWeek };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  storedPlan.isActive = true;
  const { chatWithPlan } = require("./planningService");
  aiReply = { message: "Now Mon, Wed, Fri.", modifiedDays: shortWeek([["monday", "bench_press"], ["tuesday"], ["wednesday", "pull_up"], ["thursday"], ["friday", "squat"], ["saturday"], ["sunday"]]) };
  const result = await chatWithPlan(user, "plan-1", "Make it 3 days a week", "2026-10-16");
  assert.equal(result.profileUpdated, true);
  assert.deepEqual(profileUpdates.at(-1), { trainingDays: [1, 3, 5], weeklyGoal: 3 });
});

test("a coach answer that changes nothing leaves the profile alone", async () => {
  aiReply = { planExplanation: "x", days: sixDayWeek };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  storedPlan.isActive = true;
  const { chatWithPlan } = require("./planningService");
  aiReply = { message: "Rest 90 seconds.", modifiedDays: null };
  const result = await chatWithPlan(user, "plan-1", "How long should I rest?", "2026-10-16");
  assert.equal(result.profileUpdated, false);
  assert.equal(profileUpdates.length, 0);
});

test("test mode: starting next week early makes it this week, and the week before last week", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("bench_press", "Barbell Bench Press")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" }, "2026-10-14");
  aiReply = { message: "ok", modifiedDays: null };
  await recalibratePlan(user, "plan-1", "2026-10-16");
  assert.equal(storedPlan.planData.weekStartsOn, "2026-10-12", "week 2 is this week");
  assert.deepEqual(storedPlan.planData.lastWeek, { number: 1, startsOn: "2026-10-05" }, "week 1 counts as last week");
  await recalibratePlan(user, "plan-1", "2026-10-16");
  assert.equal(storedPlan.planData.weekStartsOn, "2026-10-12");
  assert.deepEqual(storedPlan.planData.lastWeek, { number: 2, startsOn: "2026-10-05" });
});
