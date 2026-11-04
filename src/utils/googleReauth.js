const { OAuth2Client } = require("google-auth-library");

/*
 * Deleting an account needs a recent sign-in. For Google accounts that can't
 * be the token's sign-in time: Firebase keeps the first one, and Google on
 * Android hands back the token it already has (valid up to an hour), however
 * the app asks. So the app sends the Google ID token from the confirmation
 * the user just made (header x-google-reauth: the Delete dialog, then Google's
 * account picker), and it's checked here with Google: made for this app
 * (GOOGLE_WEB_CLIENT_ID, the same web client id as the app's), not expired
 * (Google tokens last an hour at most), and for the Google account linked to
 * this Firebase user. Password accounts keep the strict 5-minute rule.
 */
const client = new OAuth2Client();

/** Google ID tokens last an hour; anything older isn't accepted however it's dated. */
const GOOGLE_TOKEN_MAX_AGE_SECONDS = 60 * 60;

/**
 * True when `idToken` is a valid Google sign-in to this app for this user
 * (`googleIds`: the Google account ids Firebase links to them).
 */
async function isGoogleConfirmation(idToken, googleIds, { verify = (options) => client.verifyIdToken(options), now = Date.now() } = {}) {
  const audience = process.env.GOOGLE_WEB_CLIENT_ID;
  if (!audience) {
    console.warn("[auth] GOOGLE_WEB_CLIENT_ID is not set, so a Google confirmation can't be checked");
    return false;
  }
  if (!idToken || !Array.isArray(googleIds) || googleIds.length === 0) return false;
  try {
    // Checks Google's signature, this app as the audience, and that it hasn't expired.
    const payload = (await verify({ idToken, audience })).getPayload();
    if (!googleIds.includes(payload.sub)) {
      console.warn("[auth] Google confirmation refused: a different Google account");
      return false;
    }
    const age = Math.floor(now / 1000) - payload.iat;
    if (age < -60 || age > GOOGLE_TOKEN_MAX_AGE_SECONDS) {
      console.warn(`[auth] Google confirmation refused: issued ${age}s ago`);
      return false;
    }
    return true;
  } catch (error) {
    console.warn(`[auth] Google confirmation refused: ${error.message}`);
    return false;
  }
}

module.exports = { isGoogleConfirmation };
