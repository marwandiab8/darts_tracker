# Add Training to Darts Tracker: the drills that make Marwan better at 501

You are working in `~/Documents/darts`: Darts Tracker, live at https://dartstracker2026.web.app (Firebase project `dartstracker2026`, GitHub `marwandiab8/darts_tracker`, branch `main`). It is plain HTML pages with the Firebase compat SDK 10.13.1 and Google sign-in. There is no build step. Game rules live in UMD engines (no DOM, no Firebase) tested with `node --test`.

**Your job:** add a **Training** page of practice drills aimed at 501: scoring, doubles and checkouts, and pressure. It should be the best page on the site. Each drill must be:
- **Hands-free with the cameras:** a whole drill runs from Start to the summary with no taps, and any misread is fixed in two taps.
- **Readable from the oche:** at 2–3 m he can see what to throw at, what each dart counted as, and how he's doing.
- **Always something to chase:** a personal best, a level, a streak, pace against his best, shown all the time and not only at the end.
- **Honest:** every number is right, nothing he played is lost or counted twice, and old history keeps working exactly as now.

Work in the phases at the end. Each phase must work on its own and come with tests. **Nothing is committed, pushed or deployed until Marwan says so.**

## How Marwan plays

- **The board and the iPad:** he throws at a real board. An iPad (Safari) stands by the board as the scoreboard, 2–3 m from the oche. He also uses his phone, a Windows PC and a Linux laptop, often with the same game open on two devices of one account.
- **The cameras:**
  - Two USB cameras on the Linux laptop run `public/station.html`, which stays open all the time. **The station is the only thing that reads the cameras.** Game pages never open them. A page gets camera events through `DartCamera.chooseWatcher({ db, user, onEvent })` (see `public/doubles.html`).
  - The events a page receives are dart, takeout, check, error, unreadable, blocked and ready. Each dart has `label`, `x`/`y`, `seq`, `index` (the dart's place in the visit) and an "uncertain" flag. A take-out has `darts` (how many were pulled).
  - The station already handles the hand and the darts being pulled. That includes the dart thrown just after a pull-out (the `soon` rule, Nov 18; see `docs/camera-scoring.md`).
- **What he wants:** to play standing at the oche, hearing and seeing everything, and to touch the iPad only to fix a misread.
- **The voice, as he set it on Nov 17, 2026:**
  - Lines are short and slow, with a pause between sentences.
  - Always **"triple"**, never "treble", in speech, on screen and in code names.
  - No running total read out after every visit. Example: "20. Triple, single, miss. Next, 19."

## His numbers (Firestore, read-only, as of 2026-11-19)

Use these to choose each drill's defaults. They also show where a drill as usually described would be too hard or too easy for him.

| What | Number |
|---|---|
| Volume | 370 tracker sessions, 253 finished bot games (281 in all), 186 Doubles rounds, 22 JDC rounds, 26 two-player games |
| Practice days | 217 days in all; best run 15 days, current run 8 |
| 501 against the bot | 3-dart average 50.9 lifetime, 47.3 over the last 30 games; first-9 average 57.0 |
| Checkout | 19% of darts at a double (112 in 590); 21.8% over the last 30 games. Highest finish 132 |
| Darts per won 501 leg | median 27, best 16, a quarter of wins in 24 or fewer |
| Big scores | 519 visits of 60+, 141 of 100+, 10 of 140+, four 180s |
| Triples (tracker, lifetime / last 30 sessions) | T20 10% / 13%, T19 13% / 7%, T18 9% / 6%, T17 13% / 14% of darts |
| In the number thrown at | about 67% for 20 and 19 (any ring); bull 34% |
| Doubles per dart (Doubles, lifetime) | 17–23% for D1–D20, bull 10%. Weakest: bull, D10, D6, D8, D14 |
| Doubles, last 10 rounds | weakest: bull 11%, **D20 13%, D16 13%**, D10 13%, D8 15%. His two main finishing doubles are among his worst lately |
| JDC Challenge | average 671, last 10 734, best 1,019 |
| A bot game | median about 3 minutes |

What these numbers mean for the drills (worked out from the numbers above; check them yourself):
- **Game of 9 as usually played ("all 9 darts in the segment") is nearly impossible for him.** At 67% in the number, 9 out of 9 happens 2.7% of the time, so each number would take about 37 tries. At the bull's 34% it essentially never happens. Use a pass mark set from his own hit rate. For example, 7 of 9 at 20 passes 39% of the time, and 4 of 9 at the bull 37%, so each number takes 2–3 tries. Keep "Strict: all 9" as an option.
- **Bob's 27:** a simulation with his per-double rates goes below zero 72% of the time, usually around D10. If played on, the median final score is 21. Show how far he got, as well as the score.
- **Invisible Man:** the usual 24-dart limit means he would lose about 3 legs in 4. Default to 27 darts (his median win) and let him pick 21/24/27/30. Consider moving the limit by itself: down 1 after a win, up 1 after two losses in a row.
- **Two-dart finishes (61–70):** each needs a triple and then a double (or a single and the bull), so he will check out about 2–4% of tries. Score each try in parts so progress shows: "Hit the setup, left D8" / "Setup missed". Track the setup hit % and the double hit % when he was on one, as well as finishes.
- **121 Checkout Ladder:** with 19% at the doubles, expect him to settle well below 121. Start at 121 with a floor (the usual one is 100) as the drill says. In Phase 0, show what the floor and start do at his level.

Re-check these with your own read-only queries before relying on them. The admin SDK is in `functions/node_modules/firebase-admin`; find his uid from `liveGames`. Use `public/stats-engine.js` to compute them, so you get the same numbers the Stats page shows.

## What already exists: don't build it twice

| Idea from the drill list | Where it lives today | What to do |
|---|---|---|
| Around the Clock doubles | **Doubles** (`doubles.html`, `doubles-engine.js`): D1 → D20 → bull against the clock, with Board mode and the cameras | Don't rebuild it. Its "lose the double's value after 3 misses" variant is Bob's 27 |
| Playing 501 | **Bot game** (`practice.html`, `practice-engine.js` = `window.DartsEngine`): x01 with the real-board bot, levels, a set average, the ladder, matches (first to 2–9 legs), bull-up, saved visits, `legReport`, the "You require" caller, moments | **Recommend putting Invisible Man here** as an opponent "No bot: beat N darts". It reuses the x01 camera rules, Board mode, caller and leg report. It must save with its own field, so it stays out of the bot's win rate and level stats. Ask Marwan in Phase 0 |
| Checkout routes | `practice-engine.js`: `checkoutRoute(remaining, dartsLeft, doubleOut)`, `fewestDarts`, `setupShot`, `requireLine`/`requireText`. `bestRoute`, `finishingDarts` and `DOUBLE_PREFERENCE` (16, 20, 8, …) are internal, not exported | Reuse them; don't write a second checkout solver. Export what you need, and add a table builder (2–170 for 1, 2 and 3 darts left), the bogey numbers (159, 162, 163, 165, 166, 168, 169) and an optional override of his preferred routes. Today it gives 121 → T20 T15 D8 and 61 → T15 D8, so show him the table and let him set his own routes |
| Streak, days practised, calendar, records, milestones, today's plan | `stats-engine.js`: `practiceDays`, `records`, `milestones`, `practicePlan` (one item per game, from his weakest numbers); `stats.html` draws them with inline SVG | Extend these. Training days count towards the streak, drill PBs go into `records`, and the plan can suggest a drill. Don't add a second streak or plan system |
| Board mode: big target, lit beds, dart boxes, fix sheet, target strip, big buttons, voice warm-up, wake lock | `board-mode.js` (`window.BoardMode`) + `board-mode.css`, used by Doubles and the tracker | Build the Training screen on it |
| Camera darts → visits, fixing a dart, undo | `doubles-engine.js` (`cameraDart`, `cameraTakeout`, `recordDart`, `fixDart`, `undoStep`, `undoStackOf`, `voiceLine`, `boardView`); `challenge-engine.js` (`camDart`, `camUnread`, `camTakeout`, `threeMisses`); `tracker-engine.js` | Follow the same patterns |
| Saved players for two-player play | `players.js` (`window.Players`), `savedPlayers/{uid}` | Use it for two-player Score More |
| Session timer, live sync | `practice-timer.js` (`window.PracticeTimer`), `live-sync.js` (`window.LiveSync`, the versioned protocol for `liveGames`/`liveSessions`) | Reuse them |
| Hiding a game from stats | `statsHidden/{uid}.ids` | Training sessions can be hidden the same way |

Chart.js (4.4.1) is used only on the tracker page; `stats.html` draws its charts in inline SVG. Do Training's charts the `stats.html` way.

## Read these first

- `docs/doubles.md`, `docs/stats.md`, `docs/camera-scoring.md`, `docs/bot-practice.md`, `docs/two-players.md`.
- `docs/darts-world-class-prompt.md` and `docs/doubles-world-class-prompt.md`: the earlier plans. Read their lessons and their "what must not change" lists, which still apply.
- `public/doubles.html`, `public/doubles-engine.js`, `public/doubles-board.js`, `public/board-mode.js`/`.css`, `public/nav.js`/`.css`.
- `public/practice-engine.js` (x01 rules, checkouts, `legReport`, `cameraEvent`/`cleanHold`), `public/stats-engine.js`, `public/stats.html`.
- `firestore.rules` (`doublesState`, `doublesSessions`, `statsHidden`, the `hasOnly` lists), `firestore.indexes.json`, `functions/index.js` (the Time Left mappings).
- `tests/` and `tests/e2e/` (`harness.cjs` with its pretend camera station `makeStation`/`station.send(H.dart(...))`, `doubles.e2e.cjs`, `practice-versus.e2e.cjs`, `shots.cjs`), `package.json`, `scripts/check-app.cjs`, `AGENTS.md`.

Tell Marwan anything in this prompt that turns out to be wrong.

## The drills

For every drill, write the rules **in the engine, with tests**, including exactly how a visit works with the cameras:
- what counts;
- when a visit ends early;
- what a dart after the visit is over does;
- what unseen darts at a take-out become, and at which target;
- what a 4th dart before the take-out means.

Use the station's `index` to place darts. One bad visit must never shift every later visit: that happened in Doubles, and again in two-player games on Nov 17.

### Scoring

1. **Triple 20 Marathon:** hit T20 a set number of times (default 10).
   - **Shown:** darts taken, the live T20 %, and pace against his best.
   - **PB:** fewest darts.
   - **Cameras:** a visit is 3 darts at T20. The drill ends on the last T20 needed, and darts after it in that visit don't count ("Pull your darts out"). Unseen darts at a take-out are misses.
   - **Size:** at his 10–13% T20 rate, 10 T20s is about 80–100 darts. Offer 5 as a quick version.
2. **Big Triples:** 9 darts each at T20, T19, T18 and T17 (darts and targets can be changed).
   - **Score:** triples hit, with the count for each number and its trend.
   - **Cameras:** 9 darts = exactly 3 visits, so a visit never spans two targets. Unseen darts at a take-out are misses at that visit's target.
3. **Game of 9:** 9 darts at the whole segment (any ring), from 20 down to 15, then the bull. Reach the pass mark to move on (see "His numbers"; "Strict: all 9" is an option).
   - **Track:** tries and darts for each number, and the whole run's darts.
   - **PB:** fewest darts for the run.

### Doubles and checkouts

4. **Bob's 27:** start on 27 and throw 3 darts at each double, D1 to D20, then the bull.
   - **Scoring:** each dart that hits adds the double's value (D1 = 2 … D20 = 40, bull = 50). If all 3 miss, subtract the double's value.
   - **The end:** the game ends at 0 or below. "Play on below zero" is an option.
   - **Shown:** the score, the doubles still to go, and how far he got.
   - **PB:** final score, with "furthest double" alongside.
   - **Cameras:** a visit is 3 darts at one double, and nothing ends it early. Unseen darts at a take-out are misses at that double, and a 4th dart before the take-out is ignored.
   - **Stats:** Bob's 27 darts may appear in a combined "every double" view on Stats, labelled by source. They must not change `doublesState` lifetime figures, the Doubles page's stats or its records.
5. **121 Checkout Ladder:** a real countdown from the current target, double out, with busts (back to the score at the start of the visit), and 9 darts (3 visits) to check out.
   - **Moving:** a checkout moves the target up 1, anything else moves it down 1. The start and floor can be changed.
   - **Shown:** the suggested route at every dart ("You require 121: T20 T15 D8"), using the checkout module.
   - **Track:** the highest level reached, the success % for each number, and darts at a double.
   - **x01 rules:** use `practice-engine.js`'s rules for busts, double out and visits. Export what you need; never write a second x01.
   - **Cameras:** darts after a bust or a checkout are the thrower's until the take-out, and they don't count. This is the Nov 18 two-player fix; keep it.
6. **Two-Dart Finishes:** every number in a range (default 61–70), in order or random, with exactly 2 darts each.
   - **After each try:** show the best route and what happened, with partial credit (see "His numbers").
   - **Track:** finish %, setup %, and double % on a double, for each number.
   - **Cameras:** a third dart before the take-out isn't counted, and the take-out ends the try.

### Pressure

7. **Invisible Man:** a 501 double-out leg against a dart limit (default 27), best of N legs.
   - **Track:** 3-dart average, first-9, checkout %, darts per leg and W/L, using `legReport`.
   - **Where it goes:** the bot game if he agrees (see the table).
8. **Score More:**
   - **Solo:** each visit must beat your last; if it doesn't, that's a strike, and 3 strikes ends it. Track the longest run. At his 50 average a rising run is short, so in Phase 0 offer "beat your average" as a gentler target.
   - **Two players:** the player with the lower score must beat their own last score next round. Use the saved players.
   - **Data:** the other player's email is saved and shown as `versusGames` does today, never in a CSV.

### Warm-up

9. **Warm-up:** a guided 10–15 minute timer, the 20s and then the 19s, with a light count of darts in the number.
   - No PB pressure. Track the in-number % only.
   - Offer it before any drill or plan.

## Practice plans

- **Chains:** drills back to back, for example Warm-up → Big Triples → Bob's 27 → Checkout Ladder.
- **Presets:** 30 and 60 minutes, built from his numbers (today that means doubles work weighted to D20, D16 and the bull, plus checkout practice). Plus "make your own".
- **Saving:** a plan resumes where it stopped. Each drill in it saves its own session, with the plan run's id.
- **Today's plan:** on Stats and the Training page, `practicePlan` suggests a drill when one fits, for example weak doubles → Bob's 27 and low checkout % → Checkout Ladder.

## Data

**Saved data**
- **Finished drills:** a new `trainingSessions/{id}` per finished drill. It is create-only and owner-only, with a `hasOnly` field list. It holds:
  - `uid`, `drill`, `drillVersion`, `settings`, the `result` and its key number;
  - every dart, misses included, in the tracker's shape (`throws: [{ t, r, l, x, y, seq, src }]`, see `throwsFor` in `tracker-engine.js`), plus the visit number;
  - `startedAtMs`, `activeMs`, `timestamp` as `"YYYY-MM-DD HH:MM"`, `complete`, and `planRunId` when the drill was part of a plan.
- **The drill in play:** a new `trainingState/{uid}`, so a drill resumes after a reload and on any device. It holds a 10-step undo stack with an id for each step, plus `say: { n, text }` so every device speaks each line once.
  - Writes go through transactions like `doublesState`, or the `LiveSync` protocol.
  - Choose one and say why. Never use a plain write.

**Firestore rules**
- **Rules and tests:** every new collection and field needs a rule and a rules test. Deploy the rules before the pages that write them.
- **Indexes:** every new query needs its index in `firestore.indexes.json`, including the descending one, because the emulator doesn't check indexes. Wait for READY after deploying.

**Leave old data alone**
- **Field shapes:** no change to the shape of any existing saved data; add fields only.
- **Old history:** every existing page and every old record must keep working exactly as now.
- **Old pages:** pages already open with the old code keep running for a while, so new state must not break them.

**Time Left:** each game sends a summary to Time Left To Live (`functions/index.js`). In Phase 0, ask whether Training sessions should be sent too, and with what title.

## Stats

- **A Training section on `stats.html`, through `stats-engine.js`** (a new `trainingStats`, with tests):
  - each drill's PB, last 10 and trend, as inline SVG;
  - sessions this week;
  - time practised.
- **A "New PB!" moment** at the end of a drill, with the old best and the new one.
- **Every double and every triple:**
  - hit % merged across Doubles, JDC and Training, with each source shown;
  - "weakest doubles", each with the drill that trains it.
- **Training counts across the site:** in the streak and calendar (`practiceDays`), in `records`, and in hiding from stats.
- **CSV export:** his training history, without other players' emails.

## At the board (UX)

**The screen**
- Board mode from the shared kit, phone-first and good on the iPad:
  - a huge target with the bed lit;
  - three dart boxes saying what each dart counted as ("T20 hit", "S20, in the number", "Next door, in the 5", "Not seen, counted as a miss", "Not counted");
  - a strip of every target with its state (Bob's 27: 21 doubles with + and −; Big Triples: the 4 numbers; Game of 9: 20 → 15 → bull);
  - big buttons: 0/1/2/3 hits, Miss, and Undo with a count;
  - tap a dart to fix it.
- **Always on screen:** the target, darts left, the drill's key number, and pace against his best.
- **Input:** the board, S/D/T + number buttons, "hits this visit" buttons, a visit total, or the cameras, whichever suits the drill.

**Feedback**
- **The voice:** each line is worked out once and stored with the drill. Follow his Nov 17 rules: short, slow, pauses, "triple".
  - Say the drill's own number only where it is the point (Bob's 27's score after each double, the ladder's level).
  - Ask him in Phase 0.
- **Moments:** a new PB, a new ladder high, reaching the bull in Bob's 27, the last T20 of the Marathon, all 9 in.
  - Each lasts under 2.5 s, can be skipped, and respects reduced motion.
  - A hit gets a pulse; sound and vibration can be switched off on each device.

**Rules for every drill**
- **No dialogs during play:** never `alert()`/`confirm()`, which freeze the iPad. Show messages on the page.
- **CSS:** add `[hidden] { display: none !important; }` inside each new component.
- **Wake lock** while a drill runs.
- **Help:** a "How to play" sheet with the exact rules and sensible defaults on each drill.
- **Accessibility:** keyboard and ARIA. Use `aria-live` only for what matters.
- **Navigation:** add "Training" to `nav.js` (`data-page="training"`) and check that the bar still fits at 390 px.

## Engineering rules

- **No build step and no framework.** Plain HTML/CSS/JS and the compat SDK.
  - The new `public/training-engine.js` (UMD, `window.TrainingEngine`) holds a registry of drills. Each drill is configuration plus pure functions:
    - `id`, `name`, `category`, `blurb`, `why`, `defaults`;
    - `create`, `target`, `addDart`, `addVisit`, `cameraDart`, `cameraTakeout`, `isOver`, `summarize`;
    - `keyMetric` (higher or lower is better).
  - Darts use `classify()`'s shape.
  - Keep page scripts thin, and split UI files as they grow.
- **New files:** add each one to `scripts/check-app.cjs` and to the `test:engine` list in `package.json`. Bump the `?v=` on every script and stylesheet you change, on every page that loads it.
- **Shared files hold another session's uncommitted work:**
  - **The files:** `firestore.rules` (DartCounter rules), `functions/index.js` (44 DartCounter lines) and `docs/time-left-sync.md`. Commit only your own hunks; `git add -i`/`-p` don't work here, so stage a patch with `git apply --cached`, or use `git hash-object -w` + `git update-index --cacheinfo`.
  - **Never commit:** `TODO.md`, `functions/dartcounter*.js`, `docs/dartcounter-sync.md` or `scripts/dartcounter-*.sh`.
  - **Never read** the DartCounter token.
- **Deploys:** hosting deploys from the working copy, so check that nothing unfinished is in it. `station.html` updates itself within the hour.
- **Commits:** small, logical, ending with the attribution line your instructions give.

## Testing

- **`npm test`** (page checks, engines, functions, rules in the emulator) passes after every phase.
- **Engine tests:** `tests/training-engine.test.cjs` and the checkout tests cover:
  - every drill's scoring and its end;
  - bust and double out, the ladder floor, Bob's 27 below zero, the bull as a double;
  - undo and resume;
  - the camera visit rules (early end, unseen darts, a 4th dart, darts after a bust or checkout).
- **Checkout table tests:** every route adds up, ends on a double or the bull, and has no more darts than allowed. The bogey numbers have no 3-dart finish.
- **`npm run test:e2e`** (`E2E=training` to run just yours), using `tests/e2e/training.e2e.cjs` with the pretend station. It covers:
  - a full camera drill on two devices, with each dart counted once;
  - fixing a dart by tapping it;
  - Undo from the other device;
  - a reload in the middle of a drill;
  - a plan chaining two drills;
  - the finish, the saved record and the PB.

  Commit 400s from two devices writing at once are expected; nothing else is.
- **Screenshots** after each phase, with `tests/e2e/shots.cjs`: phone 390×844, iPad portrait 820×1180, iPad landscape 1180×820 and desktop 1280×900, plus each moment.

## How to work with Marwan

- **Plain words, short.** He reads on his phone.
- **One phase at a time.** After each one, give him:
  - what changed;
  - how to try it on his phone and at the board;
  - the test results and screenshots.

  Then ask before committing, pushing or deploying.
- **Never write to the live database without his explicit yes,** including backfills and test sessions.
- **Before opening any game page** (practice, tracker, JDC, Doubles, Training) in his signed-in Chrome, read `liveGames/{uid}` (`phase`, `at`). A game page joins a game in play as one of his devices. Close every tab when you are done.
- **After a deploy,** offer to watch his first real session, read-only, through the station's trace and the drill's state, visit by visit.
- **Report each session to the Developer Dashboard** as `AGENTS.md` says (project `2ae79298-d56d-46f4-a997-74090f5e21f8`).

## The work, in phases

### Phase 0: plan, mockups and decisions (no code)

- **Show him:**
  - what in this prompt differs from the code;
  - the files you will add or change, the Firestore shapes, the rules, and how it plugs into Stats and the cameras;
  - mockups of the drill picker, Bob's 27 in play (phone and iPad), the ladder with its route, a PB moment and the results. Use a static HTML page he can open on the iPad at the board.
- **Ask him to decide:**
  1. **Invisible Man:** in the bot game (recommended) or on the Training page?
  2. **Defaults from his numbers:** Game of 9 pass marks; the Invisible Man limit (27, moving by itself or fixed); the ladder's start and floor; Score More's solo target.
  3. **Bob's 27:** stop at zero, or play on?
  4. **The voice:** say the score after each double in Bob's 27, or not?
  5. **Time Left:** send Training sessions? With what title?
  6. **Merged stats:** Bob's 27 doubles in a combined "every double" view only (recommended), or also in Doubles' own figures?
  7. **Plans:** what goes in the 30- and 60-minute presets?

### Phase 1: the engine, the page and Bob's 27, end to end

- `training-engine.js` with the registry, plus the checkout table exports and their tests.
- `training.html`: picker, play screen and results; nav link; Board mode.
- Bob's 27 working with buttons and the cameras, with fix, undo, resume, abandon and save.
- The rules for `trainingSessions`/`trainingState` with their tests.
- **Stop and show him.**

### Phase 2: the checkout drills

121 Checkout Ladder and Two-Dart Finishes, with the route shown live and partial credit.

### Phase 3: the scoring drills

Triple 20 Marathon, Big Triples and Game of 9.

### Phase 4: pressure and warm-up

Invisible Man (where he chose), Score More (solo and two players with saved players), and Warm-up.

### Phase 5: stats and polish

- **Stats:** PBs, trends, the merged double and triple stats with "weakest doubles", the streak, time practised, `records` and today's plan.
- **Plans and export:** practice plans with presets, and the CSV.
- **Polish:** a "How to play" sheet for every drill, accessibility, and the phone at 390 px.

## What top of the line means here

- **Hands-free:** every drill runs from Start to the summary with the cameras. A misread is fixed in two taps, and a bad visit never shifts the rest.
- **Readable at 3 m:** the target, darts left and the drill's number, big. He can hear each visit.
- **Pitched at his level:** defaults come from his own numbers, so every drill is hard but winnable, and the levels move with him.
- **Something to act on:** after every session he knows how it compared, what's improving, and which drill to do next.
- **Honest:** every number is right, old history is untouched, and nothing is lost or counted twice.
- **Verified:** all tests pass, screenshots are shown at every size, and the live site is checked after every deploy.
