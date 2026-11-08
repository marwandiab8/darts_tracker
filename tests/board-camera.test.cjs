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
