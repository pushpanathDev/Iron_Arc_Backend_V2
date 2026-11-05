// POST /api/voice/transcribe: Speak your sets' accurate text. No Groq, Firebase
// or billing: they're replaced before the routes load.
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { stub } = require("../testing/stub");
const express = require("express");

let pro = true;
let groqCalls = [];
let groqFails = false;

stub("middleware/authMiddleware.js", {
  verifyFirebaseToken: (req, _res, next) => {
    req.user = { uid: "uid-1", dbUser: { id: "user-1" } };
    next();
  },
  requireEmailVerified: (_req, _res, next) => next(),
});
stub("services/billingService.js", {
  proStatus: async () => ({ pro: { active: pro }, freePlan: { limit: 1, used: 0 } }),
});
stub("config/groq.js", {
  groqClient: {
    audio: {
      transcriptions: {
        create: async (options) => {
          groqCalls.push(options);
          if (groqFails) throw new Error("Groq is down");
          return { text: " Bench press, 80 kilos, 8 reps. " };
        },
      },
    },
  },
});

const app = express();
app.use(express.json({ limit: "50kb" }));
app.use("/api/voice", require("./voiceRoutes"));
app.use(require("../middleware/errorHandler").errorHandler);

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}/api/voice/transcribe`;
});
after(() => server.close());

beforeEach(() => {
  pro = true;
  groqCalls = [];
  groqFails = false;
});

/** A 16 kHz mono 16-bit WAV of `seconds` of silence. */
function wav(seconds) {
  const data = Buffer.alloc(Math.round(seconds * 32000));
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const send = (body, query = "") => fetch(`${base}${query}`, { method: "POST", headers: { "Content-Type": "audio/wav" }, body });

test("a Pro member's clip comes back as text, with the session's exercises steering the spelling", async () => {
  const res = await send(wav(2), `?exercises=${encodeURIComponent(JSON.stringify(["Barbell Bench Press", "Lat Pulldown"]))}`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).data, { text: "Bench press, 80 kilos, 8 reps." });
  assert.equal(groqCalls.length, 1);
  assert.equal(groqCalls[0].model, "whisper-large-v3-turbo");
  assert.equal(groqCalls[0].language, "en");
  assert.match(groqCalls[0].prompt, /reps/);
  assert.match(groqCalls[0].prompt, /Barbell Bench Press, Lat Pulldown/);
});

test("without Pro it's refused, and Groq isn't asked", async () => {
  pro = false;
  const res = await send(wav(2));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, "PRO_REQUIRED");
  assert.equal(groqCalls.length, 0);
});

test("only a WAV recording under a minute and a half is accepted", async () => {
  assert.equal((await send(Buffer.from("not audio at all, just some text here to fill a header"))).status, 400);
  assert.equal((await send(wav(95))).status, 413);
  assert.equal(groqCalls.length, 0);
});

test("a bad exercises list is ignored", async () => {
  const res = await send(wav(1), "?exercises=not-json");
  assert.equal(res.status, 200);
  assert.doesNotMatch(groqCalls[0].prompt, /not-json/);
});

test("when Groq fails, the app is told to keep the phone's words", async () => {
  groqFails = true;
  const res = await send(wav(2));
  assert.equal(res.status, 503);
});
