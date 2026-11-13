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

// ---- Phase 2: every dart kept, Board mode, fixing a dart, pace, the recap, the voice, saving -----

test("every dart is kept in order, misses included, with where it landed", () => {
  const s = E.blank();
  E.addDart(s, null, { cam: { seq: 1, label: "MISS", x: 1.1, y: 0 } }); // off the board, seen by the cameras
  E.addDart(s, hit("20", "T", 0, -0.58));
  E.buttonDart(s, "-");
  assert.deepEqual(E.dartsOf(s, "20").map((d) => [d.r, d.l, d.src]), [["-", "MISS", "cam"], ["T", "T20", "tap"], ["-", "", "btn"]]);
  assert.equal(E.dartsOf(s, "20")[0].x, 1.1, "a miss keeps its position");
  assert.equal(row(s, "20"), "T--", "the entry is unchanged: hits first");
  const t = E.throwsFor(s);
  assert.equal(t.length, 3);
  assert.deepEqual(t[0], { t: "20", r: "-", l: "MISS", src: "cam", x: 1.1, y: 0, seq: 1 });
});

test("buttons: S/D/T/miss at the number being thrown at; no treble at the bull", () => {
  const s = E.blank();
  E.buttonDart(s, "D"); E.buttonDart(s, "S"); E.buttonDart(s, "-");
  assert.equal(row(s, "20"), "DS-");
  for (const t of E.TARGETS.slice(1, 20)) for (let k = 0; k < 3; k += 1) E.buttonDart(s, "-");
  assert.equal(E.aimOf(s), "BULL");
  assert.equal(E.buttonDart(s, "T"), null);
  E.buttonDart(s, "D");
  assert.deepEqual(E.dartsOf(s, "BULL").map((d) => d.l), ["DB"]);
});

test("dartsOf makes up the darts from the entry when a page without them wrote the session", () => {
  const s = E.normalize({ entry: { "20": ["T", "S", "-"] }, thrown: { "20": 3 }, positions: { "20": [{ x: 0, y: -0.58 }, null, null] } });
  const d = E.dartsOf(s, "20");
  assert.deepEqual(d.map((x) => [x.r, x.src]), [["T", "old"], ["S", "old"], ["-", "old"]]);
  assert.equal(d[0].x, 0);
  // A kept list that no longer matches the entry (an old page changed the row) isn't used.
  s.darts["20"] = [{ r: "D", l: "D20", src: "cam" }, { r: "-", l: "S1", src: "cam" }, { r: "-", l: "", src: "cam" }];
  assert.equal(E.dartsOf(s, "20")[0].r, "T");
});

test("fixing a dart scores its number again from its darts, and Undo takes the fix back", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S", 0, -0.7), { seq: 1, label: "S20", x: 0, y: -0.7 });
  E.cameraDart(s, hit("1", "S", 0.2, -0.7), { seq: 2, label: "S1", x: 0.2, y: -0.7 });
  E.cameraDart(s, hit("20", "S", 0, -0.75), { seq: 3, label: "S20", x: 0, y: -0.75 });
  assert.equal(row(s, "20"), "SS-");
  const out = E.fixDart(s, "20", 1, { ring: "T", label: "T20", x: 0.02, y: -0.58 });
  assert.equal(out.dart.l, "S1");
  assert.equal(row(s, "20"), "STS", "the fixed dart is a treble, in its place");
  assert.equal(E.dartsOf(s, "20")[1].f, 1);
  assert.equal(E.totalOf(s.entry, "standard"), 5);
  E.undo(s);
  assert.equal(row(s, "20"), "SS-");
  assert.equal(E.dartsOf(s, "20")[1].l, "S1");
});

