const { prisma } = require("../config/database");
const { HttpError } = require("../utils/httpError");
const { ADULT_AGE } = require("../utils/healthCheck");
const {
  PLANS,
  PLAN_LIST,
  CURRENCY,
  PROVIDER,
  TRIAL_DAYS,
  FREE_PLANS,
  isPro,
  settle,
  startSubscription,
  proSummary,
  freePlanWindowStart,
  freePlanSummary,
  planLimitError,
} = require("../utils/billing");
const { emailFingerprint } = require("../utils/trialClaims");
const { sendEmail } = require("./emailService");
const { proWelcomeEmail } = require("../emails/proWelcome");
const { trialEndingEmail, cancelledEmail, renewedEmail } = require("../emails/proLifecycle");

/*
 * Iron Arc Pro subscriptions with test payments (utils/billing.js has the
 * rules). Every change for one user runs in a transaction that first locks
 * their user row, so a double tap or two devices can't start two
 * subscriptions or record a renewal twice.
 */

/** Locks the user's row until the transaction ends, without changing it (so reading billing writes nothing). */
const lockUserRow = (tx, userId) => tx.$queryRaw`SELECT 1 FROM "users" WHERE "id" = ${userId} FOR UPDATE`;

/** Runs `work(tx)` with the user's row locked until the transaction ends. */
function withUserLocked(userId, work) {
  return prisma.$transaction(async (tx) => {
    await lockUserRow(tx, userId);
    return work(tx);
  });
}

/**
 * Records the renewals due by `now` (inside withUserLocked); returns the
 * subscription as it is now. The newest renewal goes into `renewed`, for its
 * email, which is sent once the transaction has committed.
 */
async function settleLocked(tx, userId, now, renewed = []) {
  const sub = await tx.subscription.findUnique({ where: { userId } });
  if (!sub) return null;
  const { sub: next, charges } = settle(sub, now);
  if (charges.length === 0) return sub;

  let last = null;
  for (const charge of charges) {
    last = await tx.payment.create({
      data: { userId, ...charge, currency: CURRENCY, provider: sub.provider, reference: `renewal:${sub.id}:${charge.periodStart.toISOString()}` },
    });
  }
  // The trial turning into the plan, when that's the only charge.
  const fromTrial = charges.length === 1 && !!sub.trialEndsAt && +sub.trialEndsAt === +charges[0].periodStart;
  renewed.push({ payment: last, fromTrial, nextOn: next.currentPeriodEnd });
  return tx.subscription.update({
    where: { userId },
    data: { plan: next.plan, nextPlan: next.nextPlan, currentPeriodEnd: next.currentPeriodEnd },
  });
}

/** The user's subscription with any renewals that came due recorded first (and their receipt emailed). */
async function currentSubscription(user, now = new Date()) {
  const sub = await prisma.subscription.findUnique({ where: { userId: user.id } });
  if (!sub || !sub.autoRenew || sub.currentPeriodEnd > now) return sub;
  const renewed = [];
  const settled = await withUserLocked(user.id, (tx) => settleLocked(tx, user.id, now, renewed));
  announceRenewals(user, renewed);
  return settled;
}

/** When the user's new AI plans in the free window were made, oldest first. */
async function plansMadeInWindow(db, userId, now) {
  const rows = await db.planGeneration.findMany({
    where: { userId, createdAt: { gte: freePlanWindowStart(now) } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
    take: FREE_PLANS,
  });
  return rows.map((row) => row.createdAt);
}

/** True when this email (any account, deleted ones too) has had the free trial. */
async function trialClaimed(db, email) {
  const emailHash = emailFingerprint(email);
  return !!emailHash && !!(await db.trialClaim.findUnique({ where: { emailHash } }));
}

/** Pro and the free plan allowance for `user` (a user row): what the profile carries and the coach gate checks. */
async function proStatus(user, now = new Date()) {
  const [sub, madeAt] = await Promise.all([currentSubscription(user, now), plansMadeInWindow(prisma, user.id, now)]);
  // Only worth asking when this account hasn't had the trial itself.
  const claimed = !sub?.trialStartedAt && (await trialClaimed(prisma, user.email));
  return { pro: proSummary(sub, now, { trialClaimed: claimed }), freePlan: freePlanSummary(madeAt) };
}

/** The profile as the app gets it: the user row plus `pro` and `freePlan`. */
async function withProStatus(user, now = new Date()) {
  return { ...user, ...(await proStatus(user, now)) };
}

const receipt = (payment) => ({
  id: payment.id,
  kind: payment.kind,
  plan: payment.plan,
  amount: payment.amount,
  currency: payment.currency,
  provider: payment.provider,
  periodEnd: payment.periodEnd.toISOString(),
  createdAt: payment.createdAt.toISOString(),
});

/** Everything the Pro and Subscription screens show: status, plans and receipts (newest first). */
async function billingOf(user, now = new Date()) {
  // Status first: reading it records any renewal that came due, which the receipts then include.
  const status = await proStatus(user, now);
  const payments = await prisma.payment.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 24 });
  return { ...status, plans: PLAN_LIST, trialDays: TRIAL_DAYS, provider: PROVIDER, payments: payments.map(receipt) };
}

