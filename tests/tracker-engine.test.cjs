// The tracker's rules (public/tracker-engine.js): three darts at each number, 20 down to the bull,
// the cameras' visits, typed rows, Undo, and what a session needs before it counts in the stats.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../public/tracker-engine.js");

const hit = (target, ring, x = 0.1, y = -0.4) => ({ target, ring, x, y });
const cam = (seq) => ({ seq, label: "?", x: 0, y: 0 });
const row = (s, t) => s.entry[t].join("");

test("darts go to the number being thrown at, three each, 20 down to the bull", () => {
  const s = E.blank();
  assert.equal(E.aimOf(s), "20");
  E.addDart(s, hit("20", "T"));
  E.addDart(s, hit("5", "S"));      // next door: a miss for 20
  E.addDart(s, null);               // off the board: a miss
  assert.equal(row(s, "20"), "T--");
  assert.equal(E.dartsAt(s, "20"), 3);
  assert.equal(E.aimOf(s), "19");
  for (const t of E.TARGETS.slice(1)) for (let k = 0; k < 3; k += 1) E.addDart(s, hit(t, "S"));
  assert.equal(E.aimOf(s), null);
  assert.equal(E.addDart(s, hit("20", "S")), null, "nothing left to throw at");
  assert.equal(E.totalOf(s.entry, "standard"), 3 + 20 * 3);
  assert.deepEqual(E.progress(s).missing, []);
});

test("scoring: S/D/T are 1/2/3, the bull's outer 1 and inner 2; singles counts hits", () => {
  assert.equal(E.rowScore(["T", "D", "S"], "standard"), 6);
  assert.equal(E.rowScore(["T", "D", "S"], "single"), 3);
  assert.equal(E.rowScore(["B", "-", "-"], "standard"), 1);
  assert.equal(E.rowScore(undefined, "standard"), 0);
});

test("bug 3: a typed row moves the aim on, so the board's next darts go to the next number", () => {
  const s = E.blank();
  E.typeRow(s, "20", ["S", "-", "-"], true);
  assert.equal(E.aimOf(s), "19", "20 was typed in: its darts are done");
  E.addDart(s, hit("19", "D"));
  assert.equal(row(s, "19"), "D--");
  assert.equal(row(s, "20"), "S--");
  // An emptied row is open again.
  E.typeRow(s, "20", ["-", "-", "-"], false);
  assert.equal(E.aimOf(s), "20");
  // Typing a "-" (no hits) still means its darts were thrown.
  E.typeRow(s, "20", ["-", "-", "-"], true);
  assert.equal(E.aimOf(s), "19");
});

test("typing in one row makes one undo step; Undo puts the row back", () => {
  const s = E.blank();
  E.addDart(s, hit("20", "T"));
  E.typeRow(s, "19", ["S", "-", "-"], true);
  E.typeRow(s, "19", ["S", "D", "-"], true);
  assert.equal(s.undo.length, 2);
  E.undo(s);
  assert.equal(row(s, "19"), "---");
  assert.equal(E.dartsAt(s, "19"), 0);
  assert.equal(row(s, "20"), "T--");
});

test("Undo takes back a dart with its dot", () => {
  const s = E.blank();
  E.addDart(s, hit("20", "T", 0.01, -0.58));
  E.addDart(s, hit("20", "S", 0.02, -0.3));
  assert.deepEqual(s.positions["20"][1], { x: 0.02, y: -0.3 });
  const step = E.undo(s);
  assert.equal(step.target, "20");
  assert.equal(row(s, "20"), "T--");
  assert.equal(s.positions["20"][1], null);
  assert.equal(E.dartsAt(s, "20"), 1);
  assert.deepEqual(s.last, { target: "20", ring: "T", x: 0.01, y: -0.58 });
});

test("cameras: a visit's darts go to the number at its first dart; a pull-out fills only that number", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), cam(1));
  E.cameraDart(s, hit("1", "S"), cam(2));
  // The third dart bounced out: the pull-out makes it a miss at 20.
  const out = E.cameraTakeout(s, cam(3));
  assert.deepEqual(out.filled, { target: "20", unseen: 1 });
  assert.equal(E.aimOf(s), "19");
  assert.equal(s.camVisit, null);
  // A pull-out with nothing in progress changes nothing.
  assert.deepEqual(E.cameraTakeout(s, cam(4)), { filled: null });
  assert.equal(E.aimOf(s), "19");
});

