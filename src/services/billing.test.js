// Iron Arc Pro subscriptions against an in-memory database: the trial, a
// double-tapped Pay, renewals, switching plan, cancel and resume, the free plan.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");

let subs;
let claims;
let payments;
let plansMade;
let paymentsMade;
let locks;
let userWrites;
const fakeDb = {
  $transaction: async (work) => (Array.isArray(work) ? Promise.all(work) : work(fakeDb)),
  // The row lock (a tagged template: the SQL's pieces, then its values).
  $queryRaw: async (sql, ...values) => {
    locks.push({ sql: sql.join("?"), values });
    return [];
  },
  user: {
    update: async () => {
      userWrites += 1;
      return {};
    },
    findUnique: async ({ where }) => (where.firebaseUid === "uid-1" ? { id: "user-1", email: "Lifter+gym@Gmail.com", subscription: subs.get("user-1") ?? null } : null),
  },
  trialClaim: {
    findUnique: async ({ where }) => (claims.has(where.emailHash) ? { emailHash: where.emailHash } : null),
    upsert: async ({ where }) => claims.add(where.emailHash),
    deleteMany: async ({ where }) => ({ count: claims.delete(where.emailHash) ? 1 : 0 }),
  },
  subscription: {
    findUnique: async ({ where }) => subs.get(where.userId) ?? null,
    upsert: async ({ where, create, update }) => {
      const row = subs.has(where.userId) ? { ...subs.get(where.userId), ...update } : { id: "sub-1", ...create };
      subs.set(where.userId, row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = { ...subs.get(where.userId), ...data };
      subs.set(where.userId, row);
      return row;
    },
    deleteMany: async ({ where }) => ({ count: subs.delete(where.userId) ? 1 : 0 }),
    // The daily trial reminder: trials ending in the window, with their user.
    findMany: async ({ where }) =>
      [...subs.entries()]
        .filter(([, s]) => s.autoRenew === where.autoRenew && !s.trialReminderSentAt && s.trialEndsAt > where.trialEndsAt.gt && s.trialEndsAt <= where.trialEndsAt.lte)
        .map(([userId, s]) => ({ ...s, user: { id: userId, email: user.email, displayName: "Pushpa" } })),
    updateMany: async ({ where, data }) => {
      const entry = [...subs.entries()].find(([, s]) => s.id === where.id && !s.trialReminderSentAt);
      if (!entry) return { count: 0 };
      subs.set(entry[0], { ...entry[1], ...data });
      return { count: 1 };
    },
  },
  payment: {
    findUnique: async ({ where }) => payments.find((p) => p.reference === where.reference) ?? null,
    create: async ({ data }) => {
      if (payments.some((p) => p.reference === data.reference)) throw Object.assign(new Error("unique"), { code: "P2002" });
      paymentsMade += 1;
      const row = { id: `pay-${paymentsMade}`, createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, paymentsMade)), ...data };
      payments.push(row);
      return row;
    },
    createMany: async ({ data }) => {
      for (const row of data) await fakeDb.payment.create({ data: row });
      return { count: data.length };
    },
    findMany: async ({ where, take }) =>
      payments
        .filter((p) => p.userId === where.userId)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, take),
    deleteMany: async ({ where }) => {
      const before = payments.length;
      payments = payments.filter((p) => p.userId !== where.userId);
      return { count: before - payments.length };
    },
  },
  planGeneration: {
    findMany: async ({ where, take }) =>
      plansMade
        .filter((d) => d >= where.createdAt.gte)
        .sort((a, b) => a - b)
        .slice(0, take)
        .map((createdAt) => ({ createdAt })),
  },
};
stub("config/database.js", { prisma: fakeDb });

const billing = require("./billingService");

const user = { id: "user-1", age: 30, email: "lifter@gmail.com" };
const at = (iso) => new Date(iso);
const NOW = at("2026-11-02T10:00:00Z");

beforeEach(() => {
  subs = new Map();
  claims = new Set();
  payments = [];
  plansMade = [];
  paymentsMade = 0;
  locks = [];
  userWrites = 0;
});

test("billing locks the account row without changing it", async () => {
  await billing.checkout(user, { plan: "monthly", key: "key-00001" }, NOW);
  await billing.billingOf(user, at("2026-12-05T00:00:00Z")); // a renewal is due: settled under the lock
  await billing.claimFreePlan(fakeDb, "user-1", NOW);
  assert.ok(locks.length >= 2);
  assert.ok(locks.every((lock) => /FOR UPDATE/.test(lock.sql) && lock.values[0] === "user-1"));
  assert.equal(userWrites, 0, "no write to the account (its updatedAt stays)");
});

