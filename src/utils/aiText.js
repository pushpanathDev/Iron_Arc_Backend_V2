/*
 * Text crossing the AI boundary. What the user typed goes into a prompt
 * cleaned and fenced in a tag, so the model reads it as data rather than as
 * instructions; what the model writes is cleaned and capped before it is
 * stored or shown.
 */

/** Control characters, zero-width characters and text-direction overrides (used to hide instructions). */
// eslint-disable-next-line no-control-regex
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Text a person typed, for storing and showing: no hidden characters, trimmed, capped. Line breaks are kept. */
function plainText(value, max) {
  return String(value ?? "")
    .replace(HIDDEN, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** User text for a prompt: like plainText, with angle brackets swapped out so it can't open or close a tag. */
function promptText(value, max) {
  return plainText(value, max).replace(/</g, "‹").replace(/>/g, "›");
}

/** Text the model wrote: one line, no code fences, capped at a word boundary with an ellipsis. */
function aiText(value, max) {
  if (typeof value !== "string") return "";
  const clean = value.replace(HIDDEN, "").replace(/```[a-z]*/gi, "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** `text` inside a named tag, each on its own line. */
const fenced = (tag, text) => `<${tag}>\n${text}\n</${tag}>`;

module.exports = { plainText, promptText, aiText, fenced };
