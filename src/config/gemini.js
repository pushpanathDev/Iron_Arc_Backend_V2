const { GoogleGenerativeAI } = require('@google/generative-ai');

if (!process.env.GEMINI_API_KEY) {
  throw new Error('[Iron Arc] GEMINI_API_KEY is missing from environment variables.');
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const geminiModel = genAI.getGenerativeModel({
  model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
  generationConfig: {
    temperature: 0.7,
    topP: 0.9,
    maxOutputTokens: 8192, // Plan JSON can be large (4 weeks × 7 days × 8 exercises)
  },
});

module.exports = { geminiModel };
