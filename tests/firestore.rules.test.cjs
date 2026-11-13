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

test("a session can be saved with its practice timer's time, within a day", async () => {
  const db = asUser(me);
  await assertSucceeds(addDoc(collection(db, "sessions"), session({ durationSec: 1265 })));
  await assertFails(addDoc(collection(db, "sessions"), session({ durationSec: 90000 })));
  await assertFails(addDoc(collection(db, "sessions"), session({ durationSec: "20 min" })));
});

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

test("a session can say whether it was finished; Save after Load updates it under its own id", async () => {
  const db = asUser(me);
  await assertSucceeds(setDoc(doc(db, "sessions", "tSid1"), session({ complete: false, total: 1 })));
  await assertSucceeds(setDoc(doc(db, "sessions", "tSid2"), session({ complete: true })));
  await assertFails(addDoc(collection(db, "sessions"), session({ complete: "no" })));
  // A retry of the same save, after a timeout that went through after all: the same document again.
  await assertSucceeds(setDoc(doc(db, "sessions", "tSid1"), session({ complete: false, total: 1 })));
  // Loaded and corrected: the same document updated.
  await assertSucceeds(updateDoc(doc(db, "sessions", "mine-1"), { total: 9, complete: true, entry: entry() }));
});

test("a session can carry every dart (throws, misses included) and when it started", async () => {
  const db = asUser(me);
  const throws = Array.from({ length: 63 }, (_, i) => ({ t: "20", r: i % 2 ? "-" : "S", l: "S20", src: "cam", x: 0.1, y: -0.4, seq: i + 1 }));
  await assertSucceeds(setDoc(doc(db, "sessions", "tThrows1"), session({ throws, startedAtMs: 1763060000000 })));
  await assertFails(setDoc(doc(db, "sessions", "tThrows2"), session({ throws: throws.concat(throws.slice(0, 1)) })));
  await assertFails(setDoc(doc(db, "sessions", "tThrows3"), session({ throws: "lots" })));
  await assertFails(setDoc(doc(db, "sessions", "tThrows4"), session({ startedAtMs: "now" })));
  // Loaded, corrected and saved again with its darts.
  await assertSucceeds(updateDoc(doc(db, "sessions", "mine-1"), { total: 9, entry: entry(), throws: throws.slice(0, 3) }));
  await assertFails(updateDoc(doc(db, "sessions", "mine-1"), { throws: throws.concat(throws) }));
});

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

// --- JDC Challenge rounds (challenge.html) ---------------------------------------------------
const C = require("../public/challenge-engine.js");
const challenge = (overrides = {}) => ({ ...C.record(me, [...Array(18).fill(1), ...Array(21).fill(1), ...Array(18).fill(3)], { timestamp: "2026-10-05 20:00", durationSec: 700 }), ...overrides });

test("a finished challenge round is saved as the page saves it, and only its owner sees or deletes it", async () => {
  const db = asUser(me);
  const ref = await assertSucceeds(addDoc(collection(db, "challengeGames"), challenge()));
  await assertSucceeds(getDocs(query(collection(db, "challengeGames"), where("uid", "==", me))));
  await assertFails(getDoc(doc(asUser(other), "challengeGames", ref.id)));
  await assertFails(deleteDoc(doc(asUser(other), "challengeGames", ref.id)));
  await assertFails(updateDoc(ref, { total: 3330 }), "never edited");
  await assertSucceeds(deleteDoc(ref));
});

test("challenge rounds with the wrong shape are refused", async () => {
  const db = asUser(me);
  const good = challenge();
  const refused = [
    challenge({ uid: other }), challenge({ darts: good.darts.slice(0, 56) }), challenge({ total: 3331 }),
    challenge({ total: good.total + 1 }), challenge({ part2: 1100 }), challenge({ doublesHit: 22 }),
    challenge({ extra: "field" }), challenge({ timestamp: 5 }),
  ];
  for (const data of refused) await assertFails(addDoc(collection(db, "challengeGames"), data));
  const bare = challenge();
  delete bare.durationSec; delete bare.trebles;
  await assertSucceeds(addDoc(collection(db, "challengeGames"), bare));
});

// --- the camera station (station.html, public/board-camera.js) --------------------------------
const station = (overrides = {}) => ({
  uid: me,
  setup: { version: 1, cameras: [{ deviceId: "dev-a", label: "OBS", cal: { H: [1, 0, 0, 0, 1, 0, 0, 0, 1], width: 1280, height: 720 } }] },
  station: { name: "Linux laptop", seen: 1700000000000, running: true, status: "Watching." },
  ...overrides,
});

