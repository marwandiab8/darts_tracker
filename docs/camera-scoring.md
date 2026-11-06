# Scoring darts with cameras

Two webcams beside the board watch each dart go in, and the practice pages enter it as if you had tapped where it landed. It runs entirely in the browser: no server, no model, nothing uploaded.

- **Setting up and testing:** `camera.html` ("Cameras" in the headers of the tracker and the practice page).
- **Playing the bot:** the "Camera: on/off" switch under the board in `practice.html` (board entry only, not the keypad).
- **Practice sessions:** the "Camera" tick box next to Sound and Voice in the tracker (`index.html`).

## Setting up (camera.html)

1. **Choose the cameras.** The browser asks for camera access once. Pick Camera 1 and Camera 2. While OBS is open it holds the cameras and the browser can't open them: close OBS, or choose "OBS Virtual Camera" for both and calibrate each half of its picture (each camera in OBS must then show the whole board).
2. **Calibrate each camera.** Tap five points on its picture: where the wires between 20|1, 6|10, 3|19 and 11|14 meet the outside of the double ring, and the bull. Press, slide until the cross in the magnifier sits on the spot, and let go. The board's wires are then drawn over the picture in blue; they should follow the real wires all the way round. The fit shows how far apart the points are (under about 3 mm is fine; more means a point is on the wrong spot).
3. **Try it.** Start watching, clear the board, throw. Each dart shows on the board on the page. If one is wrong, tap where it really is: that is kept with the test pictures.

The setup is kept in this browser's `localStorage` (`dt_cameraSetup`), since it belongs to the cameras on this computer. Move a camera and its calibration is wrong: calibrate it again.

**Camera placement.** Close to the board, one on each side (left and right), looking at it. Each camera should see the whole board. Even lighting without hard shadows matters more than the camera. Keep them off the Targus dock (see the OBS notes: two NexiGo cams on one hub drop out).

## How a dart is read (board-vision.js)

All the maths is in `public/board-vision.js` (no DOM, so Node tests run it). `public/board-camera.js` opens the cameras and feeds it frames.

1. **Calibration.** The five taps give a homography per camera: a map from any pixel to the point of the board's face it looks at. From it the camera's position is worked out too (assuming the lens points at the middle of the picture, or the middle of its half for OBS's side-by-side picture).
2. **Each camera's picture** is cropped to the board (out to 1.2 board radii) and scaled to at most 640 px a side, about 1.5 px per mm from a 720p camera. About 10 frames a second are looked at.
3. **Spotting a dart.** The page keeps the picture from before the throw. When the picture changes and then holds still for three frames, the difference is the new dart. Brightness drift (auto exposure) is corrected first, and pixels that only got darker without changing colour (shadows) are ignored.
4. **One camera's reading.** A dart seen from the side is a streak: thin point and barrel, then the flight. Its line is found with RANSAC, scoring each candidate line by how far along it the dart's pixels run without a gap (a flight's edge or diagonal is short; the dart's own line runs from point to flight). Both ends of the streak are candidates for the point. The camera's position decides which is likelier: everything standing off the board lands farther from the camera than the point does.
5. **Both cameras together.** The point is the one place on the board where both cameras see dart. The rest of the dart stands off the board, so it lands in different places for the two cameras. The candidates are each camera's two ends, where the two lines cross, and where the two darts overlap on the board. The best one is pinned down with the crossing of the two lines when both run through it.
6. **Into the app.** The app's drawn board has wider trebles, doubles and bulls than a real one, so the real position is stretched ring by ring (`realToApp`) into the app position that scores the same. That is what is entered, so the dot, the heat map and Undo all work as for a tap.

**Pulling the darts out.** A big change (a hand) is never read as a dart. When the board looks like the empty board again, that is a take-out.

## What the pages do with it

- **Bot games:** a dart the cameras see is entered when it is your turn and you have darts left; otherwise the page says it saw it and ignores it. A take-out during your visit ends it: darts the cameras did not see (a bounce-out, a miss) are entered as misses, and with Press Enter on it counts as pressing Enter. A take-out during the bot's turn is ignored. A reading the cameras weren't sure of says so under the board: Undo and tap if it is wrong. Camera darts count as activity for the practice timer.
- **The tracker:** each dart fills the next slot for its number with its dot, with the usual sound and voice. A dart off the board is a miss (not recorded, as with a tap).

## How good is it

Only tested so far with pictures drawn by the test rig (`tests/board-sim.cjs`: a regulation board, darts with point, barrel, shaft and flight, shadows and camera noise, two cameras where the NexiGo cams are). In those, a first dart is usually within 1 to 2 mm, and about 9 in 10 score right; the misses are darts within a couple of millimetres of a wire. Darts landing among earlier darts (a tight treble 20 group) are harder: roughly 8 in 10. Real cameras will differ (lens distortion, compression, lighting, the darts' colours), which is what the test pictures are for.

## Tuning with test pictures

"Save test pictures" on camera.html downloads a JSON file with, for every dart, the before and after picture from each camera (as the detector saw them), what was read, and the true spot if you tapped it. To see what each camera read and why:

```bash
npm install --no-save sharp          # once, to read the JPEGs
node scripts/replay-camera-test.cjs dart-camera-test-2026-11-06-20-15.json --verbose
```

The settings that matter are `DEFAULTS` in `board-vision.js` (change threshold, shadow handling, sizes of a dart and of a hand) and `maxSide` in `makeView`.

## Tests

- `tests/board-vision.test.cjs` (in `npm test`): the real-to-app mapping scores the same everywhere; homographies and calibration (including spotting a mistap); the camera position; reading darts with two cameras and with one; and the watcher: noise and exposure changes are not darts, a dart is read once, a hand is not a dart, and pulling the darts out is a take-out.
- An end-to-end run in headless Chrome was done by hand: the test rig rendered an OBS-style side-by-side video, Chrome played it as a fake camera (`--use-file-for-fake-video-capture`), and camera.html, a bot game and the tracker each entered the three darts, with the take-out ending the visit. That harness is not in the repo.
