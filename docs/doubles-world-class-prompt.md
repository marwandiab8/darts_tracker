# Make Doubles a world-class practice game

You are working in `~/Documents/darts`: Darts Tracker, live at https://dartstracker2026.web.app (Firebase project `dartstracker2026`, GitHub `marwandiab8/darts_tracker`, branch `main`).

The Doubles page (`public/doubles.html`) went live on 2026-11-12. It replaced Marwan's separate "My Doubles Progress" app, and his 177 old rounds were imported into it. The page works, but it is a straight copy of a simple tracker: buttons, a table and a list.

**Your job:** turn it into the best doubles practice tool he could have. That means three things:
- He can run a whole round from the oche without touching the iPad.
- After every round he can see how he did and what to practise next.
- He wants to open it every day.

Work through the phases below. Each phase must work on its own and come with tests. Nothing is committed, pushed or deployed until Marwan says so.

## How Marwan plays

- **The board and the iPad.** He throws at a real board. An iPad (Safari) stands by the board as the scoreboard, 2–3 m from where he throws. He also opens the site on a Windows PC and a Linux laptop, sometimes on several devices at once.
- **The cameras.** Two USB cameras on the Linux laptop run `public/station.html`. It reads each dart and passes it through Firestore to every open page on his account. With **Camera** ticked on the Doubles page, darts are entered automatically.
- **His history.** 177 rounds from 2026-01-25 to 2026-11-04, played on 135 days.
  - **Round length:** median 108 darts and 10:18 of active time. His best 10% are around 80 darts and 7:17.
  - **Improvement:** his average went from about 130 darts per round (first 20 rounds) to about 106 (last 20).
  - **Hit rates:** he hits within a 3-dart visit 45.5% of the time. Per dart, it's about 18.4%.
  - **Weakest per dart:** the bullseye (DBULL) 10%, then D6, D10, D8 and D14 at about 17%.
  - **Strongest per dart:** D4, D9, D5, D16 and D2, at about 21–22%.
  - **Stays:** only 5 rounds ever used "Stayed on this double".
  - **A bad record:** the round on 2026-09-18 (21 darts in 0:20) is not real. Keep that kind of round out of records.

## Read these first

- **The game:**
  - `public/doubles.html`: the page, with an inline script.
  - `public/doubles-engine.js`: the rules and the data model. Its header comment explains both. It's a UMD module with no DOM code.
- **Tests:** `tests/doubles-engine.test.cjs`, `tests/firestore.rules.test.cjs` and `functions/index.test.js`.
- **Firestore:** `firestore.rules` (the `doublesState` match and `validDoublesSession`) and `firestore.indexes.json`.
- **Time Left:** in `functions/index.js`, see `mapDoublesSessionToTimeLeft`, `forwardDoublesSession` and `syncDoublesSessionToTimeLeft`. Also `docs/time-left-sync.md`.
- **Cameras:**
  - `public/board-camera.js`: `DartCamera.chooseWatcher` sends events such as `{type:'dart', seq, app:{x,y}, label, uncertain}` and `{type:'takeout', darts}`.
  - `public/board-vision.js`: `BoardVision.classify(x, y, BoardVision.APP)`.
  - `docs/camera-scoring.md` and `docs/dart-positions.md`.
- **Reuse rather than rebuild:**
  - **Voice:** the iPad voice warm-up in `public/practice.html`, around lines 505–600. Safari only speaks after one `speak()` inside a touchend, click or keydown.
  - **Board drawing:** the canvas dartboard `drawBoardBase` in `public/practice.html`.
  - **Wake lock:** the screen wake lock in `public/station.html`.
  - **Sync:** the cross-device sync in `public/live-sync.js`.
- **Repo setup:** `package.json` scripts, `scripts/check-app.cjs` and `AGENTS.md`.

## What must not change

