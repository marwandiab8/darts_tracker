# Where we left off (darts tracker)

Last updated 2026-11-14 (the DartCounter section; the rest is from 2026-09-27). Project `dartstracker2026`, site https://dartstracker2026.web.app, repo `marwandiab8/darts_tracker`. Everything below is committed and pushed except the DartCounter files (`functions/dartcounter.js` and its test, `scripts/set-dartcounter-token.sh`, `scripts/dartcounter-sync-status.sh`, `docs/dartcounter-sync.md`, and the matching edits to `functions/index.js`, `firestore.rules` and `docs/time-left-sync.md`).

## What is live

- **Tracker** (`index.html`): tap-the-board entry records where each dart landed (`docs/dart-positions.md`); owner-only Time Left sync; rules in the repo.
- **Practice page** (`practice.html`, "Play the bot" in the tracker header; docs in `docs/bot-practice.md`):
  - 501-style games (201 to 701, double or straight out) and Cricket against five bot levels.
  - Entry by board, or a DartConnect-style score keypad (type a total, tap a preset, or `20+15+3` dart by dart). "Press Enter" option, and the turn passes to the bot by itself otherwise.
  - "Edit my last visit" replays the game with a corrected visit and the bot's darts untouched.
  - Spoken score announcements with a Sound on/off button, in a caller's voice whose energy rises with the score (a plain tone under 100, louder and higher through the 100s-160s, peaking at 180). Tried layering free Mixkit crowd-noise clips on top of the synthesised voice - sounded like generic stock clapping, pulled back out. What's live now instead: every score 140-180, plus "Bust", "No score" and "GAME SHOT!", plays a real pre-recorded voice (Piper neural TTS, generated locally, CC BY 4.0 LibriTTS-R voice - see `public/audio/calls/README.md`) instead of the browser's synthesiser; everything else (under 140, and all of Cricket) stays on the browser voice since there are too many distinct phrases to pre-record (`docs/bot-practice.md`).
  - Those recorded clips were completely silent on iPhone at first: Firebase Hosting answers Safari's byte-range probe with a plain 200 instead of 206, and iOS Safari refuses to play media from a server that won't range-serve it. Fixed by playing the clips through the Web Audio API (`fetch` + `decodeAudioData` + `AudioBufferSourceNode`) instead of `<audio>` elements, which sidesteps range requests entirely - confirmed working on a real phone. Also tried a British voice (Piper `en_GB-alan-medium`/`en_GB-northern_english_male-medium`) and a more dramatic American one (`en_US-norman-medium`), and a ~15% faster speaking rate, to address a "wrong tone/accent" complaint about the current LibriTTS-R voice; after hearing samples, decided to keep the current voice as-is. Don't re-relitigate this unless asked.
  - Every game is saved (`botGames`), shown in a history list and a heat map, and one summary per game goes to Time Left (`syncBotGameToTimeLeft`).
  - Mid-match, the next game now starts on its own about 5 seconds after the score screen appears (long enough to read the stats and hear "Game shot!"), instead of waiting for a "Next game" tap; the button is still there to skip the wait.
- **Two players on one phone** (`docs/two-players.md`): second player added by email (required); saved in `versusGames`.
- Fixed iPad taps occasionally being misread as double-tap-zoom or a pan: the tracker's viewport meta used to disable zoom outright (`maximum-scale=1, user-scalable=no`), but modern Safari ignores that for accessibility and let zoom gestures through inconsistently anyway. Now the viewport actually allows zoom (`maximum-scale=5`) and both pages set `touch-action: manipulation` on `html, body` so a plain tap isn't mistaken for a zoom/pan gesture, while pinch-zoom keeps working on purpose. Not yet confirmed on a real iPad.
- Hosting sends `Cache-Control: no-cache` so the page and `practice-engine.js` cannot get out of step.
- Deployed: Firestore rules (including `versusGames`), hosting, and the functions `syncDartsPracticeSummaryToTimeLeft`, `syncBotGameToTimeLeft`, `backfillDartsPracticeSummariesToTimeLeft`.

## Not done: DartCounter matches (waiting on you)

Checked 2026-11-14 in the evening: DartCounter is **not** being monitored yet. The functions
`pullDartCounterMatches` and `syncDartCounterMatchToTimeLeft` are in the repo (`npm test` in `functions/`
passes, 56 tests), the Firestore rules for `dartcounterMatches` and `dartcounterSync` are deployed, and
`functions/.env.dartstracker2026` has `DARTCOUNTER_USER_ID`, but there is no `DARTCOUNTER_TOKEN` secret, no
Cloud Scheduler job, no `dartcounterSync/state` document, and `dartcounterMatches` is empty. Claude in auto
mode cannot finish this: the permission classifier refused `firebase functions:secrets:set` (even with the
placeholder value `unset`) and `firebase deploy` on 2026-11-14, so the token and the deploy are yours:

