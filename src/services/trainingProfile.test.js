/**
 * Runnable check for the onboarding training profile (not a test framework).
 *   node src/services/trainingProfile.test.js
 * No database or Firebase: both modules are replaced before the services load.
 */
const path = require("path");

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}
function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

let lastUpdate = null;
const tx = {
  user: { findUnique: async () => ({ id: "user-1" }), update: async ({ data }) => { lastUpdate = data; return { id: "user-1", ...data }; } },
  bodyWeight: { findFirst: async () => ({ weight: 78 }), upsert: async () => ({}) },
};
stub("config/database.js", { prisma: { user: tx.user } });
stub("config/firebase.js", { auth: {} });
// The plan prompt builder is pure; the Groq client config (API key) is never touched.

const { profileUpdateSchema } = require("../middleware/validation");
const { updateProfile } = require("./userService");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { buildGeneratePlanPrompt } = require("../utils/planPrompts");

const ok = (body) => profileUpdateSchema.safeParse(body).success;

async function main() {
  console.log("# Validation");
  check("full training profile accepted", ok({ experienceLevel: "beginner", equipment: "dumbbells", sessionMinutes: 45, trainingDays: [1, 3, 5], avoidAreas: ["knees"] }), true);
  check("unknown experience rejected", ok({ experienceLevel: "pro" }), false);
  check("unknown equipment rejected", ok({ equipment: "kettlebells" }), false);
  check("session length must be 30/45/60/90", ok({ sessionMinutes: 50 }), false);
  check("7 training days rejected (one rest day minimum)", ok({ trainingDays: [1, 2, 3, 4, 5, 6, 7] }), false);
  check("repeated day rejected", ok({ trainingDays: [1, 1, 3] }), false);
  check("weekday 0 rejected", ok({ trainingDays: [0, 2] }), false);
  check("unknown avoid area rejected", ok({ avoidAreas: ["neck"] }), false);
  check("empty avoid list allowed (clears it)", ok({ avoidAreas: [] }), true);

  console.log("\n# updateProfile");
  await updateProfile("fb-1", { trainingDays: [5, 1, 3] });
  check("days saved sorted", lastUpdate.trainingDays, [1, 3, 5]);
  check("weeklyGoal follows the number of days", lastUpdate.weeklyGoal, 3);
  await updateProfile("fb-1", { sessionMinutes: 60, experienceLevel: "advanced" });
  check("other fields saved", [lastUpdate.sessionMinutes, lastUpdate.experienceLevel], [60, "advanced"]);
  check("weeklyGoal untouched without days", "weeklyGoal" in lastUpdate, false);

  console.log("\n# Plan prompt");
  const profile = anonymizeIronArcProfile(
    { age: 30, height: 180, weight: 80, fitnessGoal: "muscle", weeklyGoal: 6, experienceLevel: "beginner", equipment: "dumbbells", sessionMinutes: 45, trainingDays: [1, 3, 5], avoidAreas: ["knees"], email: "x@y.z", displayName: "Sam" },
    "user-1",
  );
  check("anonymizer keeps no name or email", [profile.email, profile.displayName], [undefined, undefined]);
  const prompt = buildGeneratePlanPrompt(profile, [], {});
  check("sessions = chosen days", prompt.includes("Generate exactly 3 training days"), true);
  check("scheduled on the chosen weekdays", prompt.includes("ONLY on: Monday, Wednesday, Friday"), true);
  check("session length from profile", prompt.includes("Session Length: 45 minutes"), true);
  check("equipment from profile", prompt.includes("Equipment Available: dumbbells"), true);
  check("split derived from 3 days", prompt.includes("\"full body\" split structure"), true);
  check("progression derived from beginner", prompt.includes("linear progression"), true);
  check("avoid rule included", prompt.includes("go easy on: knees"), true);
  const chosen = buildGeneratePlanPrompt(profile, [], { sessionDuration: 90, splitPreference: "upper_lower" });
  check("plan form still overrides the profile", chosen.includes("Session Length: 90 minutes") && chosen.includes("\"upper lower\" split structure"), true);
  const old = buildGeneratePlanPrompt(anonymizeIronArcProfile({ age: 30, fitnessGoal: "general", weeklyGoal: 4 }, "user-2"), [], {});
  check("older profiles still work (4 days, no weekdays)", old.includes("Generate exactly 4 training days") && !old.includes("ONLY on:"), true);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}
main();
