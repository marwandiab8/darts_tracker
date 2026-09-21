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

// --- where each dart landed (uses draft() from above) ---------------------------------------

// Positions run parallel to the entry: per target, three slots that are {x, y} (relative to the
// board's centre and radius) or null. See public/index.html.
function positions() {
  const result = { "20": [{ x: 0.012, y: -0.583 }, null, null], BULL: [{ x: -0.02, y: 0.03 }, null, null] };
  return result;
}

test("a session can be saved with dart positions, and without them", async () => {
  const db = asUser(me);
  await assertSucceeds(addDoc(collection(db, "sessions"), session({ positions: positions() })));
  await assertSucceeds(addDoc(collection(db, "sessions"), session()));
});

test("positions that are not a map, or are oversized, are refused", async () => {
  const db = asUser(me);
  await assertFails(addDoc(collection(db, "sessions"), session({ positions: "0.1,0.2" })));
  await assertFails(addDoc(collection(db, "sessions"), session({ positions: [1, 2, 3] })));
  const oversized = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`t${index}`, [null, null, null]]));
  await assertFails(addDoc(collection(db, "sessions"), session({ positions: oversized })));
});

test("other unknown fields are still refused next to positions", async () => {
  await assertFails(addDoc(collection(asUser(me), "sessions"), session({ positions: positions(), note: "x" })));
});

test("a session's positions can be edited by its owner, within limits", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "sessions"), session({ positions: positions() })));
  await assertSucceeds(updateDoc(doc(db, "sessions", ref.id), { positions: { "20": [null, null, null] } }));
  await assertFails(updateDoc(doc(db, "sessions", ref.id), { positions: "nope" }));
});

test("a live draft can carry positions, and cannot carry a non-map", async () => {
  const db = asUser(me);
  await assertSucceeds(setDoc(doc(db, "liveDrafts", me), draft({ positions: positions() }), { merge: true }));
  await assertFails(setDoc(doc(db, "liveDrafts", me), draft({ positions: "x" }), { merge: true }));
});

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

// --- practice games against the bot ------------------------------------------------------------

const dartList = (count) => Array.from({ length: count }, () => ({ x: 0, y: -0.58, s: "T20" }));
const botGame = (overrides = {}) => ({
  uid: me, timestamp: "2026-09-20 19:30", kind: "x01", startScore: 501, doubleOut: true, rank: "club", first: "player",
  result: "won", durationSec: 600, rounds: 15, playerAvg: 54.2, botAvg: 47.9, playerScore: 0, botScore: 120,
  playerDarts: dartList(45), botDarts: dartList(42), ...overrides,
});

test("a signed-in user can save, list and delete their own bot games, and nobody else can read them", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "botGames"), botGame()));
  await assertSucceeds(getDoc(ref));
  const listed = await assertSucceeds(getDocs(query(collection(db, "botGames"), where("uid", "==", me))));
  assert.equal(listed.size, 1);
  await assertFails(getDoc(doc(asUser(other), "botGames", ref.id)));
  await assertFails(getDocs(query(collection(asUser(other), "botGames"), where("uid", "==", me))));
  await assertFails(deleteDoc(doc(asUser(other), "botGames", ref.id)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "botGames", ref.id)));
  await assertSucceeds(deleteDoc(ref));
});

test("a cricket game has no start score, and an x01 game needs one from 201 to 701", async () => {
  const db = asUser(me);
  const cricket = botGame({ kind: "cricket", playerAvg: 2.1, botAvg: 1.7 });
  delete cricket.startScore;
  delete cricket.doubleOut;
  await assertSucceeds(addDoc(collection(db, "botGames"), cricket));
  await assertFails(addDoc(collection(db, "botGames"), botGame({ kind: "cricket" })));
  for (const startScore of [101, 150, 501.5, 801, "501", 0]) {
    await assertFails(addDoc(collection(db, "botGames"), botGame({ startScore })));
  }
  for (const startScore of [201, 301, 401, 501, 601, 701]) {
    await assertSucceeds(addDoc(collection(db, "botGames"), botGame({ startScore })));
  }
  const noScore = botGame();
  delete noScore.startScore;
  await assertFails(addDoc(collection(db, "botGames"), noScore));
});

test("an abandoned game with no darts is fine, and the optional fields can be left out", async () => {
  const db = asUser(me);
  const minimal = { uid: me, timestamp: "2026-09-20 19:30", kind: "cricket", rank: "pro", result: "abandoned", playerDarts: [], botDarts: [] };
  await assertSucceeds(addDoc(collection(db, "botGames"), minimal));
});

