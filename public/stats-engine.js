// Stats, records and the practice plan for every game (stats.html, and the plan on the home page).
// Plain data in, plain data out: the saved sessions and games as Firestore has them. No DOM or
// Firebase, so `node --test tests/stats-engine.test.cjs` checks it, and pages load it with a <script>.
//
// What counts (the guards): a tracker session saved part way through (complete: false), a bot game
// not finished (abandoned: the test taps of 2026-09-27 were all abandoned), and anything you hid from
// your stats (statsHidden/{uid}) never count in averages, records or the plan. Nothing is deleted.
// Uses the games' own engines for what they already know (TrackerEngine, DartsEngine,
// ChallengeEngine): pass them in, or they are taken from the page (window) / required in node.
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./tracker-engine.js"), require("./practice-engine.js"), require("./challenge-engine.js"));
  } else root.StatsEngine = factory(root.TrackerEngine, root.DartsEngine, root.ChallengeEngine);
})(typeof self !== "undefined" ? self : this, function (TE, DE, CE) {
  "use strict";
  const DAY = 86400000;
  const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const num = (x) => (typeof x === "number" ? x : parseInt(x || "0", 10) || 0);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pct = (a, b) => (b ? a / b : null);
  const byTime = (a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || ""));

  // ---- dates ----------------------------------------------------------------------------------------
  // "YYYY-MM-DD" of a saved thing: its timestamp text, or startedAtMs (Doubles).
  function dateOf(x) {
    if (!x) return null;
    if (typeof x.timestamp === "string") { const m = x.timestamp.match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; }
    if (TE && x.timestamp != null) { const d = TE.dateOf(x.timestamp); if (d) return d; }
    if (typeof x.localDate === "string") return x.localDate;
    const ms = typeof x.startedAtMs === "number" ? x.startedAtMs : typeof x.startedAt === "number" ? x.startedAt : null;
    if (ms != null) { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; }
    return null;
  }
  const dayNumber = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY);
  // Whether a date is in a range ending today: "30d", "90d", "1y" or "all".
  function inRange(iso, range, today) {
    if (!iso) return false;
    if (!range || range === "all") return true;
    const days = { "30d": 30, "90d": 90, "1y": 365 }[range] || 36500;
    const d = dayNumber(today) - dayNumber(iso);
    return d >= 0 && d < days;
  }
  // A moving average over the last k points.
  const rolling = (values, k) => values.map((_, i) => mean(values.slice(Math.max(0, i - k + 1), i + 1)));

  // ---- the guards -------------------------------------------------------------------------------------
  const hiddenOf = (doc) => new Set(doc && Array.isArray(doc.ids) ? doc.ids.filter((x) => typeof x === "string") : []);
  const shown = (hidden) => (x) => !(hidden && hidden.has(x.id));
  const trackerCounts = (s) => !!s && s.complete !== false && s.entry && typeof s.entry === "object";
  const botCounts = (g) => !!g && (g.result === "won" || g.result === "lost");

  // ---- the tracker --------------------------------------------------------------------------------------
  // Per number and overall: hit rate (darts in the number thrown at), marks per dart, S/D/T split,
  // each number's last 10 against its lifetime, the best score at each number, hit rate on darts 1/2/3
  // (sessions with every dart saved), and where the darts at each number went.
  function trackerStats(sessions, opts) {
    const o = opts || {};
    const mode = o.mode === "single" ? "single" : "standard";
    const all = (sessions || []).filter(shown(o.hidden)).filter((s) => (s.mode === "single" ? "single" : "standard") === mode).sort(byTime);
    const list = all.filter(trackerCounts);
    const ranged = list.filter((s) => inRange(dateOf(s), o.range, o.today));
    const last10 = list.slice(-10);
    const T = TE.TARGETS;
    const hitsIn = (s, t) => TE.hitsOf((s.entry || {})[t]);
    const rings = { S: 0, D: 0, T: 0, B: 0 };
    let hits = 0, darts = 0, marks = 0;
    for (const s of ranged) {
      for (const t of T) {
        const row = (s.entry || {})[t] || [];
        row.forEach((v) => { if (v && v !== "-") rings[v] = (rings[v] || 0) + 1; });
        hits += TE.hitsOf(row);
        marks += TE.rowScore(row, "standard");
        darts += 3;
      }
    }
    const numbers = T.map((t) => {
      const life = list.length ? list.reduce((n, s) => n + hitsIn(s, t), 0) / (list.length * 3) : null;
      const recent = last10.length ? last10.reduce((n, s) => n + hitsIn(s, t), 0) / (last10.length * 3) : null;
      const rangeRate = ranged.length ? ranged.reduce((n, s) => n + hitsIn(s, t), 0) / (ranged.length * 3) : null;
      let best = null;
      for (const s of list) { const sc = TE.rowScore((s.entry || {})[t], mode); if (!best || sc > best.score) best = { score: sc, date: dateOf(s) }; }
      return { t, rate: rangeRate, life, last10: recent, trend: life != null && recent != null ? recent - life : null, best };
    });
    // Darts 1, 2 and 3 at a number (only sessions that kept every dart in order).
    const order = [0, 0, 0].map(() => ({ hits: 0, darts: 0 }));
    for (const s of ranged) {
      if (!Array.isArray(s.throws)) continue;
      const by = {};
      s.throws.forEach((d) => { if (d && d.t && d.src !== "old") (by[d.t] = by[d.t] || []).push(d); });
      Object.values(by).forEach((ds) => ds.slice(0, 3).forEach((d, i) => { order[i].darts += 1; if (d.r && d.r !== "-") order[i].hits += 1; }));
    }
    const totals = list.map((s) => num(s.total));
    const best = list.reduce((a, s) => (!a || num(s.total) > num(a.total) ? s : a), null);
    return {
      mode, sessions: ranged.length, allSessions: all.length, partial: all.length - list.length,
      darts, hits, hitRate: pct(hits, darts), marksPerDart: mode === "standard" ? pct(marks, darts) : null,
      split: rings, numbers,
      byDart: order.some((x) => x.darts) ? order.map((x, i) => ({ n: i + 1, darts: x.darts, rate: pct(x.hits, x.darts) })) : null,
      best: best ? { total: num(best.total), date: dateOf(best), id: best.id } : null,
      avg: mean(ranged.map((s) => num(s.total))), last10Avg: mean(last10.map((s) => num(s.total))),
      series: ranged.map((s) => ({ date: dateOf(s), value: num(s.total), id: s.id })),
      allTotals: totals,
    };
  }

  // Where the darts thrown at a number landed (tracker sessions: dots of hits, and every dart where
  // the session kept them): the average point, the spread, and which neighbour the misses go to.
  function landing(sessions, t, opts) {
    const o = opts || {};
    const pts = [], missTo = {};
    const nb = TE.neighbours(t);
    for (const s of (sessions || []).filter(shown(o.hidden)).filter(trackerCounts)) {
      if (Array.isArray(s.throws) && s.throws.some((d) => d && d.t === t)) {
        s.throws.forEach((d) => {
          if (!d || d.t !== t) return;
          if (Number.isFinite(d.x) && Number.isFinite(d.y) && Math.hypot(d.x, d.y) <= 1.2) pts.push({ x: d.x, y: d.y, hit: d.r !== "-" });
          if (d.r === "-" && d.l) {
            const m = /^[SDT](\d+)$/.exec(d.l);
            const where = m ? m[1] : d.l === "MISS" ? "off" : d.l === "SB" || d.l === "DB" ? "bull" : null;
            if (where) missTo[where] = (missTo[where] || 0) + 1;
          }
        });
      } else if (s.positions && Array.isArray(s.positions[t])) {
        s.positions[t].forEach((p) => { if (p && Number.isFinite(p.x)) pts.push({ x: p.x, y: p.y, hit: true }); });
      }
    }
    if (!pts.length) return { t, n: 0, points: [], missTo, drift: "" };
    const mx = mean(pts.map((p) => p.x)), my = mean(pts.map((p) => p.y));
    const spread = Math.sqrt(mean(pts.map((p) => (p.x - mx) ** 2 + (p.y - my) ** 2)));
    // Drift: the side the average point sits on, from the number's middle (clockwise is the right-hand
    // neighbour on the board as you face it).
    let drift = "";
    if (t !== "BULL") {
      const i = SEG.indexOf(Number(t));
      const centre = -Math.PI / 2 + (i * Math.PI) / 10;
      let off = Math.atan2(my, mx) - centre;
      while (off > Math.PI) off -= 2 * Math.PI;
      while (off < -Math.PI) off += 2 * Math.PI;
      const deg = (off * 180) / Math.PI;
      const misses = nb.map((n) => ({ n, c: missTo[n] || 0 })).sort((a, b) => b.c - a.c);
      if (misses[0].c >= 3 && misses[0].c >= 2 * (misses[1].c || 0)) drift = `Your ${t}s miss into the ${misses[0].n} (${misses[0].c} against ${misses[1].c} into the ${misses[1].n}).`;
      else if (Math.abs(deg) >= 2.5 && pts.length >= 9) drift = `Your ${t}s drift ${deg > 0 ? "right, towards the " + nb[1] : "left, towards the " + nb[0]}.`;
    }
    return { t, n: pts.length, points: pts, mean: { x: mx, y: my }, spread, missTo, drift };
  }

  // ---- the bot game --------------------------------------------------------------------------------------
  // A saved game's visits: kept since Nov 13, 2026 (visits), or rebuilt by playing the darts again
  // (both sides' darts in order, from who threw first). A game with a dart typed as a total can't be.
  function botVisits(g) {
    if (Array.isArray(g.visits) && g.visits.length) {
      return g.visits.map((v) => ({ who: v.w === "p" ? "player" : "bot", darts: v.d || [], scored: num(v.s), bust: !!v.b, remaining: num(v.r) }));
    }
    if (!DE || g.kind !== "x01") return null;
    const pd = Array.isArray(g.playerDarts) ? g.playerDarts : [], bd = Array.isArray(g.botDarts) ? g.botDarts : [];
    if (pd.concat(bd).some((d) => !d || !Number.isFinite(d.x) || !Number.isFinite(d.y))) return null;
    const game = DE.createGame({ kind: "x01", startScore: g.startScore, doubleOut: g.doubleOut !== false, first: g.first === "bot" ? "bot" : "player" });
    const next = { player: 0, bot: 0 }, src = { player: pd, bot: bd };
    let guard = 0;
    try {
      while (!game.winner && guard++ < 2000) {
        const who = game.turn;
        if (next[who] >= src[who].length) break;
        while (!game.visitDone && next[who] < src[who].length) DE.throwDart(game, src[who][next[who]++]);
        if (!game.visitDone) break; // the game stopped part way through a visit
        DE.endVisit(game);
      }
    } catch (_) { return null; }
    return game.visits;
  }
  // Every finished x01 game: average, first 9, checkout darts, the 60+/100+/140+/180s, win rate by
  // level and by format, the highest finish.
  function botStats(games, opts) {
    const o = opts || {};
    const all = (games || []).filter(shown(o.hidden)).sort(byTime);
    const fin = all.filter(botCounts).filter((g) => inRange(dateOf(g), o.range, o.today));
    const x01 = fin.filter((g) => g.kind === "x01");
    let scored = 0, used = 0, f9s = 0, f9d = 0, coH = 0, coD = 0, high = 0, rebuilt = 0, withVisits = 0;
    const tons = { s60: 0, s100: 0, s140: 0, s180: 0 };
    for (const g of x01) {
      const visits = botVisits(g);
      if (!visits) continue;
      withVisits += 1;
      if (!Array.isArray(g.visits)) rebuilt += 1;
      const game = { kind: "x01", doubleOut: g.doubleOut !== false, visits, darts: { player: [], bot: [] }, winner: g.result === "won" ? "player" : "bot", startScore: g.startScore };
      game.darts.player = visits.filter((v) => v.who === "player").flatMap((v) => v.darts);
      const r = DE.legReport(game, "player");
      const mine = visits.filter((v) => v.who === "player");
      scored += mine.reduce((n, v) => n + (v.bust ? 0 : v.scored), 0);
      used += mine.reduce((n, v) => n + (v.bust ? 3 : v.darts.length), 0);
      mine.slice(0, 3).forEach((v) => { f9s += v.bust ? 0 : v.scored; f9d += v.bust ? 3 : v.darts.length; });
      coH += r.checkout.hits; coD += r.checkout.darts;
      if (g.result === "won") high = Math.max(high, r.highFinish);
      Object.keys(tons).forEach((k) => { tons[k] += r.tons[k]; });
    }
    const group = (key) => {
      const m = new Map();
      for (const g of fin) {
        const k = key(g);
        const e = m.get(k) || { label: k, played: 0, won: 0, avgSum: 0 };
        e.played += 1; if (g.result === "won") e.won += 1; e.avgSum += num(g.playerAvg);
        m.set(k, e);
      }
      return [...m.values()].map((e) => ({ label: e.label, played: e.played, won: e.won, rate: e.won / e.played, avg: e.avgSum / e.played }));
    };
    const level = (g) => (Number.isFinite(g.botTarget) ? (g.ladder ? `Ladder (${g.botTarget})` : `Averages ${g.botTarget}`) : String(g.rank || "club").replace(/^./, (c) => c.toUpperCase()));
    const format = (g) => (g.kind === "cricket" ? "Cricket" : `${g.startScore || 501}${g.doubleOut === false ? " straight" : ""}`) + (g.legsToWin ? `, first to ${g.legsToWin}` : "");
    return {
      games: fin.length, all: all.length, abandoned: all.filter((g) => g.result === "abandoned").length,
      won: fin.filter((g) => g.result === "won").length,
      winRate: pct(fin.filter((g) => g.result === "won").length, fin.length),
      avg: used ? (scored * 3) / used : mean(x01.map((g) => num(g.playerAvg))),
      first9: f9d ? (f9s * 3) / f9d : null,
      checkout: { hits: coH, darts: coD, rate: pct(coH, coD) },
      tons, highFinish: high || null, withVisits, rebuilt,
      byLevel: group(level), byFormat: group(format),
      series: x01.map((g) => ({ date: dateOf(g), value: num(g.playerAvg), id: g.id })),
    };
  }

  // ---- the JDC Challenge -------------------------------------------------------------------------------
  // Each part, each number (points and Shanghais), and each double, over the rounds in range.
  function jdcStats(games, opts) {
    const o = opts || {};
    const list = (games || []).filter(shown(o.hidden)).filter((g) => Number.isFinite(g.total)).filter((g) => inRange(dateOf(g), o.range, o.today)).sort(byTime);
    const p = CE.progress(list);
    const numbers = new Map();
    for (const g of list) {
      if (!Array.isArray(g.darts)) continue;
      CE.stepsOf(g.darts).forEach(({ step, darts, score }) => {
        if (step.kind !== "shanghai") return;
        const k = `${step.part}:${step.target}`;
        const e = numbers.get(k) || { part: step.part, target: step.target, rounds: 0, points: 0, marks: 0, shanghais: 0 };
        e.rounds += 1; e.points += score; e.marks += darts.reduce((a, b) => a + b, 0); if (CE.isShanghai(step, darts)) e.shanghais += 1;
        numbers.set(k, e);
      });
    }
    return {
      rounds: list.length, best: p.best, avg: p.avgAll, last10: p.avgLast10, parts: p.parts, doubles: p.doubles, weakest: p.weakest,
      numbers: [...numbers.values()].map((e) => ({ ...e, avgPoints: e.points / e.rounds, marksPerDart: e.marks / (e.rounds * 3) })),
      series: list.map((g) => ({ date: dateOf(g), value: g.total, id: g.id })),
    };
  }

  // ---- Doubles --------------------------------------------------------------------------------------------
  const DKEYS = [...Array.from({ length: 20 }, (_, i) => "D" + (i + 1)), "DBULL"];
  // Each double's hit rate per dart: a double done on its nth dart is 1 hit in n darts; one left open
  // with n darts is 0 in n. Over the sessions in range (the newest `last` when given).
  function doublesStats(sessions, opts) {
    const o = opts || {};
    let list = (sessions || []).filter(shown(o.hidden)).filter((s) => inRange(dateOf(s), o.range, o.today))
      .sort((a, b) => (a.startedAtMs || 0) - (b.startedAtMs || 0));
    if (o.last) list = list.slice(-o.last);
    const rows = DKEYS.map((k) => ({ key: k, label: k === "DBULL" ? "Bull" : k, hits: 0, darts: 0 }));
    for (const s of list) {
      const per = s.perDouble || s.doubles;
      if (!per) continue;
      rows.forEach((r) => {
        const d = per[r.key];
        if (!d) return;
        const n = num(d.attempts) * 3 + num(d.extraDarts);
        const used = d.completed && d.hitDart ? Math.max(1, (num(d.attempts) - 1) * 3 + num(d.hitDart)) : n;
        r.darts += used;
        if (d.completed) r.hits += 1;
      });
    }
    rows.forEach((r) => { r.rate = pct(r.hits, r.darts); });
    const tried = rows.filter((r) => r.darts);
    return {
      sessions: list.length, doubles: rows,
      weakest: tried.slice().sort((a, b) => a.rate - b.rate || DKEYS.indexOf(a.key) - DKEYS.indexOf(b.key)).slice(0, 5),
      series: list.map((s) => ({ date: dateOf(s), value: typeof s.activeMs === "number" ? s.activeMs / 60000 : null, id: s.id })).filter((x) => x.value != null),
    };
  }

  // Where the darts at one double went (Doubles rounds keep every camera dart): hits, inside the wire
  // (the single), outside it, next door. key: "D16" or "DBULL".
  function doublesLanding(sessions, key, opts) {
    const o = opts || {};
    const n = key === "DBULL" ? "BULL" : key.slice(1);
    const nb = n === "BULL" ? [] : TE.neighbours(n);
    const out = { key, points: [], hit: 0, inside: 0, outside: 0, nextDoor: 0, other: 0 };
    for (const s of (sessions || []).filter(shown(o.hidden)).filter((x) => inRange(dateOf(x), o.range, o.today))) {
      for (const t of Array.isArray(s.throws) ? s.throws : []) {
        if (!t || t.k !== key) continue;
        const hit = key === "DBULL" ? t.l === "DB" : t.l === key;
        if (Number.isFinite(t.x) && Number.isFinite(t.y)) out.points.push({ x: t.x, y: t.y, hit });
        const m = /^[SDT](\d+)$/.exec(t.l || "");
        if (hit) out.hit += 1;
        else if (n !== "BULL" && m && m[1] === n) out.inside += 1;
        else if (t.l === "MISS" || (n === "BULL" && t.l === "SB")) out.outside += 1;
        else if (m && nb.includes(m[1])) out.nextDoor += 1;
        else out.other += 1;
      }
    }
    out.darts = out.hit + out.inside + out.outside + out.nextDoor + out.other;
    return out;
  }

  // ---- across the games: days practised, records, milestones, the plan -------------------------------------
  // data = { sessions, botGames, challengeGames, doublesSessions, hidden }
  function practiceDays(data, today) {
    const days = new Set();
    const add = (x) => { const d = dateOf(x); if (d) days.add(d); };
    (data.sessions || []).forEach(add);
    (data.botGames || []).filter((g) => g.result !== "abandoned").forEach(add);
    (data.challengeGames || []).forEach(add);
    (data.doublesSessions || []).forEach(add);
    const sorted = [...days].sort();
    let best = 0, run = 0, prev = null;
    for (const d of sorted) { run = prev != null && dayNumber(d) - dayNumber(prev) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = d; }
    // The streak going now: up to today, or up to yesterday when today hasn't been played yet.
    let current = 0;
    let at = dayNumber(today);
    if (!days.has(today)) at -= 1;
    const has = (n) => sorted.some((d) => dayNumber(d) === n);
    while (has(at)) { current += 1; at -= 1; }
    return { days, count: days.size, best, current, today: days.has(today) };
  }

  // Your bests, each with what it means and when.
  function records(data) {
    const h = data.hidden;
    const out = [];
    const ts = trackerStats(data.sessions, { hidden: h });
    if (ts.best) out.push({ game: "Tracker", what: "Best session", value: String(ts.best.total), date: ts.best.date, def: "Standard scoring, a finished session (not one saved part way through)." });
    const bestNums = ts.numbers.filter((n) => n.best && n.best.score >= 6).sort((a, b) => b.best.score - a.best.score).slice(0, 3);
    bestNums.forEach((n) => out.push({ game: "Tracker", what: `Best at ${n.t === "BULL" ? "the bull" : n.t}`, value: `${n.best.score} marks`, date: n.best.date, def: "The most marks with the three darts at one number." }));
    const fin = (data.botGames || []).filter(shown(h)).filter(botCounts).filter((g) => g.kind === "x01");
    const bestAvg = fin.reduce((a, g) => (!a || num(g.playerAvg) > num(a.playerAvg) ? g : a), null);
    if (bestAvg) out.push({ game: "Bot", what: "Best average in a game", value: String(num(bestAvg.playerAvg).toFixed(1)), date: dateOf(bestAvg), def: "3-dart average in a finished x01 game (won or lost; unfinished games never count)." });
    let hi = null;
    for (const g of fin.filter((x) => x.result === "won")) {
      const v = botVisits(g);
      const last = v && v.filter((x) => x.who === "player").slice(-1)[0];
      if (last && !last.bust && last.remaining === 0 && (!hi || last.scored > hi.value)) hi = { value: last.scored, date: dateOf(g) };
    }
    if (hi) out.push({ game: "Bot", what: "Highest checkout", value: String(hi.value), date: hi.date, def: "The visit that won a game." });
    const jdc = (data.challengeGames || []).filter(shown(h)).filter((g) => Number.isFinite(g.total));
    const bj = jdc.reduce((a, g) => (!a || g.total > a.total ? g : a), null);
    if (bj) out.push({ game: "JDC", what: "Best round", value: `${bj.total} / ${CE.MAX_SCORE}`, date: dateOf(bj), def: "All 57 darts." });
    const dbl = (data.doublesSessions || []).filter(shown(h)).filter((s) => typeof s.activeMs === "number" && s.activeMs > 0);
    const fast = dbl.reduce((a, s) => (!a || s.activeMs < a.activeMs ? s : a), null);
    if (fast) out.push({ game: "Doubles", what: "Fastest round", value: `${Math.floor(fast.activeMs / 60000)}:${String(Math.round((fast.activeMs % 60000) / 1000)).padStart(2, "0")}`, date: dateOf(fast), def: "Every double, D1 to the bull, by the round's timer." });
    return out;
  }

  // Milestones reached, with the day each was reached.
  function milestones(data, today) {
    const out = [];
    const h = data.hidden;
    const sess = (data.sessions || []).filter(shown(h)).sort(byTime);
    let darts = 0;
    const steps = [1000, 5000, 10000, 25000, 50000];
    for (const s of sess) {
      const before = darts;
      darts += TE.TARGETS.reduce((n, t) => n + Math.min(3, Math.max(TE.hitsOf((s.entry || {})[t]), 3)), 0);
      steps.forEach((m) => { if (before < m && darts >= m) out.push({ what: `${m.toLocaleString("en")} tracker darts`, date: dateOf(s) }); });
    }
    [100, 250, 500].forEach((m) => { if (sess.length >= m) out.push({ what: `${m} tracker sessions`, date: dateOf(sess[m - 1]) }); });
    const bots = (data.botGames || []).filter(shown(h)).filter(botCounts).sort(byTime);
    [50, 100, 250].forEach((m) => { if (bots.length >= m) out.push({ what: `${m} games against the bot`, date: dateOf(bots[m - 1]) }); });
    const first180 = bots.find((g) => { const v = botVisits(g); return v && v.some((x) => x.who === "player" && x.scored === 180 && !x.bust); });
    if (first180) out.push({ what: "First 180 against the bot", date: dateOf(first180) });
    const jdc = (data.challengeGames || []).filter(shown(h)).sort(byTime);
    const k1000 = jdc.find((g) => g.total >= 1000);
    if (k1000) out.push({ what: "1,000 in the JDC Challenge", date: dateOf(k1000) });
    const days = practiceDays(data, today);
    [7, 14, 30].forEach((m) => { if (days.best >= m) out.push({ what: `${m} days in a row`, date: null }); });
    return out.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }

  // Today's practice: one item per game, from what's weakest lately, each opening its game. done:
  // played today.
  function practicePlan(data, today) {
    const h = data.hidden;
    const playedToday = (list, ok) => (list || []).filter(shown(h)).some((x) => dateOf(x) === today && (!ok || ok(x)));
    const items = [];
    const sess = (data.sessions || []).filter(shown(h)).filter(trackerCounts).filter((s) => (s.mode || "standard") === "standard").sort(byTime).slice(-10);
    if (sess.length) {
      const weak = TE.TARGETS.map((t) => ({ t, rate: sess.reduce((n, s) => n + TE.hitsOf((s.entry || {})[t]), 0) / (sess.length * 3) }))
        .sort((a, b) => a.rate - b.rate || TE.TARGETS.indexOf(a.t) - TE.TARGETS.indexOf(b.t)).slice(0, 3);
      items.push({ game: "tracker", title: "A tracker session", href: "index.html?board=1",
        why: `Watch ${weak.map((w) => (w.t === "BULL" ? "the bull" : w.t)).join(", ").replace(/, ([^,]*)$/, " and $1")}: your lowest hit rates lately (${weak.map((w) => Math.round(w.rate * 100) + "%").join(", ")}).`,
        done: playedToday(data.sessions) });
    } else items.push({ game: "tracker", title: "A tracker session", href: "index.html?board=1", why: "Three darts at every number, 20 down to the bull.", done: playedToday(data.sessions) });
    const ds = doublesStats(data.doublesSessions, { hidden: h, last: 10 });
    items.push({ game: "doubles", title: "A Doubles round", href: "doubles.html",
      why: ds.weakest.length ? `${ds.weakest.slice(0, 3).map((d) => d.label).join(", ").replace(/, ([^,]*)$/, " and $1")} need the most work (${ds.weakest.slice(0, 3).map((d) => Math.round(d.rate * 100) + "%").join(", ")} a dart).` : "Every double, D1 to the bull, against the clock.",
      done: playedToday(data.doublesSessions) });
    const bs = botStats((data.botGames || []).filter((g) => g.kind === "x01").sort(byTime).slice(-10), { hidden: h });
    items.push({ game: "bot", title: "A game against the bot", href: "practice.html",
      why: bs.checkout.darts ? `Your checkout lately is ${Math.round(bs.checkout.rate * 100)}% of darts at a double: leave yourself D16, D20 or D8.` : "501 against the bot at your level.",
      done: playedToday(data.botGames, botCounts) });
    const js = jdcStats((data.challengeGames || []).slice(-10), { hidden: h });
    const partMax = { part1: 1050, part2: 1050, part3: 1230 };
    const gap = js.parts.filter((x) => x.last10 != null).sort((a, b) => (partMax[b.key] - b.last10) - (partMax[a.key] - a.last10))[0];
    items.push({ game: "jdc", title: "A JDC Challenge round", href: "challenge.html",
      why: gap ? `Most points are left in ${CE.PART_NAMES[{ part1: 1, part2: 2, part3: 3 }[gap.key]]} (${Math.round(gap.last10)} of ${partMax[gap.key]} lately).` : "Scoring, trebles and every double in one round.",
      done: playedToday(data.challengeGames) });
    return items;
  }

  return {
    dateOf, inRange, rolling, hiddenOf, trackerCounts, botCounts, trackerStats, landing, botVisits, botStats,
    jdcStats, doublesStats, doublesLanding, practiceDays, records, milestones, practicePlan, DKEYS,
  };
});
