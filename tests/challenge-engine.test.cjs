const assert = require("node:assert/strict");
const test = require("node:test");
const C = require("../public/challenge-engine.js");

const MISS = 0, S = 1, D = 2, T = 3;

test("57 darts: Shanghai 10-15, a dart at each double and the bull, Shanghai 15-20", () => {
  assert.equal(C.TOTAL_DARTS, 57);
  assert.deepEqual(C.STEPS.slice(0, 6).map((s) => s.target), [10, 11, 12, 13, 14, 15]);
  assert.deepEqual(C.STEPS.filter((s) => s.part === 2).map((s) => C.stepLabel(s)).slice(-2), ["D20", "Bull"]);
  assert.deepEqual(C.STEPS.slice(-6).map((s) => s.target), [15, 16, 17, 18, 19, 20]);
  // Best case: a Shanghai on every number and every double hit.
  assert.equal(C.MAX_SCORE, (6 * (10 + 11 + 12 + 13 + 14 + 15) + 600) + 21 * 50 + (6 * (15 + 16 + 17 + 18 + 19 + 20) + 600));
  assert.equal(C.MAX_SCORE, 3330);
});

test("a visit scores the number times the ring, plus 100 for single, double and treble together", () => {
  const twelve = C.STEPS[2];
  assert.equal(C.stepScore(twelve, [S, MISS, T]), 48);
  assert.equal(C.stepScore(twelve, [T, T, T]), 108);
  assert.equal(C.stepScore(twelve, [D, S, T]), 72 + 100, "any order is a Shanghai");
  assert.equal(C.stepScore(twelve, [MISS, MISS, MISS]), 0);
  const d16 = C.STEPS.find((s) => s.kind === "double" && s.target === 16);
  assert.equal(C.stepScore(d16, [1]), 50);
  assert.equal(C.stepScore(d16, [0]), 0);
});

