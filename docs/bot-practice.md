# Practice against a bot

(To play against another person, see [two-players.md](two-players.md).)

`practice.html` (the "Play the bot" button in the tracker's header) is a separate page for playing 501-style and Cricket games against a bot, keeping a record of every game, and showing a heat map of where your darts land.

## Playing

- **Games:** x01 with a start score of 201, 301, 401, 501, 601 or 701, either double out (the default) or straight out, and Cricket (15 to 20 and the bull).
- **Your darts:** tap the board where each dart landed, as in the tracker. "Missed the board" records a dart that missed, and so does tapping the dark ring outside the board. "Undo dart" takes back a dart until the turn passes. Board entry has a choice for what happens after your third dart, set under "After my third dart" when you start a game, or with the "Press Enter" switch on the game screen (it is remembered). With **Press Enter** on, the turn waits until you press the Enter button (or the Enter key on a computer), so you can Undo a mistapped dart first. With it off, the turn passes to the bot by itself, after about a second (two and a half after a bust, so the message can be read). Undo in that pause cancels the hand-over, and the "Bot's turn" button skips the wait. A winning dart never passes on its own: it waits for "Finish game" so a mistap can be undone, and "Undo dart" takes it back (a camera dart read as D16 that wasn't, say), until the game is finished.
- **Cameras:** with cameras set up on the Cameras page, "Camera: on" under the board enters each dart the cameras see, and pulling your darts out ends the visit. See [camera-scoring.md](camera-scoring.md). The visit rules (`cameraEvent` in `public/practice-engine.js`, Nov 13, 2026):
  - A dart goes in where the game reads it landed (the line under the board says what the game read, not the station's label).
  - A dart the cameras saw but couldn't read holds the darts after it until you tap it in (or press "Missed the board"), so the order stays right: on 40, S20 unread then D10 is a checkout, not a bust. Never tapped in, it is a miss when you pull your darts out.
  - Darts thrown while the bot is still throwing (you walked up early) wait, and go into your visit, in order, when the bot's visit is over. A pull-out while the bot throws, with nothing waiting, is the pull-out of your last visit and changes nothing.
  - Darts after your visit is over (three darts, a bust, a checkout) are not counted.
  - The pull-out ends the visit: darts the cameras didn't see are misses.
- **Score keypad (x01 only):** choose "Score keypad" under "Entering your darts" when you set up a game, or switch with the Board / Keypad buttons at the start of any turn. Type your three-dart total, or tap a common one (26, 40, 41, 43, 45, 60, 81, 85, 100, 140, 180), and press ENTER. The display shows what the score leaves, or that it is a bust; totals three darts cannot make (179, 178, 176, 175, 173, 172, 169, 166, 163) are refused. MISS enters 0 and BACK deletes a digit. To enter each dart instead, press + between them: 20 + 15 + 3 shows `20+15+3`, the total (38) and what it leaves. Each part must be a score one dart can make (a miss, 1 to 20, a double, a treble, 25 or 50), with up to three parts. Darts you leave out count as misses. Because every dart is known, a checkout is checked exactly: with a double out the last dart must be one that could be a double (an even score up to 40, or 50), and the game ends on that dart. MISS adds a 0 dart. The keypad is laid out to fit a phone screen without scrolling, and the question after a checkout, a bust or a win replaces the number keys instead of appearing below them. On a computer the keyboard works too: digits, + , Backspace and Enter. A total that equals what is left is a checkout and asks how many darts it took (a checkout needs a legal finish, so 159 with a double out is a bust). A normal score goes straight to the bot; a bust or a win waits ("Undo score" or "Bot's turn" / "Finish game") so it can be taken back. Darts entered this way have no landing point, so they count for the averages and dart totals but not for the board or the heat map, and the two ways of entering can be mixed in one game.
- **Editing your previous visit:** "Edit my last visit" (under the board or keypad, when it is your turn and you have not started throwing) takes you back to the start of your latest visit, even after the bot has played. Enter that visit again, by board or keypad, and it is saved as a correction. The game is then replayed with your new visit and the bot's visits exactly as they were thrown, so the bot's darts do not change and it does not throw again. If the correction finishes the game (or, in Cricket, changes who wins), the game ends there and later visits are dropped. "Cancel edit" leaves everything as it was, and quitting during an edit saves the game as it was before it. The button shows whenever you have a visit behind you and it is your turn. When the bot checks out, the game does not end at once: it waits on "The bot checked out", with "Edit my last visit" and "Finish game", so a dart of yours entered wrong (a double the cameras read as a miss, say) can still be corrected, and if the corrected visit wins, you win. A reload comes back to that wait without the bot throwing again. While a visit is being corrected, the cameras' darts and take-outs are ignored: tap those darts in. A game saved before entries were recorded is upgraded when it is resumed (board visits from the darts' positions, typed totals from the score); if a typed bust in it cannot be rebuilt, the button explains that the game cannot be edited.
- **Announcements:** each finished visit is said out loud, for you and for the bot (in a lower voice), like a professional caller - the voice's energy rises with the score rather than saying every total the same way: a normal return ("sixty", "forty five") is said plainly; a ton or more (100-139) is a little brighter; 140-159 and 160-179 are said louder and higher, in capitals ("ONE HUNDRED AND FORTY!", "ONE HUNDRED AND SIXTY!!"); and 180 itself is the highest pitch of any of them, said once, at a normal speaking pace rather than a rushed one - a big call is declared, not blurted. From 140 up, plus "Bust", "No score" and "GAME SHOT!", the call is a **real pre-recorded voice**, not the browser's own synthesiser - a genuine named PDC announcer's recording is copyrighted broadcast audio and can't be used, and a crowd-noise layer tried on top of the synthesised voice was taken back out for sounding like generic stock clapping, so instead these are pre-rendered offline with a proper neural TTS voice and shipped as static clips; see `public/audio/calls/README.md` for exactly what voice and why. A normal return, a ton, and everything in Cricket stay on the browser's voice, since there are far too many distinct numbers/combinations below 140 to feasibly pre-record each one - and those were never the calls that sounded weak. A visit that wins the leg gets its own separate, excited "GAME SHOT!" (its own recorded clip) said right after the score, regardless of what the score was. In Cricket it says the marks (and points) for the visit, with the same lift for a clean sweep (three marks in one visit). It is spoken when the visit ends, so with "Press Enter" on it waits for Enter, and a corrected visit is announced again. The "Sound" button at the top mutes both the voice and any playing clip (it is remembered). Browsers only let a page start speech or audio from inside a tap or key press, and an iPad is strict: until one line has been started inside a tap, Safari drops every other one without a sound or an error, and only the end of a touch counts (touchend / click), not touching down. The scores are mostly called from timers (camera darts, the bot, auto-pass, the other device), so before Nov 9, 2026 the voice stayed silent until a tap happened to call a score itself (a corrected visit), often a couple of games in. Now every tap and key press warms the voice (a silent space) and the recorded clips' audio up until a line is actually heard, and a score that is never heard (no start within 6 s, or "not-allowed") marks the voice blocked again. While it is blocked, a **Tap to hear the scores** button shows by Sound; a tap on it says "Scores on". A game picked up without any tap (another device's game) can't speak until that tap. The Sound button is hidden if the browser has no voice at all. The tiers are `SCORE_TIERS`/`clipForScore`/`FIXED_CLIPS` in `public/practice-engine.js` (`visitAnnouncement`), checked by `tests/practice-engine.test.cjs`; playback is `playSeg`/`speakSeg`/`warmUpSpeech`/`speechBlocked` in `public/practice.html`.
- **The bot** throws one dart at a time, drawn in blue. It aims for a checkout when it has one, plays a set-up shot when it is close but has no finish, and treble 20 otherwise (Cricket: the highest number it has not closed, then points on numbers you have open). Its checkout visit is closed like any other (since Nov 13, 2026): it gets its "Game shot", it is in the Rounds table, and its saved average counts it (a five-dart 101 is 60.6; it used to save 36.0). Enter finishes the game while the bot's checkout waits, like "Finish game".
- **Checkout routes** (`checkoutRoute` in `public/practice-engine.js`), shown on your turn and played by the bot, are the standard ones: fewest darts, then the easiest double to finish on (D16 and D20 best, then D8, D10, D12; odd doubles and D1 last) set up with singles rather than trebles, and the bull only when it's needed (170, 167, 164, 161, 50 with one dart). So 41 is S9 D16, 53 S13 D20, 60 S20 D20, 61 T15 D8, 116 T20 S16 D20. With one or two darts left it is the best route for those darts; with no finish possible it says what to leave ("Set up: S13 leaves 40"; on 169, T20 · T20 · S17 leaves 32).
- **Averages:** a bust counts as a three-dart visit however it was entered (on the board it stops on the dart that bust; a typed total or typed darts bust too), so the average no longer depends on how you entered your darts. Only finished visits count.
- **Levels:** Beginner, Casual, Club, League and Pro, or an average you set (see "The bot" below for how it throws and the averages). Games started before Nov 13, 2026 keep the first bot (`RANKS` in `public/practice-engine.js`: a spread of 0.30, 0.18, 0.12, 0.085 or 0.062 of the drawn board's radius, which measured 23.8, 36.4, 51.5, 70.9 and 94.0). There is no language model involved; it is all local and free.
- **A match (more than one game):** "Play", when you set up a game, offers a single game or first-to-N (2, 3, 4, 5, 7, 9 or 11 wins) - the same choice works against the bot or another player. Who throws first alternates each game after the first, regardless of who won the last one. When a game inside a match ends, the score so far ("Match: You 2 - 1 Bot") is shown and "Next game" starts the next one with the running score kept; "Play again" and "Change setup" do not appear until the match itself is decided (or you quit, which ends the whole match, not just the game). Every game in a match is still saved individually, exactly as a single game would be - there is no separate "match" record. A match in progress is kept in the browser like an unfinished game is, and offered back ("Continue match") even between games, not only mid-game.
- An unfinished game is kept for your account (see below) and in the browser, and the setup card offers to resume it. "Quit game" saves it as unfinished if you have thrown a dart.

## The bot

Since Nov 13, 2026 the bot throws on a real board (`practice-engine.js`, model 2). The first bot threw on the app's drawn board, whose treble and double rings are wider than a real board's (0.08 and 0.10 of the radius against about 0.047), so the stronger levels hit doubles far too often and the averages weren't what the levels said. Model 2 aims at the middle of a bed on a real board (in millimetres over the 170 mm radius), its dart lands with a spread, and the dart is moved to the drawn board ring by ring (`realToApp`, as the cameras do): it scores what it would on a real board, and its dots and heat map still line up.

- **Two spreads:** one for scoring darts, one for doubles. They come from a table measured by simulating 700 legs of 501 at each spread (`CALIB` in the engine); `botParams(average, style)` picks the spreads for an average.
- **Levels** (the averages it plays at, and the share of its darts at a double that win, for the standard style): Beginner 30 (15%), Casual 42 (20%), Club 53 (25%), League 72 (35%), Pro 95 (49%). Or **Set its average** (15 to 110).
- **How it plays:** Standard; **Steady grinder** (smaller scores, rarely misses a double: Club checks out 32%); **Heavy scorer** (big scores, weak doubles: Club 20%). Each plays at the same average.
- **Its rhythm** varies (about 0.6 to 1.1 s between darts) and it takes a breath before a double.
- **A game keeps its bot** (`game.botModel`, `game.bot`: level, average, style), through Edit and Undo too, and every device throws the same darts. A game started before keeps the first bot.
- **The ladder:** start at an average of 52; win 2 of 3 games at a step to move up 3. It's worked out from your saved ladder games, so nothing else is stored; the setup shows your step and the highest average you've beaten.

## Matches

- **Legs:** one leg, or first to 2, 3, 4, 5, 7 or 9 legs. Who throws first alternates each leg. Each leg is saved as its own game with the match's id (`matchId`), its number (`leg`) and `legsToWin`.
- **Bull-up:** "Who throws first: Bull-up". Before the first leg, you throw one dart at the bull (tap it or let the cameras see it), then the bot; the closer (in millimetres on a real board) throws first, and a tie throws again. Against the bot only.

## Board mode

A full-screen scoreboard to read from the oche, on the shared Board mode kit (`public/board-mode.js` + `.css`, also used by Doubles and the tracker). Turn it on with **Board mode** on the setup screen or under the board; it stays on for that device until **Exit**, and the screen stays on while a game runs.

- **The score to throw at**, huge, under YOUR THROW or BOT THROWING (with two players, the name), and the other side's score and average beside it.
- **Three dart boxes** with what each dart scored ("T20 · 60", "D16 · Game shot", "S5 · Bust", "Not seen · Counted as a miss" for a dart the cameras didn't see before the pull-out, "Not read · Tap where it landed"), the visit's total and what it leaves, and the route under the dart count: "You require 81: T19 D12" at the start of a visit, "Checkout" during it, or "Set up · leaves 40". The route's next bed is lit on the board.
- **The bot's visit stays on the board** (its darts and "Club bot scored 85 · leaves 116") until your first dart lands, so walking back from the board you see what it did.
- **The strip** shows the last 12 visits of both sides (100+ outlined), with the round and both averages.
- **Fixing a dart:** tap a dart of the visit in progress (the winning dart too, until the game is finished) and choose what it was: the beds of that number, the bull, Missed the board, or Another number (then the ring). The visit is thrown again with it; darts after a bust or a checkout no longer count.
- **Undo** takes back a dart of the visit in progress; with none, it goes back across visits: the bot's visit comes off and your last visit opens again without its last dart (the bot throws its visit again after yours). It works from any device.
- **Big buttons:** Missed the board, Edit my last visit, and Bot's turn / Enter / Finish game when they apply. A tap on the board enters a dart where you tapped.
- **Pulling your darts out after your winning double finishes the game**: no walk to the iPad to tap Finish. When the bot checks out, the game still waits (so a misread winning double of yours can be corrected with Edit my last visit).
- **Moments:** a 180, a ton-plus finish, game shot and the nine-dart watch (a 501 leg still on for nine darts after six) fill the screen for about two seconds (a tap skips it), on every device in Board mode.
- **The caller** says "You require 81" after the bot's visit when you have a finish on (with two players, "Sam, you require 81"). It is the browser's voice: the recorded clips cover only 140 to 180, Bust, No score and Game shot (making "You require" clips needs the Piper voice, which isn't installed here).
- **The match report** at the end (here and on the game-over card): each side's 3-dart average, first-9 average, checkout (darts thrown with a finish on, and the one that won), highest finish, 60+/100+/140+/180s and darts; a histogram of your visit scores; where your darts went; and your average against your last 10 games.

## On more than one device

The game is the same on every device signed in to your account: start it on the computer and the iPad joins it, and a dart, an Undo, a correction or the bot's darts on either one show on both. Any of them can be used to play. A device opening the page while a game is on (changed in the last half hour) goes straight into it; an older one is offered to resume.

- The game is one document, `liveGames/{uid}`, rewritten with each change ([`public/live-sync.js`](../public/live-sync.js)). Each change is a new version made from the latest one, and the Firestore rules only take a version made from the latest: when two devices change the game at the same moment (both putting in the dart the cameras saw), only the first gets in, and the other takes that one.
- **Cameras on both:** each camera dart carries the camera station's count (`seq`), and the game keeps the last one put in (`camSeq`), so a dart goes in once however many devices saw it. A camera dart a device put in whose version didn't get in (the other device changed something else at the same moment) goes in again on top of the version that did.
- **The bot's darts, a finished visit passing over and a match's next game** are done by the device that made the latest change. The others wait, and do it themselves if nothing comes for a few seconds (that page was closed, or the iPad went to sleep). The bot's darts land in the same place wherever they are worked out (each is seeded from the game and how far into it the bot is), so a device taking over throws what the other would have.
- **Finishing:** the device the game is finished on saves it, under the game's id, so it is saved once; the others show the same game-over screen. "Play again" or a match's next game on any device takes all of them along.
- **Each device's own:** Board/Keypad, Camera on/off and Sound. "Press Enter" is the game's, the same on all of them. Every device calls the scores, so mute the one you don't want to hear.

## What is saved

Each finished, lost or quit game is one document in `botGames/{id}`:

```text
uid, timestamp ("2026-09-20 19:30", when it started), kind ("x01" or "cricket"),
startScore and doubleOut (x01 only), rank, first ("player" or "bot"),
result ("won", "lost" or "abandoned"), durationSec, rounds,
playerAvg and botAvg (three-dart average, or marks per round in Cricket),
playerScore and botScore (score left, or Cricket points),
playerDarts and botDarts: [{ x, y, s }] where x and y are the landing point as fractions of the
board radius (see dart-positions.md) and s is what it scored ("T20", "D16", "SB", "DB", "S5", "MISS").
A dart entered on the keypad is just { s: "?" }: it counts, but has no position.
botModel, botTarget, botStyle, ladder (the real-board bot: its average, how it plays, a ladder game),
matchId, leg, legsToWin (a leg of a match). rank is the nearest named level.
visits (since Nov 13, 2026): every visit in order, { w: "p" | "b", d: [what each dart scored],
s: the score (0 for a bust; marks in Cricket), r: what was left, b: 1 for a bust, p: Cricket points }.
```

A saved game is never edited. Rules for the collection are in `firestore.rules` (`validBotGame`): the owner reads, creates and deletes; nothing updates. If saving fails the page says so, keeps the game on the device and offers "Try saving again". It tries again on the next visit too.

The heat map on the page and the history list are built from your saved games. The heat map can show your darts or the bot's, for all games or one kind.

## Time Left

`syncBotGameToTimeLeft` (in `functions/index.js`) sends one summary per game to Time Left, the same way sessions are sent: only for `DARTS_OWNER_UID`, category `dartsRecord`, `sourceCollection: botGames`, and a title such as "Bot practice: 501 vs Club (won)". Deleting a game on the page tells Time Left it is gone. The dart positions stay in Darts Tracker; only the summary is sent. It uses the same configuration and secret as the sessions sync (see `time-left-sync.md`).

## Caching

`firebase.json` sends `Cache-Control: no-cache` for everything, so the browser checks for a new copy each time (a cheap conditional request) instead of holding the page for an hour. The page and `practice-engine.js` have to be the same version, and separate one-hour caches let a phone run a new page with an old engine after a deploy.

## Deploying

The new function and rules must go out before the page is useful:

```bash
firebase deploy --only firestore:rules,functions:syncBotGameToTimeLeft --project dartstracker2026
firebase deploy --only hosting --project dartstracker2026
```

Deploy the rules before hosting, or saving from the page is refused.

## Where the code is

- `public/practice-engine.js`: rules, scoring, checkouts, the bots and the heat map maths, with no page or Firebase code. The board geometry in it must match `drawBoard` and `scoreFromPoint` in `index.html`.
- `public/practice.html`: the page.
- `public/live-sync.js`: the game shared between devices (`tests/live-sync.test.cjs`).
- `public/board-vision.js` and `public/board-camera.js`: reading darts from cameras (see `camera-scoring.md`).
- `public/audio/calls/`: the pre-recorded voice clips for the 140+/Bust/No score/Game shot announcements, and where that voice came from (`README.md`).
- `tests/practice-engine.test.cjs`, `tests/firestore.rules.test.cjs` and `functions/index.test.js`: the tests. `npm test` runs them all, and CI does too.
