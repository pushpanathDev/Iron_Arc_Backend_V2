/**
 * An error the app should see: its HTTP status and a message fit for the user.
 * Services throw it (e.g. new HttpError(404, "Plan not found.")); the error
 * handler turns it into { success: false, message }, plus `code` when the app
 * should act on it (e.g. "HEALTH_CHECK_REQUIRED" opens the health check).
 */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    if (code) this.code = code;
  }
}

module.exports = { HttpError };