test("the first checkout starts the 7-day trial, leading into the chosen plan", async () => {
  const state = await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  assert.equal(state.pro.status, "trial");
  assert.equal(state.pro.trialEndsAt, "2026-11-09T10:00:00.000Z");
  assert.deepEqual(state.pro.nextCharge, { plan: "yearly", amount: 119900, currency: "INR", on: "2026-11-09T10:00:00.000Z" });
  assert.equal(state.pro.trialAvailable, false);
  assert.deepEqual(state.payments.map((p) => [p.kind, p.amount, p.provider]), [["trial", 0, "test"]]);
  assert.deepEqual(state.plans.map((p) => [p.id, p.amount]), [["monthly", 14900], ["yearly", 119900]]);
});

test("a double-tapped Pay (same key) changes nothing; another checkout while Pro is refused", async () => {
  await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  const again = await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  assert.equal(again.payments.length, 1);
  await assert.rejects(billing.checkout(user, { plan: "monthly", key: "key-00002" }, NOW), { status: 409, code: "ALREADY_PRO" });
});

test("Pro is for adults", async () => {
  await assert.rejects(billing.checkout({ ...user, age: 16 }, { plan: "monthly", key: "key-00001" }, NOW), { status: 403 });
  await assert.rejects(billing.checkout({ ...user, age: null }, { plan: "monthly", key: "key-00001" }, NOW), { status: 403 });
  assert.equal(subs.size, 0);
});

test("when the trial ends the plan is charged, once, however often it's read", async () => {
  await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  const later = at("2026-11-10T09:00:00Z");
  await billing.proStatus(user, later);
  const state = await billing.billingOf(user, later);
  assert.equal(state.pro.status, "active");
  assert.equal(state.pro.periodEnd, "2027-11-09T10:00:00.000Z");
  assert.deepEqual(state.payments.map((p) => [p.kind, p.plan, p.amount]), [["renewal", "yearly", 119900], ["trial", "yearly", 0]]);
});

test("change plan takes effect at the next renewal, and choosing the current plan undoes it", async () => {
  await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  let state = await billing.changePlan(user, "monthly", NOW);
  assert.equal(state.pro.plan, "yearly");
  assert.equal(state.pro.nextPlan, "monthly");
  assert.equal(state.pro.nextCharge.amount, 14900);

  state = await billing.changePlan(user, "yearly", NOW);
  assert.equal(state.pro.nextPlan, null);

  await billing.changePlan(user, "monthly", NOW);
  state = await billing.billingOf(user, at("2026-11-09T10:00:00Z"));
  assert.equal(state.pro.plan, "monthly");
  assert.equal(state.pro.periodEnd, "2026-12-09T10:00:00.000Z");
  assert.equal(state.payments[0].amount, 14900);
});

test("cancel keeps Pro until the period ends, then nothing is charged; resume before then renews", async () => {
  await billing.checkout(user, { plan: "monthly", key: "key-00001" }, NOW);
  let state = await billing.cancel(user, NOW);
  assert.equal(state.pro.status, "cancelled");
  assert.equal(state.pro.active, true);
  assert.equal(state.pro.nextCharge, null);
  await assert.rejects(billing.changePlan(user, "yearly", NOW), { status: 409, code: "NOT_RENEWING" });

  state = await billing.resume(user, NOW);
  assert.equal(state.pro.status, "trial");

  await billing.cancel(user, NOW);
  state = await billing.billingOf(user, at("2026-11-20T00:00:00Z"));
  assert.equal(state.pro.status, "free");
  assert.equal(state.payments.length, 1, "only the trial");
  await assert.rejects(billing.resume(user, at("2026-11-20T00:00:00Z")), { status: 409, code: "NOT_PRO" });
});

test("subscribing again after it ended: no second trial, the first period is paid now", async () => {
  await billing.checkout(user, { plan: "monthly", key: "key-00001" }, NOW);
  await billing.cancel(user, NOW);
  const state = await billing.checkout(user, { plan: "monthly", key: "key-00002" }, at("2026-12-01T00:00:00Z"));
  assert.equal(state.pro.status, "active");
  assert.equal(state.pro.periodEnd, "2027-01-01T00:00:00.000Z");
  assert.deepEqual(state.payments.map((p) => [p.kind, p.amount]), [["purchase", 14900], ["trial", 0]]);
});

test("the free plan: one new plan per 30 days for users without Pro", async () => {
  await billing.claimFreePlan(fakeDb, "user-1", NOW);
  plansMade = [at("2026-10-23T10:00:00Z")];
  await assert.rejects(billing.claimFreePlan(fakeDb, "user-1", NOW), { status: 403, code: "PLAN_LIMIT_REACHED" });
  const { freePlan } = await billing.proStatus(user, NOW);
  assert.deepEqual(freePlan, { limit: 1, used: 1, resetsAt: "2026-11-22T10:00:00.000Z" });

  plansMade = [at("2026-10-01T10:00:00Z")];
  await billing.claimFreePlan(fakeDb, "user-1", NOW);
});

