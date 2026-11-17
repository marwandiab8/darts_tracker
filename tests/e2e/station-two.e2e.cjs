// The camera station with TWO cameras of the same model, as on the real rig (two NexiGo webcams
// with one name), from set-up to a dart in a game. The page's cameras are stand-ins: two canvases
// showing the test rig's pictures of one board from the left and from the right, which the test
// swaps to knock a camera, move one, block one, and throw a dart.
//   - "Set up the cameras": both are found and calibrated with no taps; the one to the left of the
//     board is Camera 1, whichever order the computer lists them in;
//   - a dart: both cameras see it, the station reads it, and the tracker on another device (with
//     cameras set up in its own browser too) enters it once; pulling it out ends the visit;
//   - a camera knocked a little is followed by "Calibrate again", one moved right across has its
//     board found afresh, and one with something in front of it keeps its calibration;
//   - a knock is followed and saved when the station next starts;
//   - "Set up the cameras again" with one camera blocked leaves the set-up as it was.
const H = require("./harness.cjs");
const S = require("../board-sim.cjs");
const V = require("../../public/board-vision.js");
const fs = require("fs");
const path = require("path");
const { doc, getDoc } = require("firebase/firestore");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { check, failed } = H.checker();

// A 24-bit BMP of an RGBA picture (what the stand-in cameras show).
function bmp(image) {
  const { width: w, height: h, data } = image, row = Math.ceil((w * 3) / 4) * 4, out = Buffer.alloc(54 + row * h);
  out.write("BM", 0); out.writeUInt32LE(out.length, 2); out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14); out.writeInt32LE(w, 18); out.writeInt32LE(h, 22); out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y += 1) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x += 1) { const i = (y * w + x) * 4; out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i]; }
  }
  return out;
}

// Two cameras for the page, both called "NexiGo N660P FHD Webcam": each a canvas showing a picture
// from /__cam/<name>.bmp, changed with window.__show(i, name). The first listed is the RIGHT camera.
const twoCameras = `(() => {
  const cams = ["right", "left"].map((first, i) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext("2d");
    const cam = { id: "nexigo-" + i, canvas, img: null, opened: 0 };
    cam.show = (name) => new Promise((done) => { const img = new Image(); img.onload = () => { cam.img = img; ctx.drawImage(img, 0, 0); done(); }; img.src = "/__cam/" + name + ".bmp"; });
    cam.show(first + "-empty");
    setInterval(() => { if (cam.img) ctx.drawImage(cam.img, 0, 0); }, 100);
    return cam;
  });
  window.__show = (i, name) => cams[i].show(name);
  window.__opened = () => cams.map((c) => c.opened);
  const md = navigator.mediaDevices;
  md.enumerateDevices = async () => cams.map((c) => ({ kind: "videoinput", deviceId: c.id, label: "NexiGo N660P FHD Webcam", groupId: "" }));
  md.getUserMedia = async (constraints) => {
    const v = constraints && constraints.video, want = v && v.deviceId ? v.deviceId.exact || v.deviceId : null;
    const cam = cams.find((c) => c.id === want) || cams[0];
    cam.opened += 1;
    return cam.canvas.captureStream(10);
  };
  md.addEventListener = () => {};
})();`;

