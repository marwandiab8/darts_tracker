#!/usr/bin/env bash
# Shows the last DartCounter pull: status, how many new matches, backfill progress, and any error.
set -euo pipefail
PROJECT=dartstracker2026
TOKEN="$(gcloud auth print-access-token 2>/dev/null)"
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://firestore.googleapis.com/v1/projects/$PROJECT/databases/(default)/documents/dartcounterSync/state" \
  | python3 -c 'import json,sys
d=json.load(sys.stdin)
if "fields" not in d: print(d.get("error",{}).get("message","no state yet: the function has not run")); sys.exit()
v=lambda f: next(iter(f.values()))
for k,f in sorted(d["fields"].items()): print(f"{k:22} {v(f)}")'
