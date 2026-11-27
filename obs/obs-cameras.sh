#!/usr/bin/env bash
# Starts OBS with the two-board camera layout for one app and the virtual camera on.
#   obs-cameras.sh dartconnect   -> scene "DartConnect" (full 1280x720: VideoConnect shows the whole picture)
#   obs-cameras.sh dartcounter   -> scene "DartCounter" (both boards inside the centre 720x720 square DartCounter crops to)
# Each run rewrites both scenes from the values below (so dragging something in OBS is undone next time)
# and locks the sources. If the darts camera station holds the cameras, OBS is started twice: the station
# lets go when it sees the OBS virtual camera.
# To change a layout for good, edit LAYOUTS below (values re-measured 2026-11-22; see docs/camera-scoring.md).
set -euo pipefail
APP="${1:-dartconnect}"
case "$APP" in
  dartconnect) SCENE="DartConnect" ;;
  dartcounter) SCENE="DartCounter" ;;
  *) echo "usage: $0 dartconnect|dartcounter"; exit 1 ;;
esac
export DISPLAY="${DISPLAY:-:0}" XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
SCENES_JSON="$HOME/.config/obs-studio/basic/scenes/Untitled.json"
LOGDIR="$HOME/.config/obs-studio/logs"
say() { echo "$*"; command -v notify-send >/dev/null && notify-send -i camera-video "OBS cameras" "$*" || true; }

stop_obs() {
  pgrep -x obs >/dev/null || return 0
  wmctrl -c 'OBS 30' 2>/dev/null || true
  for _ in $(seq 1 30); do pgrep -x obs >/dev/null || return 0; sleep 0.5; done
  pkill -x obs || true; sleep 2
}
start_obs() {
  # setsid -f: OBS gets its own session and is not a child of this script, so the script can exit.
  (cd "$HOME" && setsid -f obs --startvirtualcam --scene "$SCENE" >/dev/null 2>&1 < /dev/null)
}
busy_count() {
  local f; f="$(ls -t "$LOGDIR"/*.txt 2>/dev/null | head -1)"
  local n=0
  [ -n "$f" ] && n="$(grep -cE 'Device or resource busy|Initialization failed' "$f" || true)"
  echo "${n:-0}"
}

stop_obs
cp -f "$SCENES_JSON" "$SCENES_JSON.before-obs-cameras"
python3 -I - "$SCENES_JSON" "$SCENE" <<'PY'
import json, sys, copy
path, current = sys.argv[1], sys.argv[2]
d = json.load(open(path))
CAMS = {
  "Left Cam":  "/dev/v4l/by-path/pci-0000:00:14.0-usb-0:5.4:1.0-video-index0",
  "Right Cam": "/dev/v4l/by-path/pci-0000:00:14.0-usb-0:1.4:1.0-video-index0",
}
# LAYOUTS: per scene, per source: pos, scale, crop (left, right, top, bottom) in source pixels.
# Re-measured 2026-11-22 after the cameras were moved, from the camera station's calibrations: each
# board's outline (1.34 double-radii, +12 px) in its camera's picture sets the left/right crop, and
# the crop is scaled to fill its half. "Left Cam" (usb 5.4) is the station's camera 1, "Right Cam"
# (usb 1.4) its camera 0. (Nov 20 values: Left crop 370/220, Right crop 570/40.)
LAYOUTS = {
  "DartConnect": {  # whole 1280x720 is shown
    "Left Cam":  dict(pos=(0.0, 50.3),   scale=0.8602, crop=(439, 97, 0, 0)),
    "Right Cam": dict(pos=(640.0, 39.6), scale=0.8901, crop=(554, 7, 0, 0)),
  },
  "DartCounter": {  # only the centre square x 280..1000 is shown
    "Left Cam":  dict(pos=(282.0, 187.7), scale=0.4785, crop=(439, 97, 0, 0)),
    "Right Cam": dict(pos=(642.0, 181.8), scale=0.4951, crop=(554, 7, 0, 0)),
  },
}
OLD_NAMES = {"Scene 2": "DartConnect", "DartCounter square": "DartCounter"}
for s in d["sources"]:
    if s["id"] == "scene" and s["name"] in OLD_NAMES:
        s["name"] = OLD_NAMES[s["name"]]
for o in d.get("scene_order", []):
    o["name"] = OLD_NAMES.get(o["name"], o["name"])
# camera sources
for s in d["sources"]:
    if s["id"].startswith("v4l2") and s["name"] in CAMS:
        st = s["settings"]
        st["device_id"] = CAMS[s["name"]]
        st["resolution"] = (1280 << 32) | 720; st["pixelformat"] = 1196444237; st["framerate"] = (1 << 32) | 30
        st["buffering"] = False
scenes = {s["name"]: s for s in d["sources"] if s["id"] == "scene"}
template = scenes.get("DartConnect") or scenes.get("DartCounter") or next(iter(scenes.values()))
maxid = max([it["id"] for s in scenes.values() for it in s["settings"]["items"]] + [0])
for name, layout in LAYOUTS.items():
    if name not in scenes:
        sc = copy.deepcopy(template); sc["name"] = name
        if sc.get("uuid"): sc["uuid"] = sc["uuid"][:-4] + ("dc01" if name == "DartCounter" else "dc02")
        for it in sc["settings"]["items"]:
            maxid += 1; it["id"] = maxid
        sc["settings"]["id_counter"] = maxid + 1
        d["sources"].append(sc); scenes[name] = sc
        d.setdefault("scene_order", []).append({"name": name})
    for it in scenes[name]["settings"]["items"]:
        w = layout.get(it["name"])
        if not w: continue
        it["pos"] = {"x": w["pos"][0], "y": w["pos"][1]}
        it["scale"] = {"x": w["scale"], "y": w["scale"]}
        it["crop_left"], it["crop_right"], it["crop_top"], it["crop_bottom"] = w["crop"]
        it["rot"] = 0.0; it["align"] = 5; it["bounds_type"] = 0; it["visible"] = True; it["locked"] = True
d["current_scene"] = current; d["current_program_scene"] = current
# the virtual camera must follow the program output (not one fixed scene), so switching scenes switches the picture
d["virtual-camera"] = {"type2": 0, "internal": 0}
json.dump(d, open(path, "w"), indent=4)
print("scenes:", [o["name"] for o in d.get("scene_order", [])], "-> starting with", current)
PY

start_obs
sleep 9
if [ "$(busy_count)" -gt 0 ]; then
  echo "The camera station had the cameras; starting OBS again now that it let go..."
  stop_obs; start_obs; sleep 9
fi
if [ "$(busy_count)" -gt 0 ]; then
  say "OBS started for $SCENE, but a camera is still busy. Press 'Let OBS have the cameras' on the camera station page, then run this again."
  exit 2
fi
say "OBS is on with the $SCENE layout and the virtual camera. Pick 'OBS' as the camera in the app."
