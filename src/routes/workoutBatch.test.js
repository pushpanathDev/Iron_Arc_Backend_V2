/**
 * Runnable check for POST /api/workouts/batch (not a test framework).
 *   node src/routes/workoutBatch.test.js
 * No database or Firebase: the Prisma module, the auth middleware and the
 * achievement service are replaced before workoutRoutes is loaded. The fake
 * $transaction stages writes and commits them only if the callback succeeds,
 * like a real transaction.
 */
const path = require("path");
const express = require("express");

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

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

const workoutRoutes = require("./workoutRoutes");

// ── Server ────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "50kb" }));
app.use("/api/workouts", workoutRoutes);
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => res.status(500).json({ success: false, message: err.message }));

const entry = (exercise, sets, extra = {}) => ({ exercise, category: "Chest", sets, ...extra });

async function main() {
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}/api/workouts`;
  const post = async (url, body) => {
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const reset = () => {
    committed.length = 0;
    failOnCreate = 0;
    createCalls = 0;
    evaluations = 0;
  };

  try {
    console.log("# Batch create");
    reset();
    let r = await post(`${base}/batch`, {
      date: "2026-10-12",
      entries: [
        entry("Bench Press", [{ reps: 8, weight: 80 }, { reps: 8, weight: 82.5 }]),
        entry("Dips", [{ reps: 12 }], { category: "Arms", notes: "slow" }),
        entry("Fly", [{ reps: 15, weight: 14 }], { date: "2026-10-12" }),
      ],
    });
    check("201 Created", r.status, 201);
    check("returns created records in order", r.body.data.map((w) => w.exercise), ["Bench Press", "Dips", "Fly"]);
    check("all saved", committed.length, 3);
    check("batch date on every record", committed.map((w) => w.date.slice(0, 10)), ["2026-10-12", "2026-10-12", "2026-10-12"]);
    check("set numbers and default weight", committed[1].sets.map((s) => [s.setNumber, s.reps, s.weight]), [[1, 12, 0]]);
    check("owned by the signed-in user", [...new Set(committed.map((w) => w.userId))], ["user-1"]);
    check("achievements evaluated once", evaluations, 1);
    check("newlyUnlocked passed through", r.body.newlyUnlocked, ["first_workout"]);

    console.log("\n# All or nothing");
    reset();
    failOnCreate = 2;
    r = await post(`${base}/batch`, { date: "2026-10-12", entries: [entry("A", [{ reps: 5 }]), entry("B", [{ reps: 5 }]), entry("C", [{ reps: 5 }])] });
    check("failure → 500", r.status, 500);
    check("nothing saved after a mid-batch failure", committed.length, 0);
    check("no achievement evaluation on failure", evaluations, 0);

    console.log("\n# Validation (same rules as the single create)");
    reset();
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
      r = await post(`${base}/batch`, body);
      check(`400 for ${name}`, r.status, 400);
    }
    check("nothing saved by rejected requests", committed.length, 0);

    console.log("\n# Single create unchanged");
    reset();
    r = await post(base, { date: "2026-10-12", exercise: "Squat", category: "Legs", sets: [{ reps: 5, weight: 100 }] });
    check("POST /api/workouts still 201", r.status, 201);
    check("single create returns one record", r.body.data.exercise, "Squat");
  } finally {
    server.close();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main();
