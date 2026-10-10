const Groq = require('groq-sdk');

if (!process.env.GROQ_API_KEY) {
  throw new Error('[Iron Arc] GROQ_API_KEY is missing from environment variables.');
}

const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const GROQ_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 30_000);

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
  timeout: GROQ_TIMEOUT_MS,
});

module.exports = { groqClient, GROQ_MODEL, GROQ_TIMEOUT_MS };
