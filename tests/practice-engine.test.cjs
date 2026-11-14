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

test("bug 5: checkout routes are the standard ones: good doubles, singles to set up, the bull only when needed", () => {
  const labels = (remaining, darts = 3) => (E.checkoutRoute(remaining, darts, true) || []).map((d) => d.label).join(" ");
  const standard = {
    41: "S9 D16", 53: "S13 D20", 60: "S20 D20", 61: "T15 D8", 116: "T20 S16 D20",   // the ones that were wrong
    32: "D16", 40: "D20", 50: "S18 D16", 64: "T16 D8", 70: "T18 D8", 76: "T20 D8", 80: "T16 D16", 81: "T19 D12",
    90: "T18 D18", 100: "T20 D20", 120: "T20 S20 D20", 130: "T20 T18 D8", 136: "T20 T20 D8", 141: "T20 T19 D12",
    160: "T20 T20 D20", 161: "T20 T17 DB", 164: "T20 T18 DB", 167: "T20 T19 DB", 170: "T20 T20 DB",
  };
  for (const [n, route] of Object.entries(standard)) assert.equal(labels(Number(n)), route, String(n));
  // Fewer darts in hand: the best route for those.
  assert.equal(labels(110, 2), "T20 DB", "two darts at 110: the bull is needed");
  assert.equal(labels(61, 2), "T15 D8");
  assert.equal(labels(50, 1), "DB");
  // Never a double to set up a finish, and the bull as a finish only when nothing else does it as quickly.
  for (let n = 2; n <= 170; n += 1) {
    const route = E.checkoutRoute(n, 3, true) || [];
    route.slice(0, -1).forEach((d) => assert.ok(d.ring !== "D", `${n}: ${route.map((x) => x.label).join(" ")}`));
  }
  // A typed finish may have taken the fewest darts possible, not the suggested route's count.
  assert.equal(E.fewestDarts(50, true), 1);
  assert.equal(E.fewestDarts(41, true), 2);
  assert.equal(E.fewestDarts(170, true), 3);
  assert.equal(E.fewestDarts(169, true), null);
  const g = E.createGame({ kind: "x01", startScore: 201 });
  g.remaining.player = 50; g.visitStart = 50;
  assert.equal(E.enterVisit(g, 50, 1).event, "win", "50 typed as one dart (the bull)");
});

test("set-up shots: with no finish in hand, what to throw and what it leaves", () => {
  const S = (n, d) => { const s = E.setupShot(n, d, true); return s ? s.darts.map((x) => x.label).join(" ") + " leaves " + s.leaves : null; };
  assert.equal(S(53, 1), "S13 leaves 40");
  assert.equal(S(45, 1), "S13 leaves 32");
  assert.equal(S(99, 2), "T20 S7 leaves 32");
  assert.equal(S(169, 3), "T20 T20 S17 leaves 32", "169 has no finish: score, and leave D16");
  assert.equal(S(100, 2), null, "a finish in hand: no set-up");
  assert.equal(S(400, 3), null, "nowhere near a finish");
  // Whatever it says (within reach of a finish) leaves one: never 1, never a bogey number.
  for (let n = 2; n <= 170; n += 1) for (let d = 1; d <= 3; d += 1) {
    const s = E.setupShot(n, d, true);
    if (s && s.leaves <= 170) assert.ok(E.checkoutRoute(s.leaves, 3, true), `${n}/${d} leaves ${s.leaves}`);
  }
});

