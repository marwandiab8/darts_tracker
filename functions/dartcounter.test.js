const assert = require("node:assert/strict");
const test = require("node:test");
const { mapDartCounterMatchToTimeLeft, normalizeMatch, pullMatches, PAGE_SIZE, STATE_DOC, MATCHES_COLLECTION } = require("./dartcounter");

const ME = 2231323;
const OWNER = "owner-uid";

// A match as GET https://api.dartcounter.net/matches returns it (trimmed to what the code reads).
function apiMatch(overrides = {}, users) {
  return {
    id: "01a1dbc6-f5c9-7282-8f2f-15ab2cfe4ba6",
    started_at: 1794687509,
    finished_at: 1794688611,
    settings: {
      amount_of_players: 2, end_with: "double_out", goal_amount: 5, has_sets: false, has_teams: false,
      is_best_of: true, is_online: true, is_ranked_game: false, online_gameplay_type: "lobby_game",
      start_score: 501, start_with: "straight_in", vs_cpu: false,
      ...(overrides.settings || {}),
    },
    users: users || [
      { user_id: 9088637, player_name: "Simon", result: "lost", legs_won: 0, sets_won: 0, three_dart_average: 46.16129032258064, highest_finish: null, highest_score: 140, checked_legs: 0, is_cpu: false, cpu_level: null },
      { user_id: ME, player_name: "Marwan", result: "won", legs_won: 3, sets_won: 0, three_dart_average: 49.01086956521739, highest_finish: 20, highest_score: 100, checked_legs: 3, is_cpu: false, cpu_level: null },
    ],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "settings")),
  };
}

