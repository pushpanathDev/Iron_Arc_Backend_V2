// The in-app update prompt's release info: from the latest GitHub release, or set by hand.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { compareVersions, latestRelease, notesFromBody, clearReleaseCache } = require("./appRelease");

const NOW = Date.parse("2026-11-10T12:00:00Z");
const gh = (fields = {}) => ({
  tag_name: "v2.1.0",
  draft: false,
  prerelease: false,
  published_at: "2026-11-10T00:00:00Z",
  body: "## What's new\n\n- **Iron Arc Pro.** The coach chat and unlimited plans.\n- **Bigger exercise list:** 95 exercises\n- Plain point without bold\n\nSee the changelog.",
  assets: [
    { name: "notes.txt", browser_download_url: "https://x/notes.txt" },
    { name: "Iron-Arc-2.1.0.apk", browser_download_url: "https://github.com/me/r/releases/download/v2.1.0/Iron-Arc-2.1.0.apk" },
  ],
  ...fields,
});
const from = (release, env = {}) => latestRelease(env, { fetchRelease: async () => release, now: NOW });

beforeEach(() => clearReleaseCache());

test("versions compare by numbers, not text", () => {
  assert.equal(compareVersions("2.10.0", "2.9.1"), 1);
  assert.equal(compareVersions("2.0.1", "2.1.0"), -1);
  assert.equal(compareVersions("3.0.0", "3.0.0"), 0);
});

test("from the latest GitHub release: its tag, its .apk (any name), 3 days' grace, its points as notes", async () => {
  const release = await from(gh());
  assert.equal(release.latest, "2.1.0");
  assert.equal(release.downloadUrl, "https://github.com/me/r/releases/download/v2.1.0/Iron-Arc-2.1.0.apk");
  assert.equal(release.releasedAt, "2026-11-10T00:00:00.000Z");
  assert.equal(release.requiredFrom, "2026-11-13T00:00:00.000Z");
  assert.equal(release.minVersion, null);
  assert.deepEqual(release.notes, ["Iron Arc Pro", "Bigger exercise list", "Plain point without bold"]);
});

test("the server's settings adjust it: grace days and a minimum version", async () => {
  const release = await from(gh(), { APP_UPDATE_GRACE_DAYS: "7", APP_MIN_VERSION: "2.0.1" });
  assert.equal(release.requiredFrom, "2026-11-17T00:00:00.000Z");
  assert.equal(release.minVersion, "2.0.1");
});

test("nothing to announce: no .apk, an odd tag, a draft or a pre-release", async () => {
  for (const fields of [{ assets: [] }, { tag_name: "latest" }, { draft: true }, { prerelease: true }]) {
    clearReleaseCache();
    assert.equal(await from(gh(fields)), null, JSON.stringify(fields));
  }
});

test("GitHub is asked at most every 10 minutes, and when it fails the last answer stands", async () => {
  let calls = 0;
  const fetchRelease = async () => {
    calls += 1;
    if (calls > 1) throw new Error("GitHub answered 503");
    return gh();
  };
  const at = (minutes) => latestRelease({}, { fetchRelease, now: NOW + minutes * 60 * 1000 });
  assert.equal((await at(0)).latest, "2.1.0");
  assert.equal((await at(5)).latest, "2.1.0");
  assert.equal(calls, 1, "cached");
  assert.equal((await at(11)).latest, "2.1.0", "kept when GitHub fails");
  assert.equal(calls, 2);
  await at(11.5);
  assert.equal(calls, 2, "after a failure, asked again a minute later");
  await at(12.1);
  assert.equal(calls, 3);
});

test("GITHUB_TOKEN is sent to GitHub when set", async () => {
  const tokens = [];
  const fetchRelease = async (repo, { token }) => {
    tokens.push(token);
    return gh();
  };
  await latestRelease({ GITHUB_TOKEN: " abc " }, { fetchRelease, now: NOW });
  clearReleaseCache();
  await latestRelease({ GITHUB_TOKEN: "" }, { fetchRelease, now: NOW });
  assert.deepEqual(tokens, ["abc", undefined]);
});

test("a refusing GitHub is asked again when its limit resets, at most an hour later", async () => {
  let calls = 0;
  let retryAt = NOW + 30 * 60 * 1000;
  const fetchRelease = async () => {
    calls += 1;
    throw Object.assign(new Error("GitHub answered 403"), { retryAt });
  };
  const at = (minutes) => latestRelease({}, { fetchRelease, now: NOW + minutes * 60 * 1000 });
  assert.equal(await at(0), null);
  await at(29);
  assert.equal(calls, 1, "waits for the reset");
  retryAt = NOW + 600 * 60 * 1000;
  await at(30);
  assert.equal(calls, 2);
  await at(89);
  assert.equal(calls, 2);
  await at(90);
  assert.equal(calls, 3, "never waits more than an hour");
});

test("GitHub is asked with the token, and its rate-limit reset is read", async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  const reset = Math.floor(Date.now() / 1000) + 20 * 60;
  globalThis.fetch = async (url, { headers }) => {
    seen.push(headers.Authorization);
    return new Response("{}", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(reset) } });
  };
  const warn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(message);
  try {
    assert.equal(await latestRelease({ GITHUB_TOKEN: "abc" }), null);
    assert.equal(seen[0], "Bearer abc");
    await latestRelease({ GITHUB_TOKEN: "abc" });
    assert.equal(seen.length, 1, "not asked again before the reset");
    clearReleaseCache();
    await latestRelease({});
    assert.equal(seen[1], undefined, "no token, no header");
    assert.match(warnings[1], /403 \(set GITHUB_TOKEN/);
    assert.doesNotMatch(warnings[0], /set GITHUB_TOKEN/);
  } finally {
    globalThis.fetch = realFetch;
    console.warn = warn;
  }
});

test("manual control with the APP_* settings takes over from GitHub", async () => {
  const fetchRelease = async () => assert.fail("GitHub isn't asked");
  const release = await latestRelease(
    { APP_LATEST_VERSION: "2.1.1", APP_DOWNLOAD_URL: "https://x/a.apk", APP_RELEASED_AT: "2026-11-10T00:00:00Z", APP_RELEASE_NOTES: "Fix | Faster ||" },
    { fetchRelease, now: NOW },
  );
  assert.equal(release.latest, "2.1.1");
  assert.equal(release.requiredFrom, "2026-11-13T00:00:00.000Z");
  assert.deepEqual(release.notes, ["Fix", "Faster"]);
  assert.equal(await latestRelease({ APP_LATEST_VERSION: "2.1.1", APP_DOWNLOAD_URL: "http://x/a.apk" }, { fetchRelease }), null, "https only");
  assert.equal((await latestRelease({ APP_LATEST_VERSION: "2.1.1", APP_DOWNLOAD_URL: "https://x/a.apk" }, { fetchRelease })).requiredFrom, null, "no date: never forced by date");
});

test("notes: bullets only, the bold part when there is one, markdown and links removed, long ones cut", () => {
  assert.deepEqual(notesFromBody("# Title\n* **Move a session.** History\n- [Docs](https://x) and `code`\ntext"), ["Move a session", "Docs and code"]);
  assert.equal(notesFromBody("- " + "x".repeat(200))[0].length, 118);
  assert.deepEqual(notesFromBody(null), []);
});
