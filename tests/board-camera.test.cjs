// Checks for the camera station's messages as the game pages read them (public/board-camera.js):
// a station on another computer passes darts through the account; a page only takes what happens
// after it starts listening, in order, and says when the station is off or not calibrated.
// Run with `node --test tests/board-camera.test.cjs` (part of `npm test`).
const test = require("node:test");
const assert = require("node:assert/strict");
const { DartCamera: C } = require("../public/board-camera.js");

// A Firestore stand-in with what board-camera.js uses: documents, merge writes and listeners.
function fakeDb() {
  const docs = new Map(), subs = new Map();
  const isMap = (v) => v && typeof v === "object" && !Array.isArray(v);
  const merge = (a, b) => {
    const out = isMap(a) ? { ...a } : {};
    for (const [k, v] of Object.entries(b)) out[k] = isMap(v) && isMap(out[k]) ? merge(out[k], v) : v;
    return out;
  };
  const snap = (path) => ({ exists: docs.has(path), data: () => (docs.has(path) ? JSON.parse(JSON.stringify(docs.get(path))) : undefined) });
  const write = (path, data, opt) => {
    docs.set(path, opt && opt.merge ? merge(docs.get(path), data) : data);
    (subs.get(path) || new Set()).forEach((fn) => fn());
  };
  const ref = (path) => ({
    get: async () => snap(path),
    set: async (data, opt) => write(path, data, opt),
    onSnapshot(cb) {
      const fn = () => cb(snap(path));
      if (!subs.has(path)) subs.set(path, new Set());
      subs.get(path).add(fn);
      fn();
      return () => subs.get(path).delete(fn);
    },
    collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
  });
  return { collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }), docs, write };
}

const cal = { H: [1, 0, 0, 0, 1, 0, 0, 0, 1], width: 1280, height: 720 };
const station = (over = {}) => ({
  uid: "me",
  setup: { version: 1, cameras: [{ deviceId: "dev", label: "OBS", cal }] },
  station: { name: "Linux computer", seen: Date.now(), running: true },
  ...over,
});
const dart = (seq, label) => ({ seq, type: "dart", label, target: label.slice(1), ring: label[0], app: { x: 0, y: -0.58 }, real: { x: 0, y: -0.6 } });

test("a page gets the station's darts from when it starts listening, in order, and nothing older", async (t) => {
  const db = fakeDb();
  db.write("cameraStations/me", station());
  db.write("cameraStations/me/events/latest", { seq: 100, events: [dart(99, "T19"), { seq: 100, type: "check", warning: null, cameras: [{ label: "OBS", ok: true, moved: 0.4 }] }] });
  const got = [];
  const w = C.createRemoteWatcher(db, "me", { onEvent: (e) => got.push(e) });
  t.after(() => w.stop());
  await w.start();
  // Connecting, online and the station's last check, in whichever order the account sends them;
  // then ready, once (after the check, so a page can show its warning).
  const types = got.map((e) => e.type);
  assert.deepEqual(types.slice().sort(), ["check", "ready", "status", "status"]);
  assert.equal(types[types.length - 1], "ready");
  assert.ok(got.some((e) => e.type === "status" && /Linux computer/.test(e.text)));
  got.length = 0;
  db.write("cameraStations/me/events/latest", { seq: 101, events: [dart(99, "T19"), dart(101, "T20")] });
  db.write("cameraStations/me/events/latest", { seq: 103, events: [dart(101, "T20"), { seq: 102, type: "takeout", darts: 3 }, dart(103, "S5"), { seq: 103.5, type: "ready" }] });
  assert.deepEqual(got.map((e) => e.label || e.type), ["T20", "takeout", "S5"], "each once, in order; the station restarting is not passed on");
  // "The board is clear now" from this page reaches the station as a request.
  w.markEmpty();
  assert.ok(db.docs.get("cameraStations/me").ask.clear);
  w.stop();
  db.write("cameraStations/me/events/latest", { seq: 104, events: [dart(104, "D16")] });
  assert.equal(got.length, 3, "nothing after stopping");
});

