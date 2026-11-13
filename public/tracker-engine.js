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
//   darts      { "20": [dart x3] }: every dart thrown at each number, in order, misses included:
//              { r: what it counted as ("S"/"D"/"T", or "-" a miss), l: what it landed in ("T20", "S1",
//              "SB", "DB", "MISS", or "" not known), x, y: where (when known), q: the cameras' seq,
//              src: "tap" | "cam" | "btn" (a button) | "typed" | "unseen" (counted as a miss at a
//              pull-out) | "old" (made up from the entry), f: 1 when fixed by hand }. Pages from
//              before it don't keep it, so dartsOf() makes it up from the entry when it doesn't match.
//   camVisit   the cameras' visit in progress: { aim, seen, unread, tapped } (see cameraDart)
//   pulled     the darts were pulled out since the last dart (Board mode shows the next number fresh)
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
    const out = { aim: v.aim, seen: n("seen"), unread: n("unread") };
    if (n("tapped")) out.tapped = n("tapped");
    return out;
  }

  // The darts thrown at each number, kept only where they look like darts.
  const RINGS = { "-": 1, S: 1, D: 1, T: 1, B: 1 };
  const SRCS = { tap: 1, cam: 1, btn: 1, typed: 1, unseen: 1, old: 1 };
  function cleanDart(d) {
    if (!d || typeof d !== "object" || !RINGS[d.r]) return null;
    const out = { r: d.r, l: typeof d.l === "string" ? d.l.slice(0, 8) : "", src: SRCS[d.src] ? d.src : "old" };
    const x = Number(d.x), y = Number(d.y);
    if (d.x != null && d.y != null && Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) < 1.5) {
      out.x = Math.round(x * 10000) / 10000; out.y = Math.round(y * 10000) / 10000;
    }
    if (Number(d.q) > 0) out.q = Number(d.q);
    if (d.f) out.f = 1;
    return out;
  }
  function cleanDarts(darts) {
    const clean = {};
    if (!darts || typeof darts !== "object") return clean;
    TARGETS.forEach((t) => {
      if (!Array.isArray(darts[t])) return;
      const list = darts[t].slice(0, 3).map(cleanDart).filter(Boolean);
      if (list.length) clean[t] = list;
    });
    return clean;
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
    o.darts = o.darts && typeof o.darts === "object" ? o.darts : {};
    o.camVisit = cleanVisit(o.camVisit);
    o.pulled = !!o.pulled;
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

  // What a hit is called: "T20", "S5", "SB" (outer bull), "DB" (bullseye).
  const labelOf = (hit) => (!hit || !hit.target ? "MISS" : hit.target === "BULL" ? (hit.ring === "D" ? "DB" : "SB") : hit.ring + hit.target);

  // The darts thrown at a number, in order, misses included. When the kept list doesn't match the
  // entry (a page from before it wrote the session, or a typed row), it is made up from the entry:
  // its hits (with where they landed), then misses.
  function dartsOf(s, t) {
    const entry = (s.entry && s.entry[t]) || blankRow();
    const n = dartsAt(s, t);
    const list = s.darts && Array.isArray(s.darts[t]) ? s.darts[t] : null;
    const hits = entry.filter((v) => v && v !== "-");
    if (list && list.length === n && list.every((d) => d && RINGS[d.r])) {
      const theirs = list.filter((d) => d.r !== "-").map((d) => d.r);
      if (theirs.length === hits.length && theirs.every((r, i) => r === hits[i])) return list;
    }
    const pos = (s.positions && s.positions[t]) || [];
    const out = [];
    entry.forEach((v, i) => {
      if (!v || v === "-") return;
      const d = { r: v, l: t === "BULL" ? (v === "D" ? "DB" : "SB") : v + t, src: "old" };
      if (pos[i] && Number.isFinite(pos[i].x)) { d.x = pos[i].x; d.y = pos[i].y; }
      out.push(d);
    });
    while (out.length < n) out.push({ r: "-", l: "", src: "old" });
    return out.slice(0, 3);
  }

  // A number's entry, dots and darts thrown, from its list of darts (hits first in the entry).
  function setDarts(s, t, list) {
    const hits = list.filter((d) => d.r !== "-");
    const row = hits.map((d) => d.r);
    while (row.length < 3) row.push("-");
    s.entry[t] = row.slice(0, 3);
    s.positions[t] = [0, 1, 2].map((i) => (hits[i] && Number.isFinite(hits[i].x) && Math.hypot(hits[i].x, hits[i].y) <= 1.0001 ? { x: hits[i].x, y: hits[i].y } : null));
    if (list.length) { s.thrown[t] = Math.min(3, list.length); s.darts[t] = list.slice(0, 3); }
    else { delete s.thrown[t]; delete s.darts[t]; }
  }

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
      prevDarts: clone(dartsOf(s, target)),
    }, extra || {});
  }
  function pushStep(s, step) { s.undo = (s.undo || []).concat([step]).slice(-UNDO_MAX); }

  // A dart at the number being thrown at (or opts.target): hit = { target, ring, x, y } where it
  // landed, or null off the board. A hit in that number fills its next slot; anything else is a
  // miss. Returns { aim, counts, ring, dartNo } or null when every number is done.
  // opts: { target, cam, prevVisit, src ("tap", "btn"...), label (what it landed in, when known) }.
  function addDart(s, hit, opts = {}) {
    normalize(s);
    const aim = opts.target || aimOf(s);
    if (!aim || dartsAt(s, aim) >= 3) return null;
    const step = stepFor(s, aim);
    if (opts.prevVisit !== undefined) step.prevVisit = opts.prevVisit;
    const before = dartsAt(s, aim);
    const list = dartsOf(s, aim).slice();
    const counts = !!(hit && hit.target === aim);
    const dart = { r: counts ? hit.ring : "-", l: opts.label || (hit ? labelOf(hit) : opts.src === "btn" ? "" : "MISS"), src: opts.src || (opts.cam ? "cam" : "tap") };
    if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) { dart.x = hit.x; dart.y = hit.y; }
    else if (opts.cam && Number.isFinite(opts.cam.x) && Number.isFinite(opts.cam.y)) { dart.x = opts.cam.x; dart.y = opts.cam.y; }
    if (opts.cam && Number(opts.cam.seq) > 0) dart.q = Number(opts.cam.seq);
    list.push(dart);
    s.darts[aim] = list;
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
    if (hit && Number.isFinite(hit.x) && Number.isFinite(hit.y)) s.last = { target: hit.target, ring: hit.ring, x: hit.x, y: hit.y };
    // A dart put in by hand while the cameras' visit at this number is on: it fills a dart they
    // couldn't read, or one they didn't see (Board mode stops waiting for a tap).
    if (!opts.cam && visitLive(s) && s.camVisit.aim === aim) s.camVisit.tapped = Math.min(3, (s.camVisit.tapped || 0) + 1);
    s.pulled = false;
    return { aim, counts, ring: counts ? hit.ring : null, dartNo: before + 1 };
  }

  // A dart entered with a button: ring "S"/"D"/"T" (the bull: "S" outer, "D" bullseye), or "-" a miss.
  function buttonDart(s, ring) {
    normalize(s);
    const aim = aimOf(s);
    if (!aim) return null;
    if (ring === "T" && aim === "BULL") return null;
    const hit = ring && ring !== "-" ? { target: aim, ring } : null;
    return addDart(s, hit, { src: "btn", label: hit ? labelOf(hit) : "" });
  }

  // A dart fixed by hand (tapped in Board mode): fix = { ring, label, x, y } (ring "-" for a miss), or
  // { remove: true } (it wasn't a dart). The number is scored again from its darts. One undo step.
  // Returns { target, index, dart (the old one), now (the new one, or null when removed) } or null.
  function fixDart(s, t, i, fix) {
    normalize(s);
    if (!TARGETS.includes(t) || !fix) return null;
    const list = dartsOf(s, t).map((d) => Object.assign({}, d));
    const old = list[i];
    if (!old) return null;
    const step = stepFor(s, t, { kind: "fix" });
    // A fix leaves the cameras' visit as it is (Undo of it must not bring back a visit that has
    // ended since), except when a dart they saw is removed.
    delete step.prevVisit;
    let now = null;
    if (fix.remove) {
      list.splice(i, 1);
      if (old.src === "cam" && s.camVisit && s.camVisit.aim === t && s.camVisit.seen > 0) {
        step.prevVisit = clone(s.camVisit);
        s.camVisit.seen -= 1;
      }
    } else {
      if (!RINGS[fix.ring] || fix.ring === "B" || (t === "BULL" && fix.ring === "T")) return null;
      now = { r: fix.ring, l: typeof fix.label === "string" ? fix.label : old.l, src: old.src, f: 1 };
      const x = fix.x !== undefined ? fix.x : old.x, y = fix.y !== undefined ? fix.y : old.y;
      if (Number.isFinite(x) && Number.isFinite(y)) { now.x = x; now.y = y; }
      if (old.q) now.q = old.q;
      list[i] = now;
    }
    setDarts(s, t, list);
    pushStep(s, step);
    return { target: t, index: i, dart: old, now };
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
    if (filled) {
      s.thrown[target] = 3;
      s.darts[target] = row.map((v, i) => {
        const d = { r: v, l: v === "-" ? "" : target === "BULL" ? (v === "D" ? "DB" : "SB") : v + target, src: "typed" };
        const p = s.positions[target][i];
        if (p) { d.x = p.x; d.y = p.y; }
        return d;
      });
    } else { delete s.thrown[target]; delete s.darts[target]; }
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
    if (Array.isArray(step.prevDarts) && step.prevDarts.length) s.darts[step.target] = clone(step.prevDarts);
    else delete s.darts[step.target];
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
    const list = dartsOf(s, v.aim).slice();
    while (list.length < 3) list.push({ r: "-", l: "", src: "unseen" });
    s.darts[v.aim] = list;
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
    const filled = closeVisit(s);
    s.pulled = true;
    return { filled };
  }


  // ---- Board mode -----------------------------------------------------------------------------------
  const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const neighbours = (n) => { const i = SEG.indexOf(Number(n)); return i < 0 ? [] : [String(SEG[(i + 19) % 20]), String(SEG[(i + 1) % 20])]; };
  const RING_WORD = { S: "single", D: "double", T: "treble" };
  const BULL_WORD = { S: "outer bull", D: "bullseye" };
  const shortName = (t) => (t === "BULL" ? "Bull" : t);
  const readOf = (l) => (l === "DB" ? "Bull" : l === "SB" ? "25" : l === "MISS" ? "Miss" : l);

  // What one dart counted as, for its box: { read, sub, kind }.
  function dartWords(t, d, mode) {
    const single = normMode(mode) === "single";
    if (d.r !== "-") {
      const read = t === "BULL" ? (d.r === "D" ? "Bull" : "25") : d.r + t;
      const marks = SCORE_VALS[d.r] || 0;
      const what = t === "BULL" ? (d.r === "D" ? "Bullseye" : "Outer bull") : RING_WORD[d.r][0].toUpperCase() + RING_WORD[d.r].slice(1);
      const sub = d.src === "typed" ? "Typed in" : single ? `${what}: a hit` : `${what}: ${marks} mark${marks === 1 ? "" : "s"}`;
      return { read, sub, kind: "hit" };
    }
    if (d.src === "unseen") return { read: "Not seen", sub: "Counted as a miss", kind: "miss unseen" };
    if (d.src === "btn") return { read: "Miss", sub: "Entered by hand", kind: "miss" };
    if (d.src === "typed" || d.src === "old" || !d.l) return { read: "Miss", sub: d.src === "typed" ? "Typed in" : "A miss", kind: "miss" };
    if (d.l === "MISS") return { read: "Miss", sub: "Off the board", kind: "miss" };
    const m = /^[SDT](\d+)$/.exec(d.l);
    const where = m ? m[1] : "BULL";
    if (where === "BULL") return { read: readOf(d.l), sub: "In the bull, a miss", kind: "miss" };
    if (t !== "BULL" && neighbours(t).includes(where)) return { read: d.l, sub: `Next door, in the ${where}`, kind: "miss" };
    return { read: d.l, sub: `In the ${where}, a miss`, kind: "miss" };
  }

  // The number whose darts Board mode shows: the cameras' visit, or the number being thrown at, or
  // (before its first dart, when the darts weren't seen being pulled out) the one just finished.
  function shownNumber(s) {
    const aim = aimOf(s);
    // The cameras' visit, unless darts have gone in at a later number since (with the buttons).
    if (s.camVisit) {
      const t = s.camVisit.aim;
      if (t === aim || !aim || dartsAt(s, aim) === 0) return { t, pullOut: t !== aim && dartsAt(s, t) >= 3 };
    }
    if (!aim) {
      const lastDone = TARGETS[TARGETS.length - 1];
      return { t: lastDone, pullOut: false };
    }
    const i = TARGETS.indexOf(aim);
    if (i > 0 && dartsAt(s, aim) === 0 && !s.pulled && dartsAt(s, TARGETS[i - 1]) >= 3 && dartsOf(s, TARGETS[i - 1]).some((d) => d.src !== "typed" && d.src !== "old")) {
      return { t: TARGETS[i - 1], pullOut: true };
    }
    return { t: aim, pullOut: false };
  }

  // Everything Board mode draws (see board-mode.js): the number, this visit's darts, the 21 numbers.
  function boardView(s, mode) {
    normalize(s);
    const aim = aimOf(s);
    const shown = shownNumber(s);
    const list = dartsOf(s, shown.t);
    const darts = list.map((d, i) => Object.assign({ index: i, s: d.q || `${shown.t}.${i}.${d.r}.${d.l}.${d.src}`, x: d.x, y: d.y, ring: d.r, label: d.l, src: d.src, fixed: !!d.f, target: shown.t }, dartWords(shown.t, d, mode)));
    const v = s.camVisit;
    const waitN = v && v.aim === shown.t ? Math.max(0, Math.min(3 - list.length, v.unread - (v.tapped || 0))) : 0;
    const waiting = Array.from({ length: waitN }, () => ({ read: "Not read", sub: "Tap the board where it landed" }));
    const ai = aim ? TARGETS.indexOf(aim) : TARGETS.length;
    const cells = TARGETS.map((t) => {
      const n = dartsAt(s, t), hits = hitsOf(s.entry[t]);
      const sub = n ? dartsOf(s, t).map((d) => (d.r === "-" ? "–" : t === "BULL" ? (d.r === "D" ? "B" : "S") : d.r)).join("") : "";
      const num = t === "BULL" ? "B" : t;
      const title = `${shortName(t)}: ${n ? `${hits} hit${hits === 1 ? "" : "s"} in ${n} dart${n === 1 ? "" : "s"}` : "to come"}`;
      if (t === aim) return { key: t, num, state: "current", sub, title };
      if (n >= 3) return { key: t, num, state: "h" + Math.min(3, hits), sub, title };
      if (n > 0) return { key: t, num, state: "open", sub, title };
      return { key: t, num, state: "todo", sub: "", title };
    });
    const p = progress(s);
    return {
      target: aim || null,
      finished: !aim,
      pullOut: shown.pullOut && !!aim,
      shown: shown.t,
      next: aim ? TARGETS.slice(ai + 1, ai + 4) : [],
      dartNo: aim ? Math.min(3, dartsAt(s, aim) + 1) : 3,
      darts,
      waiting,
      unseen: 0,
      visitDone: dartsAt(s, shown.t) >= 3,
      cells,
      done: p.done,
      of: TARGETS.length,
      note: p.done && p.done < TARGETS.length ? `${p.hits} hit${p.hits === 1 ? "" : "s"} · ${totalOf(s.entry, mode)} in all` : "",
    };
  }

  // ---- how it's going, against the saved sessions ---------------------------------------------------
  const num = (x) => (typeof x === "number" ? x : parseInt(x || "0", 10) || 0);
  // The saved sessions that count for this mode: finished ones (not partial), with an entry.
  function countingSessions(history, mode) {
    const m = normMode(mode);
    return (history || []).filter((h) => h && countsInStats(h) && h.entry && typeof h.entry === "object" && normMode(h.mode || "standard") === m);
  }
  const through = (entry, k, mode) => TARGETS.slice(0, k).reduce((n, t) => n + rowScore((entry || {})[t], mode), 0);
  // Numbers done from the start (20 down), with all their darts.
  const leading = (s) => { let k = 0; while (k < TARGETS.length && dartsAt(s, TARGETS[k]) >= 3) k += 1; return k; };

  // After the numbers done so far: your score, the average of your saved sessions at the same point,
  // and your best session's. null before the first number is done.
  function pace(s, history, mode) {
    const k = leading(s);
    if (!k) return null;
    const score = through(s.entry, k, mode);
    const list = countingSessions(history, mode);
    const out = { k, after: TARGETS[k - 1], score, avg: null, pb: null, pbTotal: null };
    if (!list.length) return out;
    out.avg = list.reduce((n, h) => n + through(h.entry, k, mode), 0) / list.length;
    const best = list.reduce((a, b) => (num(b.total) > num(a.total) ? b : a));
    out.pb = through(best.entry, k, mode);
    out.pbTotal = num(best.total);
    return out;
  }

  // The end of a session: the total against your average and best, the hit rate, what went better
  // than usual and the three numbers to practise (the lowest hit rate over this and your last 10).
  function recap(s, history, mode) {
    normalize(s);
    const list = countingSessions(history, mode);
    const total = totalOf(s.entry, mode);
    const hits = TARGETS.reduce((n, t) => n + hitsOf(s.entry[t]), 0);
    const darts = TARGETS.reduce((n, t) => n + dartsAt(s, t), 0);
    const count = (ring) => TARGETS.reduce((n, t) => n + (s.entry[t] || []).filter((v) => v === ring).length, 0);
    const totals = list.map((h) => num(h.total));
    const avg = totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
    const pb = totals.length ? Math.max(...totals) : null;
    const last10 = list.slice(-10);
    const rowAvg = (t, from) => (from.length ? from.reduce((n, h) => n + rowScore(h.entry[t], mode), 0) / from.length : null);
    const improved = TARGETS.map((t) => ({ t, score: rowScore(s.entry[t], mode), avg: rowAvg(t, list) }))
      .filter((r) => r.avg != null && r.score - r.avg >= 1)
      .sort((a, b) => (b.score - b.avg) - (a.score - a.avg) || TARGETS.indexOf(a.t) - TARGETS.indexOf(b.t))
      .slice(0, 3);
    const practise = TARGETS.map((t) => {
      const from = last10.concat([{ entry: s.entry }]);
      const h = from.reduce((n, x) => n + hitsOf(x.entry[t]), 0);
      return { t, pct: h / (from.length * 3) };
    }).sort((a, b) => a.pct - b.pct || TARGETS.indexOf(a.t) - TARGETS.indexOf(b.t)).slice(0, 3);
    return {
      total, avg, pb, newPb: pb != null && total > pb, sessions: list.length,
      hits, darts, hitPct: darts ? hits / darts : 0, trebles: count("T"), doubles: count("D"),
      improved, practise,
    };
  }

  // ---- the voice --------------------------------------------------------------------------------------
  const wordOf = (t, d, mode) => (d.r === "-" ? "miss" : normMode(mode) === "single" ? "hit" : t === "BULL" ? BULL_WORD[d.r] || "bull" : RING_WORD[d.r] || "hit");
  // What a change sounds like. what: { k: "dart", aim, dartNo } | { k: "fill", target } | { k: "fix",
  // target } | { k: "undo" }. A number's third dart says the whole visit and the running total:
  // "20: treble, single, miss. 5 in all. Next, 19."
  function voiceLine(s, what, mode) {
    normalize(s);
    if (!what) return "";
    if (what.k === "undo") return "Undone.";
    const t = what.k === "dart" ? what.aim : what.target;
    if (!TARGETS.includes(t)) return "";
    const list = dartsOf(s, t);
    if (what.k === "fix") {
      const d = list[what.index];
      return d ? `Fixed: ${wordOf(t, d, mode)}.` : "Fixed.";
    }
    if (what.k === "dart" && what.dartNo < 3) {
      const d = list[what.dartNo - 1];
      return d ? wordOf(t, d, mode)[0].toUpperCase() + wordOf(t, d, mode).slice(1) + "." : "";
    }
    if (list.length < 3) return "";
    const words = list.map((d) => wordOf(t, d, mode)).join(", ");
    const aim = aimOf(s);
    const total = totalOf(s.entry, mode);
    const next = aim ? `Next, ${shortName(aim)}.` : `That's all 21: ${total}.`;
    return `${shortName(t)}: ${words}. ${aim ? `${total} in all. ` : ""}${next}`;
  }

  // ---- saving -----------------------------------------------------------------------------------------
  // Every dart of the session, in order, for sessions.throws: { t, r, l, x, y, seq, src }.
  function throwsFor(s) {
    normalize(s);
    const out = [];
    TARGETS.forEach((t) => dartsOf(s, t).forEach((d) => {
      const o = { t, r: d.r, l: d.l || "", src: d.src || "old" };
      if (Number.isFinite(d.x) && Number.isFinite(d.y)) { o.x = d.x; o.y = d.y; }
      if (d.q) o.seq = d.q;
      if (d.f) o.f = 1;
      out.push(o);
    }));
    return out;
  }

  // ---- the session as a whole -------------------------------------------------------------------
  function ensureSid(s, makeId) {
    if (!s.sid && !s.loaded) s.sid = makeId();
    return s.sid;
  }

  // A new session: everything entered goes (the cameras' count stays, so old darts never come back).
  function clear(s) {
    normalize(s);
    s.entry = blankEntry(); s.positions = {}; s.thrown = {}; s.undo = []; s.last = null; s.darts = {};
    s.camVisit = null; s.sid = null; s.loaded = null; s.pulled = false;
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
    s.undo = []; s.last = null; s.camVisit = null; s.sid = null; s.pulled = false;
    // Every dart, when the session was saved with them (throws).
    s.darts = {};
    if (saved && Array.isArray(saved.throws)) {
      const by = {};
      saved.throws.forEach((d) => { if (d && TARGETS.includes(d.t)) (by[d.t] = by[d.t] || []).push(Object.assign({}, d, { q: d.seq })); });
      s.darts = cleanDarts(by);
      Object.keys(s.darts).forEach((t) => { if (dartsOf(s, t) !== s.darts[t]) delete s.darts[t]; });
    }
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
    labelOf, dartsOf, cleanDarts, buttonDart, fixDart, dartWords, boardView, pace, recap, voiceLine, throwsFor,
    countingSessions, neighbours,
  };
});
