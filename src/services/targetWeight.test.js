/**
 * Runnable check for the optional target weight on the profile (not a test framework).
 *   node src/services/targetWeight.test.js
 * No database or Firebase: both modules are replaced before userService loads.
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
  user: {
    findUnique: async () => ({ id: "user-1" }),
    update: async ({ data }) => {
      lastUpdate = data;
      return { id: "user-1", ...data };
    },
  },
  bodyWeight: {
    findFirst: async () => ({ weight: 78.4 }),
    upsert: async () => ({}),
  },
};
stub("config/database.js", { prisma: { $transaction: async (fn) => fn(tx) } });
stub("config/firebase.js", { auth: {} });

const { profileUpdateSchema } = require("../middleware/validation");
const { updateProfile } = require("./userService");

async function main() {
  console.log("# Validation");
  check("72.5 kg accepted", profileUpdateSchema.safeParse({ targetWeight: 72.5 }).success, true);
  check("null clears the goal", profileUpdateSchema.safeParse({ targetWeight: null }).success, true);
  check("omitted is fine", profileUpdateSchema.safeParse({ displayName: "Sam" }).success, true);
  check("below 20 kg rejected", profileUpdateSchema.safeParse({ targetWeight: 10 }).success, false);
  check("above 500 kg rejected", profileUpdateSchema.safeParse({ targetWeight: 600 }).success, false);
  check("text rejected", profileUpdateSchema.safeParse({ targetWeight: "72" }).success, false);

  console.log("\n# updateProfile");
  await updateProfile("fb-1", { targetWeight: 72.5 });
  check("saves the target", lastUpdate.targetWeight, 72.5);
  check("body weight still comes from the latest entry", lastUpdate.weight, 78.4);
  await updateProfile("fb-1", { targetWeight: null });
  check("null clears it", lastUpdate.targetWeight, null);
  await updateProfile("fb-1", { displayName: "Sam" });
  check("other updates leave the target alone", "targetWeight" in lastUpdate, false);

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main();
