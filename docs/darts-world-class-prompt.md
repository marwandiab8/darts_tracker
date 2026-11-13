# Make the Darts Tracker world class: the tracker, the bot game and the JDC Challenge

You are working in `~/Documents/darts`: Darts Tracker, live at https://dartstracker2026.web.app (Firebase project `dartstracker2026`, GitHub `marwandiab8/darts_tracker`, branch `main`). Plain HTML pages with the Firebase compat SDK 10.13.1, no build step, game rules in UMD engines tested with `node --test`.

Marwan practises every day with three games besides Doubles:

| Game | Page | Engine |
|---|---|---|
| The tracker (3 darts at each number, 20 → 1 → bull) | `public/index.html` | inline in the page |
| The bot game (x01 and cricket against a computer, plus two-player versus) | `public/practice.html` | `public/practice-engine.js` |
| The JDC Challenge (Shanghai 10–15, every double and the bull, Shanghai 15–20) | `public/challenge.html` | `public/challenge-engine.js` |

In November we rebuilt **Doubles** (`public/doubles.html`) around a full-screen **Board mode**, and Marwan loves it.

**Your job:** give the other three games the same treatment, and go further. Each one should be:
- **Readable from the oche:** he can see at a glance what to throw at, what each dart counted as, and how he's doing.
- **Exciting to play:** big moments feel big, he's always chasing something, and there is real feedback after every visit.
- **Hands-free with the cameras:** a whole session or match goes in with no taps, and any misread is fixed with two taps.
- **Honest and useful in its stats:** every number is right, test games are left out, and each session ends with what improved and what to practise next.
- **Solid:** the bugs below get fixed first. Several of them corrupt saved history today.

Work in the phases below. Each phase must work on its own and come with tests. **Nothing is committed, pushed or deployed until Marwan says so.**

## How Marwan plays

- **The board and the iPad.** He throws at a real board. An iPad (Safari) stands by the board as the scoreboard, 2–3 m from the oche. He also uses a Windows PC and a Linux laptop, often with the same game open on two devices of one account.
- **The cameras.** Two USB cameras on the Linux laptop run `public/station.html`. It reads each dart (label, position, `seq`, an "uncertain" flag, a take-out when the darts are pulled) and passes it through Firestore (`cameraStations/{uid}/events/latest`) to every open page that has its cameras on. One camera cuts off the top of the board, so D20/D1-area reads are often flagged "uncertain".
- **What he wants:** to play the whole game standing at the oche, hearing and seeing everything, and only touching the iPad to fix a misread.

## His history (Firestore, read-only, as of 2026-11-12)

**Tracker (`sessions`)**
- **Volume:** 356 sessions from 2025-12-31 to 2026-11-12, on 199 days. 346 are "standard" scoring (59 have no `mode`, which means standard), 10 are "single", and 26 were imported from CSV.
- **Scores:** standard total median 55, best 75. The average of the first 30 was 53.7 and of the last 30 is 56.4.
- **Hit rate:** of 22,428 darts, 64.9% landed in the number thrown at; trebles were 10.5% of darts.
- **Weakest:** bull 34%, then 9, 3, 2 and 17 at about 63–64%.
- **Strongest:** 4, 13, 7, 18 and 19 at about 68–71%.
- **Gaps in the data:** only 49 sessions have dart positions and only 26 have a duration (median about 5 minutes). Misses aren't stored.

**Bot game (`botGames`)**
- **Volume:** 201 games from 2026-09-20 to 2026-11-12: 199 x01, 2 cricket. Every one was against the "club" level.
- **Results:** 84 won, 93 lost, 24 abandoned.
- **Finished x01 games (175):** median 3-dart average 52.1 (first 30: 52.3, last 30: 54.8), bot median 53.7, 82 won. A median game lasts about 3 minutes.
- **Test games:** all 22 games with an average over 90 come from a burst of test taps around noon on 2026-09-27, all abandoned. Those, and the regular T20-T20-T20 "180s" in them, must never reach stats or records.
- **Visits:** they aren't stored, only `playerDarts`/`botDarts` lists. There is one `versusGames` match against a friend, which holds names and emails; never show or export those beyond what the page does today.