1. In Chrome, signed in at https://app.dartcounter.net: F12 > Application > Local Storage >
   https://app.dartcounter.net > `accessToken`. Copy the value (the script strips the quotes).
2. Run `scripts/set-dartcounter-token.sh` and paste it when asked (nothing is echoed back). It stores the
   secret, deploys the two functions and the rules, and runs the first pull.
3. The backfill is built in, no separate step: the first run reads up to 12 pages (300 matches) and the next
   run, 15 minutes later, the rest (DartCounter had 351 matches on 2026-11-14), so the whole history is in
   Time Left within about half an hour. To skip the wait, run the job again:
   `gcloud scheduler jobs run "$(gcloud scheduler jobs list --project dartstracker2026 --location northamerica-northeast1 --format='value(name)' | grep -i pullDartCounterMatches)" --project dartstracker2026 --location northamerica-northeast1`
4. Check with `scripts/dartcounter-sync-status.sh` (`lastStatus ok`, `backfillDone true`,
   `totalOnDartCounter` 351 or more), then look at a day with a match under Darts on the Time Left
   Activity wheel. `token-rejected` means DartCounter signed you out of that token: paste a fresh one with
   the same script.

## Not done: the result email (waiting on you)

The function `emailVersusGameResults` is in the repo but **not deployed**, so two-player games are saved but nothing is emailed. To finish:

1. Turn on 2-Step Verification in the Google account that will send, and create an app password: https://myaccount.google.com/apppasswords
2. Store it (it prompts for the value; never paste it in chat or a file):
   `firebase functions:secrets:set SMTP_PASS --project dartstracker2026`
3. Add `SMTP_USER=<the gmail address>` (and optionally `MAIL_FROM`) to `functions/.env.dartstracker2026` (git-ignored; template is `functions/.env.example`).
4. Deploy: `firebase deploy --only functions:emailVersusGameResults --project dartstracker2026`
5. Play a two-player game to the end and check that both inboxes get the result and the page says "Result emailed to ...".

Until then the setup screen still says the result "is emailed", and about 45 seconds after a game it says the email "may still arrive". That wording is wrong while email is off; change it if you play with someone before step 4.

## Still to check on a real phone (only tested in headless Chrome)

- The score keypad layout and ENTER at your screen height, and `+` entry.
- Voice announcements now confirmed working on a real phone after the Web Audio rewrite (see above) - the recorded 140-180/Bust/No score/Game shot clips play, not just the browser voice. Still unconfirmed: whether the bot's clips (pitch-shifted via Web Audio `detune`) sound distorted at that pitch, and recovery after the page is backgrounded then resumed (iOS suspends the audio context).
- On iPad the browser's SpeechSynthesis voice (then used for everything under 140 and all of Cricket) was silent while the recorded clips played. Scoping the "playback" audio session to each clip (ce49e08) did NOT fix it; the real cause is still unknown. A workaround (e333bce, recording every call in the Piper voice) was reverted along with ce49e08: the user had chosen to keep the voice as it was and did not want the Piper voice on regular scores. The voice is back to the f5ee226 state, so the iPad silence on regular scores is unsolved. Any fix must keep the browser voice for regular scores; ask before changing the voice.
- "Edit my last visit", "Press Enter", and a whole two-player game.
- That the first finished bot game shows up in Time Left. If not, look at the `syncBotGameToTimeLeft` logs.
- If a phone shows an old page, reload; the cache header only takes effect after that first fresh load.

## Open items and ideas

- `syncDartsPracticeSummaryToTimeLeft` was refactored in the repo but the running copy is the older code (same behaviour). Redeploy it with `--only functions:syncDartsPracticeSummaryToTimeLeft` if you want them to match.
- Two-player games are not sent to Time Left (only bot games are). Add it if wanted.
- Playing live on two phones is not built (same phone only).
- Keypad-entered darts count for averages but have no landing point, so they are not on the heat map.
- Only the latest visit of each side can be edited; a game already in progress from before edit support may be un-editable.
- Older items from the first review: a failed Time Left sync is not retried; no offline mode or web manifest; no security headers or subresource integrity on the CDN scripts; the version label in the page (v8.8.15) differs from the one in the script (v8.8.12); dead export-button code.
- The browser test harness used during development (fake Firebase, scripted taps, phone-width iframes) lived in a temporary folder and is not in the repo. Turning it into repo tests would let CI cover the pages, not just the engine, rules and functions.
- The Developer Dashboard session report (see `AGENTS.md`) has not been sent from this project: `DEVELOPER_DASHBOARD_CODEX_INGEST_URL` is not set in the shell, so the helper stops before sending.

## Handy commands

- All checks: `npm test` (page and script syntax, engine, functions, rules).
- Deploy order when rules and functions change: rules and functions first, then `firebase deploy --only hosting --project dartstracker2026`.
- After a hosting deploy, compare the live files with `public/` by hash (browsers and the CDN can lag briefly).