test("only its owner reads or writes a camera station, its pictures and its darts", async () => {
  const mine = asUser(me), theirs = asUser(other);
  await assertSucceeds(setDoc(doc(mine, "cameraStations", me), station()));
  await assertSucceeds(setDoc(doc(mine, "cameraStations", me), { ask: { still: "abc" } }, { merge: true }));
  await assertSucceeds(setDoc(doc(mine, "cameraStations", me, "stills", "0"), { jpeg: "data:image/jpeg;base64,AAAA", width: 1280, height: 720, label: "OBS", taken: 1, for: "abc" }));
  await assertSucceeds(setDoc(doc(mine, "cameraStations", me, "events", "latest"), { seq: 5, events: [{ seq: 5, type: "dart", label: "T20" }], updated: 1 }));
  await assertSucceeds(getDoc(doc(mine, "cameraStations", me)));
  await assertSucceeds(getDoc(doc(mine, "cameraStations", me, "events", "latest")));
  for (const path of [["cameraStations", me], ["cameraStations", me, "stills", "0"], ["cameraStations", me, "events", "latest"]]) {
    await assertFails(getDoc(doc(theirs, ...path)));
    await assertFails(deleteDoc(doc(theirs, ...path)));
  }
  await assertFails(setDoc(doc(theirs, "cameraStations", me), station({ uid: other })));
  await assertFails(setDoc(doc(theirs, "cameraStations", me), { ask: { clear: "x" } }, { merge: true }));
  await assertFails(setDoc(doc(theirs, "cameraStations", me, "events", "latest"), { seq: 6, events: [], updated: 1 }));
  await assertSucceeds(deleteDoc(doc(mine, "cameraStations", me, "stills", "0")));
});

test("camera station documents with the wrong shape are refused", async () => {
  const db = asUser(me);
  await assertFails(setDoc(doc(db, "cameraStations", me), station({ uid: other })));
  await assertFails(setDoc(doc(db, "cameraStations", me), station({ extra: 1 })));
  await assertFails(setDoc(doc(db, "cameraStations", me), station({ setup: { cameras: [{}, {}, {}] } })));
  await assertFails(setDoc(doc(db, "cameraStations", me), station({ station: "online" })));
  await assertFails(setDoc(doc(db, "cameraStations", me), { ask: { still: "x" } }), "a new station needs its owner");
  await assertFails(setDoc(doc(db, "cameraStations", me, "stills", "2"), { jpeg: "x", width: 1, height: 1 }));
  await assertFails(setDoc(doc(db, "cameraStations", me, "stills", "0"), { jpeg: "x".repeat(900001), width: 1, height: 1 }));
  await assertFails(setDoc(doc(db, "cameraStations", me, "stills", "0"), { jpeg: "x", width: 1, height: 1, script: "y" }));
  await assertFails(setDoc(doc(db, "cameraStations", me, "events", "other"), { seq: 1, events: [], updated: 1 }));
  await assertFails(setDoc(doc(db, "cameraStations", me, "events", "latest"), { seq: 1, events: Array(21).fill({ type: "dart" }), updated: 1 }));
});

test("the live draft can carry the darts thrown at each number (misses included)", async () => {
  const db = asUser(me);
  await assertSucceeds(setDoc(doc(db, "liveDrafts", me), { uid: me, deviceId: "d", mode: "standard", entry: entry(), positions: {}, thrown: { "20": 3, "19": 1 }, total: 6, sessionDate: "2026-11-07", sessionTime: "21:00" }));
  await assertFails(setDoc(doc(asUser(other), "liveDrafts", me), { uid: other, entry: entry(), thrown: { "20": 3 } }));
});

// --- the live game, shared by the owner's devices (practice.html, public/live-sync.js) ---------------

const liveVersion = (overrides = {}) => ({
  uid: me, vid: "vid0000001", parent: "", by: "page000001", at: 1762560000000, phase: "play", rev: 1,
  state: JSON.stringify({ v: 1, gameId: "g1", game: { kind: "x01" }, camSeq: 0 }), ...overrides,
});

test("the live game: its owner starts one, and each change is made from the latest version", async () => {
  const db = asUser(me), ref = doc(db, "liveGames", me);
  await assertSucceeds(setDoc(ref, liveVersion()));
  await assertSucceeds(getDoc(ref));
  // From the latest version: in. From an older one (another device changed it first): refused.
  await assertSucceeds(setDoc(ref, liveVersion({ vid: "vid0000002", parent: "vid0000001", rev: 2 })));
  await assertFails(setDoc(ref, liveVersion({ vid: "vid0000003", parent: "vid0000001", rev: 2 })));
  await assertSucceeds(setDoc(ref, liveVersion({ vid: "vid0000004", parent: "vid0000002", rev: 3, phase: "over" })));
  // A new game replaces whatever is there; leaving one is a version too.
  await assertSucceeds(setDoc(ref, liveVersion({ vid: "vid0000005", parent: "", rev: 1 })));
  await assertSucceeds(setDoc(ref, liveVersion({ vid: "vid0000006", parent: "vid0000005", rev: 2, phase: "none" })));
  await assertSucceeds(deleteDoc(ref));
});