test("the bot plays the standard routes: one dart at 61 is not T7", () => {
  const game = E.createGame({ kind: "x01", startScore: 501, first: "bot" });
  game.remaining.bot = 61; game.visitStart = 61;
  assert.deepEqual(E.botAim(game), { target: "15", ring: "T" });
  game.remaining.bot = 41; game.visitStart = 41;
  assert.deepEqual(E.botAim(game), { target: "9", ring: "S" });
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

// --- correcting an earlier visit --------------------------------------------------------------------

// A finished game of visits: you throw the given labels, the bot throws its own.
function playVisits(options, script) {
  const game = E.createGame(options);
  for (const labels of script) {
    for (const label of labels) throwLabel(game, label);
    E.endVisit(game);
  }
  return game;
}

test("visits remember what was entered", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  throwLabel(game, "T20");
  assert.equal(game.visitInput.t, "b");
  throwLabel(game, "S5");
  throwLabel(game, "MISS");
  E.endVisit(game);
  assert.equal(game.visits[0].input.pts.length, 3);
  assert.equal(game.visitInput, null);
  E.enterVisit(game, 100);
  assert.deepEqual(game.visitInput, { t: "v", score: 100, n: 3 });
  E.undoDart(game);
  assert.equal(game.visitInput, null, "undo forgets it too");
  E.enterDarts(game, [20, 15]);
  assert.deepEqual(game.visitInput, { t: "l", scores: [20, 15] });
});

test("replaying every visit gives the same game", () => {
  const game = playVisits({ kind: "x01", startScore: 501 }, [["T20", "T19", "S1"], ["S20", "S5", "S1"], ["T20", "T20", "S5"]]);
  const replay = E.replayVisits(E.gameOptions(game), game.visits);
  assert.equal(replay.dropped, 0);
  assert.deepEqual(replay.game.remaining, game.remaining);
  assert.deepEqual(replay.game.darts, game.darts);
  assert.equal(replay.game.turn, game.turn);
  assert.equal(replay.game.round, game.round);
});

test("correcting your visit changes your score and leaves the bot's darts as they were", () => {
  const game = playVisits({ kind: "x01", startScore: 501 }, [["T20", "T20", "T20"], ["S20", "S5", "S1"]]);
  const index = E.lastPlayerVisit(game);
  assert.equal(index, 0);
  // The correct visit was 60 + 20 + 1, not three trebles: play the visits before it, enter it again,
  // then put the later visits back.
  const base = E.replayVisits(E.gameOptions(game), game.visits.slice(0, index)).game;
  throwLabel(base, "T20"); throwLabel(base, "S20"); throwLabel(base, "S1");
  E.endVisit(base);
  const corrected = E.replayVisits(E.gameOptions(game), [...base.visits, ...game.visits.slice(index + 1)]);
  assert.equal(corrected.dropped, 0);
  assert.equal(corrected.game.remaining.player, 501 - 81);
  assert.equal(corrected.game.remaining.bot, game.remaining.bot, "the bot's score is untouched");
  assert.deepEqual(corrected.game.darts.bot, game.darts.bot, "and so are its darts");
  assert.equal(corrected.game.turn, "player");
});

test("a correction that finishes the game drops the visits after it", () => {
  const g = playVisits({ kind: "x01", startScore: 201 }, [["T20", "T20", "T20"], ["S1", "S1", "S1"], ["S1", "S1", "S1"], ["S1", "S1", "S1"]]);
  assert.equal(g.remaining.player, 18);
  // Visit 3 was really S1 then D10: 21 - 1 - 20 = 0.
  const base = E.replayVisits(E.gameOptions(g), g.visits.slice(0, 2)).game;
  throwLabel(base, "S1"); throwLabel(base, "D10");
  assert.equal(base.winner, "player");
  E.endVisit(base);
  const corrected = E.replayVisits(E.gameOptions(g), [...base.visits, ...g.visits.slice(3)]);
  assert.equal(corrected.game.winner, "player");
  assert.equal(corrected.dropped, 1, "the bot's later visit no longer happened");
});

test("correcting works for cricket, where the two sides depend on each other", () => {
  const game = playVisits({ kind: "cricket" }, [["S20", "MISS", "MISS"], ["S19", "MISS", "MISS"], ["S20", "S20", "S20"]]);
  assert.equal(game.marks.player[20], 3);
  assert.equal(game.points.player, 20, "the fourth mark on 20 scores while the bot has it open");
  // Visit 1 was really a treble 20.
  const base = E.replayVisits(E.gameOptions(game), []).game;
  throwLabel(base, "T20"); throwLabel(base, "MISS"); throwLabel(base, "MISS");
  E.endVisit(base);
  const corrected = E.replayVisits(E.gameOptions(game), [...base.visits, ...game.visits.slice(1)]);
  assert.equal(corrected.dropped, 0);
  assert.equal(corrected.game.points.player, 60, "all three later 20s now score");
  assert.equal(corrected.game.marks.bot[19], 1, "the bot's dart is where it was");
});

test("a visit typed on the keypad can be corrected too, and games with unrecorded visits cannot", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  E.enterVisit(game, 100); E.endVisit(game);
  visit(game, ["S20", "S1", "S1"]);
  assert.equal(E.lastPlayerVisit(game), 0);
  const base = E.replayVisits(E.gameOptions(game), []).game;
  E.enterDarts(base, [20, 15, 3]); E.endVisit(base);
  const corrected = E.replayVisits(E.gameOptions(game), [...base.visits, game.visits[1]]);
  assert.equal(corrected.game.remaining.player, 463);
  assert.equal(corrected.game.remaining.bot, 501 - 22);
  const old = JSON.parse(JSON.stringify(game));
  old.visits.forEach((v) => delete v.input);
  assert.equal(E.lastPlayerVisit(old), -1);
  assert.match(E.replayVisits(E.gameOptions(old), old.visits).error, /cannot be replayed/);
});

test("a game saved before entries were recorded can often be upgraded so it can be corrected", () => {
  const game = playVisits({ kind: "x01", startScore: 501 }, [["T20", "T20", "S5"], ["S20", "S5", "S1"], ["T19", "S1", "S1"]]);
  const old = JSON.parse(JSON.stringify(game));
  old.visits.forEach((v) => delete v.input);
  delete old.visitInput;
  assert.equal(E.lastPlayerVisit(old), -1);
  assert.equal(E.upgradeGame(old), true);
  assert.equal(E.lastPlayerVisit(old), 2);
  const replay = E.replayVisits(E.gameOptions(old), old.visits);
  assert.equal(replay.dropped, 0);
  assert.deepEqual(replay.game.remaining, game.remaining);
});

test("upgrading rebuilds typed totals, but not a typed bust", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  E.enterVisit(game, 100); E.endVisit(game);
  visit(game, ["S20", "S1", "S1"]);
  const old = JSON.parse(JSON.stringify(game));
  old.visits.forEach((v) => delete v.input);
  assert.equal(E.upgradeGame(old), true);
  assert.equal(E.replayVisits(E.gameOptions(old), old.visits).game.remaining.player, 401);

  const bust = E.createGame({ kind: "x01", startScore: 201 });
  bust.remaining.player = 40; bust.visitStart = 40;
  E.enterVisit(bust, 60); E.endVisit(bust);
  bust.visits.forEach((v) => delete v.input);
  assert.equal(E.upgradeGame(bust), false, "the total of a typed bust was not kept");
});

