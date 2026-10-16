const { HttpError } = require("../utils/httpError");

const isProduction = () => process.env.NODE_ENV === "production";

/** Database errors with a meaning for the app. */
const PRISMA_ERRORS = {
  P2002: [409, "A record with this data already exists."],
  P2025: [404, "Record not found."],
};

/** A request body express.json() couldn't read. */
const BODY_ERRORS = {
  "entity.parse.failed": "The request body isn't valid JSON.",
  "entity.too.large": "The request body is too large.",
};

/**
 * Every error from a route ends here (Express 5 forwards rejected async
 * handlers too). Expected errors keep their status and message; anything else
 * is a 500 that hides the details in production.
 */
// Express recognises an error handler by its four parameters, so `next` stays.
function errorHandler(err, req, res, next) {
  const where = `${req.method} ${req.path}`;
  const send = (status, message) => res.status(status).json({ success: false, message });

  if (err instanceof HttpError) {
    console.warn(`[http] ${err.status} ${where}: ${err.message}`);
    return send(err.status, err.message);
  }

  if (PRISMA_ERRORS[err.code]) {
    return send(...PRISMA_ERRORS[err.code]);
  }

  if (BODY_ERRORS[err.type]) {
    return send(err.status, BODY_ERRORS[err.type]);
  }

  console.error(`[Error] ${where}: ${err.message}`);
  if (!isProduction()) console.error(err.stack);
  send(500, isProduction() ? "Something went wrong. Please try again." : err.message);
}

module.exports = { errorHandler };