test("bot games with the wrong shape are refused", async () => {
  const db = asUser(me);
  const refused = [
    botGame({ uid: other }),
    botGame({ rank: "god" }),
    botGame({ result: "draw" }),
    botGame({ kind: "bullseye" }),
    botGame({ first: "nobody" }),
    botGame({ timestamp: 5 }),
    botGame({ timestamp: "x" }),
    botGame({ playerDarts: "many" }),
    botGame({ playerDarts: dartList(601) }),
    botGame({ botDarts: dartList(601) }),
    botGame({ playerAvg: -1 }),
    botGame({ botAvg: "fast" }),
    botGame({ durationSec: 999999 }),
    botGame({ doubleOut: "yes" }),
    botGame({ extra: "field" }),
  ];
  for (const data of refused) await assertFails(addDoc(collection(db, "botGames"), data));
  const missing = botGame();
  delete missing.result;
  await assertFails(addDoc(collection(db, "botGames"), missing));
  await assertSucceeds(addDoc(collection(db, "botGames"), botGame({ playerDarts: dartList(600), botDarts: dartList(600) })));
});

test("a saved bot game cannot be edited", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "botGames"), botGame()));
  await assertFails(updateDoc(ref, { result: "lost" }));
  await assertFails(updateDoc(ref, { playerAvg: 200 }));
  await assertFails(setDoc(ref, botGame({ result: "lost" })));
});

// --- games between two people sharing the phone ---------------------------------------------------

const versusGame = (overrides = {}) => ({
  uid: me, timestamp: "2026-09-20 19:30", kind: "x01", startScore: 501, doubleOut: true, first: "player", result: "won",
  durationSec: 900, rounds: 14, playerName: "Alex", playerEmail: `${me}@example.com`, opponentName: "Sam", opponentEmail: "sam@example.org",
  playerAvg: 55.5, opponentAvg: 48.1, playerScore: 0, opponentScore: 96,
  playerDarts: dartList(40), opponentDarts: dartList(39), log: [{ w: "p", t: "60" }, { w: "o", t: "45" }], ...overrides,
});

test("a signed-in user can save, list and delete their own two-player games, and nobody else can read them", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "versusGames"), versusGame()));
  await assertSucceeds(getDoc(ref));
  const listed = await assertSucceeds(getDocs(query(collection(db, "versusGames"), where("uid", "==", me))));
  assert.equal(listed.size, 1);
  await assertFails(getDoc(doc(asUser(other), "versusGames", ref.id)));
  await assertFails(getDocs(query(collection(asUser(other), "versusGames"), where("uid", "==", me))));
  await assertFails(deleteDoc(doc(asUser(other), "versusGames", ref.id)));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "versusGames", ref.id)));
  await assertSucceeds(deleteDoc(ref));
});

test("a two-player game needs a real opponent email, and the first player's must be their own", async () => {
  const db = asUser(me);
  for (const opponentEmail of ["", "sam", "sam@", "@example.org", "sam@example", "sam smith@example.org", 5, "a@b".padEnd(300, "c") + ".com"]) {
    await assertFails(addDoc(collection(db, "versusGames"), versusGame({ opponentEmail })));
  }
  await assertFails(addDoc(collection(db, "versusGames"), versusGame({ playerEmail: "someone.else@example.com" })));
  await assertFails(addDoc(collection(db, "versusGames"), versusGame({ playerEmail: "not an email" })));
  const missing = versusGame();
  delete missing.opponentEmail;
  await assertFails(addDoc(collection(db, "versusGames"), missing));
  await assertSucceeds(addDoc(collection(db, "versusGames"), versusGame({ opponentEmail: "first.last+darts@mail.example.co.uk" })));
});

test("two-player games with the wrong shape are refused, and cricket has no start score", async () => {
  const db = asUser(me);
  const refused = [
    versusGame({ uid: other }), versusGame({ result: "draw" }), versusGame({ kind: "bullseye" }), versusGame({ startScore: 150 }),
    versusGame({ playerName: "x".repeat(61) }), versusGame({ opponentName: 5 }), versusGame({ playerDarts: dartList(601) }),
    versusGame({ opponentDarts: "many" }), versusGame({ log: "text" }), versusGame({ playerAvg: -1 }), versusGame({ extra: "field" }),
    versusGame({ emailStatus: "sent" }),
  ];
  for (const data of refused) await assertFails(addDoc(collection(db, "versusGames"), data));
  const cricket = versusGame({ kind: "cricket", playerAvg: 2.1, opponentAvg: 1.7 });
  delete cricket.startScore;
  delete cricket.doubleOut;
  await assertSucceeds(addDoc(collection(db, "versusGames"), cricket));
  await assertFails(addDoc(collection(db, "versusGames"), versusGame({ kind: "cricket" })));
  await assertSucceeds(addDoc(collection(db, "versusGames"), versusGame({ result: "abandoned", playerDarts: [], opponentDarts: [] })));
});

test("a saved two-player game cannot be edited, so the email status is only ever set by the server", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "versusGames"), versusGame()));
  await assertFails(updateDoc(ref, { emailStatus: "sent" }));
  await assertFails(updateDoc(ref, { opponentEmail: "victim@example.org" }));
  await assertFails(setDoc(ref, versusGame({ result: "lost" })));
});
