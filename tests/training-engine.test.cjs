// node --test tests/training-engine.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/training-engine.js");

const T0 = 1_800_000_000_000;
const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const RING = { S: 0.4, T: 0.58, D: 0.95, O: 1.06 };
// A dart on the app board at a number, in a ring (S single, T triple, D double, O just outside the wire).
function at(n, ring) {
  const a = ((SEG.indexOf(n) * 18 - 90) * Math.PI) / 180;
  return { x: Math.cos(a) * RING[ring], y: Math.sin(a) * RING[ring] };
}
let seq = 100;
const dart = (label, n, ring) => Object.assign({ seq: ++seq, label }, n == null ? { x: 0, y: -1.2 } : n === "BULL" ? { x: 0, y: 0 } : at(n, ring));
const takeout = (darts) => ({ seq: ++seq, darts });

function fresh(settings) {
  const u = { uid: "me", undoStack: [] };
  u.activeSession = E.newSession("bobs27", settings || {}, T0, "key1");
  return u;
}
const sess = (u) => u.activeSession;
const play = (u) => u.activeSession.play;

test("the registry: Bob's 27 with its defaults, and settings kept within range", () => {
  const d = E.drillOf("bobs27");
  assert.ok(d && d.name === "Bob's 27" && d.category === "Doubles and checkouts");
  assert.deepEqual(E.cleanSettings(d, {}), { start: 27, playOn: false, sayScore: true });
  assert.deepEqual(E.cleanSettings(d, { start: "50", playOn: "true", sayScore: false }), { start: 50, playOn: true, sayScore: false });
  assert.equal(E.cleanSettings(d, { start: 9999 }).start, 500);
  assert.equal(E.cleanSettings(d, { start: -3 }).start, 1);
  assert.equal(E.drillOf("nope"), null);
  assert.equal(E.newSession("nope", {}, T0), null);
});

test("Bob's 27 by the buttons: hits add the double, three misses subtract it, D1 to D20 then the bull", () => {
  const u = fresh();
  assert.equal(E.target(sess(u)).key, "D1");
  assert.equal(play(u).score, 27);
  let r = E.manualVisit(u, sess(u), 2, T0 + 1000); // D1: 2 hits = +4
  assert.ok(!r.error);
  assert.equal(play(u).score, 31);
  assert.equal(E.target(sess(u)).key, "D2");
  assert.equal(r.visit.delta, 4);
  r = E.manualVisit(u, sess(u), 0, T0 + 2000); // D2: no hits = -4
  assert.equal(play(u).score, 27);
  assert.equal(sess(u).say.text, "D 2. No hits. Minus 4. 27. Next, D 3.");
  r = E.manualVisit(u, sess(u), 3, T0 + 3000); // D3: +18
  assert.equal(play(u).score, 45);
  assert.equal(sess(u).say.text, "D 3. Three hits. 45. Next, D 4.");
  assert.equal(r.moment.big, "Three in D3");
  assert.equal(E.manualVisit(u, sess(u), 4, T0).error, "Hits must be 0 to 3.");
  // The throws log has every dart, misses included, in the tracker's shape plus the visit and target.
  assert.equal(sess(u).throws.length, 9);
  assert.deepEqual(sess(u).throws[0], { v: 1, t: "1", k: "D1", r: "D", l: "D1", src: "btn", h: 1 });
  assert.deepEqual(sess(u).throws[2], { v: 1, t: "1", k: "D1", r: "-", l: "", src: "btn" });
  // Through to the bull.
  for (let i = 3; i < 20; i += 1) E.manualVisit(u, sess(u), 1, T0 + 10000 + i);
  assert.equal(E.target(sess(u)).key, "DBULL");
  assert.equal(E.target(sess(u)).big, "BULL");
  assert.equal(sess(u).say.text.endsWith("Next, the bull."), true, sess(u).say.text);
  const before = play(u).score;
  r = E.manualVisit(u, sess(u), 1, T0 + 20000);
  assert.equal(play(u).score, before + 50);
  assert.equal(E.isFinished(sess(u)), true);
  assert.equal(r.over, true);
  assert.equal(r.moment.big, "All 21 done");
  assert.ok(sess(u).say.text.includes("All 21 done."), sess(u).say.text);
  const res = E.summarize(sess(u));
  assert.equal(res.finishedAll, true);
  assert.equal(res.doublesPlayed, 21);
  assert.equal(res.darts, 63);
  assert.equal(res.furthest, "DBULL");
  assert.equal(res.trail.length, 22);
  assert.equal(E.manualVisit(u, sess(u), 1, T0).error, "The drill is finished. Use Undo to take the last visit back.");
});

test("Bob's 27 ends at zero or below, unless playing on; the end is a moment and a voice line", () => {
  let u = fresh({ start: 10 });
  E.manualVisit(u, sess(u), 0, T0 + 1); // D1: 10 - 2 = 8
  E.manualVisit(u, sess(u), 0, T0 + 2); // D2: 4
  const r = E.manualVisit(u, sess(u), 0, T0 + 3); // D3: -2 -> over
  assert.equal(play(u).score, -2);
  assert.equal(E.isFinished(sess(u)), true);
  assert.equal(r.moment.big, "Below zero");
  assert.equal(sess(u).say.text, "D 3. No hits. Minus 6. -2. Below zero. Game over.");
  let res = E.summarize(sess(u));
  assert.equal(res.wentBelow, true);
  assert.equal(res.finishedAll, false);
  assert.equal(res.furthest, "D3");
  assert.equal(res.doublesPlayed, 3);
  // Landing exactly on 0 ends it too.
  u = fresh({ start: 6 });
  E.manualVisit(u, sess(u), 0, T0 + 1); // 4
  E.manualVisit(u, sess(u), 0, T0 + 2); // 0
  assert.equal(E.isFinished(sess(u)), true);
  // Playing on: below zero keeps going to the bull.
  u = fresh({ start: 2, playOn: true });
  E.manualVisit(u, sess(u), 0, T0 + 1); // 0
  assert.equal(E.isFinished(sess(u)), false);
  assert.equal(play(u).below, true);
  for (let i = 1; i < 21; i += 1) E.manualVisit(u, sess(u), 0, T0 + 1 + i);
  assert.equal(E.isFinished(sess(u)), true);
  res = E.summarize(sess(u));
  assert.equal(res.finishedAll, true);
  assert.equal(res.wentBelow, true);
  assert.equal(res.score, 2 - (2 + 4 + 6 + 8 + 10 + 12 + 14 + 16 + 18 + 20 + 22 + 24 + 26 + 28 + 30 + 32 + 34 + 36 + 38 + 40 + 50));
});

test("the voice can leave the score out", () => {
  const u = fresh({ sayScore: false });
  E.manualVisit(u, sess(u), 1, T0 + 1);
  assert.equal(sess(u).say.text, "D 1. One hit. Next, D 2.");
  E.manualVisit(u, sess(u), 0, T0 + 2);
  assert.equal(sess(u).say.text, "D 2. No hits. Next, D 3.");
});

test("the cameras: a visit is 3 darts at the double, the 3rd scores it, a 4th before the take-out is not counted", () => {
  const u = fresh();
  let r = E.cameraDart(u, sess(u), dart("S1", 1, "S"), T0 + 1);
  assert.equal(r.effect.kind, "miss");
  assert.equal(r.scored, null);
  assert.equal(play(u).score, 27, "nothing scored before the 3rd dart");
  r = E.cameraDart(u, sess(u), dart("D1", 1, "D"), T0 + 2);
  assert.equal(r.effect.kind, "hit");
  r = E.cameraDart(u, sess(u), dart("MISS", 20, "O"), T0 + 3);
  assert.ok(r.scored, "the 3rd dart scores the visit");
  assert.equal(r.scored.hits, 1);
  assert.equal(play(u).score, 29);
  assert.equal(E.target(sess(u)).key, "D2");
  assert.match(r.message, /Pull your darts out, then D2/);
  const view = E.boardView(sess(u));
  assert.equal(view.pullOut, true);
  assert.equal(view.target, "D2");
  assert.deepEqual(view.darts.map((d) => d.read + "|" + d.sub), ["S1|Inside the wire", "D1|In D1: +2", "Outside|Off the board"]);
  // A 4th dart before the take-out: not counted, nothing changes.
  r = E.cameraDart(u, sess(u), dart("D2", 2, "D"), T0 + 4);
  assert.equal(r.effect.kind, "spare");
  assert.equal(play(u).score, 29);
  assert.equal(E.target(sess(u)).key, "D2");
  assert.equal(sess(u).cam.visit.darts.length, 3);
  // Darts out: the next dart starts the next visit, at D2.
  r = E.cameraTakeout(u, sess(u), takeout(3), T0 + 5);
  assert.equal(r.scored, null);
  r = E.cameraDart(u, sess(u), dart("D2", 2, "D"), T0 + 6);
  assert.equal(r.effect.kind, "hit");
  assert.equal(sess(u).cam.visit.n, 2);
  assert.equal(sess(u).cam.visit.darts.length, 1);
  assert.equal(E.boardView(sess(u)).dartNo, 2);
  // The throws keep the camera darts' positions and seq.
  const t = sess(u).throws[1];
  assert.equal(t.src, "cam");
  assert.equal(t.l, "D1");
  assert.equal(t.h, 1);
  assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y) && t.seq > 0);
});

test("the cameras: darts not seen at the take-out are misses at that double; an event already in is skipped", () => {
  const u = fresh();
  const d1 = dart("D1", 1, "D");
  let r = E.cameraDart(u, sess(u), d1, T0 + 1);
  assert.equal(r.effect.kind, "hit");
  assert.equal(E.cameraDart(u, sess(u), d1, T0 + 1), null, "the same event from another device is skipped");
  r = E.cameraTakeout(u, sess(u), takeout(1), T0 + 2);
  assert.ok(r.scored);
  assert.equal(r.unseen, 2);
  assert.equal(r.scored.hits, 1);
  assert.equal(play(u).score, 29);
  assert.equal(E.target(sess(u)).key, "D2");
  const view = E.boardView(sess(u));
  assert.equal(view.unseen, 2);
  assert.equal(view.visitDone, true);
  assert.equal(view.pullOut, false);
  assert.equal(sess(u).throws.length, 3);
  assert.equal(sess(u).throws[1].src, "unseen");
  assert.equal(sess(u).throws[1].r, "-");
  // A take-out with nothing in the visit does nothing; a take-out already in is skipped.
  r = E.cameraTakeout(u, sess(u), takeout(0), T0 + 3);
  assert.equal(r.scored, null);
  assert.equal(E.cameraTakeout(u, sess(u), { seq: 1, darts: 0 }, T0 + 3), null);
  // Paused by you: the cameras' darts are ignored.
  E.pauseResume(sess(u), T0 + 4);
  r = E.cameraDart(u, sess(u), dart("D2", 2, "D"), T0 + 5);
  assert.equal(r.effect.kind, "ignored");
  E.pauseResume(sess(u), T0 + 6);
  r = E.cameraDart(u, sess(u), dart("D2", 2, "D"), T0 + 7);
  assert.equal(r.effect.kind, "hit");
});

