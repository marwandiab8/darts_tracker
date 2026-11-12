// node --test tests/doubles-engine.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/doubles-engine.js");

const T0 = 1_800_000_000_000;
function fresh() {
  const u = { lifetime: E.defaultLifetime(), activeSession: E.defaultSession(T0, "key1") };
  return u;
}
// Logs a plan the way the page does inside its transaction.
function log(u, plan, now = T0 + 1000) {
  assert.ok(plan && !plan.error, plan && plan.error);
  return E.applyChange(u, u.activeSession, plan, now);
}
const cur = (u) => E.currentKey(u.activeSession);
const d = (u, key) => u.activeSession.doubles[key];
const life = (u, key) => u.lifetime.doubles[key];
// A dart on the app board: in a double ring, in a number's single, or off the board, at the right angle.
const WEDGE = (Math.PI * 2) / 20;
const ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
function at(number, r) {
  const a = -Math.PI / 2 + ORDER.indexOf(number) * WEDGE;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}
let seq = 100;
const dbl = (n) => Object.assign({ seq: ++seq, label: `D${n}` }, at(n, 0.98));
const single = (n) => Object.assign({ seq: ++seq, label: `S${n}` }, at(n, 0.7));
const outside = (n) => Object.assign({ seq: ++seq, label: "MISS" }, at(n, 1.1));
function cam(u, dart, now = T0 + 2000) {
  const r = E.cameraDart(u.activeSession, dart);
  if (!r) return null;
  const rec = E.applyChange(u, u.activeSession, r, now);
  return Object.assign(r, { rec });
}

test("a hit moves on, a miss leaves the double open, and play goes back round to the earliest open one", () => {
  const u = fresh();
  log(u, E.planResult(u.activeSession, "hit2"));
  assert.equal(cur(u), "D2");
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").completed, d(u, "D1").hitDart], [1, true, 2]);
  assert.deepEqual([life(u, "D1").attempts, life(u, "D1").hits, life(u, "D1").hits2], [1, 1, 1]);
  log(u, E.planResult(u.activeSession, "miss"));
  assert.equal(cur(u), "D3");
  for (let i = 3; i <= 20; i += 1) log(u, E.planResult(u.activeSession, "hit1"));
  log(u, E.planResult(u.activeSession, "hit3")); // the bull
  assert.equal(cur(u), "D2", "back round to the one still open");
  assert.equal(E.sessionDarts(u.activeSession.doubles), 2 + 3 + 18 + 3);
});

test("finishing the last double freezes the timer", () => {
  const u = fresh();
  for (const k of E.KEYS) log(u, { visits: [{ key: k, hitDart: 1 }] }, T0 + 60_000);
  assert.ok(E.isFinished(u.activeSession));
  assert.equal(u.activeSession.timer.isPaused, true);
  assert.equal(u.activeSession.timer.activeMsAccum, 60_000);
  assert.equal(E.computeElapsed(u.activeSession, T0 + 999_999), 60_000);
});

test("pause stops the clock", () => {
  const u = fresh();
  E.pauseResume(u.activeSession, T0 + 10_000);
  assert.equal(E.computeElapsed(u.activeSession, T0 + 50_000), 10_000);
  E.pauseResume(u.activeSession, T0 + 50_000);
  assert.equal(E.computeElapsed(u.activeSession, T0 + 55_000), 15_000);
});

test("stayed on a double: hit on dart 7 is two missed visits and a hit, 4 darts extra", () => {
  const u = fresh();
  log(u, E.planStay(u.activeSession, "hit:7"));
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").hitDart, d(u, "D1").extraDarts], [3, 1, 4]);
  assert.equal(E.dartsAt(d(u, "D1")), 7);
  assert.equal(cur(u), "D2");
  log(u, E.planStay(u.activeSession, "miss:9"));
  assert.deepEqual([d(u, "D2").attempts, d(u, "D2").completed, d(u, "D2").extraDarts], [3, false, 6]);
  assert.equal(E.planStay(u.activeSession, "miss:7").error, "Pick how the extra darts ended.");
});

test("hit a later double: the ones skipped are misses", () => {
  const u = fresh();
  log(u, E.planLater(u.activeSession, "D4", 11)); // D1-D3 missed (9 darts), D4 on dart 2
  assert.deepEqual(["D1", "D2", "D3"].map((k) => d(u, k).attempts), [1, 1, 1]);
  assert.deepEqual([d(u, "D4").completed, d(u, "D4").hitDart], [true, 2]);
  assert.equal(cur(u), "D5");
  assert.match(E.planLater(u.activeSession, "D6", 2).error, /needs a total from 4 to 18/);
});