/**
 * Starts Pro on `plan`: the free trial the first time (per person, not per
 * account; the claim is recorded), otherwise a test payment for the first period.
 * A new member gets the welcome email with its receipt. `key` comes from the app's checkout and is the
 * same for a retried or double-tapped Pay, which then changes nothing.
 */
async function checkout(user, { plan, key }, now = new Date()) {
  if (!(user.age >= ADULT_AGE)) {
    throw new HttpError(403, "Iron Arc Pro is for adults (18+).", "COACH_ADULTS_ONLY");
  }
  const reference = `checkout:${user.id}:${key}`;

  // The receipt this checkout recorded (none when it was a repeated tap).
  let receipt = null;
  const renewed = [];
  await withUserLocked(user.id, async (tx) => {
    if (await tx.payment.findUnique({ where: { reference } })) return;
    const previous = await settleLocked(tx, user.id, now, renewed);
    if (isPro(previous, now)) throw new HttpError(409, "You already have Iron Arc Pro.", "ALREADY_PRO");

    const trialUsed = !previous?.trialStartedAt && (await trialClaimed(tx, user.email));
    const { fields, charge } = startSubscription(previous, plan, now, { trialUsed });
    const emailHash = charge.kind === "trial" ? emailFingerprint(user.email) : null;
    if (emailHash) await tx.trialClaim.upsert({ where: { emailHash }, create: { emailHash }, update: {} });
    await tx.subscription.upsert({ where: { userId: user.id }, create: { userId: user.id, ...fields }, update: fields });
    receipt = await tx.payment.create({ data: { userId: user.id, ...charge, currency: CURRENCY, provider: PROVIDER, reference } });
  });
  announceRenewals(user, renewed);
  const state = await billingOf(user, now);
  if (receipt) {
    console.log(`[billing] ${user.id} started ${plan} (test)`);
    void sendWelcome(user, receipt, state);
  }
  return state;
}

/** Sends a Pro email to the user. Never throws: a missed email must not fail what the user did. Returns whether it went. */
async function deliver(user, email, idempotencyKey) {
  try {
    await sendEmail({ to: user.email, ...email, idempotencyKey });
    return true;
  } catch (error) {
    console.warn(`[billing] "${email.subject}" to ${user.id} not sent: ${error.message}`);
    return false;
  }
}

/** "Welcome to the Pro club" with the receipt. */
function sendWelcome(user, payment, state) {
  return deliver(user, proWelcomeEmail({ user, payment, pro: state.pro, trialDays: state.trialDays }), `pro-welcome-${payment.id}`);
}

/** The receipt for the newest renewal recorded (one email, however many periods caught up). */
function announceRenewals(user, renewed) {
  const last = renewed.at(-1);
  if (!last) return;
  void deliver(user, renewedEmail({ user, ...last }), `pro-renewed-${last.payment.id}`);
}

/** How far ahead "your trial ends soon" goes out (the daily job runs once a day). */
const TRIAL_REMINDER_AHEAD_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * The daily job (admin route, called by a scheduled GitHub Action): emails
 * everyone whose trial ends within two days and will turn into a paid plan.
 * Each trial is marked first, so it's reminded once even if the job runs twice.
 */
async function sendTrialReminders(now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: { autoRenew: true, trialReminderSentAt: null, trialEndsAt: { gt: now, lte: new Date(now.getTime() + TRIAL_REMINDER_AHEAD_MS) } },
    include: { user: { select: { id: true, email: true, displayName: true } } },
  });
  let sent = 0;
  for (const sub of due) {
    // Still in the trial (it hasn't turned into a paid period yet).
    if (+sub.currentPeriodEnd !== +sub.trialEndsAt) continue;
    const claimed = await prisma.subscription.updateMany({ where: { id: sub.id, trialReminderSentAt: null }, data: { trialReminderSentAt: now } });
    if (claimed.count === 0) continue;
    const amount = PLANS[sub.nextPlan ?? sub.plan].amount;
    if (await deliver(sub.user, trialEndingEmail({ user: sub.user, sub, amount }), `pro-trial-ending-${sub.id}`)) sent += 1;
    else await prisma.subscription.update({ where: { id: sub.id }, data: { trialReminderSentAt: null } });
  }
  console.log(`[billing] Trial reminders: ${sent} sent of ${due.length} due`);
  return { due: due.length, sent };
}

