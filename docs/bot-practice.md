# Practice against a bot

`practice.html` (the "Play the bot" button in the tracker's header) is a separate page for playing 501-style and Cricket games against a bot, keeping a record of every game, and showing a heat map of where your darts land.

## Playing

- **Games:** x01 with a start score of 201, 301, 401, 501, 601 or 701, either double out (the default) or straight out, and Cricket (15 to 20 and the bull).
- **Your darts:** tap the board where each dart landed, as in the tracker. "Missed the board" records a dart that missed, and so does tapping the dark ring outside the board. "Undo dart" takes back a dart until the turn passes. After your third dart the turn passes to the bot by itself, after about a second (two and a half after a bust, so the message can be read). Undo in that pause cancels the hand-over, and the "Bot's turn" button skips the wait. A winning dart never passes on its own: it waits for "Finish game" so a mistap can be undone.
- **Score keypad (x01 only):** choose "Score keypad" under "Entering your darts" when you set up a game, or switch with the Board / Keypad buttons at the start of any turn. Type your three-dart total, or tap a common one (26, 40, 41, 43, 45, 60, 81, 85, 100, 140, 180), and press ENTER. The display shows what the score leaves, or that it is a bust; totals three darts cannot make (179, 178, 176, 175, 173, 172, 169, 166, 163) are refused. MISS enters 0 and BACK deletes a digit. To enter each dart instead, press + between them: 20 + 15 + 3 shows `20+15+3`, the total (38) and what it leaves. Each part must be a score one dart can make (a miss, 1 to 20, a double, a treble, 25 or 50), with up to three parts. Darts you leave out count as misses. Because every dart is known, a checkout is checked exactly: with a double out the last dart must be one that could be a double (an even score up to 40, or 50), and the game ends on that dart. MISS adds a 0 dart. A total that equals what is left is a checkout and asks how many darts it took (a checkout needs a legal finish, so 159 with a double out is a bust). A normal score goes straight to the bot; a bust or a win waits so BACK or "Undo score" can take it back. Darts entered this way have no landing point, so they count for the averages and dart totals but not for the board or the heat map, and the two ways of entering can be mixed in one game.
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
board radius (see dart-positions.md) and s is what it scored ("T20", "D16", "SB", "DB", "S5", "MISS").
A dart entered on the keypad is just { s: "?" }: it counts, but has no position.
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