(async () => {
  const size = { width: 1280, height: 720 }, full = { crop: { sx: 0, sy: 0, sw: 1280, sh: 720 }, width: 1280, height: 720 };
  const rig = {
    left: S.camera(Object.assign({ pos: { x: -170, y: -60, z: 420 }, hfov: 78 }, size)),
    right: S.camera(Object.assign({ pos: { x: 170, y: -60, z: 420 }, hfov: 78 }, size)),
    // The right camera knocked a few millimetres; the left one put up somewhere else altogether.
    rightKnocked: S.camera(Object.assign({ pos: { x: 176, y: -55, z: 416 }, look: { x: 4, y: 3, z: 0 }, hfov: 78 }, size)),
    leftMoved: S.camera(Object.assign({ pos: { x: -110, y: 120, z: 440 }, look: { x: -15, y: 10, z: 0 }, hfov: 78 }, size)),
  };
  const dart = [{ at: { x: 2, y: -103 }, lean: { x: 0.05, y: -0.25 } }]; // treble 20
  const draw = (cam, darts, seed) => S.renderer(cam, full, { noise: 0, seed, smooth: 2, shadow: 0.95 })(darts);
  const pictures = {
    "left-empty": draw(rig.left, [], 5), "right-empty": draw(rig.right, [], 6),
    "left-dart": draw(rig.left, dart, 5), "right-dart": draw(rig.right, dart, 6),
    "right-knocked": draw(rig.rightKnocked, [], 6), "left-moved": draw(rig.leftMoved, [], 5),
    blocked: { data: new Uint8ClampedArray(1280 * 720 * 4).fill(70), width: 1280, height: 720 },
  };
  const files = {};
  for (const [name, image] of Object.entries(pictures)) files[name] = bmp(image);
  const worstOff = (cam, cal) => {
    const m = V.mapper(cal);
    let worst = 0;
    for (const r of [V.REAL.bullOut, 0.35, V.REAL.tripleIn, V.REAL.tripleOut, 0.8, V.REAL.doubleIn, 1]) {
      for (let k = 0; k < 60; k += 1) {
        const a = (k / 60) * Math.PI * 2, p = cam.project({ x: Math.cos(a) * r * S.R, y: Math.sin(a) * r * S.R, z: 0 });
        const b = m.toBoard(p.x, p.y);
        worst = Math.max(worst, b ? Math.hypot(b.x - Math.cos(a) * r, b.y - Math.sin(a) * r) * S.R : Infinity);
      }
    }
    return worst;
  };

  const server = await H.startServer();
  const browser = await H.launch();
  let env = null;
  try {
    const base = `http://127.0.0.1:${H.PORT}`;
    const rules = fs.readFileSync(path.join(H.REPO, "firestore.rules"), "utf8");
    env = await initializeTestEnvironment({ projectId: H.PROJECT, firestore: { host: "127.0.0.1", port: 8080, rules } });
    await env.clearFirestore();
    const until = async (fn, ms = 30000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch (_) { v = null; } if (v) return v; await H.sleep(200); } return v; };
    const text = (p, id) => p.evaluate((i) => document.getElementById(i).textContent, id);

    const tab = await H.device(browser, "station", { viewport: { width: 1100, height: 1400 } });
    await tab.context().route("**/__cam/*.bmp", (route) => {
      const name = /__cam\/(.+)\.bmp/.exec(route.request().url())[1];
      return files[name] ? route.fulfill({ body: files[name], contentType: "image/bmp" }) : route.abort();
    });
    await tab.context().addInitScript(twoCameras);
    tab.on("dialog", (d) => d.accept());
    await tab.goto(`${base}/station.html`);
    const uid = await H.signIn(tab);
    const get = async (...at) => { let out = null; await env.withSecurityRulesDisabled(async (ctx) => { const s = await getDoc(doc(ctx.firestore(), ...at)); out = s.exists() ? s.data() : null; }); return out; };
    const read = () => get("cameraStations", uid);
    const watching = (ms = 45000) => until(async () => /Watching the board/.test(await text(tab, "stateText")), ms);

    // ---- set up: both cameras, nothing chosen, nothing tapped ------------------------------------
    await until(() => tab.evaluate(() => !document.getElementById("setupCard").classList.contains("hidden")), 15000);
    await tab.click("#setupBtn");
    check(await watching(60000), "two cameras of one model: found, calibrated and watched: " + (await text(tab, "status")));
    let d = await until(async () => { const x = await read(); return x && x.station && x.station.running ? x : null; }, 10000) || await read();
    const cams = (d.setup && d.setup.cameras) || [];
    check(cams.length === 2 && cams.every((c) => c.cal && c.cal.auto), "both are the station's cameras, each calibrated by itself");
    check(cams.length === 2 && cams[0].deviceId === "nexigo-1" && cams[1].deviceId === "nexigo-0", "the one to the left of the board is Camera 1, though the computer lists it second: " + cams.map((c) => c.deviceId).join(", "));
    check(cams.length === 2 && worstOff(rig.left, cams[0].cal) < 1 && worstOff(rig.right, cams[1].cal) < 1, `each calibration is its own camera's (${cams.length === 2 ? worstOff(rig.left, cams[0].cal).toFixed(2) + " and " + worstOff(rig.right, cams[1].cal).toFixed(2) : "?"} mm off)`);
    check(/Watching with 2 cameras/.test(await text(tab, "status")), "the page says it watches with both: " + (await text(tab, "status")));
    await until(() => tab.evaluate(() => document.querySelectorAll("#cams .cam canvas").length === 2), 8000);
    check(await tab.evaluate(() => document.querySelectorAll("#cams .cam canvas").length === 2 && /Camera 1/.test(document.querySelector("#cams").textContent) && /Camera 2/.test(document.querySelector("#cams").textContent)), "and shows each camera's picture with its outline");

    // ---- a dart, into a game on another device, once ----------------------------------------------
    // That device has cameras set up in its own browser too: it must still take the station's darts only.
    const local = JSON.stringify({ version: 1, cameras: cams });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_cameraSetup: local, dt_trackerCamera: "1" } });
    ipad.on("dialog", (x) => x.accept());
    await ipad.goto(`${base}/index.html`);
    await H.signIn(ipad);
    await ipad.waitForFunction(() => /Connected/.test(document.getElementById("syncText").textContent), null, { timeout: 20000 });
    check(await until(async () => /watching the board/i.test(await ipad.evaluate(() => document.getElementById("camNote").textContent)), 20000), "the tracker on the iPad follows the station");
    await H.sleep(2500); // the station's cameras settle on the empty board
    await tab.evaluate(() => Promise.all([window.__show(0, "right-dart"), window.__show(1, "left-dart")]));
    const live = async () => { const x = await get("liveSessions", uid); return x ? JSON.parse(x.state) : null; };
    const seen = await until(async () => { const e = await get("cameraStations", uid, "events", "latest"); return e && e.events.find((x) => x.type === "dart"); }, 20000);
    check(seen && seen.label === "T20", "a dart in the treble 20: both cameras see it and the station reads " + (seen ? seen.label : "nothing"));
    const session = await until(async () => { const s = await live(); return s && s.thrown && s.thrown["20"] ? s : null; }, 15000);
    check(session && session.thrown["20"] === 1 && session.entry["20"][0] === "T", "the tracker enters it at 20 as a treble");
    await H.sleep(2500);
    const after = await live();
    check(after && after.thrown["20"] === 1 && !after.thrown["19"] && after.darts["20"].length === 1, "once: one dart thrown, one dart in the session");
    check(after && after.darts["20"][0].q > 0, "and it is the station's dart (it carries the station's count)");
    await tab.evaluate(() => Promise.all([window.__show(0, "right-empty"), window.__show(1, "left-empty")]));
    const out = await until(async () => { const e = await get("cameraStations", uid, "events", "latest"); return e && e.events.find((x) => x.type === "takeout"); }, 25000);
    check(out, "the dart pulled out: the station sees the take-out");
    const closed = await until(async () => { const s = await live(); return s && s.thrown["20"] === 3 ? s : null; }, 15000);
    check(closed && closed.pulled === true && !closed.thrown["19"], "which ends the visit at 20 (the two darts not thrown are misses there, nothing spills to 19)");
    // What the detector made of it is kept for looking at afterwards.
    const trace = await until(async () => { const x = await read(); const tr = (x.station && x.station.trace) || []; return tr.some((l) => / dart T20 /.test(l)) && tr.some((l) => / takeout 1/.test(l)) ? tr : null; }, 30000);
    check(trace && trace.some((l) => /^\d+:\d\d:\d\d\.\d dart T20 \S.* \d\.\d\d \d+ms$/.test(l)), "the station's trace has the dart, how it was read and how long it took: " + (trace ? trace.find((l) => /dart/.test(l)) : "nothing"));

    // ---- calibrate again: a knock is followed, a move found afresh, a blocked camera kept ----
    const at0 = (await read()).setup.cameras.map((c) => c.cal.at);
    await tab.evaluate(() => window.__show(0, "right-knocked"));
    await H.sleep(600);
    await tab.click("#calBtn");
    d = await until(async () => { const x = await read(); return x.setup.cameras[1].cal.at > at0[1] ? x : null; }, 30000);
    check(d && worstOff(rig.rightKnocked, d.setup.cameras[1].cal) < 1, "camera 2 knocked a few millimetres: Calibrate again follows it" + (d ? ` (${worstOff(rig.rightKnocked, d.setup.cameras[1].cal).toFixed(2)} mm off)` : ""));
    d = await until(async () => { const x = await read(); return x.station.cameras && x.station.cameras[1] && x.station.cameras[1].how === "followed" ? x : null; }, 10000) || await read();
    check(d.station.cameras[1].how === "followed" && d.station.cameras[1].moved > 2, `and says how far it had moved: ${d.station.cameras[1].moved} mm`);
    check(await watching(), "watching goes on with the new calibration");
    const at1 = (await read()).setup.cameras.map((c) => c.cal.at);
    await tab.evaluate(() => Promise.all([window.__show(1, "left-moved"), window.__show(0, "blocked")]));
    await H.sleep(600);
    await tab.click("#calBtn");
    d = await until(async () => { const x = await read(); return x.setup.cameras[0].cal.at > at1[0] ? x : null; }, 30000);
    check(d && worstOff(rig.leftMoved, d.setup.cameras[0].cal) < 1, "camera 1 put up somewhere else: its board is found afresh" + (d ? ` (${worstOff(rig.leftMoved, d.setup.cameras[0].cal).toFixed(2)} mm off)` : ""));
    check(d && d.setup.cameras[1].cal.at === at1[1] && worstOff(rig.rightKnocked, d.setup.cameras[1].cal) < 1, "camera 2 with something in front of it keeps the calibration it had");
    check(await until(async () => /Watching with 2 cameras.*Camera 2 couldn't be matched to the board/.test(await text(tab, "status")), 20000), "and the page goes on saying so while it watches: " + (await text(tab, "status")).slice(0, 150));
    check(await tab.evaluate(() => /Camera 2: kept as it was/.test(document.getElementById("cams").textContent)), "as does that camera's own line");
    await tab.evaluate(() => window.__show(0, "right-knocked"));

    // ---- a knock while the station is off is followed, and saved, when it starts ---------
    await tab.click("#stopBtn");
    await until(async () => /Not running/.test(await text(tab, "stateText")), 10000);
    await tab.evaluate(() => window.__show(0, "right-empty")); // camera 2 back where it began: a few millimetres from its calibration
    const at2 = (await read()).setup.cameras[1].cal.at;
    await tab.click("#startBtn");
    check(await watching(), "started again: " + (await text(tab, "status")));
    d = await until(async () => { const x = await read(); return x.setup.cameras[1].cal.at > at2 ? x : null; }, 15000);
    check(d && worstOff(rig.right, d.setup.cameras[1].cal) < 1, "camera 2 had moved since: followed as it started, and the followed calibration is saved");
    check(d && d.setup.cameras[0].cal.at === (await read()).setup.cameras[0].cal.at && worstOff(rig.leftMoved, d.setup.cameras[0].cal) < 1, "camera 1 hadn't: left as it was");
    check(/Watching with 2 cameras/.test(await text(tab, "status")), "and it watches with both, without starting over: " + (await text(tab, "status")));

    // ---- setting up again with a camera blocked changes nothing --------------------------------
    const kept = JSON.stringify((await read()).setup.cameras.map((c) => [c.deviceId, c.cal.at]));
    await tab.evaluate(() => window.__show(0, "blocked"));
    await H.sleep(600);
    await tab.click("#setupBtn");
    check(await until(async () => /Only 1 of your 2 cameras can see the whole board/.test(await text(tab, "setupMsg")), 45000), "Set up again with one camera blocked: " + (await text(tab, "setupMsg")).slice(0, 110));
    check(JSON.stringify((await read()).setup.cameras.map((c) => [c.deviceId, c.cal.at])) === kept, "the station's cameras and their calibrations are as they were");
    check(await watching(), "and it is watching again with both: " + (await text(tab, "status")).slice(0, 80));

    const errors = [tab, ipad].flatMap((p) => p.errors || []);
    check(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  } catch (error) {
    check(false, "the test ran to the end: " + (error && error.stack || error));
  } finally {
    if (env) await env.clearFirestore().catch(() => {});
    if (env) await env.cleanup().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    console.log(failed() ? `${failed()} check(s) failed` : "all checks passed");
    process.exit(failed() ? 1 : 0);
  }
})();
