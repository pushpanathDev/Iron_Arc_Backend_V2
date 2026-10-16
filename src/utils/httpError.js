/**
 * An error the app should see: its HTTP status and a message fit for the user.
 * Services throw it (e.g. new HttpError(404, "Plan not found.")); the error
 * handler turns it into { success: false, message }.
 */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

module.exports = { HttpError };