test("bug 1: after a tapped dart mid-visit, a pull-out doesn't fill the next number with misses", () => {
  const s = E.blank();
  // Dart 1 at 20 tapped (the cameras were off, or missed it), then the cameras see darts 2 and 3.
  E.addDart(s, hit("20", "S"));
  E.cameraDart(s, hit("20", "T"), cam(10));
  E.cameraDart(s, hit("20", "S"), cam(11));
  assert.equal(E.aimOf(s), "19");
  E.cameraTakeout(s, cam(12));
  assert.equal(E.dartsAt(s, "19"), 0, "19 untouched: nobody threw at it yet");
  // The next visit is at 19, all three counted there.
  E.cameraDart(s, hit("19", "S"), cam(13));
  E.cameraDart(s, hit("19", "S"), cam(14));
  E.cameraDart(s, hit("19", "D"), cam(15));
  E.cameraTakeout(s, cam(16));
  assert.equal(row(s, "19"), "SSD");
  assert.equal(E.aimOf(s), "18");
});

test("bug 1: a 4th camera dart without a pull-out starts the next visit; it can't shift later visits", () => {
  const s = E.blank();
  ["S", "S", "S"].forEach((r, i) => E.cameraDart(s, hit("20", r), cam(20 + i)));
  // The pull-out was never seen: the next visit's first dart.
  const r = E.cameraDart(s, hit("19", "T"), cam(23));
  assert.equal(r.dart.aim, "19");
  assert.equal(r.closed, null, "20 was done: nothing to fill");
  // Only one dart seen at 19, then the darts come out: two misses at 19, and 18 is next.
  E.cameraTakeout(s, cam(24));
  assert.equal(row(s, "19"), "T--");
  assert.equal(E.aimOf(s), "18");
});

test("bug 2: a visit the cameras couldn't read is filled when the next visit starts, not shifted", () => {
  const s = E.blank();
  // Three darts at 20, none readable: no pull-out is ever reported for darts the station can't see.
  E.cameraUnreadable(s, cam(30));
  E.cameraUnreadable(s, cam(31));
  E.cameraUnreadable(s, cam(32));
  assert.equal(E.aimOf(s), "20", "still waiting for taps");
  // The next visit (at 19): 20's three darts are misses, and the dart counts at 19.
  const r = E.cameraDart(s, hit("19", "S"), cam(33));
  assert.deepEqual(r.closed, { target: "20", unseen: 3 });
  assert.equal(r.dart.aim, "19");
  assert.equal(row(s, "19"), "S--");
  // Undo twice: the dart, then the misses (the visit is waiting again).
  E.undo(s); E.undo(s);
  assert.equal(E.dartsAt(s, "20"), 0);
  assert.equal(s.camVisit.unread, 3);
});

test("an unreadable dart tapped in fills its slot; the pull-out then has nothing to fill", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), cam(40));
  E.cameraUnreadable(s, cam(41));
  E.addDart(s, hit("20", "T"));       // the tap for the unreadable one
  E.cameraDart(s, hit("20", "S"), cam(42));
  assert.equal(row(s, "20"), "STS");
  assert.deepEqual(E.cameraTakeout(s, cam(43)), { filled: null });
  assert.equal(E.aimOf(s), "19");
});

test("each camera event goes in once, whichever device saw it", () => {
  const s = E.blank();
  assert.ok(E.cameraDart(s, hit("20", "S"), cam(50)));
  assert.equal(E.cameraDart(s, hit("20", "S"), cam(50)), null);
  assert.equal(E.cameraTakeout(s, cam(49)), null);
  assert.equal(row(s, "20"), "S--");
});

test("Undo of a visit's first camera dart leaves no visit behind (a pull-out then fills nothing)", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), cam(60));
  E.undo(s);
  assert.equal(s.camVisit, null);
  assert.deepEqual(E.cameraTakeout(s, cam(61)), { filled: null });
  assert.equal(E.dartsAt(s, "20"), 0);
});

test("Undo of a pull-out's misses opens the visit again", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), cam(70));
  E.cameraTakeout(s, cam(71));
  assert.equal(E.aimOf(s), "19");
  E.undo(s);
  assert.equal(E.aimOf(s), "20");
  assert.deepEqual(s.camVisit, { aim: "20", seen: 1, unread: 0 });
  E.cameraDart(s, hit("20", "D"), cam(72));
  assert.equal(row(s, "20"), "SD-");
});

