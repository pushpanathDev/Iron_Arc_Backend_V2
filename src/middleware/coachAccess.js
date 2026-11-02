const { coachAccessError } = require("../utils/healthCheck");

/**
 * In front of every route that calls the AI: the coach is for adults who have
 * done the health check. A 403 with a code the app acts on otherwise
 * (COACH_ADULTS_ONLY, HEALTH_CHECK_REQUIRED). Runs after the auth middleware.
 */
function requireCoachAccess(req, res, next) {
  const error = coachAccessError(req.user?.dbUser);
  if (error) return next(error);
  next();
}

module.exports = { requireCoachAccess };
