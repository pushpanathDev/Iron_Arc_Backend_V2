const { adultsOnlyError, healthCheckError } = require("../utils/healthCheck");
const { proAccessError, proGateOn } = require("../utils/billing");
const { proStatus } = require("../services/billingService");

/**
 * In front of every route that calls the AI, after the auth middleware. In
 * this order: the coach is for adults; then Iron Arc Pro where the feature
 * needs it; then the health check. A 403 with a code the app acts on otherwise
 * (COACH_ADULTS_ONLY, PRO_REQUIRED, PLAN_LIMIT_REACHED, HEALTH_CHECK_REQUIRED).
 *
 * `feature`: "chat" needs Pro; "newPlan" needs Pro or the free plan;
 * "planWeeks" (next week, swaps) is open to everyone. Sets req.coach.freePlan
 * when a new plan will use the free one.
 */
function requireCoachAccess(feature) {
  return async function coachAccess(req, res, next) {
    const user = req.user?.dbUser;
    const tooYoung = adultsOnlyError(user);
    if (tooYoung) return next(tooYoung);

    let usesFreePlan = false;
    if (feature !== "planWeeks" && proGateOn()) {
      const status = await proStatus(user);
      const closed = proAccessError(feature, status);
      if (closed) return next(closed);
      usesFreePlan = feature === "newPlan" && !status.pro.active;
    }

    const noCheck = healthCheckError(user);
    if (noCheck) return next(noCheck);
    req.coach = { freePlan: usesFreePlan };
    next();
  };
}

module.exports = { requireCoachAccess };
