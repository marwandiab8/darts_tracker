// Measures the bot's table (CALIB[4] in public/practice-engine.js). For each style and each 3-dart
// average from 15 to 110, it finds the scoring spread s whose bot, playing legs of 501 against an equal
// bot (who throws first alternates), shows that average the way a real player's average is counted:
// over the legs it won and the legs it lost, a bust as three darts. The spread at a double is
// s * doubleRatio(average) * the style's factor. It prints, per style, rows of
// [average, s, d, first-9 average, share of darts at a double that went in] ready to paste in.
//
// Before model 4 (Nov 20, 2026) the table was measured with the bot alone, playing every leg to the end.
// That counts all the darts a weak player wastes at the double, which a real player's average mostly
// doesn't (most of their lost legs end before then), so the Beginner "30" played like a 36 with a
// first 9 of 43.
//
//   node scripts/calibrate-bot.cjs [legs per measurement, default 4000] [style] [averages, comma list]
const E = require("../public/practice-engine.js");
const LEGS = Number(process.argv[2]) || 4000;
const STYLES = process.argv[3] ? [process.argv[3]] : Object.keys(E.STYLE_K);
const AVERAGES = process.argv[4] ? process.argv[4].split(",").map(Number) : [15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100, 105, 110];
const MODEL = 4;

// Two equal bots, legs of 501: the "player" side's numbers.
function selfPlay(s, d, legs, seed) {
  const rng = E.mulberry32(seed);
  let scored = 0, used = 0, f9s = 0, f9d = 0, hits = 0, atDouble = 0;
  for (let leg = 0; leg < legs; leg += 1) {
    const game = E.createGame({ kind: "x01", startScore: 501, doubleOut: true, first: leg % 2 ? "bot" : "player" });
    let guard = 0;
    while (!game.winner && guard++ < 5000) {
      while (!game.visitDone) E.throwDart(game, E.spreadThrow(E.botAim(game), s, d, MODEL, rng));
      E.endVisit(game);
    }
    const r = E.legReport(game, "player");
    hits += r.checkout.hits; atDouble += r.checkout.darts;
    let k = 0;
    for (const v of game.visits) {
      if (v.who !== "player") continue;
      const n = v.bust ? 3 : v.darts.length;
      scored += v.scored; used += n;
      if (k < 3) { f9s += v.scored; f9d += n; }
      k += 1;
    }
  }
  return { avg: (scored * 3) / used, first9: (f9s * 3) / f9d, checkout: atDouble ? hits / atDouble : 0 };
}

// The spread that shows `avg`: the average falls about as 1/s, so step s by the ratio and repeat.
function solve(avg, style, seed) {
  const f = E.doubleRatio(avg) * E.STYLE_K[style];
  let s = Math.min(0.9, 4.3 / avg), r = null;
  for (let i = 0; i < 12; i += 1) {
    r = selfPlay(s, s * f, LEGS, seed);
    if (Math.abs(r.avg - avg) < 0.12) break;
    s *= Math.pow(r.avg / avg, 1 / 0.95);
  }
  r = selfPlay(s, s * f, LEGS * 2, seed + 1);
  const round = (x, k) => Math.round(x * 10 ** k) / 10 ** k;
  return [avg, round(s, 5), round(s * f, 5), round(r.first9, 1), round(r.checkout, 4), round(r.avg, 1)];
}

const out = {};
for (const style of STYLES) {
  out[style] = AVERAGES.map((avg) => {
    const row = solve(avg, style, 20261120 + avg * 7 + style.length);
    console.error(style, JSON.stringify(row));
    return row.slice(0, 5);
  });
}
console.log(JSON.stringify(out));
