# Practice against a bot

`practice.html` (the "Play the bot" button in the tracker's header) is a separate page for playing 501-style and Cricket games against a bot, keeping a record of every game, and showing a heat map of where your darts land.

## Playing

- **Games:** x01 with a start score of 201, 301, 401, 501, 601 or 701, either double out (the default) or straight out, and Cricket (15 to 20 and the bull).
- **Your darts:** tap the board where each dart landed, as in the tracker. "Missed the board" records a dart that missed, and so does tapping the dark ring outside the board. "Undo dart" takes back a dart until you pass the turn. After your third dart (or a bust, or a win) press the button to hand over.
- **The bot** throws one dart at a time, drawn in blue. It aims for a checkout when it has one and treble 20 otherwise (Cricket: the highest number it has not closed, then points on numbers you have open).
- **Levels:** Beginner, Casual, Club, League and Pro. A level is the spread of the bot's throws around its aim, as a fraction of the board radius: 0.30, 0.18, 0.12, 0.085 and 0.062. In a 501 game they average roughly 30, 42, 55, 72 and 95 per three darts, and `tests/practice-engine.test.cjs` checks the order and a sane range. Change `RANKS` in `public/practice-engine.js` to adjust them. There is no language model involved; it is all local and free.
- An unfinished game is kept in the browser, and the setup card offers to resume it. "Quit game" saves it as unfinished if you have thrown a dart.

## What is saved

Each finished, lost or quit game is one document in `botGames/{id}`:

```text
uid, timestamp ("2026-09-20 19:30", when it started), kind ("x01" or "cricket"),
startScore and doubleOut (x01 only), rank, first ("player" or "bot"),
result ("won", "lost" or "abandoned"), durationSec, rounds,
playerAvg and botAvg (three-dart average, or marks per round in Cricket),
playerScore and botScore (score left, or Cricket points),
playerDarts and botDarts: [{ x, y, s }] where x and y are the landing point as fractions of the
board radius (see dart-positions.md) and s is what it scored ("T20", "D16", "SB", "DB", "S5", "MISS")
```

A saved game is never edited. Rules for the collection are in `firestore.rules` (`validBotGame`): the owner reads, creates and deletes; nothing updates. If saving fails the page says so, keeps the game on the device and offers "Try saving again". It tries again on the next visit too.

The heat map on the page and the history list are built from your saved games. The heat map can show your darts or the bot's, for all games or one kind.

## Time Left

`syncBotGameToTimeLeft` (in `functions/index.js`) sends one summary per game to Time Left, the same way sessions are sent: only for `DARTS_OWNER_UID`, category `dartsRecord`, `sourceCollection: botGames`, and a title such as "Bot practice: 501 vs Club (won)". Deleting a game on the page tells Time Left it is gone. The dart positions stay in Darts Tracker; only the summary is sent. It uses the same configuration and secret as the sessions sync (see `time-left-sync.md`).

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
- `tests/practice-engine.test.cjs`, `tests/firestore.rules.test.cjs` and `functions/index.test.js`: the tests. `npm test` runs them all, and CI does too.