**JDC Challenge (`challengeGames`)**
- **Volume:** 21 rounds from 2026-10-05 to 2026-11-08.
- **Scores:** median 673 of 3,330, best 1,019, worst 316. Part averages are 205 / 202 / 269.
- **Doubles part:** about 4 doubles hit out of 21 on average, and 2 Shanghais in all 21 rounds.
- **Time:** median about 6 minutes.

**Doubles, for the practice plan:** his weakest doubles per dart are the bull (10%), D6, D10, D8 and D14 (about 17%).

## Read these first

- **The reference:**
  - `public/doubles.html`, `public/doubles-engine.js`, `public/doubles-board.js`, `public/doubles-board.css` and `docs/doubles.md`, including how Board mode, fixing a dart, the undo steps, the voice and the cameras work.
  - `docs/doubles-world-class-prompt.md`: the plan that produced it.
- **The tracker:** `public/index.html` (2,143 lines, all its logic inline), `public/practice-timer.js` and `public/live-sync.js`.
- **The bot game:** `public/practice.html` (2,339 lines), `public/practice-engine.js`, `docs/bot-practice.md`, `docs/two-players.md`, `public/audio/calls/README.md` and `tests/practice-engine.test.cjs`.
- **The JDC Challenge:** `public/challenge.html`, `public/challenge-engine.js`, `docs/challenge.md` and `tests/challenge-engine.test.cjs`.
- **The cameras:** `public/board-camera.js` (`DartCamera.chooseWatcher`, events and their `index`), `public/board-vision.js`, `docs/camera-scoring.md` and `docs/dart-positions.md`.
- **Data and Time Left:**
  - `firestore.rules`: `validNewSession`, `botGames`, `versusGames`, `challengeGames`, `liveSessions`, `liveGames`, and the `hasOnly` lists.
  - `firestore.indexes.json` and `functions/index.js` (the Time Left mappings and the versus email).
- **Tests:** `tests/` (engine, rules, functions) and `tests/e2e/` (`harness.cjs`, `doubles.e2e.cjs`, `shots.cjs`).
- **Repo setup:** `package.json` scripts, `scripts/check-app.cjs` and `AGENTS.md`.

## What Doubles taught us (apply everywhere)

1. **Camera darts must follow each game's own visit rule.**
   - In Doubles the cameras first counted darts straight through, so after a hit on dart 1 or 2 the rest of the visit went to the next double. Marwan tapped Miss nine times in one game to get past it.
   - Every game's engine must say, in code and tests, exactly how a visit works with the cameras:
     - what counts;
     - when a visit ends early;
     - what a dart after the visit is over does;
     - what unseen darts at a take-out become, and at which target;
     - what a 4th dart without a take-out means.
   - Place each dart by the station's `e.index` where it helps. Never let one bad visit shift every later visit.
2. **Board mode is the design language.** Use:
   - a huge target;
   - an SVG board with the target lit and this visit's darts as numbered dots;
   - three dart boxes that say what each dart counted as ("Hit on dart 3", "Inside the wire", "Next door, in the 16", "Not seen, counted as a miss", "Not counted");
   - a strip of every target with its state;
   - big manual buttons;
   - "Pull your darts out" when a visit ends early.

   Reuse Doubles' Board mode code by **pulling the parts that aren't specific to Doubles into a shared module**, for example `public/board-mode.js` + `.css` (the board drawing with lit beds, dart boxes, fix sheet, strip, wake lock, voice). Then make Doubles use it too, with its e2e test still passing.
3. **Fixing a dart = replaying the visit.** Keep a snapshot of the state from just before the visit's first dart, and re-score the visit's darts through the same rules. It stays possible until the next visit starts.
4. **Undo goes back up to 10 steps, from any device.** Each step has an id (see `doublesState.undoStack`). Every change goes through a transaction or the versioned live-sync protocol, never a plain write.
5. **The voice.** Work out each change's line once and store it with the game (`say: { n, text }`). Every device with Voice on says each line once; lines from before the page opened are skipped. Use the iPad warm-up (Safari only speaks after one `speak()` inside a touchend or click). Voice, Cameras and Board mode are remembered on each device.
6. **Keep the screen awake** (wake lock) while a game runs in Board mode.
7. **Never use `alert()`/`confirm()` during play.** They freeze the iPad, scripts included. Show the message on the page.
8. **Composite indexes.** The Firestore emulator doesn't check them, so every new query needs its index in `firestore.indexes.json`, including the descending one for `limitToLast`/`desc`. Wait for READY after a deploy.
9. **CSS:** a `display` rule beats the `hidden` attribute, so add `[hidden] { display: none !important; }` inside every new component, or hidden panels swallow taps.
10. **Two devices writing at once** makes Firestore refuse one commit (a 400 that the SDK retries). That's normal. A refused write that silently drops the player's tap is not.

