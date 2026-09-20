const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertFails, assertSucceeds, initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc, updateDoc, where } = require("firebase/firestore");

const [host = "127.0.0.1", port = "8080"] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");
const rules = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
let env;

const me = "user-me";
const other = "user-other";
const asUser = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com`, email_verified: true }).firestore();

// The document the app saves (see the Save Session button in public/index.html).
const target = (darts = ["-", "-", "-"]) => darts;
function entry() {
  const result = {};
  [...Array.from({ length: 20 }, (_, index) => String(20 - index)), "BULL"].forEach((name) => { result[name] = target(); });
  result["20"] = ["T", "D", "S"];
  return result;
}
const session = (overrides = {}) => ({ uid: me, timestamp: "2026-09-20 19:30", mode: "standard", entry: entry(), total: 6, ...overrides });

test.before(async () => {
  env = await initializeTestEnvironment({ projectId: "demo-darts-rules", firestore: { host, port: Number(port), rules } });
});
test.beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "sessions", "mine-1"), session());
    await setDoc(doc(db, "sessions", "theirs-1"), session({ uid: other }));
    await setDoc(doc(db, "liveDrafts", other), { uid: other, deviceId: "d", mode: "standard", entry: entry(), total: 0, sessionDate: "2026-09-20", sessionTime: "19:30" });
  });
});
test.after(async () => env.cleanup());

// --- ownership: what the deployed rules already enforced -----------------------------------

test("a signed-in user can save, read, list and delete their own sessions", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "sessions"), session()));
  await assertSucceeds(getDoc(doc(db, "sessions", ref.id)));
  await assertSucceeds(getDocs(query(collection(db, "sessions"), where("uid", "==", me), orderBy("timestamp", "asc"))));
  await assertSucceeds(deleteDoc(doc(db, "sessions", ref.id)));
});

test("nobody can read, change or delete another user's session", async () => {
  const db = asUser(me);
  await assertFails(getDoc(doc(db, "sessions", "theirs-1")));
  await assertFails(deleteDoc(doc(db, "sessions", "theirs-1")));
  await assertFails(updateDoc(doc(db, "sessions", "theirs-1"), { total: 1 }));
  await assertFails(getDocs(collection(db, "sessions")));
});

test("a session cannot be saved under someone else's uid, and signed-out clients get nothing", async () => {
  await assertFails(addDoc(collection(asUser(me), "sessions"), session({ uid: other })));
  const signedOut = env.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(signedOut, "sessions", "mine-1")));
  await assertFails(addDoc(collection(signedOut, "sessions"), session()));
});

test("a session's owner cannot be changed by an update", async () => {
  await assertFails(updateDoc(doc(asUser(me), "sessions", "mine-1"), { uid: other }));
});

// --- data shape: what the hardening adds ----------------------------------------------------

test("a session with the wrong shape is refused", async () => {
  const db = asUser(me);
  const refused = [
    ["an unknown extra field", session({ note: "hello" })],
    ["a mode that does not exist", session({ mode: "cricket" })],
    ["a negative total", session({ total: -1 })],
    ["a total above what is possible", session({ total: 5000 })],
    ["a total that is not a whole number", session({ total: 6.5 })],
    ["a total that is text", session({ total: "6" })],
    ["a total that is not a number", session({ total: NaN })],
    ["an entry that is not a map", session({ entry: "TDS" })],
    ["an entry with more than 21 targets", session({ entry: Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`t${index}`, ["S", "-", "-"]])) })],
    ["a timestamp that is not text", session({ timestamp: 20260920 })],
    ["a timestamp with no date", session({ timestamp: " 19:30" })],
    ["a very long timestamp", session({ timestamp: "2026-09-20 " + "x".repeat(200) })]
  ];
  for (const [label, data] of refused) await assertFails(addDoc(collection(db, "sessions"), data), label);
});

test("a session missing a field is refused", async () => {
  const db = asUser(me);
  for (const field of ["timestamp", "mode", "entry", "total"]) {
    const data = session();
    delete data[field];
    await assertFails(addDoc(collection(db, "sessions"), data), `missing ${field}`);
  }
});

test("a valid single-mode session, and one with an empty time, are accepted", async () => {
  const db = asUser(me);
  await assertSucceeds(addDoc(collection(db, "sessions"), session({ mode: "single", total: 3 })));
  await assertSucceeds(addDoc(collection(db, "sessions"), session({ timestamp: "2026-09-20 " })));
});

test("the biggest possible session is accepted", async () => {
  await assertSucceeds(addDoc(collection(asUser(me), "sessions"), session({ total: 200 })));
});

// --- live drafts ------------------------------------------------------------------------------

const draft = (overrides = {}) => ({ uid: me, deviceId: "device-1", updatedAt: new Date(), mode: "standard", entry: entry(), total: 6, sessionDate: "2026-09-20", sessionTime: "19:30", ...overrides });

test("a user can read and write their own live draft, with a merge like the app does", async () => {
  const db = asUser(me);
  await assertSucceeds(setDoc(doc(db, "liveDrafts", me), draft(), { merge: true }));
  await assertSucceeds(getDoc(doc(db, "liveDrafts", me)));
  await assertSucceeds(setDoc(doc(db, "liveDrafts", me), draft({ total: 9 }), { merge: true }));
});

test("nobody can touch another user's live draft", async () => {
  const db = asUser(me);
  await assertFails(getDoc(doc(db, "liveDrafts", other)));
  await assertFails(setDoc(doc(db, "liveDrafts", other), draft({ uid: other }), { merge: true }));
});

test("a live draft cannot carry someone else's uid or an oversized entry", async () => {
  const db = asUser(me);
  await assertFails(setDoc(doc(db, "liveDrafts", me), draft({ uid: other }), { merge: true }));
  const oversized = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`t${index}`, ["S", "-", "-"]]));
  await assertFails(setDoc(doc(db, "liveDrafts", me), draft({ entry: oversized }), { merge: true }));
  await assertFails(setDoc(doc(db, "liveDrafts", me), draft({ entry: "TDS" }), { merge: true }));
});

test("a live draft cannot be padded with dozens of extra fields", async () => {
  const filler = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`f${index}`, "x"]));
  await assertFails(setDoc(doc(asUser(me), "liveDrafts", me), draft(filler), { merge: true }));
});

test("older drafts that carry legacy fields can still be updated", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "liveDrafts", me), { uid: me, deviceId: "old", mode: "standard", entryMode: "both", scoreMode: "standard", entry: entry(), total: 0 });
  });
  await assertSucceeds(setDoc(doc(asUser(me), "liveDrafts", me), draft({ total: 4 }), { merge: true }));
});

// --- older sessions ----------------------------------------------------------------------------

test("an older session with import fields and no mode can be updated, within limits", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), "sessions", "legacy-1"), { uid: me, timestamp: "2025-12-31 12:00", entry: entry(), total: 30, importedFromCSV: true, createdAt: "x", date: "2025-12-31", time: "12:00", maxTotal: 40, meta: { a: 1 } });
  });
  const db = asUser(me);
  await assertSucceeds(updateDoc(doc(db, "sessions", "legacy-1"), { total: 31 }));
  await assertFails(updateDoc(doc(db, "sessions", "legacy-1"), { total: 9999 }));
  await assertFails(updateDoc(doc(db, "sessions", "legacy-1"), { total: -3 }));
  await assertFails(updateDoc(doc(db, "sessions", "legacy-1"), { uid: other }));
  await assertSucceeds(deleteDoc(doc(db, "sessions", "legacy-1")));
});

test("anything else in the database is closed", async () => {
  const db = asUser(me);
  await assertFails(getDoc(doc(db, "somethingElse", "x")));
  await assertFails(setDoc(doc(db, "somethingElse", "x"), { a: 1 }));
});
