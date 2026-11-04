/*
 * Transactional email through Resend's API (EMAIL_FROM on a verified domain).
 * Without RESEND_API_KEY and EMAIL_FROM nothing is sent, only logged, so local
 * work and tests never email anyone. Replies go to EMAIL_REPLY_TO.
 */
const RESEND_URL = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

const emailConfigured = () => !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

/**
 * Sends one email. `idempotencyKey` makes a retry of the same email a no-op at
 * Resend (e.g. the payment it's about). Throws when Resend refuses it, or when
 * email isn't set up (RESEND_API_KEY, EMAIL_FROM), so nothing counts as sent.
 */
async function sendEmail({ to, subject, html, text, idempotencyKey }) {
  if (!emailConfigured()) throw new Error("email isn't set up (RESEND_API_KEY, EMAIL_FROM)");
  const res = await fetch(RESEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: [to],
      subject,
      html,
      text,
      ...(process.env.EMAIL_REPLY_TO ? { reply_to: process.env.EMAIL_REPLY_TO } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Resend answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

module.exports = { sendEmail };
