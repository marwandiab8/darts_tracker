// Checks for board-vision.js (reading darts from cameras), using the pretend camera rig in
// board-sim.cjs: it draws what two webcams beside a board would see, so every dart's true spot is
// known. Run with `node --test tests/board-vision.test.cjs` (part of `npm test`).
const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../public/board-vision.js");
const S = require("./board-sim.cjs");
const E = require("../public/practice-engine.js");

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (±${tol})`);

test("real board sizes turn into app positions that score the same", () => {
  const random = S.rng(1);
  for (let i = 0; i < 20000; i += 1) {
    const p = { x: random() * 2.2 - 1.1, y: random() * 2.2 - 1.1 };
    const real = V.classify(p.x, p.y, V.REAL).label;
    const app = V.realToApp(p);
    assert.equal(E.classify(app.x, app.y).label, real, `at ${p.x},${p.y}`);
    const back = V.appToReal(app);
    near(back.x, p.x, 1e-9, "x round trip");
    near(back.y, p.y, 1e-9, "y round trip");
  }
  // The middle of the real treble is in the app's treble.
  const t20 = V.realToApp({ x: 0, y: -103 / 170 });
  assert.equal(E.classify(t20.x, t20.y).label, "T20");
});

test("the calibration points are where the wires meet the double ring", () => {
  const top = V.CAL_POINTS[0];
  near(Math.atan2(top.y, top.x) * (180 / Math.PI), -81, 1e-9, "20/1 angle");
  // Just either side of each point along the ring is one of its two numbers, in the double.
  for (const [i, pair] of [[0, ["20", "1"]], [1, ["6", "10"]], [2, ["3", "19"]], [3, ["11", "14"]]]) {
    const p = V.CAL_POINTS[i], a = Math.atan2(p.y, p.x), r = 0.97;
    const sides = [a - 0.02, a + 0.02].map((b) => V.classify(Math.cos(b) * r, Math.sin(b) * r).label).sort();
    assert.deepEqual(sides, pair.map((n) => "D" + n).sort());
  }
  assert.deepEqual([V.CAL_POINTS[4].x, V.CAL_POINTS[4].y], [0, 0]);
});

test("a homography from four or more points maps them exactly, and back", () => {
  const H0 = [1.3, 0.2, -40, -0.1, 1.1, 25, 0.0004, -0.0002, 1];
  const src = [{ x: 10, y: 20 }, { x: 600, y: 40 }, { x: 580, y: 450 }, { x: 30, y: 400 }, { x: 300, y: 230 }];
  const dst = src.map((p) => V.applyH(H0, p.x, p.y));
  for (const n of [4, 5]) {
    const H = V.homography(src.slice(0, n), dst.slice(0, n));
    for (const p of src) {
      const q = V.applyH(H, p.x, p.y), r = V.applyH(H0, p.x, p.y);
      near(q.x, r.x, 1e-6, "x");
      near(q.y, r.y, 1e-6, "y");
    }
    const back = V.applyH(V.inv3(H), dst[2].x, dst[2].y);
    near(back.x, src[2].x, 1e-6, "inverse x");
  }
  // Three in a line cannot define one.
  assert.equal(V.homography([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 3 }], dst.slice(0, 4)), null);
});

test("calibrating from tapped points, and spotting a mistap", () => {
  const cam = S.camera({ pos: { x: -170, y: -60, z: 420 }, width: 1280, height: 720, hfov: 78 });
  const good = S.tapCalibration(cam, 1, S.rng(2));
  assert.ok(good.error < 1.5, `error ${good.error} mm`);
  // The bull tapped 15 px off shows up as a large fit error.
  const taps = good.points.map((p) => ({ ...p }));
  taps[4].x += 15;
  assert.ok(V.calibrate(taps, 1280, 720).error > 3);
  // Where the camera is comes out of the calibration (in board radii).
  const pose = V.cameraPose(good.H, 1280, 720);
  near(pose.x * 170, -170, 15, "camera x mm");
  near(pose.y * 170, -60, 15, "camera y mm");
  near(pose.height * 170, 420, 25, "camera height mm");
});

test("a view crops the picture to the board and maps its pixels onto the board", () => {
  const cam = S.camera({ pos: { x: 170, y: -60, z: 420 }, width: 1280, height: 720, hfov: 78 });
  const cal = S.tapCalibration(cam, 0, S.rng(3));
  const view = V.makeView(cal, 1280, 720);
  assert.ok(view.width <= 640 && view.height <= 640);
  assert.ok(view.pxPerR > 200, `pxPerR ${view.pxPerR}`);
  // The bull is the bull from either side.
  const c = view.toCrop(0, 0), b = view.toBoard(c.x, c.y);
  near(b.x, 0, 1e-9, "x");
  near(b.y, 0, 1e-9, "y");
  // A camera running at half size uses the same calibration.
  const half = V.makeView(cal, 640, 360);
  const p = half.toCrop(0.5, 0.2), q = half.toBoard(p.x, p.y);
  near(q.x, 0.5, 1e-9, "half-size x");
  // With a lens bend too, both ways agree, and the bull is where the camera shows it.
  const bentCam = S.camera({ pos: { x: 170, y: -60, z: 420 }, width: 1280, height: 720, hfov: 78, bend: -0.12 });
  const bentCal = Object.assign({}, cal, { lens: { cx: 640, cy: 360, s: Math.hypot(1280, 720) / 2, k: -0.12 } });
  const bv = V.makeView(bentCal, 1280, 720);
  for (const [x, y] of [[0, 0], [0.6, -0.3], [-0.9, 0.4]]) {
    const at = bv.toCrop(x, y), back = bv.toBoard(at.x, at.y);
    near(back.x, x, 1e-9, "bent x"); near(back.y, y, 1e-9, "bent y");
  }
  // Away from the middle of the picture, the bend moves things, and the lens model says where to.
  const edge = { x: 170, y: 0, z: 0 }, bentAt = bentCam.project(edge), plainAt = cam.project(edge);
  assert.ok(Math.hypot(bentAt.x - plainAt.x, bentAt.y - plainAt.y) > 3, "the bend moves the board's edge in the picture");
  const modelled = V.distort(bentCal.lens, plainAt.x, plainAt.y);
  near(modelled.x, bentAt.x, 1e-6, "bent edge x"); near(modelled.y, bentAt.y, 1e-6, "bent edge y");
  for (const [x, y] of [[0.3, 0.2], [-1, 0.1]]) {
    const u = V.undistort(bentCal.lens, 300 + x * 400, 200 + y * 300);
    const d = V.distort(bentCal.lens, u.x, u.y);
    near(d.x, 300 + x * 400, 1e-9, "undistort then distort x");
    near(d.y, 200 + y * 300, 1e-9, "undistort then distort y");
  }
});

// A board drawn as a whole camera picture, for matching the board in it.
function stillOf(cam, darts = [], options = {}) {
  const full = { crop: { sx: 0, sy: 0, sw: cam.width, sh: cam.height }, width: cam.width, height: cam.height };
  return S.renderer(cam, full, Object.assign({ noise: 3, seed: 5, smooth: 3 }, options))(darts);
}

// How far, at worst, a calibration puts the rings and wires from where the camera really shows them (mm).
function worstOff(cam, cal) {
  const m = V.mapper(cal);
  let worst = 0;
  for (const r of [V.REAL.bullOut, 0.35, V.REAL.tripleIn, V.REAL.tripleOut, 0.8, V.REAL.doubleIn, 1]) {
    for (let k = 0; k < 60; k += 1) {
      const a = (k / 60) * Math.PI * 2, p = cam.project({ x: Math.cos(a) * r * S.R, y: Math.sin(a) * r * S.R, z: 0 });
      const b = m.toBoard(p.x, p.y);
      worst = Math.max(worst, Math.hypot(b.x - Math.cos(a) * r, b.y - Math.sin(a) * r) * S.R);
    }
  }
  return worst;
}

test("calibrating snaps to the board's rings and wires, and measures the lens's bend", () => {
  for (const bend of [0, -0.15]) {
    const cam = S.camera({ pos: { x: -190, y: -70, z: 380 }, width: 1280, height: 720, hfov: 84, bend });
    const tapped = S.tapCalibration(cam, 4, S.rng(7));
    const still = stillOf(cam);
    const snapped = V.refineCalibration(tapped, still);
    assert.ok(snapped, `bend ${bend}: matched`);
    assert.ok(snapped.refined.edges > 300, `bend ${bend}: ${snapped.refined.edges} edges`);
    const before = worstOff(cam, tapped), after = worstOff(cam, snapped);
    assert.ok(before > 1.5, `bend ${bend}: taps alone off by ${before.toFixed(2)} mm`);
    assert.ok(after < 0.6, `bend ${bend}: snapped off by ${after.toFixed(2)} mm`);
    near(snapped.refined.shift, before, 0.6, `bend ${bend}: shift reports how far the taps were off`);
    near(snapped.lens ? snapped.lens.k : 0, bend, 0.04, `bend ${bend}: the lens's bend`);
  }
});

