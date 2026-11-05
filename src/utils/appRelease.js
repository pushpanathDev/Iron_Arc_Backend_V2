/*
 * The app's latest release, for the in-app update prompt.
 *
 * Normally it comes from GitHub: the latest release of APP_RELEASES_REPO
 * (default pushpanathDev/Iron_Arc-app). Its tag ("v2.2.0") is the version,
 * its attached .apk (any name) the download, its publish date starts the
 * grace period, and the points of its text are "What's new" (each a bold
 * title and a line about it), except those under a "Coming next" heading,
 * which the app shows as what's on the way, and "Under the hood" ones. So
 * publishing a release there is the whole update; nothing to change here.
 *
 * Settings on the server (Render's environment) adjust it:
 * - APP_UPDATE_GRACE_DAYS  older apps must update this many days after the
 *                          release (default 3)
 * - APP_MIN_VERSION        anything older must update right away
 * - APP_LATEST_VERSION     manual control instead of GitHub, with
 *                          APP_DOWNLOAD_URL, APP_RELEASED_AT and
 *                          APP_RELEASE_NOTES ("|" between lines)
 *
 * - GITHUB_TOKEN           a read-only token GitHub is asked with. Without
 *                          one GitHub allows 60 questions an hour per
 *                          address, and Render's addresses are shared, so
 *                          that runs out (GitHub answers 403).
 *
 * GitHub is asked at most every 10 minutes; if it can't be reached, the last
 * answer stands (or there's nothing to announce) and it's asked again in a
 * minute, or when GitHub says its limit resets.
 */
const DEFAULT_REPO = "pushpanathDev/Iron_Arc-app";
const DEFAULT_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;
const RETRY_MS = 60 * 1000;
const MAX_RETRY_MS = 60 * 60 * 1000;
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_NOTES = 8;
const MAX_COMING = 5;
const MAX_TITLE = 120;
const MAX_TEXT = 220;

/** -1, 0 or 1, comparing "2.10.0" and "2.9.1" by numbers. */
function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) < (pb[i] ?? 0) ? -1 : 1;
  }
  return 0;
}

const graceDaysOf = (env) => (env.APP_UPDATE_GRACE_DAYS !== undefined && env.APP_UPDATE_GRACE_DAYS !== "" && Number.isFinite(Number(env.APP_UPDATE_GRACE_DAYS)) ? Number(env.APP_UPDATE_GRACE_DAYS) : DEFAULT_GRACE_DAYS);

/** The release as the app gets it, from its parts (null when they don't make a usable one). */
function releaseFrom({ latest, downloadUrl, releasedAt, whatsNew, comingNext }, env) {
  if (!latest || !VERSION.test(latest) || !downloadUrl?.startsWith("https://")) return null;
  const released = releasedAt ? new Date(releasedAt) : null;
  const requiredFrom = released && !Number.isNaN(released.getTime()) ? new Date(released.getTime() + graceDaysOf(env) * DAY_MS) : null;
  const minVersion = env.APP_MIN_VERSION?.trim();
  return {
    latest,
    downloadUrl,
    // When it was published (null: not known), for "Released 12 Nov" in the app.
    releasedAt: released && !Number.isNaN(released.getTime()) ? released.toISOString() : null,
    // Older apps must update from this time (null: never forced by date).
    requiredFrom: requiredFrom ? requiredFrom.toISOString() : null,
    // Apps older than this must update now (null: none).
    minVersion: minVersion && VERSION.test(minVersion) ? minVersion : null,
    // Older apps read these: the titles of What's new.
    notes: whatsNew.slice(0, MAX_NOTES).map((item) => item.title),
    // { title, text } each ("text" may be empty).
    whatsNew: whatsNew.slice(0, MAX_NOTES),
    comingNext: comingNext.slice(0, MAX_COMING),
  };
}

/** Manual control: the APP_* settings, when APP_LATEST_VERSION is set. */
function releaseFromSettings(env) {
  return releaseFrom(
    {
      latest: env.APP_LATEST_VERSION?.trim(),
      downloadUrl: env.APP_DOWNLOAD_URL?.trim(),
      releasedAt: env.APP_RELEASED_AT,
      whatsNew: (env.APP_RELEASE_NOTES ?? "").split("|").map((line) => line.trim()).filter(Boolean).map((title) => ({ title, text: "" })),
      comingNext: [],
    },
    env,
  );
}

const plain = (text) => text.replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").trim();
const cut = (text, max) => (text.length > max ? `${text.slice(0, max - 3).trimEnd()}…` : text);

