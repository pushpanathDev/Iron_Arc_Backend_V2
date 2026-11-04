// Iron Arc Pro's rules: calendar months, renewals, the trial, what the app is told and the gate.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { addMonths, settle, startSubscription, proSummary, freePlanSummary, proAccessError, PLANS } = require("./billing");

const at = (iso) => new Date(iso);
const sub = (fields = {}) => ({ id: "sub-1", plan: "monthly", nextPlan: null, autoRenew: true, currentPeriodEnd: at("2026-12-02T10:00:00Z"), trialStartedAt: null, trialEndsAt: null, provider: "test", ...fields });

afterEach(() => delete process.env.PRO_GATE);

test("months are calendar months, kept on the last day of a shorter month", () => {
  assert.equal(addMonths(at("2026-11-02T10:00:00Z"), 1).toISOString(), "2026-12-02T10:00:00.000Z");
  assert.equal(addMonths(at("2027-01-31T10:00:00Z"), 1).toISOString(), "2027-02-28T10:00:00.000Z");
  assert.equal(addMonths(at("2028-01-31T10:00:00Z"), 1).toISOString(), "2028-02-29T10:00:00.000Z", "leap year");
  assert.equal(addMonths(at("2026-12-31T10:00:00Z"), 1).toISOString(), "2027-01-31T10:00:00.000Z", "into the next year");
  assert.equal(addMonths(at("2028-02-29T10:00:00Z"), 12).toISOString(), "2029-02-28T10:00:00.000Z");
});

test("the first subscription starts with the 7-day trial; later ones are paid now", () => {
  const now = at("2026-11-02T10:00:00Z");
  const first = startSubscription(null, "yearly", now);
  assert.deepEqual(first.charge, { kind: "trial", plan: "yearly", amount: 0, periodStart: now, periodEnd: at("2026-11-09T10:00:00Z") });
  assert.equal(first.fields.trialEndsAt.toISOString(), "2026-11-09T10:00:00.000Z");
  assert.equal(first.fields.autoRenew, true);

  const again = startSubscription({ trialStartedAt: at("2026-01-01T00:00:00Z") }, "monthly", now);
  assert.deepEqual(again.charge, { kind: "purchase", plan: "monthly", amount: 14900, periodStart: now, periodEnd: at("2026-12-02T10:00:00Z") });
  assert.equal(again.fields.trialEndsAt, null);
  assert.equal(again.fields.trialStartedAt.toISOString(), "2026-01-01T00:00:00.000Z", "the trial stays used");
});

test("settle charges each renewal that came due, at the switched-to plan", () => {
  const { sub: next, charges } = settle(sub({ nextPlan: "yearly" }), at("2027-01-05T00:00:00Z"));
  assert.deepEqual(charges.map((c) => [c.plan, c.amount, c.periodStart.toISOString()]), [["yearly", 119900, "2026-12-02T10:00:00.000Z"]]);
  assert.equal(next.plan, "yearly");
  assert.equal(next.nextPlan, null);
  assert.equal(next.currentPeriodEnd.toISOString(), "2027-12-02T10:00:00.000Z");

  const monthly = settle(sub(), at("2027-03-03T00:00:00Z"));
  assert.equal(monthly.charges.length, 4, "Dec, Jan, Feb and Mar");
  assert.equal(monthly.sub.currentPeriodEnd.toISOString(), "2027-04-02T10:00:00.000Z");
});

test("settle charges nothing before the period ends, or once cancelled", () => {
  assert.equal(settle(sub(), at("2026-12-01T00:00:00Z")).charges.length, 0);
  const cancelled = settle(sub({ autoRenew: false }), at("2027-06-01T00:00:00Z"));
  assert.equal(cancelled.charges.length, 0);
  assert.equal(cancelled.sub.currentPeriodEnd.toISOString(), "2026-12-02T10:00:00.000Z", "it simply ends");
});

test("a long-dormant subscription catches up a few renewals per read", () => {
  assert.equal(settle(sub(), at("2030-12-02T11:00:00Z")).charges.length, 24);
});

test("what the app is told: free, trial, active and cancelled", () => {
  const now = at("2026-11-03T10:00:00Z");
  const free = proSummary(null, now);
  assert.equal(free.status, "free");
  assert.equal(free.active, false);
  assert.equal(free.trialAvailable, true);
  assert.equal(free.nextCharge, null);

  const trial = proSummary(sub({ plan: "yearly", currentPeriodEnd: at("2026-11-09T10:00:00Z"), trialStartedAt: at("2026-11-02T10:00:00Z"), trialEndsAt: at("2026-11-09T10:00:00Z") }), now);
  assert.equal(trial.status, "trial");
  assert.equal(trial.trialEndsAt, "2026-11-09T10:00:00.000Z");
  assert.deepEqual(trial.nextCharge, { plan: "yearly", amount: 119900, currency: "INR", on: "2026-11-09T10:00:00.000Z" });
  assert.equal(trial.trialAvailable, false);

  const switching = proSummary(sub({ nextPlan: "yearly" }), now);
  assert.equal(switching.status, "active");
  assert.equal(switching.nextPlan, "yearly");
  assert.equal(switching.nextCharge.amount, PLANS.yearly.amount);

  const cancelled = proSummary(sub({ autoRenew: false, nextPlan: "yearly" }), now);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.active, true, "Pro until the period ends");
  assert.equal(cancelled.nextCharge, null);
  assert.equal(cancelled.nextPlan, null);

  const ended = proSummary(sub({ autoRenew: false }), at("2026-12-03T00:00:00Z"));
  assert.equal(ended.status, "free");
  assert.equal(ended.periodEnd, null);
});

test("the free plan comes back 30 days after the plan that used it", () => {
  assert.deepEqual(freePlanSummary([]), { limit: 1, used: 0, resetsAt: null });
  assert.deepEqual(freePlanSummary([at("2026-10-20T08:00:00Z")]), { limit: 1, used: 1, resetsAt: "2026-11-19T08:00:00.000Z" });
});

test("the gate: chat needs Pro, a new plan needs Pro or the free one, next week and swaps are open", () => {
  const free = { pro: { active: false }, freePlan: { used: 0, limit: 1 } };
  const used = { pro: { active: false }, freePlan: { used: 1, limit: 1 } };
  const pro = { pro: { active: true }, freePlan: { used: 1, limit: 1 } };
  assert.equal(proAccessError("chat", free).code, "PRO_REQUIRED");
  assert.equal(proAccessError("chat", pro), null);
  assert.equal(proAccessError("newPlan", free), null);
  assert.equal(proAccessError("newPlan", used).code, "PLAN_LIMIT_REACHED");
  assert.equal(proAccessError("newPlan", pro), null);
  assert.equal(proAccessError("planWeeks", used), null);

  process.env.PRO_GATE = "off";
  assert.equal(proAccessError("chat", used), null);
  assert.equal(proAccessError("newPlan", used), null);
});
