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

  // Finds the camera saved in the setup among those plugged in now: by its id, else by its name.
  async function resolve(saved) {
    const cams = await listCameras();
    return cams.find((c) => c.deviceId === saved.deviceId) || cams.find((c) => saved.label && c.label === saved.label) || null;
  }

  async function openStream(deviceId, label) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
    } catch (error) {
      throw new Error(explain(error, label));
    }
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
    canvas.getContext("2d").drawImage(video, 0, 0);
    return canvas;
  }

  // Watches the board with every calibrated camera in `setup`, about `fps` times a second, and
  // calls onEvent with what the detector says (see BoardVision.createDetector), plus
  //   { type: "status", text }   for showing what it is doing, and
  //   { type: "error", text }    when a camera can't be opened or stops.
  // onFrames(frames, detector), if given, is called with every set of frames (for drawing).
  function createWatcher(setup, { onEvent = () => {}, onFrames = null, fps = 10, options = {} } = {}) {
    const cams = ready(setup);
    let streams = [], videos = [], views = [], canvases = [], detector = null, timer = null, running = false;

    async function start() {
      if (running) return;
      if (!cams.length) throw new Error("No cameras are set up yet.");
      running = true;
      onEvent({ type: "status", text: "Opening the cameras…" });
      try {
        // One stream per physical camera, shared by views that use the same one.
        const byDevice = new Map();
        for (const cam of cams) {
          let entry = byDevice.get(cam.deviceId);
          if (!entry) {
            const found = await resolve(cam);
            if (!found) throw new Error(explain({ name: "NotFoundError" }, cam.label));
            const stream = await openStream(found.deviceId, cam.label);
            streams.push(stream);
            const video = await videoFor(stream);
            stream.getVideoTracks().forEach((track) => track.addEventListener("ended", () => {
              if (running) onEvent({ type: "error", text: `"${cam.label}" stopped. Was it unplugged?` });
            }));
            entry = { video };
            byDevice.set(cam.deviceId, entry);
          }
          videos.push(entry.video);
          // A camera sharing its picture with another (OBS side by side) has its lens in the middle
          // of its own half.
          const shared = cams.filter((c) => c.deviceId === cam.deviceId).length > 1;
          const view = V.makeView(cam.cal, entry.video.videoWidth, entry.video.videoHeight, Object.assign({}, options, shared ? { center: V.halfCenter(cam.cal) } : {}));
          if (!view) throw new Error(`The calibration for "${cam.label}" doesn't fit its picture any more. Calibrate it again.`);
          views.push(view);
          const canvas = document.createElement("canvas");
          canvas.width = view.width; canvas.height = view.height;
          canvases.push(canvas.getContext("2d", { willReadFrequently: true }));
        }
        // Two views of one picture must not watch the same pixels.
        for (let i = 0; i < cams.length; i += 1) {
          for (let j = i + 1; j < cams.length; j += 1) if (cams[i].deviceId === cams[j].deviceId) V.separateViews(views[i], views[j]);
        }
        detector = V.createDetector(views, options);
      } catch (error) {
        stop();
        throw error;
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
      timer = setTimeout(tick, Math.max(10, 1000 / fps - spent));
    }

    function stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      videos.forEach((v) => { if (v.parentNode) v.parentNode.removeChild(v); });
      streams = []; videos = []; views = []; canvases = []; detector = null;
    }

    return {
      start,
      stop,
      get running() { return running; },
      get views() { return views; },
      get detector() { return detector; },
      get cameras() { return cams; },
      // The board as the cameras see it now has no darts in it.
      markEmpty() {
        const frames = grab();
        if (detector && frames.every(Boolean)) detector.markEmpty(frames);
      },
    };
  }

  root.DartCamera = { KEY, load, save, ready, listCameras, requestAccess, openStream, videoFor, still, explain, resolve, createWatcher };
})(typeof self !== "undefined" ? self : this);