/** A bullet as { title, text }: "**Move a session.** History → …" → "Move a session" and "History → …". */
function itemFrom(bullet) {
  const bold = bullet.match(/^\*\*(.+?)\*\*(.*)$/);
  const title = plain(bold ? bold[1] : bullet).replace(/[.:]\s*$/, "");
  // What follows the bold part, without the joining punctuation (", up from 32" → "Up from 32").
  const rest = bold ? plain(bold[2]).replace(/^[\s,.;:—–-]+/, "") : "";
  return { title: cut(title, MAX_TITLE), text: cut(rest.charAt(0).toUpperCase() + rest.slice(1), MAX_TEXT) };
}

/**
 * A release's text as the app's lists: every bullet point is What's new, except
 * those under a "Coming next" heading (what's on the way) and "Under the hood"
 * ones (too technical for the app). Other lines are left out.
 */
function sectionsFromBody(body) {
  const sections = { whatsNew: [], comingNext: [] };
  let into = sections.whatsNew;
  for (const line of String(body ?? "").split(/\r?\n/)) {
    const heading = line.match(/^\s*#{1,6}\s+(.*)$/)?.[1];
    if (heading !== undefined) {
      into = /coming next|up next/i.test(heading) ? sections.comingNext : /under the hood/i.test(heading) ? null : sections.whatsNew;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.*)$/)?.[1];
    const item = bullet && into ? itemFrom(bullet) : null;
    if (item?.title) into.push(item);
  }
  return sections;
}

/** A GitHub release (the API's JSON) as the parts of the app's release, or null. */
function partsFromGitHub(gh) {
  if (!gh || gh.draft || gh.prerelease) return null;
  const apk = (gh.assets ?? []).find((asset) => String(asset.name).toLowerCase().endsWith(".apk"));
  return {
    latest: String(gh.tag_name ?? "").replace(/^v/i, ""),
    downloadUrl: apk?.browser_download_url,
    releasedAt: gh.published_at ?? null,
    ...sectionsFromBody(gh.body),
  };
}

/** When a refusing GitHub says to ask again (ms since 1970), or null. */
function retryAtOf(headers, now) {
  const after = Number(headers.get("retry-after"));
  if (after > 0) return now + after * 1000;
  const reset = Number(headers.get("x-ratelimit-reset"));
  return headers.get("x-ratelimit-remaining") === "0" && reset > 0 ? reset * 1000 : null;
}

async function fetchLatestGitHubRelease(repo, { token } = {}) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "iron-arc-backend",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const limited = res.status === 403 || res.status === 429;
    const error = new Error(`GitHub answered ${res.status}${limited && !token ? " (set GITHUB_TOKEN: without one, Render's shared address runs out of GitHub's 60 an hour)" : ""}`);
    error.retryAt = retryAtOf(res.headers, Date.now());
    throw error;
  }
  return res.json();
}

// The latest GitHub release's parts, kept as parts so a change to the grace days or minimum version applies at once.
let cached = { at: 0, parts: null, repo: null };

/**
 * The latest release for the app (see the top of this file), or null when
 * there's none to announce. `fetchRelease` and `now` are for tests.
 */
async function latestRelease(env = process.env, { fetchRelease = fetchLatestGitHubRelease, now = Date.now() } = {}) {
  if (env.APP_LATEST_VERSION?.trim()) return releaseFromSettings(env);

  const repo = env.APP_RELEASES_REPO?.trim() || DEFAULT_REPO;
  if (cached.repo !== repo || now - cached.at >= CACHE_MS) {
    try {
      cached = { at: now, repo, parts: partsFromGitHub(await fetchRelease(repo, { token: env.GITHUB_TOKEN?.trim() || undefined })) };
    } catch (error) {
      console.warn(`[appRelease] Couldn't read the latest release from GitHub: ${error.message}`);
      // The last answer stands for now; GitHub is asked again in a minute, or when it says its limit resets (at most an hour).
      const wait = Math.min(Math.max(error.retryAt ? error.retryAt - now : 0, RETRY_MS), MAX_RETRY_MS);
      cached = { ...cached, repo, at: now - CACHE_MS + wait };
    }
  }
  return cached.parts ? releaseFrom(cached.parts, env) : null;
}

/** Forgets the cached GitHub answer (tests). */
function clearReleaseCache() {
  cached = { at: 0, parts: null, repo: null };
}

module.exports = { compareVersions, latestRelease, sectionsFromBody, clearReleaseCache };
