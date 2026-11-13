// Stats, records, milestones and the practice plan (public/stats-engine.js), over saved data as
// Firestore has it, with the guards: partial sessions, unfinished bot games and hidden ones never count.
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../public/stats-engine.js");
const TE = require("../public/tracker-engine.js");
const DE = require("../public/practice-engine.js");
const CE = require("../public/challenge-engine.js");

const entryWith = (rows) => Object.assign(TE.blankEntry(), rows);
const session = (id, day, rows, extra) => Object.assign({ id, timestamp: `2026-11-${String(day).padStart(2, "0")} 18:00`, mode: "standard", entry: entryWith(rows) }, extra || {});
const withTotal = (s) => Object.assign(s, { total: TE.totalOf(s.entry, "standard") });

test("tracker stats: hit rate, marks per dart, S/D/T, each number's last 10 against lifetime, its best", () => {
  const list = [];
  for (let d = 1; d <= 12; d += 1) list.push(withTotal(session("s" + d, d, { "20": d > 2 ? ["T", "S", "-"] : ["-", "-", "-"], "19": ["S", "-", "-"] })));
  list.push(withTotal(session("partial", 13, { "20": ["T", "T", "T"] }, { complete: false })));
  list.push(withTotal(session("hid", 14, { "20": ["T", "T", "T"] })));
  const st = S.trackerStats(list, { hidden: new Set(["hid"]) });
  assert.equal(st.sessions, 12, "the partial and the hidden session don't count");
  assert.equal(st.partial, 1);
  const n20 = st.numbers.find((n) => n.t === "20");
  assert.equal(n20.last10, 2 / 3);
  assert.ok(Math.abs(n20.life - (10 * 2) / 36) < 1e-9);
  assert.ok(n20.trend > 0, "better lately");
  assert.deepEqual(n20.best, { score: 4, date: "2026-11-03" });
  assert.equal(st.split.T, 10);
  assert.equal(st.hits, 10 * 2 + 12);
  assert.equal(st.best.total, 5);
});

test("tracker stats: darts 1, 2 and 3 from sessions that kept every dart, and where a number's misses go", () => {
  const s = withTotal(session("t1", 1, { "20": ["S", "-", "-"] }));
  s.throws = [{ t: "20", r: "-", l: "S5", src: "cam", x: -0.15, y: -0.4 }, { t: "20", r: "S", l: "S20", src: "cam", x: 0, y: -0.4 }, { t: "20", r: "-", l: "S5", src: "cam", x: -0.16, y: -0.42 }];
  const s2 = withTotal(session("t2", 2, { "20": ["-", "-", "-"] }));
  s2.throws = [{ t: "20", r: "-", l: "S5", src: "cam", x: -0.15, y: -0.4 }, { t: "20", r: "-", l: "S5", src: "cam" }, { t: "20", r: "-", l: "S1", src: "cam" }];
  const st = S.trackerStats([s, s2]);
  assert.deepEqual(st.byDart.map((d) => [d.n, d.darts, d.rate]), [[1, 2, 0], [2, 2, 0.5], [3, 2, 0]]);
  const l = S.landing([s, s2], "20");
  assert.equal(l.missTo["5"], 4);
  assert.equal(l.missTo["1"], 1);
  assert.match(l.drift, /Your 20s miss into the 5 \(4 against 1 into the 1\)/);
});

test("bot stats: only finished games, averages from the visits (kept or rebuilt from the darts), checkout darts", () => {
  const at = (l) => (l === "MISS" ? { x: 0, y: -1.1 } : DE.aimPoint(l.slice(1), l[0]));
  const g = DE.createGame({ kind: "x01", startScore: 201, first: "player" });
  const play = (ls) => { ls.forEach((l) => DE.throwDart(g, at(l))); if (g.visitDone && !g.winner) DE.endVisit(g); };
  play(["T20", "S20", "S20"]); play(["S1", "S1", "S1"]); play(["S20", "S20", "S1"]); play(["S1", "S1", "S1"]); play(["S20", "D20"]); DE.endVisit(g);
  const saved = { id: "g1", timestamp: "2026-11-10 18:00", kind: "x01", startScore: 201, doubleOut: true, first: "player", rank: "club", result: "won",
    playerAvg: 64, playerDarts: g.darts.player, botDarts: g.darts.bot };
  const kept = Object.assign({}, saved, { id: "g2", visits: DE.visitsRecord(g) });
  const test1 = { id: "t", timestamp: "2026-09-27 12:00", kind: "x01", startScore: 501, result: "abandoned", playerAvg: 140, playerDarts: [], botDarts: [] };
  const st = S.botStats([saved, kept, test1]);
  assert.equal(st.games, 2, "the abandoned test game doesn't count");
  assert.equal(st.rebuilt, 1, "one game's visits rebuilt from its darts");
  assert.equal(st.withVisits, 2);
  assert.equal(Math.round(st.avg * 10) / 10, Math.round(((201 * 3) / 8) * 10) / 10);
  assert.deepEqual(st.checkout, { hits: 2, darts: 2, rate: 1 });
  assert.equal(st.highFinish, 60);
  assert.equal(st.tons.s100, 2);
  assert.equal(st.byLevel[0].label, "Club");
  assert.equal(st.byLevel[0].rate, 1);
  assert.equal(S.botVisits({ kind: "x01", playerDarts: [{ s: "?" }], botDarts: [] }), null, "a typed total can't be replayed");
});