test("a dart that wasn't a dart can be removed: its number gets the dart back", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), { seq: 1, label: "S20", x: 0.1, y: -0.4 });
  E.cameraDart(s, hit("20", "S"), { seq: 2, label: "S20", x: 0.1, y: -0.4 });
  E.cameraDart(s, null, { seq: 3, label: "MISS", x: 1.2, y: 0 });
  assert.equal(E.aimOf(s), "19");
  E.fixDart(s, "20", 2, { remove: true });
  assert.equal(E.aimOf(s), "20");
  assert.equal(s.camVisit.seen, 2, "the visit is waiting for its third dart again");
  E.cameraDart(s, hit("20", "T"), { seq: 4, label: "T20", x: 0, y: -0.58 });
  assert.equal(row(s, "20"), "SST");
});

test("Board mode shows the visit's darts, the next numbers, and the finished visit until the next dart", () => {
  const s = E.blank();
  E.addDart(s, hit("20", "T", 0, -0.58));
  let v = E.boardView(s, "standard");
  assert.equal(v.target, "20");
  assert.equal(v.dartNo, 2);
  assert.deepEqual(v.next, ["19", "18", "17"]);
  assert.deepEqual(v.darts.map((d) => d.read + "|" + d.sub), ["T20|Treble: 3 marks"]);
  E.addDart(s, hit("5", "S", -0.1, -0.7)); E.addDart(s, null);
  v = E.boardView(s, "standard");
  assert.equal(v.target, "19");
  assert.ok(v.pullOut, "after the third dart: pull your darts out");
  assert.deepEqual(v.darts.map((d) => d.read + "|" + d.sub), ["T20|Treble: 3 marks", "S5|Next door, in the 5", "Miss|Off the board"]);
  assert.equal(v.cells[0].state, "h1");
  assert.equal(v.cells[0].sub, "T––");
  assert.equal(v.cells[1].state, "current");
  E.addDart(s, hit("19", "D"));
  v = E.boardView(s, "standard");
  assert.ok(!v.pullOut);
  assert.deepEqual(v.darts.map((d) => d.read), ["D19"]);
});

test("Board mode with the cameras: unread darts wait for a tap, the pull-out shows the next number fresh", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), { seq: 1, label: "S20", x: 0.1, y: -0.4 });
  E.cameraUnreadable(s, { seq: 2 });
  let v = E.boardView(s, "standard");
  assert.equal(v.waiting.length, 1, "one dart they couldn't read, waiting for a tap");
  E.addDart(s, hit("20", "T", 0, -0.58)); // tapped
  v = E.boardView(s, "standard");
  assert.equal(v.waiting.length, 0);
  E.cameraTakeout(s, { seq: 3 });
  v = E.boardView(s, "standard");
  assert.equal(v.target, "19");
  assert.ok(!v.pullOut);
  assert.equal(v.darts.length, 0, "pulled out: the next number starts empty");
  assert.deepEqual(E.dartsOf(s, "20").map((d) => d.src), ["cam", "tap", "unseen"]);
  assert.equal(E.boardView(s, "standard").cells[0].sub, "ST–");
});

test("pace: after the numbers done, your score against your average and your best at the same point", () => {
  const h = [
    { entry: { "20": ["S", "-", "-"], "19": ["S", "S", "-"] }, total: 40, mode: "standard" },
    { entry: { "20": ["T", "S", "-"], "19": ["S", "-", "-"] }, total: 60, mode: "standard" },
    { entry: { "20": ["T", "T", "T"], "19": ["T", "T", "T"] }, total: 90, mode: "standard", complete: false }, // partial: not counted
    { entry: { "20": ["T", "T", "T"] }, total: 99, mode: "single" }, // the other game: not counted
  ];
  const s = E.blank();
  assert.equal(E.pace(s, h, "standard"), null);
  E.addDart(s, hit("20", "D")); E.addDart(s, null); E.addDart(s, null);
  const p = E.pace(s, h, "standard");
  assert.equal(p.k, 1);
  assert.equal(p.score, 2);
  assert.equal(p.avg, 2.5);
  assert.equal(p.pb, 4, "the best session (60) had 4 after the 20");
  assert.equal(p.pbTotal, 60);
});

