// "Welcome to Iron Arc": once per account, after onboarding, on a verified email.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");

let row;
stub("config/database.js", {
  prisma: {
    user: {
      updateMany: async ({ where, data }) => {
        if (where.welcomedAt === null && row.welcomedAt) return { count: 0 };
        row = { ...row, ...data };
        return { count: 1 };
      },
    },
    subscription: { findUnique: async () => null },
    planGeneration: { findMany: async () => [] },
    trialClaim: { findUnique: async () => null },
  },
});
const { welcomeIfReady } = require("./welcomeService");
const { welcomeEmail } = require("../emails/welcome");

const ready = { id: "user-1", email: "lifter@example.com", displayName: "Pushpa Nath", age: 30, fitnessGoal: "muscle", trainingDays: [1, 3, 5], welcomedAt: null };
let sent;
let realFetch;

beforeEach(() => {
  row = { ...ready };
  sent = [];
  realFetch = global.fetch;
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Iron Arc <pro@mail.example.com>";
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ id: "email" }) };
  };
});
const restore = () => {
  global.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_FROM;
};

test("sent once, after onboarding, to a verified email", async () => {
  try {
    assert.equal(await welcomeIfReady(row, { emailVerified: true }), true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Welcome to Iron Arc/);
    assert.ok(row.welcomedAt);
    assert.equal(await welcomeIfReady({ ...ready }, { emailVerified: true }), false, "a second save at the same time sends none");
    assert.equal(await welcomeIfReady(row, { emailVerified: true }), false);
    assert.equal(sent.length, 1);
  } finally {
    restore();
  }
});

test("not before onboarding is done or the email is verified", async () => {
  try {
    assert.equal(await welcomeIfReady({ ...ready, trainingDays: [] }, { emailVerified: true }), false);
    assert.equal(await welcomeIfReady({ ...ready, age: null }, { emailVerified: true }), false);
    assert.equal(await welcomeIfReady(row, { emailVerified: false }), false);
    assert.equal(sent.length, 0);
  } finally {
    restore();
  }
});

test("a failed send is taken back, so the next save tries again", async () => {
  try {
    global.fetch = async () => ({ ok: false, status: 500, text: async () => "down" });
    assert.equal(await welcomeIfReady(row, { emailVerified: true }), false);
    assert.equal(row.welcomedAt, null);
  } finally {
    restore();
  }
});

test("without email set up nothing counts as sent, so it goes once it is", async () => {
  try {
    delete process.env.RESEND_API_KEY;
    assert.equal(await welcomeIfReady(row, { emailVerified: true }), false);
    assert.equal(row.welcomedAt, null);
    assert.equal(sent.length, 0);
    process.env.RESEND_API_KEY = "re_test";
    assert.equal(await welcomeIfReady(row, { emailVerified: true }), true);
    assert.equal(sent.length, 1);
  } finally {
    restore();
  }
});

test("the welcome: three first steps, the trial only when it's still there, never raw input", () => {
  const withTrial = welcomeEmail({ user: { displayName: "<b>Sam</b>" }, trialAvailable: true });
  assert.match(withTrial.text, /Hey <b>Sam<\/b>, welcome aboard/);
  assert.doesNotMatch(withTrial.html, /<b>Sam/);
  assert.match(withTrial.text, /Log your first workout/);
  assert.match(withTrial.text, /Try it free for 7 days/);
  assert.doesNotMatch(welcomeEmail({ user: {}, trialAvailable: false }).text, /free for 7 days/);
  assert.match(withTrial.html, /you just set up your Iron Arc account/);
  assert.doesNotMatch(withTrial.html, /you have Iron Arc Pro/);
});
