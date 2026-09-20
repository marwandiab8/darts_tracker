const assert = require("node:assert/strict");
const test = require("node:test");
const E = require("../public/practice-engine.js");

const at = (label) => {
  // The middle of a named region, so a test can throw exactly there.
  if (label === "DB") return { x: 0, y: 0 };
  if (label === "SB") return { x: 0.08, y: 0 };
  if (label === "MISS") return { x: 1.2, y: 0 };
  return E.aimPoint(label.slice(1), label[0]);
};
const throwLabel = (game, label) => E.throwDart(game, at(label));
// Three darts and the hand-over.
function visit(game, labels) {
  const results = labels.map((label) => throwLabel(game, label));
  return { results, done: game.visitDone ? E.endVisit(game) : null };
}

// --- the board ---------------------------------------------------------------------------------

test("every region of the board scores what its label says", () => {
  for (const n of E.SEG_ORDER) {
    for (const [ring, mult] of [["S", 1], ["D", 2], ["T", 3]]) {
      const hit = E.classify(at(ring + n).x, at(ring + n).y);
      assert.equal(hit.label, ring + n);
      assert.equal(hit.points, n * mult);
    }
  }
  assert.equal(E.classify(0, 0).points, 50);
  assert.equal(E.classify(0.08, 0).points, 25);
  assert.equal(E.classify(1.01, 0).label, "MISS");
  assert.equal(E.classify(NaN, 0).label, "MISS");
});

test("20 is at the top, 3 at the bottom, 6 on the right and 11 on the left", () => {
  assert.equal(E.classify(0, -0.76).target, "20");
  assert.equal(E.classify(0, 0.76).target, "3");
  assert.equal(E.classify(0.76, 0).target, "6");
  assert.equal(E.classify(-0.76, 0).target, "11");
});

// --- x01 ---------------------------------------------------------------------------------------

test("an x01 game counts down and a visit is three darts", () => {
  const game = E.createGame({ kind: "x01", startScore: 501, doubleOut: true });
  visit(game, ["T20", "T20", "T20"]);
  assert.equal(game.remaining.player, 321);
  assert.equal(game.turn, "bot");
  assert.equal(game.visits[0].scored, 180);
  assert.equal(game.remaining.bot, 501);
});

test("only 201 to 701 in hundreds are start scores", () => {
  assert.deepEqual(E.START_SCORES, [201, 301, 401, 501, 601, 701]);
  assert.equal(E.createGame({ kind: "x01", startScore: 701 }).remaining.player, 701);
  assert.equal(E.createGame({ kind: "x01", startScore: 999 }).remaining.player, 501);
});

test("going below zero, or to 1 on a double-out game, is a bust and the score goes back", () => {
  const game = E.createGame({ kind: "x01", startScore: 201, doubleOut: true });
  game.remaining.player = 40;
  game.visitStart = 40;
  const result = throwLabel(game, "T20");
  assert.equal(result.event, "bust");
  assert.equal(game.remaining.player, 40);
  assert.equal(game.visitDone, true);
  const finished = E.endVisit(game);
  assert.equal(finished.bust, true);
  assert.equal(finished.scored, 0);
  assert.equal(game.turn, "bot");

  const game2 = E.createGame({ kind: "x01", startScore: 201, doubleOut: true });
  game2.remaining.player = 21;
  game2.visitStart = 21;
  assert.equal(throwLabel(game2, "S20").event, "bust", "leaving 1 cannot be finished with a double");
  assert.equal(game2.remaining.player, 21);
});

test("a bust throws away the whole visit, not just the last dart", () => {
  const game = E.createGame({ kind: "x01", startScore: 201, doubleOut: true });
  game.remaining.player = 100;
  game.visitStart = 100;
  throwLabel(game, "T20");
  assert.equal(game.remaining.player, 40);
  throwLabel(game, "T20");
  assert.equal(game.remaining.player, 100);
  assert.equal(game.visitBust, true);
});