test("the bull: only the bullseye is a hit; the outer bull is a miss", () => {
  const u = fresh({ start: 500 });
  for (let i = 0; i < 20; i += 1) E.manualVisit(u, sess(u), 0, T0 + i);
  assert.equal(E.target(sess(u)).key, "DBULL");
  let r = E.cameraDart(u, sess(u), dart("SB", "BULL"), T0 + 30);
  assert.equal(r.effect.kind, "miss");
  assert.equal(E.boardView(sess(u)).darts[0].sub, "Outer bull: a miss");
  r = E.cameraDart(u, sess(u), dart("DB", "BULL"), T0 + 31);
  assert.equal(r.effect.kind, "hit");
  r = E.cameraDart(u, sess(u), dart("S20", 20, "S"), T0 + 32);
  assert.equal(r.scored.hits, 1);
  assert.equal(E.isFinished(sess(u)), true);
  assert.equal(play(u).score, 500 - 420 + 50);
  assert.deepEqual(E.boardView(sess(u)).darts.map((d) => d.read), ["25", "Bull", "S20"]);
});

test("fixing a dart scores the visit again from before its first dart, and stays possible until the next visit", () => {
  const u = fresh();
  const d1 = dart("S1", 1, "S"), d2 = dart("S1", 1, "S"), d3 = dart("MISS", 1, "O");
  E.cameraDart(u, sess(u), d1, T0 + 1);
  E.cameraDart(u, sess(u), d2, T0 + 2);
  E.cameraDart(u, sess(u), d3, T0 + 3);
  assert.equal(play(u).score, 25);
  assert.equal(E.undoCount(u, sess(u)), 1);
  // The 3rd dart was really in D1: the visit becomes 1 hit, +2 (the -2 is gone).
  let r = E.fixDart(u, sess(u), 2, d3.seq, Object.assign({ label: "D1" }, E.spot("D1")), T0 + 4);
  assert.ok(!r.error, r.error);
  assert.equal(r.changed, true);
  assert.equal(play(u).score, 29);
  assert.equal(E.target(sess(u)).key, "D2");
  assert.equal(E.undoCount(u, sess(u)), 1, "still one undo step: the fixed visit");
  assert.equal(sess(u).throws.length, 3);
  assert.equal(sess(u).throws[2].l, "D1");
  assert.equal(sess(u).throws[2].f, 1);
  assert.equal(sess(u).say.text, "D 1. One hit. 29. Next, D 2.");
  const view = E.boardView(sess(u));
  assert.equal(view.darts[2].fixed, true);
  assert.equal(view.darts[2].sub, "In D1: +2");
  // Remove the 2nd dart (it wasn't a dart): the visit has 2 darts and isn't scored any more.
  r = E.fixDart(u, sess(u), 1, d2.seq, { remove: true }, T0 + 5);
  assert.ok(!r.error);
  assert.equal(play(u).score, 27);
  assert.equal(E.target(sess(u)).key, "D1");
  assert.equal(E.undoCount(u, sess(u)), 0, "the visit is open again: nothing to undo");
  assert.equal(sess(u).throws.length, 0);
  assert.equal(sess(u).cam.visit.darts.length, 2);
  // The take-out then scores it with one unseen miss: 1 hit, +2.
  r = E.cameraTakeout(u, sess(u), takeout(2), T0 + 6);
  assert.equal(r.unseen, 1);
  assert.equal(play(u).score, 29);
  assert.equal(E.undoCount(u, sess(u)), 1);
  // Fixing after the take-out keeps the unseen dart a miss; the first dart becomes a hit: 2 hits, +4.
  r = E.fixDart(u, sess(u), 0, d1.seq, Object.assign({ label: "D1" }, E.spot("D1")), T0 + 7);
  assert.equal(play(u).score, 31);
  assert.equal(sess(u).cam.visit.out.unseen, 1);
  assert.equal(sess(u).throws.filter((t) => t.src === "unseen").length, 1);
  // The next visit's first dart ends the chance to fix the old one.
  E.cameraDart(u, sess(u), dart("D2", 2, "D"), T0 + 8);
  r = E.fixDart(u, sess(u), 0, d1.seq, { remove: true }, T0 + 9);
  assert.match(r.error, /can't be changed any more/);
  // A wrong seq is refused too.
  assert.match(E.fixDart(u, sess(u), 0, 1, { remove: true }, T0 + 9).error, /can't be changed/);
});

test("Undo goes back one visit at a time, up to 10, keeps the cameras' seq, and takes a finish back", () => {
  const u = fresh({ start: 100 });
  for (let i = 0; i < 12; i += 1) E.manualVisit(u, sess(u), 1, T0 + i);
  assert.equal(E.undoCount(u, sess(u)), 10, "at most 10 steps are kept");
  assert.equal(play(u).cursor, 12);
  const scoreAt11 = play(u).trail[11];
  let r = E.undoStep(u, sess(u), T0 + 20);
  assert.ok(!r.error);
  assert.equal(play(u).cursor, 11);
  assert.equal(play(u).score, scoreAt11);
  assert.equal(sess(u).throws.length, 33);
  assert.equal(sess(u).say.text, "Undone. D 12.");
  for (let i = 0; i < 9; i += 1) assert.ok(!E.undoStep(u, sess(u), T0 + 30 + i).error);
  assert.equal(play(u).cursor, 2);
  assert.equal(E.undoStep(u, sess(u), T0 + 40).error, "Nothing to undo.");
  // A camera dart's seq survives an undo, so the same dart is never counted twice.
  const d = dart("D3", 3, "D");
  E.cameraDart(u, sess(u), d, T0 + 50);
  E.cameraDart(u, sess(u), dart("D3", 3, "D"), T0 + 51);
  E.cameraDart(u, sess(u), dart("D3", 3, "D"), T0 + 52);
  assert.equal(play(u).cursor, 3);
  E.undoStep(u, sess(u), T0 + 53);
  assert.equal(play(u).cursor, 2);
  assert.equal(E.cameraDart(u, sess(u), d, T0 + 54), null, "the undone dart is not counted again");
  assert.equal(sess(u).cam.visit, null, "the visit on the board is ended");
  // Undoing the finishing visit un-finishes the drill.
  const v = fresh({ start: 4 });
  E.manualVisit(v, sess(v), 0, T0 + 1); // 2
  E.manualVisit(v, sess(v), 0, T0 + 2); // -2: over
  assert.equal(E.isFinished(sess(v)), true);
  r = E.undoStep(v, sess(v), T0 + 3);
  assert.equal(r.unfinished, true);
  assert.equal(r.sessionKey, "key1");
  assert.equal(E.isFinished(sess(v)), false);
  assert.equal(E.target(sess(v)).key, "D2");
  assert.equal(E.isPaused(sess(v), T0 + 4), false, "the clock runs again");
});

test("a session read back from an older page is filled in, and one for an unknown drill is dropped", () => {
  const s = E.ensureSession({ meta: { startedAtMs: T0, drill: "bobs27", settings: { start: "27" } }, play: E.drillOf("bobs27").start({ start: 27 }) }, T0 + 5);
  assert.ok(s.timer && s.cam && Array.isArray(s.throws) && s.visitNo === 0 && s.finishedAt === null);
  assert.deepEqual(s.meta.settings, { start: 27, playOn: false, sayScore: true });
  assert.equal(E.ensureSession({ meta: { startedAtMs: T0, drill: "nope" } }, T0), null);
  assert.equal(E.ensureSession(null, T0), null);
});

test("the saved session: the drill, its settings, the result, every dart, the times; bests and pace", () => {
  const u = fresh();
  E.manualVisit(u, sess(u), 2, T0 + 1000);
  E.manualVisit(u, sess(u), 1, T0 + 2000);
  const h = E.historyPayload(sess(u), T0 + 3000);
  assert.equal(h.drill, "bobs27");
  assert.equal(h.drillVersion, 1);
  assert.deepEqual(h.settings, { start: 27, playOn: false, sayScore: true });
  assert.equal(h.key, 35);
  assert.equal(h.result.score, 35);
  assert.equal(h.throws.length, 6);
  assert.equal(h.complete, false, "not finished: kept as unfinished");
  assert.equal(h.startedAtMs, T0);
  assert.equal(h.timestamp.length, 16);
  assert.equal(h.localDate, h.timestamp.slice(0, 10));
  assert.equal(h.activeMs, 3000);
  assert.equal(h.createdAt, T0 + 3000);
  assert.equal(h.planRunId, undefined);
  assert.equal(E.historyPayload(sess(u), T0 + 3000, { planRunId: "p1" }).planRunId, "p1");
  // Bests: the best finished session with the same settings; an unfinished one never counts.
  const hist = [
    { id: "a", drill: "bobs27", settings: { start: 27 }, key: 40, complete: true, result: { trail: [27, 29, 33, 40] } },
    { id: "b", drill: "bobs27", settings: { start: 27 }, key: 61, complete: true, result: { trail: [27, 31, 37, 61] } },
    { id: "c", drill: "bobs27", settings: { start: 27 }, key: 90, complete: false, result: {} },
    { id: "d", drill: "bobs27", settings: { start: 50, playOn: true }, key: 95, complete: true, result: {} },
  ];
  assert.equal(E.personalBest(hist, "bobs27", {}).id, "b");
  assert.equal(E.personalBest(hist, "bobs27", { start: 50, playOn: true }).id, "d");
  assert.equal(E.personalBest(hist, "bobs27", { start: 50 }), null);
  assert.equal(E.isNewBest("bobs27", 62, hist[1]), true);
  assert.equal(E.isNewBest("bobs27", 61, hist[1]), false);
  assert.equal(E.isNewBest("bobs27", 5, null), true);
  assert.deepEqual(E.historyRows([{ drill: "bobs27", startedAtMs: 1 }, { drill: "x", startedAtMs: 3 }, { drill: "bobs27", startedAtMs: 2 }], "bobs27").map((x) => x.startedAtMs), [2, 1]);
  // Pace: against the best round's score at the same point.
  const d = E.drillOf("bobs27");
  assert.equal(d.paceText(play(u), hist[1]), "-2 on your best");
  assert.equal(d.paceText(play(u), hist[0]), "+2 on your best");
  assert.equal(d.paceText(play(u), { result: { trail: [27, 31, 35] } }), "Level with your best");
  assert.equal(d.paceText(play(u), null), null);
  assert.equal(E.boardView(sess(u), { best: hist[1] }).note, "-2 on your best");
});

test("the strip and the words for each dart", () => {
  const u = fresh();
  E.manualVisit(u, sess(u), 3, T0 + 1);
  E.manualVisit(u, sess(u), 0, T0 + 2);
  const v = E.boardView(sess(u));
  assert.equal(v.cells.length, 21);
  assert.deepEqual(v.cells[0], { key: "D1", num: "1", state: "done h3", sub: "+6", title: "D1: three hits, +6" });
  assert.deepEqual(v.cells[1], { key: "D2", num: "2", state: "done h0", sub: "-4", title: "D2: no hits, -4" });
  assert.equal(v.cells[2].state, "current");
  assert.equal(v.cells[20].num, "B");
  assert.equal(v.capHtml, "<strong>29</strong> points · 2 of 21 doubles");
  assert.deepEqual(v.next, ["D4", "D5", "D6"]);
  assert.equal(v.done, 2);
  assert.equal(v.of, 21);
  // Camera darts around D3 in words.
  E.cameraDart(u, sess(u), dart("MISS", 3, "O"), T0 + 3);
  E.cameraDart(u, sess(u), dart("S19", 19, "S"), T0 + 4);
  E.cameraDart(u, sess(u), dart("T3", 3, "T"), T0 + 5);
  const words = E.boardView(sess(u)).darts.map((d) => `${d.read}|${d.sub}|${d.kind}`);
  assert.deepEqual(words, ["Outside|Just past the D3 wire|miss", "S19|Next door, in the 19|miss", "T3|In the triple|miss"]);
  assert.equal(E.boardView(sess(u)).darts[0].key, "D3");
  // Words for a dart entered by hand.
  const w = E.dartWords({ l: "D5", src: "btn", e: { kind: "hit" } }, { key: "D5", number: "5", value: 10, label: "D5" });
  assert.deepEqual(w, { read: "Hit", sub: "Entered by hand", kind: "hit" });
});

test("labels and spots", () => {
  assert.deepEqual(E.parseLabel("T20"), { ring: "T", number: "20", points: 60, label: "T20" });
  assert.deepEqual(E.parseLabel("DB"), { ring: "D", number: "BULL", points: 50, label: "DB" });
  assert.deepEqual(E.parseLabel("SB"), { ring: "S", number: "BULL", points: 25, label: "SB" });
  assert.deepEqual(E.parseLabel(""), { ring: null, number: null, points: 0, label: "MISS" });
  assert.deepEqual(E.parseLabel("D21"), { ring: null, number: null, points: 0, label: "D21" });
  const s = E.spot("D20");
  assert.ok(Math.abs(s.x) < 1e-6 && s.y < -0.9, JSON.stringify(s));
  assert.equal(E.numberAt(s.x, s.y), "20");
  assert.deepEqual(E.neighbours(20), [5, 1]);
  assert.equal(E.describe("MISS"), "off the board");
  assert.equal(E.describe("DB"), "the bullseye");
  assert.equal(E.ordinal(3), "3rd");
});

// ---- checkouts -----------------------------------------------------------------------------------------
test("the checkout table: every route adds up, ends on a double or the bull, and fits the darts left", () => {
  const table = E.checkoutTable();
  assert.equal(table.length, 169);
  for (const row of table) {
    for (const k of [1, 2, 3]) {
      const r = row.routes[k];
      if (!r) continue;
      assert.ok(r.length <= k, `${row.n} with ${k}: ${r.length} darts`);
      assert.equal(E.routeTotal(r), row.n, `${row.n} with ${k}: ${E.routeText(r)} adds to ${E.routeTotal(r)}`);
      assert.ok(E.endsOnDouble(r), `${row.n} with ${k} ends on ${r[r.length - 1]}`);
    }
    if (row.n <= 40 && row.n % 2 === 0) assert.ok(row.routes[1], `${row.n} has a 1-dart finish`);
    if (row.n === 50) assert.deepEqual(row.routes[1], ["DB"]);
    if (row.n % 2 === 1 || row.n > 50) assert.equal(row.routes[1], null, `${row.n} has no 1-dart finish`);
    if (row.bogey) assert.equal(row.routes[3], null, `${row.n} is a bogey number`);
    else if (row.n <= 170) assert.ok(row.routes[3], `${row.n} has a 3-dart finish`);
  }
  assert.deepEqual(E.BOGEY, [169, 168, 166, 165, 163, 162, 159]);
  assert.ok(E.isBogey(159) && !E.isBogey(160));
});

test("checkout routes: the standard ones, the preferred routes as data, and the texts", () => {
  assert.equal(E.routeText(E.checkoutRoute(170, 3)), "T20 T20 Bull");
  assert.equal(E.routeText(E.checkoutRoute(167, 3)), "T20 T19 Bull");
  assert.equal(E.routeText(E.checkoutRoute(100, 3)), "T20 D20");
  assert.equal(E.routeText(E.checkoutRoute(121, 3)), "T17 T10 D20", "the preferred route is used");
  assert.equal(E.routeText(E.checkoutRoute(121, 3, {})), "T20 T15 D8", "without preferences, the solver's");
  assert.equal(E.routeText(E.checkoutRoute(121, 2)), "", "121 has no 2-dart finish");
  assert.equal(E.checkoutRoute(121, 2), null);
  assert.equal(E.routeText(E.checkoutRoute(32, 1)), "D16");
  assert.equal(E.routeText(E.checkoutRoute(40, 2)), "D20");
  assert.equal(E.checkoutRoute(1, 3), null);
  assert.equal(E.checkoutRoute(171, 3), null);
  // A preferred route that doesn't add up, or takes more darts than the solver needs, is ignored.
  assert.equal(E.routeText(E.checkoutRoute(100, 3, { 100: { 3: "T20 T20" } })), "T20 D20");
  assert.equal(E.routeText(E.checkoutRoute(100, 3, { 100: { 3: "S20 T16 D16" } })), "T20 D20");
  assert.equal(E.routeText(E.checkoutRoute(100, 3, { 100: { 2: "S20 D20" } })), "T20 D20", "one that doesn't add up is ignored");
  assert.equal(E.routeText(E.checkoutRoute(60, 2, { 60: { 2: "20 D20" } })), "S20 D20", "a bare number is a single");
  assert.deepEqual(E.parseRoute("T20 11 Bull"), ["T20", "S11", "DB"]);
  assert.deepEqual(E.parseRoute("25, D20"), ["SB", "D20"]);
  assert.equal(E.parseRoute("T20 X"), null);
  assert.equal(E.parseRoute(""), null);
  assert.equal(E.routeValid(["T20", "S11", "DB"], 121, 3), true);
  assert.equal(E.routeValid(["T20", "S11", "DB"], 121, 2), false);
  assert.equal(E.routeValid(["T20", "T20", "S1"], 121, 3), false);
});

// ---- Phase 2: the checkout drills -------------------------------------------------------------------------
function freshDrill(id, settings) {
  const u = { uid: "me", undoStack: [] };
  u.activeSession = E.newSession(id, settings || {}, T0, "key2");
  return u;
}
const cam = (u, label, n, ring, t) => E.cameraDart(u, sess(u), dart(label, n, ring), t || T0 + 1000);

test("x01 pieces: a dart busts below zero, on one, or on zero without a double; doubles and their names", () => {
  assert.equal(E.canDouble(40), true);
  assert.equal(E.canDouble(41), false);
  assert.equal(E.canDouble(50), true);
  assert.equal(E.canDouble(42), false);
  assert.equal(E.doubleFor(16), "D8");
  assert.equal(E.doubleFor(50), "DB");
  assert.equal(E.doubleFor(17), null);
  assert.deepEqual(E.x01Effect("k", 121, "T20"), { key: "k", rem: 121, pts: 60, after: 61, onDouble: false, kind: "score" });
  assert.equal(E.x01Effect("k", 41, "T20").kind, "bust"); // below zero
  assert.equal(E.x01Effect("k", 61, "T20").kind, "bust"); // one left
  assert.equal(E.x01Effect("k", 20, "S20").kind, "bust"); // zero, not a double
  assert.equal(E.x01Effect("k", 40, "D20").out, true);
  assert.equal(E.x01Effect("k", 50, "DB").out, true);
  assert.equal(E.x01Effect("k", 40, "MISS").kind, "miss");
  assert.equal(E.x01Effect("k", 40, "MISS").after, 40);
});

test("the ladder: settings, the start, the route shown, the intro line", () => {
  const d = E.drillOf("ladder121");
  assert.ok(d && d.input === "darts" && d.category === "Doubles and checkouts");
  assert.deepEqual(E.cleanSettings(d, {}), { start: 121, floor: 100, visits: 3, attempts: 10 });
  assert.deepEqual(E.cleanSettings(d, { start: 500, floor: 0, visits: 9, attempts: 1 }), { start: 170, floor: 2, visits: 3, attempts: 3 });
  const u = freshDrill("ladder121", { start: 80, floor: 120 });
  assert.equal(play(u).floor, 80, "the floor never sits above the start");
  const t = E.target(sess(freshDrill("ladder121")));
  assert.equal(t.big, "121");
  assert.deepEqual(t.route, ["T17", "T10", "D20"], "the preferred route for 121");
  assert.equal(t.intro, "You require 121. T 17, T 10, D 20");
  assert.deepEqual(t.lit, [{ n: 17, beds: "T" }]);
  assert.equal(E.target(sess(u)).label, "You require");
});

test("the ladder with the cameras: a checkout on the 3rd dart moves the target up, a 4th dart is not counted", () => {
  const u = freshDrill("ladder121");
  let r = cam(u, "T17", 17, "T");
  assert.equal(r.effect.kind, "score");
  assert.equal(r.effect.after, 70);
  assert.equal(r.scored, null);
  assert.match(r.message, /Camera: T17 \(dart 1 of 3 at 121\)/);
  let v = E.boardView(sess(u));
  assert.equal(v.target, "70", "the hero shows what is left");
  assert.equal(v.label, "You require");
  assert.deepEqual(v.next, ["T18", "D8"], "the solver's route for 70 with the 2 darts left");
  assert.equal(v.nextClass, "co");
  assert.deepEqual(v.lit, [{ n: 18, beds: "T" }]);
  assert.equal(v.countHtml, undefined, "3 darts a visit: the kit's own count");
  r = cam(u, "T10", 10, "T");
  assert.deepEqual(E.boardView(sess(u)).next, ["D20"], "40 left with one dart");
  r = cam(u, "D20", 20, "D");
  assert.ok(r.scored && r.scored.visit.out, "the 3rd dart checks out");
  assert.equal(play(u).level, 122);
  assert.equal(play(u).highest, 122);
  assert.equal(play(u).outs, 1);
  assert.deepEqual(play(u).attempts[0], { target: 121, out: true, visits: 1, darts: 3, remaining: 0 });
  assert.equal(sess(u).say.text, "Game shot. 121 in 3 darts. Up to 122.");
  assert.equal(r.scored.moment.big, "Up to 122");
  assert.match(r.message, /game shot.*Pull your darts out, then 122/);
  assert.equal(E.target(sess(u)).big, "122");
  // A 4th dart before the take-out: not counted, and the visit still needs its take-out.
  r = cam(u, "T20", 20, "T");
  assert.equal(r.effect.kind, "spare");
  assert.equal(E.boardView(sess(u)).pullOut, true);
  const out = E.cameraTakeout(u, sess(u), takeout(3), T0 + 5000);
  assert.equal(out.unseen, 0);
  assert.equal(E.boardView(sess(u)).pullOut, false);
  // The throws carry the points and the game shot.
  assert.deepEqual(sess(u).throws.map((x) => [x.t, x.k, x.l, x.p, x.h]), [["121", "A1", "T17", 51, undefined], ["121", "A1", "T10", 30, undefined], ["121", "A1", "D20", 40, 1]]);
  assert.equal(E.undoCount(u, sess(u)), 1);
  assert.equal(u.undoStack[0].label, "121: game shot");
});

test("the ladder: a checkout in 2 darts ends the visit early; a 3rd dart and the take-out add nothing", () => {
  const u = freshDrill("ladder121", { start: 100 });
  assert.deepEqual(E.target(sess(u)).route, ["T20", "D20"]);
  cam(u, "T20", 20, "T");
  const r = cam(u, "D20", 20, "D");
  assert.ok(r.scored && r.scored.visit.out && r.scored.visit.attemptDarts === 2);
  assert.equal(play(u).level, 101);
  assert.equal(cam(u, "S5", 5, "S").effect.kind, "spare", "a dart after the checkout is not counted");
  const out = E.cameraTakeout(u, sess(u), takeout(3), T0 + 5000);
  assert.equal(out.unseen, 0, "nothing unseen is added to a visit that had ended");
  assert.equal(sess(u).throws.length, 2);
  assert.equal(play(u).attempt.target, 101);
  assert.equal(E.target(sess(u)).remaining, 101);
});

test("the ladder: a bust ends the visit and puts the score back; three failed visits move the target down, never below the floor", () => {
  const u = freshDrill("ladder121", { attempts: 3 });
  cam(u, "S20", 20, "S"); // 101
  cam(u, "T20", 20, "T"); // 41
  let r = cam(u, "D20", 20, "D"); // 1 left: bust
  assert.equal(r.effect.kind, "bust");
  assert.ok(r.scored, "the bust scores the visit (0) at once");
  assert.equal(play(u).attempt.remaining, 121, "back to the start of the visit");
  assert.equal(play(u).attempt.visits, 1);
  assert.equal(sess(u).say.text, "Bust. You require 121.");
  assert.equal(E.boardView(sess(u)).darts.map((d) => d.sub).join("|"), "20. Left 101|60. Left 41|Bust");
  E.cameraTakeout(u, sess(u), takeout(3), T0 + 2000);
  // Visit 2: a dart unseen at the take-out is a miss (no score), the other two count.
  cam(u, "T20", 20, "T"); cam(u, "S20", 20, "S");
  r = E.cameraTakeout(u, sess(u), takeout(3), T0 + 3000);
  assert.equal(r.unseen, 1);
  assert.equal(play(u).attempt.remaining, 41);
  assert.equal(sess(u).say.text, "80. You require 41.");
  // Visit 3: 41 is T7 D10 (any valid 2-dart route); a miss and two singles: not out, down to 120.
  cam(u, "MISS", null); cam(u, "S1", 1, "S"); r = cam(u, "S1", 1, "S");
  assert.ok(r.scored.visit.done && !r.scored.visit.out);
  assert.equal(play(u).level, 120);
  assert.equal(sess(u).say.text, "2. Not this time. Down to 120.");
  assert.deepEqual(play(u).attempts[0], { target: 121, out: false, visits: 3, darts: 9, remaining: 39 });
  assert.equal(E.target(sess(u)).big, "120");
  assert.equal(E.boardView(sess(u)).cells.map((c) => c.state + ":" + c.num).join(" "), "done h0:121 current:120 todo:·");
  E.cameraTakeout(u, sess(u), takeout(3), T0 + 4000);
  // The floor: a round that starts on the floor stays there after a failure.
  const f = freshDrill("ladder121", { start: 100, floor: 100, visits: 1, attempts: 3 });
  cam(f, "S1", 1, "S"); cam(f, "S1", 1, "S"); cam(f, "S1", 1, "S");
  assert.equal(play(f).level, 100);
  assert.equal(play(f).highest, 100);
  E.cameraTakeout(f, sess(f), takeout(3), T0 + 4050);
  // Round over after the attempts: finished, paused, a result with the highest target.
  cam(f, "S1", 1, "S"); cam(f, "S1", 1, "S"); cam(f, "S1", 1, "S");
  E.cameraTakeout(f, sess(f), takeout(3), T0 + 4100);
  cam(f, "T20", 20, "T"); const last = cam(f, "D20", 20, "D");
  assert.ok(last.scored.over && E.isFinished(sess(f)));
  assert.equal(sess(f).say.text, "Game shot. 100 in 2 darts. Done. Highest 101.");
  const res = E.summarize(sess(f));
  assert.equal(res.highest, 101);
  assert.equal(res.level, 101);
  assert.equal(res.outs, 1);
  assert.equal(res.attempts, 3);
  assert.deepEqual(res.perNumber, { 100: { tries: 3, outs: 1 } });
  assert.deepEqual(res.bestOut, { target: 100, darts: 2 });
  assert.deepEqual(res.trail, [100, 100, 100, 101]);
  const pay = E.historyPayload(sess(f), T0 + 9000);
  assert.equal(pay.key, 101);
  assert.equal(pay.complete, true);
  assert.equal(E.drillOf("ladder121").pbKey(pay.settings), "ladder121:100:100:1:3");
  assert.equal(cam(f, "T20", 20, "T").message, "The drill is finished.");
});

test("the ladder by hand: the route's dart or Miss, one at a time; the hits buttons are for the other drills", () => {
  const u = freshDrill("ladder121");
  assert.match(E.manualVisit(u, sess(u), 2, T0).error, /one dart at a time/);
  assert.match(E.manualDart(freshDrill("bobs27"), freshDrill("bobs27").activeSession, "D1", T0).error, /how many darts went in/);
  let pad = E.padFor(sess(u));
  assert.deepEqual(pad.filter((b) => !b.hidden).map((b) => b.man + ":" + b.text), ["p1:T17", "p2:T10", "p3:D20", "pm:Miss"]);
  let r = E.manualDart(u, sess(u), "T17", T0 + 1000);
  assert.equal(r.effect.after, 70);
  assert.match(r.message, /^By hand: T17/);
  pad = E.padFor(sess(u));
  assert.deepEqual(pad.filter((b) => !b.hidden).map((b) => b.text), ["T18", "D8", "Miss"]);
  r = E.manualDart(u, sess(u), "MISS", T0 + 1100);
  assert.equal(r.effect.kind, "miss");
  assert.equal(E.boardView(sess(u)).darts[1].read, "Miss");
  assert.equal(E.boardView(sess(u)).darts[1].byHand, true);
  // A tap on the board: where it landed.
  const p = at(20, "T");
  r = E.manualDart(u, sess(u), { label: "T20", x: p.x, y: p.y }, T0 + 1200);
  assert.ok(r.scored, "the 3rd dart scores the visit");
  assert.equal(play(u).attempt.remaining, 10);
  assert.deepEqual(sess(u).throws.map((x) => x.src), ["btn", "btn", "btn"]);
  // A visit entered wholly by hand has no take-out coming: the buttons stay live and the next dart
  // starts the next visit.
  assert.equal(E.padFor(sess(u)).find((b) => b.man === "pm").disabled, false);
  assert.equal(E.boardView(sess(u)).pullOut, false);
  r = E.manualDart(u, sess(u), "S2", T0 + 1500); // 8 left, visit 2
  assert.ok(!r.error && r.effect.after === 8);
  assert.equal(sess(u).cam.visit.darts.length, 1);
  // By hand and the cameras in one visit: a camera dart joins the darts entered by hand, and that
  // visit then waits for the darts to come out.
  r = cam(u, "D4", 4, "D", T0 + 1600);
  assert.ok(r.scored && r.scored.visit.out);
  assert.equal(play(u).level, 122);
  assert.equal(E.padFor(sess(u)).find((b) => b.man === "pm").disabled, true, "a camera dart was in it: wait for the take-out");
  assert.match(E.manualDart(u, sess(u), "D5", T0 + 1700).error, /not counted/);
  E.cameraTakeout(u, sess(u), takeout(3), T0 + 1800);
  assert.equal(E.padFor(sess(u)).find((b) => b.man === "pm").disabled, false);
});

test("the ladder: fixing a dart scores the visit again; a dart after a bust comes back to life when the bust goes", () => {
  const u = freshDrill("ladder121");
  cam(u, "T20", 20, "T"); // 61
  let r = cam(u, "T20", 20, "T"); // 1 left: bust, the visit is over
  assert.equal(r.effect.kind, "bust");
  assert.equal(E.undoCount(u, sess(u)), 1);
  // The second dart was really a single 20: no bust, the visit goes on.
  const seq2 = sess(u).cam.visit.darts[1].s;
  r = E.fixDart(u, sess(u), 1, seq2, Object.assign({ label: "S20" }, at(20, "S")), T0 + 2000);
  assert.ok(!r.error && r.changed);
  assert.equal(r.scored, null, "two darts in: the visit is open again");
  assert.equal(E.undoCount(u, sess(u)), 0, "the visit's undo step went with its score");
  assert.equal(play(u).attempt.remaining, 121);
  assert.deepEqual(E.boardView(sess(u)).next, [], "41 left with one dart: no finish");
  assert.equal(E.boardView(sess(u)).nextLabel, "No finish in 1");
  r = cam(u, "T7", 7, "T"); // 20 left
  assert.ok(r.scored && !r.scored.visit.bust);
  assert.equal(play(u).attempt.remaining, 20);
  assert.equal(E.undoCount(u, sess(u)), 1);
  // Fix the 3rd dart to a bust: the visit scores again as a bust, back to 121.
  const seq3 = sess(u).cam.visit.darts[2].s;
  r = E.fixDart(u, sess(u), 2, seq3, Object.assign({ label: "T20" }, at(20, "T")), T0 + 2100);
  assert.ok(r.scored && r.scored.visit.bust);
  assert.equal(play(u).attempt.remaining, 121);
  assert.equal(E.undoCount(u, sess(u)), 1);
  assert.equal(u.undoStack[0].label, "121: bust");
  // Fixing the 1st dart to a bust makes the darts after it spares.
  const seq1 = sess(u).cam.visit.darts[0].s;
  r = E.fixDart(u, sess(u), 0, seq1, Object.assign({ label: "T20" }, at(20, "T")), T0 + 2200);
  const b = E.boardView(sess(u));
  assert.equal(b.darts.length, 3);
  assert.equal(b.darts[0].kind, "hit", "60 scored is shown as a good dart");
  // 121 - 60 = 61, then S20 leaves 41, then T20 busts: the visit still ends on the 3rd dart as a bust.
  assert.equal(b.darts[2].sub, "Bust");
  // Make dart 2 a T20 as well: 61 - 60 = 1, a bust on dart 2, so dart 3 is a spare.
  r = E.fixDart(u, sess(u), 1, seq2, Object.assign({ label: "T20" }, at(20, "T")), T0 + 2300);
  const b2 = E.boardView(sess(u));
  assert.equal(b2.darts[1].sub, "Bust");
  assert.equal(b2.darts[2].kind, "spare");
  assert.equal(sess(u).throws.length, 2, "only the two live darts are in the log");
  // Fix options for an x01 dart: the route's dart, the beds where it landed, a miss, another number.
  const opts = E.fixOptions(b2.darts[2], b2).map((o) => o.id);
  assert.deepEqual(opts, ["remove"], "a spare can only be removed");
  const opts1 = E.fixOptions(b2.darts[0], b2).map((o) => o.id);
  assert.deepEqual(opts1, ["T17", "T20", "D20", "S20", "MISS", "other", "remove"]);
  // Undo takes the whole visit back.
  const un = E.undoStep(u, sess(u), T0 + 2400);
  assert.ok(!un.error);
  assert.equal(sess(u).throws.length, 0);
  assert.equal(sess(u).say.text, "Undone. You require 121.");
});

test("Two-Dart Finishes: the range, the order, and a try of two darts scored in parts", () => {
  const d = E.drillOf("twodart");
  assert.deepEqual(E.cleanSettings(d, {}), { from: 61, to: 70, order: "up", rounds: 1 });
  assert.equal(E.cleanSettings(d, { order: "sideways" }).order, "up");
  const u = freshDrill("twodart");
  assert.deepEqual(play(u).queue, [61, 62, 63, 64, 65, 66, 67, 68, 69, 70]);
  const r1 = freshDrill("twodart", { order: "random" }), r2 = freshDrill("twodart", { order: "random" });
  assert.deepEqual(play(r1).queue, play(r2).queue, "the shuffle is fixed by the start time, so every device agrees");
  assert.notDeepEqual(play(r1).queue, play(u).queue);
  assert.deepEqual(play(r1).queue.slice().sort((a, b) => a - b), play(u).queue);
  assert.equal(play(freshDrill("twodart", { from: 70, to: 61, rounds: 2 })).queue.length, 20);
  assert.equal(d.pbKey({ from: 70, to: 61, rounds: 2 }), "twodart:61:70:2");
  let t = E.target(sess(u));
  assert.equal(t.big, "61");
  assert.deepEqual(t.route, ["T15", "D8"]);
  assert.equal(t.intro, "61. T 15, D 8");
  let v = E.boardView(sess(u));
  assert.equal(v.countHtml, "Dart 1 <span>of 2</span>");
  assert.equal(v.label, "Finish");
  // 61: T15 (16 left, the setup), then D8: game shot.
  let r = cam(u, "T15", 15, "T");
  assert.equal(r.effect.setup, true);
  assert.equal(r.scored, null);
  v = E.boardView(sess(u));
  assert.equal(v.target, "16");
  assert.equal(v.label, "Left");
  assert.deepEqual(v.next, ["D8"]);
  assert.equal(v.darts[0].sub, "45. Left 16: D8");
  assert.deepEqual(E.padFor(sess(u)).filter((b) => !b.hidden).map((b) => b.text), ["D8", "Miss"]);
  r = cam(u, "D8", 8, "D");
  assert.ok(r.scored && r.scored.visit.out, "the 2nd dart ends the try");
  assert.equal(play(u).outs, 1);
  assert.equal(sess(u).say.text, "61. Game shot. Next, 62.");
  assert.equal(r.scored.moment.big, "Game shot");
  assert.equal(cam(u, "S1", 1, "S").effect.kind, "spare", "a 3rd dart before the take-out is not counted");
  E.cameraTakeout(u, sess(u), takeout(3), T0 + 2000);
  // 62: T10 D16 is the route; S10 leaves 52, no double: setup missed, and the 2nd dart ends the try.
  assert.deepEqual(E.target(sess(u)).route, ["T10", "D16"]);
  r = cam(u, "S10", 10, "S");
  assert.equal(r.effect.setup, false);
  assert.equal(E.boardView(sess(u)).nextLabel, "No finish");
  r = cam(u, "T20", 20, "T");
  assert.equal(r.effect.kind, "miss", "a 2nd dart that is not the finish is a miss, whatever it scored");
  assert.ok(r.scored && !r.scored.visit.out && !r.scored.visit.setup);
  assert.equal(sess(u).say.text, "62. Setup missed. Next, 63.");
  E.cameraTakeout(u, sess(u), takeout(2), T0 + 3000);
  // 63: T13 D12. The setup hit, the double missed into the single.
  cam(u, "T13", 13, "T");
  r = cam(u, "S12", 12, "S");
  assert.ok(r.scored.visit.setup && !r.scored.visit.out);
  assert.equal(sess(u).say.text, "63. Left D 12. Missed. Next, 64.");
  assert.equal(E.boardView(sess(u)).darts[1].sub, "Missed D12");
  E.cameraTakeout(u, sess(u), takeout(2), T0 + 4000);
  // 64: one dart seen, then the darts come out: the dart not seen is a miss and the try is over.
  cam(u, "T16", 16, "T");
  r = E.cameraTakeout(u, sess(u), takeout(2), T0 + 5000);
  assert.equal(r.unseen, 1);
  assert.equal(play(u).cursor, 4);
  assert.equal(play(u).setups, 3);
  assert.equal(E.boardView(sess(u)).cells.slice(0, 5).map((c) => c.state + ":" + c.sub).join(" "), "done h3:in done h0:setup no done h1:D12 no done h1:D8 no current:T11 D16");
  // Through the rest by hand, then the result.
  for (let k = 0; k < 6; k += 1) { E.manualDart(u, sess(u), "S1", T0 + 6000 + k); E.manualDart(u, sess(u), "MISS", T0 + 6500 + k); }
  assert.ok(E.isFinished(sess(u)));
  assert.equal(sess(u).say.text, "70. Setup missed. Done. 1 finish.");
  const res = E.summarize(sess(u));
  assert.equal(res.outs, 1);
  assert.equal(res.tries, 10);
  assert.equal(res.setups, 3);
  assert.equal(res.doublesHit, 1);
  assert.deepEqual(res.perNumber[61], { tries: 1, outs: 1, setups: 1 });
  assert.deepEqual(res.perNumber[64], { tries: 1, outs: 0, setups: 1 });
  assert.equal(res.darts, 20);
  assert.equal(E.historyPayload(sess(u), T0 + 9000).key, 1);
  assert.equal(sess(u).throws.length, 20);
  assert.equal(E.isNewBest("twodart", 1, null), true);
  assert.equal(E.isNewBest("twodart", 1, { key: 1 }), false);
});

test("the strip columns, the progress and the settings line for each drill", () => {
  const l = freshDrill("ladder121", { attempts: 12 }), t = freshDrill("twodart", { rounds: 2 }), b = freshDrill("bobs27");
  assert.equal(E.boardView(sess(l)).cols, 10);
  assert.equal(E.boardView(sess(l)).cells.length, 12);
  assert.equal(E.boardView(sess(t)).cols, 10);
  assert.equal(E.boardView(sess(t)).cells.length, 20);
  assert.equal(E.boardView(sess(b)).cols, undefined);
  assert.deepEqual(E.progress(sess(l)), { done: 0, of: 12, unit: "targets" });
  assert.deepEqual(E.progress(sess(t)), { done: 0, of: 20, unit: "finishes" });
  assert.deepEqual(E.progress(sess(b)), { done: 0, of: 21, unit: "doubles" });
  assert.equal(E.settingsText(E.drillOf("twodart"), sess(t).meta.settings), "from 61 · to 70 · In order · times through the range 2");
  assert.equal(E.settingsText(E.drillOf("bobs27"), sess(b).meta.settings), "starting score 27 · Say the score after each double");
  assert.equal(E.boardView(sess(l)).capHtml, "<strong>0</strong> of 0 checked out · highest 121");
  assert.equal(E.readLabel("DB"), "Bull");
  assert.equal(E.speakLabel("T20"), "T 20");
  assert.equal(E.speakLabel("S5"), "5");
});

// ---- Phase 3: the scoring drills ---------------------------------------------------------------------------
test("the registry order and the categories of the scoring drills", () => {
  assert.deepEqual(E.DRILLS.map((d) => d.id), ["marathon", "bigtriples", "gameof9", "bobs27", "ladder121", "twodart", "scoremore", "scoremore2", "warmup", "free"]);
  assert.ok(["marathon", "bigtriples", "gameof9"].every((id) => E.drillOf(id).category === "Scoring" && E.drillOf(id).input === "hits"));
});

test("Triple 20 Marathon: the darts to a set number of triples; the last triple ends the drill mid-visit", () => {
  const d = E.drillOf("marathon");
  assert.deepEqual(E.cleanSettings(d, {}), { number: "20", need: 10 });
  assert.equal(d.pbKey(E.cleanSettings(d, { number: "19", need: 5 })), "marathon:19:5");
  const u = freshDrill("marathon", { need: 3 });
  let t = E.target(sess(u));
  assert.equal(t.key, "T20");
  assert.equal(t.intro, "Throw at T 20. 3 to hit");
  assert.deepEqual(t.lit, [{ n: 20, beds: "T", tint: true }]);
  let r = cam(u, "T20", 20, "T");
  assert.equal(r.effect.kind, "hit");
  assert.equal(r.effect.ends, undefined, "the first of three does not end it");
  r = cam(u, "S20", 20, "S");
  assert.equal(E.boardView(sess(u)).darts[1].sub, "Single 20");
  r = cam(u, "T20", 20, "T");
  assert.ok(r.scored && r.scored.hits === 2 && !r.scored.over);
  assert.equal(play(u).hits, 2);
  assert.equal(play(u).darts, 3);
  assert.deepEqual(play(u).trail, [0, 1, 3], "the dart count at each triple");
  assert.equal(sess(u).say.text, "Two hits. 2 of 3.");
  assert.equal(E.boardView(sess(u)).cells.map((c) => c.state + ":" + c.num + ":" + c.sub).join(" "), "done h3:1:dart 1 done h3:2:dart 3 current:3:dart 4");
  assert.equal(E.boardView(sess(u)).capHtml, "<strong>3</strong> darts · 67% in T20");
  // Pace against a best that took 2, 4 and 6 darts: 1 dart ahead at the second triple.
  assert.equal(d.paceText(play(u), { result: { trail: [0, 2, 4, 6] } }), "1 dart ahead of your best");
  E.cameraTakeout(u, sess(u), takeout(3), T0 + 2000);
  // Visit 2: a miss, then the last triple on dart 2: the drill is over and the 3rd dart is not counted.
  cam(u, "S5", 5, "S");
  assert.equal(E.boardView(sess(u)).darts[0].sub, "Next door, in the 5");
  r = cam(u, "T20", 20, "T");
  assert.ok(r.scored && r.scored.over && r.effect.ends);
  assert.equal(play(u).darts, 5);
  assert.equal(sess(u).say.text, "One hit. 3 of 3. All 3. 5 darts.");
  assert.equal(r.scored.moment.big, "3 in 5");
  assert.equal(cam(u, "T20", 20, "T").message, "The drill is finished.");
  const res = E.summarize(sess(u));
  assert.equal(res.darts, 5);
  assert.equal(res.finished, true);
  assert.equal(E.historyPayload(sess(u), T0 + 9000).key, 5);
  assert.equal(E.isNewBest("marathon", 5, { key: 6 }), true, "fewer darts is better");
  assert.equal(E.isNewBest("marathon", 7, { key: 6 }), false);
  assert.equal(E.personalBest([{ drill: "marathon", settings: { number: "20", need: 3 }, key: 9, result: {} }, { drill: "marathon", settings: { number: "20", need: 3 }, key: 7, result: {} }], "marathon", { need: 3 }).key, 7);
  // By hand: with one triple left, "2 hits" counts one dart and ends it.
  const h = freshDrill("marathon", { need: 1 });
  r = E.manualVisit(u2(h), sess(h), 2, T0 + 100);
  assert.ok(r.over && play(h).darts === 1);
  // Fix options for a dart at a triple.
  const f = freshDrill("marathon");
  cam(f, "O20", 20, "O");
  const v = E.boardView(sess(f));
  assert.equal(v.darts[0].sub, "Just past the 20 wire");
  assert.deepEqual(E.fixOptions(v.darts[0], v).map((o) => o.id + (o.hit ? "!" : "") + (o.cur ? "*" : "")), ["T20!", "D20", "S20", "O20*", "other", "remove"]);
  function u2(x) { return x; }
});

test("Big Triples: darts per number at each triple in turn; the count for each number", () => {
  const d = E.drillOf("bigtriples");
  assert.deepEqual(E.cleanSettings(d, {}), { numbers: "20 19 18 17", per: 9 });
  assert.equal(play(freshDrill("bigtriples", { per: 10 })).per, 9, "darts per number come in visits of 3");
  const u = freshDrill("bigtriples", { numbers: "20 19", per: 3 });
  assert.equal(d.pbKey(sess(u).meta.settings), "bigtriples:3:20-19");
  assert.deepEqual(E.progress(sess(u)), { done: 0, of: 2, unit: "visits" });
  assert.deepEqual(E.boardView(sess(u)).next, ["T19"]);
  let r = E.manualVisit(u, sess(u), 2, T0 + 100);
  assert.ok(r.visit.last && play(u).cursor === 1 && play(u).total === 2);
  assert.equal(sess(u).say.text, "T 20. Two hits. 2 at T 20. Next, T 19.");
  assert.equal(E.target(sess(u)).key, "T19");
  // The cameras at T19: one in, then the darts come out with two unseen: misses.
  cam(u, "T19", 19, "T");
  r = E.cameraTakeout(u, sess(u), takeout(3), T0 + 2000);
  assert.equal(r.unseen, 2);
  assert.ok(E.isFinished(sess(u)));
  assert.equal(sess(u).say.text, "T 19. One hit. 1 at T 19. Done. 3 triples.");
  const res = E.summarize(sess(u));
  assert.equal(res.hits, 3);
  assert.equal(res.darts, 6);
  assert.deepEqual(res.perNumber, { 20: { hits: 2, darts: 3 }, 19: { hits: 1, darts: 3 } });
  assert.deepEqual(res.trail, [0, 2, 3]);
  assert.equal(res.bestNumber, 20);
  assert.equal(E.boardView(sess(u)).cells.map((c) => c.state + ":" + c.num).join(" "), "done h2:T20 done h1:T19");
  assert.equal(E.historyPayload(sess(u), T0 + 9000).key, 3);
  assert.equal(d.paceText(play(u), { result: { trail: [0, 1, 1] } }), "+2 on your best");
  // Three in one visit is a moment.
  const m = freshDrill("bigtriples");
  r = E.manualVisit(m, sess(m), 3, T0 + 100);
  assert.equal(r.moment.big, "Three in T20");
  assert.equal(E.boardView(sess(m)).cells.length, 12);
  assert.equal(E.boardView(sess(m)).cols, 12);
});

test("Game of 9: nine darts at the whole number, a pass mark to move on, the darts for the run", () => {
  const d = E.drillOf("gameof9");
  assert.deepEqual(E.cleanSettings(d, {}), { pass: 7, bullPass: 4, maxTries: 6 });
  const u = freshDrill("gameof9");
  let t = E.target(sess(u));
  assert.equal(t.key, "N20");
  assert.equal(t.rings, "SDT");
  assert.equal(t.intro, "20. Any ring. 7 of 9 to pass");
  assert.deepEqual(t.lit, [{ n: 20, beds: "SDT", tint: true }]);
  assert.equal(d.dartEffect(play(u), t, { l: "D20" }).kind, "hit");
  assert.equal(d.dartEffect(play(u), t, { l: "T20" }).kind, "hit");
  assert.equal(d.dartEffect(play(u), t, { l: "S5" }).kind, "miss");
  // Three visits: 3, 2, 2 = 7 in 9: passed.
  let r = E.manualVisit(u, sess(u), 3, T0 + 100);
  assert.equal(sess(u).say.text, "20. Three in. 3 in 3.");
  assert.equal(E.boardView(sess(u)).cells[0].sub, "3 in 3");
  E.manualVisit(u, sess(u), 2, T0 + 200);
  r = E.manualVisit(u, sess(u), 2, T0 + 300);
  assert.ok(r.visit.done && r.visit.passed && r.visit.moved);
  assert.equal(play(u).stage, 1);
  assert.deepEqual(play(u).trail, [0, 9]);
  assert.equal(sess(u).say.text, "20 passed. 7 in 9. Next, 19.");
  assert.equal(r.moment.big, "20 passed");
  assert.equal(E.boardView(sess(u)).cells[0].state + ":" + E.boardView(sess(u)).cells[0].sub, "done h3:1 try");
  // 19: 2, 2, 2 = 6: again.
  for (const k of [1, 2, 3]) r = E.manualVisit(u, sess(u), 2, T0 + 400 + k);
  assert.ok(r.visit.done && !r.visit.passed && !r.visit.moved);
  assert.equal(sess(u).say.text, "19. 6 in 9. Again.");
  assert.equal(play(u).stage, 1);
  assert.equal(play(u).tries, 1);
  assert.equal(play(u).darts, 18);
  assert.equal(E.boardView(sess(u)).capHtml, "<strong>18</strong> darts · try 2 at 19: 0 in 0, 7 of 9 to pass");
  // The bull: either ring counts, 4 of 9 to pass.
  const b = freshDrill("gameof9", { maxTries: 1 });
  for (let k = 0; k < 18; k += 1) E.manualVisit(b, sess(b), 0, T0 + 1000 + k); // six numbers given up
  t = E.target(sess(b));
  assert.equal(t.key, "NBULL");
  assert.equal(t.mark, 4);
  assert.equal(d.dartEffect(play(b), t, { l: "SB" }).kind, "hit");
  assert.equal(d.dartEffect(play(b), t, { l: "DB" }).kind, "hit");
  assert.equal(sess(b).say.text, "15. 0 in 9. Moving on. Next, the bull.");
  cam(b, "SB", "BULL"); cam(b, "DB", "BULL"); cam(b, "S20", 20, "S");
  assert.equal(E.boardView(sess(b)).darts.map((x) => x.sub).join("|"), "Outer bull|Bullseye|In the 20");
  E.cameraTakeout(b, sess(b), takeout(3), T0 + 3000);
  E.manualVisit(b, sess(b), 2, T0 + 3100);
  r = E.manualVisit(b, sess(b), 0, T0 + 3200);
  assert.ok(r.over && E.isFinished(sess(b)));
  assert.equal(sess(b).say.text, "The bull passed. 4 in 9. Done. 63 darts.");
  const res = E.summarize(sess(b));
  assert.equal(res.darts, 63);
  assert.equal(res.passedAll, false);
  assert.equal(res.runDarts, null, "a run with a number skipped has no best");
  assert.deepEqual(res.skipped, ["20", "19", "18", "17", "16", "15"]);
  assert.equal(E.historyPayload(sess(b), T0 + 9000).key, null);
  assert.equal(E.isNewBest("gameof9", null, null), false);
  assert.equal(res.perNumber.BULL.passed, true);
  // A clean run: the darts are the best.
  const c = freshDrill("gameof9", { pass: 1, bullPass: 1 });
  for (let k = 0; k < 21; k += 1) E.manualVisit(c, sess(c), 1, T0 + 5000 + k);
  const rc = E.summarize(sess(c));
  assert.ok(E.isFinished(sess(c)) && rc.passedAll && rc.runDarts === 63);
  assert.equal(d.paceText(play(c), { result: { trail: [0, 9, 18, 27, 36, 45, 54, 72] } }), "9 darts ahead of your best");
  assert.deepEqual(E.fixOptions(Object.assign({ key: "NBULL", label: "SB" }, {}), { drill: "gameof9", targetKey: "NBULL" }).map((o) => o.id + (o.hit ? "!" : "")), ["DB!", "SB!", "other", "remove"]);
});

// ---- Phase 4: pressure and warm-up -----------------------------------------------------------------------
const MIN = 60000;
const visitBy = (u, labels, t) => labels.forEach((l, i) => { const r = E.manualDart(u, sess(u), l, (t || T0) + i); assert.ok(!r.error, r.error); });

test("Warm-up, visits of 3: minutes on each number in turn; it changes at the end of the visit in which the time is up; no best", () => {
  const d = E.drillOf("warmup");
  assert.equal(d.category, "Warm-up");
  assert.equal(d.noBest, true);
  assert.deepEqual(E.cleanSettings(d, {}), { numbers: "20 19", each: "3", visit: "12" });
  // An old device's settings (one time for the lot) are put right.
  assert.deepEqual(E.cleanSettings(d, { minutes: "10", numbers: "20 19" }), { numbers: "20 19", each: "3", visit: "12" });
  const u = freshDrill("warmup", { each: "3", visit: "3" });
  assert.equal(E.inputOf(d, play(u)), "hits", "visits of 3: the hits by hand");
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 1), 3, "the cameras keep visits of 3");
  let t = E.target(sess(u));
  assert.equal(t.big, "20");
  assert.equal(t.rings, "SDT");
  // Any ring of the 20 counts; a dart in the 1 doesn't.
  E.cameraDart(u, sess(u), dart("T20", 20, "T"), T0 + 1000);
  E.cameraDart(u, sess(u), dart("S20", 20, "S"), T0 + 2000);
  const r = E.cameraDart(u, sess(u), dart("S1", 1, "S"), T0 + 3000);
  assert.equal(r.scored.hits, 2);
  assert.equal(r.scored.line, null, "quiet: nothing said for an ordinary visit");
  E.cameraTakeout(u, sess(u), takeout(3), T0 + 4000);
  const view = E.boardView(sess(u), { now: T0 + 2 * MIN });
  assert.equal(view.note, "1:00 at the 20s, then the 19s");
  assert.match(view.capHtml, /67%<\/strong> in the number · 20: 67%, 19: - · 4:00 left/);
  assert.equal(view.slots, undefined, "three dart boxes");
  // A visit at 3:30 is the one in which the 20s' time was up: on to the 19s, with their own 3 minutes.
  sess(u).timer.lastActivityAt = T0 + 3.5 * MIN; // throwing all along (no idle pause)
  assert.equal(E.boardView(sess(u), { now: T0 + 3.5 * MIN }).note, "Time's up at the 20s: the 19s after this visit");
  const m = E.manualVisit(u, sess(u), 3, T0 + 3.5 * MIN);
  assert.equal(m.visit.switched, "19");
  assert.equal(m.line, "The 19s now.");
  assert.equal(m.moment.big, "The 19s");
  t = E.target(sess(u));
  assert.equal(t.big, "19");
  assert.equal(play(u).stageAt, 3.5 * MIN);
  sess(u).timer.lastActivityAt = T0 + 6 * MIN;
  assert.equal(E.boardView(sess(u), { now: T0 + 6 * MIN }).note, "0:30 left at the 19s");
  assert.equal(E.manualVisit(u, sess(u), 0, T0 + 6 * MIN).over, false, "the 19s still have 30 seconds");
  sess(u).timer.lastActivityAt = T0 + 6.6 * MIN;
  assert.equal(E.boardView(sess(u), { now: T0 + 6.6 * MIN }).note, "Time's up: this visit is the last");
  const end = E.manualVisit(u, sess(u), 1, T0 + 6.6 * MIN);
  assert.equal(end.over, true);
  assert.equal(end.line, "Warm-up done. 50% in the number.");
  const res = E.summarize(sess(u));
  assert.deepEqual([res.rate, res.hits, res.darts, res.per["20"].hits, res.per["19"].hits, res.visits], [50, 6, 12, 5, 1, 4]);
  assert.deepEqual(E.boardView(sess(u)).cells.map((c) => `${c.num}:${c.state}:${c.sub}`), ["20:done h3:83%", "19:done h1:17%"]);
  const h = E.historyPayload(sess(u), T0 + 11 * MIN);
  assert.equal(h.key, 50);
  assert.equal(E.personalBest([Object.assign({}, h, { sessionKey: "a" })], "warmup", {}), null, "no best for a warm-up");
  assert.equal(E.isNewBest("warmup", 50, null), false);
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 7 * MIN), 3, "over: visits of 3 again");
});

