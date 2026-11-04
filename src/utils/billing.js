const { HttpError } = require("./httpError");

/*
 * Iron Arc Pro: the plans, the trial and what a subscription's dates mean.
 * Plain functions on a subscription row; services/billingService.js reads and
 * writes the rows.
 *
 * - Pro unlocks the coach chat and unlimited new AI plans. Free accounts get
 *   FREE_PLANS new plan every FREE_PLAN_DAYS days (counted from the
 *   plan_generations log), and next week and swaps on any plan.
 * - The first subscription starts with a TRIAL_DAYS free trial that leads
 *   into the chosen plan: once per person, even across deleted accounts
 *   (utils/trialClaims.js).
 * - Payments are test payments for now (provider "test"): nothing is charged.
 *   A renewal is recorded when the subscription is next read (settle).
 * - PRO_GATE=off lets everyone use every AI feature (to deploy before the app
 *   that has the Pro screen); Pro itself still works.
 */
const PLANS = {
  monthly: { id: "monthly", months: 1, amount: 14900 },
  yearly: { id: "yearly", months: 12, amount: 119900 },
};
const PLAN_IDS = Object.keys(PLANS);
const CURRENCY = "INR";
const PROVIDER = "test";
const TRIAL_DAYS = 7;
const FREE_PLANS = 1;
const FREE_PLAN_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Renewals recorded in one read; a long-dormant subscription catches up over a few. */
const MAX_RENEWALS = 24;

const proGateOn = () => process.env.PRO_GATE !== "off";

/** `date` plus whole months, on the month's last day when it is shorter (31 Jan + 1 month = 28 or 29 Feb). */
function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

const addDays = (date, days) => new Date(date.getTime() + days * DAY_MS);

const isPro = (sub, now = new Date()) => !!sub && sub.currentPeriodEnd > now;

/**
 * The renewals due by `now`: while the period has ended and the subscription
 * renews, the next period is charged at the plan it switches to, if any.
 * Returns the subscription as it is then and the charges to record, oldest first.
 */
function settle(sub, now = new Date()) {
  const charges = [];
  let next = sub;
  while (next.autoRenew && next.currentPeriodEnd <= now && charges.length < MAX_RENEWALS) {
    const plan = PLANS[next.nextPlan ?? next.plan];
    const periodStart = next.currentPeriodEnd;
    const periodEnd = addMonths(periodStart, plan.months);
    charges.push({ kind: "renewal", plan: plan.id, amount: plan.amount, periodStart, periodEnd });
    next = { ...next, plan: plan.id, nextPlan: null, currentPeriodEnd: periodEnd };
  }
  return { sub: next, charges };
}

/**
 * A new subscription to `planId` for someone without Pro (`previous` is their
 * old, ended subscription, if any): the free trial when they never had one
 * (`trialUsed`: they had it on a deleted account), otherwise the first period
 * paid now. Returns the row's fields and the charge.
 */
function startSubscription(previous, planId, now = new Date(), { trialUsed = false } = {}) {
  const plan = PLANS[planId];
  const trial = !previous?.trialStartedAt && !trialUsed;
  const periodEnd = trial ? addDays(now, TRIAL_DAYS) : addMonths(now, plan.months);
  return {
    fields: {
      plan: plan.id,
      nextPlan: null,
      autoRenew: true,
      currentPeriodEnd: periodEnd,
      // A returning person whose trial was on a deleted account has no row of their own yet.
      trialStartedAt: trial ? now : (previous?.trialStartedAt ?? null),
      trialEndsAt: trial ? periodEnd : null,
      trialReminderSentAt: null,
      startedAt: now,
      cancelledAt: null,
      provider: PROVIDER,
    },
    charge: { kind: trial ? "trial" : "purchase", plan: plan.id, amount: trial ? 0 : plan.amount, periodStart: now, periodEnd },
  };
}

/**
 * What the app shows and gates on. status: free | trial | active | cancelled
 * (cancelled = Pro until periodEnd, then free). nextCharge is null when it
 * won't renew. `trialClaimed`: the trial was used on a deleted account.
 */
function proSummary(sub, now = new Date(), { trialClaimed = false } = {}) {
  const active = isPro(sub, now);
  const inTrial = active && !!sub.trialEndsAt && sub.trialEndsAt > now;
  const renewsTo = active && sub.autoRenew ? PLANS[sub.nextPlan ?? sub.plan] : null;
  return {
    active,
    status: !active ? "free" : !sub.autoRenew ? "cancelled" : inTrial ? "trial" : "active",
    plan: active ? sub.plan : null,
    nextPlan: renewsTo && sub.nextPlan ? sub.nextPlan : null,
    periodEnd: active ? sub.currentPeriodEnd.toISOString() : null,
    trialEndsAt: inTrial ? sub.trialEndsAt.toISOString() : null,
    nextCharge: renewsTo ? { plan: renewsTo.id, amount: renewsTo.amount, currency: CURRENCY, on: sub.currentPeriodEnd.toISOString() } : null,
    trialAvailable: !sub?.trialStartedAt && !trialClaimed,
    provider: sub?.provider ?? PROVIDER,
    gate: proGateOn(),
  };
}

/** Since when new plans count towards the free one. */
const freePlanWindowStart = (now = new Date()) => addDays(now, -FREE_PLAN_DAYS);

/** The free plan allowance from the new plans made in the window (`madeAt`, oldest first). */
function freePlanSummary(madeAt) {
  const used = Math.min(madeAt.length, FREE_PLANS);
  return {
    limit: FREE_PLANS,
    used,
    // A slot comes back FREE_PLAN_DAYS after the plan that used it.
    resetsAt: used >= FREE_PLANS ? addDays(madeAt[0], FREE_PLAN_DAYS).toISOString() : null,
  };
}

/** What the Pro screen offers. */
const PLAN_LIST = PLAN_IDS.map((id) => ({ id, months: PLANS[id].months, amount: PLANS[id].amount, currency: CURRENCY }));

/**
 * Why this AI feature is closed to the user (an HttpError with a code the app
 * acts on), or null. `feature`: chat (Pro), newPlan (Pro or the free plan),
 * planWeeks (next week and swaps: anyone).
 */
function proAccessError(feature, { pro, freePlan }) {
  if (!proGateOn() || pro.active || feature === "planWeeks") return null;
  if (feature === "chat") {
    return new HttpError(403, "The AI coach chat is part of Iron Arc Pro.", "PRO_REQUIRED");
  }
  if (feature === "newPlan" && freePlan.used >= freePlan.limit) {
    return planLimitError();
  }
  return null;
}

const planLimitError = () =>
  new HttpError(403, "You've used your free AI plan for this month. Iron Arc Pro has unlimited plans.", "PLAN_LIMIT_REACHED");

module.exports = {
  PLANS,
  PLAN_IDS,
  PLAN_LIST,
  CURRENCY,
  PROVIDER,
  TRIAL_DAYS,
  FREE_PLANS,
  proGateOn,
  addMonths,
  isPro,
  settle,
  startSubscription,
  proSummary,
  freePlanWindowStart,
  freePlanSummary,
  proAccessError,
  planLimitError,
};