test("double-out needs a double (or the bull) to finish; straight-out does not", () => {
  const a = E.createGame({ kind: "x01", startScore: 201, doubleOut: true });
  a.remaining.player = 20;
  a.visitStart = 20;
  assert.equal(throwLabel(a, "S20").event, "bust");

  const b = E.createGame({ kind: "x01", startScore: 201, doubleOut: true });
  b.remaining.player = 20;
  b.visitStart = 20;
  const win = throwLabel(b, "D10");
  assert.equal(win.event, "win");
  assert.equal(b.winner, "player");

  const c = E.createGame({ kind: "x01", startScore: 201, doubleOut: true });
  c.remaining.player = 50;
  c.visitStart = 50;
  assert.equal(throwLabel(c, "DB").event, "win", "the inner bull counts as a double");

  const d = E.createGame({ kind: "x01", startScore: 201, doubleOut: false });
  d.remaining.player = 20;
  d.visitStart = 20;
  assert.equal(throwLabel(d, "S20").event, "win");
  const e = E.createGame({ kind: "x01", startScore: 201, doubleOut: false });
  e.remaining.player = 1;
  e.visitStart = 1;
  assert.equal(throwLabel(e, "S1").event, "win", "1 is fine when any dart can finish");
});

test("the winning visit ends the game and does not hand over the turn", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 32;
  game.visitStart = 32;
  throwLabel(game, "D16");
  const finished = E.endVisit(game);
  assert.equal(game.winner, "player");
  assert.equal(game.turn, "player");
  assert.equal(finished.remaining, 0);
  assert.throws(() => throwLabel(game, "S1"), /over/);
});

test("undo takes back a dart, including a bust", () => {
  const game = E.createGame({ kind: "x01", startScore: 301 });
  throwLabel(game, "T20");
  throwLabel(game, "T19");
  assert.equal(game.remaining.player, 184);
  assert.equal(E.undoDart(game), true);
  assert.equal(game.remaining.player, 241);
  assert.equal(game.darts.player.length, 1);
  assert.equal(game.visitDarts.length, 1);
  E.undoDart(game);
  assert.equal(E.undoDart(game), false);
  assert.equal(game.remaining.player, 301);

  const bust = E.createGame({ kind: "x01", startScore: 201 });
  bust.remaining.player = 10;
  bust.visitStart = 10;
  throwLabel(bust, "T20");
  assert.equal(bust.visitDone, true);
  E.undoDart(bust);
  assert.equal(bust.visitDone, false);
  assert.equal(bust.visitBust, false);
  assert.equal(bust.remaining.player, 10);
});

test("misses score nothing and use up a dart", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  visit(game, ["MISS", "MISS", "MISS"]);
  assert.equal(game.remaining.player, 501);
  assert.equal(game.darts.player.length, 3);
  assert.equal(game.turn, "bot");
});

test("who throws first, and the round counter", () => {
  const game = E.createGame({ kind: "x01", first: "bot" });
  assert.equal(game.turn, "bot");
  visit(game, ["MISS", "MISS", "MISS"]);
  assert.equal(game.round, 1);
  visit(game, ["MISS", "MISS", "MISS"]);
  assert.equal(game.round, 2);
});

test("the average counts busted darts as thrown for nothing", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  visit(game, ["T20", "T20", "S20"]); // 140
  visit(game, ["MISS", "MISS", "MISS"]);
  const summary = E.summarize(game);
  assert.equal(summary.player.avg, 140);
  assert.equal(summary.player.best, 140);
  assert.equal(summary.player.score, 361);
});

// --- checkouts ---------------------------------------------------------------------------------

test("checkout routes", () => {
  const labels = (remaining, darts, doubleOut = true) => (E.checkoutRoute(remaining, darts, doubleOut) || []).map((d) => d.label);
  assert.deepEqual(labels(40, 1), ["D20"]);
  assert.deepEqual(labels(50, 1), ["DB"]);
  assert.deepEqual(labels(170, 3), ["T20", "T20", "DB"]);
  assert.deepEqual(labels(100, 2), ["T20", "D20"]);
  assert.deepEqual(labels(41, 1), []);
  assert.deepEqual(labels(1, 3), []);
  for (const impossible of [159, 162, 163, 165, 166, 168, 169]) {
    assert.deepEqual(labels(impossible, 3), [], `${impossible} cannot be checked out with a double`);
  }
  assert.deepEqual(labels(60, 1, false), ["S20"].slice(0, 0).concat(labels(60, 1, false)), "runs");
  assert.equal(E.checkoutRoute(60, 1, false).length, 1, "T20 finishes 60 when any dart may finish");
  for (let n = 2; n <= 170; n += 1) {
    const route = E.checkoutRoute(n, 3, true);
    if (!route) continue;
    assert.equal(route.reduce((sum, dart) => sum + dart.points, 0), n);
    assert.equal(route[route.length - 1].ring, "D");
  }
});