test("the recap: total against your average and best, what went better, the three to practise", () => {
  const blankish = (over) => Object.assign(E.blankEntry(), over);
  const h = Array.from({ length: 12 }, () => ({ entry: blankish({ "20": ["S", "-", "-"], "19": ["S", "S", "S"], "BULL": ["-", "-", "-"] }), total: 4, mode: "standard" }));
  const s = E.blank();
  for (const t of E.TARGETS) for (let k = 0; k < 3; k += 1) E.addDart(s, t === "20" && k < 2 ? hit("20", "T") : t === "19" ? hit("19", "S") : null);
  const r = E.recap(s, h, "standard");
  assert.equal(r.total, 9);
  assert.equal(r.avg, 4);
  assert.equal(r.pb, 4);
  assert.ok(r.newPb);
  assert.equal(r.trebles, 2);
  assert.equal(r.hits, 5);
  assert.equal(r.darts, 63);
  assert.deepEqual(r.improved.map((x) => x.t), ["20"]);
  assert.deepEqual(r.practise.map((x) => x.t), ["18", "17", "16"], "never hit: the first three in order");
});

test("the voice: each dart's word, and a number's third dart says the visit and the total", () => {
  const s = E.blank();
  let d = E.addDart(s, hit("20", "T"));
  assert.equal(E.voiceLine(s, { k: "dart", aim: d.aim, dartNo: d.dartNo }, "standard"), "Treble.");
  E.addDart(s, hit("20", "S"));
  d = E.addDart(s, null);
  assert.equal(E.voiceLine(s, { k: "dart", aim: d.aim, dartNo: d.dartNo }, "standard"), "20: treble, single, miss. 4 in all. Next, 19.");
  assert.equal(E.voiceLine(s, { k: "dart", aim: "20", dartNo: 3 }, "single"), "20: hit, hit, miss. 2 in all. Next, 19.");
  const out = E.fixDart(s, "20", 2, { ring: "D", label: "D20" });
  assert.equal(E.voiceLine(s, { k: "fix", target: out.target, index: out.index }, "standard"), "Fixed: double.");
});

test("a loaded session gets its darts back from throws", () => {
  const s = E.blank();
  E.addDart(s, hit("20", "S")); E.addDart(s, hit("1", "S", 0.2, -0.7)); E.addDart(s, hit("20", "T"));
  const saved = { id: "x", timestamp: "2026-11-13 18:00", entry: s.entry, throws: E.throwsFor(s) };
  const t = E.blank();
  E.load(t, saved);
  assert.deepEqual(E.dartsOf(t, "20").map((d) => d.l), ["S20", "S1", "T20"]);
  assert.deepEqual(E.dartsOf(t, "19").map((d) => d.r), ["-", "-", "-"], "no darts saved: made up from the entry");
});

test("Undo of a fix doesn't bring back a camera visit that has ended since", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), { seq: 1, label: "S20", x: 0.1, y: -0.4 });
  E.cameraDart(s, hit("1", "S"), { seq: 2, label: "S1", x: 0.2, y: -0.4 });
  E.cameraDart(s, hit("20", "S"), { seq: 3, label: "S20", x: 0.1, y: -0.4 });
  E.fixDart(s, "20", 1, { ring: "D", label: "D20" });
  E.cameraTakeout(s, { seq: 4 });
  E.undo(s);
  assert.equal(s.camVisit, null, "the visit stays over");
  for (const r of ["T", "-", "S"]) E.buttonDart(s, r);
  const v = E.boardView(s, "standard");
  assert.equal(v.shown, "19");
  assert.deepEqual(v.darts.map((d) => d.read), ["T19", "Miss", "S19"]);
});

test("the dart the cameras couldn't read waits for a tap, even as the visit's third", () => {
  const s = E.blank();
  E.cameraDart(s, hit("20", "S"), { seq: 1, label: "S20", x: 0.1, y: -0.4 });
  E.cameraDart(s, hit("20", "S"), { seq: 2, label: "S20", x: 0.1, y: -0.4 });
  E.cameraUnreadable(s, { seq: 3 });
  assert.equal(E.boardView(s, "standard").waiting.length, 1);
});
