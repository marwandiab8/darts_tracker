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

test("camera: after a hit on dart 2, darts out with the 3rd unthrown: nothing more counts, D2 starts fresh", () => {
  const u = fresh();
  cam(u, single(1));
  cam(u, dbl(1)); // D1 on dart 2; the 3rd dart isn't thrown
  const r = E.cameraTakeout(u.activeSession, { seq: ++seq, darts: 2 });
  E.applyChange(u, u.activeSession, r, T0 + 3000);
  assert.equal(r.visits, undefined);
  assert.equal(r.unseen, 0);
  assert.equal(d(u, "D2").attempts, 0);
  assert.deepEqual(u.activeSession.cam.darts, []);
  assert.equal(u.activeSession.cam.over, null);
});

// Nov 12: the game's visits 5 and 6. D7 went in on dart 2 and the 3rd dart (thrown at D8) was
// counted as D8's dart 1, so D8 only had 2 darts the next visit. Each visit is one try now.
test("camera: a hit on dart 1 or 2 ends the visit's try; its other darts don't count, and the next double gets 3", () => {
  const u = fresh();
  for (let i = 0; i < 6; i += 1) log(u, E.planResult(u.activeSession, "hit1")); // at D7
  const a = cam(u, single(16));
  const b = cam(u, dbl(7));
  assert.equal(b.effect.kind, "hit");
  assert.equal(d(u, "D7").hitDart, 2);
  assert.equal(u.activeSession.cam.over, "D7");
  const c = cam(u, outside(8)); // the 3rd dart: not counted
  assert.equal(c.effect.kind, "spare");
  assert.equal(c.visits, undefined);
  assert.equal(d(u, "D8").attempts, 0);
  assert.equal(cur(u), "D8");
  E.applyChange(u, u.activeSession, E.cameraTakeout(u.activeSession, { seq: ++seq, darts: 3 }), T0 + 3000);
  // Next visit: three darts at D8, a miss only after the 3rd.
  cam(u, single(8));
  assert.equal(cur(u), "D8");
  cam(u, outside(8));
  assert.equal(cur(u), "D8");
  assert.equal(d(u, "D8").attempts, 0);
  cam(u, single(8));
  assert.equal(d(u, "D8").attempts, 1);
  assert.equal(cur(u), "D9");
  assert.ok(a);
});

test("camera: a hit on dart 1, the take-out missed: the 4th dart starts the next visit", () => {
  const u = fresh();
  cam(u, dbl(1));
  cam(u, single(2)); // spare
  cam(u, single(2)); // spare
  assert.equal(d(u, "D2").attempts, 0);
  const r = cam(u, dbl(2)); // no take-out was seen: a new visit, dart 1 at D2
  assert.equal(r.effect.kind, "hit");
  assert.equal(r.effect.n, 1);
  assert.equal(d(u, "D2").hitDart, 1);
});