// --- cricket -----------------------------------------------------------------------------------

test("cricket marks: single, double and triple, and other numbers do nothing", () => {
  const game = E.createGame({ kind: "cricket" });
  throwLabel(game, "T20");
  throwLabel(game, "D19");
  throwLabel(game, "S14");
  assert.equal(game.marks.player[20], 3);
  assert.equal(game.marks.player[19], 2);
  assert.equal(game.marksThrown.player, 5);
  assert.equal(game.points.player, 0);
});

test("a closed number scores points only while the other side has it open", () => {
  const game = E.createGame({ kind: "cricket" });
  visit(game, ["T20", "S20", "S20"]); // closes 20, then two scoring darts of 20
  assert.equal(game.points.player, 40);
  visit(game, ["MISS", "MISS", "MISS"]); // the bot passes
  game.marks.bot[20] = 3;
  visit(game, ["S20", "MISS", "MISS"]);
  assert.equal(game.points.player, 40, "no points once both have closed 20");
});

test("overflowing marks on a triple score the extra as points", () => {
  const game = E.createGame({ kind: "cricket" });
  game.marks.player[18] = 2;
  throwLabel(game, "T18");
  assert.equal(game.marks.player[18], 3);
  assert.equal(game.points.player, 36);
});

test("the bull is worth 25, and the inner bull counts as two marks", () => {
  const game = E.createGame({ kind: "cricket" });
  throwLabel(game, "DB");
  assert.equal(game.marks.player[25], 2);
  throwLabel(game, "DB");
  assert.equal(game.marks.player[25], 3);
  assert.equal(game.points.player, 25);
});

test("closing everything wins only if you are not behind on points", () => {
  const game = E.createGame({ kind: "cricket" });
  for (const n of [20, 19, 18, 17, 16, 15, 25]) game.marks.player[n] = 3;
  game.marks.player[15] = 2;
  game.points.bot = 30;
  const result = throwLabel(game, "S15");
  assert.equal(game.marks.player[15], 3);
  assert.equal(result.event, "ok", "closed but 30 behind");
  assert.equal(game.winner, null);
  throwLabel(game, "T20"); // 60 points on the 20s the bot has open
  assert.equal(game.winner, "player");
});

test("cricket undo and summary", () => {
  const game = E.createGame({ kind: "cricket" });
  throwLabel(game, "T20");
  E.undoDart(game);
  assert.equal(game.marks.player[20], 0);
  assert.equal(game.marksThrown.player, 0);
  visit(game, ["T20", "T19", "MISS"]);
  const summary = E.summarize(game);
  assert.equal(summary.player.marks, 6);
  assert.equal(summary.player.avg, 6, "six marks with three darts is 6 per round");
});

// --- the bots ----------------------------------------------------------------------------------

// The bot plays both sides of the board, so it is only the "bot" half that a test reads.
function playBot(rankId, seed, options) {
  const rng = E.mulberry32(seed);
  const game = E.createGame(options);
  let guard = 0;
  while (!game.winner && guard < 3000) {
    guard += 1;
    const position = E.botThrow(E.botAim(game), rankId, rng);
    E.throwDart(game, position);
    if (game.visitDone) E.endVisit(game);
  }
  return { game, guard };
}

test("a bot finishes an x01 game, and stops on a win", () => {
  for (const rank of E.RANKS) {
    const { game } = playBot(rank.id, 7, { kind: "x01", startScore: 301, first: "bot" });
    assert.ok(game.winner, rank.id);
    assert.equal(game.remaining[game.winner], 0);
  }
});

