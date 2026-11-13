// Rules, bots and heat map maths for the practice page (practice.html). It has no DOM or Firebase
// in it, so `node --test tests/practice-engine.test.cjs` can check it, and the page loads the
// same file with a plain <script> tag.
//
// Positions are the same as the tracker's: x and y are fractions of the board radius from the
// centre, y growing downward, so 0,-0.58 is the middle of the treble 20.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DartsEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  // Must match drawBoard and scoreFromPoint in index.html.
  const GEOM = { bullIn: 0.05, bullOut: 0.12, tripleIn: 0.54, tripleOut: 0.62, doubleIn: 0.9, edge: 1 };
  const SEG_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 25];
  const START_SCORES = [201, 301, 401, 501, 601, 701];

  // sigma is the spread of a bot's throws as a fraction of the board radius, in each direction.
  // A 501 game comes out at roughly a 30, 42, 55, 72 and 95 three-dart average for these (the
  // engine tests check the order and a sane range).
  const RANKS = [
    { id: "beginner", name: "Beginner", sigma: 0.3, blurb: "Scatters darts all over the board." },
    { id: "casual", name: "Casual", sigma: 0.18, blurb: "Pub player. Hits the 20s now and then." },
    { id: "club", name: "Club", sigma: 0.12, blurb: "Steady, finishes most games with a few tries." },
    { id: "league", name: "League", sigma: 0.085, blurb: "Hits treble 20 often and checks out well." },
    { id: "pro", name: "Pro", sigma: 0.062, blurb: "Very tight grouping. Hard to beat." },
  ];

  const round3 = (n) => Math.round(n * 1000) / 1000;

  // --- the board --------------------------------------------------------------------------------

  // What a dart at (x, y) scored. `target` is "1" to "20", "BULL", or null off the board.
  function classify(x, y) {
    const r = Math.hypot(x, y);
    if (!(r <= GEOM.edge)) return { target: null, ring: null, mult: 0, points: 0, label: "MISS" };
    if (r <= GEOM.bullIn) return { target: "BULL", ring: "D", mult: 2, points: 50, label: "DB" };
    if (r <= GEOM.bullOut) return { target: "BULL", ring: "S", mult: 1, points: 25, label: "SB" };
    const wedge = (Math.PI * 2) / 20;
    let rel = Math.atan2(y, x) - (-Math.PI / 2 - wedge / 2);
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    const number = SEG_ORDER[Math.floor(rel / wedge)] || 20;
    let ring = "S";
    if (r >= GEOM.doubleIn) ring = "D";
    else if (r >= GEOM.tripleIn && r <= GEOM.tripleOut) ring = "T";
    const mult = ring === "T" ? 3 : ring === "D" ? 2 : 1;
    return { target: String(number), ring, mult, points: number * mult, label: ring + number };
  }

  // The middle of a region of the board: the point a player aims at.
  function aimPoint(target, ring) {
    if (target === "BULL" || Number(target) === 25) return { x: 0, y: 0 };
    const index = SEG_ORDER.indexOf(Number(target));
    if (index < 0) return { x: 0, y: 0 };
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 20;
    const radius = ring === "T" ? (GEOM.tripleIn + GEOM.tripleOut) / 2 : ring === "D" ? (GEOM.doubleIn + 1) / 2 : (GEOM.tripleOut + GEOM.doubleIn) / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  // --- randomness --------------------------------------------------------------------------------

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }

  function rankById(id) {
    return RANKS.find((rank) => rank.id === id) || RANKS[2];
  }

  // Where a bot's dart lands when it aims at { target, ring }.
  function botThrow(aim, rankId, rng) {
    const sigma = rankById(rankId).sigma;
    const point = aimPoint(aim.target, aim.ring);
    return { x: round3(point.x + gaussian(rng) * sigma), y: round3(point.y + gaussian(rng) * sigma) };
  }

  // --- finishing -----------------------------------------------------------------------------------

  const DART_OPTIONS = (() => {
    const list = [];
    for (let n = 20; n >= 1; n -= 1) {
      list.push({ target: String(n), ring: "T", points: n * 3, label: "T" + n });
    }
    for (let n = 20; n >= 1; n -= 1) {
      list.push({ target: String(n), ring: "S", points: n, label: "S" + n });
    }
    for (let n = 20; n >= 1; n -= 1) {
      list.push({ target: String(n), ring: "D", points: n * 2, label: "D" + n });
    }
    list.push({ target: "BULL", ring: "S", points: 25, label: "SB" });
    list.push({ target: "BULL", ring: "D", points: 50, label: "DB" });
    return list;
  })();

  // The doubles a player would rather be left on, best first.
  const DOUBLE_PREFERENCE = [16, 20, 8, 10, 12, 18, 4, 14, 6, 2, 19, 17, 15, 13, 11, 9, 7, 5, 3, 1];

  function finishingDarts(needed, doubleOut) {
    const matches = DART_OPTIONS.filter((dart) => dart.points === needed && (!doubleOut || dart.ring === "D"));
    const order = (dart) => {
      if (dart.target === "BULL") return 100;
      const rank = DOUBLE_PREFERENCE.indexOf(Number(dart.target));
      return (dart.ring === "S" ? 0 : dart.ring === "D" ? 20 : 40) + (rank < 0 ? 19 : rank);
    };
    return matches.sort((a, b) => order(a) - order(b));
  }

  // --- checkout routes -------------------------------------------------------------------------------
  // The route to suggest (and that the bot plays), chosen the way the standard checkout charts are:
  //   - fewest darts first; a finish on the bull counts as a dart more, so it is used only when it is
  //     needed (170, 167, 164, 161, or 50 with one dart) and 50 with three darts is S18 D16;
  //   - then the easiest darts: the double to finish on (D16 and D20 best, then D8, D10, D12...; odd
  //     doubles and D1 last), and singles rather than trebles (or the outer bull) to set it up.
  // So 41 is S9 D16 (not T13 D1), 53 S13 D20, 60 S20 D20, 61 T15 D8, 116 T20 S16 D20. With one or two
  // darts left it is the best route for those darts; with none possible, setupShot says what to leave.
  const FINISH_COST = { 16: 0, 20: 0.2, 8: 0.3, 10: 1.5, 12: 1.5, 18: 2, 4: 2.5, 14: 3, 6: 3, 2: 4, 1: 8 };
  function finishCost(dart, doubleOut) {
    if (!doubleOut) return dart.target === "BULL" ? 2 : dart.ring === "S" ? 0 : dart.ring === "D" ? 0.5 : 1;
    if (dart.target === "BULL") return 4;
    const n = Number(dart.target);
    return n in FINISH_COST ? FINISH_COST[n] : 6;
  }
  // Setting up: a single is easiest; a treble on a big number (the ones practised) easier than a small
  // one; the outer bull harder; a double, never, unless nothing else works (a miss of it changes everything).
  const setupCost = (dart) => (dart.target === "BULL" ? (dart.ring === "D" ? 3 : 2) : dart.ring === "S" ? 0 : dart.ring === "T" ? 1 + (20 - Number(dart.target)) * 0.03 : 4);
  const routeCache = new Map();

  function bestRoute(remaining, dartsLeft, doubleOut) {
    const minimum = doubleOut ? 2 : 1;
    if (!Number.isInteger(remaining) || remaining < minimum || remaining > 180 || dartsLeft < 1) return null;
    const darts = Math.min(3, dartsLeft);
    const key = remaining + "|" + darts + "|" + (doubleOut ? 1 : 0);
    if (routeCache.has(key)) return routeCache.get(key);
    const finishers = DART_OPTIONS.filter((d) => !doubleOut || d.ring === "D");
    let best = null;
    const consider = (route) => {
      const last = route[route.length - 1];
      const eff = route.length + (doubleOut && last.label === "DB" ? 1 : 0);
      const cost = route.slice(0, -1).reduce((c, d) => c + setupCost(d), 0) + finishCost(last, doubleOut);
      if (!best || eff < best.eff || (eff === best.eff && cost < best.cost - 1e-9)) best = { route, eff, cost };
    };
    for (const f of finishers) if (f.points === remaining) consider([f]);
    if (darts >= 2) {
      for (const a of DART_OPTIONS) {
        const left = remaining - a.points;
        if (left < minimum) continue;
        for (const f of finishers) if (f.points === left) consider([a, f]);
      }
    }
    if (darts >= 3) {
      for (const a of DART_OPTIONS) {
        const l1 = remaining - a.points;
        if (l1 < minimum) continue;
        for (const b of DART_OPTIONS) {
          const l2 = l1 - b.points;
          if (l2 < minimum) continue;
          for (const f of finishers) if (f.points === l2) consider([a, b, f]);
        }
      }
    }
    routeCache.set(key, best);
    return best;
  }

  // The route to finish from `remaining` with at most `dartsLeft` darts, or null.
  function checkoutRoute(remaining, dartsLeft, doubleOut) {
    const best = bestRoute(remaining, dartsLeft, doubleOut);
    return best ? best.route.slice() : null;
  }

  // The fewest darts that can finish from `remaining` (a typed finish can't have taken fewer), or null.
  function fewestDarts(remaining, doubleOut) {
    for (let n = 1; n <= 3; n += 1) {
      const minimum = doubleOut ? 2 : 1;
      if (!Number.isInteger(remaining) || remaining < minimum) return null;
      const finishers = DART_OPTIONS.filter((d) => !doubleOut || d.ring === "D");
      const can = (left, k) => (k === 1 ? finishers.some((f) => f.points === left) : DART_OPTIONS.some((d) => left - d.points >= minimum && can(left - d.points, k - 1)));
      if (can(remaining, n)) return n;
    }
    return null;
  }

  // How good a score is to be left on for the next visit (lower is better): a one-dart finish on a
  // good double best, then two darts, then three; a number with no finish (169, 168, 166, 165, 163,
  // 162, 159, or anything over 170) worst.
  function leaveQuality(left, doubleOut) {
    const best = bestRoute(left, 3, doubleOut);
    if (best) return best.eff + best.cost / 10;
    return left > 170 ? 6 + (left - 170) / 100 : 5;
  }

  // No finish with the darts left: the darts to throw, and what they leave for the next visit (on 99
  // with one dart, S19 leaves 80; on 169 with three, T20 T20 S9 leaves 40), as { darts, leaves, dart:
  // the first of them }. null when there is a finish (see checkoutRoute).
  const SETUP_DARTS = DART_OPTIONS.filter((d) => d.ring !== "D");
  const planCache = new Map();
  function plan(remaining, k, doubleOut) {
    if (k === 0) return { score: leaveQuality(remaining, doubleOut), darts: [], leaves: remaining };
    const key = remaining + "|" + k + "|" + (doubleOut ? 1 : 0);
    if (planCache.has(key)) return planCache.get(key);
    const minimum = doubleOut ? 2 : 1;
    let best = null;
    for (const dart of SETUP_DARTS) {
      const left = remaining - dart.points;
      if (left < minimum) continue;
      const next = plan(left, k - 1, doubleOut);
      const score = next.score + setupCost(dart) * 0.3;
      if (!best || score < best.score - 1e-9) best = { score, darts: [dart, ...next.darts], leaves: next.leaves };
    }
    const out = best || { score: Infinity, darts: [], leaves: remaining };
    planCache.set(key, out);
    return out;
  }
  function setupShot(remaining, dartsLeft, doubleOut) {
    const minimum = doubleOut ? 2 : 1;
    if (!Number.isInteger(remaining) || remaining < minimum || remaining > 230 || dartsLeft < 1 || checkoutRoute(remaining, dartsLeft, doubleOut)) return null;
    const best = plan(remaining, Math.min(3, dartsLeft), doubleOut);
    return best.darts.length ? { dart: best.darts[0], darts: best.darts, leaves: best.leaves } : null;
  }

  // --- games -----------------------------------------------------------------------------------------

  const other = (who) => (who === "player" ? "bot" : "player");
  const emptyMarks = () => Object.fromEntries(CRICKET_NUMBERS.map((n) => [n, 0]));

  function createGame(options) {
    const kind = options && options.kind === "cricket" ? "cricket" : "x01";
    const first = options && options.first === "bot" ? "bot" : "player";
    const game = {
      kind,
      first,
      turn: first,
      round: 1,
      visitDarts: [],
      visitInput: null,
      visitDone: false,
      winner: null,
      visits: [],
      darts: { player: [], bot: [] },
      undo: [],
    };
    if (options && options.bot) { game.botModel = BOT_MODEL; game.bot = botFor(options.bot); }
    if (options && options.bullUp && typeof options.bullUp === "object") game.bullUp = JSON.parse(JSON.stringify(options.bullUp));
    if (kind === "x01") {
      const wanted = Number(options && options.startScore);
      game.startScore = START_SCORES.includes(wanted) ? wanted : 501;
      game.doubleOut = !options || options.doubleOut !== false;
      game.remaining = { player: game.startScore, bot: game.startScore };
      game.visitStart = game.startScore;
      game.visitBust = false;
    } else {
      game.marks = { player: emptyMarks(), bot: emptyMarks() };
      game.points = { player: 0, bot: 0 };
      game.marksThrown = { player: 0, bot: 0 };
      game.visitMarks = 0;
      game.visitPoints = 0;
    }
    return game;
  }

  // --- a multi-game match (first to N games wins) -----------------------------------------------

  const SERIES_TARGETS = [2, 3, 4, 5, 7, 9, 11];

  function createSeries(options) {
    const target = Number(options && options.target);
    if (!SERIES_TARGETS.includes(target)) throw new Error("target must be one of " + SERIES_TARGETS.join(", "));
    const first = options && options.first === "bot" ? "bot" : "player";
    return { target, wins: { player: 0, bot: 0 }, gamesPlayed: 0, nextFirst: first };
  }

  function seriesDecided(series) {
    return !!series && (series.wins.player >= series.target || series.wins.bot >= series.target);
  }

  // Records one finished game's winner against the series. Mutates and returns `series`. Who
  // throws first alternates from the game just recorded, unless the series is now decided.
  function recordSeriesGame(series, winner) {
    if (seriesDecided(series)) throw new Error("This match is already decided.");
    if (winner !== "player" && winner !== "bot") throw new Error("winner must be \"player\" or \"bot\".");
    series.wins[winner] += 1;
    series.gamesPlayed += 1;
    const decided = seriesDecided(series);
    if (!decided) series.nextFirst = other(series.nextFirst);
    return { series, decided, winner };
  }

  const SNAPSHOT_FIELDS = ["remaining", "visitStart", "visitBust", "visitInput", "marks", "points", "marksThrown", "visitMarks", "visitPoints", "visitDarts", "visitDone", "winner"];

  function snapshot(game) {
    const copy = {};
    for (const field of SNAPSHOT_FIELDS) if (game[field] !== undefined) copy[field] = JSON.parse(JSON.stringify(game[field]));
    copy._dartCount = game.darts[game.turn].length;
    return JSON.stringify(copy);
  }

  function cricketClosedAll(marks) {
    return CRICKET_NUMBERS.every((n) => marks[n] >= 3);
  }

  // Score one dart for whoever's turn it is. Returns what happened.
  function throwDart(game, position) {
    if (game.winner) throw new Error("The game is over.");
    if (game.bullUp && !game.bullUp.done) throw new Error("The bull-up comes first.");
    if (game.visitDone) throw new Error("This visit is finished.");
    const who = game.turn;
    const hit = classify(Number(position.x), Number(position.y));
    game.undo.push(snapshot(game));
    game.visitDarts.push(hit.label);
    game.darts[who].push({ x: round3(position.x), y: round3(position.y), s: hit.label });
    // What was entered, so the game can be replayed after an earlier visit is corrected.
    if (!game.visitInput) game.visitInput = { t: "b", pts: [] };
    game.visitInput.pts.push({ x: round3(position.x), y: round3(position.y) });

    let event = "ok";
    if (game.kind === "x01") {
      const after = game.remaining[who] - hit.points;
      const bust = after < 0 || (game.doubleOut && (after === 1 || (after === 0 && hit.ring !== "D")));
      if (bust) {
        game.remaining[who] = game.visitStart;
        game.visitDone = true;
        game.visitBust = true;
        event = "bust";
      } else {
        game.remaining[who] = after;
        if (after === 0) {
          game.winner = who;
          game.visitDone = true;
          event = "win";
        }
      }
    } else if (CRICKET_NUMBERS.includes(hit.target === "BULL" ? 25 : Number(hit.target))) {
      const number = hit.target === "BULL" ? 25 : Number(hit.target);
      const opponent = other(who);
      for (let mark = 0; mark < hit.mult; mark += 1) {
        game.visitMarks += 1;
        game.marksThrown[who] += 1;
        if (game.marks[who][number] < 3) {
          game.marks[who][number] += 1;
        } else if (game.marks[opponent][number] < 3) {
          game.points[who] += number;
          game.visitPoints += number;
        }
      }
      if (cricketClosedAll(game.marks[who]) && game.points[who] >= game.points[opponent]) {
        game.winner = who;
        game.visitDone = true;
        event = "win";
      }
    }
    if (!game.visitDone && game.visitDarts.length >= 3) game.visitDone = true;
    return { hit, event, visitDone: game.visitDone, winner: game.winner };
  }

  // Every total three darts can make, 0 (three misses) to 180. Not all of them can: 179, 178, 176,
  // 175, 173, 172, 169, 166 and 163 cannot.
  const VISIT_SCORES = (() => {
    const values = [0, ...DART_OPTIONS.map((dart) => dart.points)];
    const totals = new Set();
    for (const a of values) for (const b of values) for (const c of values) totals.add(a + b + c);
    return totals;
  })();

  function canScoreVisit(score) {
    return Number.isInteger(score) && VISIT_SCORES.has(score);
  }

  // Scoring a whole visit from its total, for when the darts are not tapped on the board. Only for
  // x01. A total above what is left, or one that leaves 1 on a double out, is a bust; a total equal
  // to what is left finishes if a legal finish exists, and needs to say how many darts it took.
  // The darts have no positions, so they are stored as { s: "?" } and keep the counts right.
  function enterVisit(game, score, dartsUsed) {
    if (game.kind !== "x01") throw new Error("Score entry is only for x01.");
    if (game.winner) throw new Error("The game is over.");
    if (game.visitDone || game.visitDarts.length) throw new Error("This visit has already started.");
    if (!canScoreVisit(score)) throw new Error("Three darts cannot score " + score + ".");
    const who = game.turn;
    const left = game.remaining[who];
    const after = left - score;
    const fewest = after === 0 ? fewestDarts(left, game.doubleOut) : null;
    const bust = after < 0 || (game.doubleOut && after === 1) || (after === 0 && !fewest);
    let count = 3;
    if (after === 0 && fewest) {
      count = Number(dartsUsed);
      if (!Number.isInteger(count) || count < fewest || count > 3) throw new Error("A finish from " + left + " takes " + fewest + " to 3 darts.");
    }
    game.undo.push(snapshot(game));
    game.visitInput = { t: "v", score, n: count };
    for (let i = 0; i < count; i += 1) game.darts[who].push({ s: "?" });
    game.visitDarts = Array(count).fill("?");
    game.visitDone = true;
    let event = "ok";
    if (bust) {
      game.visitBust = true;
      event = "bust";
    } else {
      game.remaining[who] = after;
      if (after === 0) {
        game.winner = who;
        event = "win";
      }
    }
    return { event, score, darts: count, visitDone: true, winner: game.winner };
  }

  // What one dart can score: a miss, 1 to 20, doubles, trebles, 25 and 50.
  const DART_SCORES = new Set([0, ...DART_OPTIONS.map((dart) => dart.points)]);
  const canScoreDart = (value) => Number.isInteger(value) && DART_SCORES.has(value);
  // A dart that scored this much could have been a double (so it can finish a double-out game).
  const couldBeDouble = (value) => (value >= 2 && value <= 40 && value % 2 === 0) || value === 50;

  // What entering these darts, one score each, would do from `remaining`. Nothing is changed.
  // Returns { event: "ok" | "bust" | "win", total, left, darts } or { error }. Darts the visit did
  // not need (an ordinary visit with fewer than three entered) count as misses, so `darts` is 3;
  // a finish or a bust stops on the dart that ended it.
  function evaluateDarts(remaining, doubleOut, scores) {
    if (!Array.isArray(scores) || scores.length < 1 || scores.length > 3) return { error: "Enter one to three darts." };
    for (const value of scores) if (!canScoreDart(value)) return { error: value + " is not a score one dart can make." };
    const total = scores.reduce((sum, value) => sum + value, 0);
    let left = remaining;
    for (let i = 0; i < scores.length; i += 1) {
      const after = left - scores[i];
      const bust = after < 0 || (doubleOut && after === 1) || (after === 0 && doubleOut && !couldBeDouble(scores[i]));
      if (bust) return { event: "bust", total, left: remaining, darts: scores.length };
      if (after === 0) {
        if (i < scores.length - 1) return { error: "The game is over after dart " + (i + 1) + "." };
        return { event: "win", total, left: 0, darts: scores.length };
      }
      left = after;
    }
    return { event: "ok", total, left, darts: 3 };
  }

  // Enter a visit dart by dart (20 + 15 + 3), for when the darts are not tapped on the board. Like
  // enterVisit, the darts have no positions and are stored as { s: "?" }.
  function enterDarts(game, scores) {
    if (game.kind !== "x01") throw new Error("Score entry is only for x01.");
    if (game.winner) throw new Error("The game is over.");
    if (game.visitDone || game.visitDarts.length) throw new Error("This visit has already started.");
    const who = game.turn;
    const outcome = evaluateDarts(game.remaining[who], game.doubleOut, scores);
    if (outcome.error) throw new Error(outcome.error);
    game.undo.push(snapshot(game));
    game.visitInput = { t: "l", scores: scores.slice() };
    for (let i = 0; i < outcome.darts; i += 1) game.darts[who].push({ s: "?" });
    game.visitDarts = Array(outcome.darts).fill("?");
    game.visitDone = true;
    if (outcome.event === "bust") {
      game.visitBust = true;
    } else {
      game.remaining[who] = outcome.left;
      if (outcome.event === "win") game.winner = who;
    }
    return { event: outcome.event, score: outcome.event === "bust" ? 0 : outcome.total, darts: outcome.darts, visitDone: true, winner: game.winner };
  }

  // Take back the last dart of the visit that is still open.
  function undoDart(game) {
    if (!game.undo.length) return false;
    const before = JSON.parse(game.undo.pop());
    for (const field of SNAPSHOT_FIELDS) {
      if (before[field] !== undefined) game[field] = before[field];
      else delete game[field];
    }
    game.darts[game.turn].length = before._dartCount;
    return true;
  }

  // Record the finished visit and hand the turn over (unless someone has won).
  function endVisit(game) {
    if (!game.visitDone) throw new Error("The visit is not finished.");
    const who = game.turn;
    const visit = { who, round: game.round, darts: game.visitDarts.slice(), input: game.visitInput };
    game.visitInput = null;
    if (game.kind === "x01") {
      visit.bust = game.visitBust;
      visit.scored = game.visitStart - game.remaining[who];
      visit.remaining = game.remaining[who];
    } else {
      visit.marks = game.visitMarks;
      visit.points = game.visitPoints;
      game.visitMarks = 0;
      game.visitPoints = 0;
    }
    game.visits.push(visit);
    game.visitDarts = [];
    game.visitDone = false;
    game.undo = [];
    if (!game.winner) {
      game.turn = other(who);
      if (game.turn === game.first) game.round += 1;
    }
    if (game.kind === "x01") {
      game.visitBust = false;
      game.visitStart = game.remaining[game.turn];
    }
    return visit;
  }

  // --- announcing a visit ------------------------------------------------------------------------------

  const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

  // A number the way a caller says it: "one hundred and eighty", "forty five".
  function sayNumber(n) {
    if (!Number.isInteger(n) || n < 0 || n > 999) return String(n);
    if (n < 20) return ONES[n];
    if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
    const rest = n % 100;
    return ONES[Math.floor(n / 100)] + " hundred" + (rest ? " and " + sayNumber(rest) : "");
  }

  // What to say when a visit ends. `won` is whether it won the game.
  function visitSpeech(visit, kind, won) {
    let text;
    if (kind === "x01") {
      if (visit.bust) return "Bust";
      text = visit.scored ? sayNumber(visit.scored) : "No score";
    } else {
      const marks = visit.marks || 0, points = visit.points || 0;
      text = marks ? sayNumber(marks) + (marks === 1 ? " mark" : " marks") + (points ? " and " + sayNumber(points) + " points" : "") : "No marks";
    }
    return won ? text + ". Game shot" : text;
  }

  function cap(t) {
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // How a professional caller's voice lifts with the score - flat and businesslike for a normal
  // return, brighter for a "ton" (100+), a shout by the 140s, and by 160+ real excitement, peaking at
  // 180. Two earlier attempts both missed: dropping 180's pitch/rate below normal (copying the real
  // PDC delivery - think Russ Bray, "The Voice") read as flat/tired through a synthesised voice with
  // no rasp or chest behind it; then pushing the RATE up alongside the pitch just sounded rushed, not
  // triumphant - a big call is declared, not blurted. So 180 keeps the rate close to a normal, measured
  // pace (not faster than the tiers below it) and lets pitch alone - the highest of any tier - carry
  // the excitement, said once, clearly, without needing a rushed delivery or a repeated call to prove it.
  //
  // A crowd-noise layer was tried on top of this and taken back out - it just sounded like generic
  // stock clapping, not a caller. What actually moves the needle is the VOICE itself: a real, named PDC
  // announcer's recording is copyrighted broadcast audio and still can't be used, but the calls big
  // enough to matter (140 and up, plus Bust/No score/Game shot - a fixed, small set of exact phrases,
  // `clipForScore`/`FIXED_CLIPS` below) are pre-rendered offline with a proper neural voice (Piper,
  // MIT-licensed, using a CC BY 4.0 LibriTTS-R speaker - see `public/audio/calls/README.md`) instead of
  // the browser's built-in synthesiser, which is what actually sounds thin on a shouted line. A plain
  // return and a "ton" (1-139) stay on the browser voice: there are too many distinct numbers to
  // feasibly pre-record every one of them, and those tiers were never the ones that sounded weak.
  const SCORE_TIERS = [
    { min: 0, rate: 0.95, pitch: 1.0, volume: 1, style: (t) => cap(t) },
    { min: 100, rate: 1.0, pitch: 1.15, volume: 1, style: (t) => cap(t) },
    { min: 140, rate: 1.1, pitch: 1.35, volume: 1, style: (t) => t.toUpperCase() + "!" },
    { min: 160, rate: 1.15, pitch: 1.5, volume: 1, style: (t) => t.toUpperCase() + "!!" },
    { min: 180, rate: 1.0, pitch: 1.9, volume: 1, style: (t) => t.toUpperCase() + "!!!" },
  ];

  function scoreTier(n) {
    let tier = SCORE_TIERS[0];
    for (const t of SCORE_TIERS) if (n >= t.min) tier = t;
    return tier;
  }

  // A pre-rendered clip (path under `public/`) for the fixed set of big/special calls, or `null` when
  // there isn't one and the browser's own voice should say it instead (see the comment above
  // SCORE_TIERS). Every score from 140 to 180 has one; 1-139 do not.
  function clipForScore(n) {
    return n >= 140 && n <= 180 ? `audio/calls/score-${n}.wav` : null;
  }
  const FIXED_CLIPS = { bust: "audio/calls/bust.wav", noScore: "audio/calls/no-score.wav", gameShot: "audio/calls/game-shot.wav" };

  // Every clip file that exists, for practice.html to unlock up front on the same first tap that
  // warms up the browser's voice. Several mobile browsers only bless the exact <audio> element that
  // was played during a real user gesture - unlocking one clip does not unlock the other 43, so all of
  // them need their own play() call during that same tap, not just whichever one happens to be first.
  const ALL_CLIP_FILES = [];
  for (let n = 140; n <= 180; n++) ALL_CLIP_FILES.push(clipForScore(n));
  ALL_CLIP_FILES.push(FIXED_CLIPS.bust, FIXED_CLIPS.noScore, FIXED_CLIPS.gameShot);

  // The full call for a finished visit, as one or more utterances to speak in order, each with its own
  // voice (rate/pitch/volume, on top of whatever base voice is speaking) and an optional `clip` - a
  // pre-recorded file to play instead of the synthesised voice for that one utterance, for the fixed
  // set of calls that has one. A checkout gets its own separate "Game shot!" on top of the score - a
  // real caller states the score, then celebrates the finish - rather than one flat sentence for both,
  // and it always has its own clip regardless of the score it was checked out on.
  function visitAnnouncement(visit, kind, won) {
    const segs = [];
    if (kind === "x01") {
      if (visit.bust) segs.push({ text: "Bust", rate: 0.95, pitch: 0.95, volume: 1, clip: FIXED_CLIPS.bust });
      else if (!visit.scored) segs.push({ text: "No score", rate: 0.9, pitch: 0.9, volume: 1, clip: FIXED_CLIPS.noScore });
      else {
        const tier = scoreTier(visit.scored);
        segs.push({ text: tier.style(sayNumber(visit.scored)), rate: tier.rate, pitch: tier.pitch, volume: tier.volume, clip: clipForScore(visit.scored) });
      }
    } else {
      const marks = visit.marks || 0, points = visit.points || 0;
      if (!marks) segs.push({ text: "No marks", rate: 0.95, pitch: 1, volume: 1, clip: null });
      else {
        const text = sayNumber(marks) + (marks === 1 ? " mark" : " marks") + (points ? " and " + sayNumber(points) + " points" : "");
        const sweep = marks >= 3; // three marks in one visit - a clean sweep of the number
        segs.push({ text: sweep ? text.toUpperCase() + "!" : cap(text), rate: sweep ? 1.1 : 0.95, pitch: sweep ? 1.35 : 1, volume: 1, clip: null });
      }
    }
    if (won) segs.push({ text: "GAME SHOT!", rate: 1.05, pitch: 1.3, volume: 1, clip: FIXED_CLIPS.gameShot });
    return segs;
  }

  // --- correcting an earlier visit -------------------------------------------------------------------

  // Play a list of finished visits again from the start of a game, using exactly what was entered for
  // each. Returns { game, dropped } where `dropped` counts visits left over because the game was
  // already won before them, or { error }. Because both sides' entries are replayed as recorded, the
  // bot's darts stay where they landed even when one of yours changes.
  function replayVisits(options, visits) {
    const game = createGame(options);
    let used = 0;
    for (const visit of visits) {
      if (game.winner) break;
      if (!visit.input) return { error: "This game has a visit that cannot be replayed." };
      if (game.turn !== visit.who) return { error: "The visits do not alternate." };
      try {
        const input = visit.input;
        if (input.t === "b") for (const point of input.pts) throwDart(game, point);
        else if (input.t === "v") enterVisit(game, input.score, input.n);
        else if (input.t === "l") enterDarts(game, input.scores);
        else return { error: "Unknown visit." };
      } catch (error) {
        return { error: error.message };
      }
      if (!game.visitDone) return { error: "A visit is unfinished." };
      endVisit(game);
      used += 1;
    }
    return { game, dropped: visits.length - used };
  }

  // A game saved before visits recorded what was entered can still be corrected when the entries can
  // be worked out: board visits from the darts' positions, and typed totals from the score. A typed
  // bust cannot be (its total was not kept). Returns true when every visit can be replayed.
  function upgradeGame(game) {
    const taken = { player: 0, bot: 0 };
    for (const visit of game.visits) {
      const count = Array.isArray(visit.darts) ? visit.darts.length : 0;
      const slice = game.darts[visit.who].slice(taken[visit.who], taken[visit.who] + count);
      taken[visit.who] += count;
      if (visit.input) continue;
      if (count && slice.length === count && slice.every((d) => Number.isFinite(d.x) && Number.isFinite(d.y))) {
        visit.input = { t: "b", pts: slice.map((d) => ({ x: d.x, y: d.y })) };
      } else if (game.kind === "x01" && count && slice.length === count && visit.scored > 0 && !visit.bust) {
        visit.input = { t: "v", score: visit.scored, n: count };
      }
    }
    if (game.visitInput === undefined) game.visitInput = null;
    return game.visits.every((visit) => visit.input);
  }

  // A game's own settings, to play it again from the start (correcting or taking back a visit): the
  // bot it was started with, and a bull-up already decided, come along.
  const gameOptions = (game) => {
    const o = { kind: game.kind, startScore: game.startScore, doubleOut: game.doubleOut, first: game.first };
    if (game.botModel === BOT_MODEL && game.bot) o.bot = Object.assign({}, game.bot);
    if (game.bullUp) o.bullUp = JSON.parse(JSON.stringify(game.bullUp));
    return o;
  };

  // The position of a side's latest visit, or -1. A game can only be corrected if every visit was
  // recorded.
  function lastVisitOf(game, who) {
    if (!game.visits.every((visit) => visit.input)) return -1;
    for (let i = game.visits.length - 1; i >= 0; i -= 1) if (game.visits[i].who === who) return i;
    return -1;
  }
  const lastPlayerVisit = (game) => lastVisitOf(game, "player");

  // A bust uses up the visit: it counts as three darts in the average however it was entered (on
  // the board it stops on the dart that bust, a typed total has no darts of its own, darts typed one
  // by one stop where you stopped). Only finished visits count, so the average doesn't dip while a
  // visit is half thrown; a game's last visit (the checkout) is finished before it is saved.
  const visitDartsForAverage = (visit) => (visit.bust ? 3 : Array.isArray(visit.darts) ? visit.darts.length : 0);

  function summarize(game) {
    const result = {};
    for (const who of ["player", "bot"]) {
      const darts = game.darts[who].length;
      const mine = game.visits.filter((visit) => visit.who === who);
      if (game.kind === "x01") {
        const scored = mine.reduce((sum, visit) => sum + visit.scored, 0);
        const used = mine.reduce((sum, visit) => sum + visitDartsForAverage(visit), 0);
        result[who] = {
          darts,
          avg: used ? Math.round(((scored * 3) / used) * 100) / 100 : 0,
          score: game.remaining[who],
          best: mine.reduce((best, visit) => Math.max(best, visit.scored), 0),
        };
      } else {
        result[who] = {
          darts,
          avg: darts ? Math.round(((game.marksThrown[who] * 3) / darts) * 100) / 100 : 0,
          score: game.points[who],
          marks: game.marksThrown[who],
        };
      }
    }
    return result;
  }

  // --- camera darts in a game against the bot ------------------------------------------------------------
  // `hold` is kept with the game (the same on every device): { wait, queue }.
  //   wait   darts of your visit the cameras saw but couldn't read. The darts after them are held
  //          until you tap those in (or the darts are pulled out), so every dart goes in in the order
  //          it was thrown: on 40, S20 unread then D10 read must be S20 then D10 (a checkout), not D10
  //          then S20 (a bust). The station's dart number (e.index) can't do this: it counts only the
  //          darts it could read.
  //   queue  camera events that came while it wasn't your turn yet (the bot still throwing, its
  //          visit not closed), or that are held behind an unread dart: put in, in order, when it is
  //          your turn (releaseHold) or when the unread darts are tapped in (tappedIn).
  // An event: { k: "d", x, y, seq, label } a dart read; { k: "u", seq } a dart seen but not read;
  // { k: "o", seq } the darts pulled out. Each call returns what happened, in order:
  //   { t: "dart", result, ev }   a dart went in (result as throwDart)
  //   { t: "miss", result, ev, why }  a miss put in: "unread" (never tapped) or "unseen" (at a take-out)
  //   { t: "queued", ev } kept for your turn; { t: "held", ev } kept behind an unread dart
  //   { t: "wait", ev }   an unread dart: tap where it landed
  //   { t: "late", ev }   after your visit was over (3 darts, a bust or a checkout): not counted
  //   { t: "none", ev }   nothing to do (a take-out of a visit already over)
  function cleanHold(hold) {
    const wait = Math.max(0, Math.min(3, Math.round(Number(hold && hold.wait) || 0)));
    const queue = (Array.isArray(hold && hold.queue) ? hold.queue : []).filter((q) => q && (q.k === "d" ? Number.isFinite(q.x) && Number.isFinite(q.y) : q.k === "u" || q.k === "o")).slice(-12);
    return { wait, queue };
  }

  function cameraEvent(game, hold, ev, mine, missAt) {
    if (!mine) {
      // A take-out while the bot throws is the pull-out of your last visit, unless darts are kept.
      if (ev.k === "o" && !hold.queue.length) return [{ t: "none", ev }];
      hold.queue.push(ev);
      return [{ t: "queued", ev }];
    }
    const over = !!game.winner || game.visitDone;
    if (ev.k === "d") {
      if (over) return [{ t: "late", ev }];
      if (hold.wait) { hold.queue.push(ev); return [{ t: "held", ev }]; }
      return [{ t: "dart", result: throwDart(game, { x: ev.x, y: ev.y }), ev }];
    }
    if (ev.k === "u") {
      if (over) return [{ t: "late", ev }];
      if (hold.wait && hold.queue.length) { hold.queue.push(ev); return [{ t: "held", ev }]; }
      if (game.visitDarts.length + hold.wait >= 3) return [{ t: "late", ev }];
      hold.wait += 1;
      return [{ t: "wait", ev }];
    }
    // The darts are pulled out: unread darts never tapped in are misses, then the darts held behind
    // them go in, then the darts the cameras didn't see at all are misses.
    if (game.winner || (!game.visitDarts.length && !hold.wait && !hold.queue.length)) { hold.wait = 0; return [{ t: "none", ev }]; }
    const out = [];
    const miss = (why) => out.push({ t: "miss", result: throwDart(game, missAt()), ev, why });
    while (hold.wait > 0) { hold.wait -= 1; if (!game.visitDone && !game.winner) miss("unread"); }
    const queued = hold.queue.splice(0);
    for (const q of queued) out.push(...cameraEvent(game, hold, q, true, missAt));
    hold.wait = 0;
    while (!game.visitDone && !game.winner && game.visitDarts.length > 0 && game.visitDarts.length < 3) miss("unseen");
    return out;
  }

  // Your turn has come (the bot's visit is over): what the cameras saw meanwhile goes in, in order.
  function releaseHold(game, hold, missAt) {
    const queued = hold.queue.splice(0);
    const out = [];
    for (const q of queued) out.push(...cameraEvent(game, hold, q, true, missAt));
    return out;
  }

  // A dart you tapped in (or "Missed the board"): it fills the first unread dart's place, and once
  // none are left the darts held behind them go in.
  function tappedIn(game, hold, missAt) {
    if (!hold.wait) return [];
    hold.wait -= 1;
    return hold.wait ? [] : releaseHold(game, hold, missAt);
  }

  // --- what a bot aims at ----------------------------------------------------------------------------

  const CHASE = ["T20", "T19", "T18", "T17", "T16", "T15", "S20", "S19", "S18", "S17", "S16", "S15", "S14", "S13", "S12", "S11", "S10", "S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2", "S1", "SB"];
  const dartByLabel = (label) => DART_OPTIONS.find((dart) => dart.label === label);

  function x01Aim(game, who) {
    const remaining = game.remaining[who];
    const dartsLeft = 3 - game.visitDarts.length;
    const route = checkoutRoute(remaining, dartsLeft, game.doubleOut);
    if (route) return { target: route[0].target, ring: route[0].ring };

    // No way out this visit, close to a finish: the dart that leaves the best one for next time.
    if (remaining <= 230) {
      const setup = setupShot(remaining, dartsLeft, game.doubleOut);
      if (setup) return { target: setup.dart.target, ring: setup.dart.ring };
    }
    // Further out: score, but leave something that can be finished next time.
    const minimum = game.doubleOut ? 2 : 1;
    let best = null;
    for (const label of CHASE) {
      const dart = dartByLabel(label);
      const left = remaining - dart.points;
      if (left < minimum) continue;
      const oneDart = finishingDarts(left, game.doubleOut).length > 0;
      const twoDart = !oneDart && checkoutRoute(left, 2, game.doubleOut) !== null;
      const quality = oneDart ? 3 : twoDart ? 2 : 1;
      if (!best || quality > best.quality) best = { dart, quality };
      if (quality === 3) break;
    }
    const chosen = best ? best.dart : dartByLabel("S1");
    return { target: chosen.target, ring: chosen.ring };
  }

  function cricketAim(game, who) {
    const opponent = other(who);
    const open = CRICKET_NUMBERS.filter((n) => game.marks[who][n] < 3);
    const scoring = CRICKET_NUMBERS.filter((n) => game.marks[opponent][n] < 3);
    const number = open.length ? open[0] : scoring.length ? scoring[0] : 20;
    return number === 25 ? { target: "BULL", ring: "D" } : { target: String(number), ring: "T" };
  }

  function botAim(game) {
    return game.kind === "x01" ? x01Aim(game, game.turn) : cricketAim(game, game.turn);
  }



  // --- the bot on a real board (model 2, games from Nov 2026) -----------------------------------------
  // The first bot threw on the app's drawn board, whose treble and double rings are wider than a real
  // board's, so its doubles went in far too often. Model 2 throws in real-board units (millimetres
  // over the 170 mm radius) and maps the dart to the drawn board ring by ring (realToApp, as the
  // cameras do), so it scores what that dart would score on a real board and the dots still line up.
  // Two spreads: one for scoring darts, one for doubles (a style is the ratio between them), chosen
  // from a table measured by simulating 700 legs of 501 at each spread (scripts in the commit notes),
  // so a level plays at its average. A game keeps its model (game.botModel) and the bot it was
  // started with (game.bot), so a page still on the old code mid-game isn't mixed with this one for
  // new games, and every device throws the same darts.
  const BOT_MODEL = 2;
  const MM = { bullIn: 6.35, bullOut: 15.9, tripleIn: 99, tripleOut: 107, doubleIn: 162, edge: 170 };
  const RING_KEYS = ["bullIn", "bullOut", "tripleIn", "tripleOut", "doubleIn", "edge"];
  const REAL = {};
  for (const key of RING_KEYS) REAL[key] = MM[key] / MM.edge;
  function remapRadius(r, from, to) {
    if (!(r > 0)) return 0;
    let r0 = 0, t0 = 0;
    for (const key of RING_KEYS) {
      const r1 = from[key], t1 = to[key];
      if (r <= r1) return t0 + ((r - r0) * (t1 - t0)) / (r1 - r0);
      r0 = r1; t0 = t1;
    }
    return r;
  }
  const APP_RINGS = { bullIn: GEOM.bullIn, bullOut: GEOM.bullOut, tripleIn: GEOM.tripleIn, tripleOut: GEOM.tripleOut, doubleIn: GEOM.doubleIn, edge: GEOM.edge };
  function realToApp(p) {
    const r = Math.hypot(p.x, p.y);
    if (!r) return { x: 0, y: 0 };
    const k = remapRadius(r, REAL, APP_RINGS) / r;
    return { x: p.x * k, y: p.y * k };
  }
  function appToReal(p) {
    const r = Math.hypot(p.x, p.y);
    if (!r) return { x: 0, y: 0 };
    const k = remapRadius(r, APP_RINGS, REAL) / r;
    return { x: p.x * k, y: p.y * k };
  }
  // The middle of a bed on the real board (the outer single for "S"; the outer bull ring for SB).
  function aimReal(target, ring) {
    if (target === "BULL" || Number(target) === 25) return ring === "S" ? { x: 0, y: -(REAL.bullIn + REAL.bullOut) / 2 } : { x: 0, y: 0 };
    const index = SEG_ORDER.indexOf(Number(target));
    if (index < 0) return { x: 0, y: 0 };
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / 20;
    const radius = ring === "T" ? (REAL.tripleIn + REAL.tripleOut) / 2 : ring === "D" ? (REAL.doubleIn + REAL.edge) / 2 : (REAL.tripleOut + REAL.doubleIn) / 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  }

  // The levels' 3-dart averages, and the styles (the double spread over the scoring spread).
  const LEVEL_AVG = { beginner: 30, casual: 42, club: 53, league: 72, pro: 95 };
  const STYLES = [
    { id: "standard", name: "Standard", f: 0.85, blurb: "Scores and finishes like most players at its level." },
    { id: "grinder", name: "Steady grinder", f: 0.6, blurb: "Smaller scores, but rarely misses a double." },
    { id: "scorer", name: "Heavy scorer", f: 1.25, blurb: "Big scores, weak on the doubles." },
  ];
  const styleById = (id) => STYLES.find((st) => st.id === id) || STYLES[0];
  // [scoring spread, 3-dart average, checkout rate] per style, measured (see above).
  const CALIB = {"0.6":[[0.04,101.6,0.669],[0.045,95.3,0.621],[0.05,89.2,0.569],[0.055,84.2,0.536],[0.06,79.3,0.49],[0.065,74.1,0.45],[0.07,69.6,0.416],[0.075,65.7,0.398],[0.08,62.6,0.401],[0.085,58.4,0.351],[0.09,56.2,0.339],[0.095,52.1,0.315],[0.1,49.0,0.299],[0.11,44.3,0.268],[0.12,39.2,0.237],[0.13,35.0,0.216],[0.14,31.5,0.198],[0.16,26.3,0.17],[0.18,20.5,0.14],[0.2,17.3,0.121],[0.24,12.6,0.092],[0.28,9.3,0.069]],"0.85":[[0.035,105.2,0.57],[0.04,97.6,0.51],[0.045,91.1,0.463],[0.05,84.7,0.418],[0.055,79.5,0.39],[0.06,73.9,0.356],[0.065,68.5,0.329],[0.07,65.0,0.304],[0.075,59.8,0.287],[0.08,55.9,0.261],[0.085,51.1,0.248],[0.09,47.4,0.223],[0.095,43.1,0.202],[0.1,41.5,0.206],[0.11,35.7,0.182],[0.12,29.8,0.153],[0.13,25.6,0.136],[0.14,22.7,0.125],[0.16,17.7,0.104],[0.18,13.5,0.083],[0.2,10.7,0.07],[0.24,8.3,0.053],[0.28,6.2,0.035]],"1.25":[[0.035,97.8,0.397],[0.04,90.5,0.356],[0.045,83.1,0.316],[0.05,74.3,0.268],[0.055,69.5,0.258],[0.06,62.5,0.23],[0.065,57.3,0.214],[0.07,52.4,0.195],[0.075,47.1,0.178],[0.08,41.6,0.161],[0.085,36.9,0.145],[0.09,34.5,0.136],[0.1,27.2,0.115],[0.11,21.7,0.097],[0.12,18.6,0.086],[0.14,12.9,0.065],[0.16,9.9,0.052],[0.2,6.6,0.033],[0.24,5.4,0.022]]};
  // The spreads for a bot that averages `target` with this style: { s, d, avg, checkout }.
  function botParams(target, styleId) {
    const st = styleById(styleId);
    const rows = CALIB[String(st.f)];
    const t = Math.max(rows[rows.length - 1][1], Math.min(rows[0][1], Number(target) || 53));
    for (let i = 0; i < rows.length - 1; i += 1) {
      const a = rows[i], b = rows[i + 1];
      if (t <= a[1] && t >= b[1]) {
        const k = a[1] === b[1] ? 0 : (a[1] - t) / (a[1] - b[1]);
        const sp = a[0] + k * (b[0] - a[0]);
        return { s: sp, d: sp * st.f, avg: t, checkout: a[2] + k * (b[2] - a[2]) };
      }
    }
    const last = rows[rows.length - 1];
    return { s: last[0], d: last[0] * st.f, avg: last[1], checkout: last[2] };
  }
  // The bot a game is started with: { level, target, style }. level is a rank id, "custom" (its
  // average set by hand) or "ladder".
  function botFor(options) {
    const level = options && options.level;
    const named = Object.prototype.hasOwnProperty.call(LEVEL_AVG, level);
    const target = named ? LEVEL_AVG[level] : Math.max(15, Math.min(110, Math.round(Number(options && options.target) || 53)));
    return { level: named ? level : level === "ladder" ? "ladder" : "custom", target, style: styleById(options && options.style).id };
  }
  // The named level nearest an average (what the saved game's rank says).
  function nearestRank(target) {
    let best = "club", gap = Infinity;
    for (const [id, avg] of Object.entries(LEVEL_AVG)) { const g = Math.abs(avg - target); if (g < gap) { gap = g; best = id; } }
    return best;
  }
  // Where the bot's dart lands when it aims at { target, ring }: model 2 on a real board, or the first
  // bot (rankId) for a game started before.
  function botThrowAt(game, aim, rankId, rng) {
    if (!game || game.botModel !== BOT_MODEL || !game.bot) return botThrow(aim, rankId, rng);
    const p = botParams(game.bot.target, game.bot.style);
    const sigma = aim.ring === "D" ? p.d : p.s;
    const c = aimReal(aim.target, aim.ring);
    const real = { x: c.x + gaussian(rng) * sigma, y: c.y + gaussian(rng) * sigma };
    const app = realToApp(real);
    return { x: round3(app.x), y: round3(app.y) };
  }
  // The bot's next dart in this game.
  function botDart(game, rankId, rng) { return botThrowAt(game, botAim(game), rankId, rng); }

  // --- the bot ladder --------------------------------------------------------------------------------
  // Start at an average of 52; win 2 of 3 games at a step to move up 3. Worked out from the saved
  // ladder games (oldest first), so nothing else is stored: { target, wins, losses, played, best }.
  const LADDER = { start: 52, step: 3, top: 110 };
  function ladderState(games) {
    const list = (games || []).filter((g) => g && g.ladder === true && (g.result === "won" || g.result === "lost"))
      .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    let target = LADDER.start, wins = 0, losses = 0, best = null;
    for (const g of list) {
      if (g.result === "won") { wins += 1; best = Math.max(best || 0, Number(g.botTarget) || target); }
      else losses += 1;
      if (wins >= 2) { target = Math.min(LADDER.top, target + LADDER.step); wins = 0; losses = 0; }
      else if (wins + losses >= 3) { wins = 0; losses = 0; }
    }
    return { target, wins, losses, played: list.length, best };
  }

  // --- the bull-up -----------------------------------------------------------------------------------
  // Before the first leg, one dart each at the bull; the closer throws first (a tie: again).
  // game.bullUp = { player: { x, y, mm } | null, bot: ... | null, done, first }.
  function startBullUp(game) { game.bullUp = { player: null, bot: null, done: false, first: null }; return game; }
  const bullUpOn = (game) => !!(game && game.bullUp && !game.bullUp.done);
  // How far from the centre a dart is, in millimetres on a real board.
  const mmFromCentre = (p) => Math.round(Math.hypot(appToReal(p).x, appToReal(p).y) * MM.edge * 10) / 10;
  function bullUpThrow(game, who, position) {
    if (!bullUpOn(game) || game.bullUp[who]) return null;
    const p = { x: round3(position.x), y: round3(position.y) };
    game.bullUp[who] = { x: p.x, y: p.y, mm: mmFromCentre(p) };
    const a = game.bullUp.player, b = game.bullUp.bot;
    if (!a || !b) return { done: false };
    if (Math.abs(a.mm - b.mm) < 0.05) { game.bullUp.player = null; game.bullUp.bot = null; return { done: false, tie: true }; }
    const first = a.mm < b.mm ? "player" : "bot";
    game.bullUp.done = true; game.bullUp.first = first;
    game.first = first; game.turn = first;
    if (game.kind === "x01") game.visitStart = game.remaining[first];
    return { done: true, first };
  }

  // --- Board mode, the match report, fixing a dart, undo across visits ----------------------------------

  const pointsOf = (label) => { const d = dartByLabelAny(label); return d ? d.points : 0; };
  const dartByLabelAny = (label) => DART_OPTIONS.find((dart) => dart.label === label) || null;
  // A dart at a finish: one that could have won (a double that leaves 0; any dart, single out).
  const atFinish = (left, doubleOut) => DART_OPTIONS.some((d) => d.points === left && (!doubleOut || d.ring === "D"));

  // What one dart did in an x01 visit, for its box: { label, points, read, sub, kind }.
  // left: the score before it. A dart that bust or won says so.
  function dartWords(label, left, doubleOut) {
    const d = dartByLabelAny(label);
    const pts = d ? d.points : 0;
    const read = !d ? "Miss" : label === "DB" ? "Bull" : label === "SB" ? "25" : label;
    if (!d) return { label, points: 0, read, sub: "0", kind: "miss" };
    const after = left - pts;
    if (after < 0 || (doubleOut && (after === 1 || (after === 0 && d.ring !== "D")))) return { label, points: pts, read, sub: "Bust", kind: "miss" };
    if (after === 0) return { label, points: pts, read, sub: "Game shot", kind: "hit" };
    return { label, points: pts, read, sub: String(pts), kind: pts >= 40 ? "hit" : "stay" };
  }

  // A visit's darts for Board mode: who threw them, each dart's box, the total, and what's left.
  // From the visit in progress, or a finished visit (visit object).
  function visitView(game, visit) {
    const doubleOut = game.doubleOut !== false;
    const cur = !visit;
    const who = cur ? game.turn : visit.who;
    const labels = cur ? game.visitDarts : visit.darts || [];
    const start = cur ? game.visitStart : (visit.bust ? visit.remaining : visit.remaining + visit.scored);
    const all = game.darts[who] || [];
    // Where the darts landed: the side's last darts (a typed visit has none).
    const typed = cur ? !(game.visitInput && game.visitInput.t === "b") && labels.length > 0 : !(visit.input && visit.input.t === "b");
    let pos = [];
    if (!typed) {
      if (cur) pos = all.slice(all.length - labels.length);
      else if (visit.input && visit.input.pts) pos = visit.input.pts;
    }
    let left = start;
    const darts = labels.map((label, i) => {
      const w = game.kind === "x01" ? dartWords(label, left, doubleOut) : { label, points: 0, read: label === "MISS" ? "Miss" : label, sub: "", kind: label === "MISS" ? "miss" : "hit" };
      if (game.kind === "x01" && w.sub !== "Bust") left -= w.points;
      const p = pos[i];
      return Object.assign(w, { index: i, x: p && Number.isFinite(p.x) ? p.x : undefined, y: p && Number.isFinite(p.y) ? p.y : undefined });
    });
    const bust = cur ? !!game.visitBust : !!visit.bust;
    const scored = game.kind !== "x01" ? 0 : bust ? 0 : start - (cur ? game.remaining[who] : visit.remaining);
    return { who, darts, start, scored, bust, left: game.kind === "x01" ? (cur ? game.remaining[who] : visit.remaining) : 0, typed, done: cur ? !!game.visitDone : true };
  }

  // "You require 81": said at the start of a visit with a finish on. "" when there isn't one.
  function requireLine(game, who) {
    if (!game || game.kind !== "x01") return "";
    const rem = game.remaining[who];
    if (!(rem <= 170) || !checkoutRoute(rem, 3, game.doubleOut !== false)) return "";
    return "You require " + rem;
  }

  // Fix dart i of the visit in progress (the winning dart too, before the game is finished): the visit
  // is thrown again from that dart with the dart where it really landed. Darts after a bust or a
  // checkout no longer count. Returns { dropped } or { error }.
  function fixVisitDart(game, i, position) {
    if (!game.visitInput || game.visitInput.t !== "b") return { error: "Only darts entered on the board can be fixed." };
    const pts = game.visitInput.pts.slice();
    if (!pts[i] || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return { error: "There is no such dart." };
    pts[i] = { x: round3(position.x), y: round3(position.y) };
    while (game.visitDarts.length) if (!undoDart(game)) break;
    game.winner = null; game.visitDone = false;
    let used = 0;
    for (const p of pts) {
      if (game.visitDone) break;
      throwDart(game, p);
      used += 1;
    }
    return { dropped: pts.length - used };
  }

  // Undo across visits, one dart at a time, from any device: a dart of the visit in progress; or,
  // with none, the last visit of a side that can undo (yours; both sides with two players) is opened
  // again without its last dart, and every visit after it (the bot's) is taken off - the bot throws
  // it again. A visit typed as a total goes as a whole. The game is changed in place. Returns
  // { kind: "dart" | "visit", removed } or null.
  function stepBack(game, sides) {
    const can = sides || ["player"];
    if (game.visitDarts.length && can.includes(game.turn)) {
      undoDart(game);
      game.winner = null;
      return { kind: "dart", removed: 0 };
    }
    if (!game.visits.every((v) => v.input)) return null;
    let idx = -1;
    for (let k = game.visits.length - 1; k >= 0; k -= 1) if (can.includes(game.visits[k].who)) { idx = k; break; }
    if (idx < 0) return null;
    const v = game.visits[idx];
    const r = replayVisits(gameOptions(game), game.visits.slice(0, idx));
    if (r.error) return null;
    const g = r.game;
    if (v.input.t === "b") for (const p of v.input.pts.slice(0, -1)) throwDart(g, p);
    const removed = game.visits.length - idx - 1;
    Object.keys(game).forEach((k) => { delete game[k]; });
    Object.assign(game, g);
    return { kind: "visit", removed };
  }

  // The big moment a finished visit makes, or null: a 180, a ton-plus finish, game shot, a high
  // finish, the nine-dart watch (a 501 leg still on for nine darts after six).
  function momentFor(game, visit) {
    if (!game || !visit || game.kind !== "x01") return null;
    const won = game.winner === visit.who && game.visits[game.visits.length - 1] === visit;
    if (won && visit.scored >= 100) return { kind: "finish", big: String(visit.scored), sub: "Ton-plus finish!", who: visit.who };
    if (won) return { kind: "win", big: "Game shot", sub: visit.scored + " checkout", who: visit.who };
    const mine = game.visits.filter((v) => v.who === visit.who);
    const nine = game.startScore === 501 && mine.length === 2 && mine[1] === visit && !mine.some((v) => v.bust) && visit.remaining <= 141 && !!checkoutRoute(visit.remaining, 3, game.doubleOut !== false);
    if (!visit.bust && visit.scored === 180) return { kind: "180", big: "180", sub: nine ? "Nine-dart watch: " + visit.remaining + " left" : "One hundred and eighty!", who: visit.who };
    if (nine) return { kind: "nine", big: "Nine-dart watch", sub: visit.remaining + " left, in three darts", who: visit.who };
    return null;
  }

  // One side's leg, for the match report: darts, 3-dart average, first-9 average, checkout darts
  // (darts thrown with a finish on, and the one that won), the highest finish, 60+/100+/140+/180s,
  // and every visit's score.
  function legReport(game, who) {
    const doubleOut = game.doubleOut !== false;
    const mine = game.visits.filter((v) => v.who === who);
    if (game.kind !== "x01") {
      const darts = (game.darts[who] || []).length;
      return { who, kind: "cricket", darts, marksPerRound: darts ? Math.round((game.marksThrown[who] * 3 / darts) * 100) / 100 : 0, visits: mine.map((v) => v.marks || 0) };
    }
    let scored = 0, used = 0, f9s = 0, f9d = 0, atDouble = 0, finishes = 0, high = 0;
    const tons = { s60: 0, s100: 0, s140: 0, s180: 0 };
    mine.forEach((v, k) => {
      const n = visitDartsForAverage(v);
      scored += v.scored; used += n;
      if (k < 3) { f9s += v.scored; f9d += n; }
      const sc = v.bust ? 0 : v.scored;
      if (sc === 180) tons.s180 += 1; else if (sc >= 140) tons.s140 += 1; else if (sc >= 100) tons.s100 += 1; else if (sc >= 60) tons.s60 += 1;
      // Darts with a finish on: walk the visit's darts from its starting score.
      let left = v.bust ? v.remaining : v.remaining + v.scored;
      for (const label of v.darts || []) {
        if (atFinish(left, doubleOut)) atDouble += 1;
        const pts = pointsOf(label);
        const after = left - pts;
        if (after === 0 && (!doubleOut || /^D/.test(label))) { finishes += 1; high = Math.max(high, v.scored); break; }
        if (after < 0 || (doubleOut && after <= 1)) break;
        left = after;
      }
    });
    return {
      who, kind: "x01", visits: mine.map((v) => (v.bust ? 0 : v.scored)), darts: (game.darts[who] || []).length,
      avg: used ? Math.round((scored * 3 / used) * 100) / 100 : 0,
      first9: f9d ? Math.round((f9s * 3 / f9d) * 100) / 100 : 0,
      checkout: { hits: finishes, darts: atDouble, pct: atDouble ? finishes / atDouble : null },
      highFinish: high, tons, won: game.winner === who,
    };
  }

  // Visit scores in bands, for the report's histogram: 0-19, 20-39, ... 160-180.
  function visitBands(scores) {
    const bands = Array.from({ length: 9 }, (_, i) => ({ from: i * 20, to: i === 8 ? 180 : i * 20 + 19, n: 0 }));
    for (const sc of scores || []) bands[Math.min(8, Math.floor(Math.max(0, sc) / 20))].n += 1;
    return bands;
  }

  // Every visit, for the saved game (botGames.visits): { w: "p" | "b", d: [labels], s: scored (or
  // marks), b: 1 a bust, r: what was left, p: cricket points }.
  function visitsRecord(game) {
    return game.visits.slice(0, 400).map((v) => {
      const o = { w: v.who === "player" ? "p" : "b", d: (v.darts || []).slice(0, 3) };
      if (game.kind === "x01") { o.s = v.bust ? 0 : v.scored; o.r = v.remaining; if (v.bust) o.b = 1; }
      else { o.s = v.marks || 0; if (v.points) o.p = v.points; }
      return o;
    });
  }

  // --- heat map ------------------------------------------------------------------------------------------

  // A smoothed count of darts over the board, on an n by n grid covering -1 to 1 in each direction.
  function heatGrid(points, n = 96, bandwidth = 0.07) {
    const grid = new Float32Array(n * n);
    const cell = 2 / n;
    const reach = Math.ceil((bandwidth * 3) / cell);
    for (const point of points) {
      const cx = Math.floor((point.x + 1) / cell);
      const cy = Math.floor((point.y + 1) / cell);
      for (let gy = Math.max(0, cy - reach); gy <= Math.min(n - 1, cy + reach); gy += 1) {
        for (let gx = Math.max(0, cx - reach); gx <= Math.min(n - 1, cx + reach); gx += 1) {
          const dx = -1 + (gx + 0.5) * cell - point.x;
          const dy = -1 + (gy + 0.5) * cell - point.y;
          grid[gy * n + gx] += Math.exp(-(dx * dx + dy * dy) / (2 * bandwidth * bandwidth));
        }
      }
    }
    let max = 0;
    for (const value of grid) if (value > max) max = value;
    return { grid, max, n };
  }

  // Counts for the panel next to the heat map.
  function heatStats(points) {
    const stats = { total: points.length, triples: 0, doubles: 0, singles: 0, bulls: 0, misses: 0, targets: {} };
    for (const point of points) {
      const hit = classify(point.x, point.y);
      if (hit.target === null) stats.misses += 1;
      else if (hit.target === "BULL") stats.bulls += 1;
      else if (hit.ring === "T") stats.triples += 1;
      else if (hit.ring === "D") stats.doubles += 1;
      else stats.singles += 1;
      if (hit.target !== null) stats.targets[hit.target] = (stats.targets[hit.target] || 0) + 1;
    }
    stats.top = Object.entries(stats.targets)
      .sort((a, b) => b[1] - a[1] || (a[0] === "BULL" ? 1 : b[0] === "BULL" ? -1 : Number(b[0]) - Number(a[0])))
      .slice(0, 5)
      .map(([target, count]) => ({ target, count }));
    return stats;
  }

  // Positions from stored darts, ignoring anything that is not a number in range.
  function cleanDarts(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const item of list.slice(0, 600)) {
      if (!item || typeof item !== "object") continue;
      const x = Number(item.x);
      const y = Number(item.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1.5 || Math.abs(y) > 1.5) continue;
      out.push({ x: round3(x), y: round3(y), s: classify(x, y).label });
    }
    return out;
  }

  return {
    GEOM,
    SEG_ORDER,
    CRICKET_NUMBERS,
    START_SCORES,
    RANKS,
    classify,
    aimPoint,
    mulberry32,
    rankById,
    botThrow,
    botAim,
    checkoutRoute,
    fewestDarts,
    setupShot,
    createGame,
    SERIES_TARGETS,
    createSeries,
    recordSeriesGame,
    seriesDecided,
    throwDart,
    enterVisit,
    enterDarts,
    evaluateDarts,
    canScoreVisit,
    canScoreDart,
    undoDart,
    endVisit,
    sayNumber,
    visitSpeech,
    visitAnnouncement,
    ALL_CLIP_FILES,
    replayVisits,
    upgradeGame,
    gameOptions,
    lastVisitOf,
    lastPlayerVisit,
    summarize,
    cleanHold,
    cameraEvent,
    releaseHold,
    tappedIn,
    heatGrid,
    heatStats,
    cleanDarts,
    BOT_MODEL, LEVEL_AVG, STYLES, CALIB, botParams, botFor, nearestRank, botThrowAt, botDart, realToApp, appToReal, aimReal,
    LADDER, ladderState, startBullUp, bullUpOn, bullUpThrow, mmFromCentre,
    dartWords,
    visitView,
    requireLine,
    fixVisitDart,
    stepBack,
    momentFor,
    legReport,
    visitBands,
    visitsRecord,
  };
});