test("Warm-up, up to 12 darts: the take-out ends a visit however many went in; unseen darts aren't counted; the cameras are told", () => {
  const d = E.drillOf("warmup");
  const u = freshDrill("warmup", { numbers: "20-15 BULL", each: "1", visit: "12" });
  assert.equal(E.inputOf(d, play(u)), "darts", "one dart at a time by hand");
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 1), 12);
  assert.deepEqual(play(u).numbers, ["20", "19", "18", "17", "16", "15", "BULL"]);
  assert.deepEqual(E.padFor(sess(u)).filter((b) => !b.hidden).map((b) => b.label || b.man), ["T20", "S20", "D20", "MISS"]);
  // Seven darts with the cameras: nothing is scored until they come out.
  const labels = [["T20", 20, "T"], ["S20", 20, "S"], ["S1", 1, "S"], ["S20", 20, "S"], ["D20", 20, "D"], ["S5", 5, "S"], ["S20", 20, "S"]];
  let r;
  labels.forEach(([l, n, ring], i) => { r = E.cameraDart(u, sess(u), dart(l, n, ring), T0 + 1000 + i * 1000); });
  assert.equal(r.scored, null, "the 7th dart of up to 12 doesn't end the visit");
  assert.match(r.message, /dart 7 of up to 12 at 20/);
  let v = E.boardView(sess(u), { now: T0 + 8000 });
  assert.equal(v.darts.length, 7);
  assert.equal(d.scoreText(E.shownPlay(sess(u))), "71%", "the darts still in the board show in the rate (5 of 7)");
  assert.equal(play(u).darts, 0, "but the visit isn't scored yet");
  assert.equal(v.slots, 12);
  assert.equal(v.countHtml, "Dart 8 <span>of up to 12</span>");
  // A dart fixed before the take-out: still not scored.
  const fx = E.fixDart(u, sess(u), 2, v.darts[2].s, { label: "S20", x: 0, y: -0.4 }, T0 + 8500);
  assert.equal(fx.scored, null);
  const out = E.cameraTakeout(u, sess(u), takeout(7), T0 + 9000);
  assert.equal(out.unseen, 0, "no misses filled in");
  assert.equal(out.message, "Darts out. The 20s: 6 of 7 in.");
  assert.deepEqual([play(u).hits, play(u).darts], [6, 7]);
  // By hand, a dart joins the visit; Miss too.
  assert.ok(!E.manualDart(u, sess(u), "T20", T0 + 10000).error);
  assert.ok(!E.manualDart(u, sess(u), "MISS", T0 + 10100).error);
  assert.equal(sess(u).cam.visit.darts.length, 2);
  // Undo takes back the whole visit of 7.
  E.cameraTakeout(u, sess(u), takeout(2), T0 + 11000);
  assert.deepEqual([play(u).hits, play(u).darts], [7, 9]);
  E.undoStep(u, sess(u), T0 + 12000);
  E.undoStep(u, sess(u), T0 + 12100);
  assert.deepEqual([play(u).hits, play(u).darts], [0, 0]);
  // Twelve darts end the visit by themselves: the 13th isn't counted.
  for (let i = 0; i < 12; i += 1) r = E.cameraDart(u, sess(u), dart("S20", 20, "S"), T0 + 20000 + i);
  assert.ok(r.scored && r.scored.hits === 12);
  assert.match(r.message, /Pull your darts out, then 20\./);
  assert.equal(E.boardView(sess(u)).pullOut, true);
  assert.equal(E.boardView(sess(u)).countHtml, "Next visit");
  assert.equal(E.cameraDart(u, sess(u), dart("S20", 20, "S"), T0 + 21000).effect.kind, "spare");
  E.cameraTakeout(u, sess(u), takeout(12), T0 + 22000);
  // Paused: the cameras go back to visits of 3 until it is resumed.
  E.pauseResume(sess(u), T0 + 23000);
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 23001), 3);
  E.pauseResume(sess(u), T0 + 24000);
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 24001), 12);
  // At the bull: the bull's two rings.
  play(u).stage = 6;
  assert.equal(E.target(sess(u)).big, "BULL");
  assert.deepEqual(E.padFor(sess(u)).filter((b) => !b.hidden).map((b) => b.label || b.man), ["DB", "SB", "MISS"]);
  assert.equal(d.dartEffect(play(u), E.target(sess(u)), { l: "SB" }).kind, "hit");
});

