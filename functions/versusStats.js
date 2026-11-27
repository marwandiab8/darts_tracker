"use strict";

// Numbers for the result email of a game between two players, worked out from the darts each player threw.
// A saved game has every dart (playerDarts / opponentDarts, each { s: "T20" | "D16" | "SB" | "DB" | "S5" | "MISS" })
// and the visit log ({ w: "p" | "o", t: "57" | "Bust" }). Replaying the darts in order gives each visit, what
// was left after it, the darts thrown at a double and the checkout. The replay is only trusted when its visits
// say exactly what the log says; otherwise the email shows the numbers the game saved and nothing more.

function segmentValue(label) {
  const s = String(label || "").toUpperCase();
  if (s === "DB") return 50;
  if (s === "SB") return 25;
  const match = /^([SDT])(\d{1,2})$/.exec(s);
  if (!match) return 0;
  const number = Number(match[2]);
  if (number < 1 || number > 20) return 0;
  return number * { S: 1, D: 2, T: 3 }[match[1]];
}

const isDouble = (label) => /^D(\d{1,2}|B)$/.test(String(label || "").toUpperCase());
const isTriple = (label) => /^T\d{1,2}$/.test(String(label || "").toUpperCase());
// A score one dart can finish on a double: 2-40 even, or 50 (the bull).
const onADouble = (left) => (left >= 2 && left <= 40 && left % 2 === 0) || left === 50;

// Every visit of one player in an x01 game, from their darts.
function replayX01(darts, startScore, doubleOut = true) {
  const visits = [];
  let left = startScore;
  let visit = null;
  let dartsAtDouble = 0;
  let doublesHit = 0;
  let finished = false;
  for (const dart of Array.isArray(darts) ? darts : []) {
    if (finished) return null; // darts after the checkout: not a game this replay understands
    const label = dart && typeof dart === "object" ? dart.s : dart;
    if (!visit) visit = { darts: [], start: left, score: 0, bust: false, checkout: false, left };
    if (doubleOut && onADouble(left)) dartsAtDouble += 1;
    const after = left - segmentValue(label);
    visit.darts.push(String(label || "MISS").toUpperCase());
    const bust = after < 0 || (doubleOut && after === 1) || (after === 0 && doubleOut && !isDouble(label));
    if (bust) {
      Object.assign(visit, { bust: true, score: 0, left: visit.start });
      left = visit.start;
      visits.push(visit);
      visit = null;
      continue;
    }
    left = after;
    visit.score = visit.start - left;
    visit.left = left;
    if (left === 0) {
      visit.checkout = true;
      if (doubleOut) doublesHit += 1;
      finished = true;
      visits.push(visit);
      visit = null;
      continue;
    }
    if (visit.darts.length === 3) {
      visits.push(visit);
      visit = null;
    }
  }
  if (visit) visits.push(visit);
  return { visits, dartsAtDouble, doublesHit, left };
}

const sameVisit = (visit, text) => (visit.bust ? /^bust$/i.test(String(text).trim()) : String(text).trim() === String(visit.score));

// One player's numbers for one x01 game, or null when the darts don't match the visit log.
function playerGameStats(darts, logTexts, startScore, doubleOut) {
  const replay = replayX01(darts, startScore, doubleOut);
  if (!replay || !replay.visits.length) return null;
  // The log can stop before a last, unfinished visit (a game stopped partway); every logged visit must match.
  if (replay.visits.length < logTexts.length || replay.visits.length > logTexts.length + 1) return null;
  for (let i = 0; i < logTexts.length; i += 1) if (!sameVisit(replay.visits[i], logTexts[i])) return null;
  const visits = replay.visits.slice(0, logTexts.length);
  const scores = visits.map((v) => (v.bust ? 0 : v.score));
  const checkout = visits.find((v) => v.checkout) || null;
  const allDarts = visits.flatMap((v) => v.darts);
  return {
    visits,
    first9Points: scores.slice(0, 3).reduce((a, b) => a + b, 0),
    first9Visits: Math.min(3, scores.length),
    dartsAtDouble: replay.dartsAtDouble,
    doublesHit: replay.doublesHit,
    checkout: checkout ? { score: checkout.score, dart: checkout.darts[checkout.darts.length - 1], darts: allDarts.length } : null,
    busts: visits.filter((v) => v.bust).length,
    over60: scores.filter((s) => s >= 60).length,
    over100: scores.filter((s) => s >= 100).length,
    over140: scores.filter((s) => s >= 140).length,
    max180: scores.filter((s) => s === 180).length,
    triples: allDarts.filter(isTriple).length,
  };
}

// Both players' numbers for a saved x01 game (index 0 = the player, 1 = the opponent); null for cricket or when
// either replay doesn't match.
function gameDartStats(game) {
  if (!game || game.kind === "cricket") return null;
  const startScore = Number.isInteger(game.startScore) ? game.startScore : 501;
  const doubleOut = game.doubleOut !== false;
  const log = Array.isArray(game.log) ? game.log : [];
  const texts = (side) => log.filter((e) => e && (side === 0 ? e.w === "p" : e.w !== "p")).map((e) => String(e.t || ""));
  const player = playerGameStats(game.playerDarts, texts(0), startScore, doubleOut);
  const opponent = playerGameStats(game.opponentDarts, texts(1), startScore, doubleOut);
  return player && opponent ? [player, opponent] : null;
}

// What was left after each logged visit, from the log alone (a bust leaves the score where it was).
function leftAfterVisits(game) {
  if (!game || game.kind === "cricket") return null;
  const startScore = Number.isInteger(game.startScore) ? game.startScore : 501;
  const left = [startScore, startScore];
  return (Array.isArray(game.log) ? game.log : []).map((entry) => {
    const side = entry && entry.w === "p" ? 0 : 1;
    const value = Number(String(entry && entry.t).trim());
    if (String(entry && entry.t).trim() !== "" && Number.isFinite(value) && value >= 0 && value <= 180) left[side] = Math.max(0, left[side] - value);
    return left[side];
  });
}

module.exports = { segmentValue, isDouble, isTriple, onADouble, replayX01, playerGameStats, gameDartStats, leftAfterVisits };