test("camera: darts out after 2 misses at a double: the unseen 3rd is a miss there", () => {
  const u = fresh();
  cam(u, single(1)); cam(u, outside(1));
  const r = E.cameraTakeout(u.activeSession, { seq: ++seq, darts: 2 });
  assert.equal(r.unseen, 1);
  E.applyChange(u, u.activeSession, r, T0 + 3000);
  assert.equal(d(u, "D1").attempts, 1);
  assert.equal(cur(u), "D2");
  assert.equal(d(u, "D2").attempts, 0);
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

// ---- Board mode ----------------------------------------------------------------------------------
// Darts the way the page enters them: recordDart / recordTakeout, each record onto the undo steps.
function bm(u, dart, now = T0 + 3000) {
  const out = E.recordDart(u, u.activeSession, dart, now);
  if (out && out.record) E.pushUndo(u, out.record, String(++seq));
  return out;
}
function bmOut(u, darts, now = T0 + 3500) {
  const out = E.recordTakeout(u, u.activeSession, { seq: ++seq, darts }, now);
  if (out && out.record) E.pushUndo(u, out.record, String(++seq));
  return out;
}
const visit = (u) => u.activeSession.cam.visit;
const fixWith = (u, i, label, now = T0 + 4000) => {
  const v = visit(u);
  const out = E.fixDart(u, u.activeSession, i, v.darts[i].s, Object.assign({ label }, E.spot(label)), now);
  if (out.record && out.changed) E.pushUndo(u, out.record, String(++seq));
  return out;
};

test("board: camera darts say what they counted as, and make up the visit on the board", () => {
  const u = fresh();
  const a = bm(u, single(1));
  assert.deepEqual(a.change.effect, { kind: "miss", key: "D1", n: 1 });
  const b = bm(u, dbl(1));
  assert.deepEqual(b.change.effect, { kind: "hit", key: "D1", n: 2 });
  bm(u, single(2)); // after the hit: not counted
  assert.equal(visit(u).darts.length, 3);
  assert.deepEqual(visit(u).darts.map((x) => x.e.kind), ["miss", "hit", "spare"]);
  assert.equal(u.activeSession.throws.length, 3);
  assert.deepEqual(u.activeSession.throws.map((t) => t.k), ["D1", "D1", null]);
  assert.equal(d(u, "D2").attempts, 0);
  const v = E.boardView(u.activeSession);
  assert.equal(v.darts[2].sub, "Not counted: D1 went in");
  assert.equal(v.pullOut, false); // the visit's 3 darts are in: no more to pull out early
  // A 4th dart without a take-out starts the next visit; so does a dart after a take-out.
  bm(u, single(2));
  assert.equal(visit(u).darts.length, 1);
  assert.equal(visit(u).n, 2);
  bmOut(u, 1);
  bm(u, dbl(2));
  assert.equal(visit(u).n, 3);
});

test("board: fixing a missed dart to a hit scores the visit again, and Undo takes the fix back", () => {
  const u = fresh();
  bm(u, single(1)); bm(u, outside(1));
  assert.equal(cur(u), "D1");
  const f = fixWith(u, 1, "D1");
  assert.ok(f.changed);
  assert.equal(d(u, "D1").completed, true);
  assert.equal(d(u, "D1").hitDart, 2);
  assert.equal(life(u, "D1").hits2, 1);
  assert.equal(cur(u), "D2");
  assert.deepEqual(visit(u).darts.map((x) => x.e.kind), ["miss", "hit"]);
  assert.equal(u.activeSession.throws[1].l, "D1");
  assert.equal(u.activeSession.throws[1].f, 1);
  const r = E.undoStep(u, T0 + 5000);
  assert.ok(!r.error, r.error);
  assert.equal(d(u, "D1").completed, false);
  assert.equal(life(u, "D1").hits, 0);
  assert.equal(cur(u), "D1");
});

test("board: fixing the 3rd dart of a missed visit to a hit takes the miss back", () => {
  const u = fresh();
  bm(u, single(1)); bm(u, single(1)); bm(u, outside(1));
  assert.equal(cur(u), "D2");
  assert.equal(d(u, "D1").attempts, 1);
  fixWith(u, 2, "D1");
  assert.equal(d(u, "D1").attempts, 1);
  assert.equal(d(u, "D1").completed, true);
  assert.equal(d(u, "D1").hitDart, 3);
  assert.equal(life(u, "D1").attempts, 1);
  assert.equal(life(u, "D1").hits3, 1);
  assert.equal(cur(u), "D2");
});

test("board: fixing a hit to a miss, and removing a dart that wasn't one", () => {
  const u = fresh();
  bm(u, dbl(1));
  assert.equal(cur(u), "D2");
  fixWith(u, 0, "O1");
  assert.equal(d(u, "D1").completed, false);
  assert.equal(d(u, "D1").attempts, 0);
  assert.equal(cur(u), "D1");
  assert.equal(u.activeSession.cam.darts.length, 1);
  const v = visit(u);
  const out = E.fixDart(u, u.activeSession, 0, v.darts[0].s, { remove: true }, T0 + 4100);
  assert.ok(!out.error);
  assert.equal(visit(u).darts.length, 0);
  assert.equal(u.activeSession.cam.darts.length, 0);
  assert.equal(u.activeSession.throws.length, 0);
});

test("board: a fixed visit that was pulled out keeps its unseen misses", () => {
  const u = fresh();
  bm(u, single(1));
  bm(u, single(1));
  bmOut(u, 2); // the 3rd dart wasn't seen: D1 missed
  assert.equal(visit(u).out.unseen, 1);
  assert.equal(d(u, "D1").attempts, 1);
  assert.equal(cur(u), "D2");
  fixWith(u, 1, "D1"); // the 2nd was really in D1: a hit on dart 2, and the unseen dart doesn't count
  assert.equal(d(u, "D1").completed, true);
  assert.equal(d(u, "D1").hitDart, 2);
  assert.equal(d(u, "D1").attempts, 1);
  assert.equal(visit(u).out.unseen, 0); // the try ended with the hit: the unseen dart doesn't count now
  assert.equal(cur(u), "D2");
  assert.equal(d(u, "D2").attempts, 0);
});

test("board: after a hit on dart 1 the board says to pull the darts out, and a spare dart can only be removed", () => {
  const u = fresh();
  bm(u, dbl(1));
  const v = E.boardView(u.activeSession);
  assert.equal(v.target, "D2");
  assert.equal(v.pullOut, true);
  assert.equal(v.visitDone, true);
  assert.equal(v.dartNo, 1);
  bm(u, single(2));
  const w = E.boardView(u.activeSession);
  assert.equal(w.darts[1].kind, "spare");
  bmOut(u, 2);
  const x = E.boardView(u.activeSession);
  assert.equal(x.pullOut, false);
  assert.equal(x.dartNo, 1);
  bm(u, single(2));
  assert.equal(E.boardView(u.activeSession).dartNo, 2);
});

test("board: a tap on the buttons, Undo or a new visit ends the old visit's fixes", () => {
  const u = fresh();
  bm(u, single(1));
  const s1 = visit(u).darts[0].s;
  bmOut(u, 1);
  bm(u, single(1)); // a new visit
  assert.ok(E.fixDart(u, u.activeSession, 0, s1, { label: "D1" }, T0 + 4000).error);
  const err = E.fixDart(u, u.activeSession, 5, 0, { label: "D1" }, T0 + 4000);
  assert.ok(err.error);
});

test("board: a fix can be a stay: the dart after a miss in that double", () => {
  const u = fresh();
  bm(u, single(1)); bm(u, single(1)); bm(u, single(1)); // D1 missed, now D2
  bmOut(u, 3);
  bm(u, single(1)); // a 4th dart in the 1: stay
  assert.equal(visit(u).darts[0].e.kind, "stay");
  fixWith(u, 0, "D1"); // it was in D1: stayed, hit on dart 4
  assert.equal(d(u, "D1").completed, true);
  assert.equal(d(u, "D1").attempts, 2);
  assert.equal(d(u, "D1").extraDarts, 1);
  assert.equal(visit(u).darts[0].e.kind, "stayhit");
  assert.equal(visit(u).darts[0].e.n, 4);
});

test("board: undo goes back up to 10 steps, newest first", () => {
  const u = fresh();
  for (let i = 0; i < 12; i += 1) {
    const rec = log(u, E.planResult(u.activeSession, i % 2 ? "miss" : "hit1"));
    E.pushUndo(u, rec, "r" + i);
  }
  assert.equal(E.undoCount(u), 10);
  const at0 = E.sessionDarts(u.activeSession.doubles);
  for (let i = 0; i < 10; i += 1) assert.ok(!E.undoStep(u, T0 + 9000).error);
  assert.ok(E.undoStep(u, T0 + 9000).error);
  assert.ok(E.sessionDarts(u.activeSession.doubles) < at0);
  // The first two steps stay: 1 hit (D1) and 1 miss (D2).
  assert.equal(d(u, "D1").completed, true);
  assert.equal(d(u, "D2").attempts, 1);
  assert.equal(u.lastUndo, null);
});

test("board: a step written by an older page (lastUndo only) is the one Undo takes back", () => {
  const u = fresh();
  E.pushUndo(u, log(u, E.planResult(u.activeSession, "hit1")), "a");
  E.pushUndo(u, log(u, E.planResult(u.activeSession, "hit1")), "b");
  // An older page logs a miss at D3 and writes only lastUndo.
  u.lastUndo = log(u, E.planResult(u.activeSession, "miss"));
  assert.equal(E.undoCount(u), 1);
  assert.ok(!E.undoStep(u, T0 + 9000).error);
  assert.equal(d(u, "D3").attempts, 0);
  assert.equal(E.undoCount(u), 0);
});

test("board: the voice says the hit and its dart, a miss, the next double, and the end", () => {
  const u = fresh();
  const s0 = E.clone(u.activeSession);
  assert.equal(E.voiceLine(null, s0), "Throw at D 1.");
  let before = E.clone(u.activeSession);
  log(u, E.planResult(u.activeSession, "hit3"));
  assert.equal(E.voiceLine(before, u.activeSession), "D 1, dart 3. D 2.");
  before = E.clone(u.activeSession);
  log(u, E.planResult(u.activeSession, "miss"));
  assert.equal(E.voiceLine(before, u.activeSession), "Missed D 2. D 3.");
  before = E.clone(u.activeSession);
  log(u, E.planStay(u.activeSession, "hit:7"));
  assert.equal(E.voiceLine(before, u.activeSession), "D 3, dart 7. D 4.");
  // Nothing new thrown: nothing said.
  assert.equal(E.voiceLine(E.clone(u.activeSession), u.activeSession), null);
  // A stay hit from the cameras counts every dart at the double.
  const v = fresh();
  bm(v, single(1)); bm(v, single(1)); bm(v, single(1)); bm(v, single(1)); bm(v, single(1));
  before = E.clone(v.activeSession);
  const out = bm(v, dbl(1));
  assert.equal(E.voiceLine(before, v.activeSession, out.change.effect), "D 1, dart 6. D 2.");
  // The last double.
  const w = fresh();
  for (let i = 0; i < 20; i += 1) log(w, E.planResult(w.activeSession, "hit1"));
  before = E.clone(w.activeSession);
  log(w, E.planResult(w.activeSession, "hit2"), T0 + 61000);
  assert.match(E.voiceLine(before, w.activeSession), /^the bull, dart 2\. All 21 done\. 22 darts in 1 minute/);
});

test("board: the view has the target, the next three, the visit's darts in words, and the 21 doubles", () => {
  const u = fresh();
  log(u, E.planResult(u.activeSession, "miss")); // D1 missed
  bm(u, outside(2));
  bm(u, single(17)); // next door to the 2
  const v = E.boardView(u.activeSession);
  assert.equal(v.target, "D2");
  assert.deepEqual(v.next, ["D3", "D4", "D5"]);
  assert.equal(v.dartNo, 3);
  assert.deepEqual(v.darts.map((x) => [x.read, x.sub, x.kind]), [["Outside", "Just past the D2 wire", "miss"], ["S17", "Next door, in the 17", "miss"]]);
  assert.equal(v.cells[0].state, "open");
  assert.equal(v.cells[0].sub, "×1");
  assert.equal(v.cells[1].state, "current");
  assert.equal(v.note, "D1 comes back after the bull");
  bm(u, dbl(2));
  const w = E.boardView(u.activeSession);
  assert.equal(w.target, "D3");
  assert.equal(w.darts[2].sub, "Hit on dart 3");
  assert.equal(w.cells[1].sub, "3rd");
  assert.equal(w.visitDone, true);
});

test("board: spot puts a fixed dart in the right bed, and the saved round keeps the throws", () => {
  for (const [label, want] of [["D7", "D7"], ["S16", "S16"], ["T20", "T20"]]) {
    const p = E.spot(label);
    assert.equal(E.numberAt(p.x, p.y), want.slice(1));
  }
  const o = E.spot("O7");
  assert.ok(Math.hypot(o.x, o.y) > 1);
  assert.equal(E.numberAt(o.x, o.y), "7");
  assert.equal(E.numberAt(E.spot("DB").x, E.spot("DB").y), "BULL");
  const u = fresh();
  bm(u, single(1));
  const p = E.historyPayload(u.activeSession, T0 + 9000);
  assert.equal(p.throws.length, 1);
  assert.equal(p.throws[0].k, "D1");
  assert.equal(E.historyPayload(fresh().activeSession, T0).throws, undefined);
});

test("board: undo records leave the visit (and its snapshot) out, so they stay small", () => {
  const u = fresh();
  bm(u, single(1)); bm(u, single(1));
  const out = bm(u, single(1));
  assert.ok(out.record);
  assert.equal(out.record.prevCam.visit, undefined);
  assert.ok(JSON.stringify(u.undoStack).length < 2000);
});
