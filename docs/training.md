# Training

Practice drills aimed at 501 (`training.html`, "Training" in the navigation): scoring, doubles and checkouts, pressure. One engine runs every drill; each drill is configuration plus pure functions, so a new drill is mostly a new entry in the registry. Phase 1 (2026-11-19) has the engine, the page, Board mode and the first drill, **Bob's 27**. The plan for the rest is `docs/training-world-class-prompt.md`.

- **Rules and data:** `public/training-engine.js` (`window.TrainingEngine`, no DOM; its header explains the drill interface, the camera visit rules and the saved shapes). Tests: `tests/training-engine.test.cjs`.
- **The page:** `public/training.html`. **Board mode:** `public/training-board.js` on the shared kit `public/board-mode.js` + `.css`.
- **Checkouts:** the engine's `checkoutRoute`, `checkoutTable` (every finish 2 to 170 for 1, 2 and 3 darts), `BOGEY` and `PREFERRED_ROUTES` (routes to prefer over the solver's, as data: edit the object). The solver is the bot game's (`practice-engine.js`); there is no second one. The tests check that every route adds up, ends on a double or the bull and fits the darts left, and that the bogey numbers have no 3-dart finish.

## Bob's 27

Start on 27. Three darts at each double, D1 to D20, then the bullseye. Each hit adds the double's value; three misses subtract it. Over at 0 or below (setting: play on). Settings: starting score, play on below zero, say the score. The personal best is the final score among finished rounds with the same starting score and play-on setting.

**With the cameras:** a visit is 3 darts at the double you are on, and nothing ends it early. The 3rd dart scores the visit; a 4th dart before the take-out is not counted ("pull your darts out"), so one bad visit never shifts the ones after it; at the take-out, darts the cameras did not see are misses at that visit's double. The bull is the bullseye only (the outer bull is a miss). Each dart is counted once across devices (`cam.seq` inside the transaction).

**By hand:** No hits / 1 hit / 2 hits / 3 hits (the keys 0 to 3 on a keyboard). A tap decides the visit; the cameras' darts held for it are dropped.

**Fixing a dart:** tap it, on the board or in its box, and pick what it was (the double, the single inside the wire, the triple, outside the wire, another number, not a dart). The visit is scored again from just before its first dart, by the same rules. Possible until the next visit's first dart lands, or Undo or a tap on the buttons.

**Undo** takes back one visit at a time, up to 10, from any device (`trainingState.undoStack`, a snapshot per step). Undoing the finishing visit un-finishes the drill and takes the saved round out of history; finishing again saves it again.

**The voice** (per device, on when Board mode is first turned on): "D 3. Two hits. 33. Next, D 4." Short, with a stop between sentences; the score can be left out in the settings; always "triple", never "treble".

**Moments:** three in a double, on to the bull, all 21 done, below zero, a new best (with the old best).

**Pace:** the score against your best round's score at the same double, shown on the page and in Board mode.

## Saved data

- `trainingState/{uid}`: `{ uid, activeSession, undoStack, bests, updatedAt }`. The drill in play, or just finished (it stays until Play again, Another drill or Stop, so Undo can still take its last visit back). `bests` is keyed by `drill.pbKey(settings)` (`bobs27:27:stop`), with the best's key, session key and `result.trail` for the pace. Every change is a transaction (`transact()` in the page), as `doublesState`: the camera darts' seq and the undo steps live in the document, so a dart is counted once however many devices listen.
- `trainingSessions/{sessionKey}`: a finished drill, or one stopped part way (`complete: false`, never in stats or bests): `uid, drill, drillVersion, settings, result, key, throws, startedAtMs, endedAtMs, activeMs, timestamp ("YYYY-MM-DD HH:MM"), localDate, complete, planRunId?, createdAt`. `throws` is every dart, misses included, in the tracker's shape plus the visit and target: `{ v, t, k, r, l, x, y, seq, src: "cam" | "btn" | "unseen", f, h }`. Owner only; a save tried again overwrites the same document.
- Indexes: `trainingSessions` on `uid + startedAtMs` and `uid + drill + startedAtMs`, ascending and descending (the history list uses `limitToLast`).

## Still to do (later phases)

Phase 2 the checkout drills (121 Checkout Ladder, Two-Dart Finishes), Phase 3 the scoring drills (Triple 20 Marathon, Big Triples, Game of 9), Phase 4 pressure and warm-up (Invisible Man, Score More, Warm-up), Phase 5 stats (`trainingStats` in `stats-engine.js`, the merged doubles and triples, the streak and records, today's plan), practice plans with presets, CSV export, "How to play" polish. Training sessions are not sent to Time Left yet (a Phase 0 question).

## Tests

- `npm test`: page checks (`training.html`, `training-engine.js`, `training-board.js` are in `scripts/check-app.cjs`), the engine, the functions and the rules (`trainingState`, `trainingSessions`).
- `E2E=training npm run test:e2e`: the real page on two devices (a computer, an iPad in Board mode with the voice) against the emulators with a pretend camera station: each dart counted once, a visit scored on its 3rd dart, a 4th dart not counted, fixing a dart, Undo from the other device, unseen darts at the take-out, a reload mid-drill, the finish saved once with the best, Undo after the finish, Play again, Stop.
- Screenshots: `firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/training-shots.cjs /some/folder"` (picker, the board at four sizes, the fix sheet, a moment, the results).