test("matching the board copes with darts in it, and with a camera that moved", () => {
  const cam = S.camera({ pos: { x: 175, y: -55, z: 400 }, width: 1280, height: 720, hfov: 80, bend: -0.1 });
  const darts = [{ at: { x: 6, y: -101 }, lean: { x: 0.05, y: -0.25 } }, { at: { x: -12, y: -98 }, lean: { x: -0.1, y: -0.2 } }, { at: { x: 40, y: 60 }, lean: { x: 0.1, y: -0.3 } }];
  const snapped = V.refineCalibration(S.tapCalibration(cam, 3, S.rng(9)), stillOf(cam, darts));
  assert.ok(snapped && worstOff(cam, snapped) < 0.8, "with three darts in the board");
  // The camera gets knocked a little: checked against what it shows now, the saved calibration
  // follows it (without trusting the old taps), and says how far it moved.
  const moved = S.camera({ pos: { x: 181, y: -50, z: 396 }, look: { x: 4, y: 3, z: 0 }, width: 1280, height: 720, hfov: 80, bend: -0.1 });
  const before = worstOff(moved, snapped);
  const again = V.refineCalibration(snapped, stillOf(moved), { taps: false });
  assert.ok(before > 3, `the knock moved the rings ${before.toFixed(1)} mm`);
  assert.ok(again && worstOff(moved, again) < 0.6, "followed the camera");
  near(again.refined.shift, before, 0.8, "how far it moved");
  // Nothing to match in a blank picture.
  const blank = { data: new Uint8ClampedArray(1280 * 720 * 4).fill(40), width: 1280, height: 720 };
  assert.equal(V.refineCalibration(snapped, blank), null);
});

// ---- finding the board with nothing tapped ----------------------------------------------------------

test("the board is found with nothing tapped, from either side, straight on, and through a bent lens", () => {
  const cams = [
    ["from the left", { pos: { x: -190, y: -70, z: 380 }, width: 1280, height: 720, hfov: 84 }],
    ["from the right, bent lens", { pos: { x: 175, y: -55, z: 400 }, width: 1280, height: 720, hfov: 80, bend: -0.12 }],
    ["straight on", { pos: { x: 0, y: 0, z: 520 }, width: 1280, height: 720, hfov: 70 }],
    ["very much from the side, and rolled", { pos: { x: -330, y: -40, z: 300 }, width: 1280, height: 720, hfov: 84, roll: 10 }],
  ];
  for (const [name, spec] of cams) {
    const cam = S.camera(spec), still = stillOf(cam, [], { smooth: 2 });
    const rough = V.findBoard(still);
    assert.ok(rough, `${name}: found`);
    assert.ok(worstOff(cam, rough) < 4, `${name}: the rough find is ${worstOff(cam, rough).toFixed(1)} mm off`);
    const cal = V.autoCalibrate(still);
    assert.ok(cal && cal.auto, `${name}: calibrated`);
    assert.ok(worstOff(cam, cal) < 0.6, `${name}: ${worstOff(cam, cal).toFixed(2)} mm off`);
    assert.ok(cal.refined.edges > 300 && cal.refined.shift === 0, `${name}: ${cal.refined.edges} edges`);
    // Its five points are where the board has them, so the pages can show and reuse them.
    V.CAL_POINTS.forEach((pt, i) => {
      const real = cam.project({ x: pt.x * S.R, y: pt.y * S.R, z: 0 });
      assert.ok(Math.hypot(cal.points[i].x - real.x, cal.points[i].y - real.y) < 2, `${name}: point ${pt.short}`);
    });
  }
});

test("finding the board copes with darts in it (one in the bull), dim and warm light, and part of it out of the picture", () => {
  const spec = { pos: { x: 175, y: -55, z: 400 }, width: 1280, height: 720, hfov: 80 };
  const cam = S.camera(spec);
  const darts = [{ at: { x: 1, y: 2 }, lean: { x: 0.05, y: -0.3 } }, { at: { x: -12, y: -98 }, lean: { x: -0.1, y: -0.2 } }, { at: { x: 40, y: 60 }, lean: { x: 0.1, y: -0.3 } }];
  const withDarts = V.autoCalibrate(stillOf(cam, darts, { smooth: 2 }));
  assert.ok(withDarts && worstOff(cam, withDarts) < 0.8, "three darts in the board, one in the bull");
  const full = { crop: { sx: 0, sy: 0, sw: 1280, sh: 720 }, width: 1280, height: 720 };
  const dim = S.renderer(cam, full, { noise: 3, seed: 5, smooth: 2 })([], { gain: 0.4 });
  const dimCal = V.autoCalibrate(dim);
  assert.ok(dimCal && worstOff(cam, dimCal) < 0.8, "a dim picture");
  const warm = stillOf(cam, [], { smooth: 2 });
  for (let i = 0; i < warm.data.length; i += 4) { warm.data[i + 1] *= 0.82; warm.data[i + 2] *= 0.55; }
  const warmCal = V.autoCalibrate(warm);
  assert.ok(warmCal && worstOff(cam, warmCal) < 0.8, "warm light");
  const aside = S.camera({ pos: { x: -170, y: -60, z: 420 }, look: { x: -110, y: 40, z: 0 }, width: 1280, height: 720, hfov: 62 });
  const part = V.autoCalibrate(stillOf(aside, [], { smooth: 2 }));
  assert.ok(part && worstOff(aside, part) < 0.8, "part of the number ring out of the picture");
});