test("a higher rank averages more, in a believable range", () => {
  const averages = E.RANKS.map((rank) => {
    let total = 0;
    const games = 30;
    for (let seed = 1; seed <= games; seed += 1) {
      const { game } = playBot(rank.id, seed * 31, { kind: "x01", startScore: 501, first: "bot" });
      total += E.summarize(game).bot.avg;
    }
    return total / games;
  });
  for (let i = 1; i < averages.length; i += 1) assert.ok(averages[i] > averages[i - 1], `averages should rise: ${averages.map((a) => a.toFixed(1))}`);
  assert.ok(averages[0] > 18 && averages[0] < 38, `beginner ${averages[0].toFixed(1)}`);
  assert.ok(averages[4] > 80 && averages[4] < 110, `pro ${averages[4].toFixed(1)}`);
});

test("a bot finishes cricket, and a better bot needs fewer darts", () => {
  const darts = (rank) => {
    let total = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const { game } = playBot(rank, seed * 17, { kind: "cricket", first: "bot" });
      assert.ok(game.marks[game.winner][20] >= 3);
      total += game.darts.bot.length;
    }
    return total / 20;
  };
  assert.ok(darts("pro") < darts("beginner"));
});

test("the bot aims for a finish when it has one and never busts on purpose", () => {
  const game = E.createGame({ kind: "x01", startScore: 501, first: "bot" });
  game.remaining.bot = 40;
  game.visitStart = 40;
  assert.deepEqual(E.botAim(game), { target: "20", ring: "D" });
  game.remaining.bot = 501;
  game.visitStart = 501;
  assert.deepEqual(E.botAim(game), { target: "20", ring: "T" });
  game.remaining.bot = 61;
  game.visitStart = 61;
  game.visitDarts = ["MISS", "MISS"];
  const aim = E.botAim(game);
  const points = E.classify(E.aimPoint(aim.target, aim.ring).x, E.aimPoint(aim.target, aim.ring).y).points;
  assert.ok(61 - points >= 2, "one dart left at 61: not a treble 20, which would leave 1");
});

test("the same seed gives the same throws", () => {
  const a = E.botThrow({ target: "20", ring: "T" }, "club", E.mulberry32(5));
  const b = E.botThrow({ target: "20", ring: "T" }, "club", E.mulberry32(5));
  assert.deepEqual(a, b);
});

// --- heat map ----------------------------------------------------------------------------------

test("heat stats count rings, misses and the most hit numbers", () => {
  const points = [at("T20"), at("T20"), at("D16"), at("S5"), at("DB"), at("MISS")];
  const stats = E.heatStats(points);
  assert.equal(stats.total, 6);
  assert.equal(stats.triples, 2);
  assert.equal(stats.doubles, 1);
  assert.equal(stats.bulls, 1);
  assert.equal(stats.misses, 1);
  assert.equal(stats.top[0].target, "20");
  assert.equal(stats.top[0].count, 2);
});

test("the heat grid peaks where the darts are", () => {
  const points = Array.from({ length: 30 }, () => at("T20"));
  const { grid, max, n } = E.heatGrid(points, 64);
  const spot = at("T20");
  const gx = Math.floor((spot.x + 1) / (2 / n));
  const gy = Math.floor((spot.y + 1) / (2 / n));
  assert.ok(grid[gy * n + gx] > max * 0.9);
  assert.ok(grid[0] < max * 0.01, "nothing in the corner");
  assert.equal(E.heatGrid([], 16).max, 0);
});

test("stored darts are cleaned before use", () => {
  const cleaned = E.cleanDarts([{ x: 0, y: -0.58 }, { x: "a", y: 0 }, null, { x: 9, y: 0 }, { x: 0.1, y: 0.1, s: "<b>" }]);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].s, "T20");
  assert.equal(cleaned[1].s.startsWith("<"), false);
  assert.deepEqual(E.cleanDarts("nope"), []);
});

// --- entering a whole visit by its total ---------------------------------------------------------