## What must not change

Old history must keep loading, scoring and charting exactly as now, and pages already open on another device must keep working while you roll out. **Add fields; never rename or reuse them.** Any new mode or variant gets its own field (`mode`/`variant`) and stays out of the classic stats and personal bests.

**Tracker**
- **The game:** 3 darts per number, 20 → 1 → bull. Only the number thrown at counts; a miss uses up a dart.
- **Scoring:** standard is S=1, D=2, T=3, with the outer bull 1 and the inner bull 2. Singles counts hits.
- **`sessions` fields:** `timestamp` stays the text `"YYYY-MM-DD HH:MM"` (it's the sort key and Time Left's date). `mode` is "standard" or "single", and a missing mode means standard. `entry` keeps keys "20"…"1" and "BULL", 3 slots each of `-/S/D/T/B` with hits first. `positions` stay as fractions of the drawn board's radius, lined up with the slots. `durationSec` stays as it is.
- **Pages already open elsewhere:** the `liveSessions` version protocol, the `v:1` state keys, `trackerCamSeq`, the camera notes, and the `dt_*` localStorage keys.

**Bot game**
- **Saved fields:** the `botGames`/`versusGames` field names and the `hasOnly` lists. Saved games are never updated, and the doc id is the gameId. Darts are `{x,y,s}` in app geometry, with `{s:"?"}` for darts typed on the keypad.
- **Formats:** the rank ids, the result words, the timestamp format and the Time Left mapping.
- **x01 rules:** a bust goes back to the score at the start of the visit. Under double out, leaving 1, or reaching 0 on a non-double, is a bust. The game stops on the winning dart. Average = points × 3 / darts.
- **Choices already made:** who throws first alternates each game; the cricket rules; the bot-checkout wait; Press Enter as one setting for the whole game.
- **Pages already open elsewhere:** the `liveGames` state shape, `visit.input`, `SNAPSHOT_FIELDS`, `camSeq`/`camDarts`, and the bot seed key. If the bot's dart model must change, version it so a page still on the old version mid-game doesn't throw different darts.
- **Audio:** the clip file names.

**JDC Challenge**
- **The round:** `STEPS` order and lengths, 57 darts, dart codes 0–3 (0/1 in the doubles part). The stats read old rounds by position.
- **Scoring:** a +100 Shanghai in any order, 50 per double, a maximum of 3,330, and part caps of 1,050 / 1,050 / 1,230.
- **`challengeGames`:** the field list, the timestamp format, create-only and owner-only.
- **Time Left:** "JDC Challenge: {total} / 3330".

## Review findings

Three detailed reviews found the items below (file:line references are from 2026-11-12). Reproduce each with a failing test before you fix it, because line numbers may have moved.

### Tracker (`index.html`)

**Bugs**
1. **A pull-out can fill the wrong number with misses** (around line 1526). It assumes the visit began on dart 1 of the current number, and ignores `e.index` and `takeout.darts`. After any typed or tapped dart mid-visit, or Camera turned on mid-number, every later visit is scored one number behind, for good.
2. **A visit where the cameras saw nothing never ends.** With three bounce-outs or unreadable darts there is no take-out, so the next visit fills the old number with misses and the session drifts.
3. **Typing a row doesn't move the aim on,** so the next board darts count against the typed number.
4. **Load, then Save, makes a duplicate session with today's date,** and a second Time Left item. Load also leaves the timer and the date as they were.
5. **`pendingSaveRef` survives Clear.** After a save that timed out, the next session overwrites the first.
6. **Taps and Undo can vanish.** `adoptDraft` cancels the pending write, and `onRefused` ignores permission-denied. Only camera events are put in again.
7. **A write before the shared session has loaded uses an empty parent** and replaces the session in progress on the other device.
8. **Mode changes and Pause aren't shared,** so the next version from another device switches the mode back.
9. **Partial or empty sessions save as if complete,** dragging averages down.
10. **`renderChart` crashes on a timestamp that isn't text,** and takes the calendar down with it.
11. **Stray `}` at lines 52/54/56** drop the `.dt-box` padding and radius.
12. **The Camera tick box isn't remembered on reload.**

