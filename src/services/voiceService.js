const { toFile } = require("groq-sdk");
const { groqClient } = require("../config/groq");
const { HttpError } = require("../utils/httpError");
const { promptText } = require("../utils/aiText");

/*
 * Speak your sets and spoken notes: a short WAV clip from the app, turned
 * into text by Whisper on Groq. The app shows the phone's own live words
 * while the user speaks; this is the accurate text after. The clip is only
 * passed through, never kept.
 */

const MODEL = process.env.VOICE_MODEL || "whisper-large-v3-turbo";
/** About 90 seconds of the app's 16 kHz mono audio: a set or a spoken note, never a recording. */
const MAX_SECONDS = 90;

/**
 * What Whisper is told to expect, as text like what will be said: it steers
 * spellings ("reps", not "ribs"; "bench press", not "some dramatic"). Whisper
 * reads at most 224 tokens of it.
 */
const GYM_WORDS = "Gym log: 80 kilos, 8 reps. 62.5 kg for 10. Bodyweight, 12 reps. Sets, reps, kilos, pounds, warm-up, felt strong, grip, form.";
const MAX_CONTEXT_CHARS = 500;

/** The seconds of audio in a 16-bit PCM WAV file, or null when it isn't one. */
function wavSeconds(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") return null;
  const byteRate = buffer.readUInt32LE(28);
  return byteRate > 0 ? (buffer.length - 44) / byteRate : null;
}

/** The exercise names the app sent, cleaned and kept short. */
function contextFrom(names) {
  const cleaned = (Array.isArray(names) ? names : [])
    .map((name) => promptText(name, 60))
    .filter(Boolean);
  let text = "";
  for (const name of cleaned) {
    const next = text ? `${text}, ${name}` : name;
    if (next.length > MAX_CONTEXT_CHARS) break;
    text = next;
  }
  return text;
}

/** The words in `audio` (a WAV buffer). `exercises` steer the spelling of names. */
async function transcribe(audio, { exercises = [] } = {}) {
  const seconds = wavSeconds(audio);
  if (seconds == null) throw new HttpError(400, "That isn't a recording the app can read.");
  if (seconds > MAX_SECONDS) throw new HttpError(413, "That recording is too long. Keep it under a minute and a half.");

  const context = contextFrom(exercises);
  try {
    const result = await groqClient.audio.transcriptions.create({
      file: await toFile(audio, "speech.wav", { type: "audio/wav" }),
      model: MODEL,
      language: "en",
      temperature: 0,
      response_format: "json",
      prompt: context ? `${GYM_WORDS} ${context}.` : GYM_WORDS,
    });
    return String(result?.text ?? "").trim();
  } catch (error) {
    console.warn(`[voice] Transcription failed: ${error.message}`);
    throw new HttpError(503, "Couldn't turn that into text right now. The words the phone heard are used instead.");
  }
}

module.exports = { transcribe, wavSeconds };