test("no board, no calibration: a blank picture, random colours, and a board too small to trust", () => {
  const blank = { data: new Uint8ClampedArray(1280 * 720 * 4).fill(40), width: 1280, height: 720 };
  assert.equal(V.findBoard(blank), null);
  assert.equal(V.autoCalibrate(blank), null);
  const random = S.rng(3), noise = { data: new Uint8ClampedArray(640 * 360 * 4), width: 640, height: 360 };
  for (let i = 0; i < noise.data.length; i += 1) noise.data[i] = random() * 255;
  assert.equal(V.autoCalibrate(noise), null);
  assert.equal(V.findBoard(null), null);
  // Half the board hidden (someone standing in front of it): too little to go on.
  const cam = S.camera({ pos: { x: 175, y: -55, z: 400 }, width: 1280, height: 720, hfov: 80 });
  const hidden = stillOf(cam, [], { smooth: 2 });
  const middle = cam.project({ x: 0, y: 0, z: 0 });
  for (let y = 0; y < 720; y += 1) for (let x = Math.round(middle.x - 40); x < 1280; x += 1) { const i = (y * 1280 + x) * 4; hidden.data[i] = 70; hidden.data[i + 1] = 60; hidden.data[i + 2] = 55; }
  assert.equal(V.autoCalibrate(hidden), null, "half hidden");
});

test("which way up: the 20 is the red piece nearest the top, or nearest where the calibration before had it", () => {
  // A camera fixed upside down sees the 3 at the top. Nothing in the colours can tell (they repeat
  // every two numbers), so found from nothing it is wrong by half a turn; with the calibration
  // from before to say where the 20 was, it is right.
  const cam = S.camera({ pos: { x: -170, y: -60, z: 420 }, width: 1280, height: 720, hfov: 78, roll: 180 });
  const still = stillOf(cam, [], { smooth: 2 });
  const before = S.tapCalibration(cam, 6, S.rng(3));
  const blind = V.autoCalibrate(still);
  assert.ok(blind && worstOff(cam, blind) > 100, "the wrong way up without a hint");
  const hinted = V.autoCalibrate(still, { hint: before });
  assert.ok(hinted && worstOff(cam, hinted) < 0.6, "right with where the 20 was");
  near(V.shiftBetween(before, hinted), worstOff(cam, before), 1.5, "how far the old calibration was off");
});

test("two cameras in one picture (OBS side by side): each half finds its own board", () => {
  const specs = [{ pos: { x: -170, y: -60, z: 420 }, width: 640, height: 720, hfov: 60 }, { pos: { x: 170, y: -60, z: 420 }, width: 640, height: 720, hfov: 60 }];
  const cams = specs.map((spec) => S.camera(spec));
  const halves = cams.map((cam, i) => S.renderer(cam, { crop: { sx: 0, sy: 0, sw: 640, sh: 720 }, width: 640, height: 720 }, { noise: 3, seed: 5 + i, smooth: 2 })([]));
  const both = { data: new Uint8ClampedArray(1280 * 720 * 4), width: 1280, height: 720 };
  for (let y = 0; y < 720; y += 1) halves.forEach((half, i) => both.data.set(half.data.subarray(y * 640 * 4, (y + 1) * 640 * 4), (y * 1280 + i * 640) * 4));
  cams.forEach((cam, i) => {
    const cal = V.autoCalibrate(both, { region: { x0: i * 640, y0: 0, x1: (i + 1) * 640, y1: 720 }, center: { x: 320 + i * 640, y: 360 }, size: Math.hypot(640, 720) / 2 });
    const inWhole = { project: (p) => { const q = cam.project(p); return q && { x: q.x + i * 640, y: q.y }; } };
    assert.ok(cal && worstOff(inWhole, cal) < 0.6, `half ${i + 1}`);
    near(V.halfCenter(cal).x, 320 + i * 640, 1e-9, `half ${i + 1} knows which half it is`);
  });
});

// Two cameras either side of the board and a little above the bull, like the NexiGo rig. Drawing
// the board takes a moment, so one rig is shared; each test gets its own run of random darts. The
// light is soft, as on the real board (a dart's shadow is barely there); see the single-lamp test
// for hard shadows.
let shared = null;
function rig(seed) {
  if (!shared) {
    const random = S.rng(11);
    const cams = [{ x: -170, y: -60, z: 420 }, { x: 170, y: -60, z: 420 }].map((pos) => S.camera({ pos, width: 1280, height: 720, hfov: 78 }));
    const views = cams.map((cam) => V.makeView(S.tapCalibration(cam, 1, random), 1280, 720));
    const renders = cams.map((cam, i) => S.renderer(cam, views[i], { noise: 3, seed: 12 + i, shadow: 0.95 }));
    shared = { views, renders, cams };
  }
  return { random: S.rng(seed), views: shared.views, renders: shared.renders, cams: shared.cams };
}

function randomDart(random) {
  let x, y;
  do { x = (random() * 2 - 1) * 172; y = (random() * 2 - 1) * 172; } while (Math.hypot(x, y) > 170);
  return { at: { x, y }, lean: { x: (random() * 2 - 1) * 0.15, y: -0.1 - random() * 0.3 }, spin: random() * 3 };
}

test("reads single darts from two cameras", () => {
  const { random, views, renders } = rig(11);
  const empty = renders.map((r) => r([]));
  const errors = [];
  let right = 0;
  const N = 24;
  for (let k = 0; k < N; k += 1) {
    const dart = randomDart(random);
    const after = renders.map((r) => r([dart]));
    const readings = views.map((view, i) => V.readView(view, V.diffMask(empty[i].data, after[i].data, view).mask));
    assert.ok(readings.every((r) => r.ok), "both cameras see the dart");
    const f = V.fuse(readings);
    const truth = { x: dart.at.x / S.R, y: dart.at.y / S.R };
    errors.push(Math.hypot(f.real.x - truth.x, f.real.y - truth.y) * S.R);
    if (f.label === V.classify(truth.x, truth.y).label) right += 1;
    // The app position scores what the real one does.
    assert.equal(E.classify(f.app.x, f.app.y).label, f.label);
  }
  errors.sort((a, b) => a - b);
  // In the pretend rig a dart is usually within a couple of millimetres; the misses are darts
  // that land right by a wire. These are floors to catch a regression, not a promise.
  assert.ok(errors[Math.floor(N / 2)] < 3, `median error ${errors[Math.floor(N / 2)].toFixed(1)} mm`);
  assert.ok(right / N >= 0.8, `${right} of ${N} right`);
});

