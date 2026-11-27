// DartCounter matches -> Time Left To Live.
//
// DartCounter (app.dartcounter.net) sends no emails and has no export, but its web app reads the
// signed-in player's matches from https://api.dartcounter.net/matches with a bearer token. Every
// 15 minutes `pullMatches` reads the newest page with that token, keeps each finished match once in
// Firestore (`dartcounterMatches/{matchId}`), and the usual Firestore trigger forwards the document
// to Time Left as a completed darts match, like the DartConnect Inbox does for DartConnect recaps.
// The first runs also walk the older pages until the whole history is in (the "backfill").
//
// Everything here takes its dependencies as arguments (fetch, Firestore, clock, logger) so the tests
// run it without the network or the emulator.

const DARTCOUNTER_API = "https://api.dartcounter.net";
const PAGE_SIZE = 25;
// How many pages one run reads at most: 12 x 25 = 300 matches, so a 350-match history takes two runs.
const MAX_PAGES_PER_RUN = 12;
const PAUSE_BETWEEN_PAGES_MS = 400;
const STATE_DOC = "dartcounterSync/state";
const MATCHES_COLLECTION = "dartcounterMatches";
const MAX_OPPONENTS = 7;
const MAX_NAME = 60;

function clean(value, max = MAX_NAME) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim().slice(0, max);
}

function num(value, min = -Infinity, max = Infinity) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function int(value, min = 0, max = 100000) {
  const number = num(value, min, max);
  return number === null ? null : Math.round(number);
}

function round2(value) {
  return value === null ? null : Math.round(value * 100) / 100;
}

// Unix seconds (what the API sends) or an ISO string -> unix seconds, or null.
function unixSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? Math.round(ms / 1000) : null;
}

function playerFromApi(user) {
  const source = user && typeof user === "object" ? user : {};
  const nested = source.user && typeof source.user === "object" ? source.user : {};
  return {
    userId: int(source.user_id, 0, 1e12),
    name: clean(source.player_name || nested.full_name || nested.first_name || nested.username || "") || "Player",
    result: ["won", "lost", "draw", "drew"].includes(source.result) ? (source.result === "draw" ? "drew" : source.result) : null,
    legsWon: int(source.legs_won, 0, 500),
    setsWon: int(source.sets_won, 0, 100),
    average: round2(num(source.three_dart_average, 0, 180)),
    highestFinish: int(source.highest_finish, 0, 170),
    highestScore: int(source.highest_score, 0, 180),
    checkedLegs: int(source.checked_legs, 0, 500),
    isCpu: source.is_cpu === true,
    cpuLevel: source.cpu_level === null || source.cpu_level === undefined ? null : clean(source.cpu_level, 20),
  };
}

// One match from GET /matches as the Firestore document `dartcounterMatches/{id}`: the settings and
// each player's line, with the owner ("me") told apart from the opponents by DartCounter user id.
// Returns null for a match that is not finished or that the owner did not play in.
function normalizeMatch(match, { ownerUid, myUserId }) {
  if (!match || typeof match !== "object") return null;
  const matchId = clean(match.id, 80);
  const finishedAt = unixSeconds(match.finished_at);
  const startedAt = unixSeconds(match.started_at) || finishedAt;
  if (!matchId || !finishedAt || !startedAt) return null;

  const players = (Array.isArray(match.users) ? match.users : []).slice(0, MAX_OPPONENTS + 1).map(playerFromApi);
  const myIndex = players.findIndex((player) => player.userId !== null && player.userId === Number(myUserId));
  if (myIndex < 0) return null;
  const me = players[myIndex];
  const opponents = players.filter((_, index) => index !== myIndex);

  const settings = match.settings && typeof match.settings === "object" ? match.settings : {};
  return {
    uid: ownerUid,
    matchId,
    source: "dartcounter",
    startedAt,
    finishedAt,
    durationSec: Math.max(0, Math.min(86400, finishedAt - startedAt)),
    settings: {
      startScore: int(settings.start_score, 101, 1001),
      endWith: clean(settings.end_with, 20) || null,
      startWith: clean(settings.start_with, 20) || null,
      goalAmount: int(settings.goal_amount, 1, 99),
      isBestOf: settings.is_best_of === true,
      hasSets: settings.has_sets === true,
      hasTeams: settings.has_teams === true,
      isOnline: settings.is_online === true,
      isRanked: settings.is_ranked_game === true,
      vsCpu: settings.vs_cpu === true || opponents.some((player) => player.isCpu),
      onlineGameplayType: clean(settings.online_gameplay_type, 30) || null,
      players: int(settings.amount_of_players, 1, 20) || players.length,
    },
    me,
    opponents,
  };
}

