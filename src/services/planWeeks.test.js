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
let prompts;
stub("config/groq.js", {
  GROQ_MODEL: "test",
  groqClient: {
    chat: {
      completions: {
        create: async ({ messages }) => {
          prompts.push(messages[1].content);
          return { choices: [{ finish_reason: "stop", message: { content: JSON.stringify(aiReply) } }], usage: {} };
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
    workout: { findMany: async () => [] },
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

test("a reply without the sessions is a 503 to try again", async () => {
  aiReply = { planExplanation: "x", days: [] };
  await assert.rejects(generatePlan(user), { status: 503 });
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
