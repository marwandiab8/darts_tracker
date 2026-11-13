# The tracker

Three darts at each number, 20 down to 1 and then the bull. Only the number thrown at counts; a miss uses up one of its three darts.

- **The page:** `public/index.html`. **The rules:** `public/tracker-engine.js` (tested in `tests/tracker-engine.test.cjs`). **Board mode:** the shared kit `public/board-mode.js` + `public/board-mode.css`, also used by Doubles.
- **Scoring:** standard counts S/D/T as 1/2/3 marks, the outer bull 1 and the bullseye 2. Singles counts hits.

## Board mode

A full-screen scoreboard to read from the oche. Turn it on with **Board mode** under Save. It stays on for that device, also after a reload, until **Exit**. Turning it on the first time also turns the **Voice** on.

- **The number to throw at**, huge, with "Dart 2 of 3" and the next three numbers. The board lights that number's treble and double, and the bull's two rings at the bull.
- **Pace**, under the dart count: after each number, your score so far against the average of your saved sessions at the same point and against your best session's ("After 17: 23 · avg 21.4 · PB pace 26"). Green when you're on PB pace, red when you're below your average. Partial sessions and the other game mode don't count.
- **Three dart boxes** say what each dart counted as: "T20 · Treble: 3 marks", "S1 · Next door, in the 1", "Miss · Off the board", "Not seen · Counted as a miss" (filled in at a pull-out), "Not read · Tap the board where it landed" (a dart the cameras saw but couldn't read). The board shows this visit's darts as numbered dots.
- **After a number's third dart** the screen says "Pull your darts out, then 19" and keeps that visit's darts showing until the pull-out (cameras) or the next dart.
- **Fixing a dart:** tap its box or its dot. The choices are Treble/Double/Single of that number (Bullseye/Outer bull at the bull), "A miss", and "Not a dart: remove it" (for a camera dart that wasn't one; the number gets that dart back). The number is scored again from its darts. A fixed camera dart is a note the cameras learn from (`board-learn.js`), with the dart moved into the bed you chose.
- **Big buttons:** Single, Double, Treble, Miss (at the bull: Outer bull, Bullseye, Miss) enter a dart at the number being thrown at. A tap on the board enters a dart where you tapped. **Undo (n)** goes back one change at a time, from any device.
- **The voice** says each dart ("Treble.", "Miss.") and, at a number's third dart, the visit and the running total: "20: treble, single, miss. 4 in all. Next, 19." Every device with Voice on says each line once; lines from before the page opened are skipped. The line is part of the shared session (`say: { id, text }`).
- **The recap** when all 21 numbers are done: the total against your average and best (or "A new best!"), darts hit, trebles and doubles, the numbers that went better than usual, and the three to practise next (the lowest hit rate over this session and your last 10). **Save the session** saves it.
- **The screen stays on** (wake lock) while a session runs in Board mode.

## What a session keeps

The session being entered is shared between devices in `liveSessions/{uid}` (see `live-sync.js` and the comments at the top of `tracker-engine.js`). Besides the entry, the dots and the darts thrown at each number, it keeps every dart in order, misses included (`darts`), whether the darts were pulled out since the last one (`pulled`), and the latest voice line (`say`). Pages from before these were shared ignore them, and `dartsOf()` rebuilds a number's darts from its entry when the list doesn't match.

A saved session (`sessions/{id}`) also has, since Nov 13, 2026:
- `throws`: every dart in order, `{ t, r, l, x?, y?, seq?, src, f? }`: the number thrown at, what it counted as (`S`/`D`/`T`, `-` a miss), what it landed in (`T20`, `S1`, `SB`, `DB`, `MISS`, or empty when not known), where (fractions of the board's radius, misses included), the cameras' count, where it came from (`cam`, `tap`, `btn`, `typed`, `unseen`), and `f: 1` when fixed by hand. Loading a saved session brings its darts back.
- `startedAtMs`: when its first dart went in.

## The cameras

See [camera-scoring.md](camera-scoring.md): a visit belongs to the number at its first dart; a pull-out fills that number's unseen darts as misses; a dart after its number has three isn't counted; a 4th dart without a pull-out starts the next visit.

## Tests

- `node --test tests/tracker-engine.test.cjs`: the rules, every dart kept, the buttons, fixing and removing a dart, the Board view, pace, the recap, the voice lines, throws.
- `E2E=tracker npm run test:e2e`: `tracker.e2e.cjs` (two devices, the cameras' visits, typed rows, taps at the same moment, Save, Load) and `tracker-board.e2e.cjs` (Board mode on an iPad with the cameras and a computer following: each dart's box, a dart that couldn't be read tapped on the board, a fix, Undo from the computer, the buttons, the bull's buttons, the voice on the iPad only, pace, the recap, Save with throws, a reload keeping Board mode, the cameras and the voice, the wake lock).
