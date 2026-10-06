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

  return {
    STEPS, TOTAL_DARTS, MAX_SCORE, SHANGHAI_BONUS, DOUBLE_POINTS, BULL, PART_NAMES,
    stepScore, stepMax, isShanghai, stepLabel, doubleLabel, stepsOf, position, addDart, validDart,
    summarize, runningTotals, progress, record,
  };
});
