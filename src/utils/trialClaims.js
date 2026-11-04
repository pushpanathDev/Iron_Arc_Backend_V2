const { createHash, createHmac } = require("node:crypto");

/*
 * One free trial per person, even after they delete their account, without
 * keeping who they were: only a keyed one-way hash (HMAC-SHA256) of the
 * normalised email is stored (trial_claims), and only to refuse a second
 * trial. The key is TRIAL_CLAIM_SECRET; without it a plain SHA-256 is used,
 * which still works but is easier to reverse with a list of emails.
 */
const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/**
 * The same mailbox written different ways counts once: case, "+tags"
 * (name+1@…) and, for Gmail, dots in the name (n.a.m.e@gmail.com).
 */
function normaliseEmail(email) {
  const [rawName = "", rawDomain = ""] = String(email ?? "").trim().toLowerCase().split("@");
  let name = rawName.split("+")[0];
  let domain = rawDomain;
  if (GMAIL_DOMAINS.has(domain)) {
    name = name.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${name}@${domain}`;
}

let warned = false;

/** The stored fingerprint of an email, or null without a usable one. */
function emailFingerprint(email) {
  const normalised = normaliseEmail(email);
  if (normalised.startsWith("@") || normalised.endsWith("@")) return null;
  const secret = process.env.TRIAL_CLAIM_SECRET;
  if (!secret && !warned) {
    warned = true;
    console.warn("[trialClaims] TRIAL_CLAIM_SECRET is not set; trial claims use a plain SHA-256");
  }
  return secret ? createHmac("sha256", secret).update(normalised).digest("hex") : createHash("sha256").update(normalised).digest("hex");
}

module.exports = { normaliseEmail, emailFingerprint };
