/*
 * The pieces every Iron Arc email is built from: one dark page with the Pro
 * shimmer on top, paragraphs, ticked cards, a receipt and the footer. Email
 * clients need tables and inline styles, so the markup is old-fashioned on
 * purpose. Anything that came from a user goes through escapeHtml.
 */
const C = {
  page: "#0B0E11",
  card: "#191C1F",
  raised: "#1D2023",
  line: "#272A2E",
  text: "#E1E2E7",
  soft: "#BCCAC0",
  muted: "#8A939C",
  accent: "#22D47F",
  warn: "#FFB957",
};
/** The Pro badge's holographic shimmer (the app's proFinish). */
const SHIMMER = "linear-gradient(90deg, #A1FFCE, #7FD8FF, #B49CFF, #FF9EC7)";
const PLAN_NAMES = { monthly: "Monthly", yearly: "Yearly" };
const FONT = "'Inter', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const HEADLINE = "'Barlow Condensed', 'Arial Narrow', 'Segoe UI', Arial, sans-serif";

const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

/** "₹1,199.00" from 119900 paise (Indian digit grouping). */
function rupees(amount) {
  const whole = String(Math.floor(amount / 100));
  const grouped = whole.length <= 3 ? whole : `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${whole.slice(-3)}`;
  return `₹${grouped}.${String(amount % 100).padStart(2, "0")}`;
}

