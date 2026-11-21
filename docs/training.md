# Training

Practice drills aimed at 501 (`training.html`, "Training" in the navigation): scoring, doubles and checkouts, pressure. One engine runs every drill; each drill is configuration plus pure functions, so a new drill is mostly a new entry in the registry. Phase 1 (2026-11-19) has the engine, the page, Board mode and the first drill, **Bob's 27**. Phase 2 (2026-11-20) adds the checkout drills, **121 Checkout Ladder** and **Two-Dart Finishes**, and with them darts entered one at a time (the cameras, a tap on the board, the route's buttons, Miss, or any dart from a list) and visits that end early on a checkout or a bust. Phase 3 (2026-11-20) adds the scoring drills, **Triple 20 Marathon**, **Big Triples** and **Game of 9**. The plan for the rest is `docs/training-world-class-prompt.md`.

Two kinds of input: `input: "hits"` (Bob's 27: how many of the 3 darts went in) and `input: "darts"` (the checkout drills: one dart at a time). The engine's header lists the drill interface.

- **Rules and data:** `public/training-engine.js` (`window.TrainingEngine`, no DOM; its header explains the drill interface, the camera visit rules and the saved shapes). Tests: `tests/training-engine.test.cjs`.
- **The page:** `public/training.html`. **Board mode:** `public/training-board.js` on the shared kit `public/board-mode.js` + `.css`.
- **Checkouts:** the engine's `checkoutRoute`, `checkoutTable` (every finish 2 to 170 for 1, 2 and 3 darts), `BOGEY` and `PREFERRED_ROUTES` (routes to prefer over the solver's, as data: edit the object). The solver is the bot game's (`practice-engine.js`); there is no second one. The tests check that every route adds up, ends on a double or the bull and fits the darts left, and that the bogey numbers have no 3-dart finish.

## Triple 20 Marathon

Hit T20 (or T19, T18, T17) a set number of times, 10 by default (5 for a quick one). The result is the darts it took: fewer is better. The live rate and the pace against the best run (darts at the same triple count) are shown all the time. The last triple ends the drill on that dart: darts after it in the visit are not counted. Unseen darts at the take-out are misses. By hand: how many of the 3 went in (with one triple left, "2 hits" counts one dart). PB: fewest darts, per triple and count.

## Big Triples

A set number of darts (9, in visits of 3) at each number in turn (T20, T19, T18, T17, or another set). The score is the triples hit; the count for each number is kept, with the pace against the best round (triples after the same visit). A visit never spans two numbers; unseen darts at the take-out are misses at that visit's number. PB: triples hit, per darts-per-number and set.

## Game of 9

Nine darts at the whole number, any ring, 20 down to 15, then the bull (either ring). Reach the pass mark to move on; miss it and the number starts again. Defaults from his numbers: 7 of 9 for the numbers, 4 of 9 at the bull (9 and 9 is the strict game). A number given up after the set number of tries (6) is skipped. The score is the darts for the run; PB (fewest darts) only for a run with every number passed (`result.runDarts`, null otherwise, so it never sets a best). Tries and darts per number are kept, and the trail of darts at each number passed for the pace.

## Bob's 27

Start on 27. Three darts at each double, D1 to D20, then the bullseye. Each hit adds the double's value; three misses subtract it. Over at 0 or below (setting: play on). Settings: starting score, play on below zero, say the score. The personal best is the final score among finished rounds with the same starting score and play-on setting.

**With the cameras:** a visit is 3 darts at the double you are on, and nothing ends it early. The 3rd dart scores the visit; a 4th dart before the take-out is not counted ("pull your darts out"), so one bad visit never shifts the ones after it; at the take-out, darts the cameras did not see are misses at that visit's double. The bull is the bullseye only (the outer bull is a miss). Each dart is counted once across devices (`cam.seq` inside the transaction).

**By hand:** No hits / 1 hit / 2 hits / 3 hits (the keys 0 to 3 on a keyboard). A tap decides the visit; the cameras' darts held for it are dropped.

**Fixing a dart:** tap it, on the board or in its box, and pick what it was (the double, the single inside the wire, the triple, outside the wire, another number, not a dart). The visit is scored again from just before its first dart, by the same rules. Possible until the next visit's first dart lands, or Undo or a tap on the buttons.

**Undo** takes back one visit at a time, up to 10, from any device (`trainingState.undoStack`, a snapshot per step). Undoing the finishing visit un-finishes the drill and takes the saved round out of history; finishing again saves it again.

**The voice** (per device, on when Board mode is first turned on): "D 3. Two hits. 33. Next, D 4." Short, with a stop between sentences; the score can be left out in the settings; always "triple", never "treble".

**Moments:** three in a double, on to the bull, all 21 done, below zero, a new best (with the old best).

**Pace:** the score against your best round's score at the same double, shown on the page and in Board mode.

## 121 Checkout Ladder

Start on 121. Count down with up to 3 visits of 3 darts, double out, as at the end of a leg. A bust (below zero, one left, or zero without a double) ends the visit and puts the score back to the start of that visit. A checkout moves the target up one; running out of darts moves it down one, never below the floor. A round is a set number of targets (10). Settings: starting target, lowest target (the classic floor is 100; a lower one keeps the finishes varied at his double rate), visits per target (1 to 3), targets in a round (3 to 30). PB: the highest target reached. Also kept: the final target, checked out of attempts, darts at a double and doubles hit, the best checkout (fewest darts), per-number tries and outs, the trail of targets (for the pace).