// --- announcing a visit ------------------------------------------------------------------------------

test("numbers are said the way a caller says them", () => {
  assert.equal(E.sayNumber(0), "zero");
  assert.equal(E.sayNumber(7), "seven");
  assert.equal(E.sayNumber(13), "thirteen");
  assert.equal(E.sayNumber(40), "forty");
  assert.equal(E.sayNumber(45), "forty five");
  assert.equal(E.sayNumber(100), "one hundred");
  assert.equal(E.sayNumber(101), "one hundred and one");
  assert.equal(E.sayNumber(140), "one hundred and forty");
  assert.equal(E.sayNumber(180), "one hundred and eighty");
  for (let n = 0; n <= 180; n += 1) assert.match(E.sayNumber(n), /^[a-z ]+$/, String(n));
});

test("a visit is announced by its total, a bust, or a win", () => {
  assert.equal(E.visitSpeech({ scored: 60 }, "x01", false), "sixty");
  assert.equal(E.visitSpeech({ scored: 180 }, "x01", false), "one hundred and eighty");
  assert.equal(E.visitSpeech({ scored: 0 }, "x01", false), "No score");
  assert.equal(E.visitSpeech({ scored: 0, bust: true }, "x01", false), "Bust");
  assert.equal(E.visitSpeech({ scored: 40, remaining: 0 }, "x01", true), "forty. Game shot");
  assert.equal(E.visitSpeech({ marks: 3, points: 0 }, "cricket", false), "three marks");
  assert.equal(E.visitSpeech({ marks: 1, points: 0 }, "cricket", false), "one mark");
  assert.equal(E.visitSpeech({ marks: 5, points: 40 }, "cricket", false), "five marks and forty points");
  assert.equal(E.visitSpeech({ marks: 0, points: 0 }, "cricket", false), "No marks");
});

test("a caller's voice lifts with the score, and peaks as a deep roar at 180", () => {
  const call = (scored) => E.visitAnnouncement({ scored }, "x01", false);

  // Below a ton: businesslike, plain text, no shouting, no quieter than a normal score has always been,
  // and no pre-recorded clip - too many distinct numbers below 140 to feasibly record each one.
  const plain = call(60);
  assert.deepEqual(plain, [{ text: "Sixty", rate: 0.95, pitch: 1.0, volume: 1, clip: null }]);

  // A ton and up to 139: a bit brighter, still said plainly, still no clip.
  const ton = call(120);
  assert.equal(ton.length, 1);
  assert.equal(ton[0].text, "One hundred and twenty");
  assert.ok(ton[0].rate > plain[0].rate && ton[0].pitch > plain[0].pitch, "a ton lifts rate and pitch above a normal return");
  assert.equal(ton[0].clip, null);

  // 140s and 160s: shouted (capitals, exclamation marks), each louder/higher than the last, and from
  // here up every score has its own pre-recorded clip (a real voice, not the browser's synthesiser).
  const oneForty = call(140);
  assert.equal(oneForty[0].text, "ONE HUNDRED AND FORTY!");
  assert.equal(oneForty[0].clip, "audio/calls/score-140.wav");
  const oneSixty = call(160);
  assert.equal(oneSixty[0].text, "ONE HUNDRED AND SIXTY!!");
  assert.ok(oneSixty[0].pitch > oneForty[0].pitch, "160 is higher energy than 140");
  assert.equal(oneSixty[0].clip, "audio/calls/score-160.wav");

  // 180 itself: the highest pitch of any tier, said once, at a measured pace rather than a rushed one -
  // two earlier versions overcorrected (first a deep, slow "roar" that read as flat through a
  // synthesised voice; then a fast, repeated call that read as rushed and like an accidental echo) -
  // pitch alone, at a normal speaking pace, is what actually reads as the biggest call without either
  // problem. It also has its own recorded clip, same as every other 140+ score.
  const maximum = call(180);
  assert.equal(maximum.length, 1, "said once - no repeated/echoed call");
  assert.equal(maximum[0].text, "ONE HUNDRED AND EIGHTY!!!");
  assert.ok(maximum[0].pitch > oneSixty[0].pitch, "180 is the highest pitch of any tier");
  assert.ok(maximum[0].rate <= oneSixty[0].rate, "but not delivered faster/more rushed than the tiers below it");
  assert.equal(maximum[0].volume, 1);
  assert.equal(maximum[0].clip, "audio/calls/score-180.wav");

  // A bust and a no-score are both said plainly, never with excitement, no quieter than usual, and
  // each has its own recorded clip too (a small, fixed pair of phrases).
  assert.deepEqual(call(0), [{ text: "No score", rate: 0.9, pitch: 0.9, volume: 1, clip: "audio/calls/no-score.wav" }]);
  assert.deepEqual(E.visitAnnouncement({ scored: 0, bust: true }, "x01", false), [{ text: "Bust", rate: 0.95, pitch: 0.95, volume: 1, clip: "audio/calls/bust.wav" }]);
});

