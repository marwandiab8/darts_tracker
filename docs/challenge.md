# JDC Challenge

`challenge.html` ("JDC Challenge" in the tracker's header and on the practice page) is a solo practice round with a
fixed maximum, so progress is measured on the same scale every time. Scoring is in `public/challenge-engine.js`,
checked by `tests/challenge-engine.test.cjs`.

## The round (57 darts, maximum 3,330)

1. **Shanghai 10-15:** three darts at each number. Single, double and treble score 1x, 2x and 3x the number. A single,
   a double and a treble of the same number in one visit is a Shanghai: +100.
2. **Doubles:** one dart at each of D1-D20, then the bull. Each hit scores 50.
3. **Shanghai 15-20:** as part 1.

Each dart is entered with a key (Miss / Single / Double / Treble, or Miss / Hit for a double), or 0-3 and Backspace
on a keyboard. While playing, the score is compared with your best round at the same point. An unfinished round is
kept in the browser and offered back; only finished rounds are saved.

## What is saved and shown

- `challengeGames/{id}`: `uid, timestamp, total, part1, part2, part3, trebles, shanghais, doublesHit, darts (57 numbers:
  0 miss, 1 single, 2 double, 3 treble), durationSec`. The rules check the shape and that the parts add up to the
  total; a round is never edited, and only its owner reads or deletes it. A round that can't be saved (offline) is kept
  on the device and saved the next time the page opens.
- Progress: rounds, best, average of the last 10 (and the change on the 10 before), each round on a chart with a
  five-round moving average, each part's average against its maximum, the part with the most to gain, and the hit
  rate on every double with the three weakest named.
- Each saved round is sent to Time Left by `syncChallengeGameToTimeLeft` (owner only): a timed Darts practice item
  titled "JDC Challenge: score / 3330" with each part, doubles hit, trebles and Shanghais. Deleting a round marks it
  deleted in Time Left. See [time-left-sync.md](time-left-sync.md).