test("darts go in order and can't score what the target doesn't allow", () => {
  let darts = [];
  assert.equal(C.position(darts).step.target, 10);
  for (let i = 0; i < 18; i++) darts = C.addDart(darts, S);
  const p = C.position(darts);
  assert.deepEqual([p.step.kind, p.step.target, p.dartInStep], ["double", 1, 0]);
  assert.throws(() => C.addDart(darts, T), /can't score/);
  for (let i = 0; i < 21; i++) darts = C.addDart(darts, i % 2);
  for (let i = 0; i < 18; i++) darts = C.addDart(darts, MISS);
  assert.equal(C.position(darts), null);
  assert.throws(() => C.addDart(darts, S), /finished/);
});

test("a round's summary and the record saved for it", () => {
  const darts = [
    ...[S, D, T], ...Array(15).fill(MISS), // Shanghai on 10, then nothing in part 1
    ...Array(21).fill(0).map((_, i) => (i < 7 ? 1 : 0)), // D1-D7 hit
    ...Array(17).fill(MISS), T, // a treble 20 with the last dart
  ];
  const s = C.summarize(darts);
  assert.deepEqual([s.part1, s.part2, s.part3, s.total], [160, 350, 60, 570]);
  assert.deepEqual([s.shanghais, s.trebles, s.doublesHit, s.finished], [1, 2, 7, true]);
  assert.deepEqual(C.runningTotals(darts).slice(0, 2), [160, 160]);
  const rec = C.record("u1", darts, { timestamp: "2026-10-05 20:00", durationSec: 612.4 });
  assert.equal(rec.total, 570);
  assert.equal(rec.darts.length, 57);
  assert.equal(rec.durationSec, 612);
  assert.throws(() => C.record("u1", darts.slice(0, 10), {}), /finished/);
});

test("progress: best, averages, and which doubles let you down", () => {
  const game = (timestamp, doublesHit) => {
    const darts = [...Array(18).fill(S), ...Array(21).fill(0).map((_, i) => (i < doublesHit ? 1 : 0)), ...Array(18).fill(S)];
    return { timestamp, darts, ...C.summarize(darts) };
  };
  const games = [game("2026-10-03 19:00", 10), game("2026-10-01 19:00", 2), game("2026-10-05 19:00", 21)];
  const p = C.progress(games);
  assert.equal(p.games, 3);
  assert.deepEqual(p.totals, [games[1].total, games[0].total, games[2].total], "oldest first");
  assert.equal(p.best, games[2].total);
  assert.equal(p.last, games[2].total);
  assert.equal(p.doubles[0].rate, 1, "D1 hit every time");
  assert.equal(p.doubles.find((d) => d.label === "Bull").rate, 1 / 3);
  assert.deepEqual(p.weakest.map((d) => d.label), ["D11", "D12", "D13"]);
  assert.equal(C.progress([]).best, null);
});

test("bug 3: pace compares whole visits only, never the darts of the visit you are in", () => {

  // Your best: 10 scored 30 (three singles), 11 scored 33.
  const best = [1, 1, 1, 1, 1, 1];
  // Now: 10 scored 30 too, then one treble at 11 (33 so far in the visit).
  const now = [1, 1, 1, 3];
  const p = C.pace(now, best);
  assert.deepEqual(p, { diff: 0, steps: 1, total: 30, other: 30 }, "level after 10: the 11 visit isn't finished");
  assert.equal(C.pace([1, 1], best), null, "nothing to compare before the first visit is done");
  assert.equal(C.pace(now, null), null);
  assert.equal(C.pace([1, 1, 1, 3, 3, 3], best).diff, 99 - 33);
});

// ---- Phase 5: a round shared between devices, the cameras' visits, fixing, undo, the voice ---------
const R = () => C.newRound("jdcTest", 1);
const ev = (seq, l) => ({ seq, l, x: 0.1, y: -0.5 });

test("every visit is 3 darts: the same number, or three doubles in order", () => {
  assert.equal(C.VISITS, 19);
  assert.equal(C.visitOf(17), 5);
  assert.equal(C.stepAt(17).target, 15);
  assert.deepEqual(C.visitInfo(Array(21).fill(1), 6).steps.map((s) => s.target), [1, 2, 3]);
  assert.deepEqual(C.visitInfo(Array(39).fill(0), 12).steps.map((s) => s.target), [19, 20, C.BULL]);
  assert.equal(C.stepAt(57), null);
});

test("camera darts go to their own target; the bull is the bullseye only", () => {
  const r = R();
  C.camDart(r, ev(1, "T10")); C.camDart(r, ev(2, "S11")); C.camDart(r, ev(3, "D10"));
  assert.deepEqual(r.darts, [3, 0, 2], "a dart in the 11 is a miss at 10");
  assert.equal(C.valueAt(18 + 20, "DB"), 1);
  assert.equal(C.valueAt(18 + 20, "SB"), 0, "the outer bull doesn't count");
  assert.equal(C.valueAt(18 + 6, "D7"), 1);
  assert.equal(C.valueAt(18 + 6, "D8"), 0);
});

test("a 4th dart before the pull-out isn't counted, so later targets never shift", () => {
  const r = R();
  ["S10", "S10", "S10"].forEach((l, i) => C.camDart(r, ev(i + 1, l)));
  const late = C.camDart(r, ev(4, "T11"));
  assert.ok(late.late);
  assert.equal(r.darts.length, 3);
  C.camTakeout(r, { seq: 5 });
  C.camDart(r, ev(6, "T11"));
  assert.deepEqual(r.darts, [1, 1, 1, 3]);
});

test("the pull-out: darts not seen are misses at that visit only", () => {
  const r = R();
  C.camDart(r, ev(1, "T10"));
  const out = C.camTakeout(r, { seq: 2 });
  assert.equal(out.unseen, 2);
  assert.deepEqual(r.darts, [3, 0, 0]);
  assert.deepEqual(r.meta.map((m) => m.src), ["cam", "unseen", "unseen"]);
  assert.equal(r.cam, null);
  assert.deepEqual(C.camTakeout(r, { seq: 3 }), { went: [], unseen: 0 }, "a second pull-out does nothing");
});

test("a dart the cameras couldn't read waits for a tap, and the darts after it wait behind it", () => {
  const r = C.newRound("d", 1);
  r.darts = Array(18).fill(0); r.meta = r.darts.map(() => ({ src: "key" })); // on to D1, D2, D3
  C.camUnread(r, { seq: 1 });
  C.camDart(r, ev(2, "D2"));
  assert.equal(r.darts.length, 18, "D2 waits behind the dart at D1");
  C.keyDart(r, 1); // the dart they couldn't read was a hit on D1
  assert.deepEqual(r.darts.slice(18), [1, 1], "D1 hit, then D2 hit: each at its own double");
  C.camUnread(r, { seq: 3 });
  C.camTakeout(r, { seq: 4 });
  assert.deepEqual(r.darts.slice(18), [1, 1, 0], "never tapped: a miss at the pull-out");
  assert.equal(r.meta[20].src, "unread");
});

test("3 misses, fixing a dart and a 10-step undo", () => {
  const r = R();
  C.keyDart(r, 3);
  C.threeMisses(r);
  assert.deepEqual(r.darts, [3, 0, 0]);
  const f = C.fixDart(r, 1, 2);
  assert.equal(f.was, 0);
  assert.deepEqual(r.darts, [3, 2, 0]);
  assert.equal(r.meta[1].f, 1);
  assert.equal(C.fixDart(r, 1, 2), null, "the same value: nothing to fix");
  assert.equal(C.fixDart(r, 18, 1), null, "no dart there yet");
  assert.ok(C.undoStep(r)); assert.deepEqual(r.darts, [3, 0, 0]);
  assert.ok(C.undoStep(r)); assert.deepEqual(r.darts, [3]);
  for (let k = 0; k < 15; k += 1) C.keyDart(r, 1);
  assert.equal(C.undoCount(r), 10, "undo keeps the last 10 steps");
});

test("Board mode: the dart boxes, the Shanghai so far, the most still possible", () => {
  const r = R();
  C.camDart(r, ev(1, "T10")); C.camDart(r, ev(2, "S2"));
  assert.deepEqual(C.dartBox(0, r.darts[0], r.meta[0]), { read: "T10", sub: "30", kind: "hit" });
  assert.deepEqual(C.dartBox(1, r.darts[1], r.meta[1]), { read: "Miss", sub: "In the 2", kind: "miss" });
  assert.equal(C.shanghaiNote([3]), "T ✓ · need the S and D for +100");
  assert.equal(C.shanghaiNote([3, 2]), "D ✓ T ✓ · need the S for +100");
  assert.equal(C.shanghaiNote([3, 0]), "", "a miss: no Shanghai left");
  assert.equal(C.mostPossible([]), C.MAX_SCORE);
  assert.equal(C.mostPossible([0, 0, 0]), C.MAX_SCORE - C.stepMax(C.STEPS[0]));
  const d = C.dartBox(18, 1, { src: "cam", l: "D1" });
  assert.deepEqual(d, { read: "D1", sub: "+50", kind: "hit" });
});

test("the voice: each dart, the visit with its score and against your best, a Shanghai", () => {
  const best = Array(57).fill(1).map((v, i) => (C.stepAt(i).kind === "double" ? 0 : 1));
  assert.equal(C.voiceLine([3], { k: "dart", index: 0 }, best), "Treble.");
  assert.equal(C.voiceLine([3, 1, 0], { k: "dart", index: 2 }, best), "10: treble, single, miss. 40. 10 ahead of your best.");
  assert.equal(C.voiceLine([3, 1, 2], { k: "dart", index: 2 }, best), "SHANGHAI! 160.");
  const dbl = Array(18).fill(0).concat([1, 0, 0]);
  assert.equal(C.voiceLine(dbl, { k: "dart", index: 20 }, null), "D 1, D 2, D 3: hit, miss, miss. 50.");
  assert.equal(C.voiceLine([3, 1, 0], { k: "fix", index: 1 }, best), "Fixed: single.");
});