test("Free throwing: no target, up to 12 a visit, where the darts went; Finish with no time limit, and Undo takes it back", () => {
  const d = E.drillOf("free");
  assert.equal(d.category, "Warm-up");
  assert.equal(d.input, "darts");
  assert.deepEqual(E.cleanSettings(d, {}), { minutes: "10", visit: "12" });
  const u = freshDrill("free", { minutes: "0" });
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 1), 12);
  assert.equal(E.target(sess(u)).big, "Any");
  [["T20", 20, "T"], ["T20", 20, "T"], ["S1", 1, "S"], ["DB", "BULL"], ["D16", 16, "D"], [null, null]].forEach(([l, n, ring], i) => E.cameraDart(u, sess(u), dart(l || "MISS", n, ring), T0 + 1000 + i));
  let v = E.boardView(sess(u), { now: T0 + 7000 });
  assert.deepEqual(v.darts.map((x) => `${x.read}:${x.sub}`), ["T20:60", "T20:60", "S1:1", "Bull:50", "D16:32", "Outside:0"]);
  // Still in the board: on the screen already (the tallies and the strip), not yet in the drill.
  assert.equal(E.pendingDarts(sess(u)).length, 6);
  assert.equal(play(u).darts, 0);
  assert.equal(v.capHtml, "<strong>6</strong> darts · average 101.5 · 2 triples, 1 double, 1 bull");
  assert.equal(v.cells[0].sub, "2");
  assert.equal(v.note, "No time limit: press Finish when you're done");
  const out = E.cameraTakeout(u, sess(u), takeout(6), T0 + 8000);
  assert.equal(out.message, "Darts out. 6 darts, 203 scored.");
  assert.equal(play(u).by["20"], 2);
  v = E.boardView(sess(u), { now: T0 + 9000 });
  assert.equal(v.capHtml, "<strong>6</strong> darts · average 101.5 · 2 triples, 1 double, 1 bull");
  assert.equal(v.cells.length, 21);
  assert.equal(v.cells[0].state + ":" + v.cells[0].sub, "done h3:2");
  // Finish mid-visit: the darts in it count, as at a take-out.
  E.cameraDart(u, sess(u), dart("S19", 19, "S"), T0 + 10000);
  const f = E.finishNow(u, sess(u), T0 + 11000);
  assert.ok(f.finished && E.isFinished(sess(u)));
  assert.equal(sess(u).say.text, "Free throwing done. 7 darts.");
  const res = E.summarize(sess(u));
  assert.deepEqual([res.darts, res.visits, res.triples, res.doubles, res.bulls, res.off], [7, 2, 2, 1, 1, 1]);
  assert.deepEqual(res.top.map((x) => x.n), ["20", "19", "16"], "a tie goes to the higher number");
  assert.equal(E.historyPayload(sess(u), T0 + 12000).key, 7);
  assert.equal(E.cameraVisitDarts(sess(u), T0 + 12000), 3);
  // Undo takes the finish back, and then the visit.
  const un = E.undoStep(u, sess(u), T0 + 13000);
  assert.ok(un.unfinished && !E.isFinished(sess(u)));
  assert.equal(play(u).darts, 7);
  E.undoStep(u, sess(u), T0 + 14000);
  assert.equal(play(u).darts, 6);
  // With a time limit: it ends at the take-out after the time is up.
  const w = freshDrill("free", { minutes: "5", visit: "6" });
  assert.equal(E.cameraVisitDarts(sess(w), T0 + 1), 6);
  assert.equal(E.finishNow(w, sess(w), T0 + 2).finished, true, "Finish works with a time limit too");
  const x = freshDrill("free", { minutes: "5", visit: "3" });
  assert.equal(E.cameraVisitDarts(sess(x), T0 + 1), 3, "up to 3: the cameras' usual visit");
  E.cameraDart(x, sess(x), dart("S20", 20, "S"), T0 + 1000);
  sess(x).timer.lastActivityAt = T0 + 5 * MIN;
  const late = E.cameraTakeout(x, sess(x), takeout(1), T0 + 5 * MIN + 1000);
  assert.equal(late.unseen, 0, "free throwing never fills in misses");
  assert.ok(late.scored.over, "time's up: that visit ended it");
});