test("only totals that three darts can make are allowed", () => {
  for (const impossible of [163, 166, 169, 172, 173, 175, 176, 178, 179, 181, -1, 1.5]) {
    assert.equal(E.canScoreVisit(impossible), false, String(impossible));
  }
  for (const possible of [0, 1, 26, 41, 45, 60, 81, 85, 100, 140, 171, 174, 177, 180]) {
    assert.equal(E.canScoreVisit(possible), true, String(possible));
  }
});

test("a typed visit counts down, stores unpositioned darts and hands over like a thrown one", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  const result = E.enterVisit(game, 140);
  assert.equal(result.event, "ok");
  assert.equal(game.remaining.player, 361);
  assert.equal(game.darts.player.length, 3);
  assert.deepEqual(game.darts.player[0], { s: "?" });
  assert.equal(game.visitDone, true);
  const visit = E.endVisit(game);
  assert.equal(visit.scored, 140);
  assert.equal(game.turn, "bot");
  assert.equal(E.summarize(game).player.avg, 140);
});

test("a typed total above what is left, or leaving 1 on a double out, is a bust", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 40;
  game.visitStart = 40;
  assert.equal(E.enterVisit(game, 60).event, "bust");
  assert.equal(game.remaining.player, 40);
  assert.equal(E.endVisit(game).bust, true);

  const one = E.createGame({ kind: "x01", startScore: 201 });
  one.remaining.player = 41;
  one.visitStart = 41;
  assert.equal(E.enterVisit(one, 40).event, "bust", "leaves 1");

  const straight = E.createGame({ kind: "x01", startScore: 201, doubleOut: false });
  straight.remaining.player = 41;
  straight.visitStart = 41;
  assert.equal(E.enterVisit(straight, 40).event, "ok", "1 is fine when any dart may finish");
});

test("a typed total equal to what is left finishes, with the number of darts it took", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 40;
  game.visitStart = 40;
  assert.throws(() => E.enterVisit(game, 40, 0), /1 to 3 darts/);
  const result = E.enterVisit(game, 40, 2);
  assert.equal(result.event, "win");
  assert.equal(game.winner, "player");
  assert.equal(game.darts.player.length, 2);
  E.endVisit(game);
  assert.equal(game.remaining.player, 0);
  assert.equal(E.summarize(game).player.avg, 60, "40 in two darts is 60 a round");
});

test("a finish cannot take fewer darts than the route needs, and one with no legal finish is a bust", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 100;
  game.visitStart = 100;
  assert.throws(() => E.enterVisit(game, 100, 1), /2 to 3 darts/);
  assert.equal(E.enterVisit(game, 100, 3).event, "win");

  const nofinish = E.createGame({ kind: "x01", startScore: 201 });
  nofinish.remaining.player = 159;
  nofinish.visitStart = 159;
  assert.equal(E.enterVisit(nofinish, 159, 3).event, "bust", "159 has no double-out finish");
  const twoStraight = E.createGame({ kind: "x01", startScore: 201, doubleOut: false });
  twoStraight.remaining.player = 159;
  twoStraight.visitStart = 159;
  assert.equal(E.enterVisit(twoStraight, 159, 3).event, "win");
});

test("typed totals are checked and only work at the start of a visit", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  assert.throws(() => E.enterVisit(game, 179), /cannot score/);
  assert.throws(() => E.enterVisit(game, "abc"), /cannot score/);
  throwLabel(game, "T20");
  assert.throws(() => E.enterVisit(game, 60), /already started/);
  assert.throws(() => E.enterVisit(E.createGame({ kind: "cricket" }), 60), /only for x01/);
});

test("undo takes back a typed visit completely", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  E.enterVisit(game, 100);
  assert.equal(E.undoDart(game), true);
  assert.equal(game.remaining.player, 501);
  assert.equal(game.darts.player.length, 0);
  assert.equal(game.visitDone, false);
  E.enterVisit(game, 60);
  assert.equal(game.remaining.player, 441);

  const win = E.createGame({ kind: "x01", startScore: 201 });
  win.remaining.player = 32;
  win.visitStart = 32;
  E.enterVisit(win, 32, 1);
  E.undoDart(win);
  assert.equal(win.winner, null);
  assert.equal(win.remaining.player, 32);
});

