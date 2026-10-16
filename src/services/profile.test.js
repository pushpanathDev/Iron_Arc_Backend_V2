// The profile: what the app may save (validation), how it's saved, and how
// the training profile shapes a new plan's prompt. No database or Firebase.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

let saved;
stub("config/database.js", {
  prisma: {
    user: {
      update: async ({ data }) => {
        saved = data;
        return { id: "user-1", ...data };
      },
    },
  },
});
stub("config/firebase.js", { auth: {} });

const { profileUpdateSchema } = require("../middleware/validation");
const { updateProfile } = require("./userService");
const { anonymizeIronArcProfile } = require("../utils/anonymizer");
const { buildFirstWeekPrompt } = require("../utils/planPrompts");
const { planSettings } = require("../utils/planSchedule");

const accepted = (body) => profileUpdateSchema.safeParse(body).success;

beforeEach(() => {
  saved = null;
});

test("target weight: 20–500 kg, or null to clear it", () => {
  assert.ok(accepted({ targetWeight: 72.5 }));
  assert.ok(accepted({ targetWeight: null }));
  assert.ok(accepted({ displayName: "Sam" }), "leaving it out is fine");
  assert.ok(!accepted({ targetWeight: 10 }));
  assert.ok(!accepted({ targetWeight: 600 }));
  assert.ok(!accepted({ targetWeight: "72" }));
});

test("training profile: only known values", () => {
  assert.ok(accepted({ experienceLevel: "beginner", equipment: "dumbbells", sessionMinutes: 45, trainingDays: [1, 3, 5], avoidAreas: ["knees"] }));
  assert.ok(!accepted({ experienceLevel: "pro" }));
  assert.ok(!accepted({ equipment: "kettlebells" }));
  assert.ok(!accepted({ sessionMinutes: 50 }), "session length must be 30/45/60/90");
  assert.ok(!accepted({ trainingDays: [1, 2, 3, 4, 5, 6, 7] }), "one rest day minimum");
  assert.ok(!accepted({ trainingDays: [1, 1, 3] }), "no repeated day");
  assert.ok(!accepted({ trainingDays: [0, 2] }), "weekdays are 1–7");
  assert.ok(!accepted({ avoidAreas: ["neck"] }));
  assert.ok(accepted({ avoidAreas: [] }), "an empty list clears it");
});

test("saving the target weight, and clearing it", async () => {
  await updateProfile("user-1", { targetWeight: 72.5 });
  assert.equal(saved.targetWeight, 72.5);
  await updateProfile("user-1", { targetWeight: null });
  assert.equal(saved.targetWeight, null);
  await updateProfile("user-1", { displayName: "Sam" });
  assert.equal("targetWeight" in saved, false, "other updates leave it alone");
});

test("profile saves never write body weight (it mirrors the weight log), even if an older app sends one", async () => {
  await updateProfile("user-1", { targetWeight: 72.5 });
  assert.equal("weight" in saved, false);
  await updateProfile("user-1", { weight: 90 });
  assert.equal("weight" in saved, false);
});

test("training days are saved sorted and set the weekly goal", async () => {
  await updateProfile("user-1", { trainingDays: [5, 1, 3] });
  assert.deepEqual(saved.trainingDays, [1, 3, 5]);
  assert.equal(saved.weeklyGoal, 3);
  await updateProfile("user-1", { sessionMinutes: 60, experienceLevel: "advanced" });
  assert.deepEqual([saved.sessionMinutes, saved.experienceLevel], [60, "advanced"]);
  assert.equal("weeklyGoal" in saved, false, "untouched without days");
});

test("the plan prompt follows the training profile, with nothing that identifies the user", () => {
  const profile = anonymizeIronArcProfile({
    age: 30, height: 180, weight: 80, fitnessGoal: "muscle", weeklyGoal: 6, experienceLevel: "beginner", equipment: "dumbbells",
    sessionMinutes: 45, trainingDays: [1, 3, 5], avoidAreas: ["knees"], email: "x@y.z", displayName: "Sam",
  });
  assert.deepEqual([profile.email, profile.displayName], [undefined, undefined]);

  const prompt = buildFirstWeekPrompt(profile, planSettings(profile));
  assert.ok(prompt.includes("- Monday: Full body") && prompt.includes("- Wednesday: Full body") && prompt.includes("- Friday: Full body"), "the chosen days, full body for 3 days");
  assert.ok(!prompt.includes("- Tuesday"));
  assert.ok(prompt.includes("Session length: 45 minutes"));
  assert.ok(prompt.includes("Equipment: dumbbells"));
  assert.ok(prompt.includes("Progression: linear"), "progression from beginner");
  assert.ok(prompt.includes("Go easy on: knees"));

  const chosen = buildFirstWeekPrompt(profile, planSettings(profile, { sessionDuration: 90, splitPreference: "upper_lower" }));
  assert.ok(chosen.includes("Session length: 90 minutes") && chosen.includes("- Monday: Upper") && chosen.includes("- Wednesday: Lower"), "the plan form overrides the profile");
});

test("older profiles (no weekdays) get their weekly goal, spread over the week", () => {
  const old = anonymizeIronArcProfile({ age: 30, fitnessGoal: "general", weeklyGoal: 4 });
  assert.deepEqual(planSettings(old).schedule.map((s) => s.day), ["monday", "tuesday", "thursday", "friday"]);
});