test("Score More: each visit must beat the last; a visit that doesn't is a strike; three strikes end it; the score is the longest run", () => {
  const d = E.drillOf("scoremore");
  assert.equal(d.category, "Pressure");
  assert.equal(d.input, "darts");
  assert.deepEqual(E.cleanSettings(d, {}), { beat: "last", strikes: 3 });
  const u = freshDrill("scoremore");
  let t = E.target(sess(u));
  assert.equal(t.big, "Score");
  assert.equal(t.heroLabel, "First visit: set the mark");
  visitBy(u, ["S20", "S20", "S5"]); // 45: the mark
  t = E.target(sess(u));
  assert.equal(t.big, "45");
  const pad = E.padFor(sess(u)).filter((b) => !b.hidden).map((b) => b.label || b.man);
  assert.deepEqual(pad, ["T20", "S20", "S5", "MISS"]);
  visitBy(u, ["T20"]);
  let v = E.boardView(sess(u), {});
  assert.equal(v.nextLabel, "60: beaten");
  visitBy(u, ["MISS", "MISS"]); // 60: beat 45, run 1
  visitBy(u, ["T20", "S1", "MISS"]); // 61: run 2
  visitBy(u, ["S20", "S20", "S20"]); // 60: not more than 61, strike 1
  assert.deepEqual([play(u).run, play(u).longest, play(u).struck], [0, 2, 1]);
  visitBy(u, ["S20", "S20", "S20"]); // 60 again: the same is a strike
  assert.equal(play(u).struck, 2);
  const last = E.manualDart(u, sess(u), "S1", T0 + 99);
  E.manualDart(u, sess(u), "MISS", T0 + 100);
  const r = E.manualDart(u, sess(u), "MISS", T0 + 101); // 1: strike 3
  assert.ok(last && r.scored.over);
  assert.equal(r.scored.line, "1. Strike 3. 3 strikes. Longest run 2.");
  const res = E.summarize(sess(u));
  assert.deepEqual([res.longest, res.visits, res.struck, res.best, res.beaten], [2, 6, 3, 61, 2]);
  assert.equal(E.historyPayload(sess(u), T0 + MIN).key, 2);
});

