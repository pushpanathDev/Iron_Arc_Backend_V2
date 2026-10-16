// The user row behind every signed-in request. No database or Firebase:
// both are replaced with in-memory fakes before userService loads.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

function stub(relative, exports) {
  const p = require.resolve(path.join(__dirname, "..", relative));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

let rows;
let liveFirebaseUids;
const uniqueError = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
const find = (where) => rows.find((r) => (where.firebaseUid ? r.firebaseUid === where.firebaseUid : where.id ? r.id === where.id : r.email === where.email)) ?? null;

stub("config/database.js", {
  prisma: {
    user: {
      findUnique: async ({ where }) => find(where),
      create: async ({ data }) => {
        if (rows.some((r) => r.email === data.email || r.firebaseUid === data.firebaseUid)) throw uniqueError();
        const row = { id: `row-${rows.length + 1}`, ...data };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = find(where);
        if (data.email && rows.some((r) => r !== row && r.email === data.email)) throw uniqueError();
        return Object.assign(row, data);
      },
    },
  },
});
stub("config/firebase.js", {
  auth: {
    getUser: async (uid) => {
      if (liveFirebaseUids.includes(uid)) return { uid };
      throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
    },
  },
});

const { upsertUserByFirebaseUid } = require("./userService");

beforeEach(() => {
  rows = [];
  liveFirebaseUids = [];
});

test("first sign-in creates the user; later ones return the same row", async () => {
  const first = await upsertUserByFirebaseUid("uid-1", " Sam@Example.com ");
  const again = await upsertUserByFirebaseUid("uid-1", "sam@example.com");
  assert.equal(first.email, "sam@example.com");
  assert.equal(again.id, first.id);
  assert.equal(rows.length, 1);
});

test("an email changed in Firebase is copied over", async () => {
  await upsertUserByFirebaseUid("uid-1", "old@example.com");
  const user = await upsertUserByFirebaseUid("uid-1", "new@example.com");
  assert.equal(user.email, "new@example.com");
});

test("signing up again after the account was deleted in Firebase works, and the old data is kept", async () => {
  rows.push({ id: "old-row", firebaseUid: "deleted-uid", email: "sam@example.com" });
  const user = await upsertUserByFirebaseUid("new-uid", "sam@example.com");
  assert.equal(user.firebaseUid, "new-uid");
  assert.equal(user.email, "sam@example.com");
  assert.equal(rows.find((r) => r.id === "old-row").email, "released-old-row@deleted.invalid");
});

test("an email that belongs to a live account is never taken over", async () => {
  rows.push({ id: "other", firebaseUid: "live-uid", email: "sam@example.com" });
  liveFirebaseUids.push("live-uid");
  await assert.rejects(upsertUserByFirebaseUid("new-uid", "sam@example.com"), { code: "P2002" });
  assert.equal(rows.find((r) => r.id === "other").email, "sam@example.com");
});