**The route** is shown at every dart, for the darts left: the engine's `checkoutRoute` (the bot game's solver with `PREFERRED_ROUTES` first), as the big chips in Board mode and on the page.

**With the cameras:** a visit is the darts since the take-out, up to 3; a checkout or a bust ends it on that dart, and darts after it before the take-out are not counted (the Nov 18 rule). Darts the cameras did not see at the take-out are misses (no score), unless the visit had already ended. **By hand:** the route's darts and Miss as buttons, any dart from a list on the page, or a tap on the board in Board mode (where it landed, classified by `BoardVision`). A visit entered wholly by hand needs no take-out: the next dart starts the next visit. A visit with a camera dart in it waits for the darts to come out. **Fixing** an x01 dart offers the route's dart, the beds of the number it landed in, a miss, another number (with its ring), or remove; the visit is scored again from before its first dart, so a dart that was a bust can become live again and darts after a new bust become "not counted".

**The voice:** "60. You require 61." / "Bust. You require 121." / "Game shot. 121 in 7 darts. Up to 122." / "2. Not this time. Down to 120." **Moments:** a game shot, a new high ("Up to 123"), the end with the highest target.

## Two-Dart Finishes

Every number from 61 to 70 (settable), two darts each, in order or shuffled (the shuffle is fixed by the start time, so every device agrees), once or up to five times through. A try is scored in parts: the first dart leaving a double is a **setup hit**; the second dart is at that double; a finish is an **out**. Kept per number: tries, outs, setups; and the rates (finish %, setup %, double % when on a double). PB: finishes in the round. A first dart that busts ends the try; the second dart always ends it (anything but the finish is a miss). A third dart before the take-out is not counted; the take-out after one dart makes the other a miss. The route is shown before the first dart and again for what is left after it ("No finish" when the first dart left no double).

**The voice:** "61. Game shot. Next, 62." / "63. Left D 12. Missed. Next, 64." / "62. Setup missed. Next, 63." / "... Done. 1 finish."

## Saved data

- `trainingState/{uid}`: `{ uid, activeSession, undoStack, bests, updatedAt }`. The drill in play, or just finished (it stays until Play again, Another drill or Stop, so Undo can still take its last visit back). `bests` is keyed by `drill.pbKey(settings)` (`bobs27:27:stop`), with the best's key, session key and `result.trail` for the pace. Every change is a transaction (`transact()` in the page), as `doublesState`: the camera darts' seq and the undo steps live in the document, so a dart is counted once however many devices listen.
- `trainingSessions/{sessionKey}`: a finished drill, or one stopped part way (`complete: false`, never in stats or bests): `uid, drill, drillVersion, settings, result, key, throws, startedAtMs, endedAtMs, activeMs, timestamp ("YYYY-MM-DD HH:MM"), localDate, complete, planRunId?, createdAt`. `throws` is every dart, misses included, in the tracker's shape plus the visit and target: `{ v, t, k, r, l, x, y, seq, src: "cam" | "btn" | "unseen", f, h, p }` (`h` a hit or a game shot, `p` the points an x01 dart scored; in the checkout drills `t` is the score required at the start of the visit and `k` the attempt or try). Owner only; a save tried again overwrites the same document. The `drill` field says which drill: `marathon`, `bigtriples`, `gameof9`, `bobs27`, `ladder121`, `twodart`.
- Indexes: `trainingSessions` on `uid + startedAtMs` and `uid + drill + startedAtMs`, ascending and descending (the history list uses `limitToLast`).

## Still to do (later phases)

Phase 4 pressure and warm-up (Invisible Man, Score More, Warm-up), Phase 5 stats (`trainingStats` in `stats-engine.js`, the merged doubles and triples, the streak and records, today's plan), practice plans with presets, CSV export, "How to play" polish. Training sessions are not sent to Time Left yet (a Phase 0 question).

## Tests

- `npm test`: page checks (`training.html`, `training-engine.js`, `training-board.js` are in `scripts/check-app.cjs`), the engine, the functions and the rules (`trainingState`, `trainingSessions`).
- `E2E=training-checkouts npm run test:e2e` (`tests/e2e/training-checkouts.e2e.cjs`): the ladder and the two-dart drill on two devices with the pretend station: the route at every dart, a checkout on the 3rd dart, a dart after it not counted, a bust, a dart fixed on the iPad into a checkout, Undo from the computer, darts by hand with no take-out, a reload, Stop; two darts a try, a setup and the double, a third dart not counted, the take-out ending a try with a dart unseen.
- Screenshots of the checkout drills: `tests/e2e/training-checkout-shots.cjs` (same invocation).
- `E2E=training-scoring npm run test:e2e` (`tests/e2e/training-scoring.e2e.cjs`): the marathon with the cameras ending on the last triple mid-visit and saved with its best, the pace against it, Big Triples by hand and with darts unseen at the take-out, Game of 9 passing a number; screenshots: `tests/e2e/training-scoring-shots.cjs`.
- `E2E=training npm run test:e2e`: the real page on two devices (a computer, an iPad in Board mode with the voice) against the emulators with a pretend camera station: each dart counted once, a visit scored on its 3rd dart, a 4th dart not counted, fixing a dart, Undo from the other device, unseen darts at the take-out, a reload mid-drill, the finish saved once with the best, Undo after the finish, Play again, Stop.
- Screenshots: `firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/training-shots.cjs /some/folder"` (picker, the board at four sizes, the fix sheet, a moment, the results).
