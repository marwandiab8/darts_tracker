// The people you play against (practice.html, "Another player"): each one's name and email address,
// kept with your account so they are there on every device and are typed once. This file is the
// list's plain logic; the page reads and writes the document.
//
//   savedPlayers/{uid}: { uid, updatedAt, players: { [id]: { name, email, addedAt, usedAt } } }
//
// A player's id is made from their email address, so the same person added on two devices at the
// same moment is one player, and adding someone who is already there just updates them.
// Loaded as a plain <script> (window.Players) and by the tests (module.exports).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Players = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX = 50;        // the rules take 60, so two devices adding at once still fit
  const NAME_MAX = 40;
  const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const looksLikeEmail = (value) => typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value) && !/[\r\n,;<>"]/.test(value);
  // Two addresses are the same person whatever their capitals.
  const emailKey = (email) => String(email == null ? "" : email).trim().toLowerCase();
  const cleanName = (name) => String(name == null ? "" : name).replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  // "ashtrower@example.com" plays as "Ashtrower" until a name is typed.
  const nameFromEmail = (email) => String(email == null ? "" : email).trim().split("@")[0].slice(0, NAME_MAX).replace(/^./, (c) => c.toUpperCase());

  function hash(text, seed) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return h;
  }
  function idOf(email) {
    const key = emailKey(email);
    return "p" + hash(key, 2166136261).toString(36) + hash(key.split("").reverse().join(""), 3339675911).toString(36);
  }

  const number = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);
  // The player played or added last comes first, then by name.
  const latest = (p) => Math.max(p.usedAt, p.addedAt);
  const sorted = (list) => list.slice().sort((a, b) => latest(b) - latest(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  // The saved document as a list. Anything that isn't a player with an email address is left out.
  function listOf(data) {
    const map = data && data.players && typeof data.players === "object" ? data.players : {};
    const out = [];
    for (const id of Object.keys(map)) {
      const p = map[id];
      if (!p || typeof p !== "object" || !looksLikeEmail(String(p.email || "").trim())) continue;
      const email = String(p.email).trim();
      out.push({ id, name: cleanName(p.name) || nameFromEmail(email), email, addedAt: number(p.addedAt), usedAt: number(p.usedAt) });
    }
    return sorted(out);
  }

  const find = (list, email) => { const key = emailKey(email); return (key && (list || []).find((p) => emailKey(p.email) === key)) || null; };
  // Someone else on the list who already has this address (while a player is being edited).
  const clash = (list, email, exceptId) => { const p = find(list, email); return p && p.id !== exceptId ? p : null; };

  // What to save for a player. `base` is what is kept from before: the player as saved (so a name
  // that isn't typed again stays), or just their dates while they are being edited.
  function entry(base, typed, now, used) {
    const email = String((typed && typed.email) || "").trim();
    const name = cleanName(typed && typed.name) || cleanName(base && base.name) || nameFromEmail(email);
    return { id: idOf(email), fields: { name, email, addedAt: number(base && base.addedAt) || number(now), usedAt: used ? number(now) : number(base && base.usedAt) } };
  }

  // The list after a change, before the saved document has answered: { id: fields, or null to remove }.
  function apply(list, changes) {
    const out = (list || []).filter((p) => !(p.id in changes));
    for (const id of Object.keys(changes)) if (changes[id]) out.push(Object.assign({ id }, changes[id]));
    return sorted(out);
  }

  const gameTime = (g) => { const t = Date.parse(String((g && g.timestamp) || "").replace(" ", "T")); return Number.isFinite(t) ? t : 0; };

  // The people already in your record (saved two-player games), for a list that starts with them:
  // each address once, under the latest name that was typed for it ("Ashley") rather than one a game
  // made from the address ("Ashtrower").
  function fromGames(games, myEmail) {
    const byEmail = new Map();
    for (const g of games || []) {
      const email = String((g && g.opponentEmail) || "").trim(), key = emailKey(email);
      if (!looksLikeEmail(email) || key === emailKey(myEmail)) continue;
      const at = gameTime(g), name = cleanName(g.opponentName);
      const typed = !!name && name.toLowerCase() !== nameFromEmail(email).toLowerCase();
      let p = byEmail.get(key);
      if (!p) { p = { email, first: at, last: at, typed: "", typedAt: -1 }; byEmail.set(key, p); }
      if (at >= p.last) { p.last = at; p.email = email; }
      if (at < p.first) p.first = at;
      if (typed && at >= p.typedAt) { p.typed = name; p.typedAt = at; }
    }
    const found = [...byEmail.values()].sort((a, b) => b.last - a.last).slice(0, MAX);
    const out = {};
    for (const p of found) out[idOf(p.email)] = { name: p.typed || nameFromEmail(p.email), email: p.email, addedAt: p.first, usedAt: p.last };
    return out;
  }

  // Your games against one player: the finished ones, who won them, and when you last played.
  function record(games, email) {
    const key = emailKey(email), out = { played: 0, won: 0, lost: 0, last: "" };
    if (!key) return out;
    for (const g of games || []) {
      if (!g || emailKey(g.opponentEmail) !== key) continue;
      if (g.result === "won") { out.played += 1; out.won += 1; }
      else if (g.result === "lost") { out.played += 1; out.lost += 1; }
      if (String(g.timestamp || "") > out.last) out.last = String(g.timestamp);
    }
    return out;
  }

  // "Nov 16", with the year when it isn't this one.
  function dayWord(timestamp, today) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(timestamp || ""));
    if (!m || !MONTHS[Number(m[2]) - 1]) return "";
    const year = today instanceof Date ? today.getFullYear() : Number(m[1]);
    return MONTHS[Number(m[2]) - 1] + " " + Number(m[3]) + (Number(m[1]) === year ? "" : ", " + m[1]);
  }

  function recordLine(rec, name, today) {
    const who = String(name || "").trim().split(/\s+/)[0] || "they";
    const day = dayWord(rec.last, today);
    if (!rec.played) return day ? "No finished games yet. Last played " + day + "." : "No games together yet.";
    return rec.played + (rec.played === 1 ? " game" : " games") + " played: you won " + rec.won + ", " + who + " won " + rec.lost + "." + (day ? " Last played " + day + "." : "");
  }

  return { MAX, NAME_MAX, looksLikeEmail, emailKey, cleanName, nameFromEmail, idOf, listOf, find, clash, entry, apply, fromGames, record, dayWord, recordLine };
});
