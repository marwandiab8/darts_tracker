#!/usr/bin/env bash
# Stores (or replaces) the DartCounter API token the pullDartCounterMatches function uses, then
# redeploys that function so it picks up the new secret version, and runs it once right away.
#
# Where the token comes from: open https://app.dartcounter.net in Chrome while signed in, press F12,
# Application tab > Local Storage > https://app.dartcounter.net > accessToken. Copy the value WITHOUT
# the surrounding quotes. Nothing is printed back; the token goes straight into Secret Manager.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=dartstracker2026
printf 'Paste the DartCounter access token (not shown): '
IFS= read -r -s TOKEN
echo
TOKEN="${TOKEN%\"}"; TOKEN="${TOKEN#\"}"
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
if [ "${#TOKEN}" -lt 20 ]; then echo "That does not look like a token (too short)."; exit 1; fi
printf '%s' "$TOKEN" | firebase functions:secrets:set DARTCOUNTER_TOKEN --data-file - --project "$PROJECT" --force
unset TOKEN
echo "Deploying the DartCounter functions (and the Firestore rules) so they use the new token..."
firebase deploy --only functions:pullDartCounterMatches,functions:syncDartCounterMatchToTimeLeft,firestore:rules --project "$PROJECT" --non-interactive
JOB="$(gcloud scheduler jobs list --project "$PROJECT" --location northamerica-northeast1 --format='value(name)' 2>/dev/null | grep -i pullDartCounterMatches | head -1 || true)"
if [ -n "$JOB" ]; then
  echo "Running the first pull now..."
  gcloud scheduler jobs run "$JOB" --project "$PROJECT" --location northamerica-northeast1
  echo "Done. Check in a minute with: scripts/dartcounter-sync-status.sh"
else
  echo "Could not find the Cloud Scheduler job; the function will run on its own within 15 minutes."
fi
