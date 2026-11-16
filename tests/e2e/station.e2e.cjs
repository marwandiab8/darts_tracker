// The camera station itself (station.html + board-camera.js), in a browser with a pretend camera
// looking at a board (a video drawn by the test rig), against the emulators:
//   - "Set up the cameras": the camera that sees the board is found and calibrated with no taps,
//     and the station starts watching;
//   - one station at a time: a second tab stands by without touching the camera, and takes over
//     when the first is closed;
//   - "Calibrate again", on the station page and from the Cameras page on another device;
//   - a game page uses the station and never opens the cameras itself, even with cameras set up
//     in its own browser and the station stopped (the double entry of Nov 16, 2026), and Board
//     mode says the cameras are off rather than "watching";
//   - a chosen camera with no calibration is calibrated when the station starts.
const H = require("./harness.cjs");
const S = require("../board-sim.cjs");
const V = require("../../public/board-vision.js");
const fs = require("fs"), os = require("os"), path = require("path");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { check, failed } = H.checker();

// Counts the times a page opens a camera.
const countCameras = `(() => {
  window.__gum = 0;
  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = (c) => { window.__gum += 1; return orig(c); };
})();`;

(async () => {
  // What the camera sees: the board from the right and a little above, 1280 x 720.
  const cam = S.camera({ pos: { x: 175, y: -55, z: 400 }, width: 1280, height: 720, hfov: 80 });
  const image = S.renderer(cam, { crop: { sx: 0, sy: 0, sw: 1280, sh: 720 }, width: 1280, height: 720 }, { noise: 2, seed: 5, smooth: 2 })([]);
  const video = path.join(os.tmpdir(), `darts-station-${process.pid}.y4m`);
  fs.writeFileSync(video, H.y4m(image));
  const worstOff = (cal) => {
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
  const browser = await H.launch(H.fakeCamera(video));
  let env = null;
  try {
    const base = `http://127.0.0.1:${H.PORT}`;
    const rules = fs.readFileSync(path.join(H.REPO, "firestore.rules"), "utf8");
    env = await initializeTestEnvironment({ projectId: H.PROJECT, firestore: { host: "127.0.0.1", port: 8080, rules } });
    await env.clearFirestore();
    const until = async (fn, ms = 30000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { try { v = await fn(); } catch (_) { v = null; } if (v) return v; await H.sleep(200); } return v; };
    const text = (p, id) => p.evaluate((i) => document.getElementById(i).textContent, id);
    const shown = (p, id) => p.evaluate((i) => { const e = document.getElementById(i); return !!e && !e.classList.contains("hidden") && e.offsetParent !== null; }, id);

    // ---- setting up: one button --------------------------------------------------------------------
    const tab = await H.device(browser, "station");
    await tab.context().addInitScript(countCameras);
    tab.on("dialog", (d) => d.accept());
    await tab.goto(`${base}/station.html`);
    const uid = await H.signIn(tab);
    const read = async () => { let out = null; await env.withSecurityRulesDisabled(async (ctx) => { const s = await getDoc(doc(ctx.firestore(), "cameraStations", uid)); out = s.exists() ? s.data() : null; }); return out; };
    await until(() => shown(tab, "setupBtn"), 15000);
    check(await shown(tab, "setupBtn") && /^Set up the cameras$/.test(await text(tab, "setupBtn")), "a new account sees one button: Set up the cameras");
    check(!(await shown(tab, "startBtn")) && /Not running/.test(await text(tab, "stateText")), "and nothing else to choose before it");
    await tab.click("#setupBtn");
    const watching = await until(async () => /Watching the board/.test(await text(tab, "stateText")), 45000);
    check(watching, "the camera that sees the board is found, calibrated and watched: " + (await text(tab, "status")));
    let d = await until(async () => { const x = await read(); return x && x.station && x.station.running ? x : null; }, 10000) || await read();
    const cal0 = d && d.setup && d.setup.cameras && d.setup.cameras[0] && d.setup.cameras[0].cal;
    check(d && d.setup.cameras.length === 1 && cal0 && cal0.auto === true, "the account has the camera with a calibration made by itself");
    check(cal0 && cal0.refined.edges >= 240 && cal0.refined.rms <= 1.6, `fitted to ${cal0 && cal0.refined.edges} edges of the board, ${cal0 && cal0.refined.rms.toFixed(2)} mm`);
    check(cal0 && worstOff(cal0) < 1.5, `the calibration is within ${cal0 ? worstOff(cal0).toFixed(2) : "?"} mm of where the camera really is`);
    check(cal0 && cal0.points.length === 5 && cal0.points.every((p) => p && Number.isFinite(p.x)), "with its five points, for the Cameras page");
    check(d.station.id && d.station.on === true && d.station.running === true, "the station has claimed the account and says it is watching");
    check(/Watching with 1 camera/.test(await text(tab, "status")), "the page says so: " + (await text(tab, "status")));
    await until(() => tab.evaluate(() => document.querySelectorAll("#cams .cam canvas").length === 1), 8000);
    const tile = await tab.evaluate(() => { const c = document.querySelector("#cams .cam"); return c ? c.textContent : ""; });
    check(/calibrated|found the board/i.test(tile), "the page shows the camera's picture with the outline, and how it was calibrated: " + tile.slice(0, 90));
    check(await shown(tab, "calBtn") && await shown(tab, "stopBtn") && !(await shown(tab, "takeBtn")), "Calibrate again and Stop are offered");
    d = await until(async () => { const x = await read(); return x.station.cameras && x.station.cameras[0] ? x : null; }, 8000);
    check(d && d.station.cameras[0].ok === true, "how the camera's calibration stands is in the account for the other devices");
    const first = d.station.id;

    // ---- one station at a time -------------------------------------------------------------------------
    const tab2 = await tab.context().newPage();
    tab2.on("dialog", (x) => x.accept());
    await tab2.goto(`${base}/station.html`);
    const standing = await until(async () => /Standing by/.test(await text(tab2, "stateText")), 20000);
    check(standing, "a second Camera station tab stands by: " + (await text(tab2, "status")));
    check(/another tab of this browser/.test(await text(tab2, "status")) && await shown(tab2, "takeBtn"), "it says where the station is running, and offers to run it here instead");
    check((await tab2.evaluate(() => window.__gum)) === 0, "and it hasn't opened the camera");
    d = await read();
    check(d.station.id === first && d.station.running === true, "the first tab still has the station, untouched");
    check(/Watching the board/.test(await text(tab, "stateText")), "and carries on watching");
    await tab.close({ runBeforeUnload: true });
    const tookOver = await until(async () => /Watching the board/.test(await text(tab2, "stateText")), 30000);
    check(tookOver, "the first tab closed: the second takes over and watches: " + (await text(tab2, "status")));
    d = await read();
    check(d.station.id && d.station.id !== first && d.station.on === true, "the account's station is the second tab now");

    // ---- calibrate again, here -----------------------------------------------------------------------
    const before = (await read()).setup.cameras[0].cal.at;
    await tab2.click("#calBtn");
    const again = await until(async () => { const x = await read(); return x.setup.cameras[0].cal.at > before ? x : null; }, 30000);
    check(again && again.setup.cameras[0].cal.auto === true, "Calibrate again on the station page makes the calibration afresh");
    check(await until(async () => /Watching the board/.test(await text(tab2, "stateText")), 30000), "and it goes on watching with it: " + (await text(tab2, "status")));

    // ---- calibrate again, from the Cameras page on another device -----------------------------
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 } });
    await ipad.context().addInitScript(countCameras);
    await ipad.goto(`${base}/camera.html`);
    await H.signIn(ipad);
    await until(() => shown(ipad, "recalBtn"), 15000);
    check(await shown(ipad, "recalBtn"), "the Cameras page, on another device, shows the station's cameras and Calibrate again");
    const list = await ipad.evaluate(() => document.getElementById("stationCams").textContent);
    check(/Camera 1: calibrated by itself/.test(list), "it says how the camera was calibrated: " + list.slice(0, 80));
    const at2 = (await read()).setup.cameras[0].cal.at;
    await ipad.click("#recalBtn");
    const done = await until(async () => /^Done/.test(await text(ipad, "recalMsg")), 45000);
    check(done, "the station did it and answered: " + (await text(ipad, "recalMsg")));
    d = await read();
    check(d.station.calibrated && d.station.calibrated.cameras[0].ok === true && d.setup.cameras[0].cal.at > at2, "the new calibration is in the account");
    check((await ipad.evaluate(() => window.__gum)) === 0, "the other device never opens a camera for it");
    check(await until(async () => /Watching the board/.test(await text(tab2, "stateText")), 30000), "the station watches on");
    // No taps there either: the board found in the picture the station sent (once it has come).
    await until(async () => !(await shown(ipad, "calCard")) ? false : (await text(ipad, "calSaved")) === "", 20000);
    await ipad.click("#autoCalBtn");
    check(/^Found\./.test(await text(ipad, "calSaved")), "\"Find the board by itself\" on the Cameras page: " + (await text(ipad, "calSaved")));
    check(/no taps/.test(await text(ipad, "fit")), "the outline is matched to the board: " + (await text(ipad, "fit")).slice(0, 70));

    // ---- a game page never opens the cameras itself ----------------------------------------------
    // Cameras are set up in this browser too (as on the computer with the cameras), and Camera is on.
    const local = JSON.stringify({ version: 1, cameras: [{ deviceId: "whatever", label: video, cal: d.setup.cameras[0].cal }] });
    const laptop = await H.device(browser, "laptop", { storage: { dt_cameraSetup: local, dt_trackerCamera: "1" } });
    await laptop.context().addInitScript(countCameras);
    laptop.on("dialog", (x) => x.accept());
    await laptop.goto(`${base}/index.html`);
    await H.signIn(laptop);
    const camNote = () => laptop.evaluate(() => document.getElementById("camNote").textContent);
    check(await until(async () => /camera station|Camera on/i.test(await camNote()), 20000), "the tracker, Camera on, follows the station: " + (await camNote()));
    check((await laptop.evaluate(() => window.__gum)) === 0, "without opening the cameras itself");
    // The station stops: the page says so, and still leaves the cameras alone.
    await tab2.click("#stopBtn");
    check(await until(async () => /isn't running/.test(await camNote()), 15000), "the station stopped: " + (await camNote()));
    await laptop.evaluate(() => { const t = document.getElementById("cameraToggle"); t.click(); });
    await H.sleep(400);
    await laptop.evaluate(() => { const t = document.getElementById("cameraToggle"); t.click(); });
    check(await until(async () => /isn't running/.test(await camNote()), 15000), "Camera off and on again: it still waits for the station");
    await H.sleep(1500);
    check((await laptop.evaluate(() => window.__gum)) === 0, "and never reads the board itself (two readers would enter every dart twice)");
    d = await read();
    check(d.station.on === false && d.station.running === false, "the station says it stopped");
    // Board mode says the cameras are off, not that they are watching.
    await laptop.click("#boardBtn");
    await laptop.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    const bm = await laptop.evaluate(() => {
      const b = document.getElementById("boardMode");
      return { chip: b.querySelector("[data-act=camera]").className, slots: [...b.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent) };
    });
    check(/\bdown\b/.test(bm.chip), "Board mode's Cameras button shows they are off");
    check(bm.slots.some((s) => /Cameras off\|The camera station isn't running/.test(s)) && !bm.slots.some((s) => /are watching/.test(s)), "and the next dart's box says so: " + bm.slots[0]);

    // ---- a camera with no calibration is calibrated when the station starts ------------------
    await env.withSecurityRulesDisabled(async (ctx) => {
      const cams = (await getDoc(doc(ctx.firestore(), "cameraStations", uid))).data().setup.cameras.map((c) => Object.assign({}, c, { cal: null }));
      await setDoc(doc(ctx.firestore(), "cameraStations", uid), { setup: { cameras: cams } }, { merge: true });
    });
    await tab2.click("#startBtn");
    check(await until(async () => /Watching the board/.test(await text(tab2, "stateText")), 45000), "started with no calibration: it calibrates by itself and watches: " + (await text(tab2, "status")));
    d = await read();
    check(d.setup.cameras[0].cal && d.setup.cameras[0].cal.auto === true && worstOff(d.setup.cameras[0].cal) < 1.5, "the calibration it made is right");
    // The game page carries on by itself, with the cameras back in Board mode.
    check(await until(() => laptop.evaluate(() => !/\bdown\b/.test(document.querySelector("#boardMode [data-act=camera]").className)), 20000), "the game page sees the station again");
    const slots = await laptop.evaluate(() => [...document.querySelectorAll("#boardMode .bm-slot")].map((s) => s.querySelector(".s").textContent));
    check(slots.some((s) => /The cameras are watching/.test(s)), "and Board mode says the cameras are watching");
    check((await laptop.evaluate(() => window.__gum)) === 0, "still without a camera of its own");

    const errors = [tab2, ipad, laptop].flatMap((p) => p.errors || []);
    check(!errors.length, "no page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  } catch (error) {
    check(false, "the test ran to the end: " + (error && error.stack || error));
  } finally {
    if (env) await env.clearFirestore().catch(() => {});
    if (env) await env.cleanup().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    try { fs.unlinkSync(video); } catch (_) { /* gone already */ }
    console.log(failed() ? `${failed()} check(s) failed` : "all checks passed");
    process.exit(failed() ? 1 : 0);
  }
})();
