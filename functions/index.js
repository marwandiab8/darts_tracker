const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret, defineString } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

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

exports.syncDartsPracticeSummaryToTimeLeft = onDocumentWritten(
  {
    region: "northamerica-northeast1",
    document: "sessions/{sessionId}",
    timeoutSeconds: 60,
    memory: "256MiB",
    retry: false,
    secrets: [TIME_LEFT_INGESTION_TOKEN],
  },
  async (event) => {
    const sessionId = event.params && event.params.sessionId;
    const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() || {} : null;
    const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() || {} : null;
    const deleted = before && !after;
    const source = after || before;
    if (!sessionId || !source) return null;

    const ownerUid = DARTS_OWNER_UID.value();
    if (!isOwnerSession(source, ownerUid)) {
      logger.warn("darts Time Left sync skipped: not the owner's session", {
        sourceDocumentPath: `sessions/${sessionId}`,
        ownerConfigured: Boolean(ownerUid),
      });
      return null;
    }

    const item = mapSessionToTimeLeft(source, sessionId, deleted ? "deletedFromSource" : "active");
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
  clampTotal,
  isOwnerSession,
  normalizeDarts,
  mapSessionToTimeLeft,
  rowScoreForMode,
  summarizeTargets,
  timestampDateId,
};
