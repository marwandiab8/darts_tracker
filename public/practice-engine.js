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
  const DOUBLE_PREFERENCE = [20, 16, 10, 8, 18, 12, 4, 2, 14, 6, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

  function finishingDarts(needed, doubleOut) {
    const matches = DART_OPTIONS.filter((dart) => dart.points === needed && (!doubleOut || dart.ring === "D"));
    const order = (dart) => {
      if (dart.target === "BULL") return 100;
      const rank = DOUBLE_PREFERENCE.indexOf(Number(dart.target));
      return (dart.ring === "S" ? 0 : dart.ring === "D" ? 20 : 40) + (rank < 0 ? 19 : rank);
    };
    return matches.sort((a, b) => order(a) - order(b));
  }

  // The shortest way to reach exactly zero from `remaining` with at most `dartsLeft` darts, or null.
  function checkoutRoute(remaining, dartsLeft, doubleOut) {
    const minimum = doubleOut ? 2 : 1;
    if (!Number.isInteger(remaining) || remaining < minimum || dartsLeft < 1) return null;
    const search = (left, count) => {
      const finishing = finishingDarts(left, doubleOut);
      if (count === 1) return finishing.length ? [finishing[0]] : null;
      for (const dart of DART_OPTIONS) {
        const after = left - dart.points;
        if (after < minimum) continue;
        const rest = search(after, count - 1);
        if (rest) return [dart, ...rest];
      }
      return null;
    };
    for (let count = 1; count <= dartsLeft; count += 1) {
      const route = search(remaining, count);
      if (route) return route;
    }
    return null;
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
    const route = after === 0 ? checkoutRoute(left, 3, game.doubleOut) : null;
    const bust = after < 0 || (game.doubleOut && after === 1) || (after === 0 && !route);
    let count = 3;
    if (after === 0 && route) {
      count = Number(dartsUsed);
      if (!Number.isInteger(count) || count < route.length || count > 3) throw new Error("A finish from " + left + " takes " + route.length + " to 3 darts.");
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

  const gameOptions = (game) => ({ kind: game.kind, startScore: game.startScore, doubleOut: game.doubleOut, first: game.first });

  // The position of a side's latest visit, or -1. A game can only be corrected if every visit was
  // recorded.
  function lastVisitOf(game, who) {
    if (!game.visits.every((visit) => visit.input)) return -1;
    for (let i = game.visits.length - 1; i >= 0; i -= 1) if (game.visits[i].who === who) return i;
    return -1;
  }
  const lastPlayerVisit = (game) => lastVisitOf(game, "player");

  function summarize(game) {
    const result = {};
    for (const who of ["player", "bot"]) {
      const darts = game.darts[who].length;
      const mine = game.visits.filter((visit) => visit.who === who);
      if (game.kind === "x01") {
        const scored = mine.reduce((sum, visit) => sum + visit.scored, 0);
        result[who] = {
          darts,
          avg: darts ? Math.round(((scored * 3) / darts) * 100) / 100 : 0,
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

  // --- what a bot aims at ----------------------------------------------------------------------------

  const CHASE = ["T20", "T19", "T18", "T17", "T16", "T15", "S20", "S19", "S18", "S17", "S16", "S15", "S14", "S13", "S12", "S11", "S10", "S9", "S8", "S7", "S6", "S5", "S4", "S3", "S2", "S1", "SB"];
  const dartByLabel = (label) => DART_OPTIONS.find((dart) => dart.label === label);

  function x01Aim(game, who) {
    const remaining = game.remaining[who];
    const dartsLeft = 3 - game.visitDarts.length;
    const route = checkoutRoute(remaining, dartsLeft, game.doubleOut);
    if (route) return { target: route[0].target, ring: route[0].ring };

    // No way out this visit: score, but leave something that can be finished next time.
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
    createGame,
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
    replayVisits,
    upgradeGame,
    gameOptions,
    lastVisitOf,
    lastPlayerVisit,
    summarize,
    heatGrid,
    heatStats,
    cleanDarts,
  };
});
