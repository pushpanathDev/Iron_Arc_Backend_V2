// Deleting a Google account: the Google confirmation the app sends is checked with Google.
const { test, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { isGoogleConfirmation } = require("./googleReauth");

const NOW = Date.parse("2026-11-03T17:11:00Z");
const issued = (secondsAgo, sub = "google-123") => async ({ audience }) => {
  assert.equal(audience, "web-client.apps.googleusercontent.com");
  return { getPayload: () => ({ sub, iat: Math.floor(NOW / 1000) - secondsAgo }) };
};
const check = (verify, ids = ["google-123"]) => isGoogleConfirmation("token", ids, { verify, now: NOW });

process.env.GOOGLE_WEB_CLIENT_ID = "web-client.apps.googleusercontent.com";
afterEach(() => {
  process.env.GOOGLE_WEB_CLIENT_ID = "web-client.apps.googleusercontent.com";
});

test("a Google sign-in to this app for this account counts, including the token Google keeps for up to an hour", async () => {
  assert.equal(await check(issued(20)), true);
  assert.equal(await check(issued(40 * 60)), true, "Android hands back its cached token");
});

test("older than an hour, another Google account, or one Google refuses (wrong app, expired) doesn't", async () => {
  assert.equal(await check(issued(2 * 60 * 60)), false);
  assert.equal(await check(issued(20, "someone-else")), false);
  assert.equal(await check(issued(20), []), false, "not a Google account");
  assert.equal(await check(async () => { throw new Error("Token used too late"); }), false);
});

test("without GOOGLE_WEB_CLIENT_ID nothing is accepted", async () => {
  delete process.env.GOOGLE_WEB_CLIENT_ID;
  assert.equal(await check(issued(20)), false);
});