const mapOptions = {
  timeZone: "America/Toronto",
  appBaseUrl: "https://dartstracker2026.web.app",
  sourceFirebaseProjectId: "dartstracker2026",
  sourceProjectId: "1:151826966768:web:a409ac8d409bf0f796ba35",
  formatDateId: (date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(date),
};

test("a finished online match becomes a document with me and the opponent apart", () => {
  const doc = normalizeMatch(apiMatch(), { ownerUid: OWNER, myUserId: ME });
  assert.equal(doc.uid, OWNER);
  assert.equal(doc.matchId, "01a1dbc6-f5c9-7282-8f2f-15ab2cfe4ba6");
  assert.equal(doc.me.name, "Marwan");
  assert.equal(doc.me.result, "won");
  assert.equal(doc.me.legsWon, 3);
  assert.equal(doc.me.average, 49.01);
  assert.equal(doc.opponents.length, 1);
  assert.equal(doc.opponents[0].name, "Simon");
  assert.equal(doc.opponents[0].average, 46.16);
  assert.equal(doc.durationSec, 1102);
  assert.equal(doc.settings.isOnline, true);
  assert.equal(doc.settings.vsCpu, false);
});

test("unfinished matches and matches without me are left out", () => {
  assert.equal(normalizeMatch(apiMatch({ finished_at: null }), { ownerUid: OWNER, myUserId: ME }), null);
  assert.equal(normalizeMatch(apiMatch(), { ownerUid: OWNER, myUserId: 1 }), null);
  assert.equal(normalizeMatch(null, { ownerUid: OWNER, myUserId: ME }), null);
});

test("the Time Left item reads like the DartConnect ones and carries the opponent and score", () => {
  const doc = normalizeMatch(apiMatch(), { ownerUid: OWNER, myUserId: ME });
  const item = mapDartCounterMatchToTimeLeft(doc, doc.matchId, "active", mapOptions);
  assert.equal(item.title, "Won 3–0 vs Simon on DartCounter (501, avg 49.01)");
  assert.equal(item.sourceApp, "DartstRacker2026");
  assert.equal(item.category, "dartsRecord");
  assert.equal(item.eventType, "completed_darts_match");
  assert.equal(item.activityFamily, "darts");
  assert.equal(item.sourceDocumentPath, `${MATCHES_COLLECTION}/${doc.matchId}`);
  assert.equal(item.dateId, "2026-11-14");
  assert.equal(item.capturedAt, "2026-11-14T20:18:29.000Z");
  assert.equal(item.durationSeconds, 1102);
  assert.equal(item.metadata.opponent, "Simon");
  assert.equal(item.metadata.score, "3-0");
  assert.equal(item.metadata.online, true);
  assert.equal(item.metadata.platform, "DartCounter");
  assert.deepEqual(item.metrics, {
    won: 1, legsWon: 3, legsLost: 0, threeDartAverage: 49.01, opponentThreeDartAverage: 46.16, highestFinish: 20, highestScore: 100, checkouts: 3,
  });
  assert.match(item.summary, /^Online 501 match on DartCounter: won 3–0 against Simon\. My 3-dart average 49\.01; Simon 46\.16\. Highest finish 20, highest score 100\. Best of 5 legs\. 18 minutes\.$/);
});

test("a lost match against the bot, played at the board, says so", () => {
  const users = [
    { user_id: 1, player_name: "Bot", result: "won", legs_won: 2, sets_won: 0, three_dart_average: 60, is_cpu: true, cpu_level: "7" },
    { user_id: ME, player_name: "Marwan", result: "lost", legs_won: 1, sets_won: 0, three_dart_average: 44.5, highest_score: 85, is_cpu: false },
  ];
  const doc = normalizeMatch(apiMatch({ settings: { is_online: false, vs_cpu: true, goal_amount: 3 } }, users), { ownerUid: OWNER, myUserId: ME });
  const item = mapDartCounterMatchToTimeLeft(doc, doc.matchId, "active", mapOptions);
  assert.equal(item.title, "Lost 1–2 vs the DartCounter bot (level 7) on DartCounter (501, avg 44.5)");
  assert.equal(item.metadata.bot, true);
  assert.equal(item.metadata.online, false);
  assert.equal(item.metadata.opponent, "DartCounter bot");
  assert.match(item.summary, /^Local 501 match on DartCounter: lost 1–2 against the DartCounter bot \(level 7\)\./);
  assert.equal(item.metrics.won, 0);
});

test("a set match scores by sets and keeps the legs in the summary", () => {
  const users = [
    { user_id: 5, player_name: "Peter", result: "lost", legs_won: 4, sets_won: 1, three_dart_average: 55 },
    { user_id: ME, player_name: "Marwan", result: "won", legs_won: 6, sets_won: 2, three_dart_average: 50 },
  ];
  const doc = normalizeMatch(apiMatch({ settings: { has_sets: true, goal_amount: 3, is_best_of: true, is_ranked_game: true } }, users), { ownerUid: OWNER, myUserId: ME });
  const item = mapDartCounterMatchToTimeLeft(doc, doc.matchId, "active", mapOptions);
  assert.equal(item.title, "Won 2–1 vs Peter on DartCounter (501, avg 50)");
  assert.match(item.summary, /^Ranked online 501 match on DartCounter: won 2–1 against Peter\. Legs 6–4\./);
  assert.equal(item.metrics.setsWon, 2);
  assert.equal(item.metrics.setsLost, 1);
  assert.equal(item.metrics.legsWon, 6);
});

test("untrusted numbers are clamped and names trimmed", () => {
  const users = [
    { user_id: 5, player_name: "  A very long name ".padEnd(200, "x"), result: "nonsense", legs_won: -4, three_dart_average: 999 },
    { user_id: ME, player_name: "Marwan", result: "won", legs_won: 99999, three_dart_average: "abc" },
  ];
  const doc = normalizeMatch(apiMatch({}, users), { ownerUid: OWNER, myUserId: ME });
  assert.equal(doc.opponents[0].name.length, 60);
  assert.equal(doc.opponents[0].result, null);
  assert.equal(doc.opponents[0].legsWon, 0);
  assert.equal(doc.opponents[0].average, 180);
  assert.equal(doc.me.legsWon, 500);
  assert.equal(doc.me.average, null);
});

// A tiny Firestore stand-in: documents by path, batches, getAll.
function fakeDb(initial = {}) {
  const store = new Map(Object.entries(initial));
  const ref = (path) => ({
    path,
    async get() { return { exists: store.has(path), data: () => store.get(path) }; },
    async set(data, options) {
      store.set(path, options && options.merge ? { ...(store.get(path) || {}), ...data } : data);
    },
  });
  return {
    store,
    doc: ref,
    collection: (name) => ({ doc: (id) => ref(`${name}/${id}`) }),
    async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
    batch() {
      const writes = [];
      return {
        set(r, data) { writes.push([r.path, data]); },
        async commit() { writes.forEach(([path, data]) => store.set(path, data)); },
      };
    },
  };
}

function apiPages(totalMatches) {
  const all = Array.from({ length: totalMatches }, (_, index) => apiMatch({ id: `m${String(totalMatches - index).padStart(4, "0")}`, finished_at: 1794688611 - index * 1000, started_at: 1794687509 - index * 1000 }));
  const lastPage = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  const calls = [];
  const fetchImpl = async (url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    calls.push(page);
    const data = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    return { ok: true, status: 200, async json() { return { data, current_page: page, last_page: lastPage, total: all.length }; } };
  };
  return { all, calls, fetchImpl, lastPage };
}

const quiet = { info() {}, warn() {}, error() {} };
const noSleep = async () => {};

test("the first runs read the newest page, then the older pages until the whole history is in", async () => {
  const { calls, fetchImpl } = apiPages(351); // 15 pages
  const db = fakeDb();
  const first = await pullMatches({ db, fetchImpl, token: "t", ownerUid: OWNER, myUserId: ME, logger: quiet, sleep: noSleep, maxPages: 4 });
  assert.equal(first.lastStatus, "ok");
  assert.equal(first.lastNew, 100);
  assert.equal(first.backfillDone, false);
  assert.equal(first.nextBackfillPage, 5);
  assert.deepEqual(calls, [1, 2, 3, 4]);

  calls.length = 0;
  const second = await pullMatches({ db, fetchImpl, token: "t", ownerUid: OWNER, myUserId: ME, logger: quiet, sleep: noSleep, maxPages: 4 });
  assert.deepEqual(calls, [1, 5, 6, 7], "page 1 is known, so the budget goes to the backfill");
  assert.equal(second.lastNew, 75);

  let last;
  for (let i = 0; i < 5; i += 1) last = await pullMatches({ db, fetchImpl, token: "t", ownerUid: OWNER, myUserId: ME, logger: quiet, sleep: noSleep, maxPages: 4 });
  assert.equal(last.backfillDone, true);
  assert.equal(last.nextBackfillPage, null);
  const stored = [...db.store.keys()].filter((key) => key.startsWith(`${MATCHES_COLLECTION}/`));
  assert.equal(stored.length, 351);
  assert.equal(db.store.get(STATE_DOC).backfillDone, true);
});

test("a later run stores only the new matches and never rewrites a known one", async () => {
  const pages = apiPages(30);
  const db = fakeDb({ [STATE_DOC]: { backfillDone: true } });
  await pullMatches({ db, fetchImpl: pages.fetchImpl, token: "t", ownerUid: OWNER, myUserId: ME, logger: quiet, sleep: noSleep });
  const before = db.store.get(`${MATCHES_COLLECTION}/m0030`);
  db.store.set(`${MATCHES_COLLECTION}/m0030`, { ...before, marker: "kept" });

  pages.all.unshift(apiMatch({ id: "m0031", finished_at: 1794690000, started_at: 1794689000 }));
  pages.calls.length = 0;
  const result = await pullMatches({ db, fetchImpl: pages.fetchImpl, token: "t", ownerUid: OWNER, myUserId: ME, logger: quiet, sleep: noSleep });
  assert.equal(result.lastNew, 1);
  assert.deepEqual(pages.calls, [1]);
  assert.equal(db.store.get(`${MATCHES_COLLECTION}/m0030`).marker, "kept");
  assert.ok(db.store.get(`${MATCHES_COLLECTION}/m0031`));
});

test("a refused token is recorded as such and nothing is thrown", async () => {
  const db = fakeDb();
  const fetchImpl = async () => ({ ok: false, status: 401, async json() { return { message: "Unauthenticated." }; } });
  const errors = [];
  const result = await pullMatches({ db, fetchImpl, token: "stale", ownerUid: OWNER, myUserId: ME, logger: { ...quiet, error: (m) => errors.push(m) }, sleep: noSleep });
  assert.equal(result.lastStatus, "token-rejected");
  assert.equal(db.store.get(STATE_DOC).lastStatus, "token-rejected");
  assert.equal(errors.length, 1);
});

test("without a token the run says it is not configured", async () => {
  const db = fakeDb();
  const result = await pullMatches({ db, fetchImpl: async () => { throw new Error("must not be called"); }, token: "unset", ownerUid: OWNER, myUserId: ME, logger: quiet });
  assert.equal(result.lastStatus, "not-configured");
});
