"use strict";

// The result email of a game (or a first-to-N match) between two players: a plain-text version and an HTML
// version laid out with tables and inline styles only, so it reads the same in Gmail, Outlook and Apple Mail.
// index.js works out who played, the games and the score (versusSummary, matchSoFar); this file turns that
// into the email. The extra numbers (first 9 average, checkout %, highest checkout, 60+ visits, busts) come
// from replaying each game's darts (versusStats.js) and only appear when every game's darts match its log.

const { gameDartStats, leftAfterVisits } = require("./versusStats");

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const esc = escapeHtml;
const fixed1 = (value) => (Number.isFinite(value) ? (Math.round(value * 10) / 10).toFixed(1) : "-");
const minutesOf = (seconds) => (seconds ? Math.max(1, Math.round(seconds / 60)) : 0);
const percent = (hit, tries) => (tries ? `${Math.round((hit / tries) * 100)}%` : "-");
const dartName = (label) => (label === "DB" ? "Bull" : String(label || ""));

// "2026-11-26 20:29" -> "Thu, Nov 26, 2026 · 8:29 PM" (the timestamp is already the players' local time).
function prettyDate(stamp) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(stamp || ""));
  if (!m) return String(stamp || "");
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(date.getTime())) return String(stamp);
  const day = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  if (m[4] === undefined) return day;
  const hour = Number(m[4]);
  return `${day} · ${((hour + 11) % 12) + 1}:${m[5]} ${hour < 12 ? "AM" : "PM"}`;
}

// --- the numbers ------------------------------------------------------------------------------------------

// Round by round, each visit under its own player's name with what was left after it.
function visitRoundsWithLeft(game) {
  const log = (Array.isArray(game.log) ? game.log : []).slice(0, 400);
  const left = leftAfterVisits(game);
  const rounds = [];
  log.forEach((entry, index) => {
    const side = entry && entry.w === "p" ? 0 : 1;
    let round = rounds[rounds.length - 1];
    if (!round || round[side]) { round = [null, null]; rounds.push(round); }
    const text = String((entry && entry.t) || "").replace(/\s+/g, " ").trim().slice(0, 30);
    round[side] = { text, left: left ? left[index] : null };
  });
  return rounds;
}

// Each player over the given games: the darts-derived numbers, or null when any game's darts don't replay.
function dartTotals(games) {
  const perGame = games.map(gameDartStats);
  if (!perGame.length || perGame.some((s) => !s)) return { perGame, totals: null };
  const totals = [0, 1].map((side) => {
    const t = { first9Points: 0, first9Visits: 0, dartsAtDouble: 0, doublesHit: 0, busts: 0, over60: 0, over100: 0, over140: 0, max180: 0, checkout: null };
    perGame.forEach((stats, gameIndex) => {
      const s = stats[side];
      for (const key of ["first9Points", "first9Visits", "dartsAtDouble", "doublesHit", "busts", "over60", "over100", "over140", "max180"]) t[key] += s[key];
      if (s.checkout && (!t.checkout || s.checkout.score > t.checkout.score)) t.checkout = { ...s.checkout, game: gameIndex + 1 };
    });
    t.first9 = t.first9Visits ? t.first9Points / t.first9Visits : null;
    return t;
  });
  return { perGame, totals };
}