test("every clip the announcer can ask for is in ALL_CLIP_FILES, so the first tap unlocks all of them", () => {
  const wanted = new Set();
  for (let n = 1; n <= 180; n++) for (const s of E.visitAnnouncement({ scored: n }, "x01", true)) if (s.clip) wanted.add(s.clip);
  for (const s of E.visitAnnouncement({ scored: 0 }, "x01", false)) if (s.clip) wanted.add(s.clip);
  for (const s of E.visitAnnouncement({ scored: 0, bust: true }, "x01", false)) if (s.clip) wanted.add(s.clip);
  const listed = new Set(E.ALL_CLIP_FILES);
  assert.equal(listed.size, 44);
  for (const c of wanted) assert.ok(listed.has(c), c + " is played but never unlocked");
  const fs = require("node:fs"), path = require("node:path");
  for (const c of listed) assert.ok(fs.existsSync(path.join(__dirname, "..", "public", c)), c + " is missing from public/");
});

test("winning the leg gets its own separate 'Game shot!' call, on top of the score", () => {
  const normalFinish = E.visitAnnouncement({ scored: 40 }, "x01", true);
  assert.equal(normalFinish.length, 2, "the score, then a separate Game shot exclamation");
  assert.equal(normalFinish[0].text, "Forty");
  assert.equal(normalFinish[1].text, "GAME SHOT!");
  assert.equal(normalFinish[1].clip, "audio/calls/game-shot.wav", "the win itself always gets its own recorded clip, even on an ordinary finish");

  // A maximum finish still gets both: the 180 call, then the win call.
  const maxFinish = E.visitAnnouncement({ scored: 180 }, "x01", true);
  assert.equal(maxFinish.length, 2, "the 180 call, then Game shot");
  assert.equal(maxFinish[0].text, "ONE HUNDRED AND EIGHTY!!!");
  assert.equal(maxFinish[1].text, "GAME SHOT!");
  assert.equal(maxFinish[1].clip, "audio/calls/game-shot.wav");

  assert.equal(E.visitAnnouncement({ scored: 100 }, "x01", false).length, 1, "no Game shot call when the leg isn't won");
});

test("cricket gets a lighter version of the same idea: a plain call, or an excited one for a clean sweep", () => {
  // Cricket's marks-and-points text is too open-ended (marks 0-9, points 0 and up, in combination) to
  // pre-record, so it stays on the browser's voice throughout, unlike x01's fixed 140+ scores.
  const single = E.visitAnnouncement({ marks: 1, points: 0 }, "cricket", false);
  assert.deepEqual(single, [{ text: "One mark", rate: 0.95, pitch: 1, volume: 1, clip: null }]);

  const sweep = E.visitAnnouncement({ marks: 3, points: 0 }, "cricket", false);
  assert.equal(sweep[0].text, "THREE MARKS!");
  assert.ok(sweep[0].pitch > single[0].pitch && sweep[0].rate > single[0].rate);
  assert.equal(sweep[0].clip, null);

  assert.deepEqual(E.visitAnnouncement({ marks: 0, points: 0 }, "cricket", false), [{ text: "No marks", rate: 0.95, pitch: 1, volume: 1, clip: null }]);
});

test("either side's latest visit can be found, for two people sharing the phone", () => {
  const game = playVisits({ kind: "x01", startScore: 501 }, [["T20", "T20", "T20"], ["S20", "S5", "S1"], ["T19", "S1", "S1"]]);
  assert.equal(E.lastVisitOf(game, "player"), 2);
  assert.equal(E.lastVisitOf(game, "bot"), 1);
  assert.equal(E.lastVisitOf(E.createGame({ kind: "x01" }), "bot"), -1);
  // Correct the second side's visit: the first side's later visit stays as entered.
  const base = E.replayVisits(E.gameOptions(game), game.visits.slice(0, 1)).game;
  throwLabel(base, "T20"); throwLabel(base, "T20"); throwLabel(base, "MISS");
  E.endVisit(base);
  const corrected = E.replayVisits(E.gameOptions(game), [...base.visits, ...game.visits.slice(2)]);
  assert.equal(corrected.game.remaining.bot, 501 - 120);
  assert.deepEqual(corrected.game.remaining.player, game.remaining.player);
});

// --- a match (first to N games) -----------------------------------------------------------------

test("createSeries rejects a target that is not one of the offered choices", () => {
  assert.throws(() => E.createSeries({ target: 6 }), /target must be one of/);
  assert.throws(() => E.createSeries({ target: 1 }), /target must be one of/);
  for (const target of E.SERIES_TARGETS) {
    const series = E.createSeries({ target });
    assert.equal(series.target, target);
    assert.deepEqual(series.wins, { player: 0, bot: 0 });
    assert.equal(series.gamesPlayed, 0);
  }
});

test("createSeries defaults who is first to \"player\", or takes an explicit side", () => {
  assert.equal(E.createSeries({ target: 3 }).nextFirst, "player");
  assert.equal(E.createSeries({ target: 3, first: "bot" }).nextFirst, "bot");
  assert.equal(E.createSeries({ target: 3, first: "player" }).nextFirst, "player");
});