test("under a single lamp (hard shadows beside every dart), the shadow option keeps darts readable", () => {
  const { random, views, cams } = rig(13);
  const renders = cams.map((cam, i) => S.renderer(cam, views[i], { noise: 3, seed: 22 + i, shadow: 0.72 }));
  const empty = renders.map((r) => r([]));
  const o = { shadow: true };
  const errors = [];
  let right = 0;
  const N = 16;
  for (let k = 0; k < N; k += 1) {
    const dart = randomDart(random);
    const after = renders.map((r) => r([dart]));
    const f = V.fuse(views.map((view, i) => V.readView(view, V.diffMask(empty[i].data, after[i].data, view, o).mask, o)), o);
    const truth = { x: dart.at.x / S.R, y: dart.at.y / S.R };
    errors.push(f ? Math.hypot(f.real.x - truth.x, f.real.y - truth.y) * S.R : 99);
    if (f && f.label === V.classify(truth.x, truth.y).label) right += 1;
  }
  errors.sort((a, b) => a - b);
  assert.ok(errors[N >> 1] < 3, `median error ${errors[N >> 1].toFixed(1)} mm`);
  assert.ok(right / N >= 0.75, `${right} of ${N} right`);
});

test("one camera on its own still reads a dart", () => {
  const { random, views, renders } = rig(5);
  const empty = renders[1]([]);
  let close = 0;
  for (let k = 0; k < 12; k += 1) {
    const dart = randomDart(random);
    const r = V.readView(views[1], V.diffMask(empty.data, renders[1]([dart]).data, views[1]).mask);
    const f = V.fuse([null, r]);
    assert.equal(f.method, "one camera");
    if (Math.hypot(f.real.x * S.R - dart.at.x, f.real.y * S.R - dart.at.y) < 6) close += 1;
  }
  assert.ok(close >= 9, `${close} of 12 within 6 mm`);
});

// Paints a big skin-coloured patch over the middle of a frame: a hand.
function withHand(frame) {
  const data = Uint8ClampedArray.from(frame.data);
  for (let y = Math.floor(frame.height * 0.2); y < frame.height * 0.75; y += 1) {
    for (let x = Math.floor(frame.width * 0.25); x < frame.width * 0.8; x += 1) {
      const i = (y * frame.width + x) * 4;
      data[i] = 214; data[i + 1] = 160; data[i + 2] = 130;
    }
  }
  return { data, width: frame.width, height: frame.height };
}

test("watching: a dart, then the darts pulled out", () => {
  const { views, renders } = rig(21);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (frames, times = 1) => {
    const events = [];
    for (let i = 0; i < times; i += 1) {
      now += 100;
      events.push(...detector.push(frames.map((f) => f), now));
    }
    return events;
  };
  const empty = renders.map((r) => r([]));
  assert.deepEqual(feed(empty).map((e) => e.type), ["ready"]);
  assert.deepEqual(feed(renders.map((r) => r([])), 3), [], "camera noise alone is nothing");

  // Brighter all over (the camera adjusting its exposure) is not a dart either.
  assert.deepEqual(feed(renders.map((r) => r([], { gain: 1.08 })), 5).filter((e) => e.type === "dart"), []);

  const dart = { at: { x: 4, y: -103 }, lean: { x: 0.05, y: -0.25 }, spin: 1.1 };
  const one = renders.map((r) => r([dart]));
  const events = feed(one).concat(feed(renders.map((r) => r([dart])), 5));
  const darts = events.filter((e) => e.type === "dart");
  assert.equal(darts.length, 1, JSON.stringify(events.map((e) => e.type)));
  assert.equal(darts[0].label, "T20");
  assert.equal(darts[0].index, 1);
  assert.equal(detector.darts, 1);

  // A hand comes in to pull the dart out: something big, then the clear board again.
  const hand = renders.map((r) => withHand(r([dart])));
  const during = feed(hand, 5);
  assert.ok(during.some((e) => e.type === "blocked"), JSON.stringify(during.map((e) => e.type)));
  assert.equal(during.filter((e) => e.type === "dart").length, 0);
  const after = feed(renders.map((r) => r([])), 6);
  const out = after.find((e) => e.type === "takeout");
  assert.ok(out, JSON.stringify(after.map((e) => e.type)));
  assert.equal(out.darts, 1);
  assert.equal(detector.darts, 0);
});

test("watching: three darts in a visit are each read once", () => {
  const { views, renders } = rig(31);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (frames, times) => {
    const events = [];
    for (let i = 0; i < times; i += 1) { now += 100; events.push(...detector.push(frames, now)); }
    return events;
  };
  feed(renders.map((r) => r([])), 2);
  const thrown = [
    { at: { x: -60, y: 40 }, lean: { x: 0, y: -0.2 }, spin: 0.3 },
    { at: { x: 95, y: -30 }, lean: { x: -0.05, y: -0.3 }, spin: 1.7 },
    { at: { x: 10, y: 120 }, lean: { x: 0.1, y: -0.15 }, spin: 2.5 },
  ];
  const labels = [];
  thrown.forEach((_, k) => {
    const frames = renders.map((r) => r(thrown.slice(0, k + 1)));
    for (const e of feed(frames, 6)) if (e.type === "dart") labels.push(e.label);
  });
  assert.deepEqual(labels, thrown.map((d) => V.classify(d.at.x / S.R, d.at.y / S.R).label));
});

// A real webcam's flicker: besides gentle noise, about 1 pixel in `rate` jumps by up to ±`amp` in
// a colour each frame (measured on the NexiGo webcams: about 1 in 100 by more than the motion
// threshold). A different scatter every frame.
let flickerSeed = 1;
function flicker(frame, rate = 60, amp = 45) {
  const data = Uint8ClampedArray.from(frame.data), random = S.rng(flickerSeed++);
  for (let i = 0; i < data.length; i += 4) {
    if (random() * rate >= 1) continue;
    const ch = (random() * 3) | 0;
    data[i + ch] += (random() * 2 - 1) * amp;
  }
  return { data, width: frame.width, height: frame.height };
}