**At the board**
- **Too small:** the target number is about 7 mm tall on the iPad, the "Dart 2 of 3" line is 14 px, and the table's row labels are bigger than the target.
- **Layout:** in landscape the board runs below the fold. Scrolling by dragging on the board enters a dart (`pointerdown`). Save sits 15 px above the target banner.
- **Fixing a misread** dart 1 takes Undo ×3 and then 3 taps.
- **Voice:** it only says "Single/Double/Triple/Miss", never the number or what's next.
- **Missing:** no wake lock, and no "what did this visit count as". Dots pile up for all 63 darts and misses leave none.
- **Stats:** totals only; no hit %, per-number trend, pace or personal bests per number.

### Bot game (`practice.html`, `practice-engine.js`)

**Bugs**
1. **The bot's checkout visit is never closed.** `runBot` returns because `botTurnNow()` needs `!game.winner`. There's no "Game shot" for the bot, the Rounds table misses that visit, and the saved `botAvg` is too low (a 5-dart 101 finish saves 36.0 instead of 60.6). "Edit my last visit" during the wait also gets confused.
2. **Your winning dart can't be undone** with board or camera input. Undo is off when there's a winner and Edit is hidden, so a misread D16 forces the win into the record. The docs say otherwise.
3. **Camera darts during the bot's turn are dropped, not queued.** The take-out then fills the slot with a miss.
4. **Darts can go in the wrong order.** The dart after an "unreadable" takes its slot, and the station's `e.index` is never used. Example: S20 unreadable, then D10 read, on 40, then busts.
5. **Checkout routes are poor:** 41 → T13 D1, 53 → T17 D1, 60 → T18 D3, 61 → T19 D2, 116 → T20 T18 D1. The bot plays these routes too.
6. **A bust's darts count differently by input:** 1 dart on the board, 3 on a keypad total, the darts entered dart by dart. The average depends on how you entered the darts.
7. **The versus email's visit table assumes the signed-in player threw first** (functions `index.js` ~550–565), so the columns swap every other game.
8. **The bot is calibrated on the app's drawn board,** whose treble and double rings are wider than a real board's (0.08/0.10 of the radius, against about 0.047). Measured level averages are 23.8/36.4/51.5/70.9/94.0 (the docs say 30/42/55/72/95), and the stronger levels hit doubles far too often.
9. **Sync stalls:** a hidden laptop tab can become the device driving the bot, so the iPad waits about 5 s. A tap that races another device is refused and silently lost.
10. **Smaller ones:** Enter doesn't finish the game while the bot's checkout waits. The camera message shows the station's label, not the game's own reading. There's no e2e test.

**At the board**
- **Too small:** the remaining score is at most 60 px, each dart's result is a 14 px line, and whose turn it is shows only as a 1 px border.
- **Layout:** two columns above 800 px, so the board is half-width, and the landscape column scrolls.
- **The bot's visit disappears** the moment your turn starts. Walking back from the board, you see "Last 60" in 13 px.
- **No moments:** nothing visual for a 180, a ton-plus finish or a match win. No "You require…", no running visit total, no "leaves 40".
- **Missing:** no wake lock. Every win needs a walk to tap Finish.

### JDC Challenge (`challenge.html`, `challenge-engine.js`)

**Bugs**
1. **Dart 57 can't be undone.** The last tap saves at once and the round can't be edited, so a mis-tapped final T20 is wrong for good.
2. **Offline saving doesn't work as the page says.** There's no persistence, so "Saving…" hangs and the round is lost if the tab closes. A second failed round overwrites the first unsaved one.
3. **Pace is wrong mid-visit.** It compares the current number's darts with the best round's total from before that number.
4. **History loads once with `.get()`.** If that fails, you get no pace and "Your first round", and rounds finished elsewhere don't show until a reload.
5. **No cross-device or cross-tab safety** (the round lives in localStorage). A finished 57-dart round left in localStorage is never offered or saved.
6. **Smaller ones:**
   - The rules only check that the parts add up.
   - `biggestGap` ranks parts by percentage, not by points left.
   - `aria-live` re-reads the whole 33-cell track after every dart.
   - There's no e2e test.