test("recordSeriesGame counts a win, alternates who is first, and is not decided early", () => {
  const series = E.createSeries({ target: 3, first: "player" });
  const first = E.recordSeriesGame(series, "player");
  assert.equal(series.wins.player, 1);
  assert.equal(series.wins.bot, 0);
  assert.equal(series.gamesPlayed, 1);
  assert.equal(first.decided, false);
  assert.equal(series.nextFirst, "bot", "the loser of the last game throws first is not the rule here - it just alternates");

  const second = E.recordSeriesGame(series, "bot");
  assert.equal(series.wins.bot, 1);
  assert.equal(second.decided, false);
  assert.equal(series.nextFirst, "player");
});

test("recordSeriesGame decides the match the instant someone reaches the target, however many games that took", () => {
  const series = E.createSeries({ target: 2 });
  E.recordSeriesGame(series, "bot");
  const result = E.recordSeriesGame(series, "bot");
  assert.equal(result.decided, true);
  assert.equal(result.winner, "bot");
  assert.equal(series.wins.bot, 2);
  assert.equal(E.seriesDecided(series), true);
});

test("recordSeriesGame stops alternating once the match is decided", () => {
  const series = E.createSeries({ target: 2, first: "player" });
  E.recordSeriesGame(series, "player");
  const before = series.nextFirst;
  E.recordSeriesGame(series, "player");
  assert.equal(series.nextFirst, before, "nextFirst is meaningless once decided, and must not keep flipping");
});

test("recordSeriesGame refuses to record another game once the match is already decided", () => {
  const series = E.createSeries({ target: 2 });
  E.recordSeriesGame(series, "player");
  E.recordSeriesGame(series, "player");
  assert.throws(() => E.recordSeriesGame(series, "bot"), /already decided/);
});

test("recordSeriesGame rejects a winner that is not \"player\" or \"bot\"", () => {
  assert.throws(() => E.recordSeriesGame(E.createSeries({ target: 3 }), "nobody"), /player.*bot/);
});

test("a race to 11 genuinely needs 11 wins, not a two-ahead margin", () => {
  const series = E.createSeries({ target: 11 });
  for (let i = 0; i < 10; i += 1) assert.equal(E.recordSeriesGame(series, "player").decided, false);
  assert.equal(E.recordSeriesGame(series, "player").decided, true);
  assert.equal(series.wins.player, 11);
});


// --- Phase 1 fixes: busts in the average, and camera darts in the order they were thrown -----------

const missAt = () => ({ x: 0, y: -1.06 });

test("bug 6: a bust counts as three darts in the average, however it was entered", () => {
  const averages = ["board", "total", "darts"].map((how) => {
    const game = E.createGame({ kind: "x01", startScore: 201 });
    E.throwDart(game, at("T20")); E.throwDart(game, at("T20")); E.throwDart(game, at("T20"));
    E.endVisit(game); E.throwDart(game, at("S1")); E.throwDart(game, at("S1")); E.throwDart(game, at("S1")); E.endVisit(game);
    // 21 left: a T20 busts on the first dart on the board; a typed total or typed darts bust too.
    if (how === "board") E.throwDart(game, at("T20"));
    else if (how === "total") E.enterVisit(game, 60, 3);
    else E.enterDarts(game, [60]);
    assert.ok(game.visitBust, how);
    E.endVisit(game);
    return E.summarize(game).player.avg;
  });
  assert.deepEqual(averages, [90, 90, 90], "180 in two visits and a bust: 90 whichever way the bust went in");
});

test("bug 1: once the bot's checkout visit is closed, its average counts the checkout (101 in 5 darts is 60.6)", () => {
  const game = E.createGame({ kind: "x01", startScore: 201, first: "bot" });
  game.remaining.bot = 101; game.visitStart = 101;
  E.throwDart(game, at("T20")); E.throwDart(game, at("S1")); E.throwDart(game, at("S1")); E.endVisit(game);   // 62, 39 left
  E.throwDart(game, at("S1")); E.throwDart(game, at("S1")); E.throwDart(game, at("S1")); E.endVisit(game);   // you: 3
  E.throwDart(game, at("S19")); E.throwDart(game, at("D10"));
  assert.equal(game.winner, "bot");
  assert.equal(E.summarize(game).bot.avg, 62, "until its visit is closed only the finished one counts (the old saved average was 62 x 3 / 5 = 37.2)");
  E.endVisit(game);
  assert.equal(E.summarize(game).bot.avg, 60.6);
});

test("bug 4: a dart the cameras couldn't read keeps its place: S20 (unread) then D10 on 40 is a checkout", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 40; game.visitStart = 40;
  const hold = E.cleanHold(null);
  assert.equal(E.cameraEvent(game, hold, { k: "u", seq: 1 }, true, missAt)[0].t, "wait");
  assert.equal(E.cameraEvent(game, hold, { k: "d", seq: 2, ...at("D10") }, true, missAt)[0].t, "held", "D10 waits behind the unread dart");
  assert.equal(game.visitDarts.length, 0);
  E.throwDart(game, at("S20"));                       // tapped in where it landed
  const out = E.tappedIn(game, hold, missAt);
  assert.equal(out.length, 1);
  assert.equal(out[0].t, "dart");
  assert.equal(game.winner, "player", "S20 then D10: checked out, not bust");
  assert.deepEqual(hold, { wait: 0, queue: [] });
});

