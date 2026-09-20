# Where each dart landed

When you place a dart by tapping the board, the app remembers exactly where the tap landed and draws a dot there. The positions are saved with the session, and loading the session shows the dots again. Sessions saved before this was added have no positions, and the board says so when you load one.

## What is stored

A session document has an optional `positions` field, lined up slot for slot with `entry`:

```text
entry:     { "20": ["T", "D", "-"], "BULL": ["D", "-", "-"], ... }
positions: { "20": [ {x: 0, y: -0.58}, {x: 0.02, y: -0.95}, null ], "BULL": [ {x: 0.02, y: 0.01}, null, null ] }
```

- `x` and `y` are the distance from the board's centre as a fraction of its radius, each from -1 to 1, with `y` growing downward. A tap at the top of the triple ring on the 20 is about `{x: 0, y: -0.58}`. Because they are fractions, they mean the same thing on any screen size and on any device.
- A slot is `null` when the dart was typed into the table (it has no position) or the slot is empty.
- Only targets that have at least one position are stored, and the field is left out entirely for a session with no tapped darts.
- Retyping a slot in the table drops that slot's position, because the dart it described has changed. Slots that keep the same value keep their position. Undo restores both.
- Taps that land off the board count as a miss, as before, and are not recorded.
- Positions also travel with the live draft, so a second device shows the same dots.
- Positions stay in the app. They are not sent to Time Left.

## Rules and deploying

The Firestore rules accept `positions` as an optional map of at most 21 targets on new sessions, updates and live drafts (`validPositions` in `firestore.rules`). Any other unknown field is still refused.

Deploy the rules **before** the app, or saving from the new page is rejected:

```bash
firebase deploy --only firestore:rules --project dartstracker2026
firebase deploy --only hosting --project dartstracker2026
```

The old page keeps working against the new rules, since `positions` is optional.
