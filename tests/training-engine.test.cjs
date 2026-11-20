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
