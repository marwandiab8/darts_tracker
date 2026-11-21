// The Invisible Man in the bot game (practice-engine.js): a leg of x01 against a dart limit. Check out
// within the limit to win; the dart that uses it up loses the leg. No bot throws; the limit can move.
const assert = require("node:assert/strict");
const test = require("node:test");
const E = require("../public/practice-engine.js");

const at = (label) => {
  if (label === "DB") return { x: 0, y: 0 };
  if (label === "SB") return { x: 0.08, y: 0 };
  if (label === "MISS") return { x: 1.2, y: 0 };
  return E.aimPoint(label.slice(1), label[0]);
};
const dart = (game, label) => E.throwDart(game, at(label));
// Darts until the visit is over, then the next visit (the turn never passes).
function visit(game, labels) {
  const results = [];
  for (const label of labels) { if (game.visitDone) break; results.push(dart(game, label)); }
  return { results, done: game.visitDone ? E.endVisit(game) : null };
}
const leg = (limit, extra) => E.createGame(Object.assign({ kind: "x01", startScore: 501, doubleOut: true, limit }, extra || {}));

test("a limit game is 501 with you throwing every visit: no bot, no bull-up, no cricket", () => {
  const g = E.createGame({ kind: "cricket", first: "bot", limit: 27, bot: { level: "club" }, bullUp: { player: null, bot: null, done: false } });
  assert.equal(g.kind, "x01");
  assert.equal(g.limit, 27);
  assert.equal(g.first, "player");
  assert.equal(g.turn, "player");
  assert.equal(g.bot, undefined);
  assert.equal(g.bullUp, undefined);
  assert.equal(E.isLimitGame(g), true);
  assert.equal(E.isLimitGame(E.createGame({ kind: "x01" })), false);
  assert.equal(E.limitLeft(g), 27);
  visit(g, ["T20", "T20", "T20"]);
  assert.equal(g.turn, "player");
  assert.equal(g.round, 2);
  assert.equal(E.limitLeft(g), 24);
  assert.equal(g.remaining.player, 321);
  assert.equal(g.remaining.bot, 501);
});

test("a 9-dart leg wins against any limit", () => {
  const g = leg(21);
  visit(g, ["T20", "T20", "T20"]);
  visit(g, ["T20", "T20", "T20"]);
  const last = visit(g, ["T20", "T19", "D12"]);
  assert.equal(g.winner, "player");
  assert.equal(last.results[2].event, "win");
  assert.equal(g.darts.player.length, 9);
  assert.equal(E.legReport(g, "player").won, true);
});

test("the dart that uses up the limit without a checkout loses the leg to the Invisible Man", () => {
  const g = leg(9);
  visit(g, ["S20", "S20", "S20"]);
  visit(g, ["S20", "S20", "S20"]);
  const r = visit(g, ["S20", "S20", "S1"]);
  assert.equal(g.winner, "bot");
  assert.equal(r.results[2].event, "limit");
  assert.equal(r.results[2].winner, "bot");
  assert.equal(g.remaining.player, 501 - 161);
  assert.equal(E.limitLeft(g), 0);
  const m = E.momentFor(g, r.done);
  assert.equal(m.kind, "limit");
  assert.equal(m.big, "Out of darts");
  assert.equal(m.sub, "340 left after 9 darts");
});

test("a bust on the last dart of the limit loses too", () => {
  const g = E.createGame({ kind: "x01", startScore: 201, limit: 6 });
  visit(g, ["T20", "T20", "T20"]); // 21 left
  const r = visit(g, ["S1", "S10", "T20"]); // 10 left, then a bust on the 6th dart
  assert.equal(r.results[2].event, "bust");
  assert.equal(g.winner, "bot");
  assert.equal(g.remaining.player, 21);
});

test("a limit that isn't a multiple of 3: the last visit has the darts left, and ends on the last one", () => {
  const g = leg(26);
  for (let i = 0; i < 8; i += 1) visit(g, ["S1", "S1", "S1"]);
  assert.equal(E.limitLeft(g), 2);
  assert.equal(E.visitMax(g), 2);
  const r1 = dart(g, "S1");
  assert.equal(r1.visitDone, false);
  assert.equal(E.visitMax(g), 2);
  const r2 = dart(g, "S1");
  assert.equal(r2.visitDone, true);
  assert.equal(r2.event, "limit");
  assert.equal(g.winner, "bot");
  assert.throws(() => dart(g, "S1"), /over/);
});