**At the board**
- **Too small:** the target is about 8 mm tall and the score about 6 mm.
- **Every one of the 57 darts is a tap,** with no "3 misses" key.
- **No cameras, voice, sync or wake lock.**
- **No moments:** a Shanghai is 16 px of text for 2.5 s, double hits (50 each) get no feedback, and nothing marks the end of a part.
- **Confusing:** the doubles part shows one dart at a time, though a visit at the board is three doubles (D1·D2·D3). The track's "S10" label reads as "single 10".

## The work, in phases

### Phase 0: plan, mockups and decisions (no code)

**Show Marwan:**
- the phase list with anything you'd change;
- Board mode mockups for the tracker, the bot game (his turn, the bot's turn, a checkout chance, a 180, a leg/match win) and the JDC Challenge (a Shanghai number, a doubles visit), on iPad portrait and landscape. Use static HTML mocks published as a page he can open on the iPad at the board, as was done for Doubles.

**Ask him to decide:**
- **JDC bull:** does the bull dart need the bullseye, or does the outer bull count too?
- **Bot levels:** recalibrate them to a real board? This changes how hard "club" is: show the before and after averages.
- **Match formats:** legs and sets, and a bull-up for who throws first?
- **Saving visits:** store each visit for bot games and tracker sessions from now on (a rules change)?
- **Achievements/badges:** yes or no?
- **Practice plan:** a daily plan on the home page?

Then start Phase 1.

### Phase 1: fix what corrupts data, before anything new

- **Fix list:** tracker bugs 1–10, bot bugs 1–7 (and 10), and JDC bugs 1–5.
- **Tests first:** each gets a failing engine or e2e test first, then the fix.
- **Engine first where possible:** move the tracker's game rules out of `index.html` into a tested `public/tracker-engine.js`, keeping today's rules.
- **Checkout routes:** add a proper table of standard routes:
  - prefer D20/D16/D8, and the bull only when needed;
  - advice for one or two darts left;
  - setup shots when there's no finish ("S20 leaves 40");
  - avoid bogey numbers.
- **Don't recalibrate the bot yet** (that's Phase 4). Do fix the bot's own averages so they're saved correctly.

### Phase 2: the shared Board mode kit + the tracker's Board mode

- **The shared kit:** pull `public/board-mode.js` + `.css` out of Doubles and move Doubles onto it. Its e2e test must still pass.
- **The tracker's Board mode:**
  - the number at 30% or more of the screen height, with "Dart 2 of 3" and the next numbers;
  - three dart boxes ("T20 hit", "S1, a miss next door", "Not seen, counted as a miss");
  - the board showing only this visit's darts;
  - a strip of the 21 numbers coloured by hits (0–3);
  - big 0/1/2/3-hit, Miss and Undo (with a count) buttons;
  - tap a dart to fix it;
  - live pace ("After 12: 41, your average 37, PB pace 48");
  - an end-of-session recap with what improved and the 3 numbers to practise.
- **The voice:** "Twenty: treble, single, miss. Nineteen." plus a running score at each number. It speaks on every device with Voice on, not just the one that took the dart.
- **Camera visits:** follow the tracker's rule (a visit belongs to the number at its first dart; a pull-out fills misses only at that number; a visit where nothing was seen doesn't shift the session).
- **Saving:** every dart saved with its position, misses included: `throws: [{t, l, x, y, rx?, ry?, seq, src, visit}]` (deploy the rules first), plus `complete` and `startedAtMs`.

### Phase 3: the bot game's Board mode

- **The scoreboard:**
  - the thrower's remaining score at 25–35% of the screen height;
  - three dart boxes with each dart's points and what it counted as;
  - the visit's running total and what it leaves, with the route underneath;
  - a clear "YOUR THROW" / "BOT THROWING" state;
  - the bot's last visit kept on the board, darts included, until your first dart lands. When you walk back from pulling your darts, you should see what the bot did, big.
- **Camera rules for x01:**
  - darts that arrive during the bot's turn are queued;
  - each dart is placed by `e.index`;
  - "Not seen" boxes;
  - darts after a bust or a checkout don't count;
  - the take-out after a win confirms the result, so there's no walk to tap Finish. Keep the bot-checkout wait for a misread winning double.
- **Fixing darts:**
  - tap a dart to fix it, including the winning dart;
  - a 10-step undo from any device;
  - stop silently losing taps.
