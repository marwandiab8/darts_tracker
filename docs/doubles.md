# Doubles

Finish every double, D1 to D20 and then the bull, against the clock (`doubles.html`). It was the separate "My Doubles Progress" app; its 177 rounds were imported on 2026-11-12 (marked `importedFrom: "mydoublesprogress"`), and the rules are the old app's, unchanged.

- **Rules and data:** `public/doubles-engine.js` (no DOM; its header explains the rules and the saved shapes). Tests: `tests/doubles-engine.test.cjs`.
- **The page:** `public/doubles.html`. **Board mode:** `public/doubles-board.js` (the Doubles parts) on the shared Board mode kit `public/board-mode.js` + `public/board-mode.css` (the board drawing, dart boxes, fix sheet, strip, buttons, voice warm-up and wake lock), which the tracker uses too.
- **Time Left:** each new finished round is sent once by `syncDoublesSessionToTimeLeft` (`functions/index.js`); imported rounds are skipped.

## Board mode

A full-screen scoreboard to read from the oche: the double you're on, huge; the board with this visit's darts; the three dart boxes; the 21 doubles; big buttons for when the cameras miss one. Turn it on with **Board mode** on the page; it stays on for that device (also after a reload) until **Exit**. Turning it on the first time also turns the **Voice** on.

- **One try per visit** (the old app's rule, and the buttons'): each visit at the board is one try at the double you're on. A dart in it is a hit on that dart; the visit's other darts don't count (the board says "Pull your darts out"), and the next double starts on dart 1 of 3. Three darts without a hit are a miss. Until 2026-11-12 the cameras counted darts straight through, so after a hit on dart 1 or 2 the rest of the visit went to the next double and it got fewer than 3 darts in the next visit; Marwan was tapping Miss to get past it.
- **The visit** is the darts since you last pulled them out (at most 3). Each box says what the dart counted as: a hit on dart N, a miss (inside the wire, just past it, next door in the 16, off the board), or a dart at the double you stayed on. Darts the cameras didn't see before the pull-out show as "Not seen, counted as a miss".
- **Fixing a dart:** tap it, on the board or its box, and pick what it was: a hit, the single, outside the wire, another number, or not a dart at all. The visit is scored again from just before its first dart, by the same camera rules, so a fix can do anything the cameras could have done (a miss that becomes a hit takes the miss back and moves on). A visit can be fixed until the next dart lands; after a tap on the buttons or an Undo it can't (use Undo, then tap).
- **Undo** goes back up to 10 steps (each logged visit, tap or fix is one), from any device. The steps are `doublesState.undoStack`; `lastUndo` is kept as the newest step for pages loaded before Board mode.
- **Voice:** after each change the round carries one line (`activeSession.say = { n, text }`): "D 7, dart 3. D 8.", "Missed D 7. D 8.", "All 21 done. 112 darts in 9 minutes 40." Every device with Voice on says each line once; lines from before the page opened aren't said. iPad Safari only speaks after a tap has started speech, so every tap warms the voice up until something is heard (as in `practice.html`).
- **The screen stays on** (wake lock) while a round runs in Board mode.

## Saved data

- `doublesState/{uid}`: `{ uid, activeSession, lifetime, lastUndo, undoStack, updatedAt }`. `activeSession.throws` is every camera dart of the round (`{ s: seq, k: the double thrown at, l: label, x, y, t, f: 1 if fixed by hand }`); `activeSession.cam.visit` is the visit on the board, with the state before its first dart (`cp`) to score it again from.
- `doublesSessions/{key}`: a finished round, with `throws` when the cameras were on (for the miss map). Rules allow up to 600 throws.

## Tests

- `npm test`: page checks, the engine, the functions and the rules (in the emulator).
- `npm run test:e2e` (or `E2E=doubles npm run test:e2e`): the real pages in headless Chrome against the Firestore and Auth emulators, with a pretend camera station (`tests/e2e/harness.cjs`). The doubles run: two devices, the iPad in Board mode with the voice on; camera darts counted once, a dart fixed by tapping it, three Undos from the other device, darts not seen at a pull-out, Board mode / Camera / Voice kept after a reload, the screen kept on, and a finished round saved with its throws.
- Screenshots: `firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/shots.cjs /some/folder"`.
- The emulator does not check composite indexes: every new query needs its index in `firestore.indexes.json` (including the descending one for `limitToLast`).
