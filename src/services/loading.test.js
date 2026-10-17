// What the plan and achievement services read from the database. A fake
// Prisma records every query; nothing touches a real database.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");

let queries;
const record = (name, result) => async (args = {}) => {
  queries.push({ name, args });
  return typeof result === "function" ? result(args) : result;
};
const plan = { id: "plan-1", userId: "user-1", name: "My Plan", isActive: true, weekNumber: 1, planData: { weeks: [] } };

stub("config/database.js", {
  prisma: {
    plan: {
      findMany: record("plan.findMany", [{ id: "plan-1", name: "My Plan" }]),
      findFirst: record("plan.findFirst", ({ where }) => (where.id === plan.id && where.userId === plan.userId ? plan : null)),
      update: record("plan.update", plan),
      count: record("plan.count", 1),
    },
    planGeneration: { count: record("planGeneration.count", 1) },
    workout: { findMany: record("workout.findMany", [{ date: "2026-10-01", createdAt: "2026-10-01", exercise: "Squat", category: "Legs", sets: [{ reps: 5, weight: 100 }] }]) },
    bodyWeight: { findMany: record("bodyWeight.findMany", []) },
    customExercise: { count: record("customExercise.count", 0) },
    user: { findUnique: record("user.findUnique", { weeklyGoal: 3, trainingDays: [] }) },
    achievement: {
      findMany: record("achievement.findMany", []),
      createMany: record("achievement.createMany", { count: 1 }),
    },
  },
});
stub("config/groq.js", { groqClient: {}, GROQ_MODEL: "test" });

const planningService = require("./planningService");
const { getAchievements } = require("./achievementService");

beforeEach(() => {
  queries = [];
});

test("the plan list never reads the plans themselves", async () => {
  await planningService.listPlans("user-1");
  assert.deepEqual(queries[0].args.omit, { planData: true });
});

test("renaming only checks ownership, without loading the plan", async () => {
  await planningService.renamePlan("user-1", "plan-1", "Strength");
  const check = queries.find((q) => q.name === "plan.findFirst");
  assert.deepEqual(check.args.select, { id: true, isActive: true });
});

test("someone else's plan is still a 404", async () => {
  await assert.rejects(planningService.renamePlan("user-2", "plan-1", "Mine now"), { status: 404 });
  assert.equal(queries.some((q) => q.name === "plan.update"), false);
});

test("the achievements screen reads the workout history once", async () => {
  const badges = await getAchievements("user-1");
  assert.equal(queries.filter((q) => q.name === "workout.findMany").length, 1);
  assert.ok(badges.length > 0);
  // Met badges are saved (back-fill), and the first workout badge is among them.
  const saved = queries.find((q) => q.name === "achievement.createMany").args.data.map((d) => d.badgeKey);
  assert.ok(saved.includes("workout_1"));
});
