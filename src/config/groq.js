const Groq = require('groq-sdk');

if (!process.env.GROQ_API_KEY) {
  throw new Error('[Iron Arc] GROQ_API_KEY is missing from environment variables.');
}

const groqClient = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

module.exports = { groqClient, GROQ_MODEL };