// A few lines worth reading: the best checkout, the best visit, the quickest and closest games, a run of wins.
function highlights({ names, infos, games, perGame, totals, winnerSide, kind }) {
  const out = [];
  if (kind !== "x01" || !games.length) return out;
  if (totals) {
    const top = [0, 1].map((side) => totals[side].checkout).map((c, side) => (c ? { ...c, side } : null)).filter(Boolean)
      .sort((a, b) => b.score - a.score)[0];
    if (top) out.push(`Highest checkout: ${names[top.side]} ${top.score} on ${dartName(top.dart)}${games.length > 1 ? ` in game ${top.game}` : ""}`);
  }
  let bestVisit = null;
  infos.forEach((info, g) => [0, 1].forEach((side) => {
    const value = info.best[side] || 0;
    if (value && (!bestVisit || value > bestVisit.value)) bestVisit = { value, side, game: g + 1 };
  }));
  if (bestVisit) out.push(`Best visit: ${names[bestVisit.side]} ${bestVisit.value}${games.length > 1 ? ` in game ${bestVisit.game}` : ""}`);
  if (games.length > 1 && perGame.every(Boolean)) {
    const won = perGame.map((stats, g) => {
      const side = infos[g].result === "won" ? 0 : infos[g].result === "lost" ? 1 : null;
      return side === null ? null : { side, darts: stats[side].checkout ? stats[side].checkout.darts : null, loserLeft: infos[g].rows[1 - side].score, game: g + 1 };
    }).filter((w) => w && w.darts);
    const quickest = won.slice().sort((a, b) => a.darts - b.darts)[0];
    if (quickest) out.push(`Quickest game: game ${quickest.game}, ${names[quickest.side]} won in ${quickest.darts} darts`);
    const closest = won.filter((w) => Number.isFinite(w.loserLeft) && w.loserLeft > 0).sort((a, b) => a.loserLeft - b.loserLeft)[0];
    if (closest && (!quickest || closest.game !== quickest.game)) out.push(`Closest game: game ${closest.game}, ${names[1 - closest.side]} was left on ${closest.loserLeft}`);
  }
  if (winnerSide !== null && infos.length >= 3) {
    let run = 0;
    for (let g = infos.length - 1; g >= 0; g -= 1) {
      const side = infos[g].result === "won" ? 0 : infos[g].result === "lost" ? 1 : null;
      if (side !== winnerSide) break;
      run += 1;
    }
    if (run >= 2 && run < infos.length) out.push(`${names[winnerSide]} won the last ${run} games in a row`);
  }
  return out.slice(0, 4);
}

// --- the HTML ---------------------------------------------------------------------------------------------

