# Stats, records and the practice plan

- **The page:** `public/stats.html` ("Stats" in the navigation). **The maths:** `public/stats-engine.js` (tested in `tests/stats-engine.test.cjs`), which uses each game's own engine.
- **The navigation** shared by every page: `public/nav.js` + `public/nav.css` (Tracker, Bot game, JDC Challenge, Doubles, Stats, Cameras). Each game's page has its Board mode button.

## What counts

Every number, record and plan item leaves out:
- tracker sessions saved part way through (`complete: false`);
- bot games not finished (`result: "abandoned"`): the 22 test games with averages over 90 from the taps around noon on 2026-09-27 were all left unfinished, so they never count;
- anything you hid. **Hide from stats** (in each game's Recent list) adds the game's id to `statsHidden/{uid}.ids`; **Show in stats** takes it out. Nothing is deleted or changed in the saved game.

Each number on the page says what it means next to it.

## The page

- **Your practice:** days in a row (up to today, or up to yesterday if you haven't played yet today), the best run, the days practised, a calendar of the last 26 weeks, **records** (each with its definition and date) and **milestones**.
- **Ranges:** 30 days, 90 days, 1 year or all.
- **Tracker:** sessions, average, best, hit rate (darts in the number thrown at), marks per dart, S/D/T; hit rate on darts 1, 2 and 3 (sessions that kept every dart, since Nov 13, 2026); session totals on a chart with the average of the last 7; each number's hit rate, last 10, lifetime and trend, and its best; **where your darts land** at a number (dots from taps and the cameras, and which neighbour the misses go to: "Your 20s miss into the 5").
- **Bot game:** finished games, won, 3-dart average, first 9, checkout (darts that won a game out of darts thrown with a finish on), highest finish, 60+/100+/140+/180; the average per game on a chart; by level and by format. Older games' visits are rebuilt by playing their darts again; games with darts typed as totals can't be, and count in games and wins only.
- **JDC Challenge:** rounds, best, average, last 10, each part, the score per round, each number (points, marks per dart, Shanghais), each double.
- **Doubles:** rounds, the weakest doubles, minutes per round, each double's hit rate per dart, and **where your darts at a double go** (in, inside the wire, outside it, next door) from the darts the cameras saw.

## Today's practice

On the tracker page, one item per game, worked out from what's weakest lately (`practicePlan`), each opening its game; it's ticked when you've played that game today:
- a tracker session, naming your three lowest hit rates over your last 10 sessions (opens Board mode);
- a Doubles round, naming the doubles with the lowest hit rate per dart over your last 10 rounds;
- a game against the bot, with your checkout lately;
- a JDC Challenge round, naming the part with the most points left.

## Checking it against your real games

The stats are checked against made-up games in the tests. Checking them against your saved games needs reading your account, which is done in your signed-in browser.