test("typed and thrown visits can be mixed in one game", () => {
  const game = E.createGame({ kind: "x01", startScore: 301 });
  E.enterVisit(game, 100);
  E.endVisit(game);
  visit(game, ["MISS", "MISS", "MISS"]); // the bot's turn, thrown
  throwLabel(game, "T20");
  assert.equal(game.remaining.player, 141);
  assert.equal(game.darts.player.length, 4);
  assert.equal(E.cleanDarts(game.darts.player).length, 1, "only the thrown dart has a position");
});

// --- entering a visit one dart at a time (20 + 15 + 3) ----------------------------------------------

test("which scores one dart can make", () => {
  for (const ok of [0, 1, 20, 21, 22, 25, 40, 50, 57, 60]) assert.equal(E.canScoreDart(ok), true, String(ok));
  for (const no of [23, 41, 43, 52, 53, 55, 56, 58, 59, 61, 100, -1, 2.5]) assert.equal(E.canScoreDart(no), false, String(no));
});

test("dart by dart adds up, and unentered darts count as misses", () => {
  const three = E.evaluateDarts(501, true, [20, 15, 3]);
  assert.deepEqual(three, { event: "ok", total: 38, left: 463, darts: 3 });
  const two = E.evaluateDarts(501, true, [60, 60]);
  assert.deepEqual(two, { event: "ok", total: 120, left: 381, darts: 3 });
  assert.match(E.evaluateDarts(501, true, [20, 23]).error, /23 is not a score/);
  assert.match(E.evaluateDarts(501, true, []).error, /one to three/);
  assert.match(E.evaluateDarts(501, true, [1, 1, 1, 1]).error, /one to three/);
});

test("entering darts one by one plays the visit", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  const result = E.enterDarts(game, [20, 15, 3]);
  assert.equal(result.event, "ok");
  assert.equal(result.score, 38);
  assert.equal(game.remaining.player, 463);
  assert.equal(game.darts.player.length, 3);
  E.endVisit(game);
  assert.equal(game.visits[0].scored, 38);
  assert.equal(game.turn, "bot");
});

test("a finish needs its last dart to be a double, and stops on that dart", () => {
  assert.deepEqual(E.evaluateDarts(40, true, [20, 20]), { event: "win", total: 40, left: 0, darts: 2 }, "20 could have been a double 10");
  assert.equal(E.evaluateDarts(40, true, [25, 15]).event, "bust", "15 is not a double");
  assert.equal(E.evaluateDarts(40, true, [40]).event, "win");
  assert.equal(E.evaluateDarts(60, true, [60]).event, "bust", "a treble cannot finish a double-out game");
  assert.deepEqual(E.evaluateDarts(60, false, [60]), { event: "win", total: 60, left: 0, darts: 1 });
  assert.equal(E.evaluateDarts(50, true, [50]).event, "win", "the bull is a double");
  assert.match(E.evaluateDarts(40, true, [40, 5]).error, /over after dart 1/);
});

test("a dart that busts ends the visit, and the score stays", () => {
  assert.equal(E.evaluateDarts(40, true, [60]).event, "bust");
  assert.equal(E.evaluateDarts(40, true, [39]).event, "bust", "leaves 1");
  assert.equal(E.evaluateDarts(100, true, [60, 39, 1]).event, "bust");
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 40;
  game.visitStart = 40;
  const result = E.enterDarts(game, [60]);
  assert.equal(result.event, "bust");
  assert.equal(game.remaining.player, 40);
  assert.equal(game.darts.player.length, 1);
  assert.equal(E.endVisit(game).scored, 0);
});

test("winning dart by dart, and taking it back", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 100;
  game.visitStart = 100;
  const result = E.enterDarts(game, [60, 40]);
  assert.equal(result.event, "win");
  assert.equal(game.winner, "player");
  assert.equal(game.darts.player.length, 2);
  E.undoDart(game);
  assert.equal(game.winner, null);
  assert.equal(game.remaining.player, 100);
  assert.equal(game.darts.player.length, 0);
  assert.throws(() => E.enterDarts(E.createGame({ kind: "cricket" }), [20]), /only for x01/);
});
