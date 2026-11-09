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
  const V = root.BoardVision;
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
      case "AbortError": return `${name} is in use by another program. Close OBS (or whatever else is using it), or choose "OBS Virtual Camera" instead.`;
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
      try {
        const found = matchCameras(cams, await listCameras());
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
            const video = await videoFor(stream);
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
  //       station  { name, seen, running, status, devices, frame }: written by the station; `seen`
  //                (ms) every 20 s while it runs.
  //       ask      { still, clear }: requests from other computers (an id each): send fresh
  //                pictures; the board is clear now.
  //   cameraStations/{uid}/stills/{0|1}    { jpeg, width, height, label, taken, for }: each camera's picture
  //   cameraStations/{uid}/events/latest   { seq, events, updated }: the last 20 events, each with
  //                a rising `seq`, as the watcher gives them (darts, take-outs...), slimmed down.

  const STATIONS = "cameraStations";
  // Settings the station learned from the darts you kept and corrected (board-learn.js, which only
  // the station page loads; elsewhere nothing is learned).
  const learnedOptions = (setup) => (root.BoardLearn && setup && setup.learned && setup.learned.options ? root.BoardLearn.cleanLearned(setup.learned.options) : {});
  const BEAT_MS = 20000, ONLINE_MS = 90000;
  const stationRef = (db, uid) => db.collection(STATIONS).doc(uid);
  const seenAt = (v) => (typeof v === "number" ? v : v && typeof v.toMillis === "function" ? v.toMillis() : 0);
  // Whether a station's last sign of life is recent.
  const isOnline = (doc) => !!(doc && doc.station && Date.now() - seenAt(doc.station.seen) < ONLINE_MS);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const round = (v, n = 5) => (typeof v === "number" ? Math.round(v * 10 ** n) / 10 ** n : v);
  const point = (p) => (p ? { x: round(p.x), y: round(p.y) } : null);

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
  // choice of cameras changes (the station puts each calibration with the camera it fits). Returns
  // { start, stop, choose(cameras), running, setup }: choose([{deviceId, label} | null, ...]) picks
  // this computer's cameras.
  //
  // Cameras can be unplugged and plugged in again (a laptop taken away and brought back): the
  // station stops watching when one is unplugged, and starts again by itself once they are all
  // plugged in, as it does when it starts with one missing.
  function createStation({ db, uid, name, onStatus = () => {}, onEvent = () => {}, onLearn = () => {}, onSetup = () => {}, fps = 10 }) {
    const ref = stationRef(db, uid), events = ref.collection("events").doc("latest");
    let unsub = null, doc = null, watcher = null, watchingKey = "", previews = [], recent = [], seq = 0;
    let beat = null, running = false, status = "", handled = { still: null, clear: null }, busy = Promise.resolve();
    let waiting = null, shownCameras = null;
    const beatTimer = workerTimer();
    const learning = createLearning();

    // What it is doing, here and (for the other computers) in the account.
    const say = (text, warn) => {
      status = text;
      onStatus(text, !!warn);
      if (running) ref.set({ station: { status: String(text).slice(0, 200) } }, { merge: true }).catch(() => {});
    };
    const chosen = () => ((doc && doc.setup && doc.setup.cameras) || []).filter((c) => c && (c.deviceId || c.label));

    function publish(e) {
      onEvent(e);
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
      watcher = null;
      say("A camera was unplugged. The station starts watching again by itself once the cameras are plugged back in.", true);
      heartbeat();
      waitForCameras();
    }

    // Looks every few seconds (and whenever a camera is plugged in or out) for the chosen cameras;
    // once they are all plugged in, watches with them.
    function waitForCameras() {
      if (waiting || !running) return;
      const me = { timer: workerTimer(), t: null, onChange: null };
      const later = (ms) => {
        if (waiting !== me) return;
        if (me.timer) me.timer.set(look, ms);
        else { clearTimeout(me.t); me.t = setTimeout(look, ms); }
      };
      async function look() {
        if (waiting !== me) return;
        let devices = null;
        try { devices = await listCameras(); } catch (_) { /* try again */ }
        const want = ready({ cameras: chosen() });
        if (waiting === me && devices && want.length && matchCameras(want, devices).every(Boolean)) {
          stopWaiting();
          busy = busy.then(() => reconcile()).catch((error) => say(error.message, true));
          return;
        }
        later(3000);
      }
      // A camera just plugged in is given a moment to settle before it is opened.
      me.onChange = () => later(1500);
      waiting = me;
      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", me.onChange);
      later(3000);
    }
    function stopWaiting() {
      const me = waiting;
      if (!me) return;
      waiting = null;
      if (me.timer) me.timer.close();
      clearTimeout(me.t);
      if (navigator.mediaDevices && navigator.mediaDevices.removeEventListener) navigator.mediaDevices.removeEventListener("devicechange", me.onChange);
    }

    async function heartbeat() {
      if (!running) return;
      let devices = [];
      try { devices = (await listCameras()).map((d) => ({ deviceId: d.deviceId, label: d.label })); } catch (_) { /* keep going */ }
      const frame = watcher && watcher.views[0] ? [watcher.views[0].frameW, watcher.views[0].frameH] : null;
      await ref.set({ uid, station: { name, seen: Date.now(), running: !!(watcher && watcher.running), status: status.slice(0, 200), devices: devices.slice(0, 8), frame } }, { merge: true }).catch(() => {});
      if (running) {
        if (beatTimer) beatTimer.set(heartbeat, BEAT_MS);
        else beat = setTimeout(heartbeat, BEAT_MS);
      }
    }

    // Pictures of the board for calibrating: from the watcher if it is running, else from previews.
    async function sendStills(requestId) {
      let canvases = watcher && watcher.running ? watcher.snapshot() : [];
      if (!canvases.length) {
        await openPreviews();
        canvases = chosen().map((cam) => {
          const p = previews.find((x) => x.key === (cam.deviceId || cam.label));
          return p && p.video.videoWidth ? still(p.video) : null;
        });
      }
      const cams = chosen();
      await Promise.all(cams.map((cam, i) => {
        const canvas = canvases[i];
        if (!canvas) return null;
        const jpeg = jpegOf(canvas);
        if (!jpeg) return null;
        return ref.collection("stills").doc(String(i)).set({ jpeg, width: canvas.width, height: canvas.height, label: cam.label || "", taken: Date.now(), for: requestId || "" });
      }));
    }

    async function openPreviews() {
      const cams = chosen(), want = cams.map((c) => c.deviceId || c.label);
      for (const p of previews) if (!want.includes(p.key)) closePreview(p);
      previews = previews.filter((p) => want.includes(p.key));
      const found = matchCameras(cams, await listCameras());
      if (found.some((d) => !d)) say(missingError(cams, found).message, true);
      for (let i = 0; i < cams.length; i += 1) {
        const cam = cams[i], key = want[i];
        if (previews.some((p) => p.key === key) || !found[i]) continue;
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

    // What the watcher depends on, field by field (the account may return a map's fields in
    // another order, which must not count as a change).
    function watchKey(cameras, options) {
      const lensKey = (l) => (l ? [l.cx, l.cy, l.s, l.k].join(",") : "");
      return JSON.stringify(ready({ cameras }).map((c) => [c.deviceId, c.label, c.cal.H.join(","), lensKey(c.cal.lens)])) + "|shadow=" + !!(options && options.shadow);
    }

    // Watch with the calibrated cameras; start again when the calibration changes.
    async function reconcile() {
      const setup = { version: 1, cameras: chosen(), options: (doc && doc.setup && doc.setup.options) || {} };
      const calibrated = ready(setup);
      const key = watchKey(setup.cameras, setup.options);
      // Nothing new: watching already, or waiting for these cameras to be plugged in.
      if (key === watchingKey && (watcher || waiting || !calibrated.length)) return;
      if (watcher) { watcher.stop(); watcher = null; }
      stopWaiting();
      watchingKey = key;
      if (!calibrated.length) {
        say(chosen().length ? "Waiting for the cameras to be calibrated (Cameras page, on any computer)." : "Choose this computer's cameras.");
        if (chosen().length) await openPreviews().catch((error) => say(error.message, true));
        return;
      }
      closePreviews();
      const w = createWatcher(setup, { onEvent: publish, fps, background: true, onFrames: null });
      watcher = w;
      try {
        await w.start();
        keepDevices(w, setup, calibrated);
        say(`Watching with ${calibrated.length} camera${calibrated.length > 1 ? "s" : ""}. Darts go to your games on any computer.`
          + (w.swapped ? " (Camera 1 and camera 2 had been plugged in the other way round: swapped back.)" : ""));
      } catch (error) {
        if (watcher === w) watcher = null;
        if (error.missing && running) {
          say(error.message + " The station starts watching by itself once they're plugged in.", true);
          waitForCameras();
        } else {
          watchingKey = ""; // tried again when the account changes (every heartbeat)
          say(error.message, true);
        }
      }
      heartbeat();
    }

    // Tells the account which camera each calibration was found on, when that isn't the one it was
    // saved with (two of a model plugged in the other way round, or under new ids), so every
    // computer shows the right camera for each and the next start finds them straight away. The
    // watching carries on: nothing it depends on changes.
    function keepDevices(w, setup, calibrated) {
      const now = w.cameras;
      // Changed while the cameras were starting (a new calibration): it starts again with that.
      if (now.length !== calibrated.length || watchKey(chosen(), setup.options) !== watchKey(setup.cameras, setup.options)) return;
      let changed = false;
      const cameras = setup.cameras.map((c) => {
        const j = calibrated.indexOf(c), d = j >= 0 ? now[j].device : null;
        if (!d || (d.deviceId === c.deviceId && d.label === c.label)) return c;
        changed = true;
        return Object.assign({}, c, { deviceId: d.deviceId, label: d.label });
      });
      // Never two cameras on one id where there weren't (that would read as OBS's two halves).
      const twice = (list) => list.length - new Set(list.map((c) => c.deviceId)).size;
      if (!changed || twice(cameras) > twice(setup.cameras)) return;
      watchingKey = watchKey(cameras, setup.options);
      // Here straight away too, so nothing reads the old ids before the account answers.
      doc = Object.assign({}, doc, { setup: Object.assign({}, doc && doc.setup, { cameras }) });
      ref.set({ uid, setup: { version: 1, cameras } }, { merge: true }).catch((error) => say("Couldn't save which camera is which: " + error.message, true));
    }

    function onDoc(snap) {
      doc = snap.exists ? snap.data() : null;
      const ask = (doc && doc.ask) || {};
      const cams = JSON.stringify(chosen().map((c) => [c.deviceId || "", c.label || ""]));
      if (cams !== shownCameras) {
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
        if (!BL || !watcher || !watcher.detector || !watcher.detector.last) return;
        const last = watcher.detector.last, views = watcher.views, cams = watcher.cameras;
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
      function inWorker(current) {
        return new Promise((resolve, reject) => {
          let w;
          try { w = new Worker("board-learn.js?v=3"); } catch (error) { reject(error); return; }
          const end = (fn, value) => { w.terminate(); fn(value); };
          w.onmessage = (event) => {
            const m = event.data || {};
            if (m.type === "progress") tell({ state: "learning", pass: m.pass, dart: m.dart, of: m.of });
            else if (m.type === "done") end(resolve, m.result);
            else if (m.type === "error") end(reject, new Error(m.text));
          };
          w.onerror = (event) => end(reject, new Error(event.message || "The learning worker stopped."));
          w.postMessage({ type: "learn", current });
        });
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
          const result = await inWorker(current);
          saveRun(c);
          const use = BL.better(result);
          const summary = { at: Date.now(), n: result.n, corrected: result.corrected, right: result.right, was: result.was, used: use, changed: use ? result.changed : [] };
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
      async start() {
        if (running) return;
        running = true;
        say("Starting…");
        // Requests made while the station was off are old news.
        const first = await ref.get();
        const data = first.exists ? first.data() : null;
        doc = data;
        handled = { still: data && data.ask ? data.ask.still || null : null, clear: data && data.ask ? data.ask.clear || null : null };
        await heartbeat();
        unsub = ref.onSnapshot(onDoc, (error) => say("Lost touch with your account: " + error.message, true));
        learning.start();
        // Fresh pictures for calibrating straight away.
        busy = busy.then(() => sendStills("start")).catch(() => {});
      },
      stop() {
        running = false;
        if (unsub) unsub();
        unsub = null;
        if (beat) clearTimeout(beat);
        if (beatTimer) beatTimer.clear();
        if (watcher) watcher.stop();
        watcher = null; watchingKey = "";
        stopWaiting();
        closePreviews();
        learning.stop();
        ref.set({ station: { name, seen: Date.now(), running: false, status: "Stopped." } }, { merge: true }).catch(() => {});
        say("Stopped.");
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
      get watching() { return !!(watcher && watcher.running); },
      get setup() { return doc && doc.setup; },
      learnNow: () => learning.learnNow(),
    };
  }

  // A watcher (as createWatcher) for darts read by the owner's camera station on another
  // computer. Events come as the station sends them, plus "status"/"error" for it being on or off.
  function createRemoteWatcher(db, uid, { onEvent = () => {} } = {}) {
    const ref = stationRef(db, uid);
    let unsubs = [], running = false, lastSeq = null, doc = null, online = null, timer = null, readySent = false;

    function checkOnline() {
      const calibrated = !!(doc && ready(doc.setup).length);
      const now = isOnline(doc) && calibrated;
      if (now === online) return;
      online = now;
      const where = doc && doc.station && doc.station.name ? ` on ${doc.station.name}` : "";
      if (isOnline(doc) && !calibrated) onEvent({ type: "error", text: `The camera station${where} is running, but its cameras aren't calibrated yet. Calibrate them on the Cameras page.` });
      else if (now) {
        onEvent({ type: "status", text: `Watching with the camera station${where}.` });
        if (!readySent && lastSeq !== null) { readySent = true; onEvent({ type: "ready" }); }
      } else onEvent({ type: "error", text: `The camera station${where} isn't running. Open the Camera station page on the computer with the cameras.` });
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

  // The cameras to score with here: the owner's camera station if it is running, else cameras set
  // up in this browser, else a station that is set up but not running now (it says so, and
  // carries on when the station starts). Null when there are none at all.
  async function chooseWatcher({ db, user, onEvent }) {
    const station = user ? await getStation(db, user.uid) : null;
    const local = ready(load()).length > 0;
    if (station && ready(station.setup).length && (isOnline(station) || !local)) return createRemoteWatcher(db, user.uid, { onEvent });
    if (local) return createWatcher(load(), { onEvent });
    if (station) return createRemoteWatcher(db, user.uid, { onEvent });
    return null;
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
    isOnline, slimEvent, createStation, createRemoteWatcher, getStation, chooseWatcher, requestStills, saveStationSetup, setStationOptions,
    noteDart, forgetLearned, learnedOptions,
  };
})(typeof self !== "undefined" ? self : this);
