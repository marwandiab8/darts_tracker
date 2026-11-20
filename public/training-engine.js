// Training drills (training.html): the rules of every practice drill, with no DOM or Firebase, so
// `node --test tests/training-engine.test.cjs` checks them and the page loads this with a <script>.
//
// One engine, many drills. The shared machinery lives here once: a visit of darts from the cameras
// or by hand, fixing a dart by scoring its visit again, a 10-step Undo, the practice timer, the
// voice line, and the saved shapes. Each drill is configuration plus pure functions in DRILLS:
//   id, version, name, category, blurb, why, difficulty, rules[], settings[] (what can be set and its
//   default), pbKey(settings) (which sessions share a personal best), keyMetric { id, label, better },
//   input                              "hits" (how many of the 3 went in) or "darts" (one dart at a time)
//   start(settings, now) -> play       the drill's own state
//   target(play) -> { key, big, label, spoken, intro, number, value, hitLabel, lit, route, ... } or
//                                      null when it is over
//   dartsPerVisit(play, target)        3 unless the drill says otherwise (Two-Dart Finishes: 2)
//   dartEffect(play, target, dart, i, soFar)  what one dart counted as, given the visit's darts before
//                                      it: { kind: "hit" | "miss" | "score" | "bust", key, pts, ends }
//                                      (ends: the visit is over on this dart, a checkout or a bust)
//   applyVisit(play, target, visit, settings) -> the visit's record (mutates play)
//   isOver(play), summarize(play, settings) -> result, cells(play, target) -> the strip,
//   voiceLine(ctx), moment(ctx), scoreText(play), scoreLabel, paceText(play, best), progress(play),
//   next(play, target) -> chips, live(play, target, effects) -> what the board shows mid-visit (the
//   remaining and the route), dartWords(dart, target), fixOptions(dart, view), visitWords(target, rec),
//   resultText(result, ctx), facts(result, ctx), doneText(result), historyColumns, historyCells(h)
//
// How a visit works with the cameras (every drill here follows this, Doubles-style):
//   - a visit is N darts (3, or 2 for the two-dart drill) at the current target; a drill may end it
//     early on a dart (a checkout or a bust: the effect's `ends`);
//   - the last dart scores the visit; a dart after that before the take-out isn't counted ("pull your
//     darts out"), so one bad visit never shifts the ones after it (the Nov 18 rule);
//   - at the take-out, darts the cameras didn't see are misses at that visit's target, unless the
//     visit had already ended;
//   - a dart is counted once across devices: each event's seq is kept in cam.seq inside the
//     transaction, and one already in is skipped;
//   - fixing a dart puts the state from just before the visit's first dart back (visit.cp) and scores
//     the visit's darts again, so a fix can do anything the cameras could have done; it stays possible
//     until the next visit's first dart lands, or a tap on the buttons or Undo;
//   - a dart entered by hand (a tap on the board, or a button) joins the visit like a camera dart;
//     a "hits this visit" tap decides the whole visit, and the cameras' darts held for it are dropped.
//
// The state document trainingState/{uid} = { uid, activeSession, undoStack, bests, updatedAt }:
//   activeSession = { meta: { startedAtMs, sessionKey, drill, drillVersion, settings }, timer (the
//                     practice timer's plain data), play (the drill's state), cam: { seq, visit },
//                     throws: [...], visitNo, say: { n, text }, finishedAt }
//   cam.visit     = { n, cp, t, max, ended, darts: [{ s, l, x, y, e, f, b }], out: { darts, unseen } | null }
//   cp            = { play, throws (how many), visitNo, finishedAt }: the state just before the visit
//   undoStack     = [{ id, at, startedAtMs, label, cp }], newest last, at most 10
//   throws        = every dart, misses included, in the tracker's shape plus the target and the visit:
//                   { v, t, k, r, l, x, y, seq, src: "cam" | "btn" | "unseen", f, h, p }
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
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

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
  // A label as it is read ("T20", "Bull", "25") and as it is spoken ("T 20", "the bull", "25").
  const readLabel = (l) => (l === "DB" ? "Bull" : l === "SB" ? "25" : l === "MISS" || !l ? "Miss" : l);
  const speakLabel = (l) => (l === "DB" ? "the bull" : l === "SB" ? "25" : String(l || "").replace(/^([SDT])(\d+)$/, (m, r, n) => (r === "S" ? n : `${r} ${n}`)));
  // The bed a label is, for lighting the board: { n, beds }.
  function bedOf(label) {
    const p = parseLabel(label);
    if (!p.ring) return null;
    if (p.number === "BULL") return { n: "BULL", beds: p.ring === "D" ? "I" : "B" };
    return { n: Number(p.number), beds: p.ring };
  }
  const routeLit = (route) => (route && route.length && bedOf(route[0]) ? [bedOf(route[0])] : []);

  // The 21 doubles, D1 to D20 and then the bull, as the Doubles game names them.
  const DOUBLES = [
    ...Array.from({ length: 20 }, (_, i) => ({ key: `D${i + 1}`, number: String(i + 1), value: (i + 1) * 2, big: `D${i + 1}`, label: `D${i + 1}`, spoken: `D ${i + 1}`, hitLabel: `D${i + 1}` })),
    { key: "DBULL", number: "BULL", value: 50, big: "BULL", label: "Bull", spoken: "the bull", hitLabel: "DB" },
  ];
  const litFor = (t) => (t.key === "DBULL" ? [{ n: "BULL", beds: "I" }] : [{ n: Number(t.number), beds: "D", tint: true }]);
  const hitsWords = ["No hits", "One hit", "Two hits", "Three hits"];

  // ---- x01 pieces for the checkout drills --------------------------------------------------------------
  // The x01 rules come from the bot game's engine (practice-engine.js): the same solver gives the routes,
  // and a dart busts the same way (below zero, one left, or zero without a double).
  const canDouble = (v) => (v >= 2 && v <= 40 && v % 2 === 0) || v === 50;
  const doubleFor = (v) => (v === 50 ? "DB" : canDouble(v) ? `D${v / 2}` : null);
  // One dart at `rem` under double out: { kind, key, rem, pts, after, onDouble, out?, ends? }.
  function x01Effect(key, rem, label) {
    const p = parseLabel(label);
    const e = { key, rem, pts: p.points, after: rem - p.points, onDouble: canDouble(rem) };
    if (!p.ring) return Object.assign(e, { kind: "miss", pts: 0, after: rem });
    if (e.after < 0 || e.after === 1 || (e.after === 0 && p.ring !== "D")) return Object.assign(e, { kind: "bust", pts: 0, after: rem, ends: true });
    if (e.after === 0) return Object.assign(e, { kind: "hit", out: true, ends: true });
    return Object.assign(e, { kind: "score" });
  }
  const sumPts = (effects) => (effects || []).reduce((s, e) => s + ((e && e.pts) || 0), 0);
  // What an x01 dart counted as, in words (the dart boxes).
  function x01Words(d) {
    const e = d.e || {};
    const read = readLabel(d.l);
    if (e.kind === "spare") return { read, sub: "Not counted: the visit was over", kind: "spare" };
    if (e.kind === "bust") return { read, sub: "Bust", kind: "miss" };
    if (e.out) return { read, sub: "Game shot", kind: "hit" };
    if (e.kind === "score") return { read, sub: e.setup ? `${e.pts}. Left ${e.after}: ${doubleFor(e.after)}` : `${e.pts}. Left ${e.after}`, kind: e.setup || e.pts >= 40 ? "hit" : "stay" };
    const where = Number.isFinite(d.x) && Number.isFinite(d.y) ? numberAt(d.x, d.y) : null;
    const off = !d.b && (Number.isFinite(d.x) && Number.isFinite(d.y) ? Math.hypot(d.x, d.y) > 1 : true);
    return { read: off ? "Outside" : "Miss", sub: e.onDouble ? `Missed ${doubleFor(e.rem)}` : off && where && where !== "BULL" ? `Just past the ${where}` : "No score", kind: "miss" };
  }
  // Fixing an x01 dart: the route's dart, the beds of the number it landed in, a miss, another number.
  function x01FixOptions(d) {
    if (d.kind === "spare") return [{ id: "remove", text: "Not a dart: remove it" }];
    const opts = [];
    const route = Number.isFinite(d.rem) ? checkoutRoute(d.rem, d.left || 3) : null;
    if (route && route[0]) opts.push({ id: route[0], text: `${readLabel(route[0])}: the route`, hit: route.length === 1, cur: d.label === route[0] });
    const where = Number.isFinite(d.x) && Number.isFinite(d.y) ? numberAt(d.x, d.y) : null;
    if (where === "BULL") {
      if (!opts.some((o) => o.id === "DB")) opts.push({ id: "DB", text: "Bullseye (50)", hit: d.rem === 50, cur: d.label === "DB" });
      opts.push({ id: "SB", text: "Outer bull (25)", cur: d.label === "SB" });
    } else if (where) {
      for (const [r, w] of [["T", "Triple"], ["D", "Double"], ["S", "Single"]]) {
        const id = `${r}${where}`;
        if (!opts.some((o) => o.id === id)) opts.push({ id, text: `${w} ${where}`, hit: r === "D" && d.rem === Number(where) * 2, cur: d.label === id });
      }
    }
    opts.push({ id: "MISS", text: "Missed the board", cur: d.label === "MISS" || !d.label });
    opts.push({ id: "other", text: "Another number", cur: false });
    opts.push({ id: "remove", text: "Not a dart: remove it" });
    return opts;
  }
  // Fixing a dart thrown at a double (Bob's 27): a hit, the single inside the wire, the triple, outside.
  function doubleFixOptions(d, fallbackKey) {
    if (d.kind === "spare") return [{ id: "remove", text: "Not a dart: remove it" }];
    const key = d.key || fallbackKey;
    const opts = [];
    if (key === "DBULL") {
      opts.push({ id: "DB", text: "In the bullseye: a hit", hit: true, cur: d.label === "DB" });
      opts.push({ id: "SB", text: "Outer bull (25)", cur: d.label === "SB" });
    } else if (key) {
      const n = key.slice(1);
      opts.push({ id: key, text: `In ${key}: a hit`, hit: true, cur: d.label === key });
      opts.push({ id: "S" + n, text: `Single ${n}, inside the wire`, cur: d.label === "S" + n });
      opts.push({ id: "T" + n, text: `Triple ${n}`, cur: d.label === "T" + n });
      opts.push({ id: "O" + n, text: "Outside the wire", cur: d.label === "MISS" && /Just past/.test(d.sub || "") });
    }
    const known = opts.some((o) => o.cur);
    opts.push({ id: "other", text: "Another number", cur: !known });
    opts.push({ id: "remove", text: "Not a dart: remove it" });
    return opts;
  }
  // A seeded shuffle (the random order of a drill is fixed when it starts, so every device agrees).
  function shuffled(list, seed) {
    const out = list.slice();
    let s = (Number(seed) || 1) >>> 0;
    for (let i = out.length - 1; i > 0; i -= 1) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const j = s % (i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "-");

  // ---- the drills ------------------------------------------------------------------------------------
  const BOBS27 = {
    id: "bobs27",
    version: 1,
    name: "Bob's 27",
    category: "Doubles and checkouts",
    difficulty: "Hard",
    input: "hits",
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
    scoreLabel: "Score",
    pbKey: (s) => `bobs27:${num(s.start, 27)}:${s.playOn ? "on" : "stop"}`,
    start(s) { return { score: num(s.start, 27), cursor: 0, visits: [], trail: [num(s.start, 27)], over: false, below: false }; },
    target(play) {
      if (!play || play.over || play.cursor >= DOUBLES.length) return null;
      const d = DOUBLES[play.cursor];
      return Object.assign({}, d, { lit: litFor(d), index: play.cursor, intro: `Throw at ${d.spoken}` });
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
    progress: (play) => ({ done: play.cursor || 0, of: DOUBLES.length, unit: "doubles" }),
    next(play) {
      const out = [];
      for (let i = (play.cursor || 0) + 1; i < DOUBLES.length && out.length < 3; i += 1) out.push(DOUBLES[i].big);
      return out;
    },
    capHtml: (play) => `<strong>${play.score}</strong> points · ${play.cursor || 0} of ${DOUBLES.length} doubles`,
    finishNote: (play) => (play.cursor >= DOUBLES.length ? "All 21 doubles thrown" : "Below zero: game over"),
    scoreText: (play) => String(play.score),
    visitWords: (t, rec) => `${t.label}: ${hitsWords[rec.hits].toLowerCase()}, ${rec.delta > 0 ? "+" : ""}${rec.delta}`,
    undoLabel: (t, rec) => `${t.label}: ${hitsWords[rec.hits].toLowerCase()}`,
    fixOptions: (d, view) => doubleFixOptions(d, view && view.targetKey),
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
    resultText: (res, ctx) => (res.finishedAll
      ? `All 21 doubles. ${res.hits} hits in ${res.darts} darts (${pct(res.hits, res.darts)}), ${ctx.time}.`
      : `Below zero at ${res.furthest === "DBULL" ? "the bull" : res.furthest} after ${plural(res.doublesPlayed, "double")}. ${res.hits} hits in ${res.darts} darts (${pct(res.hits, res.darts)}).`),
    facts: (res, ctx) => [
      { k: "Score", v: res.score },
      { k: "Got to", v: res.furthest === "DBULL" ? "Bull" : res.furthest || "-" },
      { k: "Hits", v: `${res.hits} / ${res.darts}` },
      { k: "Hit rate", v: pct(res.hits, res.darts) },
      { k: "Best so far", v: ctx.best ? ctx.best.key : res.score },
      { k: "Time", v: ctx.time },
    ],
    doneText: (res) => `Bob's 27: ${res.finishedAll ? "all 21 doubles" : `below zero at ${res.furthest === "DBULL" ? "the bull" : res.furthest}`}. ${res.hits} hits in ${res.darts} darts.`,
    historyColumns: [{ label: "Score", num: true }, { label: "Got to" }, { label: "Hits", num: true }],
    historyCells: (h) => {
      const r = h.result || {};
      return [h.key != null ? String(h.key) : "-", `${r.furthest === "DBULL" ? "Bull" : r.furthest || "-"}${r.finishedAll ? " ✓" : ""}`, r.darts ? `${r.hits} / ${r.darts}` : "-"];
    },
  };

  // 121 Checkout Ladder: a real countdown from the target, double out, 3 visits (9 darts) to check out.
  // A checkout moves the target up one, anything else down one (never below the floor).
  const newAttempt = (level) => ({ target: level, remaining: level, visits: 0, darts: 0, log: [] });
  const LADDER = {
    id: "ladder121",
    version: 1,
    name: "121 Checkout Ladder",
    category: "Doubles and checkouts",
    difficulty: "Hard",
    input: "darts",
    blurb: "Check out the target in 9 darts, double out. A checkout moves the target up one, anything else moves it down one.",
    why: "Finishing is where legs are won. The ladder puts you on a real finish with a real clock of 9 darts, shows the route at every dart, and settles at the number you can actually take out.",
    rules: [
      "You start on 121 (or the target you set). Count down from it with up to 3 visits of 3 darts, double out, like the end of a leg.",
      "A bust (below zero, one left, or zero without a double) puts you back to the score at the start of that visit, and the visit is over.",
      "Check out and the target goes up by one. Run out of darts and it goes down by one, never below the floor you set. A round is a set number of targets.",
      "The route is shown at every dart. It comes from the same solver as the bot game, with your own preferred routes first.",
      "With the cameras on, a visit is the darts since you last pulled them out, up to 3. A checkout or a bust ends the visit: darts after it before the take-out do not count. Darts the cameras did not see when you pull them out are misses (no score).",
      "By hand: tap the board where the dart landed, or the route's dart or Miss. Tap a dart on the board or in its box to fix what the cameras read. Undo goes back one visit at a time, up to 10, from any device.",
    ],
    settings: [
      { key: "start", label: "Starting target", type: "number", default: 121, min: 2, max: 170, step: 1, help: "The classic ladder starts on 121." },
      { key: "floor", label: "Lowest target", type: "number", default: 100, min: 2, max: 170, step: 1, help: "The target never drops below this. The classic floor is 100; at a 20% double rate you will spend most of a round there, so a lower floor (61) keeps the finishes varied." },
      { key: "visits", label: "Visits per target", type: "number", default: 3, min: 1, max: 3, step: 1, help: "3 visits is 9 darts, the classic. 2 is a hard drill, 1 a brutal one." },
      { key: "attempts", label: "Targets in a round", type: "number", default: 10, min: 3, max: 30, step: 1, help: "A round is this many targets, checked out or not. About 2 minutes each with the cameras." },
    ],
    keyMetric: { id: "highest", label: "Highest target", better: "higher" },
    scoreLabel: "Target",
    pbKey: (s) => `ladder121:${num(s.start, 121)}:${num(s.floor, 100)}:${num(s.visits, 3)}:${num(s.attempts, 10)}`,
    start(s) {
      const start = num(s.start, 121), floor = Math.min(num(s.floor, 100), start);
      return { level: start, start, floor, maxVisits: num(s.visits, 3), maxAttempts: num(s.attempts, 10), highest: start, attempt: newAttempt(start), attempts: [], outs: 0, darts: 0, dartsAtDouble: 0, doublesHit: 0, trail: [start], over: false };
    },
    target(play) {
      if (!play || play.over || !play.attempt) return null;
      const a = play.attempt;
      const route = checkoutRoute(a.remaining, 3);
      return {
        key: `A${play.attempts.length + 1}`, big: String(a.remaining), label: "You require", heroLabel: "You require",
        spoken: `You require ${a.remaining}`, intro: `You require ${a.remaining}. ${route ? route.map(speakLabel).join(", ") : "No finish in 3"}`,
        number: null, value: a.remaining, remaining: a.remaining, hitLabel: null, route, lit: routeLit(route),
        level: a.target, visitsLeft: play.maxVisits - a.visits, index: play.attempts.length,
      };
    },
    dartEffect(play, t, dart, i, soFar) {
      const e = x01Effect(t.key, t.remaining - sumPts(soFar), dart.l);
      e.left = 3 - i;
      return e;
    },
    applyVisit(play, t, visit) {
      const effects = visit.effects || [];
      const a = play.attempt;
      const out = effects.some((e) => e && e.out), bust = effects.some((e) => e && e.kind === "bust");
      const scored = bust ? 0 : sumPts(effects);
      const before = a.remaining;
      a.remaining = bust ? before : before - scored;
      a.visits += 1;
      a.darts += effects.length;
      play.darts += effects.length;
      play.dartsAtDouble += effects.filter((e) => e && e.onDouble).length;
      if (out) play.doublesHit += 1;
      const rec = { target: a.target, before, after: a.remaining, scored, bust, out, darts: effects.length, visit: a.visits, done: false, level: play.level, attemptDarts: a.darts };
      a.log.push({ before, after: a.remaining, scored, bust, out, darts: effects.length });
      if (out || a.visits >= play.maxVisits) {
        rec.done = true;
        play.attempts.push({ target: a.target, out, visits: a.visits, darts: a.darts, remaining: a.remaining });
        if (out) { play.outs += 1; play.level = Math.min(170, play.level + 1); } else play.level = Math.max(play.floor, play.level - 1);
        play.highest = Math.max(play.highest, play.level);
        play.trail.push(play.level);
        rec.level = play.level;
        if (play.attempts.length >= play.maxAttempts) { play.over = true; play.attempt = null; } else play.attempt = newAttempt(play.level);
      }
      return rec;
    },
    isOver: (play) => !!(play && play.over),
    summarize(play) {
      const perNumber = {};
      let bestOut = null;
      for (const a of play.attempts) {
        const p = perNumber[a.target] || (perNumber[a.target] = { tries: 0, outs: 0 });
        p.tries += 1;
        if (a.out) { p.outs += 1; if (!bestOut || a.darts < bestOut.darts || (a.darts === bestOut.darts && a.target > bestOut.target)) bestOut = { target: a.target, darts: a.darts }; }
      }
      return {
        highest: play.highest, level: play.level, start: play.start, floor: play.floor,
        attempts: play.attempts.length, outs: play.outs, outRate: play.attempts.length ? play.outs / play.attempts.length : 0,
        darts: play.darts, dartsAtDouble: play.dartsAtDouble, doublesHit: play.doublesHit,
        perNumber, bestOut, trail: play.trail.slice(),
      };
    },
    cells(play, t) {
      const out = [];
      for (let i = 0; i < play.maxAttempts; i += 1) {
        const a = play.attempts[i];
        if (a) out.push({ key: `a${i}`, num: String(a.target), state: a.out ? "done h3" : "done h0", sub: a.out ? `${a.darts} darts` : `${a.remaining} left`, title: a.out ? `${a.target}: checked out in ${a.darts} darts` : `${a.target}: not out, ${a.remaining} left` });
        else if (play.attempt && i === play.attempts.length) out.push({ key: `a${i}`, num: String(play.attempt.target), state: "current", sub: t ? `${plural(t.visitsLeft, "visit")} left` : "", title: `${play.attempt.target}: now` });
        else out.push({ key: `a${i}`, num: "·", state: "todo", sub: "", title: `Target ${i + 1}` });
      }
      return out;
    },
    cols: (play) => Math.min(play.maxAttempts, 10),
    progress: (play) => ({ done: play.attempts.length, of: play.maxAttempts, unit: "targets" }),
    next: (play, t) => (t && t.route ? t.route.map(readLabel) : []),
    nextLabel: (play, t) => (t && t.route ? "Route" : t && t.remaining <= 170 ? "No finish in 3" : ""),
    // Mid-visit: the remaining after the darts so far, and the route for the darts left.
    live(play, t, effects) {
      const rem = t.remaining - sumPts(effects), left = 3 - effects.length;
      const route = left > 0 ? checkoutRoute(rem, left) : null;
      return { big: String(rem), next: route ? route.map(readLabel) : [], nextLabel: route ? "Route" : rem <= 170 && left > 0 ? `No finish in ${left}` : "", nextClass: "co", lit: routeLit(route), pad: route ? route.slice() : [] };
    },
    capHtml: (play) => `<strong>${play.outs}</strong> of ${play.attempts.length} checked out · highest ${play.highest}`,
    finishNote: (play) => `Highest target ${play.highest}`,
    scoreText: (play) => String(play.attempt ? play.attempt.target : play.level),
    dartWords: (d) => x01Words(d),
    fixOptions: (d) => x01FixOptions(d),
    visitWords: (t, rec) => (rec.out ? `${rec.target}: game shot in ${rec.attemptDarts} darts, up to ${rec.level}` : rec.bust ? `Bust, back to ${rec.after}${rec.done ? `. Down to ${rec.level}` : ""}` : `${rec.scored} scored, ${rec.after} left${rec.done ? `. Down to ${rec.level}` : ""}`),
    undoLabel: (t, rec) => `${rec.target}: ${rec.out ? "game shot" : rec.bust ? "bust" : `${rec.scored} scored`}`,
    // "Game shot. 121 in 7 darts. Up to 122." / "Bust. You require 121." / "60. You require 61." / "Not this time. Down to 120."
    voiceLine({ visit, play, over }) {
      const parts = [];
      if (visit.out) parts.push("Game shot", `${visit.target} in ${visit.attemptDarts} darts`);
      else if (visit.bust) parts.push("Bust", visit.done ? "" : `You require ${visit.after}`);
      else parts.push(String(visit.scored), visit.done ? "" : `You require ${visit.after}`);
      if (visit.done && !visit.out) parts.push("Not this time");
      if (over) parts.push(`Done. Highest ${play.highest}`);
      else if (visit.done) parts.push(`${visit.out ? "Up" : "Down"} to ${visit.level}`);
      return parts.filter(Boolean).join(". ") + ".";
    },
    moment({ visit, play, over, before }) {
      if (visit.out && visit.level > (before.highest || 0)) return { big: `Up to ${visit.level}`, sub: `${visit.target} in ${visit.attemptDarts} darts: a new high`, kind: "win" };
      if (visit.out) return { big: "Game shot", sub: `${visit.target} in ${visit.attemptDarts} darts. Up to ${visit.level}`, kind: "win" };
      if (over) return { big: `Highest ${play.highest}`, sub: `${play.outs} of ${play.attempts.length} checked out`, kind: "finish" };
      return null;
    },
    paceText(play, best) {
      const trail = best && best.result && Array.isArray(best.result.trail) ? best.result.trail : null;
      const i = play.trail.length - 1;
      if (!trail || i < 1 || trail.length <= i) return null;
      const diff = play.trail[i] - trail[i];
      return diff > 0 ? `+${diff} on your best` : diff < 0 ? `${diff} on your best` : "Level with your best";
    },
    resultText: (res, ctx) => `Highest target ${res.highest}, finishing on ${res.level}. ${res.outs} of ${res.attempts} checked out, ${res.doublesHit} of ${res.dartsAtDouble} darts at a double (${pct(res.doublesHit, res.dartsAtDouble)}), ${ctx.time}.`,
    facts: (res, ctx) => [
      { k: "Highest", v: res.highest },
      { k: "Finished on", v: res.level },
      { k: "Checked out", v: `${res.outs} / ${res.attempts}` },
      { k: "At a double", v: `${res.doublesHit} / ${res.dartsAtDouble}` },
      { k: "Best out", v: res.bestOut ? `${res.bestOut.target} in ${res.bestOut.darts}` : "-" },
      { k: "Best so far", v: ctx.best ? ctx.best.key : res.highest },
      { k: "Time", v: ctx.time },
    ],
    doneText: (res) => `121 Checkout Ladder: highest ${res.highest}, finished on ${res.level}. ${res.outs} of ${res.attempts} checked out.`,
    historyColumns: [{ label: "Highest", num: true }, { label: "Finished on", num: true }, { label: "Checked out", num: true }],
    historyCells: (h) => {
      const r = h.result || {};
      return [h.key != null ? String(h.key) : "-", r.level != null ? String(r.level) : "-", r.attempts ? `${r.outs} / ${r.attempts}` : "-"];
    },
  };

  // Two-Dart Finishes: every number in a range, two darts each. A try is scored in parts: the setup
  // (did the first dart leave a double?), the double (was it hit?), the finish.
  const TWODART = {
    id: "twodart",
    version: 1,
    name: "Two-Dart Finishes",
    category: "Doubles and checkouts",
    difficulty: "Very hard",
    input: "darts",
    blurb: "Every finish from 61 to 70, two darts each: a setup dart and the double. Scored in parts, so progress shows even when the finish does not.",
    why: "These are the finishes that decide close legs: a triple or a big single, then a double. Each try is scored in parts (setup hit, double hit, finish), so you can see the setup rate climb before the finishes do.",
    rules: [
      "Each number in the range gets exactly two darts: in order, or shuffled. A round is the range once (or more times, in the settings).",
      "The route is shown before the first dart and again after it, for what is left. A first dart that leaves a double is a setup hit; the second dart is at that double.",
      "A try is a finish, a setup hit with the double missed, or a setup missed. The rates for each are kept, for every number.",
      "With the cameras on, a try is the darts since you last pulled them out, up to 2. A third dart before the take-out does not count, and pulling the darts out ends the try: a dart the cameras did not see is a miss.",
      "By hand: tap the board where the dart landed, or the route's dart or Miss. Tap a dart on the board or in its box to fix what the cameras read. Undo goes back one try at a time, up to 10, from any device.",
    ],
    settings: [
      { key: "from", label: "From", type: "number", default: 61, min: 2, max: 170, step: 1 },
      { key: "to", label: "To", type: "number", default: 70, min: 2, max: 170, step: 1, help: "61 to 70 is the classic set: every one needs a setup and a double." },
      { key: "order", label: "Order", type: "choice", default: "up", options: [{ value: "up", label: "In order" }, { value: "random", label: "Shuffled" }] },
      { key: "rounds", label: "Times through the range", type: "number", default: 1, min: 1, max: 5, step: 1, help: "10 numbers once is about 20 darts: 3 minutes with the cameras." },
    ],
    keyMetric: { id: "outs", label: "Finishes", better: "higher" },
    scoreLabel: "Finishes",
    pbKey: (s) => { const a = Math.min(num(s.from, 61), num(s.to, 70)), b = Math.max(num(s.from, 61), num(s.to, 70)); return `twodart:${a}:${b}:${num(s.rounds, 1)}`; },
    start(s, now) {
      const from = Math.min(num(s.from, 61), num(s.to, 70)), to = Math.max(num(s.from, 61), num(s.to, 70));
      const range = [];
      for (let n = from; n <= to; n += 1) range.push(n);
      let queue = [];
      for (let r = 0; r < num(s.rounds, 1); r += 1) queue = queue.concat(range);
      if (s.order === "random") queue = shuffled(queue, now || 1);
      return { queue, cursor: 0, tries: [], outs: 0, setups: 0, darts: 0, from, to, trail: [0], over: false };
    },
    dartsPerVisit: () => 2,
    target(play) {
      if (!play || play.over || play.cursor >= play.queue.length) return null;
      const n = play.queue[play.cursor];
      const route = checkoutRoute(n, 2);
      return {
        key: `N${n}.${play.cursor}`, big: String(n), label: "Finish", heroLabel: "Finish", spoken: String(n),
        intro: `${n}. ${route ? route.map(speakLabel).join(", ") : "No two-dart finish"}`,
        number: null, value: n, remaining: n, hitLabel: null, route, lit: routeLit(route), index: play.cursor,
      };
    },
    dartEffect(play, t, dart, i, soFar) {
      const e = x01Effect(t.key, t.remaining - sumPts(soFar), dart.l);
      e.left = 2 - i;
      if (i === 0 && e.kind === "score") e.setup = canDouble(e.after);
      if (i >= 1) { if (!e.out) { e.kind = "miss"; e.pts = 0; e.after = e.rem; } e.ends = true; }
      return e;
    },
    applyVisit(play, t, visit) {
      const effects = visit.effects || [];
      const d1 = effects[0] || null;
      const out = effects.some((e) => e && e.out);
      const setup = !!(d1 && d1.setup);
      const rec = { n: t.remaining, out, setup, left: d1 ? d1.after : t.remaining, labels: (visit.darts || []).map((x) => x.l || "MISS"), darts: effects.length, index: play.cursor };
      play.tries.push(rec);
      play.cursor += 1;
      play.darts += effects.length;
      if (out) play.outs += 1;
      if (setup) play.setups += 1;
      play.trail.push(play.outs);
      if (play.cursor >= play.queue.length) play.over = true;
      return rec;
    },
    isOver: (play) => !!(play && play.over),
    summarize(play) {
      const perNumber = {};
      for (const tr of play.tries) {
        const p = perNumber[tr.n] || (perNumber[tr.n] = { tries: 0, outs: 0, setups: 0 });
        p.tries += 1;
        if (tr.out) p.outs += 1;
        if (tr.setup) p.setups += 1;
      }
      const tries = play.tries.length;
      return {
        outs: play.outs, tries, setups: play.setups, doublesHit: play.tries.filter((x) => x.setup && x.out).length,
        finishRate: tries ? play.outs / tries : 0, setupRate: tries ? play.setups / tries : 0, doubleRate: play.setups ? play.tries.filter((x) => x.setup && x.out).length / play.setups : 0,
        darts: play.darts, from: play.from, to: play.to, numbers: play.queue.length, perNumber, trail: play.trail.slice(),
      };
    },
    cells(play, t) {
      return play.queue.map((n, i) => {
        const tr = play.tries[i];
        if (tr) return { key: `n${i}`, num: String(n), state: tr.out ? "done h3" : tr.setup ? "done h1" : "done h0", sub: tr.out ? "in" : tr.setup ? `${doubleFor(tr.left)} no` : "setup no", title: tr.out ? `${n}: finished (${tr.labels.join(" ")})` : tr.setup ? `${n}: left ${tr.left}, missed ${doubleFor(tr.left)}` : `${n}: setup missed (${tr.labels.join(" ")})` };
        if (t && i === play.cursor) return { key: `n${i}`, num: String(n), state: "current", sub: t.route ? t.route.map(readLabel).join(" ") : "", title: `${n}: now` };
        return { key: `n${i}`, num: String(n), state: "todo", sub: "", title: String(n) };
      });
    },
    cols: (play) => Math.min(play.queue.length, 10),
    progress: (play) => ({ done: play.cursor, of: play.queue.length, unit: "finishes" }),
    next: (play, t) => (t && t.route ? t.route.map(readLabel) : []),
    nextLabel: (play, t) => (t && t.route ? "Route" : "No two-dart finish"),
    live(play, t, effects) {
      const rem = t.remaining - sumPts(effects), left = 2 - effects.length;
      const route = left > 0 ? checkoutRoute(rem, left) : null;
      return { big: String(rem), label: effects.length ? "Left" : "Finish", next: route ? route.map(readLabel) : [], nextLabel: route ? "Route" : left > 0 ? "No finish" : "", nextClass: "co", lit: routeLit(route), pad: route ? route.slice() : [] };
    },
    capHtml: (play) => `<strong>${play.outs}</strong> of ${play.tries.length} finished · ${play.setups} setups`,
    finishNote: (play) => `${play.outs} of ${play.tries.length} finished`,
    scoreText: (play) => `${play.outs} of ${play.tries.length}`,
    dartWords: (d) => x01Words(d),
    fixOptions: (d) => x01FixOptions(d),
    visitWords: (t, rec) => (rec.out ? `${rec.n}: finished` : rec.setup ? `${rec.n}: setup hit, left ${rec.left}, ${doubleFor(rec.left)} missed` : `${rec.n}: setup missed`),
    undoLabel: (t, rec) => `${rec.n}: ${rec.out ? "finished" : rec.setup ? "double missed" : "setup missed"}`,
    // "61. Game shot." / "61. Left D 8. Missed." / "61. Setup missed." then "Next, 62." or "Done. 3 finishes."
    voiceLine({ visit, play, next, over }) {
      const parts = [String(visit.n)];
      if (visit.out) parts.push("Game shot");
      else if (visit.setup) parts.push(`Left ${speakLabel(doubleFor(visit.left))}`, "Missed");
      else parts.push("Setup missed");
      if (over) parts.push(`Done. ${plural(play.outs, "finish").replace("finishs", "finishes")}`);
      else if (next) parts.push(`Next, ${next.spoken}`);
      return parts.join(". ") + ".";
    },
    moment({ visit, play, over }) {
      if (visit.out) return { big: "Game shot", sub: `${visit.n}: ${visit.labels.map(readLabel).join(" ")}`, kind: "win" };
      if (over) return { big: `${play.outs} of ${play.tries.length}`, sub: `finished. ${play.setups} setups hit`, kind: "finish" };
      return null;
    },
    paceText(play, best) {
      const trail = best && best.result && Array.isArray(best.result.trail) ? best.result.trail : null;
      const i = play.trail.length - 1;
      if (!trail || i < 1 || trail.length <= i) return null;
      const diff = play.trail[i] - trail[i];
      return diff > 0 ? `+${diff} on your best` : diff < 0 ? `${diff} on your best` : "Level with your best";
    },
    resultText: (res, ctx) => `${res.outs} of ${res.tries} finished (${pct(res.outs, res.tries)}). Setup hit ${res.setups} times (${pct(res.setups, res.tries)}); on a double, ${res.doublesHit} of ${res.setups} went in (${pct(res.doublesHit, res.setups)}). ${ctx.time}.`,
    facts: (res, ctx) => [
      { k: "Finishes", v: `${res.outs} / ${res.tries}` },
      { k: "Setup hit", v: pct(res.setups, res.tries) },
      { k: "Double hit", v: `${res.doublesHit} / ${res.setups}` },
      { k: "Darts", v: res.darts },
      { k: "Best so far", v: ctx.best ? ctx.best.key : res.outs },
      { k: "Time", v: ctx.time },
    ],
    doneText: (res) => `Two-Dart Finishes ${res.from} to ${res.to}: ${res.outs} of ${res.tries} finished, ${res.setups} setups hit.`,
    historyColumns: [{ label: "Finishes", num: true }, { label: "Setups", num: true }, { label: "Range" }],
    historyCells: (h) => {
      const r = h.result || {};
      return [r.tries != null ? `${h.key} / ${r.tries}` : h.key != null ? String(h.key) : "-", r.tries ? `${r.setups} / ${r.tries}` : "-", r.from != null ? `${r.from} to ${r.to}` : "-"];
    },
  };

  const DRILLS = [BOBS27, LADDER, TWODART];
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
  // A drill's settings in a line ("start 27 · Play on below zero").
  const settingsText = (drill, s) => (drill.settings || []).filter((x) => x.type !== "boolean" || s[x.key]).map((x) => (x.type === "boolean" ? x.label : x.type === "choice" ? ((x.options.find((o) => o.value === s[x.key]) || {}).label || s[x.key]) : `${x.label.toLowerCase()} ${s[x.key]}`)).join(" · ");

  // ---- a session ------------------------------------------------------------------------------------
  const freshCam = (seq) => ({ seq: seq || 0, visit: null });

  function newSession(drillId, settings, now, sessionKey) {
    const d = drillOf(drillId);
    if (!d) return null;
    const s = cleanSettings(d, settings);
    return {
      meta: { startedAtMs: now, sessionKey: sessionKey || null, drill: d.id, drillVersion: d.version, settings: s },
      timer: PT.start(now),
      play: d.start(s, now),
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
  const dartsPerVisit = (d, play, t) => (d.dartsPerVisit ? d.dartsPerVisit(play, t) : 3);
  // How far a drill has got: { done, of, unit }.
  const progress = (sess) => (sess ? drillFor(sess).progress(sess.play) : { done: 0, of: 0, unit: "" });

  function snapshotFor(sess) {
    return { play: clone(sess.play), throws: sess.throws.length, visitNo: sess.visitNo || 0, finishedAt: sess.finishedAt || null };
  }
  function restore(sess, cp) {
    sess.play = clone(cp.play);
    sess.throws = sess.throws.slice(0, cp.throws);
    sess.visitNo = cp.visitNo || 0;
    sess.finishedAt = cp.finishedAt || null;
  }

  // A throw as it is saved: the tracker's shape (t, r, l, x, y, seq, src) plus the target key, the visit,
  // and what it did (h: a hit, p: the points it scored in an x01 drill).
  function throwOf(dart, t, effect, visitNo, src) {
    const p = parseLabel(dart.l);
    const o = { v: visitNo, t: t.number == null ? String(t.remaining != null ? t.remaining : t.big || "") : t.number, k: t.key, r: p.ring || "-", l: p.ring ? p.label : dart.l === "MISS" ? "MISS" : "", src: src || dart.src || (dart.b ? "btn" : "cam") };
    if (Number.isFinite(dart.x) && Number.isFinite(dart.y)) { o.x = round4(dart.x); o.y = round4(dart.y); }
    if (dart.s) o.seq = dart.s;
    if (dart.f) o.f = 1;
    if (effect && effect.kind === "hit") o.h = 1;
    if (effect && Number.isFinite(effect.pts) && effect.kind !== "hit") o.p = effect.pts;
    else if (effect && effect.out) o.p = effect.pts;
    return o;
  }

  // Scores one visit of darts ({ l, x, y, s, f, b, src }) at the current target: each dart's effect is
  // worked out in order (a checkout or a bust ends the visit, so darts after it aren't counted), then
  // the drill applies the visit. Returns { visit, target, hits, effects, over, moment, line } or { error }.
  function scoreVisit(sess, darts, now) {
    const d = drillFor(sess);
    const t = d.target(sess.play);
    if (!t) return { error: "The drill is finished." };
    const effects = [], used = [];
    for (let i = 0; i < darts.length; i += 1) {
      if (effects.some((e) => e && e.ends)) break;
      const e = d.dartEffect(sess.play, t, darts[i], i, effects);
      effects.push(e);
      used.push(Object.assign({}, darts[i], { e }));
    }
    const hits = effects.filter((e) => e && e.kind === "hit").length;
    const before = clone(sess.play);
    const visit = d.applyVisit(sess.play, t, { hits, effects, darts: used }, sess.meta.settings);
    sess.visitNo = (sess.visitNo || 0) + 1;
    used.forEach((x, i) => { sess.throws.push(throwOf(x, t, effects[i], sess.visitNo, x.src)); });
    if (sess.throws.length > MAX_THROWS) sess.throws.splice(0, sess.throws.length - MAX_THROWS);
    PT.activity(sess.timer, now);
    const over = d.isOver(sess.play);
    if (over) { sess.finishedAt = now; PT.pause(sess.timer, now); }
    const next = d.target(sess.play);
    const ctx = { before, play: sess.play, target: t, visit, effects, settings: sess.meta.settings, over, next };
    const line = d.voiceLine ? d.voiceLine(ctx) : null;
    if (line) sess.say = { n: ((sess.say && sess.say.n) || 0) + 1, text: line };
    return { visit, target: t, hits, effects, over, moment: d.moment ? d.moment(ctx) : null, line, words: d.visitWords ? d.visitWords(t, visit) : "", undoLabel: d.undoLabel ? d.undoLabel(t, visit) : `${t.label}: visit` };
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
    const d = drillFor(sess);
    if ((d.input || "hits") !== "hits") return { error: "This drill takes one dart at a time: tap the board where it landed, or the route's dart or Miss." };
    const n = Number(hits);
    if (!Number.isInteger(n) || n < 0 || n > 3) return { error: "Hits must be 0 to 3." };
    const t = target(sess);
    if (!t) return { error: "The drill is finished." };
    const cp = snapshotFor(sess);
    const darts = Array.from({ length: 3 }, (_, i) => ({ l: i < n ? t.hitLabel : "", src: "btn" }));
    const r = scoreVisit(sess, darts, now);
    if (r.error) return r;
    pushUndo(u, sess, cp, r.undoLabel);
    sess.cam = freshCam((sess.cam && sess.cam.seq) || 0); // the cameras' darts held for this visit are dropped
    return Object.assign(r, { message: `${r.words}. ${r.over ? "Done." : `Now ${target(sess).big}.`}` });
  }

  // ---- the darts, from the cameras or by hand ----------------------------------------------------------
  const visitComplete = (v) => !!v && (v.ended || v.darts.length >= (v.max || 3));
  // A visit entered wholly by hand has no take-out coming from the cameras: the next dart by hand
  // starts the next visit.
  const allByHand = (v) => !!v && v.darts.length > 0 && v.darts.every((x) => x.b);
  const awaitingTakeout = (v) => !!v && !v.out && visitComplete(v) && !allByHand(v);
  // One dart: { seq, label, x, y } on the app board, from the cameras (src "cam") or by hand (src
  // "btn"). Returns null when it was already counted (another device got it in first), else
  // { effect, scored, message }.
  function addDart(u, sess, dart, src, now) {
    if (!sess || !dart) return null;
    const cam = sess.cam || (sess.cam = freshCam(0));
    if (src === "cam" && dart.seq && dart.seq <= (cam.seq || 0)) return null;
    if (src === "cam" && dart.seq) cam.seq = dart.seq;
    const label = parseLabel(dart.label).label;
    const who = src === "cam" ? "Camera" : "By hand";
    const d = drillFor(sess);
    const t = d.target(sess.play);
    if (!t || isFinished(sess)) return { effect: { kind: "ignored" }, message: "The drill is finished." };
    if (isPaused(sess, now)) return { effect: { kind: "ignored" }, message: `${who}: ${describe(label)}, but the drill is paused.` };
    let v = cam.visit;
    if (v && !v.out && visitComplete(v)) {
      if (src !== "cam" && allByHand(v)) v.out = { darts: v.darts.length, unseen: 0 }; // by hand throughout: on to the next visit
      else return { effect: { kind: "spare", key: v.t.key }, message: `${who}: ${describe(label)}, not counted. That visit was over: pull your darts out.` };
    }
    if (!v || v.out) {
      v = cam.visit = { n: ((v && v.n) || 0) + 1, cp: snapshotFor(sess), t: { key: t.key, label: t.label, big: t.big, number: t.number, value: t.value, remaining: t.remaining == null ? null : t.remaining, hitLabel: t.hitLabel }, max: dartsPerVisit(d, sess.play, t), ended: false, darts: [], out: null };
    }
    const soFar = v.darts.map((x) => x.e);
    const e = d.dartEffect(sess.play, t, { l: label, x: dart.x, y: dart.y }, v.darts.length, soFar);
    const rec = { s: src === "cam" ? dart.seq || 0 : 0, l: label, x: round4(dart.x), y: round4(dart.y), e };
    if (src !== "cam") rec.b = 1;
    v.darts.push(rec);
    if (e && e.ends) v.ended = true;
    let scored = null;
    if (visitComplete(v)) {
      scored = scoreVisit(sess, v.darts.map((x) => Object.assign({ src: x.b ? "btn" : "cam" }, x)), now);
      pushUndo(u, sess, v.cp, scored.undoLabel);
    }
    const what = e.kind === "hit" ? `${describe(label)}: ${e.out ? "game shot" : "a hit"}` : e.kind === "bust" ? `${describe(label)}: bust` : describe(label);
    const message = scored
      ? `${who}: ${what}. ${scored.words}. ${scored.over ? "Done." : `Pull your darts out, then ${target(sess).big}.`}`
      : `${who}: ${what} (dart ${v.darts.length} of ${v.max} at ${t.big}).`;
    return { effect: e, scored, message };
  }
  const cameraDart = (u, sess, dart, now) => addDart(u, sess, dart, "cam", now);
  // A dart by hand: a button for a label ("T20", "MISS") or a tap on the board ({ label, x, y }).
  function manualDart(u, sess, dart, now) {
    if (!sess) return { error: "Start a drill first." };
    if (isFinished(sess)) return { error: "The drill is finished. Use Undo to take the last visit back." };
    if (isPaused(sess, now)) return { error: "The drill is paused. Resume it first." };
    const d = drillFor(sess);
    if ((d.input || "hits") === "hits") return { error: "This drill takes the hits of the visit: tap how many darts went in." };
    const label = typeof dart === "string" ? dart : dart && dart.label;
    const p = parseLabel(label);
    const sp = p.ring ? spot(p.label) : { x: 0, y: -1.2 };
    const r = addDart(u, sess, { seq: 0, label: p.label, x: dart && Number.isFinite(dart.x) ? dart.x : sp.x, y: dart && Number.isFinite(dart.y) ? dart.y : sp.y }, "btn", now);
    if (!r) return { error: "That dart was already in." };
    if (r.effect && r.effect.kind === "spare") return { error: r.message };
    return r;
  }

  // Darts pulled out: the visit ends. Fewer than its darts seen and the visit not ended by a checkout
  // or a bust: the ones the cameras didn't see are misses at this visit's target. Returns null when
  // already in, else { scored, unseen, message }.
  function cameraTakeout(u, sess, e, now) {
    if (!sess || !e) return null;
    const cam = sess.cam || (sess.cam = freshCam(0));
    if (e.seq && e.seq <= (cam.seq || 0)) return null;
    if (e.seq) cam.seq = e.seq;
    const v = cam.visit;
    if (!v || v.out) return { scored: null, unseen: 0, message: "Darts out." };
    if (visitComplete(v)) { v.out = { darts: num(e.darts, 0), unseen: 0 }; return { scored: null, unseen: 0, message: "Darts out." }; }
    if (isFinished(sess) || isPaused(sess, now)) { v.out = { darts: num(e.darts, 0), unseen: 0 }; return { scored: null, unseen: 0, message: "Darts out." }; }
    const unseen = (v.max || 3) - v.darts.length;
    v.out = { darts: num(e.darts, 0), unseen };
    const darts = v.darts.map((x) => Object.assign({ src: x.b ? "btn" : "cam" }, x)).concat(Array.from({ length: unseen }, () => ({ l: "", src: "unseen" })));
    const scored = scoreVisit(sess, darts, now);
    pushUndo(u, sess, v.cp, scored.undoLabel);
    return { scored, unseen, message: `Darts out: ${plural(unseen, "dart")} the cameras didn't see counted as missed. ${scored.words}.` };
  }

  // Dart `index` of the visit on the board (its seq must still be `seq`) was really fix = { label, x, y },
  // or wasn't a dart at all (fix.remove). The visit is scored again from just before its first dart, by
  // the same rules: a dart after a checkout or a bust no longer counts, and one that did become live
  // counts again. Returns { error } or { changed, scored, message }.
  function fixDart(u, sess, index, seq, fix, now) {
    const v = sess && sess.cam && sess.cam.visit;
    const d0 = v && v.darts[index];
    if (!d0 || (d0.s || 0) !== (seq || 0)) return { error: "That visit can't be changed any more. Use Undo, then tap what happened." };
    if (isPaused(sess, now)) return { error: "The drill is paused. Resume it first." };
    const d = drillFor(sess);
    const wasScored = visitComplete(v) || !!v.out;
    const darts = v.darts.map((x) => clone(x));
    if (fix.remove) darts.splice(index, 1);
    else Object.assign(darts[index], { l: parseLabel(fix.label).label, x: round4(fix.x), y: round4(fix.y), f: 1 });
    // Back to just before the visit's first dart...
    restore(sess, v.cp);
    const t = d.target(sess.play);
    if (!t) return { error: "The drill is finished." };
    // ...and through its darts again, as the cameras would have read them.
    const live = [];
    let ended = false;
    darts.forEach((x, i) => {
      if (ended) { x.e = { kind: "spare", key: t.key }; return; }
      x.e = d.dartEffect(sess.play, t, x, live.length, live.map((y) => y.e));
      live.push(x);
      if (x.e && x.e.ends) ended = true;
    });
    const max = v.max || 3;
    let scored = null, out = v.out ? Object.assign({}, v.out) : null;
    const asDarts = (list) => list.map((x) => Object.assign({ src: x.b ? "btn" : "cam" }, x));
    if (ended || live.length >= max) scored = scoreVisit(sess, asDarts(live.slice(0, max)), now);
    else if (out) {
      out.unseen = max - live.length;
      scored = scoreVisit(sess, asDarts(live).concat(Array.from({ length: out.unseen }, () => ({ l: "", src: "unseen" }))), now);
    }
    sess.cam.visit = { n: v.n, cp: v.cp, t: v.t, max, ended, darts, out };
    // The undo step for this visit: still right when the visit is still scored, gone when it isn't.
    const s = undoStackOf(u).filter((x) => x.startedAtMs === sess.meta.startedAtMs);
    if (wasScored && !scored) { s.pop(); u.undoStack = s; }
    else if (scored && !wasScored) pushUndo(u, sess, v.cp, scored.undoLabel);
    else if (scored && s.length) { s[s.length - 1].label = scored.undoLabel; u.undoStack = s; }
    const changed = fix.remove || d0.l !== parseLabel(fix.label).label;
    const message = fix.remove ? `Dart ${index + 1} taken out: it wasn't a dart.` : `Fixed dart ${index + 1}: ${describe(parseLabel(fix.label).label)}${scored ? `. ${scored.words}.` : "."}`;
    return { changed, scored, message };
  }

  // ---- what the board shows ------------------------------------------------------------------------------
  // What a dart of the visit counted as, in words: { read, sub, kind }. Drills with their own words
  // (the x01 ones) say; the rest is the "thrown at a double" reading.
  function dartWords(d, t, drill) {
    if (drill && drill.dartWords) {
      if (d.e && d.e.kind === "spare") return { read: readLabel(d.l), sub: "Not counted: the visit was over", kind: "spare" };
      return drill.dartWords(d, t);
    }
    const e = d.e || {};
    const p = parseLabel(d.l);
    if (d.src === "btn" || d.b || (!d.l && !Number.isFinite(d.x))) return e.kind === "hit" ? { read: "Hit", sub: "Entered by hand", kind: "hit" } : { read: "Miss", sub: "Entered by hand", kind: "miss" };
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

  // The buttons for entering by hand, for the drill's input: the hits (0 to 3) or the route's darts and
  // Miss. Every button of the pad, with hidden/disabled, so Board mode and the page show the same.
  function padFor(sess) {
    const d = sess ? drillFor(sess) : null;
    const hits = !d || (d.input || "hits") === "hits";
    const t = sess ? d.target(sess.play) : null;
    const v = sess && sess.cam ? sess.cam.visit : null;
    const open = v && !v.out && !visitComplete(v) ? v : null;
    const waiting = awaitingTakeout(v) || !t || (sess && isFinished(sess));
    const live = !hits && t && d.live ? d.live(sess.play, t, open ? open.darts.map((x) => x.e) : []) : null;
    const route = live ? live.pad || [] : [];
    const pad = [
      { man: "h0", text: "No hits", cls: "m", hidden: !hits },
      { man: "h1", text: "1 hit", hidden: !hits },
      { man: "h2", text: "2 hits", hidden: !hits },
      { man: "h3", text: "3 hits", hidden: !hits },
    ];
    for (let i = 0; i < 3; i += 1) pad.push({ man: `p${i + 1}`, text: route[i] ? readLabel(route[i]) : "", label: route[i] || null, hidden: hits || !route[i], disabled: waiting });
    pad.push({ man: "pm", text: "Miss", cls: "m", label: "MISS", hidden: hits, disabled: waiting });
    return pad;
  }

  // The view Board mode draws (board-mode.js): the target, this visit's darts, the strip, the caption.
  function boardView(sess, ctx) {
    if (!sess) return null;
    const d = drillFor(sess);
    const t = d.target(sess.play);
    const cam = sess.cam || freshCam();
    const v = cam.visit;
    const open = v && !v.out && !visitComplete(v) ? v : null;
    const darts = v ? v.darts.map((x, i) => Object.assign({ index: i, s: x.s || 0, label: x.l, x: x.x, y: x.y, key: v.t && v.t.key, fixed: !!x.f, byHand: !!x.b, rem: x.e && Number.isFinite(x.e.rem) ? x.e.rem : null, left: x.e && x.e.left ? x.e.left : null }, dartWords(x, v.t, d))) : [];
    const scoredOpen = !!(v && visitComplete(v) && !v.out);
    const finished = isFinished(sess);
    const live = t && d.live ? d.live(sess.play, t, open ? open.darts.map((x) => x.e) : []) : null;
    const pace = ctx && ctx.best && d.paceText ? d.paceText(sess.play, ctx.best) : null;
    const prog = d.progress(sess.play);
    const max = t ? dartsPerVisit(d, sess.play, t) : 3;
    const pullOut = scoredOpen && !finished && !allByHand(v);
    const heroLabel = pullOut ? undefined : (live && live.label) || (t && t.heroLabel) || undefined;
    const view = {
      drill: d.id,
      input: d.input || "hits",
      target: finished ? null : live && live.big != null ? live.big : t ? t.big : null,
      targetKey: t ? t.key : v && v.t ? v.t.key : null,
      finished,
      next: live ? live.next : t && d.next ? d.next(sess.play, t) : [],
      nextLabel: live ? live.nextLabel || undefined : t && d.nextLabel ? d.nextLabel(sess.play, t) || undefined : undefined,
      nextClass: live && live.next && live.next.length ? live.nextClass : undefined,
      lit: finished ? [] : (live && live.lit) || (t && t.lit) || [],
      dartNo: open ? open.darts.length + 1 : 1,
      darts,
      unseen: v && v.out ? v.out.unseen || 0 : 0,
      visitDone: !!(v && (v.out || visitComplete(v))),
      pullOut,
      cells: d.cells(sess.play, t),
      done: prog.done,
      of: prog.of,
      capHtml: d.capHtml ? d.capHtml(sess.play, t) : null,
      note: finished ? (d.finishNote ? d.finishNote(sess.play) : "Done") : pace || "",
    };
    if (heroLabel) view.label = heroLabel;
    if (max !== 3 && !finished) view.countHtml = pullOut ? "Next try" : `Dart ${view.dartNo} <span>of ${max}</span>`;
    if (d.cols) view.cols = d.cols(sess.play);
    return view;
  }
  // Fixing a dart of the view: what it could have been (Board mode's sheet).
  function fixOptions(d, view) {
    const drill = view && drillOf(view.drill);
    if (drill && drill.fixOptions) return drill.fixOptions(d, view);
    return doubleFixOptions(d, view && view.targetKey);
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
  const routeText = (labels) => (labels || []).map(readLabel).join(" ");
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
    drillOf, cleanSettings, settingsText, newSession, ensureSession, target, isFinished, isPaused, pauseResume, elapsedMs, fmt, progress,
    manualVisit, manualDart, cameraDart, cameraTakeout, fixDart, undoStep, undoCount, undoStackOf,
    boardView, padFor, fixOptions, dartWords, summarize, historyPayload, personalBest, isNewBest, historyRows, stamp, localDate,
    checkoutRoute, checkoutTable, parseRoute, routeText, routeTotal, endsOnDouble, routeValid, isBogey, canDouble, doubleFor, x01Effect,
    parseLabel, describe, spot, numberAt, neighbours, ordinal, hitsWords, readLabel, speakLabel, clone,
  };
});