**The classic game, which is today's mode:**
- **Order:** D1 to D20, then the bullseye (DBULL).
- **Visits:** a visit is up to 3 darts: a hit on dart 1, 2 or 3, or a miss.
- **Missed doubles:** a missed double stays open. After the bull, play goes back to the earliest open double.
- **Stays:** a hit on dart 4–15, or a miss after 6/9/12/15 darts. They are stored as 3-dart visits, with the darts past 3 counted as extra.
- **Hit a later double:** the doubles skipped over count as 3-dart misses.
- **The clock:** it counts active time only.

**The stored data:**
- `doublesState/{uid}` = `{uid, activeSession, lifetime, lastUndo, updatedAt}`.
- Rounds are in `doublesSessions/{key}`. Imported rounds carry the old app's fields: `importedFrom`, `startedAt`, `durationMs`, `dartsUsed` and others.
- Old and new rounds must keep showing and counting exactly as they do now. Add fields; never rename fields or change what they mean.
- `lifetime` is for the classic game only.

**How the cameras score the classic game** (`cameraDart` and `cameraTakeout`):
- A dart in the current double is a hit on that dart. Three darts without one is a miss, and play moves on.
- More darts in the number just missed count as a stay.
- Darts not seen before a pull-out count as misses.
- Each dart is counted once across devices, using `cam.seq` inside Firestore transactions.

**Outside the page:**
- Time Left gets each new finished round once. Imported rounds are skipped.
- The camera station and its event protocol stay as they are.

If you think any of this should change, ask Marwan first.

## Review: what holds it back today

1. **It can't be read from the oche.** The current double is at most 72 px, about 1.5 cm tall on the iPad; at 3 m it needs to be at least 2.5 cm. Camera messages are 15 px text, and most of the screen is forms and tables.
2. **No board picture.** The cameras know exactly where each dart landed, but the page shows only text chips ("S4"), with no board, no target segment and no dots.
3. **Not hands-free yet.** There is no voice, so he has to look at the screen to know the next double or whether a dart counted. The screen can also go to sleep in the middle of a round.
4. **Fixing a camera mistake is clumsy.** He has to tap Undo, then tap what really happened. He can't just tap the wrong dart and fix it.
5. **Undo goes back one step only** (there is a single `lastUndo`).
6. **A round ends with one line of text.** There is no summary, no comparison with his usual rounds, no personal bests and no "what to practise next".
7. **No progress over time.** His 130 → 106 darts improvement is invisible.
   - The heat map counts rounds only. Its squares are 16 px, with no month or weekday labels and no legend.
   - Rounds in "Latest sessions" can't be opened.
8. **Only one kind of hit rate.** Every percentage is per visit (hit within 3 darts). The usual darts measure is per dart, and darts per double is missing too.
   - The "Every double" table has 8 columns.
   - There is no board-shaped view of strong and weak doubles.
9. **Camera positions are thrown away.** Dart positions aren't saved, so there is no miss analysis: inside or outside the wire, or which neighbouring number the misses go to.
10. **Only one way to practise.** There is no weakest-first, random order, finishing doubles, pressure (one dart per double) or points drill.
11. **The manual extras are heavy.** "Stayed on this double" and "Hit a later double" are dropdown forms with up to 15 options, used in only 5 rounds. They take up a third of the play card.
12. **Untested assumptions:**
    - **The stay rule.** The camera's stay rule only works because back-to-back targets (D1, D2, D3…) are never next to each other on the board. In any other order it misreads. For example, after missing D16, a dart aimed at D8 that lands in the 16 is counted as a stay.
    - **Indexes.** The Firestore emulator doesn't check indexes, so the tests passed while the live history list failed with "The query requires an index" (fixed in 1d407b2).

## The work, in phases

### Phase 0: plan and mockup (no code)

Show Marwan two things:
- This phase list, with anything you would change.
- A mockup of Board mode, in iPad portrait and landscape. ASCII is fine, or a screenshot of a static HTML mock.

Start Phase 1 when he agrees.

### Phase 1: Board mode (play from the oche)