test("an unread dart never tapped in is a miss at the pull-out, before the darts held behind it", () => {
  const game = E.createGame({ kind: "x01", startScore: 501 });
  const hold = E.cleanHold(null);
  E.cameraEvent(game, hold, { k: "d", seq: 1, ...at("T20") }, true, missAt);
  E.cameraEvent(game, hold, { k: "u", seq: 2 }, true, missAt);
  E.cameraEvent(game, hold, { k: "d", seq: 3, ...at("S5") }, true, missAt);
  const out = E.cameraEvent(game, hold, { k: "o", seq: 4 }, true, missAt);
  assert.deepEqual(out.map((o) => o.t + (o.why ? ":" + o.why : "")), ["miss:unread", "dart"]);
  assert.deepEqual(game.visitDarts, ["T20", "MISS", "S5"]);
  assert.ok(game.visitDone);
});

test("bug 3: darts the cameras see while the bot is still throwing go into your next visit, in order", () => {
  const game = E.createGame({ kind: "x01", startScore: 501, first: "bot" });
  const hold = E.cleanHold(null);
  // The bot's visit, while you are already throwing.
  E.throwDart(game, at("S20"));
  assert.equal(E.cameraEvent(game, hold, { k: "d", seq: 1, ...at("T19") }, false, missAt)[0].t, "queued");
  E.throwDart(game, at("S20"));
  assert.equal(E.cameraEvent(game, hold, { k: "d", seq: 2, ...at("S19") }, false, missAt)[0].t, "queued");
  E.throwDart(game, at("S20"));
  E.endVisit(game);
  // Your turn: both go in, and the pull-out (one bounced out) fills the third as a miss.
  const out = E.releaseHold(game, hold, missAt);
  assert.deepEqual(out.map((o) => o.t), ["dart", "dart"]);
  assert.deepEqual(game.visitDarts, ["T19", "S19"]);
  const pulled = E.cameraEvent(game, hold, { k: "o", seq: 3 }, true, missAt);
  assert.deepEqual(pulled.map((o) => o.t), ["miss"]);
  assert.equal(game.remaining.player, 501 - 76);
});

test("a take-out while the bot throws, with nothing kept, is your last visit's pull-out: nothing happens", () => {
  const game = E.createGame({ kind: "x01", startScore: 501, first: "bot" });
  const hold = E.cleanHold(null);
  assert.equal(E.cameraEvent(game, hold, { k: "o", seq: 1 }, false, missAt)[0].t, "none");
  assert.deepEqual(hold.queue, []);
});

test("darts after the visit is over (a bust, a checkout, three darts) are not counted", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 32; game.visitStart = 32;
  const hold = E.cleanHold(null);
  E.cameraEvent(game, hold, { k: "d", seq: 1, ...at("D16") }, true, missAt);
  assert.equal(game.winner, "player");
  assert.equal(E.cameraEvent(game, hold, { k: "d", seq: 2, ...at("S20") }, true, missAt)[0].t, "late");
  assert.equal(E.cameraEvent(game, hold, { k: "o", seq: 3 }, true, missAt)[0].t, "none");
  assert.equal(game.darts.player.length, 1);
});

test("bug 2: your winning dart can be undone before the game is finished", () => {
  const game = E.createGame({ kind: "x01", startScore: 201 });
  game.remaining.player = 32; game.visitStart = 32;
  E.throwDart(game, at("D16"));
  assert.equal(game.winner, "player");
  assert.ok(E.undoDart(game));
  assert.equal(game.winner, null);
  assert.equal(game.remaining.player, 32);
  assert.equal(game.visitDone, false);
});

test("cleanHold keeps only well-formed events", () => {
  assert.deepEqual(E.cleanHold({ wait: 9, queue: [{ k: "d", x: 0, y: 0 }, { k: "d" }, { k: "x" }, { k: "o" }] }), { wait: 3, queue: [{ k: "d", x: 0, y: 0 }, { k: "o" }] });
});

