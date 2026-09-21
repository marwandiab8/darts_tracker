const { onDocumentCreated, onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

if (!admin.apps.length) admin.initializeApp();

const TIME_LEFT_INGESTION_TOKEN = defineSecret("TIME_LEFT_INGESTION_TOKEN");
const TIME_LEFT_CALENDAR_ID = defineString("TIME_LEFT_CALENDAR_ID", { default: "" });
const TIME_LEFT_CONNECTION_ID = defineString("TIME_LEFT_CONNECTION_ID", { default: "" });
const TIME_LEFT_SINGLE_INGEST_ENDPOINT = defineString("TIME_LEFT_SINGLE_INGEST_ENDPOINT", {
  default: "https://northamerica-northeast1-timelefttolive.cloudfunctions.net/ingestExternalDailyItem",
});
const DARTS_FIREBASE_PROJECT_ID = defineString("DARTS_FIREBASE_PROJECT_ID", { default: "dartstracker2026" });
const DARTS_APP_BASE_URL = defineString("DARTS_APP_BASE_URL", { default: "https://dartstracker2026.web.app" });
const DARTS_DEFAULT_TIME_ZONE = defineString("DARTS_DEFAULT_TIME_ZONE", { default: "America/Toronto" });
const DARTS_ALLOWED_SOURCE_PROJECT_IDS = defineString("DARTS_ALLOWED_SOURCE_PROJECT_IDS", { default: "" });
// Anyone with a Google account can sign in to the app and save sessions of their own, so only
// this user's sessions are forwarded to Time Left. Leave it empty and nothing is forwarded.
const DARTS_OWNER_UID = defineString("DARTS_OWNER_UID", { default: "" });
// Emailing the result of a game between two players. The password is a secret; the rest is plain config.
const SMTP_PASS = defineSecret("SMTP_PASS");
const SMTP_HOST = defineString("SMTP_HOST", { default: "smtp.gmail.com" });
const SMTP_PORT = defineString("SMTP_PORT", { default: "465" });
const SMTP_USER = defineString("SMTP_USER", { default: "" });
const MAIL_FROM = defineString("MAIL_FROM", { default: "" });
// The app lets anyone with a Google account sign in, so it must never become a way to send email to
// strangers: only the owner's games are emailed, and at most this many games a day.
const MAX_EMAILED_GAMES_PER_DAY = 20;
const DARTS_SOURCE_PROJECT_ID = "1:151826966768:web:a409ac8d409bf0f796ba35";

const TARGETS = [...Array.from({ length: 20 }, (_, index) => String(20 - index)), "BULL"];
const SCORE_VALS = { "-": 0, S: 1, D: 2, T: 3, B: 1 };
// A practice session scores at most 3 darts on each of 21 targets, so anything above this is not real.
const MAX_SESSION_TOTAL = 200;

function commaList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanString(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isDateId(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function formatDateInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function timestampDateId(timestamp, timeZone = "America/Toronto") {
  if (!timestamp) return "";
  if (typeof timestamp === "string") {
    if (timestamp.includes(" ")) {
      const datePart = timestamp.split(" ")[0];
      return isDateId(datePart) ? datePart : "";
    }
    return isDateId(timestamp) ? timestamp.trim() : "";
  }
  if (timestamp instanceof Date && !Number.isNaN(timestamp.getTime())) {
    return formatDateInTimeZone(timestamp, timeZone);
  }
  if (typeof timestamp.toDate === "function") {
    return formatDateInTimeZone(timestamp.toDate(), timeZone);
  }
  if (typeof timestamp.seconds === "number") {
    return formatDateInTimeZone(new Date(timestamp.seconds * 1000), timeZone);
  }
  return "";
}

function rowScoreForMode(values, mode) {
  const arr = Array.isArray(values) ? values : ["-", "-", "-"];
  if (mode === "single") return arr.reduce((sum, value) => sum + (value && value !== "-" ? 1 : 0), 0);
  return arr.reduce((sum, value) => sum + (SCORE_VALS[value] || 0), 0);
}

// Session documents are written by the browser, so treat their contents as untrusted:
// keep only the letters the app can produce, three per target.
function normalizeDarts(values) {
  const list = Array.isArray(values) ? values.slice(0, 3) : [];
  const darts = list.map((value) => (typeof value === "string" && Object.prototype.hasOwnProperty.call(SCORE_VALS, value) ? value : "-"));
  while (darts.length < 3) darts.push("-");
  return darts;
}

function clampTotal(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(MAX_SESSION_TOTAL, Math.max(0, Math.round(number)));
}

function isOwnerSession(session, ownerUid) {
  return Boolean(ownerUid) && typeof (session && session.uid) === "string" && session.uid === ownerUid;
}

// The backfill endpoint is reachable from the internet, so it needs a real login: a Firebase ID
// token that belongs to the owner. (It used to accept the Time Left ingestion token, which is a
// credential for sending data out, and it compared it without a constant-time check.)
async function authorizeBackfill({ authorization, verifyIdToken, ownerUid }) {
  if (!ownerUid) return { ok: false, status: 503, error: "Backfill is not configured." };
  const match = String(authorization || "").match(/^Bearer\s+(\S+)\s*$/i);
  if (!match) return { ok: false, status: 401, error: "Sign in required." };
  let decoded;
  try {
    decoded = await verifyIdToken(match[1]);
  } catch (_) {
    return { ok: false, status: 401, error: "Sign in required." };
  }
  if (!decoded || decoded.uid !== ownerUid) return { ok: false, status: 403, error: "Forbidden." };
  return { ok: true };
}

function summarizeTargets(entry, mode) {
  return TARGETS.map((target) => {
    const darts = normalizeDarts(entry && entry[target]);
    return {
      target,
      darts,
      score: rowScoreForMode(darts, mode),
      hits: darts.filter((value) => value && value !== "-").length,
    };
  });
}

function bestTargets(targets) {
  return [...targets]
    .filter((row) => row.hits > 0 || row.score > 0)
    .sort((a, b) => b.score - a.score || Number(b.target === "BULL") - Number(a.target === "BULL"))
    .slice(0, 5);
}

function mapSessionToTimeLeft(session, sessionId, syncStatus = "active") {
  const mode = session.mode === "single" ? "single" : "standard";
  const timeZone = DARTS_DEFAULT_TIME_ZONE.value() || "America/Toronto";
  const dateId = timestampDateId(session.timestamp || session.dateId || session.createdAt, timeZone);
  const total = clampTotal(session.total);
  const targetSummaries = summarizeTargets(session.entry || {}, mode);
  const best = bestTargets(targetSummaries);
  const appBaseUrl = String(DARTS_APP_BASE_URL.value() || "").replace(/\/+$/, "");

  return {
    dateId: dateId || undefined,
    sourceApp: "DartstRacker2026",
    category: "dartsRecord",
    title: `${mode === "single" ? "Singles practice" : "Darts practice"} summary`,
    summary: `Practice score ${total}${best.length ? `; best targets: ${best.map((row) => `${row.target} (${row.score})`).join(", ")}` : ""}.`,
    description: best.length
      ? `Top targets: ${best.map((row) => `${row.target}: ${row.darts.join("")} = ${row.score}`).join("; ")}.`
      : "Practice session saved from Darts Tracker.",
    sourceFirebaseProjectId: DARTS_FIREBASE_PROJECT_ID.value() || "dartstracker2026",
    sourceProjectName: "Darts Tracker",
    sourceProjectId: DARTS_SOURCE_PROJECT_ID,
    sourceCollection: "sessions",
    sourceDocumentId: sessionId,
    sourceDocumentPath: `sessions/${sessionId}`,
    sourceStoragePath: null,
    sourceUrl: appBaseUrl ? `${appBaseUrl}/` : "",
    fileUrl: null,
    thumbnailUrl: null,
    contentType: null,
    fileName: null,
    fileSize: null,
    originalCreatedAt: session.createdAt || null,
    originalUpdatedAt: session.updatedAt || null,
    capturedAt: session.timestamp || session.createdAt || null,
    visibility: "ownerOnly",
    syncStatus,
    metadata: {
      uid: session.uid || null,
      mode,
      total,
      timestamp: cleanString(session.timestamp || ""),
      targetSummaries,
      bestTargets: best,
      source: "dartstracker2026",
    },
  };
}

const BOT_RANK_NAMES = { beginner: "Beginner", casual: "Casual", club: "Club", league: "League", pro: "Pro" };

function cleanNumber(value, low, high, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const clamped = Math.min(high, Math.max(low, number));
  const scale = 10 ** digits;
  return Math.round(clamped * scale) / scale;
}

// A practice game against the bot. Like a session, it is written by the browser, so every field is
// checked or clamped here. The dart positions stay in Darts Tracker; only a summary is sent.
function mapBotGameToTimeLeft(game, gameId, syncStatus = "active") {
  const timeZone = DARTS_DEFAULT_TIME_ZONE.value() || "America/Toronto";
  const dateId = timestampDateId(game.timestamp || game.dateId || game.createdAt, timeZone);
  const appBaseUrl = String(DARTS_APP_BASE_URL.value() || "").replace(/\/+$/, "");

  const kind = game.kind === "cricket" ? "cricket" : "x01";
  const rank = Object.prototype.hasOwnProperty.call(BOT_RANK_NAMES, game.rank) ? game.rank : "club";
  const result = ["won", "lost", "abandoned"].includes(game.result) ? game.result : "abandoned";
  const startScore = kind === "x01" && Number.isInteger(game.startScore) && game.startScore >= 201 && game.startScore <= 701 ? game.startScore : null;
  const doubleOut = kind === "x01" ? game.doubleOut !== false : null;
  const playerAvg = cleanNumber(game.playerAvg, 0, 300);
  const botAvg = cleanNumber(game.botAvg, 0, 300);
  const playerDarts = Array.isArray(game.playerDarts) ? Math.min(game.playerDarts.length, 600) : 0;
  const botDarts = Array.isArray(game.botDarts) ? Math.min(game.botDarts.length, 600) : 0;
  const durationSec = cleanNumber(game.durationSec, 0, 86400, 0);

  const gameName = kind === "cricket" ? "Cricket" : `${startScore || 501}${doubleOut ? "" : " straight out"}`;
  const rankName = BOT_RANK_NAMES[rank];
  const resultWord = { won: "Won", lost: "Lost", abandoned: "Unfinished" }[result];
  const averageName = kind === "cricket" ? "marks per round" : "three-dart average";
  const scores = [];
  if (playerAvg !== null && playerDarts) scores.push(`Your ${averageName} ${playerAvg} against ${botAvg === null ? "the bot's" : botAvg}`);

  return {
    dateId: dateId || undefined,
    sourceApp: "DartstRacker2026",
    category: "dartsRecord",
    title: `Bot practice: ${gameName} vs ${rankName} (${result})`,
    summary: `${resultWord} ${gameName} against the ${rankName} bot${scores.length ? `. ${scores[0]}` : ""}${playerDarts ? `. ${playerDarts} darts thrown` : ""}.`,
    description: `Practice game against the ${rankName} bot in Darts Tracker: ${gameName}, ${result}.`,
    sourceFirebaseProjectId: DARTS_FIREBASE_PROJECT_ID.value() || "dartstracker2026",
    sourceProjectName: "Darts Tracker",
    sourceProjectId: DARTS_SOURCE_PROJECT_ID,
    sourceCollection: "botGames",
    sourceDocumentId: gameId,
    sourceDocumentPath: `botGames/${gameId}`,
    sourceStoragePath: null,
    sourceUrl: appBaseUrl ? `${appBaseUrl}/practice.html` : "",
    fileUrl: null,
    thumbnailUrl: null,
    contentType: null,
    fileName: null,
    fileSize: null,
    originalCreatedAt: game.createdAt || null,
    originalUpdatedAt: game.updatedAt || null,
    capturedAt: game.timestamp || game.createdAt || null,
    visibility: "ownerOnly",
    syncStatus,
    metadata: {
      uid: game.uid || null,
      practiceType: "bot",
      kind,
      startScore,
      doubleOut,
      rank,
      result,
      playerAvg,
      botAvg,
      playerScore: cleanNumber(game.playerScore, 0, 100000, 0),
      botScore: cleanNumber(game.botScore, 0, 100000, 0),
      playerDarts,
      botDarts,
      rounds: cleanNumber(game.rounds, 0, 1000, 0),
      durationSec,
      timestamp: cleanString(game.timestamp || ""),
      source: "dartstracker2026",
    },
  };
}

// --- emailing the result of a game between two players ---------------------------------------------

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isEmail(value) {
  return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value) && !/[\r\n,;<>"]/.test(value);
}

// Who gets the email: the two players, once each, and only addresses that look like real ones.
function versusRecipients(game) {
  const first = { email: String(game.playerEmail || "").trim(), name: cleanString(game.playerName, 60) || "Player 1" };
  const second = { email: String(game.opponentEmail || "").trim(), name: cleanString(game.opponentName, 60) || "Player 2" };
  const seen = new Set();
  return [first, second].filter((person) => {
    const key = person.email.toLowerCase();
    if (!isEmail(person.email) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function versusSummary(game) {
  const kind = game.kind === "cricket" ? "cricket" : "x01";
  const startScore = kind === "x01" && Number.isInteger(game.startScore) ? game.startScore : null;
  const gameName = kind === "cricket" ? "Cricket" : `${startScore || 501}${game.doubleOut === false ? " straight out" : ""}`;
  const names = [cleanString(game.playerName, 60) || "Player 1", cleanString(game.opponentName, 60) || "Player 2"];
  const result = ["won", "lost", "abandoned"].includes(game.result) ? game.result : "abandoned";
  const winner = result === "won" ? names[0] : result === "lost" ? names[1] : null;
  const loser = result === "won" ? names[1] : result === "lost" ? names[0] : null;
  const average = (value) => (Number.isFinite(Number(value)) ? (Math.round(Number(value) * 10) / 10).toFixed(1) : "-");
  const count = (list) => (Array.isArray(list) ? Math.min(list.length, 600) : 0);
  const rows = [
    { name: names[0], average: average(game.playerAvg), darts: count(game.playerDarts), score: cleanNumber(game.playerScore, 0, 100000, 0) },
    { name: names[1], average: average(game.opponentAvg), darts: count(game.opponentDarts), score: cleanNumber(game.opponentScore, 0, 100000, 0) },
  ];
  const log = (Array.isArray(game.log) ? game.log : []).slice(0, 400).map((entry) => ({
    first: entry && entry.w === "p",
    text: cleanString(entry && entry.t, 30),
  }));
  const best = [0, 0];
  if (kind === "x01") {
    for (const entry of log) {
      const value = Number(entry.text);
      if (Number.isFinite(value)) best[entry.first ? 0 : 1] = Math.max(best[entry.first ? 0 : 1], value);
    }
  }
  return { kind, gameName, names, result, winner, loser, rows, log, best, timestamp: cleanString(game.timestamp, 20), durationSec: cleanNumber(game.durationSec, 0, 86400, 0), rounds: cleanNumber(game.rounds, 0, 1000, 0) };
}

function buildVersusEmail(game, appUrl = "") {
  const info = versusSummary(game);
  const averageName = info.kind === "cricket" ? "Marks per round" : "3-dart average";
  const scoreName = info.kind === "cricket" ? "Points" : "Left";
  const headline = info.winner ? `${info.winner} won` : "Game ended";
  const subject = info.winner ? `Darts: ${info.winner} beat ${info.loser} at ${info.gameName}` : `Darts: ${info.gameName} between ${info.names[0]} and ${info.names[1]}`;

  const minutes = info.durationSec ? Math.max(1, Math.round(info.durationSec / 60)) : 0;
  const facts = [`${info.gameName}${info.timestamp ? `, ${info.timestamp}` : ""}`, info.rounds ? `${info.rounds} rounds` : "", minutes ? `${minutes} min` : ""].filter(Boolean).join(" · ");

  const lines = [`${headline}!`, facts, ""];
  info.rows.forEach((row, index) => {
    lines.push(`${row.name}: ${averageName.toLowerCase()} ${row.average}, ${row.darts} darts, ${scoreName.toLowerCase()} ${row.score}${info.kind === "x01" && info.best[index] ? `, best visit ${info.best[index]}` : ""}`);
  });
  if (info.log.length) {
    lines.push("", "Visit by visit:");
    let round = 0;
    for (let i = 0; i < info.log.length; i += 2) {
      round += 1;
      const pair = [info.log[i], info.log[i + 1]];
      lines.push(`${round}. ${info.names[0]} ${pair[0] ? pair[0].text : "-"} · ${info.names[1]} ${pair[1] ? pair[1].text : "-"}`);
    }
  }
  if (appUrl) lines.push("", `Play again: ${appUrl}/practice.html`);
  const text = lines.join("\n");

  const cell = (value, extra = "") => `<td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;${extra}">${escapeHtml(value)}</td>`;
  const head = (value) => `<th style="padding:6px 10px;text-align:left;color:#6b7280;font-size:12px;border-bottom:2px solid #e5e7eb">${escapeHtml(value)}</th>`;
  const stats = info.rows.map((row, index) => `<tr>${cell(row.name, "font-weight:700")}${cell(row.average)}${cell(row.darts)}${cell(row.score)}${info.kind === "x01" ? cell(info.best[index] || "-") : ""}</tr>`).join("");
  let visitRows = "";
  for (let i = 0; i < info.log.length; i += 2) {
    visitRows += `<tr>${cell(i / 2 + 1)}${cell(info.log[i] ? info.log[i].text : "-")}${cell(info.log[i + 1] ? info.log[i + 1].text : "-")}</tr>`;
  }
  const html = [
    `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#111827">`,
    `<h2 style="margin:0 0 4px">${escapeHtml(headline)}!</h2>`,
    `<p style="margin:0 0 16px;color:#6b7280">${escapeHtml(facts)}</p>`,
    `<table style="border-collapse:collapse;width:100%"><tr>${head("Player")}${head(averageName)}${head("Darts")}${head(scoreName)}${info.kind === "x01" ? head("Best visit") : ""}</tr>${stats}</table>`,
    info.log.length ? `<h3 style="margin:20px 0 6px;font-size:15px">Visit by visit</h3><table style="border-collapse:collapse;width:100%"><tr>${head("Round")}${head(info.names[0])}${head(info.names[1])}</tr>${visitRows}</table>` : "",
    appUrl ? `<p style="margin-top:20px"><a href="${escapeHtml(appUrl)}/practice.html">Play again</a></p>` : "",
    `</div>`,
  ].join("");
  return { subject: cleanString(subject, 150), text, html };
}

// Send the result to both players, each in a message of their own so the addresses are not shared.
// Returns { status, sent } where status is "sent", "unfinished", "not-configured" or "failed".
async function sendVersusResults({ game, config, transport, appUrl }) {
  if (game.result === "abandoned") return { status: "unfinished", sent: [] };
  if (!config.user || !config.pass) return { status: "not-configured", sent: [] };
  const recipients = versusRecipients(game);
  if (recipients.length < 1) return { status: "failed", sent: [], error: "No valid email address." };
  const message = buildVersusEmail(game, appUrl);
  const sent = [];
  try {
    for (const person of recipients) {
      await transport.sendMail({
        from: config.from || config.user,
        to: person.email,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      sent.push(person.email);
    }
  } catch (error) {
    const reason = String((error && error.message) || error).split(config.pass).join("***").slice(0, 200);
    return { status: "failed", sent, error: reason };
  }
  return { status: "sent", sent };
}

function readConfig() {
  return {
    calendarId: TIME_LEFT_CALENDAR_ID.value(),
    connectionId: TIME_LEFT_CONNECTION_ID.value(),
    endpoint: TIME_LEFT_SINGLE_INGEST_ENDPOINT.value(),
    token: TIME_LEFT_INGESTION_TOKEN.value(),
    allowedSourceProjectIds: commaList(DARTS_ALLOWED_SOURCE_PROJECT_IDS.value()),
  };
}

function validateConfig(config, item) {
  const missing = [];
  if (!config.calendarId) missing.push("TIME_LEFT_CALENDAR_ID");
  if (!config.connectionId) missing.push("TIME_LEFT_CONNECTION_ID");
  if (!config.endpoint) missing.push("TIME_LEFT_SINGLE_INGEST_ENDPOINT");
  if (!config.token) missing.push("TIME_LEFT_INGESTION_TOKEN");
  if (missing.length) throw new Error(`Time Left darts sync is not configured: ${missing.join(", ")}`);
  if (config.allowedSourceProjectIds.length && !config.allowedSourceProjectIds.includes(item.sourceProjectId)) {
    throw new Error(`sourceProjectId is not locally allowlisted: ${item.sourceProjectId}`);
  }
}

async function postToTimeLeft(item) {
  const config = readConfig();
  validateConfig(config, item);
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      calendarId: config.calendarId,
      connectionId: config.connectionId,
      item,
    }),
  });
  const text = await response.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (_) {
      body = { raw: text.slice(0, 1000) };
    }
  }
  if (!response.ok) {
    const error = new Error(body.error || body.message || `Time Left ingestion failed with HTTP ${response.status}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

// Forwards a changed document to Time Left, for the owner only. Failures are logged, not thrown,
// so a Time Left outage never fails or retries a save in the app.
async function forwardOwnerDocument({ event, collectionName, idParam, mapItem }) {
  const documentId = event.params && event.params[idParam];
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() || {} : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() || {} : null;
  const deleted = before && !after;
  const source = after || before;
  if (!documentId || !source) return null;

  const ownerUid = DARTS_OWNER_UID.value();
  if (!isOwnerSession(source, ownerUid)) {
    logger.warn("darts Time Left sync skipped: not the owner's document", {
      sourceDocumentPath: `${collectionName}/${documentId}`,
      ownerConfigured: Boolean(ownerUid),
    });
    return null;
  }

  const item = mapItem(source, documentId, deleted ? "deletedFromSource" : "active");
  try {
    const result = await postToTimeLeft(item);
    logger.info("darts Time Left sync complete", {
      sourceDocumentPath: item.sourceDocumentPath,
      dateId: item.dateId || null,
      category: item.category,
      syncStatus: item.syncStatus,
    });
    return result;
  } catch (error) {
    const responseMessage =
      error.body && typeof error.body === "object"
        ? cleanString(error.body.error || error.body.message || error.body.raw || "", 300)
        : "";
    logger.warn("darts Time Left sync failed", {
      sourceDocumentPath: item.sourceDocumentPath,
      sourceApp: item.sourceApp,
      sourceFirebaseProjectId: item.sourceFirebaseProjectId,
      sourceProjectId: item.sourceProjectId,
      dateId: item.dateId || null,
      status: error.status || null,
      responseMessage: responseMessage || null,
      message: String(error.message || error).slice(0, 300),
    });
    return null;
  }
}

const SYNC_OPTIONS = {
  region: "northamerica-northeast1",
  timeoutSeconds: 60,
  memory: "256MiB",
  retry: false,
  secrets: [TIME_LEFT_INGESTION_TOKEN],
};

exports.syncDartsPracticeSummaryToTimeLeft = onDocumentWritten(
  { ...SYNC_OPTIONS, document: "sessions/{sessionId}" },
  (event) => forwardOwnerDocument({ event, collectionName: "sessions", idParam: "sessionId", mapItem: mapSessionToTimeLeft })
);

exports.syncBotGameToTimeLeft = onDocumentWritten(
  { ...SYNC_OPTIONS, document: "botGames/{gameId}" },
  (event) => forwardOwnerDocument({ event, collectionName: "botGames", idParam: "gameId", mapItem: mapBotGameToTimeLeft })
);

// What happens when a two-player game is saved: who may have it emailed, the daily cap, the send, and
// the status written back to the game. `countRecent` and `send` are passed in so it can be tested.
async function processVersusGame({ game, ref, ownerUid, countRecent, send }) {
  if (game.emailStatus) return "already-done";
  const finish = async (fields) => {
    try {
      await ref.update(fields);
    } catch (error) {
      logger.warn("could not record the email status", { message: String((error && error.message) || error).slice(0, 200) });
    }
  };
  if (!isOwnerSession(game, ownerUid)) {
    logger.warn("versus email skipped: not the owner's game", { path: ref.path, ownerConfigured: Boolean(ownerUid) });
    await finish({ emailStatus: "not-allowed" });
    return "not-allowed";
  }
  if (game.result === "abandoned") {
    await finish({ emailStatus: "unfinished" });
    return "unfinished";
  }
  try {
    if ((await countRecent()) >= MAX_EMAILED_GAMES_PER_DAY) {
      await finish({ emailStatus: "rate-limited" });
      return "rate-limited";
    }
  } catch (error) {
    logger.warn("versus email daily count failed", { message: String((error && error.message) || error).slice(0, 200) });
  }
  const result = await send();
  logger.info("versus email finished", { path: ref.path, status: result.status, recipients: result.sent.length });
  const update = { emailStatus: result.status };
  if (result.status === "sent") update.emailedAt = admin.firestore.FieldValue.serverTimestamp();
  if (result.error) update.emailError = result.error;
  await finish(update);
  return result.status;
}

exports.emailVersusGameResults = onDocumentCreated(
  {
    region: "northamerica-northeast1",
    document: "versusGames/{gameId}",
    timeoutSeconds: 60,
    memory: "256MiB",
    retry: false,
    secrets: [SMTP_PASS],
  },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return null;
    const port = Number(SMTP_PORT.value()) || 465;
    const config = { user: SMTP_USER.value(), pass: SMTP_PASS.value(), from: MAIL_FROM.value() };
    const appUrl = String(DARTS_APP_BASE_URL.value() || "").replace(/\/+$/, "");
    await processVersusGame({
      game: snapshot.data() || {},
      ref: snapshot.ref,
      ownerUid: DARTS_OWNER_UID.value(),
      countRecent: async () => {
        const since = admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);
        const recent = await admin.firestore().collection("versusGames").where("emailedAt", ">=", since).count().get();
        return recent.data().count;
      },
      send: async () => {
        const transport = config.user && config.pass
          ? nodemailer.createTransport({ host: SMTP_HOST.value() || "smtp.gmail.com", port, secure: port === 465, auth: { user: config.user, pass: config.pass } })
          : null;
        return sendVersusResults({ game: snapshot.data() || {}, config, transport, appUrl });
      },
    });
    return null;
  }
);

exports.backfillDartsPracticeSummariesToTimeLeft = onRequest(
  {
    region: "northamerica-northeast1",
    invoker: "public",
    timeoutSeconds: 120,
    memory: "256MiB",
    secrets: [TIME_LEFT_INGESTION_TOKEN],
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).set("Allow", "POST").json({ ok: false, error: "Use POST." });
      return;
    }
    const ownerUid = DARTS_OWNER_UID.value();
    const auth = await authorizeBackfill({
      authorization: req.get("authorization"),
      verifyIdToken: (token) => admin.auth().verifyIdToken(token),
      ownerUid,
    });
    if (!auth.ok) {
      res.status(auth.status).json({ ok: false, error: auth.error });
      return;
    }

    // Always the owner's sessions; a uid in the request is ignored.
    const limit = Math.max(1, Math.min(500, Number(req.query.limit || req.body?.limit || 100) || 100));
    const query = admin.firestore().collection("sessions").where("uid", "==", ownerUid).limit(limit);

    const snap = await query.get();
    const result = { ok: true, scanned: 0, sent: 0, failed: 0, errors: [] };
    for (const doc of snap.docs) {
      result.scanned += 1;
      const item = mapSessionToTimeLeft(doc.data() || {}, doc.id, "active");
      try {
        await postToTimeLeft(item);
        result.sent += 1;
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          sourceDocumentPath: item.sourceDocumentPath,
          status: error.status || null,
          message: String(error.message || error).slice(0, 200),
        });
      }
    }
    res.json(result);
  }
);

module.exports._test = {
  authorizeBackfill,
  buildVersusEmail,
  escapeHtml,
  forwardOwnerDocument,
  processVersusGame,
  sendVersusResults,
  versusRecipients,
  clampTotal,
  isOwnerSession,
  normalizeDarts,
  mapBotGameToTimeLeft,
  mapSessionToTimeLeft,
  rowScoreForMode,
  summarizeTargets,
  timestampDateId,
};
