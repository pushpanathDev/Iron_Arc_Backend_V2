// PATCH /api/workouts/move: a whole session to another day, in one transaction.
// No database or Firebase: Prisma, sign-in and the achievement service are
// replaced before the routes load. The fake $transaction works on a copy and
// keeps it only if the callback succeeds, like a real transaction.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");
const express = require("express");

// ── Fakes ─────────────────────────────────────────────────────────────────
let rows = []; // workouts in the "database"
let evaluations = 0;

const matches = (row, where) =>
  (!where.id?.in || where.id.in.includes(row.id)) && (where.userId === undefined || row.userId === where.userId) && (where.deletedAt !== null || row.deletedAt === null);

const workoutTable = (store) => ({
  async updateMany({ where, data }) {
    const hit = store.filter((r) => matches(r, where));
    for (const r of hit) r.date = data.date.toISOString();
    return { count: hit.length };
  },
  async findMany({ where }) {
    return store.filter((r) => matches(r, where)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
});

const fakePrisma = {
  async $transaction(fn) {
    const copy = rows.map((r) => ({ ...r }));
    const result = await fn({ workout: workoutTable(copy) }); // throws → the copy is dropped
    rows = copy;
    return result;
  },
};

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
    return [];
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

const row = (id, userId = "user-1", extra = {}) => ({ id, userId, date: "2026-10-18T00:00:00.000Z", exercise: id, deletedAt: null, createdAt: `2026-10-18T10:0${id.slice(-1)}:00.000Z`, sets: [], ...extra });

beforeEach(() => {
  rows = [row("w1"), row("w2"), row("w3"), row("other", "user-2"), row("gone", "user-1", { deletedAt: "2026-10-18T12:00:00.000Z" })];
  evaluations = 0;
});

const patch = async (body) => {
  const res = await fetch(`${base}/move`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const dayOf = (id) => rows.find((r) => r.id === id).date.slice(0, 10);

test("moves every workout of the session to the new day", async () => {
  const r = await patch({ ids: ["w3", "w1", "w2"], date: "2026-10-15" });
  assert.equal(r.status, 200);
  assert.deepEqual(["w1", "w2", "w3"].map(dayOf), ["2026-10-15", "2026-10-15", "2026-10-15"]);
  assert.deepEqual(r.body.data.map((w) => w.id), ["w1", "w2", "w3"], "in the order they were logged");
  assert.equal(evaluations, 1, "achievements evaluated once");
});

test("all or nothing: a workout that isn't yours, or was deleted, moves none", async () => {
  for (const ids of [["w1", "other"], ["w1", "gone"], ["w1", "missing"]]) {
    const r = await patch({ ids, date: "2026-10-15" });
    assert.equal(r.status, 404, ids.join(","));
    assert.equal(dayOf("w1"), "2026-10-18", "w1 stays put");
  }
  assert.equal(dayOf("other"), "2026-10-18", "someone else's workout is never touched");
  assert.equal(evaluations, 0);
});

test("bad requests are refused with 400", async () => {
  const bad = [
    ["no ids", { ids: [], date: "2026-10-15" }],
    ["bad date", { ids: ["w1"], date: "15/10/2026" }],
    ["repeated id", { ids: ["w1", "w1"], date: "2026-10-15" }],
    ["too many", { ids: Array.from({ length: 51 }, (_, i) => `x${i}`), date: "2026-10-15" }],
    ["no date", { ids: ["w1"] }],
  ];
  for (const [name, body] of bad) assert.equal((await patch(body)).status, 400, name);
  assert.equal(dayOf("w1"), "2026-10-18");
});