test("Score More with the cameras: a visit is 3 darts and nothing ends it early; unseen darts are 0; a 4th dart isn't counted", () => {
  const u = freshDrill("scoremore");
  E.cameraDart(u, sess(u), dart("T20", 20, "T"), T0 + 1000);
  const t1 = E.cameraTakeout(u, sess(u), takeout(1), T0 + 2000);
  assert.equal(t1.unseen, 2);
  assert.equal(t1.scored.visit.score, 60);
  E.cameraDart(u, sess(u), dart("T20", 20, "T"), T0 + 3000);
  E.cameraDart(u, sess(u), dart("T20", 20, "T"), T0 + 4000);
  const third = E.cameraDart(u, sess(u), dart("S5", 5, "S"), T0 + 5000);
  assert.equal(third.scored.visit.score, 125);
  assert.equal(third.scored.visit.beat, true);
  const spare = E.cameraDart(u, sess(u), dart("T20", 20, "T"), T0 + 6000);
  assert.equal(spare.effect.kind, "spare");
  assert.equal(play(u).scores.join(","), "60,125");
  const words = E.boardView(sess(u), {}).darts.map((x) => x.read + ":" + x.sub);
  assert.deepEqual(words, ["T20:60", "T20:60", "S5:5"]);
  assert.equal(E.summarize(sess(u)).visits, 2);
});