test("watching through a real camera's flicker: it still settles, reads the dart and sees the take-out", () => {
  const { views, renders } = rig(31);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (make, times) => {
    const events = [];
    for (let i = 0; i < times; i += 1) { now += 100; events.push(...detector.push(make(), now)); }
    return events.map((e) => e.type);
  };
  const board = (darts) => () => renders.map((r) => flicker(r(darts)));
  assert.deepEqual(feed(board([]), 1), ["ready"]);
  assert.deepEqual(feed(board([]), 40), [], "flicker alone is nothing, and nothing is left 'moving'");
  const dart = { at: { x: 4, y: -103 }, lean: { x: 0.05, y: -0.25 }, spin: 1.1 };
  const events = feed(board([dart]), 8);
  assert.equal(events.filter((t) => t === "dart").length, 1, events.join(","));
  assert.equal(detector.state, "watching", "settled again after the dart");
  const during = feed(() => renders.map((r) => withHand(flicker(r([dart])))), 5);
  assert.ok(during.includes("blocked"), during.join(","));
  const after = feed(board([]), 8);
  assert.ok(after.includes("takeout"), after.join(","));
});

test("pulling darts out without a big hand in the picture is not read as a dart", () => {
  const { views, renders } = rig(41);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (darts, times) => {
    const out = [];
    for (let i = 0; i < times; i += 1) { now += 100; out.push(...detector.push(renders.map((r) => flicker(r(darts))), now)); }
    return out;
  };
  const a = { at: { x: 4, y: -103 }, lean: { x: 0.05, y: -0.25 }, spin: 1.1 };
  const b = { at: { x: -30, y: -120 }, lean: { x: -0.05, y: -0.3 }, spin: 2.0 };
  feed([], 10);
  const thrown = feed([a], 8).concat(feed([a, b], 8)).filter((e) => e.type === "dart");
  assert.equal(thrown.length, 2, "two darts read");
  // One pulled out, then the other: no dart for either; the second leaves the board clear.
  const first = feed([a], 8);
  assert.equal(first.filter((e) => e.type === "dart").length, 0, first.map((e) => e.type).join(","));
  assert.ok(first.some((e) => e.type === "removed"), first.map((e) => e.type).join(","));
  const second = feed([], 8);
  assert.equal(second.filter((e) => e.type === "dart").length, 0, second.map((e) => e.type).join(","));
  const out = second.find((e) => e.type === "takeout");
  assert.ok(out, second.map((e) => e.type).join(","));
  // And the next throw is read as usual (from the oche, a few seconds later).
  now += 4000;
  const next = feed([b], 8).filter((e) => e.type === "dart");
  assert.equal(next.length, 1);
});

// The light changing while darts are in the board (dusk through a window, a lamp switched on):
// darker by up to `amount` towards one side of each picture. Not something a gain can undo.
function dusk(frame, amount) {
  const data = Uint8ClampedArray.from(frame.data), w = frame.width;
  for (let i = 0; i < data.length; i += 4) {
    const k = 1 - amount * (((i >> 2) % w) / w);
    data[i] *= k; data[i + 1] *= k; data[i + 2] *= k;
  }
  return { data, width: frame.width, height: frame.height };
}

// A hand (a skin-coloured patch) by board position p (in mm), w x h crop pixels: smaller than a
// hand in the way, as when fingers close round the darts to pull them out.
function withFingers(frame, view, p, w = 26, h = 34) {
  const data = Uint8ClampedArray.from(frame.data), c = view.toCrop(p.x / S.R, p.y / S.R);
  for (let y = Math.round(c.y - h / 2); y < c.y + h / 2; y += 1) {
    for (let x = Math.round(c.x - w / 2); x < c.x + w / 2; x += 1) {
      if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue;
      const i = (y * frame.width + x) * 4;
      data[i] = 214; data[i + 1] = 160; data[i + 2] = 130;
    }
  }
  return { data, width: frame.width, height: frame.height };
}

const visit = [
  { at: { x: 4, y: -103 }, lean: { x: 0.05, y: -0.25 }, spin: 1.1 },
  { at: { x: -30, y: -112 }, lean: { x: -0.05, y: -0.3 }, spin: 2.0 },
  { at: { x: 22, y: -95 }, lean: { x: 0.08, y: -0.2 }, spin: 0.4 },
];

test("the light changing while the darts are in: pulling them out is still a take-out", () => {
  const { views, renders } = rig(51);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (darts, times, light = 0) => {
    const out = [];
    for (let i = 0; i < times; i += 1) { now += 100; out.push(...detector.push(renders.map((r) => dusk(flicker(r(darts)), typeof light === "function" ? light() : light)), now)); }
    return out;
  };
  feed([], 10);
  const read = [];
  visit.forEach((_, k) => { read.push(...feed(visit.slice(0, k + 1), 8).filter((e) => e.type === "dart")); });
  assert.equal(read.length, 3, "three darts read");
  // The light goes down slowly, darker towards one side, while the darts are in.
  let amount = 0;
  const ramp = feed(visit, 300, () => (amount = Math.min(0.32, amount + 0.0012)));
  assert.equal(ramp.filter((e) => e.type === "dart").length, 0, "the light changing is not a dart: " + ramp.map((e) => e.type).join(","));
  // All three pulled out at once: that is "darts out", and the next throw is read as usual.
  const out = feed([], 10, 0.32);
  assert.equal(out.filter((e) => e.type === "dart").length, 0, out.map((e) => e.type).join(","));
  const takeout = out.find((e) => e.type === "takeout");
  assert.ok(takeout, "darts out: " + out.map((e) => e.type).join(","));
  assert.equal(takeout.darts, 3);
  assert.equal(detector.darts, 0);
  // Back at the oche a few seconds later.
  now += 4000;
  const next = feed([visit[0]], 8, 0.32).filter((e) => e.type === "dart");
  assert.equal(next.length, 1, "the next dart");
  assert.equal(next[0].index, 1, "is the first of the next visit");
});

test("a hand by the darts after the third one is not a fourth dart", () => {
  const { views, renders } = rig(53);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (make, times) => {
    const out = [];
    for (let i = 0; i < times; i += 1) { now += 100; out.push(...detector.push(make(), now)); }
    return out;
  };
  const board = (darts) => () => renders.map((r) => flicker(r(darts)));
  feed(board([]), 10);
  const read = [];
  visit.forEach((_, k) => { read.push(...feed(board(visit.slice(0, k + 1)), 8).filter((e) => e.type === "dart")); now += 2000; });
  assert.equal(read.length, 3, "three darts read");
  // Walking up to the board: fingers close round the darts, and hold still for a moment.
  const fingers = () => renders.map((r, i) => withFingers(flicker(r(visit)), views[i], { x: 8, y: -128 }));
  const reaching = feed(fingers, 8);
  assert.equal(reaching.filter((e) => e.type === "dart").length, 0, "no fourth dart: " + reaching.map((e) => e.type).join(","));
  // The darts come out with the hand: darts out.
  const out = feed(board([]), 10);
  assert.ok(out.some((e) => e.type === "takeout"), out.map((e) => e.type).join(","));
  assert.equal(out.filter((e) => e.type === "dart").length, 0);
  // The next visit's darts are read (well after the last one).
  now += 8000;
  const next = feed(board([visit[1]]), 8).filter((e) => e.type === "dart");
  assert.equal(next.length, 1, "the next visit's first dart");
});