test("the keypad: a typed visit in the last darts uses only the darts left, and a total they can't make is refused", () => {
  const g = E.createGame({ kind: "x01", startScore: 501, limit: 5 });
  E.enterVisit(g, 100); E.endVisit(g); // 3 darts
  assert.equal(E.visitMax(g), 2);
  assert.throws(() => E.enterVisit(g, 140), /Two darts cannot score 140/);
  const r = E.enterVisit(g, 120);
  assert.equal(r.darts, 2);
  assert.equal(r.event, "limit");
  assert.equal(g.winner, "bot");
  assert.equal(g.darts.player.length, 5);
  // A total that leaves 0 but needs more darts than are left is a bust: 99 with two darts.
  const h = E.createGame({ kind: "x01", startScore: 201, limit: 5 });
  E.enterVisit(h, 102); E.endVisit(h); // 99 left, 2 darts
  const b = E.enterVisit(h, 99);
  assert.equal(b.event, "bust");
  assert.equal(h.remaining.player, 99);
  assert.equal(h.winner, "bot");
});

test("the keypad: a checkout typed in the last two darts wins, and darts typed one by one stop at the limit", () => {
  const g = E.createGame({ kind: "x01", startScore: 201, limit: 5 });
  E.enterVisit(g, 101); E.endVisit(g); // 100 left, 2 darts
  const r = E.enterVisit(g, 100, 2);
  assert.equal(r.event, "win");
  assert.equal(g.winner, "player");
  const h = E.createGame({ kind: "x01", startScore: 201, limit: 4 });
  E.enterVisit(h, 60); E.endVisit(h); // 141 left, 1 dart
  assert.throws(() => E.enterDarts(h, [20, 20]), /Only 1 dart is left/);
  const d = E.enterDarts(h, [20]);
  assert.equal(d.darts, 1);
  assert.equal(d.event, "limit");
  assert.equal(h.winner, "bot");
  const k = E.createGame({ kind: "x01", startScore: 201, limit: 5 });
  E.enterVisit(k, 60); E.endVisit(k); // 141 left, 2 darts
  const two = E.enterDarts(k, [60]); // one dart typed: the other is a miss
  assert.equal(two.darts, 2);
  assert.equal(k.winner, "bot");
});

test("Undo takes back the dart that ran out the limit, and the leg is on again", () => {
  const g = E.createGame({ kind: "x01", startScore: 501, limit: 3 });
  dart(g, "T20"); dart(g, "T20");
  const r = dart(g, "MISS");
  assert.equal(r.event, "limit");
  assert.equal(g.winner, "bot");
  assert.equal(E.undoDart(g), true);
  assert.equal(g.winner, null);
  assert.equal(g.visitDone, false);
  assert.equal(E.limitLeft(g), 1);
  dart(g, "T20");
  assert.equal(g.winner, "bot");
});

test("Edit my last visit replays the leg with the limit: a corrected last visit can win it", () => {
  const g = E.createGame({ kind: "x01", startScore: 201, limit: 6 });
  visit(g, ["T20", "T20", "S20"]); // 61 left
  visit(g, ["S1", "MISS", "S1"]); // read wrong: 59 left, out of darts
  assert.equal(g.winner, "bot");
  const fixed = g.visits.slice(0, 1);
  const r = E.replayVisits(E.gameOptions(g), fixed);
  assert.equal(r.game.limit, 6);
  const h = r.game;
  visit(h, ["T15", "D8"]);
  assert.equal(h.winner, "player");
  assert.equal(h.darts.player.length, 5);
});

test("stepBack opens your last visit again against the Invisible Man", () => {
  const g = leg(27);
  visit(g, ["T20", "T20", "T20"]);
  visit(g, ["S20", "S20", "S20"]);
  const r = E.stepBack(g, ["player"]);
  assert.equal(r.kind, "visit");
  assert.equal(g.limit, 27);
  assert.deepEqual(g.visitDarts, ["S20", "S20"]);
  assert.equal(E.limitLeft(g), 22);
});