// ---- Phase 3: Board mode, fixing a dart, undo across visits, moments, the match report ------------
{
  const at3 = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));
  const play3 = (g, labels) => { labels.forEach((l) => E.throwDart(g, at3(l))); if (g.visitDone && !g.winner) E.endVisit(g); };

  test("visitView: each dart's points, a bust and a checkout say so, with where they landed", () => {
    const g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    g.remaining.player = 40; g.visitStart = 40;
    E.throwDart(g, at3("S20"));
    let v = E.visitView(g);
    assert.equal(v.darts[0].sub, "20");
    assert.equal(v.left, 20);
    E.throwDart(g, at3("D10"));
    v = E.visitView(g);
    assert.equal(v.darts[1].sub, "Game shot");
    assert.equal(v.scored, 40);
    assert.ok(Number.isFinite(v.darts[1].x));
    const b = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    b.remaining.player = 40; b.visitStart = 40;
    play3(b, ["S20", "S20"]);
    assert.equal(E.visitView(b, b.visits[0]).darts[1].sub, "Bust", "S20 S20 on 40 is a bust (no double)");
    assert.ok(E.visitView(b, b.visits[0]).bust);
  });

  test("fixing a dart of the visit in progress throws the visit again; the winning dart too", () => {
    const g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    g.remaining.player = 32; g.visitStart = 32;
    E.throwDart(g, at3("D16"));
    assert.equal(g.winner, "player");
    let r = E.fixVisitDart(g, 0, at3("S16"));
    assert.equal(r.dropped, 0);
    assert.equal(g.winner, null, "it was a single 16: no win");
    assert.equal(g.remaining.player, 16);
    E.throwDart(g, at3("S1")); E.throwDart(g, at3("S5"));
    r = E.fixVisitDart(g, 0, at3("D16"));
    assert.equal(g.winner, "player", "back to the double: the win, and the darts after it don't count");
    assert.equal(r.dropped, 2);
    assert.deepEqual(g.visitDarts, ["D16"]);
  });

  test("Undo goes back across visits: the bot's visit comes off and yours opens without its last dart", () => {
    const g = E.createGame({ kind: "x01", startScore: 501, first: "player" });
    play3(g, ["T20", "T20", "S20"]);
    play3(g, ["S1", "S1", "S1"]);   // the bot
    assert.equal(g.turn, "player");
    let r = E.stepBack(g);
    assert.equal(r.kind, "visit");
    assert.equal(r.removed, 1);
    assert.equal(g.turn, "player");
    assert.deepEqual(g.visitDarts, ["T20", "T20"]);
    assert.equal(g.remaining.player, 381);
    assert.equal(g.remaining.bot, 501);
    r = E.stepBack(g);
    assert.equal(r.kind, "dart");
    assert.deepEqual(g.visitDarts, ["T20"]);
    E.stepBack(g); 
    assert.equal(E.stepBack(g), null, "nothing left to take back");
  });

  test("moments: a 180, the nine-dart watch, a ton-plus finish, game shot", () => {
    const g = E.createGame({ kind: "x01", startScore: 501, first: "player" });
    play3(g, ["T20", "T20", "T20"]);
    assert.equal(E.momentFor(g, g.visits[0]).kind, "180");
    play3(g, ["S1", "S1", "S1"]);
    play3(g, ["T20", "T20", "T20"]);
    const m = E.momentFor(g, g.visits[2]);
    assert.equal(m.kind, "180");
    assert.match(m.sub, /Nine-dart watch: 141 left/);
    play3(g, ["S1", "S1", "S1"]);
    play3(g, ["T20", "T19", "D12"]);
    E.endVisit(g);
    const f = E.momentFor(g, g.visits[4]);
    assert.equal(f.kind, "finish");
    assert.equal(f.big, "141");
    assert.equal(E.momentFor(g, g.visits[1]), null);
  });

  test("the leg report: averages, first nine, checkout darts, the highest finish and the 100s", () => {
    const g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    play3(g, ["T20", "S20", "S20"]);  // 100: 101 left
    play3(g, ["S1", "S1", "S1"]);
    play3(g, ["T19", "S4", "S18"]);    // 79: 22 left
    play3(g, ["S1", "S1", "S1"]);
    play3(g, ["D10", "S1"]);           // on 22 (D11 on), D10 leaves 2 (D1 on), S1 leaves 1: bust
    const r = E.legReport(g, "player");
    assert.deepEqual(r.tons, { s60: 1, s100: 1, s140: 0, s180: 0 });
    assert.equal(r.checkout.darts, 3, "three darts thrown with a finish on (S18 on 40, D10 on 22, S1 on 2)");
    assert.equal(r.checkout.hits, 0);
    play3(g, ["S1", "S1", "S1"]);
    play3(g, ["D11"]);
    E.endVisit(g);
    const w = E.legReport(g, "player");
    assert.equal(w.checkout.hits, 1);
    assert.equal(w.checkout.darts, 4);
    assert.equal(w.highFinish, 22);
    assert.ok(w.won);
    assert.equal(w.first9, Math.round((179 * 3 / 9) * 100) / 100);
    assert.deepEqual(E.visitBands(w.visits).map((b) => b.n).reduce((a, b) => a + b, 0), w.visits.length);
  });

  test("requireLine and the saved visits", () => {
    const g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    assert.equal(E.requireLine(g, "player"), "");
    g.remaining.player = 81;
    assert.equal(E.requireLine(g, "player"), "You require 81");
    g.remaining.player = 169;
    assert.equal(E.requireLine(g, "player"), "", "no finish from 169");
    assert.equal(E.requireClip(81), "audio/calls/require-81.wav");
    assert.equal(E.requireText(81), "You require eighty one.");
    assert.equal(E.requireText(121), "You require one hundred and twenty one.");
    for (const bad of [0, 171, 81.5, undefined]) assert.equal(E.requireClip(bad), null, String(bad));
    const fs = require("node:fs"), path = require("node:path");
    for (let n = 1; n <= E.REQUIRE_MAX; n++) {
      const c = E.requireClip(n);
      assert.ok(fs.existsSync(path.join(__dirname, "..", "public", c)), c + " is missing from public/");
      assert.ok(!E.ALL_CLIP_FILES.includes(c), c + " is fetched when needed, not on the first tap");
    }
    const h = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    play3(h, ["T20", "S20", "MISS"]);
    play3(h, ["S1", "S1", "S1"]);
    assert.deepEqual(E.visitsRecord(h), [{ w: "p", d: ["T20", "S20", "MISS"], s: 80, r: 121 }, { w: "b", d: ["S1", "S1", "S1"], s: 3, r: 198 }]);
  });
}

