const { groqClient, GROQ_MODEL } = require("../config/groq");

/*
 * The one place that talks to the AI (Groq). A prompt is { system, history?, user }
 * (see utils/planPrompts.js): the rules go in the system message and what the
 * user wrote only ever in user messages, so it can't pose as the rules. It
 * expects a JSON object back. Failed calls are retried twice: after a 429 it
 * waits as long as Groq asks, up to 20 s (the app gives up after 2 minutes, and
 * a plan can take two calls), after anything else 1 s, then 2 s.
 */

const RETRIES = 2;
/** Low, so plans and JSON stay consistent; the coach's wording still varies a little. */
const TEMPERATURE = 0.3;
const MAX_RATE_LIMIT_WAIT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** How long Groq asks us to wait after a 429, in seconds (header first, then the message). */
function retryAfterSeconds(error) {
  const header = error?.headers?.["retry-after"];
  if (header) return parseFloat(header);
  const match = (error?.message || "").match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/);
  return match ? parseFloat(match[1]) : null;
}

/**
 * The AI's reply to `prompt`, parsed from JSON. `maxTokens` caps the reply;
 * short replies (chat, swaps) use a smaller cap to stay inside the free
 * tier's tokens-per-minute limit. `onUsage({ tokensIn, tokensOut })` hears
 * about every answered attempt, so the daily budget counts what was spent.
 */
async function askForJson({ system, history = [], user }, { maxTokens = 8192, onUsage } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= RETRIES + 1; attempt++) {
    try {
      const completion = await groqClient.chat.completions.create({
        model: GROQ_MODEL,
        messages: [{ role: "system", content: system }, ...history, { role: "user", content: user }],
        temperature: TEMPERATURE,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      });

      const choice = completion.choices[0];
      const text = choice?.message?.content || "";
      const usage = completion.usage || {};
      console.log(
        `[AI] attempt ${attempt}: finish=${choice?.finish_reason} · tokens in=${usage.prompt_tokens ?? "?"} out=${usage.completion_tokens ?? "?"} · ${text.length} chars`,
      );
      onUsage?.({ tokensIn: usage.prompt_tokens ?? 0, tokensOut: usage.completion_tokens ?? 0 });

      // Strip code fences in case the model adds them anyway.
      return JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch (error) {
      lastError = error;
      // 413: this request alone is over the per-minute token limit; retrying can't help.
      if (error?.status === 413) throw error;
      console.warn(`[AI] attempt ${attempt}/${RETRIES + 1} failed: ${error.message}`);
      if (attempt > RETRIES) break;

      const rateLimited = error?.status === 429 || (error?.message || "").includes("429");
      const waitMs = rateLimited ? Math.min((retryAfterSeconds(error) ?? 20) * 1000, MAX_RATE_LIMIT_WAIT_MS) : 2 ** (attempt - 1) * 1000;
      await sleep(waitMs);
    }
  }

  throw new Error(`AI call failed after ${RETRIES + 1} attempts: ${lastError?.message}`);
}

module.exports = { askForJson };