test("Score More against your average: more than the average so far; the same mode keeps its own best", () => {
  const d = E.drillOf("scoremore");
  assert.notEqual(d.pbKey(E.cleanSettings(d, { beat: "average" })), d.pbKey(E.cleanSettings(d, {})));
  const u = freshDrill("scoremore", { beat: "average", strikes: 1 });
  visitBy(u, ["S20", "S20", "S5"]); // 45
  visitBy(u, ["T20", "MISS", "MISS"]); // 60 > 45: run 1, average 52.5
  assert.equal(E.target(sess(u)).big, "52.5");
  assert.equal(E.target(sess(u)).heroLabel, "Beat your average");
  visitBy(u, ["S20", "S20", "S5"]); // 45: strike, over
  assert.equal(E.isFinished(sess(u)), true);
  assert.equal(E.summarize(sess(u)).longest, 1);
});

test("Score More, two players: the lower scorer of a round must beat their own score next round; strikes; the other player wins", () => {
  const d = E.drillOf("scoremore2");
  assert.equal(d.needsOpponent, true);
  assert.equal(E.newSession("scoremore2", {}, T0, "k"), null, "it needs the other player");
  const u = { uid: "me", undoStack: [] };
  u.activeSession = E.newSession("scoremore2", { strikes: 2 }, T0, "k3", { opponent: { name: "Sam", email: "sam@example.com" } });
  assert.deepEqual(sess(u).meta.opponent, { name: "Sam", email: "sam@example.com" });
  let t = E.target(sess(u));
  assert.equal(t.heroLabel, "You: throw");
  visitBy(u, ["T20", "S20", "S5"]); // you 85
  t = E.target(sess(u));
  assert.equal(t.heroLabel, "Sam: throw");
  visitBy(u, ["S20", "S20", "S1"]); // Sam 41: lower, must beat 41
  assert.deepEqual(play(u).spot, [false, true]);
  assert.match(E.boardView(sess(u), {}).capHtml, /Round 2/);
  t = E.target(sess(u));
  assert.equal(t.heroLabel, "You: throw");
  visitBy(u, ["S20", "MISS", "MISS"]); // you 20: nothing to beat this round
  t = E.target(sess(u));
  assert.equal(t.heroLabel, "Sam: beat");
  assert.equal(t.big, "41");
  const lastSam = (labels) => { let r; labels.forEach((l, i) => { r = E.manualDart(u, sess(u), l, T0 + 500 + i); }); return r.scored; };
  let s = lastSam(["S20", "S20", "S1"]); // Sam 41: not more than 41, strike 1; now you are lower (20 < 41)
  assert.equal(s.visit.strike, true);
  assert.equal(s.line, "41. Strike 1 for Sam. You to beat 20.");
  assert.deepEqual(play(u).struck, [0, 1]);
  visitBy(u, ["S20", "MISS", "MISS"]); // you 20: not more than 20, strike 1
  s = lastSam(["T20", "T20", "T20"]); // Sam 180: Sam had nothing to beat; you are lower: you must beat 20
  assert.deepEqual(play(u).struck, [1, 1]);
  visitBy(u, ["S5", "MISS", "MISS"]); // you 5: strike 2, out
  s = lastSam(["S1", "MISS", "MISS"]); // the round ends: Sam wins
  assert.equal(s.over, true);
  assert.equal(s.line, "1. Sam wins.");
  const res = E.summarize(sess(u));
  assert.deepEqual([res.won, res.winner, res.rounds, res.you.strikes, res.them.strikes, res.them.best], [0, 1, 4, 2, 1, 180]);
  const h = E.historyPayload(sess(u), T0 + MIN);
  assert.deepEqual(h.opponent, { name: "Sam", email: "sam@example.com" });
  assert.equal(JSON.stringify(h.settings).includes("sam@"), false, "the email isn't in the settings");
  assert.equal(E.personalBest([h], "scoremore2", { strikes: 2 }), null, "no best between two players");
  assert.deepEqual(d.historyCells(h), ["Lost", "Sam", "4"]);
});

