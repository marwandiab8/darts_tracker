// Training drills (training.html): the rules of every practice drill, with no DOM or Firebase, so
// `node --test tests/training-engine.test.cjs` checks them and the page loads this with a <script>.
//
// One engine, many drills. The shared machinery lives here once: a visit of 3 darts from the cameras
// or the buttons, fixing a dart by scoring its visit again, a 10-step Undo, the practice timer, the
// voice line, and the saved shapes. Each drill is configuration plus pure functions in DRILLS:
//   id, version, name, category, blurb, why, difficulty, rules[], settings[] (what can be set and its
//   default), pbKey(settings) (which sessions share a personal best), keyMetric { id, label, better },
//   start(settings) -> play            the drill's own state
//   target(play) -> { key, big, label, spoken, number, value, hitLabel, lit } or null when it is over
//   dartEffect(play, target, dart, i)  what one dart counted as: { kind: "hit" | "miss", key }
//   applyVisit(play, target, visit, settings) -> the visit's record (mutates play)
//   isOver(play), summarize(play, settings) -> result, cells(play, target) -> the strip,
//   voiceLine(ctx), moment(ctx), scoreText(play), paceText(play, best)
//
// How a visit works with the cameras (every drill here follows this, Doubles-style):
//   - a visit is 3 darts at the current target, and nothing ends it early;
//   - the 3rd dart scores the visit; a 4th dart before the take-out isn't counted ("pull your darts
//     out"), so one bad visit never shifts the ones after it;
//   - at the take-out, darts the cameras didn't see are misses at that visit's target;
//   - a dart is counted once across devices: each event's seq is kept in cam.seq inside the
//     transaction, and one already in is skipped;
//   - fixing a dart puts the state from just before the visit's first dart back (visit.cp) and scores
//     the visit's darts again, so a fix can do anything the cameras could have done; it stays possible
//     until the next visit's first dart lands, or a tap on the buttons or Undo;
//   - a tap on the buttons decides the current visit, and the cameras' darts held for it are dropped.
//
// The state document trainingState/{uid} = { uid, activeSession, undoStack, updatedAt }:
//   activeSession = { meta: { startedAtMs, sessionKey, drill, drillVersion, settings }, timer (the
//                     practice timer's plain data), play (the drill's state), cam: { seq, visit },
//                     throws: [...], visitNo, say: { n, text }, finishedAt }
//   cam.visit     = { n, cp, t, darts: [{ s, l, x, y, e, f }], out: { darts, unseen } | null }
//   cp            = { play, throws (how many), visitNo, finishedAt }: the state just before the visit
//   undoStack     = [{ id, at, startedAtMs, label, cp }], newest last, at most 10
//   throws        = every dart, misses included, in the tracker's shape plus the target and the visit:
//                   { v, t, k, r, l, x, y, seq, src: "cam" | "btn" | "unseen", f }
// A finished drill is saved once as trainingSessions/{sessionKey} (historyPayload) and stays in the
// state document until it is dismissed, so Undo can still take its last visit back.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./practice-timer.js"), require("./practice-engine.js"));
  else root.TrainingEngine = factory(root.PracticeTimer, root.DartsEngine);
})(typeof self !== "undefined" ? self : this, function (PT, DE) {
  "use strict";

  const SEG_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const BULL_OUT = 0.12; // the outer bull's radius on the app board (the double ring ends at 1)
  const BOARD_R = { S: 0.78, T: 0.58, D: 0.95, O: 1.06 };
  const UNDO_STEPS = 10;
  const MAX_THROWS = 400;

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const round4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);
  const pad2 = (n) => String(n).padStart(2, "0");
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

  // ---- the board -----------------------------------------------------------------------------------
  const angleOf = (n) => ((-90 + SEG_ORDER.indexOf(Number(n)) * 18) * Math.PI) / 180;
  // The number (or "BULL") a dart is in, by where it is, even just off the board.
  function numberAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.hypot(x, y) <= BULL_OUT) return "BULL";
    const wedge = (Math.PI * 2) / 20;
    let rel = Math.atan2(y, x) - (-Math.PI / 2 - wedge / 2);
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    return String(SEG_ORDER[Math.floor(rel / wedge)] || 20);
  }
  function neighbours(n) {
    const i = SEG_ORDER.indexOf(Number(n));
    return i < 0 ? [] : [SEG_ORDER[(i + 19) % 20], SEG_ORDER[(i + 1) % 20]];
  }
  // A typical spot for a label ("D7", "S7", "T7", "O7" just outside the D7 wire, "DB", "SB").
  function spot(label) {
    if (label === "DB") return { x: 0, y: 0 };
    if (label === "SB") return { x: 0, y: -0.085 };
    const m = /^([SDTO])(\d{1,2})$/.exec(String(label || ""));
    if (!m || SEG_ORDER.indexOf(Number(m[2])) === -1) return { x: NaN, y: NaN };
    const a = angleOf(m[2]), r = BOARD_R[m[1]];
    return { x: round4(Math.cos(a) * r), y: round4(Math.sin(a) * r) };
  }
  // What a label is: { ring, number, points, label }. "" or "MISS" is a miss.
  function parseLabel(label) {
    const l = String(label || "").toUpperCase();
    if (l === "DB") return { ring: "D", number: "BULL", points: 50, label: "DB" };
    if (l === "SB") return { ring: "S", number: "BULL", points: 25, label: "SB" };
    const m = /^([SDT])(\d{1,2})$/.exec(l);
    if (!m || SEG_ORDER.indexOf(Number(m[2])) === -1) return { ring: null, number: null, points: 0, label: l === "MISS" || !l ? "MISS" : l };
    const mult = m[1] === "T" ? 3 : m[1] === "D" ? 2 : 1;
    return { ring: m[1], number: m[2], points: Number(m[2]) * mult, label: l };
  }
  const describe = (label) => (!label || label === "MISS" ? "off the board" : label === "DB" ? "the bullseye" : label === "SB" ? "the outer bull" : label);
  const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

  // The 21 doubles, D1 to D20 and then the bull, as the Doubles game names them.
  const DOUBLES = [
    ...Array.from({ length: 20 }, (_, i) => ({ key: `D${i + 1}`, number: String(i + 1), value: (i + 1) * 2, big: `D${i + 1}`, label: `D${i + 1}`, spoken: `D ${i + 1}`, hitLabel: `D${i + 1}` })),
    { key: "DBULL", number: "BULL", value: 50, big: "BULL", label: "Bull", spoken: "the bull", hitLabel: "DB" },
  ];
  const litFor = (t) => (t.key === "DBULL" ? [{ n: "BULL", beds: "I" }] : [{ n: Number(t.number), beds: "D", tint: true }]);
  const hitsWords = ["No hits", "One hit", "Two hits", "Three hits"];

  // ---- the drills ------------------------------------------------------------------------------------
  const BOBS27 = {
    id: "bobs27",
    version: 1,
    name: "Bob's 27",
    category: "Doubles and checkouts",
    difficulty: "Hard",
    blurb: "Start on 27. Three darts at each double, D1 to D20, then the bull. Every hit adds the double; three misses take it away.",
    why: "Every double carries the same pressure as a finish: a miss costs points, so the drill trains the doubles you avoid as hard as the ones you like.",
    rules: [
      "You start on 27 (or the score you set). Three darts at D1, then D2, and so on to D20, then the bullseye.",
      "Each dart in the double adds its value (D1 is 2, D20 is 40, the bull 50). Three darts without a hit subtract it.",
      "The game is over at 0 or below, unless you choose to play on. Finish all 21 and your score is your result.",
      "With the cameras on, a visit is the 3 darts since you last pulled them out, all at the double you are on. A 4th dart before you pull them out is not counted. Darts the cameras did not see when you pull them out count as misses.",
      "By hand: tap how many of the 3 darts went in. Undo goes back up to 10 visits, from any device. Tap a dart on the board or in its box to fix what the cameras read.",
    ],
    settings: [
      { key: "start", label: "Starting score", type: "number", default: 27, min: 1, max: 500, step: 1, help: "The classic game starts on 27." },
      { key: "playOn", label: "Play on below zero", type: "boolean", default: false, help: "Off: the game ends the moment the score is 0 or below. On: all 21 doubles are thrown whatever the score." },
      { key: "sayScore", label: "Say the score after each double", type: "boolean", default: true, help: "The voice says the double, the hits and your new score." },
    ],
    keyMetric: { id: "score", label: "Score", better: "higher" },
    pbKey: (s) => `bobs27:${num(s.start, 27)}:${s.playOn ? "on" : "stop"}`,
    start(s) { return { score: num(s.start, 27), cursor: 0, visits: [], trail: [num(s.start, 27)], over: false, below: false }; },
    target(play) {
      if (!play || play.over || play.cursor >= DOUBLES.length) return null;
      const d = DOUBLES[play.cursor];
      return Object.assign({}, d, { lit: litFor(d), index: play.cursor });
    },
    dartEffect(play, t, dart) {
      return (dart.l || "") === t.hitLabel ? { kind: "hit", key: t.key } : { kind: "miss", key: t.key };
    },
    applyVisit(play, t, visit, settings) {
      const before = play.score;
      const delta = visit.hits ? visit.hits * t.value : -t.value;
      play.score += delta;
      play.cursor += 1;
      const rec = { key: t.key, hits: visit.hits, delta, score: play.score, before };
      play.visits.push(rec);
      play.trail.push(play.score);
      if (play.score <= 0) { play.below = true; if (!(settings && settings.playOn)) play.over = true; }
      if (play.cursor >= DOUBLES.length) play.over = true;
      return rec;
    },
    isOver: (play) => !!(play && play.over),
    summarize(play, settings) {
      const perDouble = {};
      let hits = 0, best = null;
      for (const v of play.visits) {
        perDouble[v.key] = { hits: v.hits, darts: 3 };
        hits += v.hits;
        if (!best || v.hits > best.hits) best = { key: v.key, hits: v.hits };
      }
      const last = play.visits[play.visits.length - 1];
      return {
        score: play.score,
        start: num(settings && settings.start, 27),
        doublesPlayed: play.cursor,
        furthest: last ? last.key : null,
        finishedAll: play.cursor >= DOUBLES.length,
        wentBelow: !!play.below,
        hits,
        darts: play.cursor * 3,
        hitRate: play.cursor ? hits / (play.cursor * 3) : 0,
        perDouble,
        trail: play.trail.slice(),
        bestVisit: best,
      };
    },
    cells(play, t) {
      return DOUBLES.map((d, i) => {
        const v = play.visits[i];
        const n = d.key === "DBULL" ? "B" : d.number;
        if (v) return { key: d.key, num: n, state: `done h${v.hits}`, sub: (v.delta > 0 ? "+" : "") + v.delta, title: `${d.label}: ${hitsWords[v.hits].toLowerCase()}, ${v.delta > 0 ? "+" : ""}${v.delta}` };
        if (t && t.key === d.key) return { key: d.key, num: n, state: "current", sub: `+${d.value}`, title: `${d.label}: a hit is +${d.value}, three misses −${d.value}` };
        return { key: d.key, num: n, state: "todo", sub: "", title: d.label };
      });
    },
    scoreText: (play) => String(play.score),
    // "D 3. Two hits. 33. Next, D 4." (short, slow, a stop between sentences; the score only when asked)
    voiceLine({ target, visit, play, settings, next, over }) {
      const parts = [target.spoken.replace(/^the /, "The "), hitsWords[visit.hits]];
      if (!visit.hits && (!settings || settings.sayScore !== false)) parts.push(`Minus ${target.value}`);
      if (!settings || settings.sayScore !== false) parts.push(String(play.score));
      if (over) parts.push(play.cursor >= DOUBLES.length ? `All 21 done. ${play.score}` : "Below zero. Game over");
      else if (next) parts.push(`Next, ${next.spoken}`);
      return parts.join(". ") + ".";
    },
    moment({ target, visit, play, over }) {
      if (over && play.cursor >= DOUBLES.length) return { big: "All 21 done", sub: `${play.score} points`, kind: "finish" };
      if (over) return { big: "Below zero", sub: `Game over at ${target.label}: ${play.score}`, kind: "finish" };
      if (visit.hits === 3) return { big: `Three in ${target.label}`, sub: `+${visit.delta}: ${play.score}`, kind: "nine" };
      if (play.cursor === DOUBLES.length - 1) return { big: "On to the bull", sub: `${play.score} points, one double to go`, kind: "win" };
      return null;
    },
    // Against the best round's score at the same point.
    paceText(play, best) {
      const trail = best && best.result && Array.isArray(best.result.trail) ? best.result.trail : null;
      const i = play.trail.length - 1;
      if (!trail || i < 1 || trail.length <= i) return null;
      const diff = play.trail[i] - trail[i];
      return diff > 0 ? `+${diff} on your best` : diff < 0 ? `${diff} on your best` : "Level with your best";
    },
  };

  const DRILLS = [BOBS27];
  const CATEGORIES = ["Scoring", "Doubles and checkouts", "Pressure", "Warm-up"];
  const drillOf = (id) => DRILLS.find((d) => d.id === id) || null;

  // The settings a session runs with: the drill's defaults, with what was chosen kept within range.
  function cleanSettings(drill, given) {
    const out = {};
    for (const s of drill.settings || []) {
      const v = given && given[s.key] !== undefined ? given[s.key] : s.default;
      if (s.type === "number") {
        let n = num(v, s.default);
        if (s.min != null) n = Math.max(s.min, n);
        if (s.max != null) n = Math.min(s.max, n);
        out[s.key] = s.step === 1 ? Math.round(n) : n;
      } else if (s.type === "boolean") out[s.key] = v === true || v === "true" || v === 1 || v === "1";
      else if (s.type === "choice") out[s.key] = (s.options || []).some((o) => o.value === v) ? v : s.default;
      else out[s.key] = v;
    }
    return out;
  }

  // ---- a session ------------------------------------------------------------------------------------
  const freshCam = (seq) => ({ seq: seq || 0, visit: null });

  function newSession(drillId, settings, now, sessionKey) {
    const d = drillOf(drillId);
    if (!d) return null;
    const s = cleanSettings(d, settings);
    return {
      meta: { startedAtMs: now, sessionKey: sessionKey || null, drill: d.id, drillVersion: d.version, settings: s },
      timer: PT.start(now),
      play: d.start(s),
      cam: freshCam(0),
      throws: [],
      visitNo: 0,
      say: null,
      finishedAt: null,
    };
  }
  // A session read back from Firestore, with anything an older page left out filled in.
  function ensureSession(sess, now) {
    if (!sess || !sess.meta || !drillOf(sess.meta.drill)) return null;
    if (!sess.timer) sess.timer = PT.start(sess.meta.startedAtMs || now || Date.now());
    if (!sess.cam) sess.cam = freshCam(0);
    if (!Array.isArray(sess.throws)) sess.throws = [];
    if (!Number.isFinite(sess.visitNo)) sess.visitNo = 0;
    if (sess.finishedAt === undefined) sess.finishedAt = null;
    sess.meta.settings = cleanSettings(drillOf(sess.meta.drill), sess.meta.settings);
    return sess;
  }
  const drillFor = (sess) => drillOf(sess && sess.meta && sess.meta.drill);
  const target = (sess) => (sess ? drillFor(sess).target(sess.play) : null);
  const isFinished = (sess) => !!(sess && (sess.finishedAt || drillFor(sess).isOver(sess.play)));
  // Paused by you (a timer that paused itself after 3 quiet minutes starts again with the next dart).
  const isPaused = (sess, now) => !!(sess && sess.timer && PT.isPaused(sess.timer, now) && sess.timer.pausedBy === "you");
  function pauseResume(sess, now) {
    if (!sess || isFinished(sess)) return false;
    if (PT.isPaused(sess.timer, now)) PT.resume(sess.timer, now); else PT.pause(sess.timer, now);
    return true;
  }
  const elapsedMs = (sess, now) => (sess && sess.timer ? PT.elapsedMs(sess.timer, now) : 0);
  const fmt = (ms) => PT.format(ms);

  function snapshotFor(sess) {
    return { play: clone(sess.play), throws: sess.throws.length, visitNo: sess.visitNo || 0, finishedAt: sess.finishedAt || null };
  }
  function restore(sess, cp) {
    sess.play = clone(cp.play);
    sess.throws = sess.throws.slice(0, cp.throws);
    sess.visitNo = cp.visitNo || 0;
    sess.finishedAt = cp.finishedAt || null;
  }

  // A throw as it is saved: the tracker's shape (t, r, l, x, y, seq, src) plus the target key and the visit.
  function throwOf(dart, t, effect, visitNo, src) {
    const p = parseLabel(dart.l);
    const o = { v: visitNo, t: t.number, k: t.key, r: p.ring || "-", l: p.ring ? p.label : dart.l === "MISS" ? "MISS" : "", src: src || dart.src || "cam" };
    if (Number.isFinite(dart.x) && Number.isFinite(dart.y)) { o.x = round4(dart.x); o.y = round4(dart.y); }
    if (dart.s) o.seq = dart.s;
    if (dart.f) o.f = 1;
    if (effect && effect.kind === "hit") o.h = 1;
    return o;
  }

  // Scores one visit of exactly 3 darts ({ l, x, y, s, f, src, e? }) at the current target. Returns
  // { visit, target, hits, over, moment, line } or { error }.
  function scoreVisit(sess, darts, now) {
    const d = drillFor(sess);
    const t = d.target(sess.play);
    if (!t) return { error: "The drill is finished." };
    const effects = darts.map((x, i) => x.e || d.dartEffect(sess.play, t, x, i));
    const hits = effects.filter((e) => e && e.kind === "hit").length;
    const before = clone(sess.play);
    const visit = d.applyVisit(sess.play, t, { hits, effects, darts }, sess.meta.settings);
    sess.visitNo = (sess.visitNo || 0) + 1;
    darts.forEach((x, i) => { sess.throws.push(throwOf(x, t, effects[i], sess.visitNo, x.src)); });
    if (sess.throws.length > MAX_THROWS) sess.throws.splice(0, sess.throws.length - MAX_THROWS);
    PT.activity(sess.timer, now);
    const over = d.isOver(sess.play);
    if (over) { sess.finishedAt = now; PT.pause(sess.timer, now); }
    const next = d.target(sess.play);
    const ctx = { before, play: sess.play, target: t, visit, settings: sess.meta.settings, over, next };
    const line = d.voiceLine ? d.voiceLine(ctx) : null;
    if (line) sess.say = { n: ((sess.say && sess.say.n) || 0) + 1, text: line };
    return { visit, target: t, hits, over, moment: d.moment ? d.moment(ctx) : null, line };
  }

  // ---- Undo ------------------------------------------------------------------------------------------
  const undoStackOf = (u) => (u && Array.isArray(u.undoStack) ? u.undoStack.slice() : []);
  const undoCount = (u, sess) => undoStackOf(u).filter((x) => !sess || x.startedAtMs === sess.meta.startedAtMs).length;
  function pushUndo(u, sess, cp, label, id) {
    const s = undoStackOf(u).filter((x) => x.startedAtMs === sess.meta.startedAtMs);
    s.push({ id: id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: Date.now(), startedAtMs: sess.meta.startedAtMs, label: label || "visit", cp: clone(cp) });
    u.undoStack = s.slice(-UNDO_STEPS);
  }
  // Takes the newest step back: the state from before that visit, with the cameras' seq kept (a dart
  // already counted is never counted again) and the visit on the board ended.
  function undoStep(u, sess, now) {
    if (!sess) return { error: "Nothing to undo." };
    const s = undoStackOf(u).filter((x) => x.startedAtMs === sess.meta.startedAtMs);
    const top = s.pop();
    if (!top) { u.undoStack = []; return { error: "Nothing to undo." }; }
    const wasFinished = isFinished(sess);
    restore(sess, top.cp);
    sess.cam = freshCam((sess.cam && sess.cam.seq) || 0);
    if (wasFinished && !isFinished(sess)) PT.resume(sess.timer, now);
    PT.activity(sess.timer, now);
    const t = target(sess);
    sess.say = { n: ((sess.say && sess.say.n) || 0) + 1, text: t ? `Undone. ${t.spoken.replace(/^the /, "The ")}.` : "Undone." };
    u.undoStack = s;
    return { record: top, unfinished: wasFinished && !isFinished(sess), sessionKey: sess.meta.sessionKey || null };
  }

  // ---- the buttons -------------------------------------------------------------------------------------
  // "hits this visit": n of the 3 darts went in. Returns scoreVisit's result or { error }.
  function manualVisit(u, sess, hits, now) {
    if (!sess) return { error: "Start a drill first." };
    if (isFinished(sess)) return { error: "The drill is finished. Use Undo to take the last visit back." };
    if (isPaused(sess, now)) return { error: "The drill is paused. Resume it first." };
    const n = Number(hits);
    if (!Number.isInteger(n) || n < 0 || n > 3) return { error: "Hits must be 0 to 3." };
    const t = target(sess);
    if (!t) return { error: "The drill is finished." };
    const cp = snapshotFor(sess);
    const darts = Array.from({ length: 3 }, (_, i) => ({ l: i < n ? t.hitLabel : "", src: "btn" }));
    const r = scoreVisit(sess, darts, now);
    if (r.error) return r;
    pushUndo(u, sess, cp, `${t.label}: ${hitsWords[n].toLowerCase()}`);
    sess.cam = freshCam((sess.cam && sess.cam.seq) || 0); // the cameras' darts held for this visit are dropped
    return Object.assign(r, { message: `${t.label}: ${hitsWords[n].toLowerCase()}, ${r.visit.delta > 0 ? "+" : ""}${r.visit.delta}. ${r.over ? "Done." : `Now ${target(sess).label}.`}` });
  }

  // ---- the cameras -------------------------------------------------------------------------------------
  // One dart from the cameras: { seq, label, x, y } on the app board. Returns null when it was already
  // counted (another device got it in first), else { effect, scored, message, uncertainTap }.
  function cameraDart(u, sess, dart, now) {
    if (!sess || !dart) return null;
    const cam = sess.cam || (sess.cam = freshCam(0));
    if (dart.seq && dart.seq <= (cam.seq || 0)) return null;
    if (dart.seq) cam.seq = dart.seq;
    const label = dart.label || "MISS";
    const d = drillFor(sess);
    const t = d.target(sess.play);
    if (!t || isFinished(sess)) return { effect: { kind: "ignored" }, message: "The drill is finished." };
    if (isPaused(sess, now)) return { effect: { kind: "ignored" }, message: `Camera saw ${describe(label)}, but the drill is paused.` };
    let v = cam.visit;
    if (v && !v.out && v.darts.length >= 3) {
      return { effect: { kind: "spare", key: v.t.key }, message: `Camera: ${describe(label)}, not counted. That visit had its 3 darts: pull your darts out.` };
    }
    if (!v || v.out) {
      v = cam.visit = { n: ((v && v.n) || 0) + 1, cp: snapshotFor(sess), t: { key: t.key, label: t.label, number: t.number, value: t.value, hitLabel: t.hitLabel }, darts: [], out: null };
    }
    const e = d.dartEffect(sess.play, t, { l: label, x: dart.x, y: dart.y }, v.darts.length);
    v.darts.push({ s: dart.seq || 0, l: label, x: round4(dart.x), y: round4(dart.y), e });
    let scored = null;
    if (v.darts.length === 3) {
      scored = scoreVisit(sess, v.darts.map((x) => Object.assign({ src: "cam" }, x)), now);
      pushUndo(u, sess, v.cp, `${t.label}: ${hitsWords[scored.hits].toLowerCase()}`);
    }
    const what = e.kind === "hit" ? `${describe(label)}: a hit` : describe(label);
    const message = scored
      ? `Camera: ${what}. ${t.label}: ${hitsWords[scored.hits].toLowerCase()}, ${scored.visit.delta > 0 ? "+" : ""}${scored.visit.delta}. ${scored.over ? "Done." : `Pull your darts out, then ${target(sess).label}.`}`
      : `Camera: ${what} (dart ${v.darts.length} at ${t.label}).`;
    return { effect: e, scored, message };
  }

  // Darts pulled out: the visit ends. Fewer than 3 seen: the ones the cameras didn't see are misses
  // at this visit's target. Returns null when already in, else { scored, unseen, message }.
  function cameraTakeout(u, sess, e, now) {
    if (!sess || !e) return null;
    const cam = sess.cam || (sess.cam = freshCam(0));
    if (e.seq && e.seq <= (cam.seq || 0)) return null;
    if (e.seq) cam.seq = e.seq;
    const v = cam.visit;
    if (!v || v.out) return { scored: null, unseen: 0, message: "Darts out." };
    if (v.darts.length >= 3) { v.out = { darts: num(e.darts, 0), unseen: 0 }; return { scored: null, unseen: 0, message: "Darts out." }; }
    if (isFinished(sess) || isPaused(sess, now)) { v.out = { darts: num(e.darts, 0), unseen: 0 }; return { scored: null, unseen: 0, message: "Darts out." }; }
    const unseen = 3 - v.darts.length;
    v.out = { darts: num(e.darts, 0), unseen };
    const darts = v.darts.map((x) => Object.assign({ src: "cam" }, x)).concat(Array.from({ length: unseen }, () => ({ l: "", src: "unseen" })));
    const scored = scoreVisit(sess, darts, now);
    pushUndo(u, sess, v.cp, `${v.t.label}: ${hitsWords[scored.hits].toLowerCase()}`);
    return { scored, unseen, message: `Darts out: ${unseen} dart${unseen === 1 ? "" : "s"} the cameras didn't see counted as missed. ${v.t.label}: ${hitsWords[scored.hits].toLowerCase()}, ${scored.visit.delta > 0 ? "+" : ""}${scored.visit.delta}.` };
  }

  // Dart `index` of the visit on the board (its seq must still be `seq`) was really fix = { label, x, y },
  // or wasn't a dart at all (fix.remove). The visit is scored again from just before its first dart.
  // Returns { error } or { changed, scored, message }.
  function fixDart(u, sess, index, seq, fix, now) {
    const v = sess && sess.cam && sess.cam.visit;
    const d0 = v && v.darts[index];
    if (!d0 || (d0.s || 0) !== (seq || 0)) return { error: "That visit can't be changed any more. Use Undo, then tap what happened." };
    if (isPaused(sess, now)) return { error: "The drill is paused. Resume it first." };
    const d = drillFor(sess);
    const wasScored = v.darts.length >= 3 || !!v.out;
    const darts = v.darts.map((x) => clone(x));
    if (fix.remove) darts.splice(index, 1);
    else Object.assign(darts[index], { l: fix.label || "MISS", x: round4(fix.x), y: round4(fix.y), f: 1 });
    // Back to just before the visit's first dart...
    restore(sess, v.cp);
    const t = d.target(sess.play);
    if (!t) return { error: "The drill is finished." };
    // ...and through its darts again, as the cameras would have read them.
    darts.forEach((x, i) => { x.e = d.dartEffect(sess.play, t, x, i); });
    let scored = null, out = v.out ? Object.assign({}, v.out) : null;
    if (darts.length >= 3) scored = scoreVisit(sess, darts.slice(0, 3).map((x) => Object.assign({ src: "cam" }, x)), now);
    else if (out) {
      out.unseen = 3 - darts.length;
      scored = scoreVisit(sess, darts.map((x) => Object.assign({ src: "cam" }, x)).concat(Array.from({ length: out.unseen }, () => ({ l: "", src: "unseen" }))), now);
    }
    sess.cam.visit = { n: v.n, cp: v.cp, t: v.t, darts, out };
    // The undo step for this visit: still right when the visit is still scored, gone when it isn't.
    const s = undoStackOf(u).filter((x) => x.startedAtMs === sess.meta.startedAtMs);
    if (wasScored && !scored) { s.pop(); u.undoStack = s; }
    else if (scored && !wasScored) pushUndo(u, sess, v.cp, `${t.label}: ${hitsWords[scored.hits].toLowerCase()}`);
    else if (scored && s.length) { s[s.length - 1].label = `${t.label}: ${hitsWords[scored.hits].toLowerCase()}`; u.undoStack = s; }
    const changed = fix.remove || d0.l !== (fix.label || "MISS");
    const message = fix.remove ? `Dart ${index + 1} taken out: it wasn't a dart.` : `Fixed dart ${index + 1}: ${describe(fix.label)}${scored ? `. ${t.label}: ${hitsWords[scored.hits].toLowerCase()}, ${scored.visit.delta > 0 ? "+" : ""}${scored.visit.delta}.` : "."}`;
    return { changed, scored, message };
  }

  // ---- what the board shows ------------------------------------------------------------------------------
  // What a dart of the visit counted as, in words: { read, sub, kind }.
  function dartWords(d, t) {
    const e = d.e || {};
    const p = parseLabel(d.l);
    if (d.src === "btn" || (!d.l && !Number.isFinite(d.x))) return e.kind === "hit" ? { read: "Hit", sub: "Entered by hand", kind: "hit" } : { read: "Miss", sub: "Entered by hand", kind: "miss" };
    const off = Number.isFinite(d.x) && Number.isFinite(d.y) ? Math.hypot(d.x, d.y) > 1 : p.label === "MISS";
    const where = Number.isFinite(d.x) && Number.isFinite(d.y) ? numberAt(d.x, d.y) : null;
    const read = p.label === "MISS" ? (off ? "Outside" : "Miss") : p.label === "DB" ? "Bull" : p.label === "SB" ? "25" : p.label;
    const key = (t && t.key) || e.key, number = t ? t.number : null;
    if (e.kind === "hit") return { read, sub: t ? `In ${t.label}: +${t.value}` : "A hit", kind: "hit" };
    if (e.kind === "spare") return { read, sub: "Not counted: the visit was over", kind: "spare" };
    let sub = key ? `A miss at ${key === "DBULL" ? "the bull" : key}` : "A miss";
    if (p.label === "MISS" && number && where === number && off) sub = `Just past the ${key === "DBULL" ? "bull" : key} wire`;
    else if (p.label === "MISS" && off) sub = "Off the board";
    else if (number === "BULL" && p.label === "SB") sub = "Outer bull: a miss";
    else if (number && number !== "BULL" && p.number === number) sub = p.ring === "S" ? "Inside the wire" : p.ring === "T" ? "In the triple" : "A miss";
    else if (number && number !== "BULL" && where && neighbours(number).map(String).includes(where)) sub = `Next door, in the ${where}`;
    return { read, sub, kind: "miss" };
  }

  // The view Board mode draws (board-mode.js): the target, this visit's darts, the strip, the caption.
  function boardView(sess, ctx) {
    if (!sess) return null;
    const d = drillFor(sess);
    const t = d.target(sess.play);
    const cam = sess.cam || freshCam();
    const v = cam.visit;
    const darts = v ? v.darts.map((x, i) => Object.assign({ index: i, s: x.s || 0, label: x.l, x: x.x, y: x.y, key: v.t && v.t.key, fixed: !!x.f }, dartWords(x, v.t))) : [];
    const scoredOpen = !!(v && v.darts.length >= 3 && !v.out);
    const finished = isFinished(sess);
    const next = [];
    for (let i = (play(sess).cursor || 0) + 1; i < DOUBLES.length && next.length < 3; i += 1) next.push(DOUBLES[i].big);
    const pace = ctx && ctx.best && d.paceText ? d.paceText(sess.play, ctx.best) : null;
    return {
      target: t ? t.key : null,
      finished,
      next,
      dartNo: v && !v.out && v.darts.length < 3 ? v.darts.length + 1 : 1,
      darts,
      unseen: v && v.out ? v.out.unseen || 0 : 0,
      visitDone: !!(v && (v.out || v.darts.length >= 3)),
      pullOut: scoredOpen && !finished,
      cells: d.cells(sess.play, t),
      done: sess.play.cursor || 0,
      of: DOUBLES.length,
      capHtml: `<strong>${d.scoreText(sess.play)}</strong> points · ${sess.play.cursor || 0} of ${DOUBLES.length} doubles`,
      note: finished ? (sess.play.cursor >= DOUBLES.length ? "All 21 doubles thrown" : "Below zero: game over") : pace || "",
    };
  }
  const play = (sess) => sess.play || {};

  // ---- history and bests --------------------------------------------------------------------------------
  function stamp(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  const localDate = (ms) => stamp(ms).slice(0, 10);
  const summarize = (sess) => drillFor(sess).summarize(sess.play, sess.meta.settings);

  // The trainingSessions document for a drill (finished, or abandoned with complete: false).
  function historyPayload(sess, now, extra) {
    const d = drillFor(sess);
    const result = summarize(sess);
    const out = {
      drill: d.id,
      drillVersion: d.version,
      settings: clone(sess.meta.settings),
      result,
      key: result[d.keyMetric.id],
      throws: clone(sess.throws || []),
      startedAtMs: sess.meta.startedAtMs,
      endedAtMs: sess.finishedAt || now,
      activeMs: Math.round(elapsedMs(sess, now)),
      timestamp: stamp(sess.meta.startedAtMs),
      localDate: localDate(sess.meta.startedAtMs),
      complete: isFinished(sess),
      createdAt: now,
    };
    if (extra && extra.planRunId) out.planRunId = String(extra.planRunId);
    return out;
  }
  const counts = (h) => !!h && h.complete !== false && !!h.result;
  const better = (drill, a, b) => (drill.keyMetric.better === "lower" ? a < b : a > b);
  // The best saved session of this drill with these settings (same pbKey), or null.
  function personalBest(history, drillId, settings) {
    const d = drillOf(drillId);
    if (!d) return null;
    const key = d.pbKey(cleanSettings(d, settings));
    let best = null;
    for (const h of history || []) {
      if (!counts(h) || h.drill !== d.id || d.pbKey(cleanSettings(d, h.settings)) !== key || !Number.isFinite(Number(h.key))) continue;
      if (!best || better(d, Number(h.key), Number(best.key))) best = h;
    }
    return best;
  }
  // Whether a result beats the best (strictly).
  const isNewBest = (drillId, key, best) => !!drillOf(drillId) && Number.isFinite(Number(key)) && (!best || better(drillOf(drillId), Number(key), Number(best.key)));
  // Recent sessions of a drill, newest first, as the history list shows them.
  function historyRows(history, drillId) {
    return (history || []).filter((h) => h.drill === drillId).sort((a, b) => (b.startedAtMs || 0) - (a.startedAtMs || 0));
  }

  // ---- checkouts -------------------------------------------------------------------------------------
  // The finishes with no 3-dart route under double out.
  const BOGEY = [169, 168, 166, 165, 163, 162, 159];
  // Routes to prefer over the solver's, as data: score -> darts left -> route text ("T17 T10 D20";
  // a bare number is a single, Bull the bullseye, 25 the outer bull). Edit freely.
  const PREFERRED_ROUTES = {
    121: { 3: "T17 T10 D20" },
    100: { 2: "T20 D20" },
  };
  function parseRoute(text) {
    const toks = String(text || "").trim().split(/[\s,+-]+/).filter(Boolean);
    const out = [];
    for (const tok of toks) {
      const u = tok.toUpperCase();
      if (u === "BULL" || u === "DB" || u === "50" || u === "DBULL") out.push("DB");
      else if (u === "25" || u === "SB" || u === "OB" || u === "SBULL") out.push("SB");
      else if (/^[SDT]\d{1,2}$/.test(u) && SEG_ORDER.includes(Number(u.slice(1)))) out.push(u);
      else if (/^\d{1,2}$/.test(u) && SEG_ORDER.includes(Number(u))) out.push("S" + u);
      else return null;
    }
    return out.length ? out : null;
  }
  const routeTotal = (labels) => (labels || []).reduce((s, l) => s + parseLabel(l).points, 0);
  const endsOnDouble = (labels) => !!(labels && labels.length) && parseLabel(labels[labels.length - 1]).ring === "D";
  const routeValid = (labels, remaining, dartsLeft) => Array.isArray(labels) && labels.length >= 1 && labels.length <= Math.min(3, dartsLeft || 3) && routeTotal(labels) === remaining && endsOnDouble(labels);
  const routeText = (labels) => (labels || []).map((l) => (l === "DB" ? "Bull" : l === "SB" ? "25" : l)).join(" ");
  // The route to suggest from `remaining` with `dartsLeft` darts (double out), as labels, or null.
  function checkoutRoute(remaining, dartsLeft, prefs) {
    const darts = Math.min(3, num(dartsLeft, 3));
    if (!Number.isInteger(remaining) || remaining < 2 || remaining > 170 || darts < 1) return null;
    const solver = DE.checkoutRoute(remaining, darts, true);
    const engine = solver ? solver.map((x) => x.label) : null;
    const p = (prefs === undefined ? PREFERRED_ROUTES : prefs) || {};
    const mine = p[remaining];
    if (mine) {
      for (let k = 1; k <= darts; k += 1) {
        if (!mine[k]) continue;
        const labels = parseRoute(mine[k]);
        if (routeValid(labels, remaining, k) && (!engine || labels.length <= engine.length)) return labels;
      }
    }
    return engine;
  }
  const isBogey = (n) => BOGEY.includes(Number(n));
  // Every finish from 2 to 170: [{ n, bogey, routes: { 1, 2, 3 } }] (a route is labels, or null).
  function checkoutTable(prefs) {
    const out = [];
    for (let n = 2; n <= 170; n += 1) out.push({ n, bogey: isBogey(n), routes: { 1: checkoutRoute(n, 1, prefs), 2: checkoutRoute(n, 2, prefs), 3: checkoutRoute(n, 3, prefs) } });
    return out;
  }

  return {
    DRILLS, CATEGORIES, DOUBLES, UNDO_STEPS, MAX_THROWS, BOGEY, PREFERRED_ROUTES,
    drillOf, cleanSettings, newSession, ensureSession, target, isFinished, isPaused, pauseResume, elapsedMs, fmt,
    manualVisit, cameraDart, cameraTakeout, fixDart, undoStep, undoCount, undoStackOf,
    boardView, dartWords, summarize, historyPayload, personalBest, isNewBest, historyRows, stamp, localDate,
    checkoutRoute, checkoutTable, parseRoute, routeText, routeTotal, endsOnDouble, routeValid, isBogey,
    parseLabel, describe, spot, numberAt, neighbours, ordinal, hitsWords, clone,
  };
});
