// Status codes the app relies on: admin delete, an AI outage while generating,
// and swapping an exercise that isn't in the plan. Services, auth and the AI
// are replaced before the routes load; requests go to a real local server.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");
const express = require("express");

// An adult who has done the coach's health check; tests change it to check the gate.
const { newHealthCheck } = require("../utils/healthCheck");
const cleared = { id: "user-1", firebaseUid: "uid-1", equipment: "full_gym", age: 30, healthCheck: newHealthCheck({}) };
let dbUser = cleared;
const signedIn = (req, res, next) => {
  req.user = { uid: "uid-1", emailVerified: true, dbUser };
  next();
};
stub("middleware/authMiddleware.js", {
  verifyFirebaseToken: signedIn,
  verifyFirebaseTokenWithRevocation: signedIn,
  requireEmailVerified: (req, res, next) => next(),
  requireRecentSignIn: (req, res, next) => next(),
});

let aiCalls = 0;
stub("config/groq.js", {
  GROQ_MODEL: "test",
  groqClient: {
    chat: {
      completions: {
        create: async () => {
          aiCalls += 1;
          throw new Error("Groq is down");
        },
      },
    },
  },
});
const plan = { id: "plan-1", userId: "user-1", weekNumber: 1, criteria: {}, planData: { weeks: [{ week: 1, days: [{ day: "monday", sessionType: "training", exercises: [{ exerciseId: "squat", name: "Barbell Squat" }] }] }] } };
stub("config/database.js", {
  prisma: {
    plan: { findFirst: async ({ where }) => (where.id === plan.id && where.userId === plan.userId ? plan : null) },
    workout: { findMany: async () => [] },
    // Daily AI budgets: nothing used yet.
    aiUsage: { findUnique: async () => null, aggregate: async () => ({ _sum: {} }), upsert: async () => ({}) },
    // Iron Arc Pro: free (no subscription) with the free plan unused, unless a test changes it.
    subscription: { findUnique: async () => subscription },
    trialClaim: { findUnique: async () => null },
    planGeneration: { findMany: async () => plansMade.map((createdAt) => ({ createdAt })) },
  },
});
let subscription = null;
let plansMade = [];
const proYearly = { id: "sub-1", userId: "user-1", plan: "yearly", nextPlan: null, autoRenew: true, currentPeriodEnd: new Date(Date.now() + 86_400_000), trialStartedAt: null, trialEndsAt: null, provider: "test" };
stub("config/firebase.js", { auth: {} });
let profileSaves = [];
stub("services/userService.js", {
  deleteUserEverywhere: async () => ({ postgresDeleted: true, authDeleted: true, errors: [] }),
  updateProfile: async (id, data) => {
    profileSaves.push(data);
    return { ...dbUser, ...data };
  },
});

process.env.ADMIN_SECRET_KEY = "test-key";
const app = express();
app.use(express.json({ limit: "50kb" }));
app.use("/api/plans", require("./planRoutes"));
app.use("/api/admin", require("./adminRoutes"));
app.use("/api/user", require("./userRoutes"));
app.use(require("../middleware/errorHandler").errorHandler);

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const call = (method, url, body, headers = {}) =>
  fetch(base + url, { method, headers: { "Content-Type": "application/json", ...headers }, body: body && JSON.stringify(body) });

test("admin delete that removed everything answers 200 (it always said 'partial')", async () => {
  const res = await call("DELETE", "/api/admin/user/uid-9", null, { "x-admin-key": "test-key" });
  assert.equal(res.status, 200);
});

test("a wrong or missing admin key is the same 403", async () => {
  assert.equal((await call("DELETE", "/api/admin/user/uid-9", null, { "x-admin-key": "nope" })).status, 403);
  assert.equal((await call("DELETE", "/api/admin/user/uid-9")).status, 403);
});

test("an AI outage while generating is a 503 'try again', not a 500", { timeout: 15_000 }, async () => {
  const res = await call("POST", "/api/plans/generate", { criteria: {} });
  assert.equal(res.status, 503);
  assert.match((await res.json()).message, /try again/i);
});

test("someone else's or a missing plan is a 404 from the shared error handler", async () => {
  const res = await call("GET", "/api/plans/not-mine");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).message, "Plan not found.");
});

