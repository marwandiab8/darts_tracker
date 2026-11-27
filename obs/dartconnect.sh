#!/usr/bin/env bash
# One click for DartConnect (Desktop icon "DartConnect + OBS"):
#   1. OBS with the DartConnect camera layout and the virtual camera on (obs-cameras.sh dartconnect).
#   2. Then DartConnect in Chrome, after clearing its stuck background worker: the "DartConnect Fix"
#      extension (~/.local/share/dartconnect-fix) clears the service worker and cached app files of
#      app.dartconnect.com only (the sign-in is kept), then reloads the DartConnect tab already open or
#      opens one.
# OBS goes first so DartConnect finds the OBS camera when it loads. If a camera is still busy, OBS says
# what to do and DartConnect opens anyway.
DIR="$(cd "$(dirname "$0")" && pwd)"
export DISPLAY="${DISPLAY:-:0}"
FIX_URL="chrome-extension://lccgpjlfdnhedklmegkpiafdjdhbagop/open.html"

command -v notify-send >/dev/null && notify-send -i camera-video "DartConnect" "Starting OBS with the DartConnect cameras. DartConnect opens in about 10 seconds." || true
"$DIR/obs-cameras.sh" dartconnect || true
setsid -f /opt/google/chrome/google-chrome --profile-directory=Default "$FIX_URL" >/dev/null 2>&1 < /dev/null