test("a slow pull, one dart at a time with the hand at the board, is no darts and then darts out", () => {
  const { views, renders } = rig(57);
  const detector = V.createDetector(views);
  let now = 0;
  const feed = (make, frames, ms = 100) => {
    const out = [];
    for (let i = 0; i < frames; i += 1) { now += ms; out.push(...detector.push(make(), now)); }
    return out;
  };
  const board = (darts) => () => renders.map((r) => flicker(r(darts)));
  const fingers = (darts) => () => renders.map((r, i) => withFingers(flicker(r(darts)), views[i], { x: 8, y: -128 }));
  feed(board([]), 10);
  const read = [];
  visit.forEach((_, k) => { read.push(...feed(board(visit.slice(0, k + 1)), 25).filter((e) => e.type === "dart")); });
  assert.equal(read.length, 3, "three darts read");
  // Walking up (9 s), then pulling them out one by one over 10 s, the hand at the board throughout.
  const events = feed(board(visit), 60)
    .concat(feed(fingers(visit), 30), feed(fingers(visit.slice(0, 2)), 30), feed(fingers(visit.slice(0, 1)), 30), feed(fingers([]), 30), feed(board([]), 40));
  assert.equal(events.filter((e) => e.type === "dart").length, 0, "nothing read as a dart: " + events.map((e) => e.type).join(","));
  assert.equal(events.filter((e) => e.type === "takeout").length, 1, "darts out once: " + events.map((e) => e.type).join(","));
  // The next visit, a few seconds later.
  const next = feed(board([visit[1]]), 25).filter((e) => e.type === "dart");
  assert.equal(next.length, 1, "the next visit's first dart");
  assert.equal(next[0].index, 1);
});

// ---- the dart that is followed at once by the hand, and the cameras' own noise ----------------------

// An arm coming in from the bottom of the picture, `reach` of the way up (0..1).
function withArm(frame, reach) {
  const data = Uint8ClampedArray.from(frame.data), w = frame.width, h = frame.height;
  for (let y = Math.floor(h * (1 - reach)); y < h; y += 1) {
    for (let x = Math.floor(w * 0.42); x < w * 0.58; x += 1) { const i = (y * w + x) * 4; data[i] = 214; data[i + 1] = 160; data[i + 2] = 130; }
  }
  return { data, width: w, height: h };
}
// A shadow falling across the picture from the left as someone walks up: `cover` of its width, darkened to `light`.
function withShadow(frame, cover, light) {
  const data = Uint8ClampedArray.from(frame.data), w = frame.width, h = frame.height, edge = Math.floor(w * cover);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < edge; x += 1) { const i = (y * w + x) * 4; data[i] *= light; data[i + 1] *= light; data[i + 2] *= light; }
  }
  return { data, width: w, height: h };
}
// A detector with two darts of `visit` read, and what it says from then on.
function twoIn(seed, options) {
  const { views, renders } = rig(seed);
  const detector = V.createDetector(views, options);
  const run = { now: 0, events: [], views, renders, detector };
  run.feed = (make, times) => {
    const out = [];
    for (let i = 0; i < times; i += 1) { run.now += 100; out.push(...detector.push(make(i), run.now)); }
    run.events.push(...out);
    return out;
  };
  run.board = (darts) => () => renders.map((r) => r(darts));
  run.feed(run.board([]), 10);
  const first = run.feed(run.board(visit.slice(0, 1)), 8).filter((e) => e.type === "dart");
  run.now += 1500;
  const second = run.feed(run.board(visit.slice(0, 2)), 8).filter((e) => e.type === "dart");
  run.now += 1500;
  assert.equal(first.length + second.length, 2, "the first two darts are read");
  run.events.length = 0;
  return run;
}

test("the third dart is read though the thrower is at the board before the picture has held still", () => {
  // Two-player games on Nov 14 and 16, 2026: the thrower walks up as the third dart lands (the
  // other player is waiting), the picture never holds still for the three frames a read took, the
  // darts come out, and the take-out said "2 darts": the game put a miss in for the third.
  const cases = [
    ["a hand in the way 0.2 s after it landed", (run) => { run.feed(run.board(visit), 2); run.feed(() => run.renders.map((r) => withHand(r(visit))), 12); }],
    ["an arm reaching in from 0.2 s after it landed", (run) => { run.feed(run.board(visit), 2); run.feed((i) => run.renders.map((r) => withArm(r(visit), Math.min(0.75, 0.1 + i * 0.08))), 10); run.feed(() => run.renders.map((r) => withHand(r(visit))), 6); }],
    ["the thrower's shadow crossing the board from the moment it landed", (run) => { run.feed(run.board(visit), 1); run.feed((i) => run.renders.map((r) => withShadow(r(visit), Math.min(1, (i + 1) / 15), 0.8)), 15); run.feed(() => run.renders.map((r) => withHand(withShadow(r(visit), 1, 0.8))), 8); }],
  ];
  cases.forEach(([name, interrupt], k) => {
    const run = twoIn(61 + k);
    interrupt(run);
    run.feed(run.board([]), 12);
    const read = run.events.filter((e) => e.type === "dart");
    assert.equal(read.length, 1, `${name}: the third dart is read (${run.events.map((e) => e.type).join(",")})`);
    assert.equal(read[0].index, 3);
    assert.ok(read[0].early, `${name}: from the picture before the hand`);
    assert.ok(read[0].from && read[0].from.before.length === 2 && read[0].from.after.length === 2, `${name}: with the pictures it was read from (for learning)`);
    // Where it is, as well as a dart read the usual way (this one is 1.5 mm inside the treble's wire,
    // so the name alone could go either way).
    const off = Math.hypot(read[0].real.x * S.R - visit[2].at.x, read[0].real.y * S.R - visit[2].at.y);
    assert.ok(off < 5, `${name}: read where it is (${off.toFixed(1)} mm off)`);
    const out = run.events.filter((e) => e.type === "takeout");
    assert.ok(out.length === 1 && out[0].darts === 3, `${name}: the take-out counts three darts, not two`);
    assert.ok(!run.events.some((e) => e.type === "coarser"), `${name}: a hand is not the cameras' noise`);
  });
});

