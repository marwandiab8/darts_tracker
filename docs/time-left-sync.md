# Darts Tracker 2026 to Time Left To Live Sync

This backend sync sends saved practice sessions from `dartstracker2026` to Time Left To Live.

Data flow:

`sessions/{sessionId}` in Darts Tracker -> Firebase Function `syncDartsPracticeSummaryToTimeLeft` -> Time Left ingestion endpoint -> Time Left `externalItems` under the matching day.

The ingestion token is backend-only. Do not put it in `public/index.html`, frontend environment variables, Firestore, Remote Config, or committed files.

## Firestore Source

The Darts app saves practice sessions to:

```text
sessions/{sessionId}
```

Expected fields:

- `uid`
- `timestamp`, for example `2028-07-25 19:30`
- `mode`, either `standard` or `single`
- `entry`, target map with values like `["S", "D", "T"]`
- `total`

The Time Left item uses:

- `sourceApp`: `DartstRacker2026`
- `category`: `dartsRecord`
- `sourceProjectId`: `dartstracker2026`
- `sourceDocumentPath`: `sessions/{sessionId}`
- `visibility`: `ownerOnly`

Games played against the bot on `practice.html` are sent the same way from `botGames/{gameId}` (function `syncBotGameToTimeLeft`), as a summary with `sourceCollection: botGames`. See [bot-practice.md](bot-practice.md).

## Required Time Left Setup

In Time Left To Live:

1. Open External Sources.
2. Create a source connection for `DartstRacker2026`.
3. Add allowed source project IDs:
   - `dartstracker2026`
   - `1:151826966768:web:a409ac8d409bf0f796ba35`
4. Copy the Time Left calendar ID.
5. Copy the Darts source connection ID.
6. Generate an ingestion token.

## Backend Configuration

Set the secret in the `dartstracker2026` Firebase project:

```bash
firebase functions:secrets:set TIME_LEFT_INGESTION_TOKEN --project dartstracker2026
```

Update `functions/.env.dartstracker2026`:

```text
TIME_LEFT_CALENDAR_ID=REPLACE_WITH_TIME_LEFT_CALENDAR_ID
TIME_LEFT_CONNECTION_ID=REPLACE_WITH_TIME_LEFT_DARTSTRACKER2026_CONNECTION_ID
TIME_LEFT_SINGLE_INGEST_ENDPOINT=https://northamerica-northeast1-timelefttolive.cloudfunctions.net/ingestExternalDailyItem
DARTS_FIREBASE_PROJECT_ID=dartstracker2026
DARTS_APP_BASE_URL=https://dartstracker2026.web.app
DARTS_DEFAULT_TIME_ZONE=America/Toronto
DARTS_ALLOWED_SOURCE_PROJECT_IDS=dartstracker2026,1:151826966768:web:a409ac8d409bf0f796ba35
DARTS_OWNER_UID=REPLACE_WITH_YOUR_FIREBASE_AUTH_UID
```

Do not add the token to `.env.dartstracker2026`. That file is not committed (`functions/.env.*` is git-ignored); `functions/.env.example` is the template.

## Who is synced

Anyone with a Google account can sign in to the app and save sessions of their own, and Firestore rules keep each user's data private to them. Only sessions whose `uid` equals `DARTS_OWNER_UID` are forwarded to Time Left. Other users' sessions are logged as skipped and never sent. If `DARTS_OWNER_UID` is empty, nothing is forwarded.

To find your uid: Firebase console, Authentication, Users, and copy the User UID of your account.

The function also treats session contents as untrusted: dart values other than `S`, `D`, `T`, `B` become `-`, at most three darts are kept per target, and the total is clamped to 0 to 200.

## Validate

```bash
cd /home/marwan/Documents/darts
npm ci
npm --prefix functions ci
npm test   # function tests, then Firestore rules tests (Java needed for the emulator)
```

The same checks run on GitHub for every push to `main` and every pull request (`.github/workflows/ci.yml`): the function and app-script syntax checks and the function tests in one job, and the Firestore rules tests in the emulator in another. CI only tests; it does not deploy.

## Deploy

Deploy the rules, the functions and the app together, and check the app afterwards:

```bash
cd /home/marwan/Documents/darts
firebase deploy --only firestore:rules,firestore:indexes --project dartstracker2026
firebase deploy --only "functions:syncDartsPracticeSummaryToTimeLeft,functions:backfillDartsPracticeSummariesToTimeLeft" --project dartstracker2026
firebase deploy --only hosting --project dartstracker2026
```

The Firestore rules and indexes are in this repository (`firestore.rules`, `firestore.indexes.json`) and are tested with `npm run test:rules` (needs Java for the emulator). Do not edit the rules in the console without copying the change back here.

## Backfill

`backfillDartsPracticeSummariesToTimeLeft` re-sends saved sessions to Time Left. It needs a Firebase sign-in for the owner, not the Time Left token, and it only ever sends the owner's sessions. To call it:

1. Open the app in the browser, signed in as the owner, and run this in the developer console to copy an ID token:

   ```js
   copy(await firebase.auth().currentUser.getIdToken())
   ```

2. Call the function (a POST; `limit` is 1 to 500, default 100):

   ```bash
   curl -X POST "https://northamerica-northeast1-dartstracker2026.cloudfunctions.net/backfillDartsPracticeSummariesToTimeLeft?limit=100" \
     -H "Authorization: Bearer PASTE_ID_TOKEN_HERE"
   ```

ID tokens expire after an hour. A missing or invalid token returns 401, and a signed-in user who is not the owner returns 403.

## Test

1. Save a new practice session in `https://dartstracker2026.web.app`.
2. Open Time Left To Live.
3. Open the same date in Day Detail.
4. Confirm the item appears under `Darts Tracker`.
5. Confirm it shows score, best targets, and `ownerOnly` visibility.

Firestore verification path in Time Left:

```text
lifeCalendars/{calendarId}/dailyEntries/{dateId}/externalItems/{externalItemId}
```

Check these fields:

- `sourceApp = DartstRacker2026`
- `category = dartsRecord`
- `sourceProjectId = dartstracker2026`
- `sourceDocumentPath = sessions/{sessionId}`
- `metadata.total`
- `metadata.targetSummaries`

## Troubleshooting

- `Sign in required` (401) or `Forbidden` (403) from backfill: use a fresh ID token from the owner's account (see Backfill).
- Sessions not appearing: check the function log for `sync skipped: not the owner's session`; it means `DARTS_OWNER_UID` does not match the account you saved with.
- `invalid token`: confirm the secret was set in `dartstracker2026`, the function was redeployed after setting it, and the token came from the Darts source connection in Time Left.
- `source connection inactive`: check the Time Left source connection status and `TIME_LEFT_CONNECTION_ID`.
- `sourceProjectId not allowed`: add `dartstracker2026` to the Time Left connection allowlist and to `DARTS_ALLOWED_SOURCE_PROJECT_IDS`.
- Missing date: the item goes to Time Left date review if `timestamp` is missing or malformed.
- Viewer cannot see item: expected, items default to `ownerOnly`.
