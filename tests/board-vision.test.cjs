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

// Two cameras either side of the board and a little above the bull, like the NexiGo rig. Drawing
// the board takes a moment, so one rig is shared; each test gets its own run of random darts.
let shared = null;
function rig(seed) {
  if (!shared) {
    const random = S.rng(11);
    const cams = [{ x: -170, y: -60, z: 420 }, { x: 170, y: -60, z: 420 }].map((pos) => S.camera({ pos, width: 1280, height: 720, hfov: 78 }));
    const views = cams.map((cam) => V.makeView(S.tapCalibration(cam, 1, random), 1280, 720));
    const renders = cams.map((cam, i) => S.renderer(cam, views[i], { noise: 3, seed: 12 + i }));
    shared = { views, renders };
  }
  return { random: S.rng(seed), views: shared.views, renders: shared.renders };
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