test("undo steps written by an older page (no prevVisit) still undo", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), cam(80));
  delete s.undo[0].prevVisit;
  E.undo(s);
  assert.equal(row(s, "20"), "---");
});

test("the undo list keeps the last 30 changes", () => {
  const s = E.blank();
  for (let k = 0; k < 40; k += 1) E.addDart(s, hit(E.aimOf(s), "S"));
  assert.equal(s.undo.length, E.UNDO_MAX);
});

test("a session id is made once; Clear starts a new session with a new one", () => {
  const s = E.blank();
  let n = 0;
  const make = () => `sid${(n += 1)}`;
  assert.equal(E.ensureSid(s, make), "sid1");
  assert.equal(E.ensureSid(s, make), "sid1");
  E.clear(s);
  assert.equal(s.sid, null);
  assert.equal(E.ensureSid(s, make), "sid2");
});

test("bug 4: a loaded session keeps its id and timestamp; every number counts as thrown", () => {
  const s = E.blank();
  E.load(s, { id: "abc", timestamp: "2026-11-03 14:20", entry: { 20: ["T", "-", "-"], BULL: ["D", "-", "-"] }, positions: { 20: [{ x: 0, y: -0.58 }, null, null] } });
  assert.deepEqual(s.loaded, { id: "abc", timestamp: "2026-11-03 14:20", date: "2026-11-03", time: "14:20", complete: true });
  assert.equal(E.aimOf(s), null);
  assert.equal(s.sid, null);
  assert.equal(E.ensureSid(s, () => "new"), null, "Save updates the loaded one, never a new id");
  assert.equal(E.totalOf(s.entry, "standard"), 5);
  E.clear(s);
  assert.equal(s.loaded, null);
});

test("bug 9: progress says when a session is partial or empty", () => {
  const s = E.blank();
  assert.equal(E.progress(s).empty, true);
  E.addDart(s, hit("20", "S"));
  let p = E.progress(s);
  assert.equal(p.empty, false);
  assert.equal(p.complete, false);
  assert.equal(p.done, 0);
  assert.equal(p.missing.length, 21);
  assert.equal(E.countsInStats({ complete: false }), false);
  assert.equal(E.countsInStats({}), true, "old sessions (no field) count as before");
  assert.equal(E.countsInStats({ complete: true }), true);
});

test("bug 10: a session's date from any kind of timestamp", () => {
  assert.equal(E.dateOf("2026-11-03 14:20"), "2026-11-03");
  assert.equal(E.dateOf("2026-11-03"), "2026-11-03");
  assert.equal(E.dateOf(Date.UTC(2026, 10, 3, 12)), "2026-11-03");
  assert.equal(E.dateOf({ seconds: Date.UTC(2026, 10, 3, 12) / 1000 }), "2026-11-03");
  assert.equal(E.dateOf(null), null);
  assert.equal(E.dateOf("rubbish"), null);
});

test("normalize keeps old shared sessions working", () => {
  const s = E.normalize({ entry: { 20: ["S", "-", "-"] }, thrown: { 20: 2 } });
  assert.equal(row(s, "19"), "---");
  assert.equal(s.camVisit, null);
  assert.equal(E.dartsAt(s, "20"), 2);
  assert.equal(E.cleanVisit({ aim: "nope" }), null);
});

test("bug 1: a dart both tapped and seen doesn't push the rest of the visit into the next number", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), cam(90));
  E.addDart(s, hit("20", "S"));                 // tapped as well, thinking the cameras missed it
  E.cameraDart(s, hit("20", "T"), cam(91));     // 20 now has its three darts
  const r = E.cameraDart(s, hit("20", "S"), cam(92));
  assert.deepEqual(r.spare, { aim: "20" }, "the visit's 3rd dart isn't counted anywhere");
  assert.equal(E.dartsAt(s, "19"), 0);
  E.cameraTakeout(s, cam(93));
  assert.equal(E.dartsAt(s, "19"), 0, "no misses at 19: nobody threw at it");
  ["S", "S", "S"].forEach((ring, i) => E.cameraDart(s, hit("19", ring), cam(94 + i)));
  assert.equal(row(s, "19"), "SSS");
  assert.equal(E.aimOf(s), "18");
});