function resultOf(doc) {
  const me = doc.me || {};
  if (me.result === "won" || me.result === "lost" || me.result === "drew") return me.result;
  const mine = me.legsWon || 0;
  const best = Math.max(0, ...(doc.opponents || []).map((player) => player.legsWon || 0));
  return mine > best ? "won" : mine < best ? "lost" : "drew";
}

function opponentLabel(doc) {
  const opponents = Array.isArray(doc.opponents) ? doc.opponents : [];
  if (!opponents.length) return "nobody";
  const names = opponents.map((player) => {
    if (player.isCpu) return `the DartCounter bot${player.cpuLevel ? ` (level ${player.cpuLevel})` : ""}`;
    return player.name || "Player";
  });
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function gameLabel(settings) {
  const start = settings.startScore || 501;
  const straightOut = settings.endWith && settings.endWith !== "double_out" && settings.endWith !== "master_out";
  return `${start}${straightOut ? " straight out" : settings.endWith === "master_out" ? " master out" : ""}`;
}

function formatLabel(settings) {
  if (!settings.goalAmount) return "";
  const unit = settings.hasSets ? "sets" : "legs";
  return settings.isBestOf ? `Best of ${settings.goalAmount} ${unit}` : `First to ${settings.goalAmount} ${unit}`;
}

// The Firestore document -> the item posted to Time Left (same shape as the bot games, so it rides
// the same connection and lands under Darts on the Activity wheel).
function mapDartCounterMatchToTimeLeft(doc, matchId, syncStatus, { timeZone, appBaseUrl, sourceFirebaseProjectId, sourceProjectId, formatDateId }) {
  const settings = doc.settings || {};
  const me = doc.me || {};
  const opponents = Array.isArray(doc.opponents) ? doc.opponents : [];
  const first = opponents[0] || {};
  const result = resultOf(doc);
  const resultWord = { won: "Won", lost: "Lost", drew: "Drew" }[result];
  const opponent = opponentLabel(doc);
  const game = gameLabel(settings);
  const bySets = settings.hasSets === true;
  const myScore = bySets ? me.setsWon || 0 : me.legsWon || 0;
  const theirScore = bySets ? first.setsWon || 0 : first.legsWon || 0;
  const where = settings.isRanked ? "Ranked online" : settings.isOnline ? "Online" : "Local";
  const avgText = me.average !== null && me.average !== undefined ? `avg ${me.average}` : "";

  const sentences = [`${where} ${game} match on DartCounter: ${result} ${myScore}–${theirScore} against ${opponent}.`];
  if (bySets && (me.legsWon || first.legsWon)) sentences.push(`Legs ${me.legsWon || 0}–${first.legsWon || 0}.`);
  if (me.average !== null && me.average !== undefined) {
    const theirs = opponents.filter((player) => player.average !== null && player.average !== undefined).map((player) => `${player.isCpu ? "the bot" : player.name} ${player.average}`);
    sentences.push(`My 3-dart average ${me.average}${theirs.length ? `; ${theirs.join(", ")}` : ""}.`);
  }
  const bests = [];
  if (me.highestFinish) bests.push(`highest finish ${me.highestFinish}`);
  if (me.highestScore) bests.push(`highest score ${me.highestScore}`);
  if (bests.length) sentences.push(`${bests.join(", ").replace(/^./, (c) => c.toUpperCase())}.`);
  const format = formatLabel(settings);
  if (format) sentences.push(`${format}.`);
  const minutes = doc.durationSec ? Math.round(doc.durationSec / 60) : 0;
  if (minutes >= 1) sentences.push(`${minutes} minute${minutes === 1 ? "" : "s"}.`);
  const summary = sentences.join(" ");

  const startedAtIso = doc.startedAt ? new Date(doc.startedAt * 1000).toISOString() : null;
  const finishedAtIso = doc.finishedAt ? new Date(doc.finishedAt * 1000).toISOString() : null;
  const dateId = startedAtIso ? formatDateId(new Date(doc.startedAt * 1000), timeZone) : undefined;
  const durationSec = num(doc.durationSec, 0, 86400) || 0;

  const metrics = {
    won: result === "won" ? 1 : 0,
    legsWon: me.legsWon,
    legsLost: opponents.length === 1 ? first.legsWon : null,
    setsWon: bySets ? me.setsWon : null,
    setsLost: bySets && opponents.length === 1 ? first.setsWon : null,
    threeDartAverage: me.average,
    opponentThreeDartAverage: opponents.length === 1 ? first.average : null,
    highestFinish: me.highestFinish || null,
    highestScore: me.highestScore || null,
    checkouts: me.checkedLegs || null,
  };
  Object.keys(metrics).forEach((key) => (metrics[key] === null || metrics[key] === undefined) && delete metrics[key]);

  return {
    dateId,
    sourceApp: "DartstRacker2026",
    category: "dartsRecord",
    title: `${resultWord} ${myScore}–${theirScore} vs ${opponent} on DartCounter (${[game, avgText].filter(Boolean).join(", ")})`,
    summary,
    description: summary,
    sourceFirebaseProjectId,
    sourceProjectName: "Darts Tracker",
    sourceProjectId,
    sourceCollection: MATCHES_COLLECTION,
    sourceDocumentId: matchId,
    sourceDocumentPath: `${MATCHES_COLLECTION}/${matchId}`,
    sourceStoragePath: null,
    sourceUrl: "https://app.dartcounter.net/statistics",
    fileUrl: null,
    thumbnailUrl: null,
    contentType: null,
    fileName: null,
    fileSize: null,
    originalCreatedAt: finishedAtIso,
    originalUpdatedAt: finishedAtIso,
    capturedAt: startedAtIso,
    visibility: "ownerOnly",
    syncStatus,
    metadata: {
      uid: doc.uid || null,
      platform: "DartCounter",
      matchId,
      result,
      score: `${myScore}-${theirScore}`,
      opponent: opponents.length === 1 ? (first.isCpu ? "DartCounter bot" : first.name) : opponent,
      opponents: opponents.map((player) => ({ name: player.isCpu ? "DartCounter bot" : player.name, average: player.average, legsWon: player.legsWon, setsWon: player.setsWon, result: player.result })),
      game,
      format: format || null,
      online: settings.isOnline === true,
      ranked: settings.isRanked === true,
      bot: settings.vsCpu === true,
      startedAt: startedAtIso,
      finishedAt: finishedAtIso,
      durationSec,
      source: "dartcounter",
      note: summary,
    },
    eventType: "completed_darts_match",
    activityFamily: "darts",
    durationSeconds: durationSec > 0 ? durationSec : undefined,
    metrics,
  };
}

class DartCounterAuthError extends Error {}

async function fetchMatchesPage({ fetchImpl, token, page }) {
  const url = `${DARTCOUNTER_API}/matches?limit=${PAGE_SIZE}&page=${page}`;
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });
  if (response.status === 401 || response.status === 403) {
    throw new DartCounterAuthError(`DartCounter refused the token (HTTP ${response.status})`);
  }
  if (!response.ok) {
    const error = new Error(`DartCounter answered HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const body = await response.json();
  return {
    matches: Array.isArray(body && body.data) ? body.data : [],
    lastPage: int(body && body.last_page, 1, 100000) || 1,
    total: int(body && body.total, 0, 1e7),
  };
}

// One scheduled run. `db` is a Firestore instance (admin SDK or a fake with the same calls).
// Returns what it did, and writes the same to `dartcounterSync/state` so a stuck token shows up.
async function pullMatches({ db, fetchImpl, token, ownerUid, myUserId, logger, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxPages = MAX_PAGES_PER_RUN }) {
  const stateRef = db.doc(STATE_DOC);
  const startedMs = now();
  const finish = async (patch) => {
    await stateRef.set({ ...patch, lastRunAt: new Date(now()).toISOString() }, { merge: true });
    return patch;
  };

  if (!token || token === "unset") {
    logger.warn("DartCounter sync: no token yet (set the DARTCOUNTER_TOKEN secret)");
    return finish({ lastStatus: "not-configured", lastNew: 0 });
  }
  if (!ownerUid || !myUserId) {
    logger.warn("DartCounter sync: DARTS_OWNER_UID or DARTCOUNTER_USER_ID is not set");
    return finish({ lastStatus: "not-configured", lastNew: 0 });
  }

  const stateSnap = await stateRef.get();
  const state = (stateSnap.exists && stateSnap.data()) || {};
  const backfillDone = state.backfillDone === true;
  let nextBackfillPage = int(state.nextBackfillPage, 2, 100000) || 2;

  let page = 1;
  let newestRead = 0;
  let pagesRead = 0;
  let added = 0;
  let lastPage = 1;
  let total = null;
  let skipped = 0;

  const storePage = async (matches) => {
    const docs = matches.map((match) => normalizeMatch(match, { ownerUid, myUserId })).filter(Boolean);
    skipped += matches.length - docs.length;
    if (!docs.length) return { added: 0, known: 0 };
    const refs = docs.map((doc) => db.collection(MATCHES_COLLECTION).doc(doc.matchId));
    const snaps = await db.getAll(...refs);
    const batch = db.batch();
    let fresh = 0;
    const nowIso = new Date(now()).toISOString();
    docs.forEach((doc, index) => {
      if (snaps[index].exists) return;
      batch.set(refs[index], { ...doc, createdAt: nowIso, updatedAt: nowIso });
      fresh += 1;
    });
    if (fresh) await batch.commit();
    return { added: fresh, known: docs.length - fresh };
  };

  try {
    // Newest first: page 1, then onwards while every match is new (catching up after a quiet spell).
    while (pagesRead < maxPages) {
      const result = await fetchMatchesPage({ fetchImpl, token, page });
      pagesRead += 1;
      newestRead = page;
      lastPage = result.lastPage;
      total = result.total;
      const stored = await storePage(result.matches);
      added += stored.added;
      if (stored.known > 0 || result.matches.length < PAGE_SIZE || page >= lastPage) break;
      page += 1;
      await sleep(PAUSE_BETWEEN_PAGES_MS);
    }
    // The backfill: older pages, a few per run, until the whole history has been read once.
    let doneBackfill = backfillDone;
    if (!doneBackfill) {
      const resumeFrom = Math.max(nextBackfillPage, newestRead + 1);
      let backPage = resumeFrom;
      while (pagesRead < maxPages && backPage <= lastPage) {
        await sleep(PAUSE_BETWEEN_PAGES_MS);
        const result = await fetchMatchesPage({ fetchImpl, token, page: backPage });
        pagesRead += 1;
        lastPage = result.lastPage;
        const stored = await storePage(result.matches);
        added += stored.added;
        backPage += 1;
      }
      nextBackfillPage = backPage;
      if (backPage > lastPage) doneBackfill = true;
    }
    const summary = {
      lastStatus: "ok",
      lastError: null,
      lastNew: added,
      lastSkipped: skipped,
      lastPagesRead: pagesRead,
      lastPage,
      totalOnDartCounter: total,
      backfillDone: doneBackfill,
      nextBackfillPage: doneBackfill ? null : nextBackfillPage,
      lastRunMs: now() - startedMs,
    };
    logger.info("DartCounter sync run", summary);
    return finish(summary);
  } catch (error) {
    const tokenRejected = error instanceof DartCounterAuthError;
    const patch = {
      lastStatus: tokenRejected ? "token-rejected" : "dartcounter-error",
      lastError: String(error.message || error).slice(0, 300),
      lastNew: added,
      lastPagesRead: pagesRead,
      nextBackfillPage: backfillDone ? null : nextBackfillPage,
    };
    (tokenRejected ? logger.error : logger.warn)(
      tokenRejected
        ? "DartCounter sync: the token was refused. Run scripts/set-dartcounter-token.sh with a fresh one."
        : "DartCounter sync failed; will try again next run",
      patch
    );
    return finish(patch);
  }
}

module.exports = {
  DARTCOUNTER_API,
  MATCHES_COLLECTION,
  MAX_PAGES_PER_RUN,
  PAGE_SIZE,
  STATE_DOC,
  DartCounterAuthError,
  fetchMatchesPage,
  mapDartCounterMatchToTimeLeft,
  normalizeMatch,
  pullMatches,
};
