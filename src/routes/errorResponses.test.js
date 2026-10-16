// Status codes the app relies on: admin delete, an AI outage while generating,
// and swapping an exercise that isn't in the plan. Services, auth and the AI
// are replaced before the routes load; requests go to a real local server.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");

function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const signedIn = (req, res, next) => {
  req.user = { uid: "uid-1", emailVerified: true, dbUser: { id: "user-1", firebaseUid: "uid-1", equipment: "full_gym" } };
  next();
};
stub("middleware/authMiddleware.js", {
  verifyFirebaseToken: signedIn,
  requireEmailVerified: (req, res, next) => next(),
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
  },
});
stub("config/firebase.js", { auth: {} });
stub("services/userService.js", {
  deleteUserEverywhere: async () => ({ postgresDeleted: true, authDeleted: true, errors: [] }),
});

process.env.ADMIN_SECRET_KEY = "test-key";
const app = express();
app.use(express.json({ limit: "50kb" }));
app.use("/api/plans", require("./planRoutes"));
app.use("/api/admin", require("./adminRoutes"));
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
