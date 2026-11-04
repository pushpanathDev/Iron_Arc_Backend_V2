// Iron Arc Pro's trial-ending, cancellation and renewal emails: the right dates, amounts and notes.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trialEndingEmail, cancelledEmail, renewedEmail } = require("./proLifecycle");

const user = { displayName: "Pushpa Nath" };

test("trial ending: the date, what it turns into, how to stop it, and that test mode takes nothing", () => {
  const email = trialEndingEmail({ user, sub: { plan: "yearly", nextPlan: null, trialEndsAt: new Date("2026-11-09T10:00:00Z") }, amount: 119900 });
  assert.equal(email.subject, "Your Pro trial ends on 9 Nov 2026 ⏳");
  assert.match(email.text, /Hey Pushpa, quick heads-up/);
  assert.match(email.text, /carries on as Yearly at ₹1,199\.00/);
  assert.match(email.text, /Cancel in Profile → Subscription before 9 Nov 2026/);
  assert.match(email.text, /Test mode: no money will be taken/);
});

test("trial ending follows a switched plan", () => {
  const email = trialEndingEmail({ user, sub: { plan: "yearly", nextPlan: "monthly", trialEndsAt: new Date("2026-11-09T10:00:00Z") }, amount: 14900 });
  assert.match(email.text, /as Monthly at ₹149\.00/);
});

test("cancelled: still Pro until the date, nothing more charged, plans and logs stay", () => {
  const email = cancelledEmail({ user, until: new Date("2026-12-02T10:00:00Z"), trial: false });
  assert.equal(email.subject, "Pro cancelled: you're still Pro until 2 Dec 2026");
  assert.match(email.text, /plan won't renew, and nothing more will be charged/);
  assert.match(email.text, /plans, logs and PRs stay exactly where they are/);
  assert.match(cancelledEmail({ user, until: new Date(), trial: true }).text, /trial won't turn into a paid plan/);
});

test("renewed: the receipt, the next renewal, and a trial that turned paid", () => {
  const payment = { id: "abcd1234-0000", kind: "renewal", plan: "yearly", amount: 119900, provider: "test", periodStart: new Date("2026-11-09T10:00:00Z"), periodEnd: new Date("2027-11-09T10:00:00Z"), createdAt: new Date("2026-11-10T09:00:00Z") };
  const fromTrial = renewedEmail({ user, payment, nextOn: payment.periodEnd, fromTrial: true });
  assert.match(fromTrial.subject, /trial's done/);
  assert.match(fromTrial.text, /Next renewal: 9 Nov 2027/);
  assert.match(fromTrial.text, /Plan: Iron Arc Pro · Yearly \(renewal\)/);
  assert.match(fromTrial.text, /Total paid: ₹1,199\.00/);
  assert.match(fromTrial.text, /Test mode: this is a test receipt/);
  assert.match(renewedEmail({ user, payment, nextOn: payment.periodEnd, fromTrial: false }).subject, /^Pro renewed/);
});