test("a station that is off, not calibrated, or missing says so", async (t) => {
  const db = fakeDb();
  await assert.rejects(C.createRemoteWatcher(db, "me", {}).start(), /No camera station/);
  db.write("cameraStations/me", station({ station: { name: "Linux computer", seen: Date.now() - 10 * 60000 } }));
  let got = [];
  let w = C.createRemoteWatcher(db, "me", { onEvent: (e) => got.push(e) });
  await w.start();
  assert.ok(got.some((e) => e.type === "error" && /isn't running/.test(e.text)), "off");
  assert.ok(!got.some((e) => e.type === "ready"));
  // It starts: the page carries on by itself.
  db.write("cameraStations/me/events/latest", { seq: 5, events: [] });
  db.write("cameraStations/me", { station: { seen: Date.now() } }, { merge: true });
  assert.ok(got.some((e) => e.type === "status" && /Watching/.test(e.text)), "back on");
  w.stop();
  db.write("cameraStations/me", { setup: { version: 1, cameras: [{ deviceId: "dev", label: "OBS", cal: null }] } }, { merge: true });
  got = [];
  w = C.createRemoteWatcher(db, "me", { onEvent: (e) => got.push(e) });
  await w.start();
  assert.ok(got.some((e) => e.type === "error" && /calibrated/.test(e.text)), "not calibrated");
  w.stop();
});

test("a page uses the station when it is running, and nothing when there are no cameras at all", async () => {
  const db = fakeDb();
  assert.equal(await C.chooseWatcher({ db, user: { uid: "me" }, onEvent() {} }), null);
  assert.equal(await C.chooseWatcher({ db, user: null, onEvent() {} }), null);
  db.write("cameraStations/me", station());
  const w = await C.chooseWatcher({ db, user: { uid: "me" }, onEvent() {} });
  assert.ok(w && w.remote, "the station");
});

test("events are slimmed down for passing on, and chatty ones dropped", () => {
  const big = { type: "dart", index: 2, label: "T20", target: "20", ring: "T", points: 60, app: { x: 0.0123456789, y: -0.58 }, real: { x: 0.01, y: -0.6 }, uncertain: false, confidence: 0.91234, method: "overlap", nearWire: true, labels: ["T20", "T20"], readings: [{ board: new Float32Array(3000) }] };
  const slim = C.slimEvent(big);
  assert.equal(slim.readings, undefined);
  assert.equal(slim.app.x, 0.01235);
  assert.equal(slim.confidence, 0.912);
  assert.ok(JSON.stringify(slim).length < 400);
  for (const type of ["moving", "quiet", "status"]) assert.equal(C.slimEvent({ type }), null);
  assert.deepEqual(C.slimEvent({ type: "takeout", darts: 3 }), { type: "takeout", darts: 3 });
  assert.equal(C.isOnline(station()), true);
  assert.equal(C.isOnline(station({ station: { seen: Date.now() - 5 * 60000 } })), false);
});

test("starting the station again keeps the calibrations of the cameras it already had", async () => {
  const db = fakeDb();
  const other = { H: [2, 0, 0, 0, 2, 0, 0, 0, 1], width: 1280, height: 720 };
  db.write("cameraStations/me", station({ setup: { version: 1, cameras: [{ deviceId: "a", label: "NexiGo", cal }, { deviceId: "b", label: "NexiGo", cal: other }] } }));
  // The station page picks its cameras before it starts (a fresh page, nothing read yet).
  const st = C.createStation({ db, uid: "me", name: "Linux computer" });
  await st.choose([{ deviceId: "a", label: "NexiGo" }, { deviceId: "b", label: "NexiGo" }]);
  let cams = db.docs.get("cameraStations/me").setup.cameras;
  assert.deepEqual(cams.map((c) => c.cal && c.cal.H[0]), [1, 2], "both calibrations kept");
  // A different second camera loses only its own calibration.
  await st.choose([{ deviceId: "a", label: "NexiGo" }, { deviceId: "c", label: "Integrated Camera" }]);
  cams = db.docs.get("cameraStations/me").setup.cameras;
  assert.deepEqual(cams.map((c) => [c.deviceId, c.cal ? c.cal.H[0] : null]), [["a", 1], ["c", null]]);
});

test("the board's lighting setting is kept in the account alongside the cameras", async () => {
  const db = fakeDb();
  db.write("cameraStations/me", station());
  await C.setStationOptions(db, "me", { shadow: true });
  const st = C.createStation({ db, uid: "me", name: "Linux computer" });
  await st.choose([{ deviceId: "dev", label: "OBS" }]);
  await C.saveStationSetup(db, "me", db.docs.get("cameraStations/me").setup.cameras);
  const setup = db.docs.get("cameraStations/me").setup;
  assert.deepEqual(setup.options, { shadow: true }, "kept through choosing cameras and saving calibrations");
  assert.ok(setup.cameras[0].cal, "and the calibration with it");
});

test("each saved camera is found among those plugged in now, never one camera for two", () => {
  const nexi = "NexiGo N660P FHD Webcam (1bcf:2284)";
  const saved = [{ deviceId: "a", label: nexi }, { deviceId: "b", label: nexi }];
  const ids = (list) => list.map((d) => (d ? d.deviceId : null));
  // As they were.
  assert.deepEqual(ids(C.matchCameras(saved, [{ deviceId: "x", label: "Integrated Camera" }, { deviceId: "b", label: nexi }, { deviceId: "a", label: nexi }])), ["a", "b"]);
  // Plugged in again under new ids (Linux numbers them as they come): one each, by name.
  assert.deepEqual(ids(C.matchCameras(saved, [{ deviceId: "x", label: "Integrated Camera" }, { deviceId: "c", label: nexi }, { deviceId: "d", label: nexi }])), ["c", "d"]);
  // One back under its old id, the other under a new one.
  assert.deepEqual(ids(C.matchCameras(saved, [{ deviceId: "c", label: nexi }, { deviceId: "b", label: nexi }])), ["c", "b"]);
  // Only one plugged in: the other is missing, not given the same camera.
  assert.deepEqual(ids(C.matchCameras(saved, [{ deviceId: "c", label: nexi }])), ["c", null]);
  assert.deepEqual(ids(C.matchCameras(saved, [])), [null, null]);
  // An id that now belongs to a camera of another name isn't that camera.
  assert.deepEqual(ids(C.matchCameras([{ deviceId: "a", label: nexi }], [{ deviceId: "a", label: "Integrated Camera" }])), [null]);
  // OBS's virtual camera, both halves calibrated: one camera for both, as saved.
  const obs = [{ deviceId: "o", label: "OBS Virtual Camera" }, { deviceId: "o", label: "OBS Virtual Camera" }];
  assert.deepEqual(ids(C.matchCameras(obs, [{ deviceId: "o2", label: "OBS Virtual Camera" }])), ["o2", "o2"]);
  // Nothing saved for a slot.
  assert.deepEqual(ids(C.matchCameras([null, { deviceId: "a", label: nexi }], [{ deviceId: "a", label: nexi }])), [null, "a"]);
});

test("choosing a camera of the same model under a new id keeps its calibration", async () => {
  const db = fakeDb();
  const other = { H: [2, 0, 0, 0, 2, 0, 0, 0, 1], width: 1280, height: 720 };
  db.write("cameraStations/me", station({ setup: { version: 1, cameras: [{ deviceId: "a", label: "NexiGo", cal }, { deviceId: "b", label: "NexiGo", cal: other }] } }));
  const st = C.createStation({ db, uid: "me", name: "Linux computer" });
  // Plugged in again, both under new ids: the calibrations stay (the station sorts out which is which).
  await st.choose([{ deviceId: "c", label: "NexiGo" }, { deviceId: "d", label: "NexiGo" }]);
  let cams = db.docs.get("cameraStations/me").setup.cameras;
  assert.deepEqual(cams.map((c) => [c.deviceId, c.cal && c.cal.H[0]]), [["c", 1], ["d", 2]]);
  // Then one isn't plugged in: the page keeps it chosen as saved, and so its calibration.
  await st.choose([{ deviceId: "e", label: "NexiGo" }, { deviceId: "d", label: "NexiGo" }]);
  cams = db.docs.get("cameraStations/me").setup.cameras;
  assert.deepEqual(cams.map((c) => [c.deviceId, c.cal && c.cal.H[0]]), [["e", 1], ["d", 2]]);
});

test("the two cameras are swapped only when the calibrations fit the board clearly better that way", () => {
  const at = (shift) => ({ refined: { shift } });
  // Plugged in the other way round: neither fits as saved, both fit swapped.
  assert.equal(C.otherWayFits([null, null], [at(0.2), at(0.4)]), true);
  // Swapped, and one camera has something in front of it.
  assert.equal(C.otherWayFits([null, null], [at(0.2), null]), true);
  // Two cameras close together seem to fit each other's calibrations, only far off.
  assert.equal(C.otherWayFits([at(18), at(16)], [at(0.1), at(0.2)]), true);
  // One camera blocked, the other as saved: leave them.
  assert.equal(C.otherWayFits([at(0.3), null], [null, null]), false);
  assert.equal(C.otherWayFits([at(0.3), null], [null, at(0.6)]), false);
  // One camera knocked: it was followed, and the other way round is no better.
  assert.equal(C.otherWayFits([at(9), at(0.2)], [at(17), at(14)]), false);
  assert.equal(C.otherWayFits([at(9), at(0.2)], [null, null]), false);
  // Nothing fits either way.
  assert.equal(C.otherWayFits([null, null], [null, null]), false);
});

test("a check event says whether the cameras were swapped back", () => {
  const slim = C.slimEvent({ type: "check", warning: null, swapped: true, cameras: [{ label: "NexiGo", ok: true, moved: 0.123 }, { label: "NexiGo", ok: true, moved: 0.4 }] });
  assert.equal(slim.swapped, true);
  assert.deepEqual(slim.cameras.map((c) => c.moved), [0.12, 0.4]);
  assert.equal(C.slimEvent({ type: "check", cameras: [] }).swapped, false);
});

// ---- one reader of the board, and calibrating with no taps ------------------------------------------
const V = require("../public/board-vision.js");
const S = require("./board-sim.cjs");
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

// This browser's own camera setup, as the pages keep it (localStorage), for the length of a test.
function withLocalCameras(t, cameras) {
  const store = new Map([[C.KEY, JSON.stringify({ version: 1, cameras })]]);
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  t.after(() => { delete global.localStorage; });
}

test("an account with a camera station uses it and nothing else, even when it isn't running", async (t) => {
  // The case of Nov 16, 2026: cameras set up in this browser too, and the station closed. The page
  // must wait for the station, not open the cameras itself: both reading would enter every dart twice.
  withLocalCameras(t, [{ deviceId: "dev", label: "NexiGo", cal }]);
  const db = fakeDb();
  db.write("cameraStations/me", station({ station: { name: "Linux computer", seen: Date.now() - 20 * 3600 * 1000 } }));
  const got = [];
  const w = await C.chooseWatcher({ db, user: { uid: "me" }, onEvent: (e) => got.push(e) });
  t.after(() => w.stop());
  assert.equal(w.remote, true, "the station, though it is off");
  await w.start();
  assert.ok(got.some((e) => e.type === "error" && /isn't running/.test(e.text)), "and the page says it isn't running");
  // A station that said it stopped counts as off at once, not 90 seconds later.
  assert.equal(C.isOnline(station({ station: { seen: Date.now(), on: false } })), false);
  assert.equal(C.isOnline(station({ station: { seen: Date.now(), on: true } })), true);
  // Chosen cameras that aren't calibrated yet are a station too (it calibrates them itself).
  assert.equal(C.hasStation({ setup: { cameras: [{ deviceId: "a", label: "NexiGo", cal: null }] } }), true);
  assert.equal(C.hasStation({ station: { seen: 5 } }), true);
  assert.equal(C.hasStation({ setup: { cameras: [] } }), false);
  assert.equal(C.hasStation(null), false);
});

test("with no station in the account, this browser's cameras are used, until a station turns up", async (t) => {
  withLocalCameras(t, [{ deviceId: "dev", label: "NexiGo", cal }]);
  const db = fakeDb();
  const w = await C.chooseWatcher({ db, user: { uid: "me" }, onEvent() {} });
  assert.ok(w && w.remote === false, "this browser's cameras");
  assert.equal(typeof w.markEmpty, "function");
  // Not signed in: the same, with no account to watch for a station.
  const alone = await C.chooseWatcher({ db: null, user: null, onEvent() {} });
  assert.ok(alone && !alone.remote);
  // A station set up meanwhile: the next page to ask gets the station.
  db.write("cameraStations/me", station());
  const next = await C.chooseWatcher({ db, user: { uid: "me" }, onEvent() {} });
  assert.equal(next.remote, true);
});

// A camera station page, with what it said and whether it had the station.
function stationPage(db, name) {
  const said = [], lease = [];
  const st = C.createStation({ db, uid: "me", name, onStatus: (text) => said.push(text), onLease: (l) => lease.push(l) });
  return { st, said, lease };
}
const owner = (db) => (db.docs.get("cameraStations/me").station || {}).id;

test("one camera station at a time: a second stands by, and takes over when the first stops", async (t) => {
  const db = fakeDb();
  const a = stationPage(db, "Linux computer"), b = stationPage(db, "Other computer");
  t.after(() => { a.st.stop(); b.st.stop(); });
  await a.st.start();
  await tick();
  assert.equal(a.st.active, true);
  assert.equal(owner(db), a.st.id, "the first has the station");
  assert.equal(db.docs.get("cameraStations/me").station.on, true);
  await b.st.start();
  await tick();
  assert.equal(b.st.active, false, "the second stands by");
  assert.equal(owner(db), a.st.id);
  assert.ok(/already running/.test(b.said[b.said.length - 1]), b.said[b.said.length - 1]);
  assert.deepEqual(b.lease[b.lease.length - 1].active, false);
  // Standing by writes nothing: the first one's word in the account is untouched.
  assert.equal(db.docs.get("cameraStations/me").station.name, "Linux computer");
  a.st.stop();
  await tick(20);
  assert.equal(b.st.active, true, "the first stopped: the second takes over by itself");
  assert.equal(owner(db), b.st.id);
  assert.equal(db.docs.get("cameraStations/me").station.on, true);
});

test("taking the station over makes the one that had it give way, and it comes back when that one stops", async (t) => {
  const db = fakeDb();
  const a = stationPage(db, "Linux computer"), b = stationPage(db, "Other computer");
  t.after(() => { a.st.stop(); b.st.stop(); });
  await a.st.start();
  await b.st.start({ takeOver: true });
  await tick(20);
  assert.equal(owner(db), b.st.id, "the second has it");
  assert.equal(b.st.active, true);
  assert.equal(a.st.active, false, "the first gave way");
  assert.equal(a.lease[a.lease.length - 1].gaveWay, true);
  // The one that gave way doesn't say "stopped" over the other's sign of life.
  assert.equal(db.docs.get("cameraStations/me").station.on, true);
  // A page standing by can be told to take it.
  await a.st.takeOver();
  await tick(20);
  assert.equal(owner(db), a.st.id);
  assert.equal(b.st.active, false);
  a.st.stop();
  await tick(20);
  assert.equal(b.st.active, true, "and takes over again by itself");
});

test("a station that went quiet, or said it stopped, is taken over; one still running is not", async (t) => {
  // Gone quiet two minutes ago (the computer went to sleep): free to take.
  let db = fakeDb();
  db.write("cameraStations/me", station({ station: { id: "old", host: "elsewhere", name: "Old computer", on: true, seen: Date.now() - 120000, running: true } }));
  const a = stationPage(db, "Linux computer");
  t.after(() => a.st.stop());
  await a.st.start();
  await tick();
  assert.equal(a.st.active, true);
  // A station from before stations claimed the account (no id), still giving signs of life: wait.
  db = fakeDb();
  db.write("cameraStations/me", station({ station: { name: "Linux computer", seen: Date.now(), running: true, status: "Watching with 2 cameras." } }));
  const b = stationPage(db, "Second tab");
  t.after(() => b.st.stop());
  await b.st.start();
  await tick();
  assert.equal(b.st.active, false, "it may still be running");
  // It stops (as the older page says it): the new one takes over.
  db.write("cameraStations/me", { station: { seen: Date.now(), running: false, status: "Stopped." } }, { merge: true });
  await tick(20);
  assert.equal(b.st.active, true);
  assert.equal(owner(db), b.st.id);
});

// A picture as the station takes it (a canvas), from the test rig.
function canvasOf(cam, darts = []) {
  const full = { crop: { sx: 0, sy: 0, sw: cam.width, sh: cam.height }, width: cam.width, height: cam.height };
  const image = S.renderer(cam, full, { noise: 3, seed: 5, smooth: 2 })(darts);
  return { width: image.width, height: image.height, getContext: () => ({ getImageData: () => image }) };
}
function worstOff(cam, calibration) {
  const m = V.mapper(calibration);
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

test("a camera is calibrated from what it shows, with no taps: found, followed when knocked, found again when moved", () => {
  const spec = { pos: { x: 175, y: -55, z: 400 }, width: 1280, height: 720, hfov: 80, bend: -0.08 };
  const cam = S.camera(spec);
  // No calibration at all: the board is found in the picture.
  const first = C.calibrateFrom(null, canvasOf(cam), false, 0);
  assert.ok(first && first.how === "found" && first.moved === null, "found");
  assert.ok(worstOff(cam, first.cal) < 0.6, `found within ${worstOff(cam, first.cal).toFixed(2)} mm`);
  assert.equal(first.cal.auto, true);
  assert.ok(first.cal.refined.edges >= C.GOOD_EDGES && first.cal.refined.rms <= C.GOOD_RMS);
  // Knocked a little (with darts in the board): the calibration follows it, and says how far.
  const knocked = S.camera(Object.assign({}, spec, { pos: { x: 181, y: -50, z: 396 }, look: { x: 4, y: 3, z: 0 } }));
  const darts = [{ at: { x: 6, y: -101 }, lean: { x: 0.05, y: -0.25 } }, { at: { x: 40, y: 60 }, lean: { x: 0.1, y: -0.3 } }];
  const second = C.calibrateFrom(first.cal, canvasOf(knocked, darts), false, 0);
  assert.ok(second && second.how === "followed", "followed");
  assert.ok(second.moved > 3 && second.moved < 12, `moved ${second.moved.toFixed(1)} mm`);
  assert.ok(worstOff(knocked, second.cal) < 0.8);
  assert.equal(second.cal.points.length, 5);
  // Moved right across (put up somewhere else): the old calibration is no use, and the board is found afresh.
  const moved = S.camera(Object.assign({}, spec, { pos: { x: -150, y: -90, z: 430 }, look: { x: -20, y: 10, z: 0 } }));
  const third = C.calibrateFrom(second.cal, canvasOf(moved), false, 0);
  assert.ok(third && third.how === "found", "found again");
  assert.ok(third.moved > 25, `it says how far: ${third.moved.toFixed(0)} mm`);
  assert.ok(worstOff(moved, third.cal) < 0.6);
  // Nothing to see: no calibration, and nothing thrown.
  const blank = { width: 1280, height: 720, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(1280 * 720 * 4).fill(30), width: 1280, height: 720 }) }) };
  assert.equal(C.calibrateFrom(null, blank, false, 0), null);
  assert.equal(C.calibrateFrom(first.cal, blank, false, 0), null);
  assert.equal(C.calibrateFrom(null, null, false, 0), null);
});

test("\"calibrate again\" from another computer reaches the station, and its answer comes back", async () => {
  const db = fakeDb();
  db.write("cameraStations/me", station());
  // A station that answers every request with how it went.
  const stop = db.collection("cameraStations").doc("me").onSnapshot((snap) => {
    const d = snap.data();
    if (d.ask && d.ask.calibrate && !(d.station.calibrated && d.station.calibrated.for === d.ask.calibrate)) {
      db.write("cameraStations/me", { station: { calibrated: { for: d.ask.calibrate, at: 1, cameras: [{ ok: true, how: "followed", moved: 1.4, edges: 431, rms: 0.93 }] } } }, { merge: true });
    }
  });
  const done = await C.requestCalibration(db, "me", 2000);
  stop();
  assert.equal(done.cameras[0].how, "followed");
  assert.equal(done.cameras[0].edges, 431);
  // No station answering: it says so rather than waiting for ever.
  await assert.rejects(C.requestCalibration(db, "me", 60), /didn't answer/);
});

// ---- sharing the cameras with OBS (for DartCounter) -------------------------------------------------
// A station with the two NexiGo cameras chosen, told which cameras are plugged in by the test.
function obsRig(t, cameras) {
  const db = fakeDb();
  db.write("cameraStations/me", { uid: "me", setup: { version: 1, cameras: cameras || [{ deviceId: "a", label: "NexiGo N660P FHD Webcam", cal }, { deviceId: "b", label: "NexiGo N660P FHD Webcam", cal }] } });
  const plugged = [{ deviceId: "a", label: "NexiGo N660P FHD Webcam" }, { deviceId: "b", label: "NexiGo N660P FHD Webcam" }];
  const said = [];
  const st = C.createStation({ db, uid: "me", name: "Linux computer", onStatus: (text) => said.push(text), devices: async () => plugged.slice(), obsTiming: { look: 15, gone: 60, wait: 200 } });
  t.after(() => st.stop());
  const obs = { deviceId: "o", label: "OBS" };
  return { db, st, said, last: () => said[said.length - 1], record: () => db.docs.get("cameraStations/me").station,
    obsOn: () => { if (!plugged.includes(obs)) plugged.push(obs); }, obsOff: () => { const i = plugged.indexOf(obs); if (i >= 0) plugged.splice(i, 1); } };
}

test("while OBS runs the station leaves the cameras alone, and takes them back by itself when OBS closes", async (t) => {
  const r = obsRig(t);
  await r.st.start();
  await tick(40);
  assert.equal(r.st.resting, false, "no OBS: the station has the cameras");
  // OBS starts (its virtual camera appears among the cameras).
  r.obsOn();
  await tick(60);
  assert.equal(r.st.resting, true, "it lets go");
  assert.ok(/OBS is running and has the cameras/.test(r.last()), r.last());
  assert.equal(r.record().resting, true, "and the account says so, for the games");
  assert.equal(r.record().running, false);
  // A game page says whose the cameras are, and what to do.
  const got = [];
  const w = C.createRemoteWatcher(r.db, "me", { onEvent: (e) => got.push(e) });
  t.after(() => w.stop());
  await w.start();
  assert.ok(got.some((e) => e.type === "error" && /OBS has the cameras on Linux computer\. Close OBS there/.test(e.text)), JSON.stringify(got));
  assert.equal(w.down, "OBS has the cameras");
  // OBS closes: not straight away (it may only be starting again), then the cameras are taken back.
  r.obsOff();
  await tick(35);
  assert.equal(r.st.resting, true, "a moment's grace for OBS to come back");
  await tick(120);
  assert.equal(r.st.resting, false, "then the station takes the cameras back");
  assert.equal(r.record().resting, false);
  assert.ok(r.said.some((s) => /OBS has closed/.test(s)));
});

test("OBS started again within the grace keeps the cameras: the station doesn't snatch them in between", async (t) => {
  const r = obsRig(t);
  await r.st.start();
  r.obsOn();
  await tick(50);
  assert.equal(r.st.resting, true);
  for (let k = 0; k < 4; k += 1) { // closed and opened again, over and over, quicker than the grace
    r.obsOff();
    await tick(30);
    r.obsOn();
    await tick(30);
  }
  assert.equal(r.st.resting, true, "still OBS's");
  assert.ok(!r.said.some((s) => /OBS has closed/.test(s)), "never taken back in between");
});

test("\"Let OBS have the cameras\": freed before OBS starts, back after it closes, and back anyway if OBS never comes", async (t) => {
  const r = obsRig(t);
  await r.st.start();
  await tick(30);
  r.st.rest();
  assert.equal(r.st.resting, true);
  assert.ok(/free for OBS: start OBS now/.test(r.last()), r.last());
  await tick(60);
  assert.equal(r.st.resting, true, "it waits for OBS");
  r.obsOn();
  await tick(50);
  assert.ok(/OBS is running and has the cameras/.test(r.last()), r.last());
  r.obsOff();
  await tick(150);
  assert.equal(r.st.resting, false, "OBS came and went: the station has the cameras again");
  // Asked for, but OBS never starts: it doesn't wait for ever.
  r.st.rest();
  assert.equal(r.st.resting, true);
  await tick(320);
  assert.equal(r.st.resting, false);
  assert.ok(r.said.some((s) => /OBS didn't start/.test(s)));
  // And it can be told to take them back at once.
  r.st.rest();
  r.st.resume();
  assert.equal(r.st.resting, false);
});

test("a station set up on OBS's own picture reads it: OBS running is no reason to let go", async (t) => {
  const r = obsRig(t, [{ deviceId: "o", label: "OBS", cal }, { deviceId: "o", label: "OBS", cal }]);
  r.obsOn();
  await r.st.start();
  await tick(60);
  assert.equal(r.st.resting, false);
  r.st.rest();
  assert.equal(r.st.resting, false, "nothing to hand over");
});
