// Scoring and progress maths for the JDC Challenge page (challenge.html). No DOM or Firebase, so
// `node --test tests/challenge-engine.test.cjs` checks it and the page loads it with a <script> tag.
//
// The JDC Challenge (Junior Darts Corporation) is one round that tests every part of the game:
//   Part 1 - Shanghai 10 to 15: three darts at each number. Single, double and treble score 1x, 2x, 3x the
//            number; a single, a double AND a treble of it in the same three darts (a "Shanghai") adds 100.
//   Part 2 - Doubles: one dart at each double, 1 to 20 and then the bull. Every hit scores 50.
//   Part 3 - Shanghai 15 to 20, scored like Part 1.
// 57 darts in all. A dart is stored as a number: 0 miss, 1 single, 2 double, 3 treble (Part 2: 0 or 1).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ChallengeEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const SHANGHAI_BONUS = 100;
  const DOUBLE_POINTS = 50;
  const BULL = 25;

  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const STEPS = [
    ...range(10, 15).map((n) => ({ part: 1, kind: "shanghai", target: n, darts: 3 })),
    ...[...range(1, 20), BULL].map((n) => ({ part: 2, kind: "double", target: n, darts: 1 })),
    ...range(15, 20).map((n) => ({ part: 3, kind: "shanghai", target: n, darts: 3 })),
  ];
  const TOTAL_DARTS = STEPS.reduce((s, st) => s + st.darts, 0); // 57
  const PART_NAMES = { 1: "Shanghai 10-15", 2: "Doubles", 3: "Shanghai 15-20" };

  function stepScore(step, darts) {
    if (step.kind === "double") return darts.filter((d) => d === 1).length * DOUBLE_POINTS;
    const points = darts.reduce((s, d) => s + step.target * (d || 0), 0);
    return points + (isShanghai(step, darts) ? SHANGHAI_BONUS : 0);
  }
  const isShanghai = (step, darts) => step.kind === "shanghai" && [1, 2, 3].every((m) => darts.includes(m));

  // The best possible step: a Shanghai beats three trebles on every number used here (6n+100 > 9n).
  const stepMax = (step) => (step.kind === "double" ? DOUBLE_POINTS : Math.max(9 * step.target, 6 * step.target + SHANGHAI_BONUS));
  const MAX_SCORE = STEPS.reduce((s, st) => s + stepMax(st), 0);

  const doubleLabel = (n) => (n === BULL ? "Bull" : `D${n}`);
  const stepLabel = (step) => (step.kind === "double" ? doubleLabel(step.target) : `Shanghai ${step.target}`);

  // Splits a flat list of darts into steps: [{ step, darts, score, done }].
  function stepsOf(darts) {
    const out = [];
    let i = 0;
    for (const step of STEPS) {
      const mine = darts.slice(i, i + step.darts);
      i += step.darts;
      out.push({ step, darts: mine, score: stepScore(step, mine), done: mine.length === step.darts });
    }
    return out;
  }

  const validDart = (step, value) => Number.isInteger(value) && value >= 0 && value <= (step.kind === "double" ? 1 : 3);

  // Where the next dart goes: { index, step, dartInStep } or null when all 57 are thrown.
  function position(darts) {
    let i = 0;
    for (let s = 0; s < STEPS.length; s++) {
      const step = STEPS[s];
      if (darts.length < i + step.darts) return { index: s, step, dartInStep: darts.length - i };
      i += step.darts;
    }
    return null;
  }

  function addDart(darts, value) {
    const pos = position(darts);
    if (!pos) throw new Error("The challenge is finished.");
    if (!validDart(pos.step, value)) throw new Error("That dart can't score there.");
    return [...darts, value];
  }

  function summarize(darts) {
    const steps = stepsOf(darts);
    const parts = { 1: 0, 2: 0, 3: 0 };
    let trebles = 0, shanghais = 0, doublesHit = 0, scoringHits = 0, scoringDarts = 0;
    for (const { step, darts: d, score } of steps) {
      parts[step.part] += score;
      if (step.kind === "double") doublesHit += d.filter((x) => x === 1).length;
      else {
        trebles += d.filter((x) => x === 3).length;
        scoringHits += d.filter((x) => x > 0).length;
        scoringDarts += d.length;
        if (isShanghai(step, d)) shanghais += 1;
      }
    }
    const total = parts[1] + parts[2] + parts[3];
    return {
      total,
      part1: parts[1],
      part2: parts[2],
      part3: parts[3],
      trebles,
      shanghais,
      doublesHit,
      hitRate: scoringDarts ? scoringHits / scoringDarts : 0,
      finished: darts.length === TOTAL_DARTS,
      dartsThrown: darts.length,
    };
  }

  // Running total after each step, for "ahead of / behind your best" while playing.
  function runningTotals(darts) {
    let sum = 0;
    return stepsOf(darts).filter((s) => s.done).map((s) => (sum += s.score));
  }

  // How you stand against another round (your best) at the same point: compared at the end of each
  // visit only, both totals through the same completed visits, so the darts of the visit you are in
  // don't count against the other round's total from before that number. Returns { diff, steps,
  // total, other } or null before the first visit is done (or with nothing to compare).
  function pace(darts, otherDarts) {
    if (!Array.isArray(otherDarts)) return null;
    const mine = runningTotals(darts), theirs = runningTotals(otherDarts);
    const steps = Math.min(mine.length, theirs.length);
    if (!steps) return null;
    return { diff: mine[steps - 1] - theirs[steps - 1], steps, total: mine[steps - 1], other: theirs[steps - 1] };
  }

  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

  // Progress over saved games (each { timestamp, total, part1, part2, part3, darts }), oldest first.
  function progress(games) {
    const list = [...games].filter((g) => Number.isFinite(g.total)).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const totals = list.map((g) => g.total);
    const last10 = list.slice(-10);
    const prev10 = list.slice(-20, -10);
    // Hit rate on every double over all games, from the darts themselves.
    const doubles = [...range(1, 20), BULL].map((n) => ({ target: n, label: doubleLabel(n), hits: 0, tries: 0 }));
    for (const g of list) {
      if (!Array.isArray(g.darts)) continue;
      stepsOf(g.darts).forEach(({ step, darts }) => {
        if (step.kind !== "double" || !darts.length) return;
        const row = doubles.find((d) => d.target === step.target);
        row.tries += 1;
        row.hits += darts[0] === 1 ? 1 : 0;
      });
    }
    doubles.forEach((d) => { d.rate = d.tries ? d.hits / d.tries : null; });
    const tried = doubles.filter((d) => d.tries);
    const weakest = [...tried].sort((a, b) => a.rate - b.rate || a.target - b.target).slice(0, 3);
    // Moving average of the last five games, for the chart.
    const moving = totals.map((_, i) => mean(totals.slice(Math.max(0, i - 4), i + 1)));
    return {
      games: list.length,
      best: totals.length ? Math.max(...totals) : null,
      bestGame: list.length ? list.reduce((a, b) => (b.total > a.total ? b : a)) : null,
      last: totals.length ? totals[totals.length - 1] : null,
      avgAll: totals.length ? mean(totals) : null,
      avgLast10: last10.length ? mean(last10.map((g) => g.total)) : null,
      avgPrev10: prev10.length ? mean(prev10.map((g) => g.total)) : null,
      parts: ["part1", "part2", "part3"].map((k) => ({ key: k, last10: last10.length ? mean(last10.map((g) => g[k] || 0)) : null, all: list.length ? mean(list.map((g) => g[k] || 0)) : null })),
      doubles,
      weakest,
      totals,
      moving,
    };
  }

  // What the app saves for a finished game (the shape firestore.rules checks).
  function record(uid, darts, { timestamp, durationSec } = {}) {
    const s = summarize(darts);
    if (!s.finished) throw new Error("Only a finished challenge is saved.");
    const rec = {
      uid, timestamp, total: s.total, part1: s.part1, part2: s.part2, part3: s.part3,
      trebles: s.trebles, shanghais: s.shanghais, doublesHit: s.doublesHit, darts: [...darts],
    };
    if (Number.isFinite(durationSec)) rec.durationSec = Math.max(0, Math.min(86400, Math.round(durationSec)));
    return rec;
  }


  // ---- a round in play, the same on every device (challenge.html, liveChallenges/{uid}) ----------
  // Every visit at the board is 3 darts: three at one number (Shanghai), or one at each of three
  // doubles in order (D1 D2 D3 ... D19 D20 Bull). So dart i is in visit floor(i / 3), 19 visits.
  //   round = { v: 1, id, darts: [0-3], meta: [{ src, seq, l, x, y, f }], startedAt, timer,
  //             camSeq, cam: { visit, unread, tapped, hold: [] } | null, undo: [], say: { id, text } }
  // meta runs alongside darts: where each came from ("key", "cam", "unseen" a miss at a pull-out,
  // "unread" a dart the cameras couldn't read and nobody tapped in, "x3" the 3 misses key), what the
  // cameras read (l) and where (x, y), f: 1 when fixed by hand.
  // The cameras: a visit belongs to the darts the cameras see from their first one after a pull-out.
  // It is exactly 3 darts, and nothing ends it early. A 4th dart before the pull-out isn't counted,
  // so one bad visit can't shift every later target. At the pull-out its darts not seen are misses.
  // A dart they couldn't read waits for a tap (the keys or the board), and the darts read after it
  // wait behind it, so each goes to its own target (in the doubles part each dart is a different double).
  const VISITS = TOTAL_DARTS / 3;
  const UNDO_MAX = 10;
  const visitOf = (i) => Math.floor(i / 3);
  const stepAt = (i) => { const p = i >= 0 && i < TOTAL_DARTS ? position(new Array(i).fill(0)) : null; return p ? p.step : null; };
  const clone = (o) => JSON.parse(JSON.stringify(o));

  function newRound(id, now) {
    return { v: 1, id, darts: [], meta: [], startedAt: now, timer: null, camSeq: 0, cam: null, undo: [], say: null };
  }
  function cleanRound(r) {
    if (!r || typeof r !== "object" || !Array.isArray(r.darts)) return null;
    const out = Object.assign({ v: 1, meta: [], camSeq: 0, cam: null, undo: [], say: null }, r);
    out.darts = r.darts.slice(0, TOTAL_DARTS).map((d, i) => (validDart(stepAt(i), d) ? d : 0));
    out.meta = out.darts.map((_, i) => (Array.isArray(r.meta) && r.meta[i] && typeof r.meta[i] === "object" ? r.meta[i] : { src: "key" }));
    out.undo = Array.isArray(r.undo) ? r.undo.slice(-UNDO_MAX) : [];
    out.camSeq = Number(r.camSeq) || 0;
    return out;
  }
  // The value a dart the cameras read is worth at dart i: in that number (S/D/T = 1/2/3), or a hit
  // on that double (the bull: the bullseye only).
  function valueAt(i, label) {
    const step = stepAt(i);
    if (!step) return 0;
    if (step.kind === "double") return label === (step.target === BULL ? "DB" : "D" + step.target) ? 1 : 0;
    const m = /^([SDT])(\d+)$/.exec(label || "");
    return m && Number(m[2]) === step.target ? "SDT".indexOf(m[1]) + 1 : 0;
  }
  function pushUndo(r) {
    r.undo = (r.undo || []).concat([{ darts: r.darts.slice(), meta: clone(r.meta), cam: r.cam ? clone(r.cam) : null }]).slice(-UNDO_MAX);
  }
  function put(r, value, meta) {
    const i = r.darts.length;
    if (i >= TOTAL_DARTS) return null;
    const step = stepAt(i);
    const v = validDart(step, value) ? value : 0;
    r.darts.push(v);
    r.meta.push(meta || { src: "key" });
    r.pulled = false;
    return { index: i, step, value: v };
  }
  // How many darts the cameras' visit has: in, waiting for a tap, and held behind those.
  const camCount = (r) => (r.cam ? Math.max(0, r.darts.length - 3 * r.cam.visit) + r.cam.unread + r.cam.hold.length : 0);
  const fresh = (r, seq) => !(seq && seq <= (Number(r.camSeq) || 0));

  // A dart tapped in (a key, or the board): it fills a dart the cameras couldn't read first, then the
  // darts they held behind it go in. Returns [{ index, step, value }] of the darts that went in.
  function keyDart(r, value, src) {
    if (r.darts.length >= TOTAL_DARTS) return [];
    pushUndo(r);
    const out = [];
    const d = put(r, value, { src: src || "key" });
    if (d) out.push(d);
    if (r.cam && r.cam.unread > 0) {
      r.cam.unread -= 1;
      r.cam.tapped = (r.cam.tapped || 0) + 1;
      if (!r.cam.unread) out.push(...release(r));
    }
    return out;
  }
  function release(r) {
    const out = [];
    while (r.cam && r.cam.hold.length && r.darts.length < TOTAL_DARTS) {
      const h = r.cam.hold.shift();
      const d = put(r, valueAt(r.darts.length, h.l), { src: "cam", seq: h.seq, l: h.l, x: h.x, y: h.y });
      if (d) out.push(d);
    }
    return out;
  }
  // The cameras' visit for an event: the one going on, or a new one at the next dart.
  function camVisit(r) {
    if (!r.cam) r.cam = { visit: visitOf(r.darts.length), unread: 0, tapped: 0, hold: [] };
    return r.cam;
  }
  // A dart the cameras read: ev = { seq, l, x, y }. Returns { went: [darts in], held, late } or null.
  function camDart(r, ev) {
    if (!fresh(r, ev.seq)) return null;
    if (ev.seq) r.camSeq = ev.seq;
    if (r.darts.length >= TOTAL_DARTS) return { went: [], late: true };
    pushUndo(r);
    const c = camVisit(r);
    if (camCount(r) >= 3) { r.undo.pop(); return { went: [], late: true }; } // a 4th dart: not counted
    if (c.unread) { c.hold.push({ seq: ev.seq || 0, l: ev.l, x: ev.x, y: ev.y }); return { went: [], held: true }; }
    const d = put(r, valueAt(r.darts.length, ev.l), { src: "cam", seq: ev.seq || 0, l: ev.l, x: ev.x, y: ev.y });
    return { went: d ? [d] : [] };
  }
  // A dart the cameras saw but couldn't read: it waits for a tap.
  function camUnread(r, ev) {
    if (!fresh(r, ev.seq)) return null;
    if (ev.seq) r.camSeq = ev.seq;
    if (r.darts.length >= TOTAL_DARTS) return { late: true };
    const c = camVisit(r);
    if (camCount(r) >= 3) return { late: true };
    pushUndo(r);
    c.unread += 1;
    return { waiting: c.unread };
  }
  // The darts were pulled out: the visit's darts not seen are misses (the ones never tapped in too),
  // and the held ones go in, in order. Returns { went, unseen } or null.
  function camTakeout(r, ev) {
    if (!fresh(r, ev.seq)) return null;
    if (ev.seq) r.camSeq = ev.seq;
    const c = r.cam;
    if (!c) {
      // Darts tapped in this visit and no camera dart: the rest are misses all the same.
      const k = r.darts.length % 3;
      if (!k || r.darts.length >= TOTAL_DARTS) return { went: [], unseen: 0 };
      r.cam = { visit: visitOf(r.darts.length), unread: 0, tapped: 0, hold: [] };
    }
    pushUndo(r);
    const went = [];
    let unseen = 0;
    while (r.cam.unread > 0) { r.cam.unread -= 1; const d = put(r, 0, { src: "unread" }); if (d) { went.push(d); unseen += 1; } }
    went.push(...release(r));
    const end = Math.min(TOTAL_DARTS, 3 * (r.cam.visit + 1));
    while (r.darts.length < end) { const d = put(r, 0, { src: "unseen" }); if (d) { went.push(d); unseen += 1; } }
    r.cam = null;
    r.pulled = true;
    return { went, unseen };
  }
  // The "3 misses" key: the rest of this visit missed.
  function threeMisses(r) {
    if (r.darts.length >= TOTAL_DARTS) return [];
    pushUndo(r);
    const out = [];
    const end = 3 * (visitOf(r.darts.length) + 1);
    if (r.cam) { r.cam.hold = []; r.cam.unread = 0; }
    while (r.darts.length < end) { const d = put(r, 0, { src: "x3" }); if (d) out.push(d); }
    return out;
  }
  // A dart fixed by hand: dart i is worth `value` (its own target's value: 0-3, or 0/1 at a double).
  function fixDart(r, i, value) {
    if (!(i >= 0 && i < r.darts.length) || !validDart(stepAt(i), value) || r.darts[i] === value) return null;
    pushUndo(r);
    const was = r.darts[i];
    r.darts[i] = value;
    r.meta[i] = Object.assign({}, r.meta[i] || {}, { f: 1 });
    return { index: i, step: stepAt(i), was, value };
  }
  // Undo: the last change taken back (a dart, a fix, a pull-out's misses...). Up to 10 steps.
  function undoStep(r) {
    const u = (r.undo || []).pop();
    if (!u) return false;
    r.darts = u.darts; r.meta = u.meta; r.cam = u.cam;
    return true;
  }
  const undoCount = (r) => (r && Array.isArray(r.undo) ? r.undo.length : 0);

  // ---- what Board mode shows, and what the voice says ----------------------------------------------
  const NUM_WORD = { 1: "single", 2: "double", 3: "treble" };
  const shortDouble = (t) => (t === BULL ? "Bull" : "D" + t);
  // One dart's box: { read, sub, kind }.
  function dartBox(i, value, meta) {
    const step = stepAt(i), m = meta || {};
    if (m.src === "unseen") return { read: "Not seen", sub: "Counted as a miss", kind: "miss unseen" };
    if (m.src === "unread") return { read: "Not read", sub: "Never tapped in: a miss", kind: "miss unseen" };
    if (step.kind === "double") {
      if (value) return { read: shortDouble(step.target), sub: "+" + DOUBLE_POINTS, kind: "hit" };
      const where = m.l && m.l !== "MISS" ? ", in the " + (m.l === "DB" ? "bull" : m.l === "SB" ? "25" : m.l.replace(/^[SDT]/, "")) : "";
      return { read: "Miss", sub: shortDouble(step.target) + where, kind: "miss" };
    }
    if (value) return { read: "SDT"[value - 1] + step.target, sub: String(step.target * value), kind: value === 3 ? "hit" : value === 2 ? "hit" : "stay" };
    const where = m.l && m.l !== "MISS" ? "In the " + (m.l === "DB" ? "bull" : m.l === "SB" ? "25" : m.l.replace(/^[SDT]/, "")) : m.src === "x3" ? "3 misses" : "A miss";
    return { read: "Miss", sub: where, kind: "miss" };
  }
  // A visit: its darts' indexes, its targets, its score, and a Shanghai.
  function visitInfo(darts, k) {
    const from = 3 * k, steps = [0, 1, 2].map((j) => stepAt(from + j));
    const vals = darts.slice(from, from + 3);
    const shanghai = steps[0].kind === "shanghai" && vals.length === 3 && isShanghai(steps[0], vals);
    const score = steps[0].kind === "double" ? vals.filter((v) => v === 1).length * DOUBLE_POINTS : vals.reduce((a, v) => a + steps[0].target * v, 0) + (shanghai ? SHANGHAI_BONUS : 0);
    return { k, from, steps, vals, done: vals.length === 3, score, shanghai, kind: steps[0].kind, part: steps[0].part };
  }
  // The most a round can still score from here (what's in, plus every visit to come at its best).
  function mostPossible(darts) {
    let total = summarize(darts).total;
    stepsOf(darts).forEach(({ step, darts: d }) => {
      if (d.length === step.darts) return;
      if (step.kind === "double") total += (step.darts - d.length) * DOUBLE_POINTS;
      else total += stepMax(step) - stepScore(step, d);
    });
    return total;
  }
  // The Shanghai so far this visit: "S ✓ D ✓ need the T for +100", or "" (no Shanghai left).
  function shanghaiNote(darts) {
    const k = visitOf(darts.length);
    if (k >= VISITS) return "";
    const v = visitInfo(darts, k);
    if (v.kind !== "shanghai" || !v.vals.length) return "";
    const have = new Set(v.vals.filter(Boolean));
    const need = [1, 2, 3].filter((m) => !have.has(m));
    if (need.length > 3 - v.vals.length) return "";
    return [1, 2, 3].filter((m) => have.has(m)).map((m) => "SDT"[m - 1] + " ✓").join(" ") + (need.length ? " · need the " + need.map((m) => "SDT"[m - 1]).join(" and ") + " for +" + SHANGHAI_BONUS : "");
  }
  // What a change sounds like: each dart's word; at a visit's third dart the visit and its score,
  // and how it stands against your best. what = { k: "dart", index } | { k: "fix", index } | { k: "undo" }.
  function voiceLine(darts, what, best) {
    if (!what) return "";
    if (what.k === "undo") return "Undone.";
    const i = what.index;
    if (!(i >= 0 && i < darts.length)) return "";
    const step = stepAt(i), v = darts[i];
    const word = step.kind === "double" ? (v ? "Hit" : "Miss") : v ? NUM_WORD[v][0].toUpperCase() + NUM_WORD[v].slice(1) : "Miss";
    if (what.k === "fix") return "Fixed: " + word.toLowerCase() + ".";
    if (i % 3 !== 2) return word + ".";
    const info = visitInfo(darts, visitOf(i));
    if (info.shanghai) return "SHANGHAI! " + info.score + ".";
    const words = info.vals.map((x) => (info.kind === "double" ? (x ? "hit" : "miss") : x ? NUM_WORD[x] : "miss")).join(", ");
    const head = info.kind === "double" ? info.steps.map((st) => (st.target === BULL ? "Bull" : "D " + st.target)).join(", ") : String(info.steps[0].target);
    let line = `${head}: ${words}. ${info.score}.`;
    const p = pace(darts.slice(0, i + 1), best);
    if (p && p.diff) line += ` ${Math.abs(p.diff)} ${p.diff > 0 ? "ahead of" : "behind"} your best.`;
    else if (p) line += " Level with your best.";
    return line;
  }

  return {
    STEPS, TOTAL_DARTS, MAX_SCORE, SHANGHAI_BONUS, DOUBLE_POINTS, BULL, PART_NAMES,
    stepScore, stepMax, isShanghai, stepLabel, doubleLabel, stepsOf, position, addDart, validDart,
    summarize, runningTotals, pace, progress, record,
    VISITS, UNDO_MAX, visitOf, stepAt, newRound, cleanRound, valueAt, keyDart, camDart, camUnread, camTakeout, threeMisses,
    fixDart, undoStep, undoCount, dartBox, visitInfo, mostPossible, shanghaiNote, voiceLine,
  };
});
