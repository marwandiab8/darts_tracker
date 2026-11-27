# DartCounter matches in Time Left To Live

DartCounter (app.dartcounter.net) sends no match emails and has no export, so the tracker pulls the
matches itself from the API the DartCounter web app uses, and forwards each one to Time Left To Live
the same way the bot games and Doubles rounds go. In Time Left a match shows under Darts on the
Activity wheel and in the journal's day at a glance, titled like
`Won 3–0 vs Simon on DartCounter (501, avg 49.01)`, with the opponent, score, both averages, legs,
highest finish and score, online/local/ranked/bot, and the match length.

## How it works

- `pullDartCounterMatches` (functions/dartcounter.js, scheduled every 15 minutes, region
  northamerica-northeast1) calls `GET https://api.dartcounter.net/matches?limit=25&page=N` with the
  owner's DartCounter token (secret `DARTCOUNTER_TOKEN`). It keeps each finished match the owner played
  in (`DARTCOUNTER_USER_ID` tells the owner's line from the opponents') once, as
  `dartcounterMatches/{matchId}`: settings, the owner's line (`me`) and the `opponents`.
- The first runs also read the older pages, up to 12 pages a run, until the whole history is in
  (`dartcounterSync/state.backfillDone`). Afterwards a run reads page 1 and stops at the first match it
  already has, so a quiet spell costs one small request every 15 minutes.
- `syncDartCounterMatchToTimeLeft` forwards every new `dartcounterMatches` document to Time Left through
  the existing Darts Tracker connection (`sourceApp` DartstRacker2026, `eventType`
  completed_darts_match, `metadata.platform` DartCounter). The DartCounter match id is the record id, so
  a match is never logged twice, and a match deleted in Time Left stays deleted.
- A document is written once and never rewritten, so Time Left is posted to once per match.

## Setup and the token

The token is the `accessToken` the DartCounter web app keeps in the browser (Chrome, signed in at
app.dartcounter.net: F12 > Application > Local Storage > app.dartcounter.net > accessToken, without the
quotes). It is pasted once, hidden, into `scripts/set-dartcounter-token.sh`, which stores it in Secret
Manager, deploys the two functions and the rules, and runs the first pull. The token is never printed,
logged or committed.

If DartCounter ever refuses the token, the run records `lastStatus: token-rejected` in
`dartcounterSync/state` and logs an error; nothing else breaks. Paste a fresh token with the same script.

`scripts/dartcounter-sync-status.sh` prints the last run: status, new matches, pages read, backfill
progress, DartCounter's total, and the last error if any.

## Firestore

- `dartcounterMatches/{matchId}`: `uid`, `matchId`, `startedAt`/`finishedAt` (unix seconds),
  `durationSec`, `settings` (startScore, endWith, goalAmount, isBestOf, hasSets, isOnline, isRanked,
  vsCpu, players…), `me` and `opponents[]` (name, result, legsWon, setsWon, average, highestFinish,
  highestScore, checkedLegs, isCpu, cpuLevel). Owner can read; only the function writes.
- `dartcounterSync/state`: server-only run state.

Tests: `functions/dartcounter.test.js` (mapping, clamping, paging, token refusal), run with
`npm test` in `functions/`.