test("undo puts the doubles, the lifetime totals and the place back", () => {
  const u = fresh();
  log(u, E.planResult(u.activeSession, "hit1"));
  const before = E.clone(u);
  const rec = log(u, E.planStay(u.activeSession, "hit:5"));
  assert.equal(E.undo(u, rec, T0 + 5000), null);
  assert.deepEqual(u.activeSession.doubles, before.activeSession.doubles);
  assert.deepEqual(u.lifetime, before.lifetime);
  assert.equal(cur(u), "D2");
});

test("undo of the finishing throw rebuilds the round after it was saved and cleared", () => {
  const u = fresh();
  for (const k of E.KEYS.slice(0, -1)) log(u, { visits: [{ key: k, hitDart: 1 }] });
  const rec = log(u, E.planResult(u.activeSession, "hit1"), T0 + 9000);
  assert.ok(rec.finishingShot);
  u.activeSession = null; // saved to history and cleared
  assert.equal(E.undo(u, rec, T0 + 20_000), null);
  assert.equal(cur(u), "DBULL");
  assert.equal(u.activeSession.timer.isPaused, false);
  assert.equal(E.computeElapsed(u.activeSession, T0 + 21_000), 9000 + 1000);
});

test("undo refuses when the double changed since", () => {
  const u = fresh();
  const rec = log(u, E.planResult(u.activeSession, "miss"));
  log(u, { visits: [{ key: "D1", hitDart: 1 }] });
  assert.match(E.undo(u, rec, T0), /changed since/);
});

// ---- Cameras ----

test("camera: a dart in the current double is a hit on that dart", () => {
  const u = fresh();
  cam(u, single(1));
  const r = cam(u, dbl(1));
  assert.match(r.message, /D1 hit on dart 2/);
  assert.deepEqual([d(u, "D1").completed, d(u, "D1").hitDart], [true, 2]);
  assert.equal(cur(u), "D2");
  assert.deepEqual(u.activeSession.cam.darts, []);
});

test("camera: three darts without a hit are a miss, and play moves on", () => {
  const u = fresh();
  cam(u, single(1));
  cam(u, outside(20));
  assert.equal(d(u, "D1").attempts, 0, "not decided until the 3rd dart");
  assert.deepEqual(u.activeSession.cam.darts, ["S1", "MISS"]);
  cam(u, dbl(18)); // another double: a miss here, not a hit there
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").completed], [1, false]);
  assert.equal(d(u, "D18").attempts, 0);
  assert.equal(cur(u), "D2");
});

test("camera: staying on the double just missed and hitting it is 'stayed, hit on dart 4'", () => {
  const u = fresh();
  for (let i = 0; i < 3; i += 1) cam(u, single(1)); // D1 missed with 3 darts
  assert.equal(cur(u), "D2");
  const r = cam(u, dbl(1));
  assert.match(r.message, /stayed on D1 and hit it on dart 4/);
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").hitDart, d(u, "D1").extraDarts, d(u, "D1").completed], [2, 1, 1, true]);
  assert.deepEqual([life(u, "D1").attempts, life(u, "D1").hits, life(u, "D1").hits1], [2, 1, 1]);
  assert.equal(E.dartsAt(d(u, "D1")), 4);
  assert.equal(cur(u), "D2");
});

test("camera: darts in the number just missed keep the stay going; every 3 is another visit", () => {
  const u = fresh();
  for (let i = 0; i < 3; i += 1) cam(u, single(1)); // D1 missed
  cam(u, outside(1)); // just outside D1: still on it (4)
  cam(u, single(1)); // 5
  assert.equal(d(u, "D1").attempts, 1);
  cam(u, single(1)); // 6: another missed visit at D1, 3 extra
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").extraDarts], [2, 3]);
  assert.equal(cur(u), "D2");
  cam(u, dbl(1)); // dart 7 goes in
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").hitDart, d(u, "D1").extraDarts], [3, 1, 4]);
  assert.equal(E.dartsAt(d(u, "D1")), 7);
});

test("camera: darts at the new double before going back to the stay count for the stay", () => {
  const u = fresh();
  for (let i = 0; i < 3; i += 1) cam(u, single(1)); // D1 missed (3)
  cam(u, single(17)); // looks like a dart at D2 (4)
  cam(u, single(5)); // (5)
  cam(u, single(1)); // back in the 1: the two before were at D1 too (6): one more visit there
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").extraDarts], [2, 3]);
  assert.equal(d(u, "D2").attempts, 0);
});