/**
 * Applies `change(sub)` (the fields to update, or null for none) to a current
 * subscription; `afterChange(sub)` runs once it's saved (for its email).
 */
async function changeSubscription(user, change, now, afterChange) {
  const renewed = [];
  const changed = await withUserLocked(user.id, async (tx) => {
    const sub = await settleLocked(tx, user.id, now, renewed);
    if (!isPro(sub, now)) throw new HttpError(409, "You don't have Iron Arc Pro right now.", "NOT_PRO");
    const data = change(sub);
    if (!data) return null;
    await tx.subscription.update({ where: { userId: user.id }, data });
    return sub;
  });
  announceRenewals(user, renewed);
  if (changed && afterChange) afterChange(changed);
  return billingOf(user, now);
}

/** Stops renewing: Pro stays until the period ends. A switch of plan is dropped. */
const cancel = (user, now = new Date()) =>
  changeSubscription(
    user,
    (sub) => (sub.autoRenew ? { autoRenew: false, cancelledAt: now, nextPlan: null } : null),
    now,
    (sub) => {
      const trial = !!sub.trialEndsAt && sub.trialEndsAt > now;
      void deliver(user, cancelledEmail({ user, until: sub.currentPeriodEnd, trial }), `pro-cancelled-${sub.id}-${now.toISOString()}`);
    },
  );

/** Renews again after a cancel, while the period hasn't ended. */
const resume = (user, now = new Date()) =>
  changeSubscription(user, (sub) => (sub.autoRenew ? null : { autoRenew: true, cancelledAt: null }), now);

/** Switches plan from the next renewal; choosing the current plan undoes a switch. */
const changePlan = (user, plan, now = new Date()) =>
  changeSubscription(
    user,
    (sub) => {
      if (!sub.autoRenew) throw new HttpError(409, "Resume your subscription to change plan.", "NOT_RENEWING");
      return { nextPlan: plan === sub.plan ? null : plan };
    },
    now,
  );

/**
 * Inside generatePlan's transaction, for a user without Pro: takes the free
 * plan, or refuses when it's used. Locks the user row first, so two plans
 * generated at once can't both take it.
 */
async function claimFreePlan(tx, userId, now = new Date()) {
  await lockUserRow(tx, userId);
  if ((await plansMadeInWindow(tx, userId, now)).length >= FREE_PLANS) throw planLimitError();
}

/** Admin, for testing: removes a user's subscription, receipts and trial claim, so the trial can be tried again. */
async function resetSubscription(firebaseUid) {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { id: true, email: true } });
  if (!user) throw new HttpError(404, "User not found.");
  const emailHash = emailFingerprint(user.email);
  const [payments, subscriptions] = await prisma.$transaction([
    prisma.payment.deleteMany({ where: { userId: user.id } }),
    prisma.subscription.deleteMany({ where: { userId: user.id } }),
    ...(emailHash ? [prisma.trialClaim.deleteMany({ where: { emailHash } })] : []),
  ]);
  console.warn(`[billing] Reset the subscription of ${firebaseUid}`);
  return { payments: payments.count, subscriptions: subscriptions.count };
}

/**
 * Before an account is deleted: if it had the free trial, remember that (as the
 * email's fingerprint only), so a new account with the same email doesn't get
 * another. Covers trials started before claims were recorded at checkout.
 */
async function rememberTrial(firebaseUid) {
  const user = await prisma.user.findUnique({ where: { firebaseUid }, select: { email: true, subscription: { select: { trialStartedAt: true } } } });
  const emailHash = user?.subscription?.trialStartedAt ? emailFingerprint(user.email) : null;
  if (!emailHash) return;
  await prisma.trialClaim.upsert({ where: { emailHash }, create: { emailHash }, update: {} });
}

module.exports = {
  proStatus,
  withProStatus,
  billingOf,
  checkout,
  cancel,
  resume,
  changePlan,
  claimFreePlan,
  resetSubscription,
  rememberTrial,
  sendTrialReminders,
};
