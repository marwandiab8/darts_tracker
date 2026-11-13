// The tracker's rules (index.html): three darts at each number, 20 down to 1 and then the bull. Only
// the number being thrown at counts; a miss uses up one of its three darts.
//
// The session being entered is plain data, the same object index.html shares between devices
// (liveSessions/{uid}, live-sync.js):
//   entry      { "20": ["T","S","-"], ..., "BULL": [...] }: three slots per number, hits first,
//              each "-" or a ring letter (S/D/T; B or S/D for the bull)
//   positions  { "20": [{x,y}|null x3] }: where each hit landed, as fractions of the board's radius
//   thrown     { "20": 2 }: darts thrown at each number (a miss isn't kept in the entry)
//   undo       the last 30 changes, each able to put one number (and the cameras' visit) back
//   last       the latest dart's dot { target, ring, x, y }
//   camSeq     the latest camera event put in (so each goes in once, whichever device saw it)
//   camVisit   the cameras' visit in progress: { aim, seen, unread } (see cameraDart)
//   sid        this session's id: Save writes sessions/{sid}, so it can never save twice
//   loaded     { id, timestamp, date, time, complete } when a saved session was loaded: Save updates it
// Loaded as a plain <script> (window.TrackerEngine) and by the tests (module.exports).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TrackerEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TARGETS = [...Array.from({ length: 20 }, (_, i) => String(20 - i)), "BULL"];
  const SCORE_VALS = { "-": 0, S: 1, D: 2, T: 3, B: 1 };
  const UNDO_MAX = 30;

  const normMode = (m) => (m === "single" ? "single" : "standard");
  const blankRow = () => ["-", "-", "-"];
  const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));
  const nameOf = (t) => (t === "BULL" ? "the bull" : t);

  function rowScore(arr, mode) {
    const a = Array.isArray(arr) ? arr : blankRow();
    if (normMode(mode) === "single") return a.reduce((n, v) => n + (v && v !== "-" ? 1 : 0), 0);
    return a.reduce((n, v) => n + (SCORE_VALS[v] || 0), 0);
  }
  function hitsOf(arr) {
    return (Array.isArray(arr) ? arr : []).reduce((n, v) => n + (v && v !== "-" ? 1 : 0), 0);
  }
  function totalOf(entry, mode) {
    return TARGETS.reduce((n, t) => n + rowScore((entry || {})[t], mode), 0);
  }

  function blankEntry() {
    const e = {};
    TARGETS.forEach((t) => { e[t] = blankRow(); });
    return e;
  }

  // Where each hit landed, kept only for slots that still hold a hit, inside the board.
  function cleanPositions(positions, entry) {
    const clean = {};
    if (!positions || typeof positions !== "object") return clean;
    TARGETS.forEach((t) => {
      const slots = Array.isArray(positions[t]) ? positions[t].slice(0, 3) : [];
      const darts = entry && Array.isArray(entry[t]) ? entry[t] : [];
      const row = [0, 1, 2].map((i) => {
        const p = slots[i];
        if (!p || typeof p !== "object") return null;
        const x = Number(p.x), y = Number(p.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        if (Math.hypot(x, y) > 1.0001) return null;
        if (!darts[i] || darts[i] === "-") return null;
        return { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 };
      });
      if (row.some(Boolean)) clean[t] = row;
    });
    return clean;
  }

  function cleanThrown(thrown) {
    const clean = {};
    TARGETS.forEach((t) => {
      const n = Math.round(Number((thrown || {})[t]) || 0);
      if (n > 0) clean[t] = Math.min(3, n);
    });
    return clean;
  }

  function cleanVisit(v) {
    if (!v || typeof v !== "object" || !TARGETS.includes(v.aim)) return null;
    const n = (k) => Math.max(0, Math.min(3, Math.round(Number(v[k]) || 0)));
    return { aim: v.aim, seen: n("seen"), unread: n("unread") };
  }

  // A session as the page keeps it, with anything missing filled in.
  function normalize(s) {
    const o = s && typeof s === "object" ? s : {};
    o.entry = o.entry && typeof o.entry === "object" ? o.entry : {};
    TARGETS.forEach((t) => { if (!Array.isArray(o.entry[t])) o.entry[t] = blankRow(); });
    o.positions = o.positions && typeof o.positions === "object" ? o.positions : {};
    o.thrown = o.thrown && typeof o.thrown === "object" ? o.thrown : {};
    o.undo = Array.isArray(o.undo) ? o.undo : [];
    o.last = o.last || null;
    o.camSeq = Number(o.camSeq) || 0;
    o.camVisit = cleanVisit(o.camVisit);
    o.sid = typeof o.sid === "string" && o.sid ? o.sid : null;
    o.loaded = o.loaded && typeof o.loaded === "object" && typeof o.loaded.id === "string" ? o.loaded : null;
    return o;
  }

  function blank() { return normalize({}); }

  // Darts thrown at a number so far (at most 3): a typed row counts as its hits at least.
  function dartsAt(s, t) {
    return Math.min(3, Math.max(Number((s.thrown || {})[t]) || 0, hitsOf((s.entry || {})[t])));
  }
  // The number being thrown at: the first one without its three darts, or null when all are done.
  function aimOf(s) { return TARGETS.find((t) => dartsAt(s, t) < 3) || null; }

  // How far the session has got: darts thrown, numbers done, the numbers still to finish.
  function progress(s) {
    const missing = TARGETS.filter((t) => dartsAt(s, t) < 3);
    const darts = TARGETS.reduce((n, t) => n + dartsAt(s, t), 0);
    const hits = TARGETS.reduce((n, t) => n + hitsOf((s.entry || {})[t]), 0);
    return { darts, hits, done: TARGETS.length - missing.length, missing, complete: !missing.length, empty: darts === 0 && hits === 0 };
  }

  // ---- changes, each with an undo step ----------------------------------------------------------
  // An undo step puts one number back as it was, with the dot and the cameras' visit.
  function stepFor(s, target, extra) {
    return Object.assign({
      target,
      prev: (s.entry[target] || blankRow()).slice(),
      prevPos: (s.positions[target] || [null, null, null]).slice(),
      prevThrown: s.thrown[target],
      prevLast: s.last || null,
      prevVisit: s.camVisit ? clone(s.camVisit) : null,
    }, extra || {});
  }
  function pushStep(s, step) { s.undo = (s.undo || []).concat([step]).slice(-UNDO_MAX); }

  // A dart at the number being thrown at (or opts.target): hit = { target, ring, x, y } where it
  // landed, or null off the board. A hit in that number fills its next slot; anything else is a
  // miss. Returns { aim, counts, ring, dartNo } or null when every number is done.
  function addDart(s, hit, opts = {}) {
    normalize(s);
    const aim = opts.target || aimOf(s);
    if (!aim || dartsAt(s, aim) >= 3) return null;
    const step = stepFor(s, aim);
    if (opts.prevVisit !== undefined) step.prevVisit = opts.prevVisit;
    const before = dartsAt(s, aim);
    const counts = !!(hit && hit.target === aim);
    if (counts) {
      const row = s.entry[aim].slice();
      const ix = row.indexOf("-");
      row[ix] = hit.ring;
      s.entry[aim] = row;
      const slots = (s.positions[aim] || [null, null, null]).slice();
      slots[ix] = Number.isFinite(hit.x) && Number.isFinite(hit.y) ? { x: hit.x, y: hit.y } : null;
      s.positions[aim] = slots;
    }
    s.thrown[aim] = before + 1;
    if (opts.cam) step.cam = Object.assign({ counted: counts }, opts.cam);
    pushStep(s, step);
    if (hit) s.last = { target: hit.target, ring: hit.ring, x: hit.x, y: hit.y };
    return { aim, counts, ring: counts ? hit.ring : null, dartNo: before + 1 };
  }

  // A row typed in the table: what it holds now. A row with anything typed in it (even "-", or 0
  // hits) has had its three darts, so the board's next darts go to the next number; an emptied row
  // is open again. Keystrokes in one row in a row make one undo step.
  function typeRow(s, target, arr, filled) {
    normalize(s);
    if (!TARGETS.includes(target)) return null;
    const row = (Array.isArray(arr) ? arr : []).slice(0, 3).map((v) => (typeof v === "string" && v in SCORE_VALS ? v : "-"));
    while (row.length < 3) row.push("-");
    const top = s.undo[s.undo.length - 1];
    if (!(top && top.kind === "row" && top.target === target)) pushStep(s, stepFor(s, target, { kind: "row" }));
    const before = s.entry[target] || [];
    const old = s.positions[target] || [null, null, null];
    s.positions[target] = row.map((v, i) => (v !== "-" && v === before[i] ? old[i] || null : null));
    s.entry[target] = row;
    if (filled) s.thrown[target] = 3;
    else delete s.thrown[target];
    return { target, filled: !!filled };
  }

  // Undo: the latest change taken back. Returns the step (with .cam for a camera dart) or null.
  function undo(s) {
    normalize(s);
    const step = s.undo.pop();
    if (!step) return null;
    s.entry[step.target] = (step.prev || blankRow()).slice();
    s.positions[step.target] = (step.prevPos || [null, null, null]).slice();
    if (step.prevThrown === undefined || step.prevThrown === null) delete s.thrown[step.target];
    else s.thrown[step.target] = step.prevThrown;
    s.last = step.prevLast || null;
    if ("prevVisit" in step) s.camVisit = cleanVisit(step.prevVisit);
    return step;
  }

  // ---- the cameras --------------------------------------------------------------------------------
  // A visit at the board belongs to the number being thrown at when its first dart lands (its aim).
  //   - Each dart the cameras read goes to that number (a hit in it counts, anything else is a miss).
  //   - A dart they saw but couldn't read ("unreadable") is one of the visit's darts, waiting for a
  //     tap: tapped, it fills the slot; never tapped, it is a miss when the visit ends.
  //   - A dart of the visit after its number already has its three darts (one was tapped in as well
  //     as seen, say) is not counted: it never spills into the next number, which nobody threw at yet.
  //   - The visit ends when the darts are pulled out, or at a 4th dart without a pull-out (the
  //     cameras missed it: that dart starts the next visit). Then the number's darts not seen are
  //     misses: at that number only, never at the next.
  //   - A visit where nothing at all was seen (three bounce-outs) leaves no trace: tap the misses.
  //   - The station's dart number (e.index) is not used to place darts here: it counts only the darts
  //     it could read, and drops when one is taken out, so it isn't the dart's place in the visit.
  // Each camera event carries the station's seq, and goes in once (camSeq) however many devices saw it.
  function visitLive(s) {
    const v = s.camVisit;
    return !!(v && v.seen + v.unread < 3);
  }
  function visitOpen(s) {
    return visitLive(s) && dartsAt(s, s.camVisit.aim) < 3;
  }

  // The visit is over: its number's darts not seen are misses (an undo step of their own).
  function closeVisit(s) {
    const v = s.camVisit;
    s.camVisit = null;
    if (!v) return null;
    const n = dartsAt(s, v.aim);
    if (n >= 3) return null;
    const step = stepFor(s, v.aim, { kind: "fill" });
    step.prevVisit = clone(v);
    s.thrown[v.aim] = 3;
    pushStep(s, step);
    return { target: v.aim, unseen: 3 - n };
  }

  const fresh = (s, seq) => !(seq && seq <= (Number(s.camSeq) || 0));
  const took = (s, seq) => { if (seq) s.camSeq = seq; };

  // The visit a camera event belongs to: the one in progress, or a new one at the number being
  // thrown at (closing the last one first). Returns { closed, full }.
  function visitFor(s) {
    if (visitLive(s)) return { closed: null, full: false };
    const closed = s.camVisit ? closeVisit(s) : null;
    const aim = aimOf(s);
    if (!aim) return { closed, full: true };
    s.camVisit = { aim, seen: 0, unread: 0 };
    return { closed, full: false };
  }

  // A dart the cameras read: hit as for addDart; cam = { seq, label, x, y }. Returns null when it was
  // already in, else { closed (the last visit's misses), dart (as addDart), spare (not counted:
  // its number was already done), full (every number is done), visit }.
  function cameraDart(s, hit, cam) {
    normalize(s);
    if (!fresh(s, cam && cam.seq)) return null;
    took(s, cam && cam.seq);
    // Undo of this dart puts the visit back as it was just before it (none, if this dart starts one).
    const prevVisit = visitLive(s) ? clone(s.camVisit) : null;
    const { closed, full } = visitFor(s);
    if (full) return { closed, full: true };
    const v = s.camVisit;
    if (dartsAt(s, v.aim) >= 3) {
      v.seen += 1;
      return { closed, spare: { aim: v.aim }, visit: clone(v) };
    }
    const dart = addDart(s, hit, { target: v.aim, cam: cam || {}, prevVisit });
    s.camVisit.seen += 1;
    return { closed, dart, visit: clone(s.camVisit) };
  }

  // A dart the cameras saw but couldn't read: one of the visit's darts, for a tap to fill.
  function cameraUnreadable(s, cam) {
    normalize(s);
    if (!fresh(s, cam && cam.seq)) return null;
    took(s, cam && cam.seq);
    const { closed, full } = visitFor(s);
    if (full) return { closed, full: true };
    s.camVisit.unread += 1;
    return { closed, visit: clone(s.camVisit) };
  }

  // The darts were pulled out: the visit is over. Returns { filled } (null when nothing was missing).
  function cameraTakeout(s, cam) {
    normalize(s);
    if (!fresh(s, cam && cam.seq)) return null;
    took(s, cam && cam.seq);
    return { filled: closeVisit(s) };
  }

  // ---- the session as a whole -------------------------------------------------------------------
  function ensureSid(s, makeId) {
    if (!s.sid && !s.loaded) s.sid = makeId();
    return s.sid;
  }

  // A new session: everything entered goes (the cameras' count stays, so old darts never come back).
  function clear(s) {
    normalize(s);
    s.entry = blankEntry(); s.positions = {}; s.thrown = {}; s.undo = []; s.last = null;
    s.camVisit = null; s.sid = null; s.loaded = null;
    return s;
  }

  // A saved session opened to look at or correct: every number counts as thrown, and Save updates it.
  function load(s, saved) {
    normalize(s);
    const entry = blankEntry();
    TARGETS.forEach((t) => {
      const row = saved && saved.entry && Array.isArray(saved.entry[t]) ? saved.entry[t].slice(0, 3) : [];
      entry[t] = [0, 1, 2].map((i) => (typeof row[i] === "string" && row[i] in SCORE_VALS ? row[i] : "-"));
    });
    s.entry = entry;
    s.positions = cleanPositions(saved && saved.positions, entry);
    s.thrown = {};
    TARGETS.forEach((t) => { s.thrown[t] = 3; });
    s.undo = []; s.last = null; s.camVisit = null; s.sid = null;
    const ts = typeof (saved && saved.timestamp) === "string" ? saved.timestamp : "";
    const m = ts.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/);
    s.loaded = { id: String(saved.id), timestamp: ts, date: m ? m[1] : "", time: m && m[2] ? m[2] : "", complete: saved.complete !== false };
    return s;
  }

  // Where a session's date comes from: "YYYY-MM-DD" out of its timestamp, whatever type it is.
  function dateOf(ts) {
    if (!ts) return null;
    if (typeof ts === "string") {
      const m = ts.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m) return m[1];
      if (/^\d+$/.test(ts)) return new Date(Number(ts)).toISOString().slice(0, 10);
      return null;
    }
    if (typeof ts === "number") return new Date(ts).toISOString().slice(0, 10);
    if (typeof ts === "object") {
      try {
        if (typeof ts.toDate === "function") return ts.toDate().toISOString().slice(0, 10);
        if ("seconds" in ts) return new Date(Number(ts.seconds) * 1000).toISOString().slice(0, 10);
      } catch (_) { return null; }
    }
    return null;
  }

  // A saved session that counts in averages and bests: not one saved part way through.
  const countsInStats = (session) => !!session && session.complete !== false;

  return {
    TARGETS, SCORE_VALS, UNDO_MAX, normMode, blankRow, blankEntry, rowScore, hitsOf, totalOf, nameOf,
    cleanPositions, cleanThrown, cleanVisit, normalize, blank, dartsAt, aimOf, progress,
    addDart, typeRow, undo, visitOpen, visitLive, cameraDart, cameraUnreadable, cameraTakeout, closeVisit,
    ensureSid, clear, load, dateOf, countsInStats,
  };
});
