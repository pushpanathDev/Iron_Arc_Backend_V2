const { HttpError } = require("./httpError");

/*
 * The health check the coach needs first: our own plain-language questions on
 * the PAR-Q+ topics, answered yes or no, plus agreeing that the coach is AI
 * and not medical advice. Only the yes/no answers are kept. Any "yes" turns on
 * Safe mode: conservative plans and changes (see planValidator's SAFE_LIMITS
 * and the prompts' SAFE MODE rules). The coach is for adults only.
 * Raising the version asks everyone to answer again.
 */
const HEALTH_CHECK_VERSION = 1;

/** The questions' keys; the app holds their wording. */
const HEALTH_CHECK_QUESTIONS = ["heart", "chestPain", "dizziness", "condition", "medication", "joints", "supervised", "pregnancy"];

const ADULT_AGE = 18;

/** The user's current health check, or null when there's none or it's an older version. */
function healthCheckOf(user) {
  const check = user?.healthCheck;
  return check && check.version === HEALTH_CHECK_VERSION && check.consentedAt ? check : null;
}

/** True when any health check answer was "yes". */
const anyYesOf = (user) => Object.values(healthCheckOf(user)?.answers ?? {}).some((answer) => answer === true);

/**
 * Safe mode: a "yes" on the health check, unless the user confirmed a doctor
 * has cleared them to exercise without restrictions (the PAR-Q+ way out of a
 * "yes"). The answers stay as they were; redoing the check asks again.
 */
const safeModeOf = (user) => anyYesOf(user) && !healthCheckOf(user)?.clearedAt;

/** A 403 COACH_ADULTS_ONLY for anyone under 18 (or without an age), else null. */
const adultsOnlyError = (user) =>
  user?.age >= ADULT_AGE ? null : new HttpError(403, "The AI coach is for adults (18+). Logging and your stats work as usual.", "COACH_ADULTS_ONLY");

/** A 403 HEALTH_CHECK_REQUIRED until the current health check is done, else null. */
const healthCheckError = (user) =>
  healthCheckOf(user) ? null : new HttpError(403, "Please complete the short health check before using the AI coach.", "HEALTH_CHECK_REQUIRED");

/** Why this user can't use the AI coach (an HttpError with a code the app acts on), or null. */
const coachAccessError = (user) => adultsOnlyError(user) ?? healthCheckError(user);

/** What's saved for a completed check. */
function newHealthCheck(answers, now = new Date()) {
  const at = now.toISOString();
  return { version: HEALTH_CHECK_VERSION, answers, checkedAt: at, consentedAt: at };
}

module.exports = {
  HEALTH_CHECK_QUESTIONS,
  ADULT_AGE,
  healthCheckOf,
  safeModeOf,
  anyYesOf,
  adultsOnlyError,
  healthCheckError,
  coachAccessError,
  newHealthCheck,
};
