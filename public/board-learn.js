// Learning to read this board better, from the darts you keep and the ones you correct.
//
// Every dart the cameras put into a game ends up with a note (cameraStations/{uid}/notes/{seq},
// written by the game page): you left it in, so it was read right, or you took it back and put in
// where it really landed (Undo and tap, "Missed the board", or "Edit my last visit"). The camera
// station keeps the pictures each dart was read from for a while; when its note comes, it keeps them
// with the note, on that computer (IndexedDB, below). Every few corrections it reads all those darts
// again with other settings for reading darts (how much a pixel must change, how a dart's line is
// followed, how the two cameras' views are put together), one setting changed at a time, and if a
// change reads clearly more of them right, it uses that from then on (setup.learned in the account).
// So the darts you correct while you play are what it learns from: no test sessions needed.
//
// Loaded by the station page, in a worker that does the reading again (so the cameras aren't held
// up), and by the tests (module.exports).
(function (root, factory) {
  const inWorker = typeof WorkerGlobalScope !== "undefined" && root instanceof WorkerGlobalScope;
  if (inWorker && !root.BoardVision) root.importScripts("board-vision.js?v=11");
  if (typeof module === "object" && module.exports) module.exports = factory(require("./board-vision.js"), false);
  else root.BoardLearn = factory(root.BoardVision, inWorker);
})(typeof self !== "undefined" ? self : this, function (V, inWorker) {
  "use strict";

  // The settings it may change, and the values it tries: around the ones tuned on the real board
  // (docs/camera-scoring.md). `stage`: which part of reading a dart uses it.
  const SEARCH = [
    // (22 was tried until Nov 16, 2026, when it was learned from the kept darts and then set off by
    // the cameras' own noise on the live board: an empty board differed from itself by more pixels
    // than a dart. The kept darts can't show that, so a floor comes from the live cameras: see learn.)
    { key: "threshold", values: [26, 30, 34, 38], stage: "mask" },
    { key: "blobArea", values: [0.0003, 0.0006, 0.0012], stage: "read" },
    { key: "joinGap", values: [0.1, 0.15, 0.22], stage: "read" },
    { key: "thickR", values: [0.02, 0.03, 0.045], stage: "read" },
    { key: "runGapR", values: [0.25, 0.35, 0.5], stage: "read" },
    { key: "endPenalty", values: [0, 0.02, 0.05], stage: "fuse" },
    { key: "cell", values: [0.004, 0.006, 0.009], stage: "fuse" },
  ];
  const KEYS = SEARCH.map((p) => p.key);
  // What reading uses when nothing is learned: board-vision's own defaults (fuse keeps its own).
  const FUSE_DEFAULTS = { cell: 0.006, endPenalty: 0.02 };
  const BASE = Object.assign({}, V.DEFAULTS, FUSE_DEFAULTS);
  const defaults = () => Object.fromEntries(KEYS.map((k) => [k, BASE[k]]));
  const pick = (o) => Object.fromEntries(KEYS.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));
  // The learned settings must be ones it would try (an account can hold anything).
  function cleanLearned(options) {
    const out = {};
    for (const p of SEARCH) if (options && p.values.includes(options[p.key])) out[p.key] = options[p.key];
    return out;
  }

  // At least this many darts, and a learned change must read this many more of them right.
  const MIN_DARTS = 10;
  const needed = (n) => Math.max(1, Math.round(n * 0.02));

  const MASK_KEYS = ["threshold", "shadow", "shadowLo", "shadowHi", "shadowChroma"];
  const READ_KEYS = ["blobArea", "joinGap", "dartArea", "thickR", "runGapR"];
  const keyOf = (o, keys) => keys.map((k) => o[k]).join(",");

  // What each option set reads one dart as: { seq, truth, views, frames: [[before, after], ...] }.
  // Each camera's changed pixels and its reading are worked out once per option set that needs them.
  function readWith(sample, sets) {
    const masks = new Map(), reads = new Map();
    return sets.map((o) => {
      const readings = sample.views.map((view, i) => {
        if (!view || !sample.frames[i]) return null;
        const mk = keyOf(o, MASK_KEYS) + "|" + i;
        let mask = masks.get(mk);
        if (!mask) { mask = V.diffMask(sample.frames[i][0], sample.frames[i][1], view, o).mask; masks.set(mk, mask); }
        const rk = mk + "|" + keyOf(o, READ_KEYS);
        let reading = reads.get(rk);
        if (!reading) { reading = V.readView(view, mask, o); reads.set(rk, reading); }
        return reading;
      });
      const fused = V.fuse(readings, o);
      return fused ? fused.label : null;
    });
  }

  // How many of the darts each option set reads right. `samples` is an iterable (or async one) of
  // darts, so only one dart's pictures need to be held at a time.
  async function scoreSets(sets, samples, onDart) {
    const right = sets.map(() => 0), wrong = sets.map(() => []);
    let n = 0;
    for await (const s of samples) {
      if (!s) continue;
      readWith(s, sets).forEach((label, k) => { if (label === s.truth) right[k] += 1; else wrong[k].push({ seq: s.seq, truth: s.truth, read: label }); });
      n += 1;
      if (onDart) onDart(n);
    }
    return { right, wrong, n };
  }

  // Option sets around `base`: base itself first, then each setting changed on its own. No
  // threshold below `minThreshold` (what the live cameras' noise allows).
  function variations(base, skip = [], minThreshold = 0) {
    const out = [Object.assign({}, base)];
    for (const p of SEARCH) {
      if (skip.includes(p.key)) continue;
      for (const v of p.values) {
        if (p.key === "threshold" && v < minThreshold) continue;
        if (base[p.key] !== v) out.push(Object.assign({}, base, { [p.key]: v }));
      }
    }
    return out;
  }
  // The lowest threshold it may use, given the floor the cameras' noise sets: the first of its own
  // values at or above it (the highest, if the floor is above them all).
  function thresholdFrom(minThreshold) {
    const values = SEARCH.find((p) => p.key === "threshold").values;
    return values.find((v) => v >= minThreshold) || values[values.length - 1];
  }
  const best = (right) => right.reduce((b, r, k) => (r > right[b] ? k : b), 0); // ties: the earlier one

  // One learning run. current: the reading options in use (board-vision's defaults, the board's own
  // setup options, what was learned before). samples(): the darts, afresh for each pass. Tries each
  // setting changed on its own (and going back to the defaults), keeps the best change, then once
  // more from there. Returns { options (the learned settings), right, was, n, changed, wrong }.
  //
  // minThreshold: the lowest change threshold the live cameras' noise allows (the station measures
  // it: createLearning in board-camera.js). The kept darts alone would always like a finer
  // threshold, and can't show that it sets the detector off with nothing going on. Nothing below
  // it is tried; and when the threshold in use is itself below it, the result starts from the floor
  // and says `forced`: it is to be used whether or not it reads more of the kept darts right.
  async function learn(current, samples, { onProgress, minThreshold = 0 } = {}) {
    const inUse = Object.assign({}, BASE, current);
    const forced = inUse.threshold < minThreshold;
    const start = forced ? Object.assign({}, inUse, { threshold: thresholdFrom(minThreshold) }) : inUse;
    // Back to the usual settings is tried too (with a threshold the floor allows).
    const reset = Object.assign({}, start, defaults());
    if (minThreshold) reset.threshold = Math.max(reset.threshold, thresholdFrom(minThreshold));
    let sets = variations(start, [], minThreshold);
    if (KEYS.some((k) => reset[k] !== start[k])) sets.push(reset);
    // What is in use now, for comparing with (it isn't chosen when it is below the floor).
    if (forced) sets.push(inUse);
    let pass = 1;
    const progress = (n) => onProgress && onProgress({ pass, dart: n });
    let scored = await scoreSets(sets, samples(), progress);
    const n = scored.n, was = forced ? scored.right[sets.length - 1] : scored.right[0];
    const allowed = forced ? scored.right.slice(0, -1) : scored.right;
    let k = best(allowed), chosen = sets[k], right = scored.right[k], wrong = scored.wrong[k];
    const changedKeys = () => KEYS.filter((key) => chosen[key] !== inUse[key]);
    if (k !== 0 && n) {
      pass = 2;
      sets = variations(chosen, KEYS.filter((key) => chosen[key] !== start[key]), minThreshold);
      scored = await scoreSets(sets, samples(), progress);
      k = best(scored.right);
      if (scored.right[k] > right) { chosen = sets[k]; right = scored.right[k]; wrong = scored.wrong[k]; }
    }
    return { options: cleanLearned(pick(chosen)), right, was, n, changed: changedKeys(), wrong: wrong.slice(0, 40), forced };
  }

  // Whether a run's settings should be used: enough darts, and clearly better than now; or the
  // threshold in use is below what the cameras' noise allows (then whatever was read).
  const better = (result) => !!result && (!!result.forced || (result.n >= MIN_DARTS && result.right - result.was >= needed(result.n)));

  // --- the darts kept on the station's computer -------------------------------------------------------
  // IndexedDB "dart-learning", store "samples", one record per dart (by the station's seq):
  //   { seq, at, outcome ("kept" | "corrected"), page, read: { label }, truth: { label, x, y },
  //     cams: [{ deviceId, label, cal, frame: [w, h], shared, w, h, before: Blob, after: Blob }] }
  // before/after: the camera's crop just before and after the dart, exactly the pixels it read
  // (lossless WebP, about 550 kB a picture from the real cameras; PNG where WebP can't be lossless).
  // At most 160 darts (about 350 MB), at most half of them darts that were read right.
  const DB = "dart-learning", STORE = "samples", MAX_SAMPLES = 160, MAX_KEPT_SHARE = 0.5;
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "seq" }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function tx(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode), store = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(store)).then((v) => { out = v; });
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); reject(t.error); };
      t.onabort = () => { db.close(); reject(t.error); };
    }));
  }
  const asPromise = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  const putSample = (record) => tx("readwrite", (s) => { s.put(record); });
  const getSample = (seq) => tx("readonly", (s) => asPromise(s.get(seq)));
  const allSamples = () => tx("readonly", (s) => asPromise(s.getAll()));
  // Keeps the store to MAX_SAMPLES: the oldest darts that were read right go first (the corrected
  // ones are what it learns most from), and kept darts are at most MAX_KEPT_SHARE of it.
  async function trimSamples() {
    const all = (await allSamples()).sort((a, b) => a.at - b.at);
    const kept = all.filter((r) => r.outcome === "kept"), fixed = all.filter((r) => r.outcome !== "kept");
    const drop = [];
    const keepKept = Math.max(0, Math.min(kept.length, Math.floor(MAX_SAMPLES * MAX_KEPT_SHARE), MAX_SAMPLES - Math.min(fixed.length, MAX_SAMPLES)));
    drop.push(...kept.slice(0, kept.length - keepKept));
    const keepFixed = MAX_SAMPLES - keepKept;
    if (fixed.length > keepFixed) drop.push(...fixed.slice(0, fixed.length - keepFixed));
    if (drop.length) await tx("readwrite", (s) => { drop.forEach((r) => s.delete(r.seq)); });
    return { samples: all.length - drop.length, corrected: Math.min(fixed.length, keepFixed), dropped: drop.length };
  }
  async function counts() {
    const all = await allSamples();
    return { samples: all.length, corrected: all.filter((r) => r.outcome !== "kept").length };
  }

  // A crop's pixels as a picture that gives back exactly those pixels (on the station page, which has
  // them when a dart is read). Lossless WebP is much smaller than PNG; the first one is decoded again
  // to make sure this browser's WebP really is lossless, else it is PNG.
  let webpLossless = null;
  async function toImage(data, w, h) {
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(data), w, h), 0, 0);
    if (webpLossless !== false) {
      const blob = await canvas.convertToBlob({ type: "image/webp", quality: 1 });
      if (webpLossless === null) {
        let same = blob.type === "image/webp";
        if (same) {
          const back = await fromImage(blob, w, h);
          for (let i = 0; i < back.length && same; i += 1) same = back[i] === data[i];
        }
        webpLossless = same;
      }
      if (webpLossless) return blob;
    }
    return canvas.convertToBlob({ type: "image/png" });
  }
  async function fromImage(blob, w, h) {
    const bitmap = await createImageBitmap(blob, { colorSpaceConversion: "none", premultiplyAlpha: "none" });
    const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return ctx.getImageData(0, 0, w, h).data;
  }

  // The views a dart's cameras had (as the station's watcher made them), rebuilt from what was kept.
  const viewCache = new Map();
  function viewsFor(cams) {
    const key = JSON.stringify(cams.map((c) => [c.deviceId, c.cal && c.cal.H, c.cal && c.cal.lens, c.frame, c.shared]));
    if (viewCache.has(key)) return viewCache.get(key);
    const views = cams.map((c) => V.makeView(c.cal, c.frame[0], c.frame[1], c.shared ? { center: V.halfCenter(c.cal) } : {}));
    for (let i = 0; i < cams.length; i += 1) for (let j = i + 1; j < cams.length; j += 1) {
      if (views[i] && views[j] && cams[i].deviceId === cams[j].deviceId) V.separateViews(views[i], views[j]);
    }
    if (viewCache.size > 20) viewCache.clear();
    viewCache.set(key, views);
    return views;
  }

  // A kept record, decoded for reading again (null if its pictures don't fit its views any more).
  async function decode(record) {
    const views = viewsFor(record.cams);
    if (views.some((v, i) => !v || v.width !== record.cams[i].w || v.height !== record.cams[i].h)) return null;
    const frames = [];
    for (const c of record.cams) frames.push([await fromImage(c.before, c.w, c.h), await fromImage(c.after, c.w, c.h)]);
    return { seq: record.seq, truth: record.truth && record.truth.label, views, frames };
  }
  async function* decoded(records) { for (const r of records) yield await decode(r).catch(() => null); }

  // --- the worker -----------------------------------------------------------------------------------
  // { type: "learn", current, minThreshold } -> { type: "progress", pass, dart, of } ... { type: "done", result }
  if (inWorker) {
    self.onmessage = async (event) => {
      const msg = event.data || {};
      if (msg.type !== "learn") return;
      try {
        const records = (await allSamples()).filter((r) => r.truth && r.truth.label && Array.isArray(r.cams) && r.cams.length);
        const result = await learn(msg.current || {}, () => decoded(records), {
          minThreshold: Number(msg.minThreshold) || 0,
          onProgress: (p) => { if (p.dart % 10 === 0) self.postMessage(Object.assign({ type: "progress", of: records.length }, p)); },
        });
        result.corrected = records.filter((r) => r.outcome !== "kept").length;
        self.postMessage({ type: "done", result });
      } catch (error) {
        self.postMessage({ type: "error", text: String((error && error.message) || error) });
      }
    };
  }

  return {
    SEARCH, KEYS, BASE, MIN_DARTS, defaults, pick, cleanLearned, variations, thresholdFrom, readWith, scoreSets, learn, better, needed,
    openDb, putSample, getSample, allSamples, trimSamples, counts, toImage, fromImage, viewsFor, decode,
  };
});
