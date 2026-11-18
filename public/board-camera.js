// Cameras for the darts pages: opens them, keeps the setup (which camera, and its calibration),
// and feeds what they see to BoardVision's detector. Load board-vision.js first. Used by
// camera.html (setting up and testing) and the practice pages (scoring), as window.DartCamera.
//
// The setup lives in this browser only (localStorage), since it belongs to the cameras plugged
// into this computer:
//   { version: 1, cameras: [ { deviceId, label, cal: { H, width, height, points, error } }, ... ] }
// Two entries can name the same camera: OBS's virtual camera showing both cameras side by side,
// with each half calibrated on its own.
(function (root) {
  "use strict";
  // In the pages BoardVision is loaded first; under Node (the tests) it is required here.
  const V = root.BoardVision || (typeof module === "object" && module.exports && typeof require === "function" ? require("./board-vision.js") : undefined);
  const KEY = "dt_cameraSetup";

  function load() {
    try {
      const setup = JSON.parse(localStorage.getItem(KEY) || "null");
      if (setup && Array.isArray(setup.cameras)) return setup;
    } catch (_) { /* private mode, or bad data */ }
    return { version: 1, cameras: [] };
  }

  function save(setup) {
    try { localStorage.setItem(KEY, JSON.stringify(Object.assign({ version: 1 }, setup, { updated: new Date().toISOString() }))); return true; } catch (_) { return false; }
  }

  // The cameras that have a calibration, ready to watch.
  const ready = (setup) => (setup && setup.cameras ? setup.cameras.filter((c) => c && c.deviceId && c.cal && c.cal.H) : []);

  async function listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "videoinput").map((d, i) => ({ deviceId: d.deviceId, label: d.label || "Camera " + (i + 1) }));
  }

  // Asks for camera access once, so the cameras' names can be listed.
  async function requestAccess() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("This browser can't use cameras here. Use Chrome, and open the page over https.");
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    return listCameras();
  }

  function explain(error, label) {
    const name = label ? `"${label}"` : "The camera";
    switch (error && error.name) {
      case "NotAllowedError": return "Camera access was blocked. Allow the camera for this site (the camera icon in the address bar), then try again.";
      case "NotReadableError":
      case "AbortError": return `${name} is in use by another program. Close OBS (or whatever else is using it).`;
      case "NotFoundError":
      case "OverconstrainedError": return `${name} isn't plugged in, or its name changed. Check the cable, then set it up again.`;
      default: return `${name} could not be opened${error && error.message ? ": " + error.message : "."}`;
    }
  }

  // Which of the cameras plugged in now (`devices`, as listCameras gives them) each saved camera is:
  // a list, with null where none is. The one with its id, while its name still matches; else one
  // with its name. Never one camera for two saved ones, unless they were saved as one (OBS's
  // virtual camera, both halves). Two cameras of the same model have the same name, and on Linux a
  // camera's id goes with the order the cameras were plugged in, so two of a model can come back
  // with each other's ids, or new ones: the watcher tells them apart by what they see.
  function matchCameras(saved, devices) {
    const keyOf = (s) => (s ? s.deviceId || "name:" + (s.label || "") : null);
    const keys = [], firsts = [];
    saved.forEach((s) => { const k = keyOf(s); if (k && !keys.includes(k)) { keys.push(k); firsts.push(s); } });
    const taken = new Set(), found = new Map();
    const pass = (test) => firsts.forEach((s, g) => {
      if (found.has(keys[g])) return;
      const d = (devices || []).find((x) => x && !taken.has(x.deviceId) && test(s, x));
      if (d) { found.set(keys[g], d); taken.add(d.deviceId); }
    });
    pass((s, d) => !!s.deviceId && d.deviceId === s.deviceId && (!s.label || !d.label || d.label === s.label));
    pass((s, d) => !!s.label && d.label === s.label);
    return saved.map((s) => (s ? found.get(keyOf(s)) || null : null));
  }

  // Finds the camera saved in the setup among those plugged in now (see matchCameras).
  async function resolve(saved) {
    return matchCameras([saved], await listCameras())[0];
  }

  const pause = (ms) => new Promise((done) => setTimeout(done, ms));

  // `tries`: a camera just plugged in can refuse to open for a moment, so try again (a second apart).
  async function openStream(deviceId, label, tries = 1) {
    for (let k = 1; ; k += 1) {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
      } catch (error) {
        if (k >= tries || error.name === "NotAllowedError") throw new Error(explain(error, label));
        await pause(1000);
      }
    }
  }

  // What a camera of a setup is called in messages: by its name, or "camera 1" / "camera 2" when
  // both have the same name (two of one model, or both halves of OBS's virtual camera).
  function cameraName(cams, i) {
    const label = cams[i] && cams[i].label;
    return label && cams.filter((c) => c && c.label === label).length < 2 ? `"${label}"` : `camera ${i + 1}`;
  }
  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Why the cameras couldn't all be found (cams[i] wasn't): `missing` is set on the error.
  function missingError(cams, found) {
    const lost = cams.map((c, i) => (found[i] ? -1 : i)).filter((i) => i >= 0), cam = cams[lost[0]];
    let text;
    if (cams.length > 1 && lost.length === cams.length) text = "The cameras aren't plugged in.";
    else if (cams.filter((c) => c.label === cam.label).length > 1) text = `Only one of the two "${cam.label}" cameras is plugged in. Check the other one's cable.`;
    else text = explain({ name: "NotFoundError" }, cam.label);
    return Object.assign(new Error(text), { missing: true });
  }

  // A <video> playing the stream. Kept in the page (out of sight) because some browsers only keep
  // a video's frames coming when it is.
  function videoFor(stream) {
    const video = document.createElement("video");
    video.muted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute("playsinline", "");
    video.style.cssText = "position:fixed;left:-10px;top:-10px;width:2px;height:2px;opacity:0;pointer-events:none;";
    video.srcObject = stream;
    document.body.appendChild(video);
    return new Promise((resolveVideo, reject) => {
      const done = () => { if (video.videoWidth) { video.play().catch(() => {}); resolveVideo(video); } };
      video.addEventListener("loadedmetadata", done, { once: true });
      video.addEventListener("error", () => reject(new Error("The camera's picture could not be played.")), { once: true });
      setTimeout(() => (video.videoWidth ? done() : reject(new Error("The camera gave no picture. Is something covering it, or is it in use?"))), 6000);
    });
  }

  // A still of what a camera shows now, at its full size, on a canvas (for calibrating).
  function still(video) {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d", { willReadFrequently: true }).drawImage(video, 0, 0);
    return canvas;
  }

  const pixelsOf = (canvas) => canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  // Whether a camera's picture is black: no picture yet, not a dark room (which still shows something).
  function isBlack(canvas) {
    if (!canvas || !canvas.width) return true;
    const { data } = pixelsOf(canvas);
    let sum = 0, n = 0;
    for (let i = 0; i < data.length; i += 4 * 97) { sum += Math.max(data[i], data[i + 1], data[i + 2]); n += 1; }
    return n === 0 || sum / n < 6;
  }

  // Whether a camera's picture is shared with another camera (OBS's virtual camera showing both
  // side by side), and so where its lens's middle is: the middle of its own half.
  function lensOptions(cal, shared) {
    if (!shared || (cal.lens && cal.lens.k)) return {};
    const w = cal.width, h = cal.height;
    return { center: V.halfCenter(cal), size: Math.hypot(w / 2, h) / 2 };
  }

  // Matches a calibration to the board in a camera's still (canvas): the five taps as a start,
  // then the board's own rings and wires. Null if the board couldn't be made out in it.
  function snap(cal, canvas, shared, extra) {
    if (!cal || !canvas || !canvas.width) return null;
    return V.refineCalibration(cal, pixelsOf(canvas), Object.assign(lensOptions(cal, shared), extra));
  }

  // --- calibrating with no taps ------------------------------------------------------------------

  // A fit of this many of the board's edges (of about 440), this close on average (mm), is a
  // calibration to trust with no taps behind it.
  const GOOD_EDGES = 240, GOOD_RMS = 1.6;
  const sharedIn = (cams, i) => !!(cams[i] && cams[i].deviceId) && cams.filter((c) => c && c.deviceId === cams[i].deviceId).length > 1;

  // The part of a shared picture (OBS's two cameras side by side) that is this camera's own: the
  // half its board is in when it has a calibration, else by its place (camera 1 on the left).
  function ownHalf(cal, index, w, h) {
    const middle = cal && cal.H ? V.halfCenter(cal) : null;
    const left = middle ? middle.x < w / 2 : index === 0;
    return left ? { x0: 0, y0: 0, x1: w / 2, y1: h } : { x0: w / 2, y0: 0, x1: w, y1: h };
  }

  // A camera's calibration from what it shows now (`canvas`), with nothing tapped. One from before
  // (`cal`) is matched to the board first, which follows a camera that was knocked a little. When
  // that no longer fits, or there is none, the board is found in the picture from scratch
  // (BoardVision.autoCalibrate), the old one saying only which way up the board was. Returns
  // { cal, how: "followed" | "found", moved } (`moved`: mm from the one before, null without one),
  // or null when the board can't be made out: something in the way, too dark, or part of the rings
  // out of the picture. `shared`: the picture is OBS's, with the other camera in its other half.
  function calibrateFrom(cal, canvas, shared, index) {
    if (!V || !canvas || !canvas.width) return null;
    const image = pixelsOf(canvas);
    const before = cal && cal.H && (!cal.width || (cal.width === image.width && cal.height === image.height)) ? cal : null;
    if (before) {
      let fit = null;
      try { fit = V.refineCalibration(before, image, Object.assign(lensOptions(before, shared), { taps: false })); } catch (_) { fit = null; }
      if (fit && fit.refined.edges >= GOOD_EDGES && fit.refined.rms <= GOOD_RMS) return { cal: V.withPoints(fit), how: "followed", moved: fit.refined.shift };
    }
    const region = shared ? ownHalf(before, index || 0, image.width, image.height) : null;
    const lens = region ? { center: { x: (region.x0 + region.x1) / 2, y: image.height / 2 }, size: Math.hypot(image.width / 2, image.height) / 2 } : {};
    let found = null;
    try { found = V.autoCalibrate(image, Object.assign({ hint: before, region, minEdges: GOOD_EDGES, maxRms: GOOD_RMS }, lens)); } catch (_) { found = null; }
    if (!found) return null;
    return { cal: found, how: "found", moved: before ? V.shiftBetween(before, found) : null };
  }

  // Which of the cameras plugged in can see a dartboard, with a calibration for each, so nothing
  // has to be chosen or tapped: every camera is opened in turn and the board looked for in its
  // picture. OBS's virtual camera shows both cameras side by side: then each half is one. Returns
  // { cameras, busy }: `cameras` is up to two { deviceId, label, cal } (the camera to the left of
  // the board first; for OBS, two with the same deviceId), and `busy` the names of cameras another
  // program has. OBS's picture is only settled for when no camera is busy: with the cameras
  // themselves in use (by OBS, most likely), the answer is to free them, not to read them at half
  // the size through OBS. onProgress({ label, state: "looking" | "found" | "none" | "failed", text }).
  async function findBoardCameras({ onProgress = () => {} } = {}) {
    const devices = await requestAccess();
    const single = [], halves = [], busy = [];
    // Two cameras of one model have one name: told apart here as "(1)" and "(2)".
    const nameOf = (d) => {
      const same = devices.filter((x) => x.label === d.label);
      return same.length > 1 ? `${d.label} (${same.indexOf(d) + 1})` : d.label;
    };
    for (const d of devices) {
      const shownAs = nameOf(d);
      onProgress({ label: shownAs, state: "looking" });
      let stream = null, video = null;
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: d.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } });
        } catch (error) {
          if (error && (error.name === "NotReadableError" || error.name === "AbortError")) busy.push(shownAs);
          throw new Error(explain(error, d.label));
        }
        video = await videoFor(stream);
        await settled(video, 900);
        const canvas = still(video);
        const two = [0, 1].map((i) => calibrateFrom(null, canvas, true, i));
        const one = two[0] && two[1] ? null : calibrateFrom(null, canvas, false, 0);
        if (two[0] && two[1]) two.forEach((got) => halves.push({ deviceId: d.deviceId, label: d.label, cal: got.cal }));
        else if (one) single.push({ deviceId: d.deviceId, label: d.label, cal: one.cal });
        onProgress({ label: shownAs, state: (two[0] && two[1]) || one ? "found" : "none" });
      } catch (error) {
        onProgress({ label: shownAs, state: "failed", text: error.message });
      } finally {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        if (video && video.parentNode) video.parentNode.removeChild(video);
      }
    }
    const found = single.length ? single.sort((x, y) => y.cal.refined.edges - x.cal.refined.edges).slice(0, 2) : busy.length ? [] : halves.slice(0, 2);
    const side = (c) => { const pose = V.cameraPose(c.cal.H, c.cal.width, c.cal.height, c.cal.lens ? { x: c.cal.lens.cx, y: c.cal.lens.cy } : null); return pose ? pose.x : 0; };
    if (single.length) found.sort((x, y) => side(x) - side(y));
    return { cameras: found.map((c) => ({ deviceId: c.deviceId, label: c.label, cal: Object.assign({ at: Date.now() }, c.cal) })), busy };
  }

  // A timer that keeps going while the page is in the background (a camera station left behind
  // other windows): browsers slow ordinary timers in hidden pages to about once a minute, but not
  // those in a worker. { set(fn, ms), clear(), close() }, or null where workers aren't available.
  function workerTimer() {
    try {
      const src = "let t=null;onmessage=(e)=>{clearTimeout(t);if(e.data>=0)t=setTimeout(()=>postMessage(0),e.data);};";
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      let fn = null;
      worker.onmessage = () => { const f = fn; fn = null; if (f) f(); };
      return { set(f, ms) { fn = f; worker.postMessage(ms); }, clear() { fn = null; worker.postMessage(-1); }, close() { worker.terminate(); } };
    } catch (_) {
      return null;
    }
  }

  // A camera followed further than this (mm) since it was calibrated is worth a word.
  const MOVED_MM = 6;

  // Whether the calibrations fit the board better with the two cameras the other way round:
  // `fits` and `tried` are, for each calibration, its match on the board this way and the other
  // (refineCalibration's result, or null where it didn't fit). More of them fitting wins; as many,
  // fitting nearer where they were calibrated (by more than a few mm in all) wins.
  function otherWayFits(fits, tried) {
    const score = (list) => list.reduce((total, f) => total + (f ? 1000 - f.refined.shift : 0), 0);
    return score(tried) > score(fits) + 3;
  }

  // A camera's picture once it has had a moment to settle its exposure.
  function settled(video, ms) {
    return new Promise((resolve) => {
      const go = () => setTimeout(resolve, ms);
      if (video.readyState >= 2) go();
      else video.addEventListener("loadeddata", go, { once: true });
    });
  }

  // Watches the board with every calibrated camera in `setup`, about `fps` times a second, and
  // calls onEvent with what the detector says (see BoardVision.createDetector), plus
  //   { type: "status", text }   for showing what it is doing,
  //   { type: "error", text }    when a camera can't be opened or stops, and
  //   { type: "check", cameras, warning, swapped }  once at the start: each calibration checked
  //       against what its camera shows now ({ label, ok, moved (mm) } each), a warning to show if
  //       one couldn't be checked or has moved a lot (else null), and whether two cameras had come
  //       back plugged in the other way round (each calibration is then used with the camera it fits).
  //   { type: "error", text, unplugged: true }  when a camera stops (unplugged).
  // If a camera isn't plugged in, start() fails with an error that has `missing` set.
  // onFrames(frames, detector), if given, is called with every set of frames (for drawing).
  // With `recheck` (the default), a camera that has been knocked a little since it was calibrated
  // is followed for this session: its calibration is matched to the board again from a still.
  // With `background`, it keeps watching at full speed while the page is hidden (a camera station).
  function createWatcher(setup, { onEvent = () => {}, onFrames = null, fps = 10, options: callerOptions = {}, recheck = true, background = false } = {}) {
    // What the station learned from your corrections (setup.learned, board-learn.js), how this board
    // is lit (setup.options, e.g. { shadow: true } for hard shadows), then the caller's.
    const options = Object.assign({}, learnedOptions(setup), (setup && setup.options) || {}, callerOptions);
    let cams = ready(setup);
    let streams = [], videos = [], views = [], canvases = [], stills = [], checks = [], detector = null, timer = null, running = false, swapped = false;
    const bgTimer = background ? workerTimer() : null;

    async function start() {
      if (running) return;
      if (!cams.length) throw new Error("No cameras are set up yet.");
      running = true;
      stills = []; checks = []; swapped = false;
      onEvent({ type: "status", text: "Opening the cameras…" });
      // Stopped while still starting (the cameras wanted elsewhere): whatever was opened since is
      // let go of, and nothing more is opened.
      const made = [];
      const stopped = () => {
        if (running) return false;
        made.forEach((v) => { if (v.parentNode) v.parentNode.removeChild(v); });
        stop();
        return true;
      };
      try {
        const found = matchCameras(cams, await listCameras());
        if (stopped()) return;
        if (found.some((d) => !d)) throw missingError(cams, found);
        // One stream per physical camera, shared by views that use the same one (OBS side by side).
        const byDevice = new Map();
        let order = [];
        for (let i = 0; i < cams.length; i += 1) {
          const device = found[i];
          let entry = byDevice.get(device.deviceId);
          if (!entry) {
            const stream = await openStream(device.deviceId, device.label || cams[i].label, 3);
            streams.push(stream);
            if (stopped()) return;
            const video = await videoFor(stream);
            made.push(video);
            if (stopped()) return;
            entry = { device, video, still: null };
            const mine = entry;
            stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
              const k = Math.max(0, order.indexOf(mine));
              if (running) onEvent({ type: "error", text: `${capital(cameraName(cams, k))} stopped. Was it unplugged?`, unplugged: true });
            }));
            byDevice.set(device.deviceId, entry);
          }
          order.push(entry);
        }
        // What each camera shows now, once its exposure has settled.
        await Promise.all([...byDevice.values()].map((entry) => settled(entry.video, 600)));
        if (stopped()) return;
        // A camera opened again the moment it was let go of (the station page loading itself anew)
        // can show black for a second or two: wait for a real picture, three seconds at most.
        for (let k = 0; k < 12 && [...byDevice.values()].some((entry) => isBlack(still(entry.video))); k += 1) {
          await pause(250);
          if (stopped()) return;
        }
        for (const entry of byDevice.values()) entry.still = still(entry.video);
        // A camera sharing its picture with another (OBS side by side) has its lens in the middle
        // of its own half.
        const shared = (i) => cams.filter((c) => c.deviceId === cams[i].deviceId).length > 1;
        // Each calibration checked against what its camera shows now (null: it couldn't be).
        const fit = (i, entry) => (recheck ? snap(cams[i].cal, entry.still, shared(i), { taps: false }) : null);
        let fits = order.map((entry, i) => fit(i, entry));
        // Two cameras of one model look the same to the computer, so they can come back plugged in
        // the other way round. When a calibration doesn't fit its camera (or only far from where it
        // was: two cameras close together can seem to fit each other's), try the two the other way
        // round, and keep whichever way fits the board better.
        if (recheck && order.length === 2 && order[0] !== order[1] && fits.some((f) => !f || f.refined.shift > MOVED_MM)) {
          const other = [order[1], order[0]], tried = other.map((entry, i) => fit(i, entry));
          if (otherWayFits(fits, tried)) { order = other; fits = tried; swapped = true; }
        }
        const using = [];
        order.forEach((entry, i) => {
          const cam = cams[i], again = fits[i], cal = again || cam.cal;
          videos.push(entry.video);
          stills.push(entry.still);
          checks.push(again
            ? { label: cam.label, ok: true, moved: again.refined.shift, edges: again.refined.edges, rms: again.refined.rms }
            : { label: cam.label, ok: false, moved: null });
          // `device`: the camera plugged in now that this calibration is used with.
          using.push(Object.assign({}, cam, { cal, device: { deviceId: entry.device.deviceId, label: entry.device.label || cam.label } }));
          const view = V.makeView(cal, entry.video.videoWidth, entry.video.videoHeight, Object.assign({}, options, shared(i) ? { center: V.halfCenter(cal) } : {}));
          if (!view) throw new Error(`The calibration for ${cameraName(cams, i)} doesn't fit its picture any more. Calibrate it again.`);
          views.push(view);
          const canvas = document.createElement("canvas");
          canvas.width = view.width; canvas.height = view.height;
          canvases.push(canvas.getContext("2d", { willReadFrequently: true }));
        });
        // Two views of one picture must not watch the same pixels.
        for (let i = 0; i < cams.length; i += 1) {
          for (let j = i + 1; j < cams.length; j += 1) if (cams[i].deviceId === cams[j].deviceId) V.separateViews(views[i], views[j]);
        }
        cams = using;
        detector = V.createDetector(views, options);
      } catch (error) {
        stop();
        throw error;
      }
      if (recheck) {
        const unchecked = checks.map((c, i) => (c.ok ? null : cameraName(cams, i))).filter(Boolean);
        const movedFar = checks.map((c, i) => (c.ok && c.moved > MOVED_MM ? i : -1)).filter((i) => i >= 0);
        const warning = unchecked.length
          ? `Couldn't check ${unchecked.join(" and ")} against the board (something in the way?), so it uses its calibration as saved.`
          : movedFar.length
            ? `${capital(movedFar.map((i) => cameraName(cams, i)).join(" and "))} moved about ${Math.round(Math.max(...movedFar.map((i) => checks[i].moved)))} mm since calibrating. It's followed, but calibrate it again if darts read wrong.`
            : null;
        onEvent({ type: "check", cameras: checks.slice(), warning, swapped });
      }
      onEvent({ type: "status", text: cams.length > 1 ? `Watching with ${cams.length} cameras.` : "Watching with one camera." });
      tick();
    }

    function grab() {
      return views.map((view, i) => {
        const video = videos[i];
        if (!video || video.readyState < 2) return null;
        const ctx = canvases[i], c = view.crop;
        ctx.drawImage(video, c.sx, c.sy, c.sw, c.sh, 0, 0, view.width, view.height);
        const image = ctx.getImageData(0, 0, view.width, view.height);
        return { data: image.data, width: view.width, height: view.height };
      });
    }

    function tick() {
      if (!running) return;
      const started = performance.now();
      try {
        const frames = grab();
        if (frames.every(Boolean)) {
          for (const event of detector.push(frames, started)) onEvent(event);
          if (onFrames) onFrames(frames, detector);
        }
      } catch (error) {
        onEvent({ type: "error", text: "Reading the cameras failed: " + error.message });
      }
      const spent = performance.now() - started;
      const wait = Math.max(10, 1000 / fps - spent);
      if (bgTimer) bgTimer.set(tick, wait);
      else timer = setTimeout(tick, wait);
    }

    function stop() {
      running = false;
      if (timer) clearTimeout(timer);
      if (bgTimer) bgTimer.clear();
      timer = null;
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      videos.forEach((v) => { if (v.parentNode) v.parentNode.removeChild(v); });
      streams = []; videos = []; views = []; canvases = []; detector = null; // the stills are kept, for saving
    }

    return {
      start,
      stop,
      get running() { return running; },
      get views() { return views; },
      get detector() { return detector; },
      // The cameras watched, with the calibrations in use (checked against the board at the start),
      // and (`device`) the camera plugged in now that each is used with.
      get cameras() { return cams; },
      // Each camera's picture from the start (canvases), and how its check went.
      get stills() { return stills; },
      get checks() { return checks; },
      // Whether two cameras had come back plugged in the other way round (and were put right).
      get swapped() { return swapped; },
      // The board as the cameras see it now has no darts in it.
      markEmpty() {
        const frames = grab();
        if (detector && frames.every(Boolean)) detector.markEmpty(frames);
      },
      // How much the cameras' pictures differ from themselves a second later with nothing going on,
      // for each change threshold in `thresholds`: the pixels that count as changed, as a share of
      // what starts the detector looking (1 is as much as a look takes), for the worse camera.
      // The middle one of three goes, so somebody walking past once doesn't count. Null when it
      // can't be told now (not watching, darts in the board, something moving).
      async noise(thresholds) {
        const quiet = () => running && detector && detector.state === "watching" && !detector.darts;
        if (!quiet()) return null;
        const shots = [];
        for (let k = 0; k < 4; k += 1) {
          if (k) await pause(1000);
          if (!quiet()) return null;
          const frames = grab();
          if (!frames.every(Boolean)) return null;
          shots.push(frames.map((f) => f.data));
        }
        const look = detector.options.changeArea;
        return thresholds.map((threshold) => {
          const shares = [];
          for (let k = 1; k < shots.length; k += 1) {
            let worst = 0;
            views.forEach((view, i) => {
              const changed = V.countChanged(shots[k - 1][i], shots[k][i], view, threshold, 3, V.gainOf(shots[k - 1][i], shots[k][i], view));
              worst = Math.max(worst, changed / (look * view.pxPerR * view.pxPerR));
            });
            shares.push(worst);
          }
          shares.sort((a, b) => a - b);
          return { threshold, share: Math.round(shares[1] * 100) / 100 };
        });
      },
      // What each camera shows now, as a whole picture (canvas), one per camera watched.
      snapshot() {
        const byVideo = new Map();
        return videos.map((v) => {
          if (!byVideo.has(v)) byVideo.set(v, v && v.readyState >= 2 ? still(v) : null);
          return byVideo.get(v);
        });
      },
    };
  }

  // --- the camera station ----------------------------------------------------------------------------
  //
  // The cameras are plugged into one computer, but the game may be played on another. That computer
  // runs the camera station (station.html): it keeps the cameras open, reads every dart itself (from
  // the cameras' own pictures, at full quality), and passes the darts on through Firestore, under
  // the owner's account:
  //   cameraStations/{uid}                 { uid, setup, station, ask }
  //       setup    { version, cameras: [{ deviceId, label, cal }] }: which of the station's cameras,
  //                and their calibrations. Calibrated from any computer (camera.html), which writes it.
  //       station  { id, host, on, name, seen, running, status, devices, frame, cameras, calibrated }:
  //                written by the station; `seen` (ms) every 20 s while it runs. `id` is the page
  //                that is the account's station (one at a time: see createStation) and `host` its
  //                browser; `on` is false once it has stopped; `cameras` says how each camera's
  //                calibration stands, and `calibrated` how the last "calibrate again" went.
  //       ask      { still, clear, calibrate }: requests from other computers (an id each): send
  //                fresh pictures; the board is clear now; calibrate every camera afresh.
  //   cameraStations/{uid}/stills/{0|1}    { jpeg, width, height, label, taken, for }: each camera's picture
  //   cameraStations/{uid}/events/latest   { seq, events, updated }: the last 20 events, each with
  //                a rising `seq`, as the watcher gives them (darts, take-outs...), slimmed down.

  const STATIONS = "cameraStations";
  // Settings the station learned from the darts you kept and corrected (board-learn.js, which only
  // the station page loads; elsewhere nothing is learned).
  const learnedOptions = (setup) => (root.BoardLearn && setup && setup.learned && setup.learned.options ? root.BoardLearn.cleanLearned(setup.learned.options) : {});
  // A station gives a sign of life every BEAT_MS; with none for ONLINE_MS it counts as not running.
  const BEAT_MS = 20000, ONLINE_MS = 50000;
  // A station that has given no sign of life for this long has stopped: another may take over.
  const LEASE_MS = 50000;
  // A camera followed this far (mm) from its saved calibration has that saved as followed.
  const FOLLOW_MM = 1;
  const stationRef = (db, uid) => db.collection(STATIONS).doc(uid);
  const seenAt = (v) => (typeof v === "number" ? v : v && typeof v.toMillis === "function" ? v.toMillis() : 0);
  // Whether a station's last sign of life is recent (and it hasn't said it stopped).
  const isOnline = (doc) => !!(doc && doc.station && doc.station.on !== false && Date.now() - seenAt(doc.station.seen) < ONLINE_MS);
  // Whether the account has a camera station at all: cameras chosen for one, or one that has run.
  const hasStation = (doc) => !!(doc && ((doc.setup && Array.isArray(doc.setup.cameras) && doc.setup.cameras.some((c) => c && (c.deviceId || c.label))) || (doc.station && doc.station.seen)));
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const round = (v, n = 5) => (typeof v === "number" ? Math.round(v * 10 ** n) / 10 ** n : v);
  const point = (p) => (p ? { x: round(p.x), y: round(p.y) } : null);
  const numberOr = (v, n) => (typeof v === "number" && Number.isFinite(v) ? round(v, n) : null);
  // How a camera's calibration stands, in a few numbers, for the account.
  const slimResult = (r) => (r ? { ok: !!r.ok, how: r.how || null, why: r.why || null, moved: numberOr(r.moved, 2), edges: numberOr(r.edges, 0), rms: numberOr(r.rms, 2), at: r.at || null } : null);

  // Whether this browser has been the camera station (its page keeps its settings here): then
  // this is the computer with the cameras, and a game page can offer to open the station.
  function stationHere() {
    try { return !!localStorage.getItem("dt_station"); } catch (_) { return false; }
  }

  // The finest change threshold the cameras' noise allows: the lowest of `levels` ([{ threshold,
  // share }], as watcher.noise gives them) whose noise is at most `limit` of what starts a look.
  // With none that quiet, a step above the highest. Null with nothing to go on.
  function thresholdFloor(levels, limit = 0.35) {
    if (!levels || !levels.length) return null;
    const quiet = levels.filter((l) => l.share <= limit).map((l) => l.threshold);
    return quiet.length ? Math.min(...quiet) : Math.max(...levels.map((l) => l.threshold)) + 4;
  }

  // This browser, for telling two tabs of it from two computers (kept in localStorage).
  let hostMemo = null;
  function hostId() {
    try {
      let id = localStorage.getItem("dt_stationHost");
      if (!id) { id = newId(); localStorage.setItem("dt_stationHost", id); }
      return id;
    } catch (_) {
      hostMemo = hostMemo || newId();
      return hostMemo;
    }
  }

  // A timer for a page that may sit behind other windows (see workerTimer), or an ordinary one
  // where there are no workers: { set(fn, ms), clear() }.
  function backTimer() {
    const w = workerTimer();
    let t = null;
    return {
      set(fn, ms) {
        if (w) { w.set(fn, ms); return; }
        clearTimeout(t);
        t = setTimeout(fn, ms);
        if (t && typeof t.unref === "function") t.unref(); // under Node, a pending timer mustn't keep the tests alive
      },
      clear() { if (w) w.clear(); clearTimeout(t); t = null; },
    };
  }

  // An event as it is passed on: what the pages need, without the pictures and pixel lists.
  function slimEvent(e) {
    switch (e.type) {
      case "dart":
        return {
          type: "dart", index: e.index, label: e.label, target: e.target, ring: e.ring, points: e.points,
          app: point(e.app), real: point(e.real), uncertain: !!e.uncertain, confidence: round(e.confidence, 3),
          method: e.method, nearWire: !!e.nearWire, labels: e.labels || [],
        };
      case "takeout": return { type: "takeout", darts: e.darts || 0 };
      case "check": return { type: "check", warning: e.warning || null, swapped: !!e.swapped, cameras: (e.cameras || []).map((c) => ({ label: c.label, ok: !!c.ok, moved: round(c.moved, 2) })) };
      case "error": return { type: "error", text: String(e.text || "").slice(0, 300) };
      case "unreadable": case "blocked": case "ready": return { type: e.type };
      default: return null; // "moving", "quiet", "status": too chatty to pass on
    }
  }

  // A JPEG of a canvas, as a data URL small enough for a Firestore document (under about 700 kB).
  function jpegOf(canvas) {
    for (const q of [0.85, 0.75, 0.6]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length < 700000) return url;
    }
    return null;
  }

  // Runs the camera station on this computer for the signed-in user `uid`. `name` names this
  // computer for the others. onStatus(text, warn) says what it is doing; onEvent(event) passes on
  // the watcher's events (for showing them here too); onSetup(setup) is told when the account's
  // choice of cameras changes (the station puts each calibration with the camera it fits);
  // onCameras(list) how each camera's calibration stands: { label, cal, picture (a canvas of what
  // it was last checked on), result }; onLease({ active, by }) when this page becomes the account's
  // station, or stands by for another. Returns { start({ takeOver }), stop, choose(cameras),
  // calibrate(), takeOver(), running, active, watching, setup }: choose([{deviceId, label} | null,
  // ...]) picks this computer's cameras.
  //
  // Calibrating needs no taps. A chosen camera with no calibration is calibrated from what it shows
  // (calibrateFrom: the board is found in its picture), and so is one whose calibration no longer
  // fits when watching starts. One that had to be followed more than a little (the camera knocked)
  // is saved as followed, so the next start begins from where the camera is. calibrate(), or
  // ask.calibrate from any computer, does every camera afresh.
  //
  // Cameras can be unplugged and plugged in again (a laptop taken away and brought back): the
  // station stops watching when one is unplugged, and starts again by itself once they are all
  // plugged in, as it does when it starts with one missing.
  function createStation({ db, uid, name, onStatus = () => {}, onEvent = () => {}, onLearn = () => {}, onSetup = () => {}, onCameras = () => {}, onLease = () => {}, fps = 10, devices: listDevices = listCameras, obsTiming = {} }) {
    const ref = stationRef(db, uid), events = ref.collection("events").doc("latest");
    const me = newId(), host = hostId(), LOCK = "dt-camera-station:" + uid;
    // How often it looks for OBS, how long after OBS has gone it takes the cameras back, and how
    // long it waits for OBS to start after "Let OBS have the cameras" (ms).
    const OBS = Object.assign({ look: 3000, gone: 20000, wait: 180000 }, obsTiming);
    let unsub = null, doc = null, watcher = null, watchingKey = "", previews = [], recent = [], seq = 0;
    let running = false, active = false, status = "", busy = Promise.resolve();
    // `live`: the watcher has the cameras open and is reading them (not still opening them).
    let live = false;
    const watchingNow = () => !!(watcher && watcher.running && live);
    let handled = { still: null, clear: null, calibrate: null };
    let waiting = null, shownCameras = null, lock = null;
    // Letting OBS have the cameras: { since, why ("obs": OBS is running; "asked": the button), saw
    // (OBS has been seen running since), gone (when it was last seen to have stopped) }, or null.
    let resting = null;
    // For each chosen camera: the picture its calibration was last checked on, how that went, and
    // when the board was last found from scratch in it (not again straight away if that didn't hold).
    let shots = [], results = [], foundAt = [];
    const beatT = backTimer(), turnT = backTimer(), retryT = backTimer(), obsT = backTimer(), checkT = backTimer();
    const learning = createLearning();

    // What the detector made of each change, lately (station.trace, sent with the sign of life): for
    // finding out afterwards why a dart wasn't read. One short line each: the time, what it was
    // ("dart T20 overlap 0.94", "hand S5", "takeout 2", "quiet", "unreadable", "blocked", "removed",
    // "coarser 42"), and how long the picture took to hold still. "soon S18": a dart just after the
    // take-out, waiting to show it is one; "dart S18 ... soon" when it is counted (see afterOutMs). "early no: big" and the like: a
    // picture that held still for a moment before something else moved in, and why no dart was
    // read from it (see earlierDart in board-vision.js). Kept in this browser too, so the page
    // loading itself anew (an update) doesn't lose the evening's lines.
    const TRACE_KEY = "dt_station_trace:" + uid;
    let trace = [], quiets = 0, traceRev = 0, traceSent = 0;
    try {
      const kept = JSON.parse(localStorage.getItem(TRACE_KEY) || "[]");
      if (Array.isArray(kept)) trace = kept.filter((line) => typeof line === "string").slice(-400);
      if (trace.length) traceRev = 1; // sent again with the first sign of life
    } catch (_) { trace = []; }
    // How long the dart shows in each camera (board radii), for an early dart: what there is to
    // tell a dart from fingers by, should one ever be counted that wasn't there.
    const lengths = (e) => " len " + (e.readings || []).map((r) => (r && typeof r.lengthR === "number" ? r.lengthR.toFixed(2) : "-")).join("/");
    function traced(e) {
      if (!e || e.type === "moving" || e.type === "status" || e.type === "ready" || e.type === "check") return;
      const d = new Date(), two = (v) => String(v).padStart(2, "0");
      const at = `${d.getHours()}:${two(d.getMinutes())}:${two(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
      let what = e.type;
      if (e.type === "dart" || e.type === "hand" || e.type === "soon") what += ` ${e.label || "?"}${e.method ? " " + e.method : ""}${typeof e.confidence === "number" ? " " + e.confidence.toFixed(2) : ""}${e.early ? " early" + lengths(e) : ""}${e.type === "dart" && e.soon ? " soon" : ""}`;
      else if (e.type === "takeout") what += ` ${e.darts || 0}${e.late ? " late" : ""}`;
      else if (e.type === "coarser") what += ` ${e.threshold}`;
      else if (e.type === "error") what += " " + String(e.text || "").slice(0, 60);
      else if (e.type === "early") what += ` no: ${e.why}${e.extra ? " " + JSON.stringify(e.extra).slice(0, 40) : ""}`;
      else if (e.type === "started") what = `started ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
      const line = `${at} ${what}${typeof e.ms === "number" ? " " + e.ms + "ms" : ""}`;
      traceRev += 1;
      // Looks that found nothing can come in runs: one line for the run, with how many.
      if (e.type === "quiet" && quiets > 0 && trace.length) { quiets += 1; trace[trace.length - 1] = `${line} x${quiets}`; return; }
      quiets = e.type === "quiet" ? 1 : 0;
      trace = trace.concat([line]).slice(-400);
    }
    // From the detector: a picture it might have read a dart from, and why it didn't. (Not when it
    // simply wasn't a dart's turn: after a visit's third dart, that is every hand at the board.)
    const earlyNo = (kind, why, extra) => { if (kind === "early" && why !== "not a dart's turn") traced({ type: "early", why, extra }); };

    // What it is doing, here and (for the other computers, while this is the account's station) in
    // the account.
    const say = (text, warn) => {
      status = text;
      onStatus(text, !!warn);
      if (running && active) ref.set({ station: { status: String(text).slice(0, 200) } }, { merge: true }).catch(() => {});
    };
    const chosen = () => ((doc && doc.setup && doc.setup.cameras) || []).filter((c) => c && (c.deviceId || c.label));
    const hasCal = (c) => !!(c && c.cal && c.cal.H);
    const camName = (cams, i) => (cams.length > 1 ? `Camera ${i + 1}` : "The camera");

    // --- one station at a time ---------------------------------------------------------------------
    // Two stations reading one board would put every dart into the games twice. So a station claims
    // the account (station.id) before it opens a camera, and gives way the moment another claims
    // it. One that finds another running stands by, and takes over by itself when that one stops
    // (it says so) or goes quiet. Within one browser a lock tells at once when the page that had
    // the station is gone (closed, reloaded), without waiting for its sign of life to go stale.
    const theirs = (d) => { const s = d && d.station; return s && s.seen && s.id !== me ? s : null; };
    const alive = (s) => !!s && s.on !== false && s.status !== "Stopped." && Date.now() - seenAt(s.seen) < LEASE_MS;

    // Whether another page of this browser holds the station's lock. Where that can't be told
    // (no locks in this browser), it is taken to: the other station's sign of life decides.
    async function lockedElsewhere() {
      try {
        const state = await navigator.locks.query();
        return (state.held || []).some((l) => l.name === LOCK);
      } catch (_) {
        return true;
      }
    }
    function holdLock() {
      if (lock) return;
      const mine = { release: null };
      lock = mine;
      try {
        navigator.locks.request(LOCK, () => new Promise((release) => {
          mine.release = release;
          if (lock !== mine) { release(); return; }
          // Got it while standing by: the page that had the station in this browser is gone.
          const s = theirs(doc);
          if (running && !active && s && s.host === host) takeTurn();
        })).catch(() => {});
      } catch (_) { /* no locks here */ }
    }
    function dropLock() {
      const mine = lock;
      lock = null;
      if (mine && mine.release) mine.release();
    }

    // This page becomes the account's camera station.
    async function takeTurn() {
      if (active || !running) return;
      active = true;
      turnT.clear();
      try { onLease({ active: true }); } catch (_) { /* the page's business */ }
      say("Starting…");
      await ref.set({ uid, station: { id: me, host, name, on: true, claimed: Date.now(), seen: Date.now(), running: false, status: "Starting…" } }, { merge: true }).catch(() => {});
      if (!running || !active) return;
      try {
        const kept = JSON.parse(localStorage.getItem(REST_KEY) || "null");
        if (kept && kept.why === "asked" && Date.now() - kept.since < OBS.wait) resting = { since: kept.since, why: "asked", saw: !!kept.saw, gone: 0 };
      } catch (_) { /* no storage */ }
      await lookForObs(); // before a camera is opened: OBS may have them
      if (!running || !active) return;
      await heartbeat();
      learning.start();
      if (resting) say(restText(), true);
      busy = busy.then(() => reconcile()).then(() => sendStills("start")).catch(() => {});
    }

    // Another page is the account's camera station: this one lets go of the cameras and waits.
    function standBy(s) {
      const gaveWay = active;
      active = false;
      beatT.clear(); retryT.clear(); obsT.clear(); checkT.clear();
      if (watcher) watcher.stop();
      watcher = null; watchingKey = ""; live = false;
      resting = null; // whether OBS has the cameras is the other station's to see now
      stopWaiting(); closePreviews(); learning.stop();
      const here = !!(s && s.host && s.host === host);
      status = `The camera station is already running ${here ? "in another tab of this browser" : "on " + ((s && s.name) || "another computer")}. This page takes over by itself if that one stops.`;
      onStatus(status, true);
      try { onLease({ active: false, by: { name: (s && s.name) || "", here }, gaveWay }); } catch (_) { /* the page's business */ }
      // A station that stops without saying so just goes quiet: look again every few seconds.
      const look = () => {
        if (!running || active) return;
        if (!alive(theirs(doc))) takeTurn();
        else turnT.set(look, 5000);
      };
      turnT.set(look, 5000);
    }

    // --- sharing the cameras with OBS ----------------------------------------------------------------
    // Only one program can have a camera. OBS takes both for DartCounter, and the station needs
    // them for the games here, so the station gets out of OBS's way and comes back by itself:
    //   - OBS's virtual camera shows among the cameras only while OBS is running it. While it is
    //     there, the station leaves the cameras alone; a little after it has gone (OBS.gone), the
    //     station takes them back.
    //   - OBS only gets a camera that is free when OBS starts. "Let OBS have the cameras" (rest())
    //     frees them first; without it, OBS started beside a watching station shows black cameras
    //     until it is started again (the station having let go the moment it saw OBS).
    // So the station page never has to be closed for OBS, which is how it used to get left closed.
    // (A station set up on OBS's own picture reads that, and none of this applies.)
    const isObs = (d) => /\bobs\b|virtual cam/i.test((d && d.label) || "");
    const onObsPicture = () => chosen().some(isObs);
    const REST_KEY = "dt_stationRest";
    const keepRest = () => { try { if (resting) localStorage.setItem(REST_KEY, JSON.stringify(resting)); else localStorage.removeItem(REST_KEY); } catch (_) { /* private mode, or no storage */ } };
    function restText() {
      if (!resting) return "";
      return resting.saw
        ? "OBS is running and has the cameras (for DartCounter). The station takes them back by itself a few seconds after OBS closes."
        : "The cameras are free for OBS: start OBS now. The station takes them back by itself after OBS closes.";
    }
    function startRest(why, saw) {
      if (resting) {
        if (saw) resting.gone = 0;
        if (saw && !resting.saw) { resting.saw = true; keepRest(); say(restText(), true); heartbeat(); }
        return;
      }
      resting = { since: Date.now(), why, saw: !!saw, gone: 0 };
      keepRest();
      retryT.clear();
      if (watcher) watcher.stop();
      watcher = null; watchingKey = ""; live = false;
      stopWaiting(); closePreviews();
      say(restText(), true);
      heartbeat();
    }
    function endRest(text) {
      if (!resting) return;
      resting = null;
      keepRest();
      if (text) say(text);
      busy = busy.then(() => reconcile()).catch((error) => say(error.message, true));
      heartbeat();
    }
    // Looks whether OBS is running (its virtual camera is among the cameras), every few seconds
    // while this is the account's station.
    async function lookForObs() {
      if (!running || !active) return;
      let list = null;
      try { list = await listDevices(); } catch (_) { list = null; }
      if (!running || !active) return;
      if (list && !onObsPicture()) {
        if (list.some(isObs)) startRest("obs", true);
        else if (resting && resting.saw) {
          if (!resting.gone) { resting.gone = Date.now(); keepRest(); }
          else if (Date.now() - resting.gone >= OBS.gone) endRest("OBS has closed: taking the cameras back…");
        } else if (resting && Date.now() - resting.since >= OBS.wait) endRest("OBS didn't start, so the station has the cameras again.");
      } else if (resting && list) endRest(); // set up on OBS's own picture: nothing to wait for
      obsT.set(lookForObs, OBS.look);
    }

    function publish(e) {
      onEvent(e);
      traced(e);
      const slim = slimEvent(e);
      if (!slim) return;
      seq = Math.max(seq + 1, Date.now());
      if (e.type === "dart") learning.keep(seq, e);
      recent = recent.concat([Object.assign({ seq, at: Date.now() }, slim)]).slice(-20);
      events.set({ seq, events: recent, updated: Date.now() }).catch((error) => say("Couldn't pass a dart on: " + error.message, true));
      if (e.type === "error" && e.unplugged) unplugged();
    }

    // A camera stopped (unplugged): stop watching, and start again once the cameras are back.
    function unplugged() {
      if (!watcher || !running) return;
      watcher.stop();
      watcher = null; live = false;
      say("A camera was unplugged. The station starts watching again by itself once the cameras are plugged back in.", true);
      heartbeat();
      waitForCameras();
    }

    // Looks every few seconds (and whenever a camera is plugged in or out) for the chosen cameras;
    // once they are all plugged in, watches with them.
    function waitForCameras() {
      if (waiting || !running) return;
      const me2 = { timer: workerTimer(), t: null, onChange: null };
      const later = (ms) => {
        if (waiting !== me2) return;
        if (me2.timer) me2.timer.set(look, ms);
        else { clearTimeout(me2.t); me2.t = setTimeout(look, ms); }
      };
      async function look() {
        if (waiting !== me2) return;
        let devices = null;
        try { devices = await listCameras(); } catch (_) { /* try again */ }
        const want = ready({ cameras: chosen() });
        if (waiting === me2 && devices && want.length && matchCameras(want, devices).every(Boolean)) {
          stopWaiting();
          busy = busy.then(() => reconcile()).catch((error) => say(error.message, true));
          return;
        }
        later(3000);
      }
      // A camera just plugged in is given a moment to settle before it is opened.
      me2.onChange = () => later(1500);
      waiting = me2;
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", me2.onChange);
      later(3000);
    }
    function stopWaiting() {
      const w = waiting;
      if (!w) return;
      waiting = null;
      if (w.timer) w.timer.close();
      clearTimeout(w.t);
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) navigator.mediaDevices.removeEventListener("devicechange", w.onChange);
    }

    async function heartbeat() {
      if (!running || !active) return;
      let devices = [];
      try { devices = (await listCameras()).map((d) => ({ deviceId: d.deviceId, label: d.label })); } catch (_) { /* keep going */ }
      const frame = watcher && watcher.views[0] ? [watcher.views[0].frameW, watcher.views[0].frameH] : null;
      const sign = { name, seen: Date.now(), on: true, running: watchingNow(), resting: !!resting, status: status.slice(0, 200), devices: devices.slice(0, 8), frame };
      // The trace only when it has new lines (it is most of what this writes).
      if (traceRev !== traceSent) {
        traceSent = traceRev;
        sign.trace = trace;
        try { localStorage.setItem(TRACE_KEY, JSON.stringify(trace)); } catch (_) { /* not kept, then */ }
      }
      // The claim, again, should the account have lost it (the document written over from elsewhere).
      if (!(doc && doc.station && doc.station.id)) Object.assign(sign, { id: me, host });
      await ref.set({ uid, station: sign }, { merge: true }).catch(() => {});
      if (running && active) beatT.set(heartbeat, BEAT_MS);
    }

    // What each chosen camera shows now (a canvas each; null where there is none to be had): from
    // the watcher for the cameras it watches with, from a preview for the rest.
    async function pictures() {
      const cams = chosen(), out = cams.map(() => null);
      if (resting) return out; // OBS has the cameras
      const watched = watchingNow() ? cams.filter(hasCal) : [];
      if (watched.length) {
        const snaps = watcher.snapshot();
        if (snaps.length === watched.length) watched.forEach((c, j) => { out[cams.indexOf(c)] = snaps[j] || null; });
      }
      const rest = cams.filter((c, i) => !out[i]);
      if (rest.length) {
        await openPreviews(rest);
        cams.forEach((cam, i) => {
          if (out[i]) return;
          const p = previews.find((x) => x.key === (cam.deviceId || cam.label));
          out[i] = p && p.video.videoWidth ? still(p.video) : null;
        });
      }
      return out;
    }

    // Pictures of the board for calibrating from another computer.
    async function sendStills(requestId) {
      const cams = chosen(), canvases = await pictures();
      await Promise.all(cams.map((cam, i) => {
        const canvas = canvases[i];
        if (!canvas) return null;
        const jpeg = jpegOf(canvas);
        if (!jpeg) return null;
        return ref.collection("stills").doc(String(i)).set({ jpeg, width: canvas.width, height: canvas.height, label: cam.label || "", taken: Date.now(), for: requestId || "" });
      }));
    }

    // Previews (a camera kept open to take pictures from) for `only` of the chosen cameras, or all.
    async function openPreviews(only) {
      const cams = chosen(), want = cams.map((c) => c.deviceId || c.label);
      for (const p of previews) if (!want.includes(p.key)) closePreview(p);
      previews = previews.filter((p) => want.includes(p.key));
      const found = matchCameras(cams, await listCameras());
      if (found.some((d) => !d)) say(missingError(cams, found).message, true);
      for (let i = 0; i < cams.length; i += 1) {
        const cam = cams[i], key = want[i];
        if ((only && !only.includes(cam)) || previews.some((p) => p.key === key) || !found[i]) continue;
        const stream = await openStream(found[i].deviceId, cam.label);
        const video = await videoFor(stream);
        await settled(video, 400);
        previews.push({ key, stream, video });
      }
    }
    function closePreview(p) {
      p.stream.getTracks().forEach((t) => t.stop());
      if (p.video.parentNode) p.video.parentNode.removeChild(p.video);
    }
    function closePreviews() { previews.forEach(closePreview); previews = []; }

    // --- calibrating by itself ---------------------------------------------------------------------

    // How each chosen camera's calibration stands: told to this page with the picture it was last
    // checked on, and (in a few numbers) to the other computers, as station.cameras.
    function tellCameras() {
      const cams = chosen();
      try { onCameras(cams.map((c, i) => ({ label: c.label || "", cal: hasCal(c) ? c.cal : null, picture: shots[i] || null, result: results[i] || null }))); } catch (_) { /* the page's business */ }
      if (running && active) ref.set({ station: { cameras: cams.map((c, i) => slimResult(results[i])) } }, { merge: true }).catch(() => {});
    }
    const resultOf = (got) => ({ ok: true, how: got.how, moved: got.moved, edges: got.cal.refined.edges, rms: got.cal.refined.rms, at: Date.now() });
    const stamped = (cal) => Object.assign({ at: Date.now() }, cal);
    // The cameras with these calibrations, kept here straight away and in the account.
    function saveCameras(cameras, extra) {
      doc = Object.assign({}, doc, { setup: Object.assign({}, doc && doc.setup, { cameras }) });
      return ref.set(Object.assign({ uid, setup: { version: 1, cameras } }, extra), { merge: true });
    }

    // Chosen cameras with no calibration are calibrated from what they show, and saved. True when
    // one was: the account then has it, and watching starts with it. Otherwise it says which
    // camera can't see the board, and looks again in a few seconds.
    async function calibrateMissing() {
      const cams = chosen(), missing = cams.filter((c) => !hasCal(c));
      if (!missing.length) return false;
      say("Finding the board in the camera's picture…");
      await openPreviews(missing).catch((error) => say(error.message, true));
      if (!running || !active || resting) return false;
      const next = cams.slice(), blind = [];
      let any = false;
      cams.forEach((cam, i) => {
        if (hasCal(cam)) return;
        const p = previews.find((x) => x.key === (cam.deviceId || cam.label));
        const canvas = p && p.video.videoWidth ? still(p.video) : null;
        const got = canvas ? calibrateFrom(null, canvas, sharedIn(cams, i), i) : null;
        if (canvas) shots[i] = canvas;
        results[i] = got ? resultOf(got) : { ok: false, why: canvas ? "board" : "picture", at: Date.now() };
        if (got) { next[i] = Object.assign({}, cam, { cal: stamped(got.cal) }); any = true; } else blind.push(i);
      });
      if (any) await saveCameras(next).catch((error) => say("Couldn't save the calibration: " + error.message, true));
      if (blind.length) {
        const who = blind.map((i) => camName(cams, i)).join(" and ");
        say(`${who} can't see the whole board yet (or something is in front of it). Point ${blind.length > 1 ? "them" : "it"} so all of the board is in the picture: the station looks again every few seconds.`, true);
        retryT.set(() => { busy = busy.then(() => (running && active && chosen().some((c) => !hasCal(c)) ? calibrateMissing() : null)).catch(() => {}); }, 8000);
      }
      tellCameras();
      return any;
    }

    // Every chosen camera calibrated afresh from what it shows now ("Calibrate again", from this
    // page or, with `id`, from the computer that asked: it gets station.calibrated). A camera whose
    // board can't be made out keeps the calibration it had.
    async function calibrateNow(id) {
      const cams = chosen();
      if (!cams.length) { say("Choose this computer's cameras first.", true); return; }
      if (resting) {
        // Nothing to look at: OBS has the cameras. The one who asked is told it didn't happen.
        const none = cams.map(() => ({ ok: false, why: "obs", at: Date.now() }));
        await ref.set({ station: { calibrated: { for: id || "", at: Date.now(), cameras: none.map(slimResult) } } }, { merge: true }).catch(() => {});
        say("OBS has the cameras, so they can't be calibrated just now. " + restText(), true);
        return;
      }
      say("Calibrating: finding the board in each camera's picture…");
      const pics = await pictures().catch(() => cams.map(() => null));
      if (!running || !active) return;
      const next = cams.slice();
      cams.forEach((cam, i) => {
        const got = pics[i] ? calibrateFrom(cam.cal, pics[i], sharedIn(cams, i), i) : null;
        if (pics[i]) shots[i] = pics[i];
        results[i] = got ? resultOf(got) : { ok: false, why: pics[i] ? "board" : "picture", at: Date.now() };
        if (got) next[i] = Object.assign({}, cam, { cal: stamped(got.cal) });
      });
      const done = cams.map((c, i) => results[i]);
      await saveCameras(next, { station: { calibrated: { for: id || "", at: Date.now(), cameras: done.map(slimResult) } } });
      const bad = done.map((r, i) => (r.ok ? -1 : i)).filter((i) => i >= 0);
      if (!bad.length) say(`Calibrated ${cams.length > 1 ? "both cameras" : "the camera"} to the board.`);
      else say(`${bad.map((i) => camName(cams, i)).join(" and ")}: the board couldn't be made out (something in the way, too dark, or part of it out of the picture), so ${bad.length > 1 ? "they keep" : "it keeps"} the calibration from before.`, true);
      tellCameras();
      // Watching carries on with the new calibrations: the account's change brings reconcile round.
      busy = busy.then(() => reconcile()).catch((error) => say(error.message, true));
    }

    // What isn't right with a camera while the station watches, for the end of its status line
    // (so it stays said, rather than being written over by "Watching…"): one that can't see the
    // board and so isn't used, or one that couldn't be matched to the board and uses what it had.
    function trouble() {
      const cams = chosen(), unseen = [], unmatched = [];
      cams.forEach((c, i) => {
        if (!hasCal(c)) unseen.push(camName(cams, i));
        else if (results[i] && results[i].ok === false) unmatched.push(camName(cams, i));
      });
      return (unseen.length ? ` ${unseen.join(" and ")} can't see the whole board yet, so ${unseen.length > 1 ? "they aren't" : "it isn't"} used.` : "")
        + (unmatched.length ? ` ${unmatched.join(" and ")} couldn't be matched to the board just now (something in front of it?), so ${unmatched.length > 1 ? "they use" : "it uses"} the calibration from before.` : "");
    }

    // What the watcher depends on, field by field (the account may return a map's fields in
    // another order, which must not count as a change).
    function watchKey(cameras, options) {
      const lensKey = (l) => (l ? [l.cx, l.cy, l.s, l.k].join(",") : "");
      return JSON.stringify(ready({ cameras }).map((c) => [c.deviceId, c.label, c.cal.H.join(","), lensKey(c.cal.lens)])) + "|shadow=" + !!(options && options.shadow);
    }

    // Watch with the calibrated cameras; start again when the calibration changes.
    async function reconcile() {
      if (!running || !active || resting) return;
      const setup = { version: 1, cameras: chosen(), options: (doc && doc.setup && doc.setup.options) || {} };
      const calibrated = ready(setup);
      const key = watchKey(setup.cameras, setup.options);
      // Nothing new: watching already, or waiting for these cameras to be plugged in.
      if (key === watchingKey && (watcher || waiting || !calibrated.length)) return;
      if (watcher) { watcher.stop(); watcher = null; }
      live = false;
      stopWaiting(); retryT.clear(); checkT.clear();
      watchingKey = key;
      if (!setup.cameras.length) { say("Choose this computer's cameras."); tellCameras(); return; }
      // A camera with no calibration yet is calibrated from what it shows: no taps. Saved, it comes
      // back here through the account, and watching starts with it.
      if (setup.cameras.some((c) => !hasCal(c))) {
        const saved = await calibrateMissing();
        if (saved || !running || !active) return;
      }
      if (!calibrated.length) return;
      // The previews of cameras about to be watched are closed; one still waiting for its
      // calibration keeps its own.
      for (const p of previews.slice()) if (calibrated.some((c) => (c.deviceId || c.label) === p.key)) { closePreview(p); previews = previews.filter((x) => x !== p); }
      const w = createWatcher(setup, { onEvent: publish, fps, background: true, onFrames: null, options: { trace: earlyNo } });
      watcher = w;
      try {
        await w.start();
        if (watcher !== w) { w.stop(); return; } // stopped, or given way, while the cameras were opening
        live = true;
        traced({ type: "started" });
        const again = settle(w, setup, calibrated);
        if (!again) {
          const wrong = trouble();
          say(`Watching with ${calibrated.length} camera${calibrated.length > 1 ? "s" : ""}. Darts go to your games on any computer.`
            + (w.swapped ? " (Camera 1 and camera 2 had been plugged in the other way round: swapped back.)" : "") + wrong, !!wrong);
        }
      } catch (error) {
        if (watcher !== w) return; // stopped meanwhile: no longer this watcher's to report
        watcher = null; live = false;
        if (error.missing && running) {
          say(error.message + " The station starts watching by itself once they're plugged in.", true);
          waitForCameras();
        } else {
          watchingKey = ""; // tried again when the account changes (every heartbeat)
          say(error.message + " The station tries again by itself every few seconds.", true);
        }
      }
      heartbeat();
    }

    // Once watching has started, what it found out goes to the account, in one go:
    //   - which camera each calibration was found on, when that isn't the one it was saved with
    //     (two of a model plugged in the other way round, or under new ids), so every computer
    //     shows the right camera for each and the next start finds them straight away;
    //   - a calibration that had to be followed FOLLOW_MM or more (the camera knocked), saved as
    //     followed, so it doesn't drift further from the camera with every knock.
    // The watching carries on: nothing it depends on changes. Only a camera whose calibration
    // didn't fit at all, and whose board was then found from scratch, starts it again with that
    // (returns true).
    function settle(w, setup, calibrated) {
      const now = w.cameras, checks = w.checks, stills = w.stills;
      // Changed while the cameras were starting (a new calibration): it starts again with that.
      if (now.length !== calibrated.length || watchKey(chosen(), setup.options) !== watchKey(setup.cameras, setup.options)) return false;
      let moved = false, cals = false, again = false;
      const devices = setup.cameras.map((c) => {
        const j = calibrated.indexOf(c), d = j >= 0 ? now[j].device : null;
        if (!d || (d.deviceId === c.deviceId && d.label === c.label)) return c;
        moved = true;
        return Object.assign({}, c, { deviceId: d.deviceId, label: d.label });
      });
      // Never two cameras on one id where there weren't (that would read as OBS's two halves).
      const twice = (list) => list.length - new Set(list.map((c) => c.deviceId)).size;
      if (moved && twice(devices) > twice(setup.cameras)) moved = false;
      const cameras = (moved ? devices : setup.cameras).map((c, i) => {
        const j = calibrated.indexOf(setup.cameras[i]), check = j >= 0 ? checks[j] : null;
        if (!check) return c;
        if (stills[j]) shots[i] = stills[j];
        if (check.ok) {
          const followed = check.moved >= FOLLOW_MM && check.edges >= GOOD_EDGES && check.rms <= GOOD_RMS;
          results[i] = { ok: true, how: followed ? "followed" : "checked", moved: check.moved, edges: check.edges, rms: check.rms, at: Date.now() };
          if (!followed) return c;
          cals = true;
          return Object.assign({}, c, { cal: stamped(V.withPoints(now[j].cal)) });
        }
        // It doesn't fit what the camera shows any more: found from scratch, once (not round and
        // round if that doesn't hold either).
        const got = Date.now() - (foundAt[i] || 0) > 60000 ? calibrateFrom(c.cal, stills[j], sharedIn(setup.cameras, i), i) : null;
        results[i] = got ? resultOf(got) : { ok: false, why: "board", at: Date.now() };
        if (!got) return c;
        foundAt[i] = Date.now();
        cals = again = true;
        return Object.assign({}, c, { cal: stamped(got.cal) });
      });
      if (moved || cals) {
        // Not a change to what is being watched (unless the board was found from scratch).
        if (!again) watchingKey = watchKey(cameras, setup.options);
        saveCameras(cameras).catch((error) => say("Couldn't save the cameras' calibration: " + error.message, true));
      }
      tellCameras();
      if (again) say("A camera had moved too far for its calibration: found the board again in its picture, and starting with that.");
      else if (results.some((r) => r && r.ok === false)) checkT.set(() => { busy = busy.then(() => recheck()).catch(() => {}); }, 40000);
      return again;
    }

    // A camera whose calibration couldn't be checked as watching started (something in front of the
    // board, or no picture from the camera yet) is checked again once the board is quiet, so the
    // page doesn't go on saying so all evening. Only looked at: nothing is saved or started again.
    async function recheck() {
      if (!running || !active || resting || !watchingNow()) return;
      const cams = chosen(), det = watcher.detector;
      const later = (ms) => checkT.set(() => { busy = busy.then(() => recheck()).catch(() => {}); }, ms);
      if (det && (det.state !== "watching" || det.darts)) { later(20000); return; }
      const pics = await pictures().catch(() => cams.map(() => null));
      if (!running || !active || resting || !watchingNow()) return;
      let better = false, left = false;
      cams.forEach((cam, i) => {
        if (!hasCal(cam) || !results[i] || results[i].ok !== false) return;
        const got = pics[i] ? calibrateFrom(cam.cal, pics[i], sharedIn(cams, i), i) : null;
        if (!got) { left = true; return; }
        shots[i] = pics[i];
        results[i] = { ok: true, how: "checked", moved: got.moved, edges: got.cal.refined.edges, rms: got.cal.refined.rms, at: Date.now() };
        better = true;
      });
      if (better) {
        const n = cams.filter(hasCal).length, wrong = trouble();
        say(`Watching with ${n} camera${n > 1 ? "s" : ""}. Darts go to your games on any computer.` + wrong, !!wrong);
        tellCameras();
      }
      if (left) later(60000);
    }

    function onDoc(snap) {
      doc = snap.exists ? snap.data() : null;
      const s = theirs(doc);
      if (!active) {
        // Standing by: the other station has stopped.
        if (running && !alive(s)) takeTurn();
        return;
      }
      // Another page has claimed the station: this one gives way.
      if (s && s.id) { standBy(s); return; }
      const ask = (doc && doc.ask) || {};
      const cams = JSON.stringify(chosen().map((c) => [c.deviceId || "", c.label || ""]));
      if (cams !== shownCameras) {
        // Other cameras: what was known about the old ones goes.
        if (shownCameras !== null) { shots = []; results = []; foundAt = []; }
        shownCameras = cams;
        try { onSetup((doc && doc.setup) || null); } catch (_) { /* the page's business */ }
      }
      busy = busy.then(async () => {
        await reconcile();
        learning.apply();
        if (ask.still && ask.still !== handled.still) {
          handled.still = ask.still;
          await sendStills(ask.still).catch((error) => say("Couldn't send pictures: " + error.message, true));
        }
        if (ask.clear && ask.clear !== handled.clear) {
          handled.clear = ask.clear;
          if (watcher) watcher.markEmpty();
        }
        if (ask.calibrate && ask.calibrate !== handled.calibrate) {
          handled.calibrate = ask.calibrate;
          await calibrateNow(ask.calibrate).catch((error) => say("Couldn't calibrate: " + error.message, true));
        }
      }).catch((error) => say(error.message, true)); // one failure mustn't stop the ones after it
    }

    // --- learning from the darts you keep and correct (board-learn.js) ----------------------------
    // The pictures each of the last darts was read from are kept for a while. A game page writes a
    // note on each dart the cameras put in, once its visit is over (cameraStations/{uid}/notes/{seq}:
    // kept, or corrected to where it really landed); the note's dart is then kept with its pictures
    // on this computer, and every few corrections the darts are read again with other settings, in a
    // worker. Settings that read clearly more of them right are used from then on (setup.learned).
    function createLearning() {
      const BL = root.BoardLearn;
      const KEEP_PICTURES = 12, WAIT_MS = 45000, RUN_KEY = "dt_learn_run";
      const pictures = new Map();
      let notesUnsub = null, queue = Promise.resolve(), timer = null, busyLearning = false, shown = "";
      const notes = () => ref.collection("notes");
      const lastRun = () => { try { return JSON.parse(localStorage.getItem(RUN_KEY) || "null") || { samples: 0, corrected: 0 }; } catch (_) { return { samples: 0, corrected: 0 }; } };
      const saveRun = (c) => { try { localStorage.setItem(RUN_KEY, JSON.stringify({ samples: c.samples, corrected: c.corrected, at: Date.now() })); } catch (_) { /* private mode */ } };
      const tell = (extra) => BL.counts().then((c) => onLearn(Object.assign({ learned: doc && doc.setup && doc.setup.learned, last: doc && doc.setup && doc.setup.learning }, c, extra))).catch(() => {});

      // What a dart was read from: each camera's crop before and after it, and the views' calibrations.
      function keep(dartSeq, e) {
        if (!BL || !watcher || !watcher.detector || !(e.from || watcher.detector.last)) return;
        // (A dart read from the picture before a hand came in brings its own pictures: the
        // detector's last look is then the take-out.)
        const last = e.from || watcher.detector.last, views = watcher.views, cams = watcher.cameras;
        if (!last.before || !last.after || views.length !== cams.length) return;
        pictures.set(dartSeq, {
          label: e.label, before: last.before.slice(), after: last.after.slice(),
          cams: cams.map((c, i) => ({ deviceId: c.deviceId || "", label: c.label || "", cal: c.cal, frame: [views[i].frameW, views[i].frameH], shared: cams.filter((x) => x.deviceId === c.deviceId).length > 1, w: views[i].width, h: views[i].height })),
        });
        while (pictures.size > KEEP_PICTURES) pictures.delete(pictures.keys().next().value);
      }

      async function take(id, note) {
        const dartSeq = Number(note.seq), truth = note.truth;
        let stored = false;
        if (truth && truth.label) {
          const p = pictures.get(dartSeq);
          if (p) {
            const cams = [];
            for (let i = 0; i < p.cams.length; i += 1) {
              const c = p.cams[i];
              cams.push(Object.assign({}, c, { before: await BL.toImage(p.before[i], c.w, c.h), after: await BL.toImage(p.after[i], c.w, c.h) }));
            }
            await BL.putSample({ seq: dartSeq, at: Number(note.at) || Date.now(), outcome: note.outcome, page: note.page || "", read: note.read || { label: p.label }, truth, cams });
            stored = true;
          } else {
            // Kept earlier (a dart first left in, then corrected with "Edit my last visit").
            const old = await BL.getSample(dartSeq).catch(() => null);
            if (old) { old.outcome = note.outcome; old.truth = truth; await BL.putSample(old); stored = true; }
          }
        }
        await notes().doc(id).set({ pictures: stored }, { merge: true });
        if (stored) { await BL.trimSamples(); soon(); tell({ state: "noted", outcome: note.outcome }); }
      }

      function soon() {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; run().catch((error) => tell({ state: "error", text: error.message })); }, WAIT_MS);
      }

      // A worker reads the darts again, so the cameras aren't held up meanwhile.
      function inWorker(current, minThreshold) {
        return new Promise((resolve, reject) => {
          let w;
          try { w = new Worker("board-learn.js?v=4"); } catch (error) { reject(error); return; }
          const end = (fn, value) => { w.terminate(); fn(value); };
          w.onmessage = (event) => {
            const m = event.data || {};
            if (m.type === "progress") tell({ state: "learning", pass: m.pass, dart: m.dart, of: m.of });
            else if (m.type === "done") end(resolve, m.result);
            else if (m.type === "error") end(reject, new Error(m.text));
          };
          w.onerror = (event) => end(reject, new Error(event.message || "The learning worker stopped."));
          w.postMessage({ type: "learn", current, minThreshold });
        });
      }

      // The finest change threshold the cameras' noise allows right now (see thresholdFloor). When
      // that can't be measured (not watching, darts in the board), nothing finer than what is in use.
      async function floorNow(current) {
        const tried = BL.SEARCH.find((p) => p.key === "threshold").values;
        let levels = null;
        try { levels = watcher && watcher.noise ? await watcher.noise(tried) : null; } catch (_) { levels = null; }
        const inUse = Math.max(BL.BASE.threshold, Number(current.threshold) || 0);
        return { floor: levels ? thresholdFloor(levels) : inUse, levels };
      }

      // Learns when there is something new to learn from: three more corrected darts, or thirty more darts.
      async function run(force) {
        if (busyLearning || !running) return;
        const c = await BL.counts(), before = lastRun();
        if (c.samples < BL.MIN_DARTS) return;
        if (!force && c.corrected - before.corrected < 3 && c.samples - before.samples < 30) return;
        busyLearning = true;
        tell({ state: "learning", pass: 1, dart: 0, of: c.samples });
        try {
          const setup = (doc && doc.setup) || {};
          const current = Object.assign({}, learnedOptions(setup), setup.options || {});
          // The kept darts would always like a finer threshold; the live cameras' noise says how fine it may be.
          const { floor, levels } = await floorNow(current);
          const result = await inWorker(current, floor);
          saveRun(c);
          const use = BL.better(result);
          const summary = { at: Date.now(), n: result.n, corrected: result.corrected, right: result.right, was: result.was, used: use, changed: use ? result.changed : [], floor, noise: levels || null, forced: !!result.forced };
          const update = { setup: { learning: summary } };
          if (use) update.setup.learned = { options: result.options, at: summary.at, n: result.n, right: result.right, was: result.was };
          await ref.set(update, { merge: true });
          tell({ state: "done", result: summary });
        } finally {
          busyLearning = false;
        }
      }

      return {
        keep,
        start() {
          if (!BL || notesUnsub) return;
          notesUnsub = notes().where("at", ">", Date.now() - 6 * 3600 * 1000).onSnapshot((snap) => {
            (typeof snap.docChanges === "function" ? snap.docChanges() : []).forEach((change) => {
              if (change.type === "removed") return;
              const note = change.doc.data();
              if (note.pictures !== undefined) return; // already taken
              queue = queue.then(() => take(change.doc.id, note)).catch((error) => tell({ state: "error", text: "Couldn't keep a dart to learn from: " + error.message }));
            });
          }, () => {});
          tell({ state: "idle" });
          soon();
        },
        stop() {
          if (notesUnsub) notesUnsub();
          notesUnsub = null;
          if (timer) clearTimeout(timer);
          timer = null;
          pictures.clear();
        },
        // The watcher reads with what was learned (and forgets it when it is cleared), straight away.
        apply() {
          if (!BL) return;
          const setup = (doc && doc.setup) || {};
          const det = watcher && watcher.detector;
          if (det) Object.assign(det.options, BL.defaults(), learnedOptions(setup), setup.options || {});
          const key = JSON.stringify([setup.learned || null, setup.learning || null]);
          if (key !== shown) { shown = key; tell({}); }
        },
        learnNow: () => run(true),
      };
    }

    return {
      // With `takeOver`, this page becomes the station even if another is running (that one gives
      // way). Without, it stands by while another runs.
      async start({ takeOver = false } = {}) {
        if (running) return;
        running = true;
        status = "Starting…";
        onStatus(status, false);
        // Requests made while the station was off are old news.
        const first = await ref.get();
        const data = first.exists ? first.data() : null;
        doc = data;
        const asked = (data && data.ask) || {};
        handled = { still: asked.still || null, clear: asked.clear || null, calibrate: asked.calibrate || null };
        const s = theirs(doc);
        // Free to take: nobody has it, or the page that had it in this browser is gone.
        let free = takeOver || !alive(s);
        if (!free && s.host && s.host === host && !(await lockedElsewhere())) free = true;
        if (!running) return;
        holdLock();
        if (free) await takeTurn();
        else standBy(s);
        if (!running) return;
        unsub = ref.onSnapshot(onDoc, (error) => say("Lost touch with your account: " + error.message, true));
      },
      stop() {
        const mine = active;
        running = false; active = false;
        if (unsub) unsub();
        unsub = null;
        beatT.clear(); turnT.clear(); retryT.clear(); obsT.clear(); checkT.clear();
        if (watcher) watcher.stop();
        watcher = null; watchingKey = ""; live = false;
        stopWaiting();
        closePreviews();
        learning.stop();
        dropLock();
        // Only the account's station says it stopped: one standing by leaves the other's word alone.
        if (mine) ref.set({ station: { name, seen: Date.now(), on: false, running: false, resting: false, status: "Stopped." } }, { merge: true }).catch(() => {});
        status = "Stopped.";
        onStatus(status, false);
      },
      // This page takes the station over from the one that has it.
      takeOver() {
        if (!running || active) return Promise.resolve();
        return takeTurn();
      },
      // Lets go of the cameras so OBS can have them (before starting OBS); the station takes them
      // back by itself once OBS has come and gone. resume() takes them back now.
      rest() { if (running && active && !onObsPicture()) startRest("asked", false); },
      resume() { if (running && active) endRest("Taking the cameras back…"); },
      get resting() { return !!resting; },
      // Every camera calibrated afresh from what it shows now (no taps).
      calibrate() {
        if (!running || !active) return Promise.resolve();
        busy = busy.then(() => calibrateNow("")).catch((error) => say("Couldn't calibrate: " + error.message, true));
        return busy;
      },
      // This computer's cameras for the station (up to two; null for none). A camera of another
      // model loses its calibration. One of the same model keeps it: two of a model can come back
      // with each other's ids when plugged in again, and the station tells them apart by what they see.
      async choose(list) {
        // Called before start() too (the page picks the cameras, then starts): read what is saved
        // first, so the calibrations of cameras that stay the same are kept.
        if (!doc) {
          const snap = await ref.get();
          doc = snap.exists ? snap.data() : null;
        }
        const before = chosen();
        const cameras = list.slice(0, 2).map((c, i) => {
          if (!c) return null;
          const old = before[i];
          const same = old && (old.deviceId === c.deviceId || (!!old.label && old.label === c.label));
          return { deviceId: c.deviceId, label: c.label, cal: same && old.cal ? old.cal : null };
        }).filter(Boolean);
        await ref.set({ uid, setup: { version: 1, cameras } }, { merge: true });
      },
      get running() { return running; },
      get active() { return active; },
      get watching() { return watchingNow(); },
      get setup() { return doc && doc.setup; },
      get id() { return me; },
      learnNow: () => learning.learnNow(),
    };
  }

  // A watcher (as createWatcher) for darts read by the owner's camera station on another
  // computer. Events come as the station sends them, plus "status"/"error" for it being on or off.
  function createRemoteWatcher(db, uid, { onEvent = () => {} } = {}) {
    const ref = stationRef(db, uid);
    let unsubs = [], running = false, lastSeq = null, doc = null, online = null, state = null, down = "", timer = null, readySent = false;

    // Three things it can be: watching; on but not watching (a camera unplugged, or still being
    // calibrated: the station's own words say which); or not running at all.
    function checkOnline() {
      const calibrated = !!(doc && ready(doc.setup).length), on = isOnline(doc);
      const st = (doc && doc.station) || {};
      // On, calibrated, and not saying it isn't watching (a station from before it said so counts).
      const now = on && calibrated && st.running !== false ? "watching" : on ? "idle:" + (st.resting ? "obs" : calibrated ? st.status || "" : "calibrating") : "off";
      if (now === state) return;
      state = now;
      online = now === "watching";
      const where = st.name ? ` on ${st.name}` : "";
      if (online) {
        down = "";
        onEvent({ type: "status", text: `Watching with the camera station${where}.` });
        if (!readySent && lastSeq !== null) { readySent = true; onEvent({ type: "ready" }); }
      } else if (on && !calibrated) {
        down = "The cameras aren't calibrated yet";
        onEvent({ type: "error", text: `The camera station${where} is running, but its cameras aren't calibrated yet. It does that by itself once each camera sees the whole board: have a look at the Camera station page.` });
      } else if (on && !st.resting && /^(Starting|Opening the cameras|Taking the cameras back|OBS has closed)/.test(st.status || "")) {
        // A few seconds while it opens the cameras: not something wrong.
        down = "The cameras are starting";
        onEvent({ type: "status", text: `The camera station${where} is starting…` });
      } else if (on && st.resting) {
        down = "OBS has the cameras";
        onEvent({ type: "error", text: `OBS has the cameras${where}. Close OBS there: the camera station takes them back by itself a few seconds later.` });
      } else if (on) {
        down = "The camera station isn't watching";
        onEvent({ type: "error", text: `The camera station${where} is on but not watching the board${st.status ? ": " + String(st.status).slice(0, 160) : "."}` });
      } else {
        down = "The camera station isn't running";
        onEvent({ type: "error", text: `The camera station${where} isn't running. Open the Camera station page on the computer with the cameras.` });
      }
    }

    return {
      remote: true,
      start() {
        if (running) return Promise.resolve();
        running = true;
        onEvent({ type: "status", text: "Connecting to the camera station…" });
        return new Promise((resolveStart, reject) => {
          let first = true;
          unsubs.push(ref.onSnapshot((snap) => {
            doc = snap.exists ? snap.data() : null;
            if (first) {
              first = false;
              if (!doc) { this.stop(); reject(new Error("No camera station is set up yet. Open the Camera station page on the computer with the cameras.")); return; }
              resolveStart();
            }
            checkOnline();
          }, (error) => { if (first) { first = false; reject(error); } else onEvent({ type: "error", text: "Lost touch with the camera station: " + error.message }); }));
          unsubs.push(ref.collection("events").doc("latest").onSnapshot((snap) => {
            const data = snap.exists ? snap.data() : null;
            const list = data && Array.isArray(data.events) ? data.events : [];
            if (lastSeq === null) {
              // Only what happens from now on; but say how the station's last check went.
              lastSeq = data && data.seq ? data.seq : 0;
              const check = list.filter((e) => e.type === "check").pop();
              if (check) onEvent(check);
              if (online && !readySent) { readySent = true; onEvent({ type: "ready" }); }
              return;
            }
            for (const e of list) {
              if (!(e.seq > lastSeq)) continue;
              lastSeq = e.seq;
              if (e.type === "ready") continue; // the station starting again: nothing to do here
              onEvent(e);
            }
          }));
          timer = setInterval(checkOnline, 15000);
          // Stopped while it was setting up (no station): leave nothing running.
          if (!running) this.stop();
        });
      },
      stop() {
        running = false;
        unsubs.forEach((u) => u());
        unsubs = [];
        if (timer) clearInterval(timer);
        timer = null;
      },
      get running() { return running; },
      // Why the cameras aren't reading, in a few words for the game's screen ("" when they are).
      get down() { return running ? down : ""; },
      // The station isn't running at all (its page is closed): opening it is what is needed.
      get stationOff() { return running && state === "off"; },
      get views() { return []; },
      get detector() { return null; },
      get cameras() { return (doc && doc.setup && doc.setup.cameras) || []; },
      get stills() { return []; },
      get checks() { return []; },
      get station() { return doc && doc.station; },
      markEmpty() { ref.set({ ask: { clear: newId() } }, { merge: true }).catch(() => {}); },
      snapshot() { return []; },
    };
  }

  // A note on a dart the cameras put into a game, once its visit is over: "kept" (left in, so read
  // right) or "corrected" (truth: where it really landed). The camera station keeps that dart's
  // pictures with it and learns from them (board-learn.js). Points are app positions ({ label, x, y }).
  function noteDart(db, uid, { seq, page, outcome, read, truth }) {
    if (!db || !uid || !Number.isInteger(seq) || seq <= 0) return Promise.resolve();
    const clean = (p) => (p ? { label: String(p.label || "").slice(0, 8), x: Number.isFinite(p.x) ? round(p.x, 4) : null, y: Number.isFinite(p.y) ? round(p.y, 4) : null } : null);
    return stationRef(db, uid).collection("notes").doc(String(seq)).set({ seq, at: Date.now(), page, outcome, read: clean(read), truth: clean(truth) }).catch(() => {});
  }

  // Forgets what the station learned: it reads with the usual settings again (the darts it learned
  // from stay on its computer, and it may learn again from them and new ones).
  function forgetLearned(db, uid) {
    return stationRef(db, uid).set({ uid, setup: { learned: null } }, { merge: true });
  }

  // The owner's camera station document, or null.
  async function getStation(db, uid) {
    if (!db || !uid) return null;
    try {
      const snap = await stationRef(db, uid).get();
      return snap.exists ? snap.data() : null;
    } catch (_) {
      return null;
    }
  }

  // The cameras to score with here. An account with a camera station uses that and nothing else,
  // running or not: when it isn't, the page says so and carries on by itself once it is. A page
  // never opens the cameras as well: two readers of one board put every dart in twice (on Nov 16,
  // 2026 a tracker page that had fallen back to its own cameras while the station was closed kept
  // reading beside the reopened station: three darts at 20 went in as six, three of them misses at
  // 19). Only an account with no station at all uses cameras set up in this browser, and hands over
  // if a station turns up. Null when there are no cameras at all.
  async function chooseWatcher({ db, user, onEvent }) {
    const station = user ? await getStation(db, user.uid) : null;
    if (hasStation(station)) return createRemoteWatcher(db, user.uid, { onEvent });
    if (!ready(load()).length) return null;
    return user && db ? createLocalWatcher(db, user.uid, load(), { onEvent }) : createWatcher(load(), { onEvent });
  }

  // This browser's own cameras, for an account with no camera station. If a station turns up while
  // it watches, it stops and the station's darts are used from then on: never both at once.
  function createLocalWatcher(db, uid, setup, { onEvent = () => {} } = {}) {
    let inner = createWatcher(setup, { onEvent }), unsub = null, running = false, handed = false;
    const handOver = () => {
      if (handed || !running) return;
      handed = true;
      inner.stop();
      inner = createRemoteWatcher(db, uid, { onEvent });
      inner.start().catch((error) => onEvent({ type: "error", text: error.message }));
    };
    return {
      async start() {
        if (running) return;
        running = true;
        try { await inner.start(); } catch (error) { running = false; throw error; }
        if (!running) return;
        try {
          unsub = stationRef(db, uid).onSnapshot((snap) => { if (hasStation(snap.exists ? snap.data() : null)) handOver(); }, () => {});
        } catch (_) { /* no account to watch: this browser's cameras it is */ }
      },
      stop() {
        running = false;
        if (unsub) unsub();
        unsub = null;
        inner.stop();
      },
      get remote() { return handed; },
      get running() { return running; },
      get down() { return handed ? inner.down : ""; },
      get stationOff() { return handed ? inner.stationOff : false; },
      get views() { return inner.views; },
      get detector() { return inner.detector; },
      get cameras() { return inner.cameras; },
      get stills() { return inner.stills; },
      get checks() { return inner.checks; },
      get station() { return inner.station; },
      markEmpty() { inner.markEmpty(); },
      snapshot() { return inner.snapshot(); },
    };
  }

  // Asks the station for fresh pictures and waits for them (up to `ms`): canvases, one per camera.
  function requestStills(db, uid, ms = 15000) {
    const ref = stationRef(db, uid), id = newId();
    return new Promise((resolveStills, reject) => {
      const got = new Map();
      let count = 0;
      const unsubs = [];
      const done = (error) => { unsubs.forEach((u) => u()); clearTimeout(timer); if (error) reject(error); };
      const timer = setTimeout(() => done(new Error("The camera station didn't send pictures. Is the Camera station page open on the computer with the cameras?")), ms);
      ref.get().then((snap) => {
        const cams = (snap.exists && snap.data().setup && snap.data().setup.cameras) || [];
        count = cams.length;
        if (!count) { done(new Error("The camera station has no cameras chosen yet.")); return; }
        for (let i = 0; i < count; i += 1) {
          unsubs.push(ref.collection("stills").doc(String(i)).onSnapshot((s) => {
            const d = s.exists ? s.data() : null;
            if (!d || d.for !== id || got.has(i)) return;
            const img = new Image();
            img.onload = () => {
              const c = document.createElement("canvas");
              c.width = img.naturalWidth; c.height = img.naturalHeight;
              c.getContext("2d", { willReadFrequently: true }).drawImage(img, 0, 0);
              got.set(i, c);
              if (got.size === count) { done(); resolveStills(Array.from({ length: count }, (_, k) => got.get(k))); }
            };
            img.src = d.jpeg;
          }));
        }
        return ref.set({ ask: { still: id } }, { merge: true });
      }).catch((error) => done(error));
    });
  }

  // Asks the station to calibrate every camera afresh from what it shows now (no taps), and waits
  // (up to `ms`) for how it went: { at, cameras: [{ ok, how, moved, edges, rms } | null, ...] }.
  function requestCalibration(db, uid, ms = 40000) {
    const ref = stationRef(db, uid), id = newId();
    return new Promise((resolveDone, reject) => {
      let unsub = null, over = false;
      const done = (error, value) => {
        if (over) return;
        over = true;
        if (unsub) unsub();
        clearTimeout(timer);
        if (error) reject(error); else resolveDone(value);
      };
      const timer = setTimeout(() => done(new Error("The camera station didn't answer. Is the Camera station page open on the computer with the cameras?")), ms);
      unsub = ref.onSnapshot((snap) => {
        const c = snap.exists && snap.data().station ? snap.data().station.calibrated : null;
        if (c && c.for === id) done(null, c);
      }, (error) => done(error));
      if (over && unsub) unsub();
      ref.set({ ask: { calibrate: id } }, { merge: true }).catch((error) => done(error));
    });
  }

  // How the board is lit, for the station (kept in the account with the calibration):
  // { shadow: true } when a single lamp casts hard shadows beside every dart.
  function setStationOptions(db, uid, options) {
    return stationRef(db, uid).set({ uid, setup: { options } }, { merge: true });
  }

  // Saves calibrations made on another computer for the station's cameras.
  function saveStationSetup(db, uid, cameras) {
    return stationRef(db, uid).set({ uid, setup: { version: 1, cameras } }, { merge: true });
  }

  root.DartCamera = {
    KEY, load, save, ready, listCameras, requestAccess, openStream, videoFor, still, pixelsOf, lensOptions, snap, explain, resolve, matchCameras, otherWayFits, createWatcher,
    isOnline, hasStation, stationHere, thresholdFloor, slimEvent, createStation, createRemoteWatcher, createLocalWatcher, getStation, chooseWatcher, requestStills, requestCalibration, saveStationSetup, setStationOptions,
    calibrateFrom, findBoardCameras, GOOD_EDGES, GOOD_RMS,
    noteDart, forgetLearned, learnedOptions,
  };
})(typeof self !== "undefined" ? self : this);
