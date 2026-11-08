// board-learn.js: reading the darts kept from play again with other settings, and choosing the
// settings that read the most of them right. The darts here come from the pretend camera rig
// (board-sim.cjs), so every dart's true score is known.
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../public/board-vision.js");
const S = require("./board-sim.cjs");
const L = require("../public/board-learn.js");

// Small cameras (640 x 360) keep it quick; ten darts, each with its pictures before and after.
let made = null;
function darts() {
  if (made) return made;
  const random = S.rng(11);
  const cams = [{ x: -170, y: -60, z: 420 }, { x: 170, y: -60, z: 420 }].map((pos) => S.camera({ pos, width: 640, height: 360, hfov: 78 }));
  const views = cams.map((cam) => V.makeView(S.tapCalibration(cam, 0.5, random), 640, 360));
  const renders = cams.map((cam, i) => S.renderer(cam, views[i], { noise: 3, seed: 12 + i, shadow: 0.95 }));
  const empty = renders.map((r) => r([]));
  const r2 = S.rng(5);
  made = [];
  for (let k = 0; k < 10; k += 1) {
    let x, y;
    do { x = (r2() * 2 - 1) * 150; y = (r2() * 2 - 1) * 150; } while (Math.hypot(x, y) > 150);
    const dart = { at: { x, y }, lean: { x: (r2() * 2 - 1) * 0.15, y: -0.1 - r2() * 0.3 }, spin: r2() * 3 };
    const after = renders.map((r) => r([dart]));
    made.push({ seq: k + 1, truth: V.classify(x / S.R, y / S.R, V.REAL).label, views, frames: views.map((v, i) => [empty[i].data, after[i].data]) });
  }
  return made;
}

test("the settings it tries are each one changed on its own, starting with the ones in use", () => {
  const base = Object.assign({}, L.BASE);
  const sets = L.variations(base);
  assert.deepEqual(sets[0], base);
  const tries = L.SEARCH.reduce((n, p) => n + p.values.filter((v) => v !== base[p.key]).length, 0);
  assert.equal(sets.length, 1 + tries);
  for (const o of sets.slice(1)) assert.equal(L.KEYS.filter((k) => o[k] !== base[k]).length, 1, "one setting at a time");
  assert.ok(L.variations(base, ["threshold"]).every((o) => o.threshold === base.threshold), "a setting can be left alone");
});

test("what was learned is only ever settings it would try", () => {
  assert.deepEqual(L.cleanLearned({ threshold: 26, cell: 0.004, endPenalty: 7, shadow: true, script: "x" }), { threshold: 26, cell: 0.004 });
  assert.deepEqual(L.cleanLearned(null), {});
});

test("a change is used only with enough darts, when it reads clearly more of them right", () => {
  assert.equal(L.better({ n: 9, right: 9, was: 4 }), false, "too few darts");
  assert.equal(L.better({ n: 40, right: 33, was: 33 }), false, "no better");
  assert.equal(L.better({ n: 40, right: 34, was: 33 }), true, "one more right of 40");
  assert.equal(L.better({ n: 200, right: 163, was: 160 }), false, "three more of 200 is not enough");
  assert.equal(L.better({ n: 200, right: 164, was: 160 }), true, "four more of 200");
  assert.equal(L.better(null), false);
});

test("reading the darts again: each option set's score", async () => {
  const samples = darts();
  const { right, n, wrong } = await L.scoreSets([Object.assign({}, L.BASE), Object.assign({}, L.BASE, { threshold: 120 })], samples);
  assert.equal(n, samples.length);
  assert.ok(right[0] >= 8, `the default settings read ${right[0]} of ${n} right`);
  assert.ok(right[1] < right[0], `a far too high change threshold reads fewer (${right[1]})`);
  assert.equal(wrong[0].length, n - right[0]);
});

test("from bad settings it learns better ones, from the darts it has kept", async () => {
  const samples = darts();
  const result = await L.learn({ threshold: 120 }, () => samples);
  assert.equal(result.n, samples.length);
  assert.ok(result.right > result.was, `reads ${result.right} right, ${result.was} before`);
  assert.ok(result.changed.includes("threshold"), "the change threshold is what changed: " + result.changed.join(", "));
  assert.ok(L.SEARCH[0].values.includes(result.options.threshold), "to a value it tries: " + result.options.threshold);
  assert.ok(L.better(result), "and it is worth using");
  // Already reading as well as it can: nothing to change.
  const again = await L.learn(result.options, () => samples);
  assert.equal(again.was, result.right);
  assert.ok(again.right >= again.was);
});