- **The caller:** "You require 81" (make clips for 2–170 offline with the same Piper voice as the existing ones; see `public/audio/calls/README.md`), "Game shot, and the leg/match", and the bot's calls.
- **Moments:**
  - a full-screen 180;
  - a ton-plus finish banner;
  - a nine-dart watch;
  - leg and match win screens;
  - a high-checkout celebration.

  Each lasts 1.5–2.5 s, can be skipped, and respects reduced motion.
- **Post-match report:**
  - per leg: darts, 3-dart average, first-9 average, checkout % (darts at a double), highest finish, 60+/100+/140+/180 counts;
  - a histogram of visit scores;
  - this match's heat map;
  - comparison with his last 10 matches.

### Phase 4: the bot's realism and match formats (after his Phase 0 decisions)

- **Realistic throws:** the bot throws in real-board millimetres, mapped with `realToApp` so the dots and heat maps still match.
- **Calibration:** separate spreads for scoring and for doubles, calibrated to a table of target averages and checkout %. Add a "set its average" option and personalities (a steady grinder; a heavy scorer with weak doubles), plus a more varied throwing rhythm.
- **Match formats:** legs and sets, a bull-up, alternating who starts each leg and set, and `matchId`/leg on each record.
- **A bot ladder:** start at his level (about 52), win 2 of 3 to move up a step, and keep a record of the highest level beaten.

### Phase 5: the JDC Challenge's Board mode

- **One round across devices:** the round lives in Firestore (`challengeState/{uid}`, transactions like `doublesState`), not localStorage. Move an existing localStorage round into it, save exactly once with a fixed id, and keep a 10-step undo plus "fix the last visit" before saving.
- **The screen:**
  - the target lit on the board: the whole number's S/D/T beds, or the visit's 3 doubles ("D7 · D8 · D9");
  - dart boxes ("T17 · 51", "Miss · in the 2", "D8 · +50");
  - a Shanghai tracker ("S ✓ T ✓ need the D for +100");
  - a running score;
  - pace at visit boundaries against his PB and his last-10 average, plus the most still possible;
  - a "3 misses" key.
- **Camera rules:** each visit is exactly 3 darts and nothing ends one early; unseen darts at a pull-out are misses; a 4th dart before the pull-out is ignored, so it can't shift every later target.
- **The voice:** "17: treble, single, miss, 68. 40 ahead of your best." "SHANGHAI!" "D 7. D 8."
- **Moments:** a full-screen Shanghai, being on PB pace, a part PB, all 3 doubles in one visit, and a new PB.
- **Round summary:** each part against its average and PB, each number's points and S/D/T, the 21 doubles on a board, and what to practise next.

### Phase 6: stats, records and the practice plan (all games, Doubles included)

- **A stats page for each game, with each number's definition written next to it:**
  - **Tracker:** hit %, marks per dart, S/D/T split, per-number hit % (last 10 against lifetime, with a trend), hit % on darts 1/2/3, and a personal best per number.
  - **Bot:** average, first-9, checkout %, win rate by level and format, and counts of 60+/100+/140+/180.
  - **JDC:** each part, per number, and doubles.
- **Personal bests with guards:**
  - abandoned games, test bursts (like 2026-09-27) and partial sessions never count;
  - he can hide any game or session from stats with a flag; nothing is ever deleted;
  - the definition of each record is shown.
- **Trends:** rolling averages over 30 days, 90 days, 1 year or all, in inline SVG with no chart library. A calendar with streaks.
- **Camera heat maps:** where each number's darts land (average point, spread, which neighbour the misses go to: "your 20s drift left into the 5"), from `positions`/`throws`/`playerDarts`. Show a miss map for each double (Doubles has `throws` too).
- **"Practise next":** one daily plan across all four games, based on his weakest numbers and doubles (today: the bull, 9, 3, 2 and 17 on the tracker; the bull, D6, D10, D8 and D14 in Doubles; checkout % in x01). Each item opens the right game, ready to start.
- **Old history:** derive new stats from what's already stored wherever you can, with no migration. Rebuild bot visits by replaying `playerDarts` where possible (keypad `{s:"?"}` darts can't be). From now on, store what's needed (rules first).

### Phase 7: polish

- **One look:** shared header and navigation across all five pages, with Board mode one tap away everywhere.
- **Empty states and first-run help.**
- **Accessibility:** WCAG AA contrast and `aria-live` announcements only for what matters (not whole tracks).
- **Speed:** smooth on the iPad, redrawing only what changed.
- **Offline:** behaviour that matches what the page says.
- **A short "How it works" for each game,** matching the rules exactly.

