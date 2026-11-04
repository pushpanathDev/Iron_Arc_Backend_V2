// The Pro welcome email: the right words for a trial or a paid plan, a receipt, and never raw user input.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { proWelcomeEmail, receiptNumber, rupees } = require("./proWelcome");

const payment = (fields = {}) => ({
  id: "3f9a1c2b-0000-4000-8000-000000000000",
  kind: "trial",
  plan: "yearly",
  amount: 0,
  provider: "test",
  periodStart: new Date("2026-11-02T10:00:00Z"),
  periodEnd: new Date("2026-11-09T10:00:00Z"),
  createdAt: new Date("2026-11-02T10:00:00Z"),
  ...fields,
});
const pro = { status: "trial", nextCharge: { plan: "yearly", amount: 119900, currency: "INR", on: "2026-11-09T10:00:00.000Z" } };

test("money and receipt numbers", () => {
  assert.equal(rupees(119900), "₹1,199.00");
  assert.equal(rupees(12345678), "₹1,23,456.78");
  assert.equal(receiptNumber(payment()), "IA-20261102-3F9A1C2B");
});

test("a trial welcome: first charge, ₹0 today, and the test-mode notice", () => {
  const email = proWelcomeEmail({ user: { displayName: "Pushpa Nath", email: "x@y.z" }, payment: payment(), pro, trialDays: 7 });
  assert.match(email.subject, /Pro club/);
  assert.match(email.text, /Hey Pushpa,/);
  assert.match(email.text, /7-day free trial starts today/);
  assert.match(email.text, /first charge is ₹1,199\.00 on 9 Nov 2026/);
  assert.match(email.text, /Total today: ₹0\.00/);
  assert.match(email.text, /Test mode: this is a test receipt/);
  assert.match(email.html, /IA-20261102-3F9A1C2B/);
});

test("a paid welcome: the plan, when it renews and what was paid", () => {
  const paid = payment({ kind: "purchase", plan: "monthly", amount: 14900, periodEnd: new Date("2026-12-02T10:00:00Z") });
  const email = proWelcomeEmail({ user: { displayName: null }, payment: paid, pro: { status: "active", nextCharge: { plan: "monthly", amount: 14900, currency: "INR", on: "2026-12-02T10:00:00.000Z" } }, trialDays: 7 });
  assert.match(email.text, /Hey lifter,/);
  assert.match(email.text, /Monthly plan is live\. It renews on 2 Dec 2026 at ₹149\.00/);
  assert.match(email.text, /Total paid: ₹149\.00/);
});

test("a name can't inject markup into the email", () => {
  const email = proWelcomeEmail({ user: { displayName: "<img src=x onerror=alert(1)>" }, payment: payment(), pro, trialDays: 7 });
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img/);
});

test("the logo shows only with an https EMAIL_LOGO_URL", () => {
  const html = () => proWelcomeEmail({ user: {}, payment: payment(), pro, trialDays: 7 }).html;
  try {
    assert.doesNotMatch(html(), /<img/);
    process.env.EMAIL_LOGO_URL = "http://insecure.example/logo.png";
    assert.doesNotMatch(html(), /<img/);
    process.env.EMAIL_LOGO_URL = "https://mail.example.com/email-logo.png";
    assert.match(html(), /<img src="https:\/\/mail\.example\.com\/email-logo\.png" width="56" height="56" alt="Iron Arc"/);
  } finally {
    delete process.env.EMAIL_LOGO_URL;
  }
});