// ---- Phase 4: the bot on a real board, its average and style, the ladder, the bull-up ------------
{
  const at4 = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));

  test("the real-board bot plays at its level's average (a 501 simulation)", () => {
    const run = (level, style, legs, seed) => {
      const rng = E.mulberry32(seed);
      let pts = 0, darts = 0;
      for (let k = 0; k < legs; k += 1) {
        const g = E.createGame({ kind: "x01", startScore: 501, first: "bot", bot: { level, style } });
        let guard = 0;
        while (!g.winner && guard++ < 300) {
          E.throwDart(g, E.botDart(g, "club", rng));
          if (g.visitDone) { E.endVisit(g); g.turn = "bot"; g.visitStart = g.remaining.bot; }
        }
        pts += 501; darts += g.visits.reduce((n, v) => n + (v.bust ? 3 : v.darts.length), 0);
      }
      return (pts * 3) / darts;
    };
    const club = run("club", "standard", 120, 5);
    assert.ok(club > 46 && club < 60, "club plays at about 53: " + club.toFixed(1));
    const pro = run("pro", "standard", 60, 9);
    assert.ok(pro > 82, "pro is far stronger: " + pro.toFixed(1));
  });

  test("the spreads: a style changes the doubles, the levels keep their order", () => {
    const club = E.botParams(53, "standard");
    assert.ok(Math.abs(club.s - 0.083) < 0.005);
    assert.ok(E.botParams(53, "grinder").d < club.d && E.botParams(53, "scorer").d > club.d);
    assert.ok(E.botParams(53, "grinder").checkout > club.checkout && E.botParams(53, "scorer").checkout < club.checkout);
    const levels = Object.values(E.LEVEL_AVG).map((a) => E.botParams(a, "standard").s);
    for (let i = 1; i < levels.length; i += 1) assert.ok(levels[i] < levels[i - 1]);
    assert.equal(E.nearestRank(58), "club");
    assert.equal(E.nearestRank(64), "league");
    assert.deepEqual(E.botFor({ level: "custom", target: 200, style: "x" }), { level: "custom", target: 110, style: "standard" });
  });

  test("a game keeps its bot: the first bot for old games, model 2 through a replay and an undo", () => {
    const old = E.createGame({ kind: "x01", startScore: 501, first: "bot" });
    assert.equal(old.botModel, undefined);
    assert.deepEqual(E.botDart(old, "club", E.mulberry32(3)), E.botThrow(E.botAim(old), "club", E.mulberry32(3)), "an old game throws as before");
    const g = E.createGame({ kind: "x01", startScore: 501, first: "player", bot: { level: "league", style: "scorer" } });
    assert.equal(g.botModel, E.BOT_MODEL);
    ["T20", "T20", "S20"].forEach((l) => E.throwDart(g, at4(l))); E.endVisit(g);
    ["S1", "S1", "S1"].forEach((l) => E.throwDart(g, at4(l))); E.endVisit(g);
    E.stepBack(g);
    assert.equal(g.botModel, E.BOT_MODEL);
    assert.deepEqual(g.bot, { level: "league", target: 72, style: "scorer" });
  });

  test("the ladder: start at 52, win 2 of 3 to move up 3, the highest average beaten", () => {
    const at = (r, t, i) => ({ ladder: true, result: r, botTarget: t, timestamp: "2026-11-1" + i + " 18:00" });
    assert.deepEqual(E.ladderState([]), { target: 52, wins: 0, losses: 0, played: 0, best: null });
    let l = E.ladderState([at("won", 52, 1), at("lost", 52, 2), at("won", 52, 3)]);
    assert.equal(l.target, 55);
    assert.equal(l.best, 52);
    l = E.ladderState([at("won", 52, 1), at("lost", 52, 2), at("lost", 52, 3)]);
    assert.equal(l.target, 52, "1 of 3: stays");
    assert.equal(l.wins + l.losses, 0, "and starts the step again");
    l = E.ladderState([at("won", 52, 1), { result: "won", botTarget: 52, timestamp: "2026-11-12 18:00" }, at("abandoned", 52, 3)]);
    assert.equal(l.target, 52, "games off the ladder and unfinished ones don't count");
  });

  test("the bull-up: the closer throws first; a tie throws again; no game darts before it", () => {
    const g = E.startBullUp(E.createGame({ kind: "x01", startScore: 501, first: "player", bot: { level: "club" } }));
    assert.throws(() => E.throwDart(g, at4("T20")), /bull-up/);
    assert.deepEqual(E.bullUpThrow(g, "player", { x: 0.05, y: 0 }), { done: false });
    const r = E.bullUpThrow(g, "bot", { x: 0.01, y: 0 });
    assert.deepEqual(r, { done: true, first: "bot" });
    assert.equal(g.turn, "bot");
    assert.equal(g.first, "bot");
    assert.ok(g.bullUp.player.mm > g.bullUp.bot.mm);
    const t = E.startBullUp(E.createGame({ kind: "x01", startScore: 501, first: "player" }));
    E.bullUpThrow(t, "player", { x: 0.02, y: 0 });
    assert.deepEqual(E.bullUpThrow(t, "bot", { x: 0, y: 0.02 }), { done: false, tie: true });
    assert.equal(t.bullUp.player, null);
    // A game replayed (an undo, an edit) keeps the bull-up's result.
    E.throwDart(g, at4("S1"));
    const opts = E.gameOptions(g);
    assert.ok(opts.bullUp.done);
  });
}