test("a hand that pauses at the board is not a dart, with two darts in or with none", () => {
  // Fingers by two darts for a moment, moving, and away again: the darts are still there, so
  // what came and went was a hand.
  let run = twoIn(71);
  const two = visit.slice(0, 2);
  const fingers = (p) => () => run.renders.map((r, i) => withFingers(r(two), run.views[i], p));
  run.feed(fingers({ x: 8, y: -128 }), 2);
  run.feed(fingers({ x: 20, y: -110 }), 2);
  run.feed(fingers({ x: -5, y: -135 }), 3);
  run.feed(run.board(two), 8);
  assert.equal(run.events.filter((e) => e.type === "dart").length, 0, "no third dart: " + run.events.map((e) => e.type).join(","));
  run.feed(() => run.renders.map((r) => withHand(r(two))), 6);
  const out = run.feed(run.board([]), 10).filter((e) => e.type === "takeout");
  assert.ok(out.length === 1 && out[0].darts === 2, "and the pull counts the two that were there");
  // The same in front of an empty board: nothing to tell a dart from a hand by, so it is no dart.
  const { views, renders } = rig(72);
  const detector = V.createDetector(views);
  let now = 0;
  const events = [];
  const feed = (make, times) => { for (let i = 0; i < times; i += 1) { now += 100; events.push(...detector.push(make(), now)); } };
  feed(() => renders.map((r) => r([])), 10);
  feed(() => renders.map((r, i) => withFingers(r([]), views[i], { x: 30, y: -60 })), 2);
  feed(() => renders.map((r, i) => withFingers(r([]), views[i], { x: 50, y: -40 })), 3);
  feed(() => renders.map((r) => r([])), 8);
  assert.equal(events.filter((e) => e.type === "dart").length, 0, "no dart from a hand passing an empty board");
});

test("a dart still swaying when it is first seen is read once, at rest, the usual way", () => {
  // A dart quivers for a few tenths of a second after it lands: the picture it is first caught
  // in is not the picture at rest. Read from that one and then looked at again, what differs
  // between the two would be dart-sized and read as another dart, somewhere else. So a dart that
  // is still in the board is read from the picture now, as always.
  const d = visit[2];
  const swayed = (k) => Object.assign({}, d, { lean: { x: d.lean.x + k, y: d.lean.y - k * 0.5 } });
  for (const [name, sways] of [["a long quiver", [0.1, -0.08, 0.06, -0.05, 0.03, -0.02]], ["a short one", [0.06, -0.03]], ["one that pauses and starts again", [0.08, 0.08, 0.08, -0.05, 0.03]]]) {
    const run = twoIn(64);
    sways.forEach((k) => run.feed(run.board(visit.slice(0, 2).concat([swayed(k)])), 1));
    run.feed(run.board(visit), 10);
    const read = run.events.filter((e) => e.type === "dart");
    assert.equal(read.length, 1, `${name}: one dart (${run.events.map((e) => e.type).join(",")})`);
    assert.ok(!read[0].early && read[0].index === 3, `${name}: read from the picture at rest`);
    const off = Math.hypot(read[0].real.x * S.R - d.at.x, read[0].real.y * S.R - d.at.y);
    assert.ok(off < 5, `${name}: read where it is (${off.toFixed(1)} mm off)`);
    // Nothing more while the darts stay in, and the pull is three darts with no dart added.
    run.events.length = 0;
    run.feed(run.board(visit), 30);
    run.feed(() => run.renders.map((r) => withHand(r(visit))), 6);
    run.feed(run.board([]), 12);
    assert.equal(run.events.filter((e) => e.type === "dart").length, 0, `${name}: no dart after it (${run.events.map((e) => e.type).join(",")})`);
    const out = run.events.filter((e) => e.type === "takeout");
    assert.ok(out.length === 1 && out[0].darts === 3, `${name}: the take-out counts three`);
  }
});

test("a hand over the darts that goes away again leaves the third dart to be counted when they come out", () => {
  // The third dart lands, a hand covers the board before it could be read and holds still, then
  // goes away with the darts still in. Nothing is read twice and nothing is made up: the dart
  // waits, and is counted as the darts come out.
  const run = twoIn(65);
  run.feed(run.board(visit), 2);
  run.feed(() => run.renders.map((r) => withHand(r(visit))), 12);
  run.feed(run.board(visit), 10);
  assert.ok(run.events.filter((e) => e.type === "dart").length <= 1, "never two darts for one: " + run.events.map((e) => e.type).join(","));
  run.feed(() => run.renders.map((r) => withHand(r(visit))), 6);
  run.feed(run.board([]), 12);
  const read = run.events.filter((e) => e.type === "dart");
  assert.equal(read.length, 1, "the third dart is counted once: " + run.events.map((e) => e.type).join(","));
  const off = Math.hypot(read[0].real.x * S.R - visit[2].at.x, read[0].real.y * S.R - visit[2].at.y);
  assert.ok(read[0].index === 3 && off < 5, `where it is (${off.toFixed(1)} mm off)`);
  const out = run.events.filter((e) => e.type === "takeout");
  assert.ok(out.length === 1 && out[0].darts === 3, "and the take-out counts three");
  assert.ok(run.events.findIndex((e) => e.type === "dart") < run.events.findIndex((e) => e.type === "takeout"), "the dart before the take-out");
  // A dart that waited too long is forgotten (the next visit's darts are never mixed up with it).
  const late = twoIn(66, { handMs: 3000 });
  late.feed(late.board(visit), 2);
  late.feed(() => late.renders.map((r) => withHand(r(visit))), 40);
  late.feed(late.board([]), 12);
  assert.equal(late.events.filter((e) => e.type === "dart").length, 0, "forgotten after a long while: " + late.events.map((e) => e.type).join(","));
});

// ---- two players: the next dart as soon as the board is clear -------------------------------------

// A detector that has just seen a visit's three darts pulled out: run.outAt is when it said so.
function justPulled(seed, options) {
  const { views, renders } = rig(seed);
  const detector = V.createDetector(views, options);
  const run = { now: 0, events: [], views, renders, detector };
  run.feed = (make, times) => {
    const out = [];
    for (let i = 0; i < times; i += 1) { run.now += 100; out.push(...detector.push(make(i), run.now)); }
    run.events.push(...out);
    return out;
  };
  run.board = (darts) => () => renders.map((r) => flicker(r(darts)));
  run.feed(run.board([]), 10);
  visit.forEach((_, k) => { run.feed(run.board(visit.slice(0, k + 1)), 8); run.now += 2000; });
  run.feed(() => renders.map((r) => withHand(flicker(r(visit)))), 6);
  const out = run.feed(run.board([]), 6).filter((e) => e.type === "takeout");
  assert.ok(out.length === 1 && out[0].darts === 3, "the visit's three darts out: " + run.events.map((e) => e.type).join(","));
  run.outAt = run.now;
  run.events.length = 0;
  return run;
}
const next = [
  { at: { x: -88, y: 52 }, lean: { x: 0.04, y: -0.22 }, spin: 0.7 },
  { at: { x: 70, y: 75 }, lean: { x: -0.06, y: -0.28 }, spin: 1.9 },
  { at: { x: -20, y: 128 }, lean: { x: 0.07, y: -0.18 }, spin: 2.8 },
];
const labelOf = (d) => V.classify(d.at.x / S.R, d.at.y / S.R).label;