test("the cameras: a take-out fills the visit with misses up to the darts left, and a dart after the limit is late", () => {
  const g = E.createGame({ kind: "x01", startScore: 501, limit: 5 });
  let hold = E.cleanHold(null);
  const ev = (label, seq) => ({ k: "d", x: at(label).x, y: at(label).y, seq });
  E.cameraEvent(g, hold, ev("T20", 1), true, () => at("MISS"));
  E.cameraEvent(g, hold, { k: "o", seq: 2 }, true, () => at("MISS"));
  assert.deepEqual(g.visitDarts, ["T20", "MISS", "MISS"]);
  E.endVisit(g);
  E.cameraEvent(g, hold, ev("T20", 3), true, () => at("MISS"));
  // An unread dart, then another: only 2 darts in this visit, so the third is late.
  hold = E.cleanHold(hold);
  const u1 = E.cameraEvent(g, hold, { k: "u", seq: 4 }, true, () => at("MISS"));
  assert.equal(u1[0].t, "wait");
  const out = E.cameraEvent(g, hold, { k: "o", seq: 5 }, true, () => at("MISS"));
  assert.equal(out[0].t, "miss");
  assert.equal(g.winner, "bot");
  const late = E.cameraEvent(g, hold, ev("T20", 6), true, () => at("MISS"));
  assert.equal(late[0].t, "late");
});

test("You require: only with a finish in the darts the next visit has", () => {
  const g = E.createGame({ kind: "x01", startScore: 201, limit: 4 });
  E.enterVisit(g, 100); E.endVisit(g); // 101 left, 1 dart
  assert.equal(E.requireLine(g, "player"), "");
  const h = E.createGame({ kind: "x01", startScore: 201, limit: 4 });
  E.enterVisit(h, 161); E.endVisit(h); // 40 left, 1 dart
  assert.equal(E.requireLine(h, "player"), "You require 40");
});

test("the limit that moves: one fewer after a win, one more after two losses in a row; fixed games don't move it", () => {
  const g = (result, ts, extra) => Object.assign({ dartLimit: 27, limitAuto: true, result, timestamp: ts }, extra || {});
  assert.deepEqual(E.limitState([]), { limit: 27, played: 0, won: 0, lost: 0, lossRun: 0 });
  assert.equal(E.limitState([g("won", "2026-11-20 10:00")]).limit, 26);
  assert.equal(E.limitState([g("won", "2026-11-20 10:00"), g("lost", "2026-11-20 10:05")]).limit, 26);
  assert.equal(E.limitState([g("won", "2026-11-20 10:00"), g("lost", "2026-11-20 10:05"), g("lost", "2026-11-20 10:09")]).limit, 27);
  // Order is by time, then leg; abandoned games and fixed limits don't count.
  const s = E.limitState([g("lost", "2026-11-20 11:00", { leg: 2 }), g("lost", "2026-11-20 11:00", { leg: 1 }), g("abandoned", "2026-11-20 12:00"), g("won", "2026-11-20 13:00", { limitAuto: false })]);
  assert.equal(s.limit, 28);
  assert.equal(s.played, 2);
  // Bounds.
  const wins = Array.from({ length: 30 }, (_, i) => g("won", "2026-11-" + String(10 + Math.floor(i / 10)).padStart(2, "0") + " 10:" + String(i % 10).padStart(2, "0")));
  assert.equal(E.limitState(wins).limit, E.LIMIT.min);
});

test("the record: legs won and lost, and the fewest darts in a won leg", () => {
  const r = E.limitRecord([
    { dartLimit: 27, result: "won", playerDarts: new Array(25).fill({ s: "S1" }) },
    { dartLimit: 24, result: "won", playerDarts: new Array(22).fill({ s: "S1" }) },
    { dartLimit: 27, result: "lost", playerDarts: new Array(27).fill({ s: "S1" }) },
    { dartLimit: 27, result: "abandoned", playerDarts: [] },
    { result: "won", playerDarts: new Array(12).fill({ s: "S1" }) },
  ]);
  assert.deepEqual(r, { played: 3, won: 2, lost: 1, best: 22 });
});

test("games without a limit are unchanged: the turn passes and a bot plays", () => {
  const g = E.createGame({ kind: "x01", startScore: 501, bot: { level: "club" } });
  assert.equal(g.limit, undefined);
  visit(g, ["T20", "T20", "T20"]);
  assert.equal(g.turn, "bot");
  assert.equal(E.visitMax(g), 3);
  assert.equal(E.limitLeft(g), null);
});