test("JDC and Doubles stats", () => {
  const darts = CE.STEPS.flatMap((st) => Array(st.darts).fill(st.kind === "double" ? 1 : 2));
  const r = Object.assign({ id: "j1" }, CE.record("u", darts, { timestamp: "2026-11-10 18:00" }));
  const js = S.jdcStats([r]);
  assert.equal(js.rounds, 1);
  assert.equal(js.numbers.length, 12);
  assert.equal(js.numbers[0].marksPerDart, 2);
  const ds = S.doublesStats([{ startedAtMs: Date.UTC(2026, 10, 10), perDouble: { D1: { attempts: 1, completed: true, hitDart: 2 }, D2: { attempts: 2, completed: false } } }]);
  const d1 = ds.doubles.find((d) => d.key === "D1"), d2 = ds.doubles.find((d) => d.key === "D2");
  assert.equal(d1.rate, 1 / 2, "D1 done on its 2nd dart: 1 in 2");
  assert.equal(d2.rate, 0);
  assert.equal(d2.darts, 6);
  assert.equal(ds.weakest[0].key, "D2");
});

test("days practised: streaks across every game", () => {
  const data = {
    sessions: [session("a", 10, {}), session("b", 11, {})],
    botGames: [{ timestamp: "2026-11-12 10:00", result: "won" }, { timestamp: "2026-11-09 10:00", result: "abandoned" }],
    challengeGames: [{ timestamp: "2026-11-05 10:00", total: 1 }],
    doublesSessions: [{ startedAtMs: new Date(2026, 10, 6, 12).getTime() }],
  };
  const d = S.practiceDays(data, "2026-11-13");
  assert.equal(d.current, 3, "the 10th, 11th and 12th; today not played yet");
  assert.equal(d.best, 3);
  assert.equal(d.count, 5);
  assert.equal(S.practiceDays(data, "2026-11-15").current, 0);
});

test("records, milestones and the practice plan", () => {
  const sess = [];
  for (let d = 1; d <= 10; d += 1) sess.push(withTotal(session("s" + d, d, { "20": ["T", "T", "S"], "BULL": ["-", "-", "-"], "9": ["S", "-", "-"] })));
  sess.push(withTotal(session("today", 13, { "20": ["S", "-", "-"] })));
  const data = { sessions: sess, botGames: [], challengeGames: [], doublesSessions: [], hidden: new Set() };
  const rec = S.records(data);
  assert.equal(rec[0].what, "Best session");
  assert.ok(rec.some((r) => r.what === "Best at 20" && r.value === "7 marks"));
  const plan = S.practicePlan(data, "2026-11-13");
  assert.equal(plan.length, 4);
  assert.equal(plan[0].game, "tracker");
  assert.match(plan[0].why, /^Watch 19, 18 and 17/, "never hit: the first three in order (hit rates from the last 10)");
  assert.ok(plan[0].done, "a session today");
  assert.ok(!plan[1].done);
  assert.equal(plan[2].href, "practice.html");
  const ms = S.milestones(data, "2026-11-13");
  assert.ok(Array.isArray(ms));
});

test("ranges and the rolling average", () => {
  assert.ok(S.inRange("2026-11-01", "30d", "2026-11-13"));
  assert.ok(!S.inRange("2026-09-01", "30d", "2026-11-13"));
  assert.ok(S.inRange("2026-09-01", "90d", "2026-11-13"));
  assert.ok(S.inRange("2020-01-01", "all", "2026-11-13"));
  assert.deepEqual(S.rolling([1, 2, 3, 4], 2), [1, 1.5, 2.5, 3.5]);
});
