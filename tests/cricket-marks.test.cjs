// node --test tests/cricket-marks.test.cjs
// Cricket: a mark counts only when it goes on the board or scores. Marks on a number both sides have
// closed are dead: not said, not shown, not in marks per round (Nov 20, 2026: a T20 that closed the 20
// with its other two marks dead was called "three marks").
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/practice-engine.js");

const at = (label) => (label === "MISS" ? { x: 1.2, y: 0 } : label === "DB" ? { x: 0, y: 0 } : label === "SB" ? { x: 0.08, y: 0 } : E.aimPoint(label.slice(1), label[0]));
function visit(game, labels) {
  for (const l of labels) { if (game.visitDone) break; E.throwDart(game, at(l)); }
  return E.endVisit(game);
}
const last = (game) => game.visits[game.visits.length - 1];

test("a triple that closes a number the other side has closed: one mark, no points, and that is what is said", () => {
  const game = E.createGame({ kind: "cricket" });
  game.marks.player[20] = 2;
  game.marks.bot[20] = 3;
  visit(game, ["T20", "MISS", "MISS"]);
  assert.equal(game.marks.player[20], 3);
  assert.equal(game.points.player, 0);
  assert.equal(last(game).marks, 1, "only the mark that closed the 20");
  assert.equal(last(game).points, 0);
  assert.equal(game.marksThrown.player, 1);
  assert.equal(E.visitSpeech(last(game), "cricket", false), "one mark");
  assert.equal(E.visitAnnouncement(last(game), "cricket", false)[0].text, "One mark");
});

test("darts on a number closed by both sides are dead: no marks at all", () => {
  const game = E.createGame({ kind: "cricket" });
  game.marks.player[19] = 3;
  game.marks.bot[19] = 3;
  visit(game, ["T19", "S19", "D19"]);
  assert.equal(last(game).marks, 0);
  assert.equal(last(game).points, 0);
  assert.equal(game.marksThrown.player, 0);
  assert.equal(E.visitSpeech(last(game), "cricket", false), "No marks");
});

test("scoring marks still count as marks while the other side has the number open", () => {
  const game = E.createGame({ kind: "cricket" });
  game.marks.player[18] = 3;
  visit(game, ["T18", "MISS", "MISS"]);
  assert.equal(last(game).marks, 3);
  assert.equal(last(game).points, 54);
  assert.equal(E.visitSpeech(last(game), "cricket", false), "three marks and fifty four points");
});

test("marks per round in the summary leaves the dead marks out", () => {
  const game = E.createGame({ kind: "cricket" });
  game.marks.bot[17] = 3;
  game.marks.player[17] = 2;
  visit(game, ["T17", "T17", "MISS"]); // one live mark, five dead
  const s = E.summarize(game);
  assert.equal(s.player.marks, 1);
  assert.equal(s.player.avg, 1, "1 mark in 3 darts is 1 mark per round");
});

test("the visit's marks match what each dart's box says", () => {
  const game = E.createGame({ kind: "cricket" });
  visit(game, ["S16", "MISS", "MISS"]); // you: one mark on the 16
  visit(game, ["T16", "MISS", "MISS"]); // the bot closes the 16
  visit(game, ["T16", "S15", "MISS"]); // you: two live marks on the 16 (closed), one dead; one on the 15
  const boxes = E.visitView(game, last(game)).darts.map((d) => d.sub);
  assert.deepEqual(boxes, ["2 marks, closed", "1 mark", "0"]);
  assert.equal(last(game).marks, 3, "two on the 16, one on the 15");
});