test("the admin reset gives the trial back", async () => {
  await billing.checkout(user, { plan: "monthly", key: "key-00001" }, NOW);
  assert.deepEqual(await billing.resetSubscription("uid-1"), { payments: 1, subscriptions: 1 });
  assert.equal((await billing.billingOf(user, NOW)).pro.trialAvailable, true);
  await assert.rejects(billing.resetSubscription("uid-unknown"), { status: 404 });
});

test("one trial per person: a new account with the same email (any spelling) pays from day one", async () => {
  await billing.checkout(user, { plan: "monthly", key: "key-00001" }, NOW);
  assert.equal(claims.size, 1, "the trial is noted, as a fingerprint");
  assert.ok(![...claims][0].includes("lifter"), "never the email itself");

  // The account is deleted (its rows go), then the same person signs up again.
  subs = new Map();
  payments = [];
  const again = { id: "user-1", age: 30, email: "Li.fter+new@googlemail.com" };
  assert.equal((await billing.billingOf(again, NOW)).pro.trialAvailable, false);
  const state = await billing.checkout(again, { plan: "monthly", key: "key-00002" }, NOW);
  assert.equal(state.pro.status, "active");
  assert.deepEqual(state.payments.map((p) => [p.kind, p.amount]), [["purchase", 14900]]);

  // Someone else still gets theirs.
  assert.equal((await billing.billingOf({ ...user, email: "someone@else.com" }, NOW)).pro.trialAvailable, true);
});

test("deleting an account that had the trial notes it; one that never had it doesn't", async () => {
  await billing.rememberTrial("uid-1");
  assert.equal(claims.size, 0);
  subs.set("user-1", { trialStartedAt: NOW });
  await billing.rememberTrial("uid-1");
  assert.equal(claims.size, 1);
  await billing.rememberTrial("uid-unknown");
  assert.equal(claims.size, 1);
});

test("a new member gets one welcome email; a repeated tap sends none", async () => {
  const sent = [];
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Iron Arc <pro@mail.example.com>";
  global.fetch = async (url, init) => {
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ id: "email-1" }) };
  };
  try {
    await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
    await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, "https://api.resend.com/emails");
    assert.deepEqual(sent[0].body.to, ["lifter@gmail.com"]);
    assert.match(sent[0].body.subject, /Pro club/);
    assert.match(sent[0].headers["Idempotency-Key"], /^pro-welcome-pay-1$/);
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
});

test("an email that can't be sent never fails the checkout", async () => {
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Iron Arc <pro@mail.example.com>";
  global.fetch = async () => ({ ok: false, status: 500, text: async () => "down" });
  try {
    const state = await billing.checkout(user, { plan: "monthly", key: "key-00001" }, NOW);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(state.pro.status, "trial");
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
});

/** Captures what would go to Resend, while `work` runs. */
async function capturingEmails(work) {
  const sent = [];
  const realFetch = global.fetch;
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Iron Arc <pro@mail.example.com>";
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ id: "email" }) };
  };
  try {
    await work();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    global.fetch = realFetch;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
  return sent.map((e) => e.subject);
}

test("cancelling sends one 'still Pro until' email; cancelling again sends none", async () => {
  await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  const subjects = await capturingEmails(async () => {
    await billing.cancel(user, NOW);
    await billing.cancel(user, NOW);
  });
  assert.deepEqual(subjects, ["Pro cancelled: you're still Pro until 9 Nov 2026"]);
});

test("a renewal emails its receipt once, however often it's read; the trial turning paid says so", async () => {
  await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  const later = at("2026-11-10T09:00:00Z");
  const subjects = await capturingEmails(async () => {
    await billing.billingOf(user, later);
    await billing.billingOf(user, later);
  });
  assert.deepEqual(subjects, ["Your trial's done: welcome to Pro for real 💪"]);
});

test("the daily job reminds a trial ending within two days, once; not a cancelled or long one", async () => {
  await billing.checkout(user, { plan: "yearly", key: "key-00001" }, NOW);
  const dayBefore = at("2026-11-08T09:00:00Z");

  let result;
  let subjects = await capturingEmails(async () => (result = await billing.sendTrialReminders(at("2026-11-04T09:00:00Z"))));
  assert.deepEqual(subjects, [], "five days left: too early");

  subjects = await capturingEmails(async () => (result = await billing.sendTrialReminders(dayBefore)));
  assert.deepEqual(subjects, ["Your Pro trial ends on 9 Nov 2026 ⏳"]);
  assert.deepEqual(result, { due: 1, sent: 1 });

  subjects = await capturingEmails(() => billing.sendTrialReminders(dayBefore));
  assert.deepEqual(subjects, [], "only once");

  // A cancelled trial won't be charged, so it isn't reminded.
  subs = new Map();
  claims = new Set();
  await billing.checkout(user, { plan: "monthly", key: "key-00002" }, NOW);
  await billing.cancel(user, NOW);
  subjects = await capturingEmails(() => billing.sendTrialReminders(dayBefore));
  assert.deepEqual(subjects, []);
});