test("camera: after a stay hit, Undo puts back the misses it replaced", () => {
  const u = fresh();
  for (let i = 0; i < 3; i += 1) cam(u, single(1));
  const before = E.clone(u);
  const r = cam(u, dbl(1));
  assert.equal(E.undo(u, r.rec, T0 + 9000), null);
  assert.deepEqual(u.activeSession.doubles, before.activeSession.doubles);
  assert.deepEqual(u.lifetime, before.lifetime);
  assert.equal(cur(u), "D2");
  assert.ok(u.activeSession.cam.seq >= r.cam.seq, "darts already counted stay counted");
});

test("camera: a dart already counted on another device is skipped", () => {
  const u = fresh();
  const dart = single(1);
  cam(u, dart);
  assert.equal(E.cameraDart(u.activeSession, dart), null);
  assert.deepEqual(u.activeSession.cam.darts, ["S1"]);
});

test("camera: nothing counts while paused", () => {
  const u = fresh();
  E.pauseResume(u.activeSession, T0 + 1);
  const r = cam(u, dbl(1));
  assert.match(r.message, /paused/);
  assert.equal(d(u, "D1").attempts, 0);
});

test("camera: the bull needs the bullseye", () => {
  const u = fresh();
  for (let i = 1; i <= 20; i += 1) log(u, { visits: [{ key: `D${i}`, hitDart: 1 }] });
  assert.equal(cur(u), "DBULL");
  cam(u, { seq: ++seq, label: "SB", x: 0.05, y: 0 });
  assert.equal(d(u, "DBULL").completed, false);
  cam(u, { seq: ++seq, label: "DB", x: 0, y: 0.01 });
  assert.deepEqual([d(u, "DBULL").completed, d(u, "DBULL").hitDart], [true, 2]);
  assert.ok(E.isFinished(u.activeSession));
});

test("camera: darts pulled out before 3 were seen count the unseen ones as misses", () => {
  const u = fresh();
  cam(u, single(1));
  const r = E.cameraTakeout(u.activeSession, { seq: ++seq, darts: 1 });
  E.applyChange(u, u.activeSession, r, T0 + 3000);
  assert.deepEqual([d(u, "D1").attempts, d(u, "D1").completed], [1, false]);
  assert.equal(cur(u), "D2");
  assert.equal(u.activeSession.cam.seen, 0);
});

test("camera: an unseen dart after a miss completes goes to the next double", () => {
  const u = fresh();
  cam(u, single(1));
  cam(u, dbl(1)); // D1 on dart 2; this visit's 3rd dart wasn't seen
  const r = E.cameraTakeout(u.activeSession, { seq: ++seq, darts: 2 });
  E.applyChange(u, u.activeSession, r, T0 + 3000);
  assert.equal(r.visits, undefined);
  assert.deepEqual(u.activeSession.cam.darts, ["MISS"]);
  assert.equal(u.activeSession.cam.at, "D2");
});

test("numberAt and doubleOf read darts the way the board is laid out", () => {
  assert.equal(E.numberAt(0, -0.5), "20");
  assert.equal(E.numberAt(0, 0.5), "3");
  assert.equal(E.numberAt(...Object.values(at(7, 1.2))), "7");
  assert.equal(E.numberAt(0, 0), "BULL");
  assert.equal(E.doubleOf("D16"), "D16");
  assert.equal(E.doubleOf("DB"), "DBULL");
  assert.equal(E.doubleOf("T16"), null);
});

test("old saved sessions read the same as new ones", () => {
  const old = { startedAt: T0, durationMs: 120000, dartsUsed: 77 };
  assert.deepEqual([E.sessionStart(old), E.sessionActive(old), E.sessionTotalDarts(old)], [T0, 120000, 77]);
  const u = fresh();
  log(u, E.planResult(u.activeSession, "hit3"));
  const p = E.historyPayload(u.activeSession, T0 + 5000);
  assert.equal(E.sessionTotalDarts({ perDouble: p.perDouble, startedAtMs: T0 }), 3);
  const heat = E.heatByDate([{ startedAtMs: T0, activeMs: 1000 }, { startedAtMs: T0 + 1, activeMs: 500 }]);
  assert.deepEqual(Object.values(heat)[0], { count: 2, totalActiveMs: 1500, bestActiveMs: 500 });
});