test("nobody else can read or change someone's live game", async () => {
  await assertSucceeds(setDoc(doc(asUser(me), "liveGames", me), liveVersion()));
  const theirs = asUser(other);
  await assertFails(getDoc(doc(theirs, "liveGames", me)));
  await assertFails(setDoc(doc(theirs, "liveGames", me), liveVersion({ uid: other, parent: "" })));
  await assertFails(setDoc(doc(theirs, "liveGames", other), liveVersion()));
  await assertFails(deleteDoc(doc(theirs, "liveGames", me)));
});

test("live game versions with the wrong shape are refused", async () => {
  const ref = doc(asUser(me), "liveGames", me);
  await assertFails(setDoc(ref, liveVersion({ phase: "paused" })));
  await assertFails(setDoc(ref, liveVersion({ state: { game: 1 } })));
  await assertFails(setDoc(ref, liveVersion({ state: "x".repeat(900001) })));
  await assertFails(setDoc(ref, liveVersion({ rev: 0 })));
  await assertFails(setDoc(ref, liveVersion({ rev: 1.5 })));
  await assertFails(setDoc(ref, liveVersion({ vid: "short" })));
  await assertFails(setDoc(ref, liveVersion({ at: "now" })));
  await assertFails(setDoc(ref, liveVersion({ extra: true })));
  const { by, ...noBy } = liveVersion();
  await assertFails(setDoc(ref, noBy));
  await assertSucceeds(setDoc(ref, liveVersion({ state: "x".repeat(899000) })));
});

test("a saved bot game can be saved under the live game's id, once", async () => {
  const db = asUser(me), ref = doc(db, "botGames", "game-id-1");
  await assertSucceeds(setDoc(ref, botGame()));
  await assertSucceeds(getDoc(ref));
  await assertFails(setDoc(ref, botGame({ result: "lost" })));
});

// --- notes on the cameras' darts, to learn from (public/board-learn.js) ------------------------------

const note = (overrides = {}) => ({ seq: 1762600000123, at: 1762600004000, page: "practice", outcome: "corrected", read: { label: "S12", x: -0.2, y: -0.7 }, truth: { label: "D20", x: 0.01, y: -0.95 }, ...overrides });

test("the owner's games note what happened to each camera dart, and the station marks its pictures kept", async () => {
  const db = asUser(me), ref = doc(db, "cameraStations", me, "notes", "1762600000123");
  await assertSucceeds(setDoc(ref, note()));
  await assertSucceeds(setDoc(ref, { pictures: true }, { merge: true }));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, note({ outcome: "kept", truth: { label: "S12", x: -0.2, y: -0.7 } })));
  await assertSucceeds(setDoc(doc(db, "cameraStations", me, "notes", "1762600000124"), note({ seq: 1762600000124, page: "tracker", truth: { label: "MISS", x: null, y: null } })));
  await assertSucceeds(deleteDoc(ref));
  await assertFails(getDoc(doc(asUser(other), "cameraStations", me, "notes", "1762600000124")));
  await assertFails(setDoc(doc(asUser(other), "cameraStations", me, "notes", "1762600000125"), note({ seq: 1762600000125 })));
});

test("notes with the wrong shape are refused", async () => {
  const notes = (id) => doc(asUser(me), "cameraStations", me, "notes", id);
  await assertFails(setDoc(notes("1762600000123"), note({ seq: 99 })));
  await assertFails(setDoc(notes("1762600000123"), note({ outcome: "maybe" })));
  await assertFails(setDoc(notes("1762600000123"), note({ page: "elsewhere" })));
  await assertFails(setDoc(notes("1762600000123"), note({ truth: { label: "D20", x: 0, y: -0.95, z: 1 } })));
  await assertFails(setDoc(notes("1762600000123"), note({ truth: { label: "a much too long label", x: 0, y: 0 } })));
  await assertFails(setDoc(notes("1762600000123"), note({ pictures: "yes" })));
  await assertFails(setDoc(notes("1762600000123"), note({ extra: 1 })));
  await assertFails(setDoc(notes("x"), note()));
});