- **A full-screen play view.** Opened with a button. Remember the choice on that device. It shows:
  - The current double, at least 25% of the screen height.
  - This visit's 3 dart slots. Each fills in with what was read: hit, single, outside, or a neighbouring number.
  - Progress through the 21 doubles, as a ring or a strip of 21 cells.
  - The clock and the next 3 doubles.
- **A dartboard drawing.** Light up the target double and show this visit's camera darts as dots. Use SVG, or reuse `drawBoardBase`.
- **Tap a dart to fix it.** Tapping a dot or slot lets him pick what it really was. The engine then re-scores that visit. Two taps should fix any wrong read.
- **Voice** (a switch, remembered on the device). Announce the new target ("D7"), the result ("D6, second dart" or "missed D6") and the end of the round. Use the existing iPad warm-up.
- **Keep the screen awake** (wake lock) while a round is running.
- **Big manual buttons:** Hit on 1/2/3, Miss, Pause and Undo, at least 56 px tall.
- **Undo several steps.** Keep a short log of this round's visits that he can step back through. It must stay safe across devices: every change goes through a transaction.
- **Done when:**
  - On an iPad at 820×1180 (portrait) and 1180×820 (landscape), the target, dart slots, board and progress all fit with no scrolling.
  - A full camera round needs no taps after Start.
  - Another device with the page open sees every change within a second.

### Phase 2: end of round, records and progress

- **Round summary** when the last double goes in. It shows:
  - Darts, time, per-dart % and first-dart hits.
  - A comparison with his median of the last 20 rounds and with his personal best.
  - This round's best and worst doubles, then "Start another".
- **Personal bests:** fewest darts, fastest round, most first-dart hits, and the longest run of doubles hit on the first visit.
  - **Keeping bad rounds out:** let him hide a round from stats. Use a flag; never delete.
  - **Implausible rounds:** treat a round faster than about 2 s per dart (like the 2026-09-18 one) as hidden until he un-hides it, and say why.
- **Progress chart.**
  - Darts per round, with a line for the average of the last 10, and time per round.
  - Ranges: 30 days, 90 days, 1 year or all.
  - Draw it as inline SVG; don't add a chart library.
- **History.** Open a round to see each double in it, and hide or un-hide it there.
- **Heat map.** Add month and weekday labels and a legend, plus his current and longest streak of days in a row.

### Phase 3: insight

- **Per-dart numbers.** Show the per-dart % next to the per-visit % everywhere, plus darts per double. Note that `lifetime` counts visits, not extra darts.
- **A dartboard view of his doubles.** Colour each double segment by his per-dart %, all-time, since a date or over the last N rounds. Tapping a segment shows its tries, %, first-dart % and trend.
- **Miss map from the cameras.**
  - Save each camera dart of the round with its position, for example `activeSession.throws: [{key, x, y, label, seq, t}]`, and keep it with the saved round. That's about 120 darts a round, well under Firestore's 1 MB limit.
  - For each double, show where the darts aimed at it landed, and which way he misses: "D16: 6 of 10 misses land outside the wire, 3 drift into the 8."
- **"Practise next."** Suggest the 3 doubles to work on, based on per-dart % and its recent trend.

### Phase 4: training modes

- **A mode picker at Start.**
  - **Classic** stays the default, exactly as it is.
  - Every other mode saves `mode` on its rounds and keeps its own records and stats. It never touches classic `lifetime` or classic personal bests.
- **The modes:**
  - **Weakest first:** the classic round, but in order of his lowest recent per-dart %.
  - **Random order.**
  - **Finishing doubles:** the doubles that most often finish a game (D20, D16, D8, D10, D18, D12, D4 and the bullseye), and he can edit the set.
  - **Pressure:** one dart at each of the 21 doubles. His score is hits out of 21.
  - **Points drill:**
    - Start on 27 and throw 3 darts at each double, D1 to the bullseye.
    - Each hit adds the double's value; 3 misses take its value away.
    - The game ends if the score drops below zero.
    - Keep his best score.