const COLOURS = {
  page: "#eef1f6", card: "#ffffff", ink: "#0f172a", muted: "#64748b", faint: "#94a3b8", line: "#e2e8f0",
  hero: "#0b0f17", heroInk: "#f8fafc", heroMuted: "#94a3b8", accent: "#f59e0b",
  side: [{ bright: "#f59e0b", ink: "#b45309", tint: "#fff7ed" }, { bright: "#38bdf8", ink: "#0369a1", tint: "#f0f9ff" }],
  good: "#15803d", goodTint: "#dcfce7", bad: "#dc2626",
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

// Which side has the better number: 0, 1, or -1 for a tie or nothing to compare.
function better(a, b, higher = true) {
  const x = Number(a), y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return -1;
  return (x > y) === higher ? 0 : 1;
}

function statsTable(names, rows) {
  const th = (text, side) => `<th align="${side === undefined ? "left" : "center"}" style="padding:8px 10px;font-size:12px;font-weight:700;color:${side === undefined ? COLOURS.muted : COLOURS.side[side].ink};border-bottom:2px solid ${COLOURS.line}">${esc(text)}</th>`;
  const body = rows.map((row) => {
    const win = row.compare === false ? -1 : better(row.raw[0], row.raw[1], row.higher !== false);
    const td = (side) => `<td align="center" style="padding:9px 10px;border-bottom:1px solid ${COLOURS.line};font-size:15px;${win === side ? `font-weight:800;color:${COLOURS.side[side].ink};background:${COLOURS.side[side].tint}` : `color:${COLOURS.ink}`}">${esc(row.values[side])}${row.notes && row.notes[side] ? `<div style="font-size:11px;font-weight:400;color:${COLOURS.faint}">${esc(row.notes[side])}</div>` : ""}</td>`;
    return `<tr><td style="padding:9px 10px;border-bottom:1px solid ${COLOURS.line};font-size:13px;color:${COLOURS.muted}">${esc(row.label)}</td>${td(0)}${td(1)}</tr>`;
  }).join("");
  return `<table role="table" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><tr>${th("")}${th(names[0], 0)}${th(names[1], 1)}</tr>${body}</table>`;
}

function sectionTitle(text) {
  return `<p style="margin:0 0 10px;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:${COLOURS.muted}">${esc(text)}</p>`;
}

function visitTable(names, rounds, kind, checkoutDarts) {
  const head = (text, side) => `<th align="${side === undefined ? "left" : "center"}" style="padding:6px 8px;font-size:12px;font-weight:700;color:${side === undefined ? COLOURS.muted : COLOURS.side[side].ink};border-bottom:2px solid ${COLOURS.line}">${esc(text)}</th>`;
  const cell = (visit, side) => {
    if (!visit) return `<td align="center" style="padding:6px 8px;border-bottom:1px solid ${COLOURS.line};color:${COLOURS.faint}">-</td>`;
    const bust = /^bust$/i.test(visit.text);
    const value = Number(visit.text);
    const checkout = kind === "x01" && visit.left === 0 && !bust;
    const style = checkout ? `background:${COLOURS.goodTint};color:${COLOURS.good};font-weight:800`
      : bust ? `color:${COLOURS.bad};font-weight:700`
      : Number.isFinite(value) && value >= 100 ? `color:${COLOURS.side[side].ink};font-weight:800`
      : `color:${COLOURS.ink}`;
    const note = checkout ? `<span style="font-size:11px;font-weight:700"> ✓ ${esc(dartName(checkoutDarts[side]) || "out")}</span>`
      : kind === "x01" && visit.left !== null && visit.left !== undefined ? `<span style="font-size:11px;font-weight:400;color:${COLOURS.faint}"> ${esc(visit.left)}</span>` : "";
    return `<td align="center" style="padding:6px 8px;border-bottom:1px solid ${COLOURS.line};font-size:14px;${style}">${esc(visit.text)}${note}</td>`;
  };
  const body = rounds.map((pair, k) => `<tr><td style="padding:6px 8px;border-bottom:1px solid ${COLOURS.line};font-size:12px;color:${COLOURS.faint}">${k + 1}</td>${cell(pair[0], 0)}${cell(pair[1], 1)}</tr>`).join("");
  return `<table role="table" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><tr>${head("Round")}${head(names[0], 0)}${head(names[1], 1)}</tr>${body}</table>`;
}

function button(href, label, primary) {
  return `<td style="padding:0 6px 8px 0"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;border-radius:10px;font-weight:800;font-size:14px;text-decoration:none;${primary ? `background:${COLOURS.accent};color:#111827` : `background:#ffffff;color:${COLOURS.ink};border:1px solid ${COLOURS.line}`}">${esc(label)}</a></td>`;
}

// --- the email --------------------------------------------------------------------------------------------

// single: one game on its own. games: the played games in order (raw); infos: versusSummary of each.
function composeResultEmail({ single, names, games, infos, wins, target, decided, stopped = 0, appUrl = "" }) {
  const kind = infos[0] ? infos[0].kind : "x01";
  const gameName = infos[0] ? infos[0].gameName : "501";
  const averageName = kind === "cricket" ? "Marks per round" : "3-dart average";
  const scoreName = kind === "cricket" ? "Points" : "Left";
  const lead = wins[0] >= wins[1] ? 0 : 1;
  const winnerSide = decided ? lead : null;
  const winner = decided ? names[lead] : null, loser = decided ? names[1 - lead] : null;
  const score = `${wins[lead]}-${wins[1 - lead]}`;
  const info0 = infos[0] || { winner: null, loser: null, rows: [], best: [0, 0], timestamp: "", durationSec: 0, rounds: 0 };

  let headline, subject, facts;
  if (single) {
    headline = info0.winner ? `${info0.winner} won` : "Game ended";
    subject = info0.winner ? `Darts: ${info0.winner} beat ${info0.loser} at ${gameName}` : `Darts: ${gameName} between ${names[0]} and ${names[1]}`;
    const minutes = minutesOf(info0.durationSec);
    facts = [`${gameName}${info0.timestamp ? `, ${info0.timestamp}` : ""}`, info0.rounds ? `${info0.rounds} rounds` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" · ");
  } else {
    headline = decided ? `${winner} won the match ${score}` : `Match not finished: ${names[0]} ${wins[0]}-${wins[1]} ${names[1]}`;
    subject = decided ? `Darts: ${winner} beat ${loser} ${score} (first to ${target}, ${gameName})` : `Darts: ${names[0]} ${wins[0]}-${wins[1]} ${names[1]}, match not finished`;
    const minutes = minutesOf(games.reduce((sum, g, i) => sum + (infos[i].durationSec || 0), 0));
    facts = [`First to ${target}`, `${games.length} ${games.length === 1 ? "game" : "games"}`, gameName, info0.timestamp, minutes ? `${minutes} min` : ""].filter(Boolean).join(" · ");
  }

  // Each player over everything played: games won, the average over all their darts, darts, best visit.
  const totals = [0, 1].map((side) => {
    let darts = 0, weighted = 0, best = 0;
    games.forEach((g, i) => {
      const list = side ? g.opponentDarts : g.playerDarts;
      const n = Array.isArray(list) ? Math.min(list.length, 600) : 0;
      const avg = Number(side ? g.opponentAvg : g.playerAvg);
      if (Number.isFinite(avg) && n) { weighted += avg * n; darts += n; }
      best = Math.max(best, infos[i].best[side] || 0);
    });
    return { name: names[side], won: wins[side], averageValue: darts ? weighted / darts : null, average: darts ? fixed1(weighted / darts) : "-", darts, best };
  });
  const { perGame, totals: dart } = kind === "x01" ? dartTotals(games) : { perGame: games.map(() => null), totals: null };
  const doubleOut = games.every((g) => g.doubleOut !== false);
  const notes = highlights({ names, infos, games, perGame, totals: dart, winnerSide: single ? (info0.result === "won" ? 0 : info0.result === "lost" ? 1 : null) : winnerSide, kind });
  const stoppedLine = stopped ? (stopped === 1 ? "One game was stopped before the end; it is not counted." : `${stopped} games were stopped before the end; they are not counted.`) : "";
  const checkoutText = (c) => `${c.score} (${dartName(c.dart)})`;
  const extraLine = (side) => {
    if (!dart) return "";
    const t = dart[side];
    const parts = [`first 9 average ${fixed1(t.first9)}`];
    if (doubleOut) parts.push(`checkout ${percent(t.doublesHit, t.dartsAtDouble)} (${t.doublesHit} of ${t.dartsAtDouble} darts at a double)`);
    if (t.checkout) parts.push(`highest checkout ${checkoutText(t.checkout)}`);
    parts.push(`60+ visits ${t.over60}`, `busts ${t.busts}`);
    return `  ${parts.join(", ")}`;
  };

  // --- plain text ---
  const lines = [`${headline}!`, facts, ""];
  if (single) {
    info0.rows.forEach((row, side) => {
      const c = perGame[0] && perGame[0][side].checkout;
      lines.push(`${row.name}: ${averageName.toLowerCase()} ${row.average}, ${row.darts} darts, ${scoreName.toLowerCase()} ${row.score}${kind === "x01" && info0.best[side] ? `, best visit ${info0.best[side]}` : ""}${c ? `, checkout ${checkoutText(c)}` : ""}`);
      const extra = extraLine(side);
      if (extra) lines.push(extra);
    });
  } else {
    totals.forEach((t, side) => {
      lines.push(`${t.name}: ${t.won} won, ${averageName.toLowerCase()} ${t.average}, ${t.darts} darts${kind === "x01" && t.best ? `, best visit ${t.best}` : ""}`);
      const extra = extraLine(side);
      if (extra) lines.push(extra);
    });
  }
  if (notes.length) lines.push("", "Highlights:", ...notes.map((n) => `- ${n}`));
  infos.forEach((info, i) => {
    const mins = minutesOf(info.durationSec);
    const gameFacts = [info.rounds ? `${info.rounds} rounds` : "", mins ? `${mins} min` : ""].filter(Boolean);
    const indent = single ? "" : "  ";
    if (!single) {
      lines.push("", `Game ${i + 1}: ${info.winner} won${gameFacts.length ? ` (${gameFacts.join(", ")})` : ""}`);
      info.rows.forEach((row, side) => {
        const c = perGame[i] && perGame[i][side].checkout;
        lines.push(`  ${row.name}: ${averageName.toLowerCase()} ${row.average}, ${row.darts} darts, ${scoreName.toLowerCase()} ${row.score}${kind === "x01" && info.best[side] ? `, best visit ${info.best[side]}` : ""}${c ? `, checkout ${checkoutText(c)}` : ""}`);
      });
    }
    if (info.visitRounds.length) {
      lines.push(single ? "" : "  Visit by visit:", ...(single ? ["Visit by visit:"] : []));
      info.visitRounds.forEach((pair, k) => lines.push(`${indent}${k + 1}. ${info.names[0]} ${pair[0] ? pair[0].text : "-"} · ${info.names[1]} ${pair[1] ? pair[1].text : "-"}`));
    }
  });
  if (stoppedLine) lines.push("", stoppedLine);
  if (appUrl) lines.push("", `Play again: ${appUrl}/practice.html`, `Your stats: ${appUrl}/stats.html`);
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n");

  // --- HTML ---
  const C = COLOURS;
  const preheader = single
    ? `${headline}. ${names[0]} ${info0.rows[0] ? info0.rows[0].average : "-"} vs ${names[1]} ${info0.rows[1] ? info0.rows[1].average : "-"} ${averageName.toLowerCase()}.`
    : `${headline}. ${names[0]} ${totals[0].average} vs ${names[1]} ${totals[1].average} ${averageName.toLowerCase()}${notes[0] ? `. ${notes[0]}` : ""}.`;
  const prettyFacts = single
    ? [gameName, prettyDate(info0.timestamp), info0.rounds ? `${info0.rounds} rounds` : "", minutesOf(info0.durationSec) ? `${minutesOf(info0.durationSec)} min` : ""].filter(Boolean).join(" · ")
    : [`First to ${target}`, gameName, prettyDate(info0.timestamp), minutesOf(games.reduce((s, g, i) => s + (infos[i].durationSec || 0), 0)) ? `${minutesOf(games.reduce((s, g, i) => s + (infos[i].durationSec || 0), 0))} min` : ""].filter(Boolean).join(" · ");

  const heroSide = (side) => {
    const isWinner = single ? (info0.result === "won" ? side === 0 : info0.result === "lost" ? side === 1 : false) : winnerSide === side;
    const sub = single
      ? `${info0.rows[side] ? info0.rows[side].average : "-"} ${kind === "cricket" ? "MPR" : "avg"}`
      : `${totals[side].average} ${kind === "cricket" ? "MPR" : "avg"}`;
    return `<td width="38%" align="center" valign="top" style="padding:6px 4px">`
      + `<div style="font-size:18px;font-weight:800;color:${C.heroInk};line-height:1.2">${esc(names[side])}</div>`
      + `<div style="margin-top:4px;font-size:13px;color:${C.heroMuted}">${esc(sub)}</div>`
      + (isWinner ? `<div style="margin-top:8px"><span style="display:inline-block;padding:3px 10px;border-radius:999px;background:${C.side[side].bright};color:#111827;font-size:11px;font-weight:800;letter-spacing:.08em">WINNER</span></div>` : "")
      + `</td>`;
  };
  const centre = single
    ? `<div style="font-size:13px;color:${C.heroMuted};font-weight:700">${esc(gameName)}</div><div style="font-size:30px;font-weight:800;color:${C.heroInk}">vs</div>`
    : `<div style="font-size:44px;line-height:1;font-weight:800;white-space:nowrap"><span style="color:${C.side[0].bright}">${esc(wins[0])}</span><span style="color:${C.heroMuted}"> &ndash; </span><span style="color:${C.side[1].bright}">${esc(wins[1])}</span></div><div style="margin-top:6px;font-size:11px;color:${C.heroMuted};letter-spacing:.08em">GAMES</div>`;
  const strip = !single && infos.length > 1
    ? `<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:16px auto 0"><tr>${infos.map((info, g) => {
      const side = info.result === "won" ? 0 : info.result === "lost" ? 1 : null;
      return `<td style="padding:0 3px"><div style="width:34px;padding:5px 0;border-radius:8px;text-align:center;font-size:11px;font-weight:800;background:${side === null ? "#334155" : C.side[side].bright};color:#111827">G${g + 1}</div></td>`;
    }).join("")}</tr></table>`
    : "";
  const hero = `<tr><td bgcolor="${C.hero}" style="background:${C.hero};padding:22px 22px 20px;color:${C.heroInk}">`
    + `<div style="font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${C.accent}">🎯 Darts Tracker · ${single ? "Game report" : "Match report"}</div>`
    + `<h2 style="margin:10px 0 4px;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff">${esc(headline)}!</h2>`
    + `<p style="margin:0 0 16px;font-size:13px;color:${C.heroMuted}">${esc(prettyFacts)}</p>`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>${heroSide(0)}<td width="24%" align="center" valign="middle">${centre}</td>${heroSide(1)}</tr></table>`
    + strip
    + `</td></tr>`;

  const statRows = [];
  if (!single) statRows.push({ label: "Games won", values: [wins[0], wins[1]], raw: [wins[0], wins[1]] });
  if (single) {
    statRows.push({ label: averageName, values: info0.rows.map((r) => r.average), raw: info0.rows.map((r) => Number(r.average)) });
  } else {
    statRows.push({ label: averageName, values: totals.map((t) => t.average), raw: totals.map((t) => t.averageValue) });
  }
  if (dart) {
    statRows.push({ label: "First 9 average", values: dart.map((t) => fixed1(t.first9)), raw: dart.map((t) => t.first9) });
    if (doubleOut) statRows.push({ label: "Checkout %", values: dart.map((t) => percent(t.doublesHit, t.dartsAtDouble)), raw: dart.map((t) => (t.dartsAtDouble ? t.doublesHit / t.dartsAtDouble : null)), notes: dart.map((t) => `${t.doublesHit} of ${t.dartsAtDouble} at a double`) });
    statRows.push({ label: "Highest checkout", values: dart.map((t) => (t.checkout ? t.checkout.score : "-")), raw: dart.map((t) => (t.checkout ? t.checkout.score : 0)), notes: dart.map((t) => (t.checkout ? dartName(t.checkout.dart) : "")) });
  }
  if (kind === "x01") statRows.push({ label: "Best visit", values: totals.map((t) => t.best || "-"), raw: totals.map((t) => t.best) });
  if (dart) {
    statRows.push({ label: "60+ visits", values: dart.map((t) => t.over60), raw: dart.map((t) => t.over60) });
    if (dart.some((t) => t.over100)) statRows.push({ label: "100+ visits", values: dart.map((t) => t.over100), raw: dart.map((t) => t.over100) });
    if (dart.some((t) => t.over140)) statRows.push({ label: "140+ visits", values: dart.map((t) => t.over140), raw: dart.map((t) => t.over140) });
    if (dart.some((t) => t.max180)) statRows.push({ label: "180s", values: dart.map((t) => t.max180), raw: dart.map((t) => t.max180) });
    statRows.push({ label: "Busts", values: dart.map((t) => t.busts), raw: dart.map((t) => t.busts), higher: false });
  }
  statRows.push({ label: "Darts thrown", values: totals.map((t) => t.darts), raw: totals.map((t) => t.darts), compare: false });
  if (single) statRows.push({ label: scoreName, values: info0.rows.map((r) => r.score), raw: info0.rows.map((r) => r.score), compare: false });

  const statsSection = `<tr><td style="padding:22px 22px 6px">${sectionTitle(single ? "Game stats" : "Match stats")}${statsTable(names, statRows)}</td></tr>`;
  const notesSection = notes.length
    ? `<tr><td style="padding:16px 22px 6px">${sectionTitle("Highlights")}<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${notes.map((n) => `<tr><td width="18" valign="top" style="padding:4px 0;color:${C.accent};font-size:14px">&#9670;</td><td style="padding:4px 0;font-size:14px;color:${C.ink}">${esc(n)}</td></tr>`).join("")}</table></td></tr>`
    : "";

  const gameBlock = (info, i, withVisits) => {
    const g = games[i];
    const mins = minutesOf(info.durationSec);
    const gameFacts = [info.rounds ? `${info.rounds} rounds` : "", mins ? `${mins} min` : ""].filter(Boolean).join(" · ");
    const side = info.result === "won" ? 0 : info.result === "lost" ? 1 : null;
    const checkoutDarts = [0, 1].map((s) => (perGame[i] && perGame[i][s].checkout ? perGame[i][s].checkout.dart : ""));
    const row = (r, s) => {
      const c = perGame[i] && perGame[i][s].checkout;
      const result = kind === "cricket" ? `${r.score} points` : c ? `Out on ${dartName(c.dart)} (${c.score})` : `${r.score} left`;
      return `<tr><td style="padding:7px 8px;border-bottom:1px solid ${C.line};font-size:14px;font-weight:700;color:${C.side[s].ink}">${esc(r.name)}</td>`
        + `<td align="center" style="padding:7px 8px;border-bottom:1px solid ${C.line};font-size:14px;color:${C.ink}">${esc(r.average)}</td>`
        + `<td align="center" style="padding:7px 8px;border-bottom:1px solid ${C.line};font-size:14px;color:${C.ink}">${esc(r.darts)}</td>`
        + `<td align="right" style="padding:7px 8px;border-bottom:1px solid ${C.line};font-size:13px;${c ? `color:${C.good};font-weight:700` : `color:${C.muted}`}">${esc(result)}</td></tr>`;
    };
    const head = (text, align) => `<th align="${align}" style="padding:6px 8px;font-size:11px;font-weight:700;color:${C.faint};border-bottom:2px solid ${C.line}">${esc(text)}</th>`;
    const summary = `<table role="table" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%"><tr>${head("Player", "left")}${head(kind === "cricket" ? "MPR" : "Avg", "center")}${head("Darts", "center")}${head(kind === "cricket" ? "Points" : "Finish", "right")}</tr>${info.rows.map(row).join("")}</table>`;
    const rounds = visitRoundsWithLeft(g);
    const visits = withVisits && rounds.length
      ? `<p style="margin:14px 0 6px;font-size:12px;color:${C.muted}">Visit by visit${kind === "x01" ? " · what was left in grey" : ""}</p>${visitTable(info.names, rounds, kind, checkoutDarts)}`
      : "";
    const dot = side === null ? "" : `<span style="color:${C.side[side].bright}">&#9679;</span> `;
    const title = single ? "" : `<h3 style="margin:0 0 2px;font-size:16px;font-weight:800;color:${C.ink}">${dot}Game ${i + 1}: ${esc(info.winner)} won</h3>${gameFacts ? `<p style="margin:0 0 10px;font-size:12px;color:${C.muted}">${esc(gameFacts)}</p>` : ""}`;
    return `<tr><td style="padding:18px 22px 6px;border-top:1px solid ${C.line}">${title}${single ? "" : summary}${visits}</td></tr>`;
  };

  const buildHtml = (withVisits) => {
    const gamesSection = single
      ? (infos[0] && infos[0].visitRounds.length && withVisits ? gameBlock(infos[0], 0, true) : "")
      : `<tr><td style="padding:20px 22px 0">${sectionTitle("Game by game")}</td></tr>${infos.map((info, i) => gameBlock(info, i, withVisits)).join("")}`;
    const trimmed = withVisits ? "" : `<tr><td style="padding:12px 22px 0;font-size:13px;color:${C.muted}">The visit-by-visit scores are left out to keep this email short.</td></tr>`;
    const stoppedRow = stoppedLine ? `<tr><td style="padding:14px 22px 0;font-size:13px;color:${C.muted}">${esc(stoppedLine)}</td></tr>` : "";
    const buttons = appUrl
      ? `<tr><td style="padding:22px 22px 14px;border-top:1px solid ${C.line}"><table role="presentation" cellpadding="0" cellspacing="0"><tr>${button(`${appUrl}/practice.html`, "Play again", true)}${button(`${appUrl}/stats.html`, "See your stats", false)}</tr></table></td></tr>`
      : "";
    return [
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${esc(subject)}</title></head>`,
      `<body style="margin:0;padding:0;background:${C.page}">`,
      `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}</div>`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${C.page}" style="background:${C.page}"><tr><td align="center" style="padding:20px 10px">`,
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${C.card};border-radius:14px;border-collapse:separate;font-family:${FONT};color:${C.ink}">`,
      hero, statsSection, notesSection, gamesSection, trimmed, stoppedRow, buttons,
      `<tr><td style="padding:10px 22px 20px;font-size:12px;line-height:1.5;color:${C.faint}">Sent by Darts Tracker to both players of this ${single ? "game" : "match"}.${appUrl ? ` <a href="${esc(appUrl)}" style="color:${C.faint}">${esc(appUrl.replace(/^https?:\/\//, ""))}</a>` : ""}</td></tr>`,
      `</table></td></tr></table></body></html>`,
    ].join("");
  };
  // Gmail cuts off a message over about 100 KB; a long match drops the visit tables rather than be cut.
  let html = buildHtml(true);
  if (html.length > 90000) html = buildHtml(false);
  return { subject: String(subject).replace(/\s+/g, " ").trim().slice(0, 150), text, html };
}

module.exports = { composeResultEmail, escapeHtml, prettyDate, visitRoundsWithLeft, dartTotals, highlights };
