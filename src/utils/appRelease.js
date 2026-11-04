/*
 * The app's latest release, for the in-app update prompt.
 *
 * Normally it comes from GitHub: the latest release of APP_RELEASES_REPO
 * (default pushpanathDev/Iron_Arc-app). Its tag ("v2.2.0") is the version,
 * its attached .apk (any name) the download, its publish date starts the
 * grace period, and the bold points of its text are "What's new". So
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
 * GitHub is asked at most every 10 minutes; if it can't be reached, the last
 * answer stands (or there's nothing to announce).
 */
const DEFAULT_REPO = "pushpanathDev/Iron_Arc-app";
const DEFAULT_GRACE_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;
const VERSION = /^\d+\.\d+\.\d+$/;
const MAX_NOTES = 8;

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
function releaseFrom({ latest, downloadUrl, releasedAt, notes }, env) {
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
    notes: notes.slice(0, MAX_NOTES),
  };
}

/** Manual control: the APP_* settings, when APP_LATEST_VERSION is set. */
function releaseFromSettings(env) {
  return releaseFrom(
    {
      latest: env.APP_LATEST_VERSION?.trim(),
      downloadUrl: env.APP_DOWNLOAD_URL?.trim(),
      releasedAt: env.APP_RELEASED_AT,
      notes: (env.APP_RELEASE_NOTES ?? "").split("|").map((line) => line.trim()).filter(Boolean),
    },
    env,
  );
}

/**
 * "What's new" from a release's text: its bullet points, each cut to the bold
 * part when it has one ("- **Move a session.** History → …" → "Move a
 * session"). Headings and other lines are left out; markdown is removed.
 */
function notesFromBody(body) {
  return String(body ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.*)$/)?.[1])
    .filter(Boolean)
    .map((item) => {
      const bold = item.match(/^\*\*(.+?)\*\*/)?.[1];
      const text = (bold ?? item).replace(/\*\*|__|`/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[.:]\s*$/, "").trim();
      return text.length > 120 ? `${text.slice(0, 117).trimEnd()}…` : text;
    })
    .filter(Boolean);
}

/** A GitHub release (the API's JSON) as the parts of the app's release, or null. */
function partsFromGitHub(gh) {
  if (!gh || gh.draft || gh.prerelease) return null;
  const apk = (gh.assets ?? []).find((asset) => String(asset.name).toLowerCase().endsWith(".apk"));
  return {
    latest: String(gh.tag_name ?? "").replace(/^v/i, ""),
    downloadUrl: apk?.browser_download_url,
    releasedAt: gh.published_at ?? null,
    notes: notesFromBody(gh.body),
  };
}

async function fetchLatestGitHubRelease(repo) {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "iron-arc-backend" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
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
      cached = { at: now, repo, parts: partsFromGitHub(await fetchRelease(repo)) };
    } catch (error) {
      console.warn(`[appRelease] Couldn't read the latest release from GitHub: ${error.message}`);
      // The last answer stands for now; GitHub is asked again in a minute.
      cached = { ...cached, repo, at: now - CACHE_MS + 60 * 1000 };
    }
  }
  return cached.parts ? releaseFrom(cached.parts, env) : null;
}

/** Forgets the cached GitHub answer (tests). */
function clearReleaseCache() {
  cached = { at: 0, parts: null, repo: null };
}

module.exports = { compareVersions, latestRelease, notesFromBody, clearReleaseCache };
