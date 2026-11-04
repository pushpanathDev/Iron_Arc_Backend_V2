// One trial per person: the same mailbox however it's written, and never the email itself.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { normaliseEmail, emailFingerprint } = require("./trialClaims");

afterEach(() => delete process.env.TRIAL_CLAIM_SECRET);

test("the same mailbox written different ways is one email", () => {
  assert.equal(normaliseEmail("  Lifter@Example.com "), "lifter@example.com");
  assert.equal(normaliseEmail("lifter+trial2@example.com"), "lifter@example.com");
  assert.equal(normaliseEmail("Li.Fter+x@googlemail.com"), "lifter@gmail.com");
  assert.equal(normaliseEmail("li.fter@example.com"), "li.fter@example.com", "dots only matter outside Gmail");
});

test("no usable email, no fingerprint (accounts without one don't share a trial)", () => {
  for (const email of [null, undefined, "", "   ", "nobody", "@example.com"]) assert.equal(emailFingerprint(email), null, String(email));
  assert.ok(emailFingerprint("lifter@example.com"));
});

test("the fingerprint is stable, one-way and keyed when a secret is set", () => {
  const plain = emailFingerprint("lifter@gmail.com");
  assert.equal(plain, emailFingerprint("L.ifter+1@gmail.com"));
  assert.match(plain, /^[0-9a-f]{64}$/);
  process.env.TRIAL_CLAIM_SECRET = "secret";
  assert.notEqual(emailFingerprint("lifter@gmail.com"), plain);
});