test("Score More, two players: a tied round puts both on the spot, and both out at once is a draw", () => {
  const u = { uid: "me", undoStack: [] };
  u.activeSession = E.newSession("scoremore2", { strikes: 1 }, T0, "k4", { opponent: { email: "ash@example.com" } });
  assert.equal(sess(u).meta.opponent.name, "ash", "a name from the address when none is typed");
  visitBy(u, ["S20", "S20", "S20"]); visitBy(u, ["S20", "S20", "S20"]); // 60 each: both must beat 60
  assert.deepEqual(play(u).spot, [true, true]);
  visitBy(u, ["S20", "S20", "S20"]); visitBy(u, ["S20", "S20", "S20"]); // both 60 again: both strike out
  assert.equal(E.isFinished(sess(u)), true);
  const res = E.summarize(sess(u));
  assert.equal(res.draw, true);
  assert.equal(res.winner, null);
});

test("no drill keeps a list inside a list in its state (Firestore refuses to save one)", () => {
  const nested = (v) => Array.isArray(v) ? v.some((x) => Array.isArray(x) || nested(x)) : v && typeof v === "object" ? Object.values(v).some(nested) : false;
  for (const d of E.DRILLS) {
    const u = { uid: "me", undoStack: [] };
    u.activeSession = E.newSession(d.id, {}, T0, "kn", { opponent: { name: "Sam", email: "sam@example.com" } });
    for (let i = 0; i < 4 && !E.isFinished(sess(u)); i += 1) {
      if (d.input === "hits") E.manualVisit(u, sess(u), 1, T0 + i * 1000);
      else for (let k = 0; k < 3; k += 1) E.manualDart(u, sess(u), "S1", T0 + i * 1000 + k);
    }
    assert.equal(nested(u), false, d.id + " has a list inside a list");
  }
});
