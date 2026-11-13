# JDC Challenge

`challenge.html` ("JDC Challenge" in the tracker's header and on the practice page) is a solo practice round with a
fixed maximum, so progress is measured on the same scale every time. Scoring is in `public/challenge-engine.js`,
checked by `tests/challenge-engine.test.cjs`.

## The round (57 darts, maximum 3,330)

1. **Shanghai 10-15:** three darts at each number. Single, double and treble score 1x, 2x and 3x the number. A single,
   a double and a treble of the same number in one visit is a Shanghai: +100.
2. **Doubles:** one dart at each of D1-D20, then the bull. Each hit scores 50.
3. **Shanghai 15-20:** as part 1.

Each dart is entered with a key (Miss / Single / Double / Treble, or Miss / Hit for a double, and **3 misses** for the
rest of a visit), or 0-3, X and Backspace on a keyboard, or by the cameras. While playing, the score is compared with
your best round at the end of each visit (`pace`: the same finished visits on both sides, so the visit you're in never
counts against the best round's total from before it). Only finished rounds are saved.

**Visits.** Every visit at the board is 3 darts: three at one number in the Shanghai parts, and one at each of three
doubles in order in the doubles part (D1 · D2 · D3, ..., D19 · D20 · Bull). The bull is the bullseye only (decided
Nov 13, 2026: the outer bull is a miss).

**One round on every device** (since Nov 13, 2026). The round in play is kept in your account (`liveChallenges/{uid}`,
versions as in the tracker, `live-sync.js`): a second tab, the iPad and the computer all show it, and any of them can
add darts. Every change is an op; one refused because another device's change got in first is applied again on top,
so a dart is never lost. Offline, play goes on and the darts go up when the connection is back. A round the page from
before left in the browser becomes the shared round when the page opens. **Undo** takes back the last change (a dart,
a fix, a pull-out's misses), up to 10, from any device.

**The cameras** (Cameras on the play card, remembered on each device; see `challenge-engine.js`):
- a visit belongs to the darts the cameras see from their first one after a pull-out, and is exactly 3 darts: nothing
  ends it early;
- a 4th dart before the pull-out isn't counted (the note says to pull your darts out), so one bad visit can't shift
  every later target;
- at the pull-out the visit's darts not seen are misses, at that visit only;
- a dart they couldn't read waits for a tap (the keys), and the darts read after it wait behind it, so each goes to its
  own target (in the doubles part every dart is a different double); never tapped, it's a miss at the pull-out.

**Board mode** (on the start screen and the play card; remembered on each device; the first time it turns the voice
on): the target huge, with the visit's three doubles named and lit on the board (a whole number lit in the Shanghai
parts); the three dart boxes ("T17 · 51", "Miss · In the 2", "D8 · +50", "Not seen", "Not read", "Held"); the score
with pace against your best and against the average of your last 10 rounds at the same visit, and the most still
possible; the Shanghai so far ("T ✓ · need the S and D for +100"); the 19 visits; big keys. Tap a dart (its box or its
dot) to fix it. The screen stays on.

**Moments** fill the screen for a couple of seconds (a tap skips one): a Shanghai, all three doubles of a visit, going
ahead of your best, a part beating your best for that part, and a new best round.

**The voice** (Voice on the play card, per device) says each dart ("Treble.", "Hit.") and each visit with its score and
how it stands against your best ("17: treble, single, miss. 68. 40 ahead of your best.", "D 7, D 8, D 9: hit, miss,
miss. 50.", "SHANGHAI! 160."). The line goes with the round, so every device with Voice on says it once.

**After the 57th dart** (since Nov 13, 2026) the round isn't saved at once: it says "Round complete" and saves after
10 seconds, or at once with "Save the round". Undo in that time takes the last dart back, so a mis-tapped last dart
can be fixed. Whichever device saves it, it is saved once (its own id), and the round ends on every device.

**The summary** after a round: each part against the average of your last 10 rounds and your best for that part; each
number's points and S/D/T; the 21 doubles on a board (the ones hit lit); and what to practise next (the doubles with
the lowest hit rate over this round and your last 10, and the number where the fewest marks went in).

## What is saved and shown

- `challengeGames/{id}`: `uid, timestamp, total, part1, part2, part3, trebles, shanghais, doublesHit, darts (57 numbers:
  0 miss, 1 single, 2 double, 3 treble), durationSec`. The rules check the shape and that the parts add up to the
  total; a round is never edited, and only its owner reads or deletes it. Each round saves under its own id (made when
  it starts), so a retry can never save it twice. From the moment it's finished until the save is confirmed it is kept
  on the device, in a list (a second round not saved never replaces the first); offline, it's saved as soon as the
  connection is back or the page next opens. Your rounds are followed live, so one saved on another device shows up
  without a reload, and if they can't be read the page says so rather than treating the round as your first.
- Progress: rounds, best, average of the last 10 (and the change on the 10 before), each round on a chart with a
  five-round moving average, each part's average against its maximum, the part with the most to gain, and the hit
  rate on every double with the three weakest named.
- Each saved round is sent to Time Left by `syncChallengeGameToTimeLeft` (owner only): a timed Darts practice item
  titled "JDC Challenge: score / 3330" with each part, doubles hit, trebles and Shanghais. Deleting a round marks it
  deleted in Time Left. See [time-left-sync.md](time-left-sync.md).