## Making it exciting (design guidance)

- **One look across all games:** the dark arena look and amber target from Doubles; green for hits, red for misses, amber for what's live.
- **Clear priorities:** the number you need and what just happened are the biggest things on screen; everything else steps back.
- **Big moments are big and short:** one well-made moment per event (180, Shanghai, high finish, PB, match win), full screen, under 2.5 s, skippable, with sound and voice in step. Small moments stay small: a hit gets a quick pulse, not a party.
- **Always something to chase:** pace against PB and against his average, the most still possible, "2 more doubles for a PB part", streaks. Show it all the time, not only at the end.
- **The walk back from the board matters:** whatever happened while he was pulling his darts (the bot's visit, a misread, a new target) must be readable from 3 m as he turns round.
- **Sound design:** the recorded caller for scores and big moments, short tones for each dart, everything at a sensible volume and switchable per device.
- **Nothing blocks the game:** no dialogs; an undo for everything; a fix for any misread in two taps.

## Engineering rules

- **No build step.** Plain HTML/CSS/JS and the compat SDK, like today.
  - Rules and maths go in UMD engines with `node --test` tests. Keep page scripts thin, and put UI in separate files as they grow.
  - Add every new file to `scripts/check-app.cjs` and `test:engine`. Bump the `?v=` on every script and stylesheet you change.
- **Firestore:**
  - Every new field needs a rule change and a rules test. Deploy the rules before the pages that write the field, and old documents must still pass.
  - Every new query needs its index, including `desc`/`limitToLast`. Wait for READY after deploying.
  - Every change goes through a transaction or the versioned live-sync protocol. Keep the shared documents small.
- **Two versions at once:** pages already open with the old code may keep running for a while, so new state must not break them, and theirs must not break yours.
- **Time Left:** keep each mapping working. Add tests when titles change, for example adding the bot match format.

## Testing

- **`npm test`** (page checks, engines, functions, rules in the emulator) must pass after every phase.
- **`npm run test:e2e`** (`E2E=name` to run just one): the real pages in headless Chrome against the Firestore and Auth emulators, with a pretend camera station (`tests/e2e/harness.cjs`).
  - **Add one e2e file per game.** Each covers:
    - a full camera game on two devices with each dart counted once;
    - fixing a dart by tapping it;
    - Undo from the other device;
    - every visit-boundary case (early end, unseen darts, a 4th dart, darts during the bot's turn, darts after a bust or checkout);
    - the finish, then the summary and the saved record;
    - a reload keeping Board mode, the cameras and the voice;
    - the wake lock.
  - **Two-device runs:** commit 400s from contention are expected and ignored by the harness; nothing else is.
- **Screenshots** after each phase, using `tests/e2e/shots.cjs` as the pattern: iPad portrait 820×1180, iPad landscape 1180×820, phone 390×844 and desktop 1280×900, plus each celebration.
- **Old history:** where you derive new stats from it, check the results against his real data (read-only) and say what you found.

## How to work with Marwan

- **One phase at a time.** After each one, run the tests, show screenshots and a short plain-language summary, then ask before committing, pushing or deploying. He approves each one.
- **Never write to the live database without his explicit yes.** That includes backfills, migrations and hiding old games.
- **Watch it live after a deploy.** When he plays the first game after a change, offer to watch it: read the station's events and the game's state, read-only, and go through it visit by visit. That's how the Doubles carry-over bug was found.
- **Leave the untracked `TODO.md` out of git.**
- **Report each session to the Developer Dashboard** as `AGENTS.md` says (project `2ae79298-d56d-46f4-a997-74090f5e21f8`).

## What world class means here

- **Hands-free:** in all three games, a full session or match goes from Start to the summary with the cameras and no taps. Any misread is fixed in two taps from the iPad.
- **Readable from the oche:** at 3 m he can see what to throw at, what each dart counted as, the score and the pace, and he can hear them.
- **Exciting:** big moments feel big, and there's always something to chase.
- **Something to act on:** after every session he knows how it compared, what's improving, and what to practise next.
- **Honest:** every number is right for old and new history, test games never reach records, and nothing he played is lost or duplicated.
- **Verified:** all tests pass, and the live site is checked after every deploy.
