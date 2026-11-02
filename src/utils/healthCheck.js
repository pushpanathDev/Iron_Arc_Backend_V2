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
const safeModeOf = (user) => Object.values(healthCheckOf(user)?.answers ?? {}).some((answer) => answer === true);

/** Why this user can't use the AI coach (an HttpError with a code the app acts on), or null. */
function coachAccessError(user) {
  if (!(user?.age >= ADULT_AGE)) {
    return new HttpError(403, "The AI coach is for adults (18+). Logging and your stats work as usual.", "COACH_ADULTS_ONLY");
  }
  if (!healthCheckOf(user)) {
    return new HttpError(403, "Please complete the short health check before using the AI coach.", "HEALTH_CHECK_REQUIRED");
  }
  return null;
}

/** What's saved for a completed check. */
function newHealthCheck(answers, now = new Date()) {
  const at = now.toISOString();
  return { version: HEALTH_CHECK_VERSION, answers, checkedAt: at, consentedAt: at };
}

module.exports = { HEALTH_CHECK_VERSION, HEALTH_CHECK_QUESTIONS, ADULT_AGE, healthCheckOf, safeModeOf, coachAccessError, newHealthCheck };
