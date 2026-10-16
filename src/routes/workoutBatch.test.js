// POST /api/workouts/batch: a whole session in one transaction. No database
// or Firebase: Prisma, sign-in and the achievement service are replaced before
// the routes load. The fake $transaction stages writes and commits them only
// if the callback succeeds, like a real transaction.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const express = require("express");

// ── Fakes ─────────────────────────────────────────────────────────────────
const committed = []; // workouts in the "database"
let failOnCreate = 0; // 1-based create call that throws (0 = never)
let createCalls = 0;
let evaluations = 0;

function fakeCreate(store) {
  return async ({ data }) => {
    createCalls += 1;
    if (failOnCreate && createCalls === failOnCreate) throw new Error("simulated write failure");
    const id = `w${committed.length + store.length + 1}`;
    const row = {
      id,
      userId: data.userId,
      date: data.date.toISOString(),
      exercise: data.exercise,
      category: data.category,
      notes: data.notes,
      deletedAt: null,
      sets: data.sets.create.map((s, i) => ({ id: `${id}-s${i}`, workoutId: id, ...s })),
    };
    store.push(row);
    return row;
  };
}

const fakePrisma = {
  async $transaction(fn) {
    const staged = [];
    const result = await fn({ workout: { create: fakeCreate(staged) } }); // throws → nothing committed
    committed.push(...staged);
    return result;
  },
  workout: { create: fakeCreate(committed) },
};

function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub("config/database.js", { prisma: fakePrisma });
stub("middleware/authMiddleware.js", {
  verifyFirebaseToken: (req, _res, next) => {
    req.user = { dbUser: { id: "user-1" } };
    next();
  },
  requireEmailVerified: (_req, _res, next) => next(),
});
stub("services/achievementService.js", {
  evaluateAchievementsSafely: async () => {
    evaluations += 1;
    return ["first_workout"];
  },
});

// ── Server ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "50kb" }));
app.use("/api/workouts", require("./workoutRoutes"));
app.use(require("../middleware/errorHandler").errorHandler);

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/workouts`;
});
after(() => server.close());

beforeEach(() => {
  committed.length = 0;
  failOnCreate = 0;
  createCalls = 0;
  evaluations = 0;
});

const post = async (url, body) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const entry = (exercise, sets, extra = {}) => ({ exercise, category: "Chest", sets, ...extra });

test("a batch saves every entry, in order, on the batch date", async () => {
  const r = await post(`${base}/batch`, {
    date: "2026-10-12",
    entries: [
      entry("Bench Press", [{ reps: 8, weight: 80 }, { reps: 8, weight: 82.5 }]),
      entry("Dips", [{ reps: 12 }], { category: "Arms", notes: "slow" }),
      entry("Fly", [{ reps: 15, weight: 14 }], { date: "2026-10-12" }),
    ],
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.data.map((w) => w.exercise), ["Bench Press", "Dips", "Fly"]);
  assert.equal(committed.length, 3);
  assert.deepEqual(committed.map((w) => w.date.slice(0, 10)), ["2026-10-12", "2026-10-12", "2026-10-12"]);
  assert.deepEqual(committed[1].sets.map((s) => [s.setNumber, s.reps, s.weight]), [[1, 12, 0]], "set numbers, default weight 0");
  assert.deepEqual([...new Set(committed.map((w) => w.userId))], ["user-1"], "owned by the signed-in user");
  assert.equal(evaluations, 1, "achievements evaluated once");
  assert.deepEqual(r.body.newlyUnlocked, ["first_workout"]);
});

test("all or nothing: a failure mid-batch saves nothing", async () => {
  failOnCreate = 2;
  const r = await post(`${base}/batch`, { date: "2026-10-12", entries: [entry("A", [{ reps: 5 }]), entry("B", [{ reps: 5 }]), entry("C", [{ reps: 5 }])] });
  assert.equal(r.status, 500);
  assert.equal(committed.length, 0);
  assert.equal(evaluations, 0, "no achievement evaluation on failure");
});

test("the same rules as a single workout reject bad batches with 400", async () => {
  const bad = [
    ["empty entries", { date: "2026-10-12", entries: [] }],
    ["bad date", { date: "12/10/2026", entries: [entry("A", [{ reps: 5 }])] }],
    ["entry without sets", { date: "2026-10-12", entries: [entry("A", [])] }],
    ["negative weight", { date: "2026-10-12", entries: [entry("A", [{ reps: 5, weight: -1 }])] }],
    ["fractional reps", { date: "2026-10-12", entries: [entry("A", [{ reps: 5.5 }])] }],
    ["missing category", { date: "2026-10-12", entries: [{ exercise: "A", sets: [{ reps: 5 }] }] }],
    ["entry date differs", { date: "2026-10-12", entries: [entry("A", [{ reps: 5 }], { date: "2026-10-11" })] }],
    ["too many entries", { date: "2026-10-12", entries: Array.from({ length: 31 }, (_, i) => entry(`E${i}`, [{ reps: 5 }])) }],
  ];
  for (const [name, body] of bad) {
    assert.equal((await post(`${base}/batch`, body)).status, 400, name);
  }
  assert.equal(committed.length, 0);
});

test("a single workout still saves on its own", async () => {
  const r = await post(base, { date: "2026-10-12", exercise: "Squat", category: "Legs", sets: [{ reps: 5, weight: 100 }] });
  assert.equal(r.status, 201);
  assert.equal(r.body.data.exercise, "Squat");
});