test("two players: a dart thrown the moment the board is clear is counted, not taken for the hand", () => {
  // Nov 17, 2026: the other player threw as soon as the darts were out; eight first darts landed 1.2
  // to 2.5 s after the take-out and every one was thrown away as the hand going away.
  const run = justPulled(91);
  run.now += 800; // it lands 0.8 s after the take-out
  const first = run.feed(run.board(next.slice(0, 1)), 8);
  assert.equal(first.filter((e) => e.type === "dart").length, 0, "it waits to show it is a dart: " + first.map((e) => e.type).join(","));
  assert.ok(first.some((e) => e.type === "soon"), "and says it is waiting: " + first.map((e) => e.type).join(","));
  run.now += 600; // the second dart 1.4 s after it: before it has sat still long enough
  const second = run.feed(run.board(next.slice(0, 2)), 8).filter((e) => e.type === "dart");
  assert.deepEqual(second.map((e) => e.label + " " + e.index), [labelOf(next[0]) + " 1", labelOf(next[1]) + " 2"], "the second dart brings the first with it, first");
  assert.ok(second[0].soon && second[0].from && second[0].from.after.length === 2, "the first is marked, with the pictures it was read from");
  run.now += 2000;
  const third = run.feed(run.board(next), 8).filter((e) => e.type === "dart");
  assert.deepEqual(third.map((e) => e.index), [3]);
  run.feed(() => run.renders.map((r) => withHand(flicker(r(next)))), 6);
  const out = run.feed(run.board([]), 8).filter((e) => e.type === "takeout");
  assert.ok(out.length === 1 && out[0].darts === 3, "and the pull counts all three");
});

test("two players: a lone dart right after the take-out (a bust) is counted once it has sat still", () => {
  const run = justPulled(92);
  run.now += 1100;
  run.feed(run.board(next.slice(0, 1)), 8);
  assert.equal(run.events.filter((e) => e.type === "dart").length, 0, "not yet");
  run.feed(run.board(next.slice(0, 1)), 18); // untouched for 2 s
  const read = run.events.filter((e) => e.type === "dart");
  assert.equal(read.length, 1, "counted: " + run.events.map((e) => e.type).join(","));
  assert.ok(read[0].label === labelOf(next[0]) && read[0].index === 1 && read[0].soon, read[0].label);
  // The thrower walks up and pulls it out: darts out, one.
  run.feed(run.board(next.slice(0, 1)), 15);
  run.feed(() => run.renders.map((r) => withHand(flicker(r(next.slice(0, 1))))), 6);
  const out = run.feed(run.board([]), 8).filter((e) => e.type === "takeout");
  assert.ok(out.length === 1 && out[0].darts === 1, "one dart out: " + run.events.map((e) => e.type).join(","));
  assert.equal(run.events.filter((e) => e.type === "dart").length, 1, "and nothing else read");
});

test("the hand going away after the take-out is still no dart, however it lingers", () => {
  // Fingers held by the board after the pull (on their own, with the board clear), then moving off.
  const cases = [
    ["fingers that stop and move on", [[{ x: 30, y: -60 }, 6], [{ x: 45, y: -45 }, 5], [null, 10]]],
    ["fingers that rest for a second and a half and go", [[{ x: 10, y: -120 }, 15], [null, 10]]],
    ["fingers that rest, shift and rest again", [[{ x: 10, y: -120 }, 8], [{ x: 14, y: -116 }, 8], [null, 10]]],
    ["fingers that rest, then a second hand elsewhere", [[{ x: 10, y: -120 }, 8], [{ x: -60, y: 40 }, 8], [null, 10]]],
  ];
  cases.forEach(([name, steps], k) => {
    const run = justPulled(93 + k);
    for (const [p, frames] of steps) run.feed(() => run.renders.map((r, i) => (p ? withFingers(flicker(r([])), run.views[i], p) : flicker(r([])))), frames);
    run.feed(run.board([]), 30);
    assert.equal(run.events.filter((e) => e.type === "dart").length, 0, `${name}: no dart (${run.events.map((e) => e.type).join(",")})`);
    // And the next visit's darts, well after, are read as usual.
    run.now += 6000;
    const read = run.feed(run.board(next.slice(0, 1)), 8).filter((e) => e.type === "dart");
    assert.ok(read.length === 1 && read[0].index === 1 && !read[0].soon, `${name}: the next visit's first dart`);
  });
});

test("the cameras' noise setting the detector off: it asks for a bigger change, settles, and reads darts again", () => {
  // A threshold finer than the cameras' noise (the rig's noise needs about 10; on Nov 16, 2026 a
  // learned 22 was under the real cameras' 30): every picture "differs" from the last, so it looks
  // again and again and finds no dart. Four such looks and it stops trusting so fine a threshold.
  // Its own pretend cameras, drawing no shadow: the rig's faint one (5% darker) is in the picture
  // at thresholds this low and pulls a dart's point about, which is not what this is about.
  const { views, cams } = rig(81);
  const renders = cams.map((cam, i) => S.renderer(cam, views[i], { noise: 3, seed: 81 + i, shadow: 1 }));
  const board = (darts) => renders.map((r) => r(darts));
  const dart = { at: { x: 4, y: -103 }, lean: { x: 0.05, y: -0.25 }, spin: 1.1 };
  const fine = V.createDetector(views, { threshold: 8 });
  let now = 0;
  const feed = (detector, darts, times) => { const out = []; for (let i = 0; i < times; i += 1) { now += 100; out.push(...detector.push(board(darts), now)); } return out; };
  const start = feed(fine, [], 80);
  const coarser = start.filter((e) => e.type === "coarser");
  assert.ok(coarser.length >= 1 && coarser[coarser.length - 1].threshold > 8, "it asked for a bigger change: " + coarser.map((e) => e.threshold).join(","));
  assert.equal(start.filter((e) => e.type === "dart").length, 0, "noise is never a dart");
  assert.equal(feed(fine, [], 40).filter((e) => e.type === "moving").length, 0, "and then the empty board is left alone");
  const read = feed(fine, [dart], 10).filter((e) => e.type === "dart");
  assert.ok(read.length === 1 && read[0].label === "T20", "a dart is read, and read right: " + read.map((e) => e.label).join(","));
  assert.equal(fine.options.threshold, 8, "the setting itself is as it was (the station's to change)");
  // A sound threshold is left as it is, through a whole visit and its pull.
  const sound = V.createDetector(views);
  const all = feed(sound, [], 20).concat(feed(sound, [dart], 10), feed(sound, [], 10));
  assert.ok(!all.some((e) => e.type === "coarser"), "nothing to change with a threshold above the noise");
  // How long each look took is told (for the station's trace).
  assert.ok(all.filter((e) => e.type === "dart" || e.type === "takeout").every((e) => typeof e.ms === "number"));
});