test("a body that isn't JSON is a 400 that says so", async () => {
  const res = await fetch(base + "/api/plans/plan-1/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
  assert.equal(res.status, 400);
  assert.match((await res.json()).message, /valid JSON/);
});

test("swapping an exercise that isn't in the plan answers 422 without calling the AI", async () => {
  aiCalls = 0;
  const res = await call("POST", "/api/plans/plan-1/substitute", { exerciseId: "bench_press" });
  assert.equal(res.status, 422);
  assert.equal(aiCalls, 0);
});

test("the AI routes need the health check first: a 403 with a code the app acts on, and no AI call", async () => {
  aiCalls = 0;
  subscription = proYearly;
  try {
    dbUser = { ...cleared, healthCheck: null };
    for (const [url, body] of [["/api/plans/generate", { criteria: {} }], ["/api/plans/plan-1/chat", { message: "hi" }], ["/api/plans/plan-1/substitute", { exerciseId: "squat" }], ["/api/plans/plan-1/recalibrate", {}]]) {
      const res = await call("POST", url, body);
      assert.equal(res.status, 403, url);
      assert.equal((await res.json()).code, "HEALTH_CHECK_REQUIRED");
    }
    dbUser = { ...cleared, healthCheck: { ...cleared.healthCheck, version: 0 } };
    assert.equal((await (await call("POST", "/api/plans/plan-1/chat", { message: "hi" })).json()).code, "HEALTH_CHECK_REQUIRED", "an older check is asked again");
    assert.equal(aiCalls, 0);
  } finally {
    dbUser = cleared;
    subscription = null;
  }
});

test("the coach is for adults: under 18 is a 403 COACH_ADULTS_ONLY, health check or not", async () => {
  try {
    dbUser = { ...cleared, age: 17 };
    const res = await call("POST", "/api/plans/plan-1/chat", { message: "hi" });
    assert.equal(res.status, 403);
    assert.equal((await res.json()).code, "COACH_ADULTS_ONLY");
  } finally {
    dbUser = cleared;
  }
});

test("reporting a coach reply works without the health check (it must always be possible)", async () => {
  try {
    dbUser = { ...cleared, age: 16, healthCheck: null };
    const res = await call("POST", "/api/plans/plan-1/chat/report", { messageAt: "x", reason: "other" });
    assert.notEqual(res.status, 403);
  } finally {
    dbUser = cleared;
  }
});

test("the coach chat is Pro: a free user gets 403 PRO_REQUIRED (before the health check) and no AI call", async () => {
  aiCalls = 0;
  try {
    for (const user of [cleared, { ...cleared, healthCheck: null }]) {
      dbUser = user;
      const res = await call("POST", "/api/plans/plan-1/chat", { message: "hi" });
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, "PRO_REQUIRED");
    }
    assert.equal(aiCalls, 0);
  } finally {
    dbUser = cleared;
  }
});

test("a free user's second plan in 30 days is 403 PLAN_LIMIT_REACHED; Pro has no limit", { timeout: 15_000 }, async () => {
  aiCalls = 0;
  try {
    plansMade = [new Date(Date.now() - 5 * 86_400_000)];
    const limited = await call("POST", "/api/plans/generate", { criteria: {} });
    assert.equal(limited.status, 403);
    assert.equal((await limited.json()).code, "PLAN_LIMIT_REACHED");
    assert.equal(aiCalls, 0);

    subscription = proYearly;
    assert.equal((await call("POST", "/api/plans/generate", { criteria: {} })).status, 503, "past the gate: the AI (down here) is called");
  } finally {
    plansMade = [];
    subscription = null;
  }
});

test("next week and swaps stay free: a used free plan doesn't block them", async () => {
  try {
    plansMade = [new Date()];
    assert.equal((await call("POST", "/api/plans/plan-1/substitute", { exerciseId: "bench_press" })).status, 422, "reached the swap itself");
  } finally {
    plansMade = [];
  }
});

test("PRO_GATE=off opens every AI feature (for deploying before the app has the Pro screen)", { timeout: 15_000 }, async () => {
  process.env.PRO_GATE = "off";
  try {
    plansMade = [new Date()];
    assert.equal((await call("POST", "/api/plans/generate", { criteria: {} })).status, 503);
  } finally {
    delete process.env.PRO_GATE;
    plansMade = [];
  }
});

test("'Go easy on → Other' with a danger sign gets the safety reply and isn't saved; an ordinary note is", async () => {
  profileSaves = [];
  const refused = await call("PATCH", "/api/user/profile", { avoidNote: "chest pain when I lift" });
  assert.equal(refused.status, 422);
  const body = await refused.json();
  assert.equal(body.code, "SAFETY_STOP");
  assert.match(body.message, /stop/i);
  assert.equal(profileSaves.length, 0);

  const ok = await call("PATCH", "/api/user/profile", { avoidNote: "old ankle sprain" });
  assert.equal(ok.status, 200);
  assert.deepEqual(profileSaves, [{ avoidNote: "old ankle sprain" }]);
});
