// Measures the bot's table (CALIB[3] in public/practice-engine.js): for each style's double ratio and
// each spread, the bot plays legs of 501 on its own (the other side scores nothing) with the engine's
// own aim, throw and scoring, and this prints [spread, 3-dart average, share of darts at a double that
// went in] rows, widest spread last, ready to paste in. The average is the one the game reports: a
// bust counts as three darts, only finished visits count.
//
//   node scripts/calibrate-bot.cjs [legs per row, default 3000]
const E = require("../public/practice-engine.js");
const LEGS = Number(process.argv[2]) || 3000;
const SPREADS = [0.025, 0.03, 0.035, 0.04, 0.045, 0.05, 0.055, 0.06, 0.065, 0.07, 0.075, 0.08, 0.085, 0.09, 0.095, 0.1, 0.11, 0.12, 0.13, 0.14, 0.16, 0.18, 0.2, 0.24, 0.28];
const MODEL = 3;

function measure(s, f, rng) {
  let scored = 0, used = 0, atDouble = 0, hitDouble = 0;
  for (let leg = 0; leg < LEGS; leg += 1) {
    const game = E.createGame({ kind: "x01", startScore: 501, doubleOut: true, first: "bot" });
    let darts = 0;
    while (!game.winner && darts < 200) {
      if (game.turn === "player") { E.enterVisit(game, 0, 3); E.endVisit(game); continue; }
      while (!game.visitDone) {
        const aim = E.botAim(game);
        const n = game.darts.bot.length;
        E.throwDart(game, E.spreadThrow(aim, s, s * f, MODEL, rng));
        if (aim.ring === "D") { atDouble += 1; if (game.darts.bot[n].s === (aim.target === "BULL" ? "DB" : "D" + aim.target)) hitDouble += 1; }
        darts += 1;
      }
      E.endVisit(game);
    }
    for (const v of game.visits) if (v.who === "bot") { scored += v.scored; used += v.bust ? 3 : v.darts.length; }
  }
  return [s, Math.round((scored * 3 / used) * 10) / 10, Math.round((hitDouble / atDouble) * 1000) / 1000];
}

const out = {};
for (const f of [...new Set(Object.values(E.STYLE_F[MODEL]))]) {
  const rng = E.mulberry32(20261114 + Math.round(f * 100));
  out[String(f)] = SPREADS.map((s) => measure(s, f, rng));
  console.error("f=" + f + " done");
}
console.log(JSON.stringify(out));