/** "9 Nov 2026", in India's time zone. */
const day = (date) => new Date(date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

const planName = (plan) => PLAN_NAMES[plan] ?? plan;

/** "IA-20261102-3F9A1C2B": the payment's date and the start of its id. */
const receiptNumber = (payment) => `IA-${new Date(payment.createdAt).toISOString().slice(0, 10).replace(/-/g, "")}-${payment.id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;

/** First name, or a friendly stand-in. */
const firstName = (user) => (user.displayName || "").trim().split(/\s+/)[0] || "lifter";

/** A small uppercase label above a section. */
const label = (text) => `<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${C.muted};margin-bottom:10px;">${text}</div>`;

/** Ticked cards: [title, text] pairs (trusted copy, not user input). */
const tickedCards = (items) =>
  items
    .map(
      ([title, text]) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.raised};border-radius:12px;margin-bottom:8px;"><tr>
      <td width="36" valign="top" style="padding:14px 0 14px 16px;font-size:18px;color:${C.accent};">✔</td>
      <td style="padding:14px 16px 14px 8px;"><div style="font-size:15px;font-weight:600;color:${C.text};">${title}</div><div style="font-size:14px;line-height:20px;color:${C.soft};margin-top:2px;">${text}</div></td>
    </tr></table>`,
    )
    .join("\n");

/** The rows a receipt shows for a payment, as [label, value]. */
function receiptRows(payment, { trialDays } = {}) {
  const trial = payment.kind === "trial";
  return [
    ["Receipt", receiptNumber(payment)],
    ["Date", day(payment.createdAt)],
    ["Plan", `Iron Arc Pro · ${planName(payment.plan)}${trial ? ` (${trialDays}-day free trial)` : payment.kind === "renewal" ? " (renewal)" : ""}`],
    ["Period", `${day(payment.periodStart)} – ${day(payment.periodEnd)}`],
    ["Paid via", payment.provider === "test" ? "Test mode · no payment taken" : payment.provider],
  ];
}

const totalLabel = (payment) => `Total ${payment.kind === "trial" ? "today" : "paid"}`;

/** The receipt block: rows, the total, and the test-mode note for test payments. */
function receiptHtml(payment, options) {
  const rows = receiptRows(payment, options);
  return `${label("Receipt")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:12px;">
      ${rows
        .map(
          ([name, value], i) => `<tr><td style="padding:10px 16px;font-size:14px;color:${C.muted};${i ? `border-top:1px solid ${C.line};` : ""}">${name}</td><td align="right" style="padding:10px 16px;font-size:14px;color:${C.text};${i ? `border-top:1px solid ${C.line};` : ""}">${escapeHtml(value)}</td></tr>`,
        )
        .join("\n      ")}
      <tr><td style="padding:14px 16px;font-size:15px;font-weight:600;color:${C.text};border-top:1px solid ${C.line};">${totalLabel(payment)}</td><td align="right" style="padding:14px 16px;font-size:20px;font-weight:700;color:${C.accent};border-top:1px solid ${C.line};">${rupees(payment.amount)}</td></tr>
    </table>
    ${payment.provider === "test" ? testNote("this is a test receipt. No money was taken and nothing will be charged.") : ""}`;
}

/** The same receipt as plain text lines. */
function receiptText(payment, options) {
  return [
    "RECEIPT",
    ...receiptRows(payment, options).map(([name, value]) => `${name}: ${value}`),
    `${totalLabel(payment)}: ${rupees(payment.amount)}`,
    ...(payment.provider === "test" ? ["", "Test mode: this is a test receipt. No money was taken and nothing will be charged."] : []),
  ];
}

/** The amber "Test mode" note. */
const testNote = (text) => `<p style="margin:10px 0 0;padding:10px 12px;border-radius:8px;background:#2A2416;font-size:13px;line-height:19px;color:${C.warn};"><strong>Test mode:</strong> ${text}</p>`;

/**
 * A whole email page. `blocks` are HTML rows' contents (each its own padded
 * row); `kicker` the small line above the headline; `title` may hold <br>.
 */
const PRO_FOOTER = "You're getting this because you have Iron Arc Pro in the app. Manage or cancel any time in Profile → Subscription. Questions? Just reply to this email.";

function page({ preheader, kicker, title, blocks, signOff = "Lift heavy, recover well.", footer = PRO_FOOTER }) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><title>Iron Arc</title></head>
<body style="margin:0;padding:0;background:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border-radius:16px;overflow:hidden;font-family:${FONT};">
  <tr><td style="height:6px;background:#7FD8FF;background-image:${SHIMMER};font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:28px 28px 8px;">
    ${logo()}<div style="font-family:${HEADLINE};font-size:13px;letter-spacing:3px;color:${C.muted};text-transform:uppercase;">${kicker}</div>
    <h1 style="margin:12px 0 0;font-family:${HEADLINE};font-size:34px;line-height:38px;font-weight:700;color:${C.text};text-transform:uppercase;">${title}</h1>
  </td></tr>
  ${blocks.map((block) => `<tr><td style="padding:20px 28px 0;font-size:16px;line-height:24px;color:${C.soft};">${block}</td></tr>`).join("\n  ")}
  <tr><td style="padding:28px 28px 8px;font-size:15px;line-height:22px;color:${C.soft};">${signOff}<br><strong style="color:${C.text};">Team Iron Arc</strong></td></tr>
  <tr><td style="padding:16px 28px 28px;font-size:12px;line-height:18px;color:${C.muted};border-top:1px solid ${C.line};">
    ${escapeHtml(footer)}
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

/**
 * The Iron Arc logo above the headline, when EMAIL_LOGO_URL says where it is
 * (an https address any mail app can load, e.g. the backend's
 * /static/email-logo.png or a copy on a website). Without it, no image.
 */
function logo() {
  const url = process.env.EMAIL_LOGO_URL;
  if (!url || !url.startsWith("https://")) return "";
  return `<img src="${escapeHtml(url)}" width="56" height="56" alt="Iron Arc" style="display:block;width:56px;height:56px;border:0;border-radius:12px;margin:0 0 18px;">`;
}

/** Paragraphs from plain text (escaped). */
const paragraphs = (...texts) => texts.map((t) => `<p style="margin:0 0 12px;">${escapeHtml(t)}</p>`).join("");

module.exports = { C, escapeHtml, rupees, day, planName, receiptNumber, firstName, label, tickedCards, receiptHtml, receiptText, testNote, page, paragraphs };