test("the station can keep what it learned with its setup", async () => {
  const ref = doc(asUser(me), "cameraStations", me);
  await assertSucceeds(setDoc(ref, { uid: me, setup: { learned: { options: { threshold: 26 }, at: 1, n: 40, right: 36, was: 33 }, learning: { at: 1, n: 40, right: 36, was: 33, used: true } } }, { merge: true }));
  await assertSucceeds(setDoc(ref, { uid: me, setup: { learned: null } }, { merge: true }));
});

// --- Doubles (doubles.html) --------------------------------------------------------------------

const doublesState = (overrides = {}) => ({ uid: me, lifetime: { doubles: { D1: { attempts: 2, hits: 1, hits1: 1, hits2: 0, hits3: 0 } } }, activeSession: null, lastUndo: null, updatedAt: 1, ...overrides });
const doublesSession = (overrides = {}) => ({ uid: me, startedAtMs: 1762600000000, localDate: "2026-11-08", endedAtMs: 1762600900000, activeMs: 800000, totalDarts: 90, extraDarts: 0, perDouble: { D1: { attempts: 1, completed: true, hitDart: 2, completedAt: 1 } }, createdAt: 1, ...overrides });

test("a player keeps their own Doubles state, and nobody else can read or change it", async () => {
  const ref = doc(asUser(me), "doublesState", me);
  await assertSucceeds(setDoc(ref, doublesState()));
  await assertSucceeds(setDoc(ref, doublesState({ activeSession: { meta: { startedAtMs: 1 }, doubles: {} }, lastUndo: { startedAtMs: 1, keys: {} } })));
  await assertSucceeds(getDoc(ref));
  await assertFails(getDoc(doc(asUser(other), "doublesState", me)));
  await assertFails(setDoc(doc(asUser(other), "doublesState", me), doublesState({ uid: other })));
  await assertFails(setDoc(ref, doublesState({ uid: other })));
  await assertFails(setDoc(ref, doublesState({ extra: 1 })));
  await assertFails(setDoc(ref, doublesState({ lifetime: "lots" })));
  // Board mode's undo steps: a list of at most 10.
  await assertSucceeds(setDoc(ref, doublesState({ undoStack: [{ id: "a", keys: {} }, { id: "b", keys: {} }] })));
  await assertFails(setDoc(ref, doublesState({ undoStack: Array.from({ length: 11 }, (_, i) => ({ id: String(i) })) })));
  await assertFails(setDoc(ref, doublesState({ undoStack: "many" })));
});

test("finished Doubles rounds are saved, read and deleted by their owner only", async () => {
  const ref = doc(asUser(me), "doublesSessions", "s1");
  await assertSucceeds(setDoc(ref, doublesSession()));
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(setDoc(ref, doublesSession({ totalDarts: 91 })));
  await assertFails(getDoc(doc(asUser(other), "doublesSessions", "s1")));
  await assertFails(setDoc(doc(asUser(other), "doublesSessions", "s1"), doublesSession({ uid: other })));
  await assertFails(setDoc(doc(asUser(me), "doublesSessions", "s2"), doublesSession({ uid: other })));
  await assertFails(setDoc(doc(asUser(me), "doublesSessions", "s3"), doublesSession({ startedAtMs: "today" })));
  await assertFails(setDoc(doc(asUser(me), "doublesSessions", "s4"), doublesSession({ score: 5 })));
  // Where the camera darts landed.
  await assertSucceeds(setDoc(doc(asUser(me), "doublesSessions", "s5"), doublesSession({ throws: [{ s: 1, k: "D1", l: "S1", x: 0.1, y: -0.7, t: 1 }] })));
  await assertFails(setDoc(doc(asUser(me), "doublesSessions", "s6"), doublesSession({ throws: { s: 1 } })));
  await assertFails(setDoc(doc(asUser(me), "doublesSessions", "s7"), doublesSession({ throws: Array.from({ length: 601 }, (_, i) => ({ s: i })) })));
  await assertSucceeds(deleteDoc(ref));
});

test("Doubles sessions carried over from the old app keep their old fields", async () => {
  await assertSucceeds(setDoc(doc(asUser(me), "doublesSessions", "-Oold1"), { uid: me, importedFrom: "mydoublesprogress", startedAtMs: 1769323000000, startedAt: 1769323000000, durationMs: 600000, dartsUsed: 77, endedAt: 1769323600000, lastTarget: "DBULL", savedAt: 1769323600000, totalDartsPlanned: 63 }));
  await assertSucceeds(setDoc(doc(asUser(me), "doublesSessions", "-Oold2"), doublesSession({ importedFrom: "mydoublesprogress", rounds: 2 })));
});
