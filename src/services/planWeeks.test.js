// Plans written one week at a time, through the real plan service. The AI and
// the database are fakes: the AI's reply is set per test, saves are recorded.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

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
    plan: {
      findFirst: async () => storedPlan,
      update: async ({ data }) => (storedPlan = { ...storedPlan, ...data }),
    },
  },
});
stub("services/achievementService.js", { evaluateAchievementsSafely: async () => [] });

const { generatePlan, recalibratePlan } = require("./planningService");

// The profile behind the 16 Oct plan: Mon–Sat, 90 minutes, full gym.
const user = { id: "user-1", fitnessGoal: "muscle", experienceLevel: "intermediate", equipment: "full_gym", sessionMinutes: 90, trainingDays: [1, 2, 3, 4, 5, 6], weeklyGoal: 6 };
const ex = (exerciseId, name) => ({ exerciseId, name, sets: 4, reps: "6-8", restSeconds: 90, progressionNote: "Add 2.5 kg" });
const trainingDays = (week) => week.days.filter((d) => d.sessionType === "training").map((d) => d.day.slice(0, 3));

beforeEach(() => {
  prompts = [];
  queuedReplies = [];
  workouts = [];
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
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  workouts = [{ date: new Date("2026-10-13T00:00:00Z"), createdAt: new Date(), exercise: "Barbell Squat", sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 4 }] }];
  const { chatWithPlan } = require("./planningService");
  aiReply = { message: "Solid week: squats nearly all there.", modifiedDays: null };
  await chatWithPlan(user, "plan-1", "How did my week go?", "2026-10-16");
  const prompt = prompts.at(-1);
  assert.match(prompt, /TODAY: Fri 2026-10-16/);
  assert.match(prompt, /EACH WEEK: Push ×2, Pull ×2, Legs ×2 \(6 training days\)/);
  assert.match(prompt, /THIS WEEK SO FAR \(week 1, started \w{3} \d{4}-\d{2}-\d{2}\):/);
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

test("moving on mid-week starts the new week with nothing done", async () => {
  aiReply = { planExplanation: "x", days: ["monday", "tuesday", "wednesday"].map((day) => ({ day, exercises: [ex("bench_press", "Barbell Bench Press")] })) };
  await generatePlan(user, { splitPreference: "push_pull_legs" });
  // Monday's Push, saved during week 1.
  workouts = [{ date: new Date("2026-10-12T00:00:00Z"), createdAt: new Date(Date.now() - 60_000), exercise: "Barbell Bench Press", sets: [{ weight: 60, reps: 10 }] }];
  aiReply = { message: "ok", modifiedDays: null };
  await recalibratePlan(user, "plan-1");
  assert.ok(storedPlan.planData.weekStartedAt, "week 2 knows when it started");

  const { chatWithPlan } = require("./planningService");
  await chatWithPlan(user, "plan-1", "How did my week go?", "2026-10-16");
  assert.match(prompts.at(-1), /Mon 2026-10-12 · Push: not logged\n/, "week 1's workout doesn't count for week 2");
  assert.match(prompts.at(-1), /LOGGED IN THE LAST 7 DAYS[^]*Mon 2026-10-12 Barbell Bench Press/, "but it's still in the log");
});