- **How to build each mode:**
  - Engine functions and unit tests come first.
  - Add camera scoring wherever it's clear.
  - In any order where back-to-back targets can be next to each other on the board, don't use the "same number = stay" rule. Count only darts in the missed double itself.
- **Time Left** should name the mode in the title it sends.

### Phase 5: polish

- **Simpler manual scoring.** Add an option to score dart by dart: one tap per dart, with a 4th-dart button for stays. Move "Stayed on this double" and "Hit a later double" under a "More" fold-out; keep them working.
- **Empty states.** Before a round starts, show a clear "Start" prompt, not a lone dash.
- **Accessibility:** WCAG AA contrast, an `aria-live` announcement when the target changes, and support for `prefers-reduced-motion`.

## Engineering rules

- **No build step.**
  - Plain HTML, CSS and JS, with Firebase compat SDK 10.13.1 from gstatic, like the other pages.
  - Rules and maths go in UMD engine files that `node --test` can test. Keep the page script thin, and split UI code into its own file (for example `public/doubles-ui.js`) as it grows.
  - Add every new file to `scripts/check-app.cjs` and to `test:engine` in `package.json`.
- **Cache busting.** Bump the `?v=` on every script tag you change. Hosting sends no-cache, but iPad Safari holds on to old scripts.
- **Firestore rules.** The rules use `hasOnly` field lists, so every new field needs a rule change and a rules test.
- **Indexes.**
  - Every new query needs its composite index in `firestore.indexes.json`. That includes the descending one that `orderBy(..., "desc")` and `limitToLast` need.
  - Add a test that lists each query shape the pages use and checks the index file has it.
  - After a deploy, the site isn't live until `gcloud firestore indexes composite list --project dartstracker2026` shows READY.
- **The state document.** `doublesState` is rewritten on every dart, from every device, inside a transaction. Keep `activeSession` small, and never change game state outside a transaction.
- **Look and feel.** Keep the existing style: dark background, amber accent, system font. Board mode can be bolder, but it should feel like the same app.
- **Speed.** The clock redraws every 500 ms, so redraw only what changed.

## Testing

- `npm test` (page checks, engine, functions, and rules in the emulator) must pass after every phase.
- **Browser tests.** The repo has none, so build them under `tests/e2e/`.
  - **Setup:** add `playwright-core` as a devDependency (ask first), and drive `/usr/bin/google-chrome` headless.
  - **Emulators:** run with `firebase emulators:exec --only firestore,auth --project demo-darts`, using a test-only `firebase.json` that sets up the Auth emulator (the repo's doesn't).
  - **Sign-in:** use `signInWithCredential(GoogleAuthProvider.credential(JSON.stringify({sub, email})))`.
  - **Camera darts:** write them the way the station does; see the remote watcher in `board-camera.js`.
- **What the browser tests must cover:**
  - A full camera round with two devices open, each dart counted once.
  - Fixing a dart by tapping it.
  - Undo from the other device.
  - Finishing, then the summary and the history entry.
  - A reload, with Camera and Voice still on.
  - Every mode.
- **Screenshots for Marwan** after each phase: iPad portrait 820×1180, iPad landscape 1180×820, phone 390×844 and desktop 1280×900.

## How to work with Marwan

- **One phase at a time.** After each phase, run the tests, show screenshots and a short plain-language summary, then ask before committing, pushing or deploying. He approves each one.
- **Deploy only what changed**, for example `firebase deploy --only hosting,firestore:rules,firestore:indexes`.
- **Never write to the live database without his explicit yes.** That includes backfills and changes to old rounds.
- **Leave the untracked `TODO.md` out of git.**
- **Report each session to the Developer Dashboard** as `AGENTS.md` says (project `2ae79298-d56d-46f4-a997-74090f5e21f8`).

## What world class means here

- A full camera round, from Start to the summary, with no taps.
- From the oche he can read the target, his darts and his progress at a glance, and hear them.
- After every round he knows how it went, what's improving, and the three doubles to practise next.
- Every number is correct for old and new rounds alike, and his history is untouched.
- All tests pass, and the live site is checked after every deploy.
