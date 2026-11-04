/*
 * The coach eval: every conversation in coachCases.js, sent through the real
 * chat service (prompts, the real model, and every guard after it), then
 * graded by rules (graders.js). The database is an in-memory fake: nothing is
 * read from or written to a real one. Needs GROQ_API_KEY.
 *
 *   npm run eval                       all cases
 *   npm run eval -- --only=safety.dizzy,change.three-days
 *
 * Env: EVAL_RUNS (each case this many times; it passes only if every run
 * does, default 1), EVAL_TOKENS_PER_MINUTE (pacing for the provider's limit,
 * default 8000; 0 turns it off), EVAL_MIN_PASS_RATE (default 0.85).
 * Fails (exit 1) when a critical case fails or the pass rate is too low.
 * Results go to evals/results/ and, in GitHub Actions, the run's summary.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { stub } = require("../src/testing/stub");

if (!process.env.GROQ_API_KEY) {
  console.error("The coach eval needs GROQ_API_KEY (in .env, or a repository secret in CI).");
  process.exit(2);
}

// The in-memory database and the eval's plan
let storedPlan = null;
let workouts = [];
let tokens = 0;
stub("config/database.js", {
  prisma: {
    plan: {
      findFirst: async () => storedPlan,
      updateMany: async ({ data }) => {
        storedPlan = { ...storedPlan, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
    },
    workout: { findMany: async () => workouts },
    user: { update: async () => ({}) },
    aiUsage: {
      findUnique: async () => null,
      aggregate: async () => ({ _sum: {} }),
      upsert: async ({ create }) => {
        tokens += create.tokensIn + create.tokensOut;
        return create;
      },
    },
  },
});
stub("services/achievementService.js", { evaluateAchievementsSafely: async () => [] });

const { chatWithPlan } = require("../src/services/plans");
const { validateAndSanitizePlan } = require("../src/utils/planValidator");
const { newHealthCheck, HEALTH_CHECK_QUESTIONS } = require("../src/utils/healthCheck");
const CASES = require("./coachCases");

const TODAY = "2026-11-04"; // a Wednesday
const WEEK_STARTS = "2026-11-02";
const ex = (exerciseId, sets, reps, restSeconds) => ({ exerciseId, sets, reps, restSeconds });
const rest = (day) => ({ day, sessionType: "rest", recoveryNote: "Rest and recover." });
const train = (day, targetMuscles, exercises) => ({ day, sessionType: "training", targetMuscles, estimatedDurationMinutes: 60, exercises });

/** A 4-day upper/lower week, as a plan the app would hold. */
const PLAN_DATA = validateAndSanitizePlan({
  planExplanation: "Upper/lower, four days a week.",
  totalWeeks: 8,
  weekStartsOn: WEEK_STARTS,
  weeks: [
    {
      week: 1,
      days: [
        train("monday", ["chest", "back", "shoulders"], [ex("bench_press", 4, "6-8", 120), ex("barbell_row", 4, "8-10", 90), ex("overhead_press", 3, "8-10", 90), ex("lat_pulldown", 3, "10-12", 60)]),
        train("tuesday", ["quads", "glutes", "hamstrings"], [ex("squat", 4, "5", 150), ex("rdl", 3, "8-10", 120), ex("leg_press", 3, "10-12", 90), ex("calf_raise", 3, "12-15", 60)]),
        rest("wednesday"),
        train("thursday", ["chest", "back", "biceps", "triceps"], [ex("dumbbell_press", 4, "8-10", 90), ex("pull_up", 4, "6-8", 120), ex("bicep_curl", 3, "10-12", 60), ex("tricep_pushdown", 3, "10-12", 60)]),
        train("friday", ["hamstrings", "glutes", "core"], [ex("deadlift", 3, "5", 180), ex("lunge", 3, "10 per side", 90), ex("leg_curl", 3, "10-12", 60), ex("plank", 3, "30-45s", 60)]),
        rest("saturday"),
        rest("sunday"),
      ],
    },
  ],
});

/** Monday and Tuesday are logged; the rest of the week is still to come. */
const LOGGED = [
  { date: new Date("2026-11-02T00:00:00Z"), exercise: "Barbell Bench Press", sets: [{ reps: 8, weight: 70 }, { reps: 7, weight: 70 }, { reps: 6, weight: 70 }] },
  { date: new Date("2026-11-02T00:00:00Z"), exercise: "Barbell Row", sets: [{ reps: 10, weight: 60 }, { reps: 9, weight: 60 }] },
  { date: new Date("2026-11-03T00:00:00Z"), exercise: "Barbell Squat", sets: [{ reps: 5, weight: 100 }, { reps: 5, weight: 100 }, { reps: 5, weight: 100 }] },
];

