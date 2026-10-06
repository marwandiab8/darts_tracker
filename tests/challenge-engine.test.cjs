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
