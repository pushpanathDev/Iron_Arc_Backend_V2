// What the app may save as an account's settings.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preferencesSchema } = require("./validation");

const ok = (body) => preferencesSchema.safeParse(body).success;

test("accepts some or all of the settings", () => {
  assert.ok(ok({ theme: "burnt-copper" }));
  assert.ok(ok({ unit: "lbs", defaultReps: null }));
  assert.ok(ok({ theme: "gold", unit: "kg", defaultReps: 12, barWeights: { "barbell curl": { value: 10, unit: "kg" } } }));
});

test("refuses unknown fields, odd values and an empty save", () => {
  assert.ok(!ok({}));
  assert.ok(!ok({ colour: "red" }), "unknown field");
  assert.ok(!ok({ theme: "<script>" }));
  assert.ok(!ok({ unit: "stone" }));
  assert.ok(!ok({ defaultReps: 0 }));
  assert.ok(!ok({ defaultReps: 12.5 }));
  assert.ok(!ok({ barWeights: { squat: { value: -1, unit: "kg" } } }));
  assert.ok(!ok({ barWeights: Object.fromEntries(Array.from({ length: 301 }, (_, i) => [`ex${i}`, { value: 20, unit: "kg" }])) }), "too many bars");
});