const allNo = Object.fromEntries(HEALTH_CHECK_QUESTIONS.map((key) => [key, false]));
const userFor = (c) => ({
  id: "eval-user",
  age: 32,
  fitnessGoal: "muscle",
  experienceLevel: "intermediate",
  equipment: "full_gym",
  sessionMinutes: 60,
  trainingDays: [1, 2, 4, 5],
  weeklyGoal: 4,
  avoidAreas: c.avoid ?? [],
  healthCheck: newHealthCheck(c.safeMode ? { ...allNo, joints: true } : allNo),
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tokensPerMinute = Number(process.env.EVAL_TOKENS_PER_MINUTE ?? 8000);

/** One turn of a case, graded: { passed, failures, message, proposal, tokens }. */
async function runCase(c) {
  const stamp = (i) => new Date(Date.parse(`${TODAY}T08:00:00Z`) + i * 60_000).toISOString();
  storedPlan = {
    id: "eval-plan",
    userId: "eval-user",
    weekNumber: 1,
    criteria: {},
    isActive: true,
    updatedAt: new Date(),
    planData: { ...PLAN_DATA, _chatHistory: (c.history ?? []).map((m, i) => ({ ...m, timestamp: stamp(i) })) },
  };
  workouts = LOGGED;
  tokens = 0;

  const turn = { weekNumber: 1, before: PLAN_DATA.weeks[0].days };
  try {
    turn.result = await chatWithPlan(userFor(c), "eval-plan", c.message, TODAY);
    turn.pending = storedPlan.planData._pendingChange?.weeks?.[0]?.days ?? null;
  } catch (error) {
    turn.error = error.message;
  }
  turn.tokens = tokens;

  const failures = c.checks.map((chk) => ({ check: chk.name, why: chk.test(turn) })).filter((f) => f.why);
  return { passed: failures.length === 0, failures, message: turn.result?.message ?? null, proposal: !!turn.result?.proposal, tokens: turn.tokens };
}

async function main() {
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");
  const cases = only ? CASES.filter((c) => only.includes(c.id)) : CASES;
  const runs = Math.max(1, Number(process.env.EVAL_RUNS ?? 1));
  const minPassRate = Number(process.env.EVAL_MIN_PASS_RATE ?? 0.85);
  // The eval's own console only: the service's AI and guard logs are noise here.
  const log = console.log;
  console.log = console.warn = () => {};

  log(`Coach eval: ${cases.length} cases × ${runs} run(s), model ${process.env.GROQ_MODEL || "openai/gpt-oss-120b"}\n`);
  const results = [];
  for (const c of cases) {
    const attempts = [];
    for (let r = 0; r < runs; r++) {
      const attempt = await runCase(c);
      attempts.push(attempt);
      // Stay under the provider's tokens-per-minute limit.
      if (tokensPerMinute > 0 && attempt.tokens > 0) await sleep(Math.ceil((attempt.tokens / tokensPerMinute) * 60_000));
    }
    const passed = attempts.every((a) => a.passed);
    results.push({ id: c.id, critical: !!c.critical, passed, attempts });
    log(`${passed ? "PASS" : "FAIL"}${c.critical ? " [critical]" : ""} ${c.id}`);
    for (const a of attempts.filter((x) => !x.passed)) {
      for (const f of a.failures) log(`     - ${f.check}: ${f.why}`);
      log(`     reply: ${String(a.message ?? "(none)").slice(0, 240)}`);
    }
  }

  const passedCount = results.filter((r) => r.passed).length;
  const passRate = results.length ? passedCount / results.length : 1;
  const criticalFailed = results.filter((r) => r.critical && !r.passed).map((r) => r.id);
  const totalTokens = results.flatMap((r) => r.attempts).reduce((n, a) => n + a.tokens, 0);
  const ok = criticalFailed.length === 0 && passRate >= minPassRate;
  log(`\n${passedCount}/${results.length} passed (${Math.round(passRate * 100)}%, needs ${Math.round(minPassRate * 100)}%) · ${totalTokens} tokens`);
  if (criticalFailed.length) log(`Critical failures: ${criticalFailed.join(", ")}`);
  log(ok ? "Eval passed." : "Eval failed.");

  // Results for later comparison, and the GitHub Actions summary.
  const dir = path.join(__dirname, "results");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `coach-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  const report = { at: new Date().toISOString(), model: process.env.GROQ_MODEL || "openai/gpt-oss-120b", runs, passRate, minPassRate, criticalFailed, totalTokens, results };
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  log(`Results: ${path.relative(process.cwd(), file)}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map((r) => `| ${r.passed ? "✅" : "❌"} | ${r.id}${r.critical ? " (critical)" : ""} | ${r.attempts.flatMap((a) => a.failures.map((f) => `${f.check}: ${f.why}`)).join("<br>") || ""} |`);
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [`## Coach eval: ${passedCount}/${results.length} (${Math.round(passRate * 100)}%)`, "", "| | Case | Failed checks |", "|---|---|---|", ...rows, ""].join("\n"),
    );
  }
  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
