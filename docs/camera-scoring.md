# Scoring darts with cameras

Two webcams beside the board watch each dart go in, and the practice pages enter it as if you had tapped where it landed. It runs entirely in the browser: no server, no model, nothing uploaded.

- **Cameras plugged into another computer:** `station.html` (the camera station) runs on that computer; see below.
- **Setting up and testing:** `camera.html` ("Cameras" in the headers of the tracker and the practice page).
- **Playing the bot:** the "Camera: on/off" switch under the board in `practice.html` (board entry only, not the keypad).
- **Practice sessions:** the "Camera" tick box next to Sound and Voice in the tracker (`index.html`).

## Setting up (camera.html)

1. **Choose the cameras.** The browser asks for camera access once. Pick Camera 1 and Camera 2. While OBS is open it holds the cameras and the browser can't open them: close OBS, or choose "OBS Virtual Camera" for both and calibrate each half of its picture (each camera in OBS must then show the whole board).
2. **Calibrate each camera.** Tap five points on its picture: where the wires between 20|1, 6|10, 3|19 and 11|14 meet the outside of the double ring, and the bull. Press, slide until the cross in the magnifier sits on the spot, and let go. When the fifth point is in, the page matches the outline to the board itself: it finds several hundred edges of the red and green rings and of the black and cream segments near where the taps put them, and fits the outline to all of them, which also takes out the bend of the camera's wide lens. The board's wires are then drawn over the picture in blue; they should sit on the real wires all the way round. The message says how many edges it used, how close they are, and how far off your five points alone had the rings (a millimetre or two is normal; taps a little inside the wire make the whole outline look small). If the rings can't be made out (a dark or blurry picture), the outline follows the five points only, and the message says so.
3. **Try it.** Start watching, clear the board, throw. Each dart shows on the board on the page. If one is wrong, tap where it really is: that is kept with the test pictures.

**Checked every time watching starts.** The watcher takes a picture from each camera and matches its calibration to the board again (from the saved calibration, ignoring the old taps). A camera knocked a little since it was calibrated is followed for that session. On the Cameras page it says how far each one had moved; the practice pages only say something if a camera couldn't be checked (something in the way) or has moved more than 6 mm (then calibrate it again). The saved calibration itself is not changed.

The setup is kept in this browser's `localStorage` (`dt_cameraSetup`), since it belongs to the cameras on this computer. Move a camera and its calibration is wrong: calibrate it again.

**Camera placement.** Close to the board, one on each side (left and right), looking at it. Each camera should see the whole board. Even lighting without hard shadows matters more than the camera. Keep them off the Targus dock (see the OBS notes: two NexiGo cams on one hub drop out).

## Cameras on another computer: the camera station

The cameras are plugged into one computer (the Linux laptop running OBS), but the game is often played on another. So that computer runs the **camera station**, `station.html`:

1. **On the computer with the cameras:** open the Camera station page, sign in with the account you play with, choose Camera 1 and Camera 2 (OBS's virtual camera for both while OBS is open), and press Start. Tick "Start by itself" so reopening the page is enough. Leave it open: it may sit behind other windows (its timers run in a worker, which browsers don't slow down in the background) and it asks the screen to stay on.
2. **Calibrate from any computer:** on the Cameras page, signed in, choose "On my camera station". The station sends a picture of each camera ("New picture" asks for fresh ones); tap the five points, the outline snaps to the board as usual, and Save keeps the calibration in the account. The station starts watching with it straight away. "Try it" shows the darts the station reads.
3. **Play on any computer:** turn the camera on in a bot game or the tracker. It uses the station when it is running (darts arrive about half a second after they land), and otherwise cameras set up in that browser.

The station reads the darts itself, from the cameras' own pictures, so nothing is lost to video compression; only the results travel. Everything goes through Firestore, under the owner's account (rules: only the owner reads or writes any of it):

- `cameraStations/{uid}`: `setup` (which of the station's cameras, by device id and name, and their calibrations), `station` (its name, `seen` every 20 s, whether it is watching, what it is doing), `ask` (requests from other computers: fresh pictures, "the board is clear now").
- `cameraStations/{uid}/stills/{0|1}`: each camera's latest picture, as a JPEG (about 300 kB).
- `cameraStations/{uid}/events/latest`: the last 20 events (darts, take-outs, the start-up check), each with a rising number; a page passes on only those after it started listening.

The code is in `public/board-camera.js` (`createStation`, `createRemoteWatcher`, `chooseWatcher`, `requestStills`). A station counts as running if it was seen in the last 90 seconds.

### Unplugging the cameras, and which is which

The two NexiGo cameras are the same model, so the computer can't tell them apart: they have the same name, and on Linux a camera's device id (as Chrome gives it) follows the order the cameras were plugged in. After the cameras are unplugged and plugged in again (the laptop taken to work and back), they can come back with each other's ids, or with new ones. The calibrations belong to the cameras' views of the board, not to the ids, so the station works out which is which by what each camera sees:

- **Finding them** (`matchCameras`): each saved camera is the one with its id while its name still matches, else one with its name; never one camera for two (except OBS's virtual camera, saved for both halves).
- **Checking them** (`createWatcher`): each calibration is matched to its camera's picture as the station starts (as it always was, to follow a small knock). If one doesn't fit, or fits only far from where it was calibrated (two cameras close together can seem to fit each other's), the two are tried the other way round, and whichever way more of them fit, nearer where they were calibrated, is used (`otherWayFits`). The check event then has `swapped: true`, and the station page logs it.
- **Remembering it:** the station saves which camera each calibration was found on (only the ids change; the calibrations stay as saved), so the lists on its page, the Cameras page and the next start all have it right.
- **Unplugged while running:** the station stops watching, says so, and looks for the cameras every few seconds (and whenever a camera is plugged in); once they are all back it starts again by itself. It does the same when it starts with a camera missing ("Only one of the two ... is plugged in"). A camera that isn't plugged in stays chosen on the station page, "(not plugged in)", calibration and all: starting the station or choosing the other camera never drops it. Choosing a camera of the same model in its place keeps the calibration too (the start-up check sorts out which is which); one of another model starts without one.

## How a dart is read (board-vision.js)

All the maths is in `public/board-vision.js` (no DOM, so Node tests run it). `public/board-camera.js` opens the cameras and feeds it frames.

1. **Calibration.** The five taps give a homography per camera: a map from any pixel to the point of the board's face it looks at. `refineCalibration` then fits that map, plus the lens's bend (one number, k, in the "division model" about the middle of the lens: k < 0 is the usual barrel bend), to the board's own edges in the picture: the steps into and out of the treble and double rings and the bull along 60 rays, and the black/cream and red/green steps across the 20 wires, about 440 in all, with damped Gauss-Newton and reweighting so the few spoiled by a dart or a glare drop out. From the result the camera's position is worked out too (the lens's middle being the middle of the picture, or of its half for OBS's side-by-side picture).
2. **Each camera's picture** is cropped to the board (out to 1.2 board radii) and scaled to at most 640 px a side, about 1.5 px per mm from a 720p camera. About 10 frames a second are looked at.
3. **Spotting a dart.** The page keeps the picture from before the throw. When the picture changes and then holds still for three frames, the difference is the new dart. Brightness drift (auto exposure) is corrected first. Real webcams flicker (the NexiGo ones change about 1 pixel in 100 every frame), so a pixel only counts towards "something moved" when its neighbours to the right and below changed too, and each camera learns its own flicker while the board is quiet. Where the picture changed but now looks like the empty board again, darts came out rather than in (a take-out once the board is clear). Shadows are not filtered out by default: under soft or ring lighting darts cast none worth the name, and the shadow test erased grey barrels over white segments. A board lit by a single lamp can turn it on ("Hard shadows" on the Camera station page).
4. **One camera's reading.** A dart seen from the side is a streak: thin point and barrel, then the flight. Its line is found with RANSAC, scoring each candidate line by how far along it the dart's pixels run without a gap (a flight's edge or diagonal is short; the dart's own line runs from point to flight). Both ends of the streak are candidates for the point. The camera's position decides which is likelier: everything standing off the board lands farther from the camera than the point does.
5. **Both cameras together.** The point is the one place on the board where both cameras see dart. The rest of the dart stands off the board, so it lands in different places for the two cameras. The candidates are each camera's two ends, where the two lines cross, and every bit of board where the two darts overlap; the winner is the one nearest dart in both cameras and an end of each streak. (It used to be moved onto the crossing of the two lines when both ran near it. A camera's line is the least exact part of a reading, though: with the cameras in front of the board a dart looks short, and a flight wing seen nearly edge-on passes for part of it and tilts the line. Without that step the test rig reads 290 of 320 darts right instead of 280, and the typical error halves.)
6. **Into the app.** The app's drawn board has wider trebles, doubles and bulls than a real one, so the real position is stretched ring by ring (`realToApp`) into the app position that scores the same. That is what is entered, so the dot, the heat map and Undo all work as for a tap.

**Pulling the darts out.** A big change (a hand) is never read as a dart. When the board looks like the empty board again, that is a take-out.

## What the pages do with it

- **On several devices at once** (the computer and the iPad, both with Camera on): each dart goes in once. Every event the station passes on has a rising count (`seq`); the bot game and the tracker keep the last one put in, in the game they share between devices, and skip one they already have. See "On more than one device" in [bot-practice.md](bot-practice.md).
- **Bot games** (`cameraEvent` in `public/practice-engine.js`, since Nov 13, 2026): a dart the cameras see goes into your visit where the game reads it landed. A dart they couldn't read holds the darts after it until you tap it in, so the order stays right. Darts thrown while the bot is still throwing wait for your turn and go in then, in order. Darts after your visit is over (three darts, a bust, a checkout) aren't counted. A take-out during your visit ends it: darts the cameras did not see (a bounce-out, a miss, an unread dart never tapped) are entered as misses, and with Press Enter on it counts as pressing Enter. A take-out during the bot's turn, with nothing waiting, is your last visit's and is ignored. A reading the cameras weren't sure of says so under the board: Undo and tap if it is wrong. Camera darts count as activity for the practice timer. See [bot-practice.md](bot-practice.md).
- **The tracker:** a session is three darts at each number from 20 down to the bull, and the big "Throwing at" line shows which number and which dart. A camera dart counts as a tap does: a hit in that number fills its next slot with its dot; a dart in any other number, or off the board, is a miss that still uses up one of its three darts (misses are counted alongside the entry, in the draft and its live sync, as `thrown`). The visit rules (`public/tracker-engine.js`, since Nov 13, 2026; before, a pull-out could fill the next number with misses and push every later visit one number behind):
  - A visit belongs to the number being thrown at when its first dart lands. Its darts go to that number; one that arrives after the number already has three (it was tapped in as well as seen) isn't counted anywhere.
  - A dart the cameras couldn't read is one of the visit's darts: tap where it landed, or it's a miss when the visit ends.
  - The visit ends at the pull-out, or at a 4th dart without one (that dart starts the next visit). Then the darts not seen are misses at the visit's number only, never at the next (Undo puts them back).
  - A visit where nothing at all was seen (three bounce-outs) leaves no trace: tap the misses.
  - The station's dart number (`index`) isn't used to place darts: it counts only darts it could read.

## How good is it

Not yet tested with the real cameras. In the test rig (`tests/board-sim.cjs`: a regulation board, darts with point, barrel, shaft and flight, shadows, camera noise, optionally a bent lens and webcam-style colour, two cameras where the NexiGo cams are), with the November 7 changes:

- A dart is typically 1.5 mm from where it really is, and about 9 in 10 score right; with colour as a webcam's video carries it (YUV 4:2:0, colour at half resolution), about 87 in 100. The misses are darts near a wire, and darts whose barrel hardly shows against the board.
- Calibration: on the October OBS screenshots of the real board, the outline matched 440 edges within 0.9 mm on average, where five taps placed by eye had the rings up to 3.4 mm off. The lens bend there was small (OBS showed the middle of each camera's picture).
- Shadows matter: without the shadow check, darts read tens of millimetres off. Loosening it lets a grey or silver barrel over a cream segment pass for a shadow, so it stays strict.
- OBS's side-by-side picture gives each camera about 1.2 pixels per millimetre of board; each camera opened on its own gives about 1.5 or more. In a browser run through the fake camera (OBS-style video) darts were 3 to 5 mm off, against 1.5 mm in the rig. If the two cameras can be opened directly (OBS closed, each on its own USB root port), that is likely to read better.

Darts landing among earlier darts (a tight treble 20 group) are harder. Real cameras will differ (compression, lighting, the darts' colours), which is what the test pictures are for.

### On the real board (November 7)

Thirty darts thrown three at a time, each called by the player, with the cameras opened directly (OBS closed) and calibrated by snapping (about 0.9 mm):

- As live that evening: 22 of the 27 single darts read right (81%); everything around the bull was right. The misses: grey barrels over white segments erased as "shadow" (so the point was put at the end of the shaft or on the flight), a double at the board's edge read just outside it, and three darts in quick succession read as one before a fix for camera flicker.
- With the shadow test off (now the default): 26 of 27 (96%). The one miss is a D8 at the far left, outside camera 1's picture, so only one camera read it.
- The pictures of every dart are kept (outside the repo) for checking later changes against: `scripts/replay-camera-test.cjs` replays them.

## Learning from your games (board-learn.js)

The camera station learns from the darts you correct while you play, so there is no need for test sessions where every dart is called.

- **Notes.** When a visit is over, the bot game notes each dart the cameras put into it (`cameraStations/{uid}/notes/{seq}`, the station's count as the id): **kept** if what stands in its place scores the same, **corrected** (with where it really landed) if not. A dart you took back and tapped, "Missed the board" after Undo, and "Edit my last visit" are corrections. A dart taken back for another camera dart, or a take-out's misses, teach nothing. The tracker notes a camera dart taken back with Undo and then tapped (the tap is where it landed), and a camera dart that counted (a hit in the number thrown at) and still stands three darts later. It skips those in "hits" mode, where the ring doesn't count and so wouldn't be corrected. Which darts came from the cameras is part of the game shared between devices, so a correction on the iPad counts for a dart the computer put in.
- **Pictures.** The station keeps, for its last 12 darts, each camera's crop just before and after the dart (exactly what it read). When a dart's note comes, it keeps the pictures with the note on that computer: IndexedDB `dart-learning`, lossless WebP (about 300 to 550 kB a picture, checked once a session to come back pixel for pixel, else PNG). At most 160 darts are kept, at most half of them read right; the oldest go first, corrections last. The note gets `pictures: true` (or `false` if the dart was no longer in memory).
- **Learning.** 45 s after a note, if there are at least 10 darts and 3 more corrections (or 30 more darts) than at the last run, a worker reads all the kept darts again: with the settings in use, with each of `threshold`, `blobArea`, `joinGap`, `thickR`, `runGapR`, `endPenalty` and `cell` changed on its own (to a few values around the tuned ones), and with the defaults. It keeps the best change, then tries once more from there. If that reads at least one more dart right in 50 (and at least one more), it is used from then on: `setup.learned` in the account, applied to the running detector at once, and in every watcher the station starts. Each run's result is in `setup.learning`. The board's own options (`setup.options`, the hard-shadows switch) win over what was learned.
- **On the pages.** The Camera station page has a "Learning from your games" card: how many darts are kept, how many corrected, how the last run went, "Learn now", and "Forget what it learned" (back to the usual settings; the darts stay). The Cameras page shows the same in one line.
- On the 27 called darts of November 7 it changes nothing: the tuned settings read 26 right and no single change reads more. In the test rig, from a far too high change threshold (6 of 12 right) it learns its way back to 11 of 12 (`tests/board-learn.test.cjs`).

## Tuning with test pictures

"Save test pictures" on camera.html downloads a JSON file with each camera's whole picture from when watching started (with its saved calibration, the one in use, and how the start-up check went), and, for every dart, the before and after picture from each camera (as the detector saw them), what was read, and the true spot if you tapped it. To see what each camera read and why, and how well the board can be matched in each camera's picture:

```bash
npm install --no-save sharp          # once, to read the JPEGs
node scripts/replay-camera-test.cjs dart-camera-test-2026-11-06-20-15.json --verbose
```

The settings that matter are `DEFAULTS` in `board-vision.js` (change threshold, shadow handling, sizes of a dart and of a hand) and `maxSide` in `makeView`.

## Tests

- `tests/board-vision.test.cjs` (in `npm test`): the real-to-app mapping scores the same everywhere; homographies and calibration (including spotting a mistap); the camera position; the lens model both ways; matching the board in a picture (taps 4 px off and a bent lens: the rings end within 0.6 mm and the bend is measured; darts in the board; a camera that moved; a blank picture is refused); reading darts with two cameras and with one; and the watcher: noise and exposure changes are not darts, a dart is read once, a hand is not a dart, and pulling the darts out is a take-out.
- `tests/board-learn.test.cjs` (in `npm test`): the settings tried, when a change is worth using, reading darts again with option sets, and learning better settings from bad ones on the test rig's darts.
- `tests/board-camera.test.cjs` (in `npm test`): with an in-memory Firestore, a page gets the station's darts from when it starts listening, each once and in order; a station that is off, not calibrated or missing says so; the station is used when it runs; events are slimmed down for passing on; saved cameras are found among those plugged in (new ids, one missing, OBS); a camera of the same model keeps its calibration; the two cameras are swapped only when the calibrations clearly fit better that way. `tests/firestore.rules.test.cjs` covers the station's rules.
- The camera station was run by hand in headless Chrome with a stand-in Firestore shared between tabs: on the real OBS virtual camera, the Cameras page in another tab got the station's picture, calibrated it (snapped to 425 edges, 0.85 mm), and the station watched the real board for a minute without a false dart; with the fake video, a bot game and the tracker in another tab, with no cameras set up in their browser, got the station's darts.
- An end-to-end run in headless Chrome was done by hand: the test rig rendered an OBS-style side-by-side video, Chrome played it as a fake camera (`--use-file-for-fake-video-capture`), and camera.html (including matching each half's calibration to the board, about 0.2 s each, and the start-up check), a bot game and the tracker each entered the three darts, with the take-out ending the visit. One of the three (S7, 4 mm inside the treble wire) reads T7, flagged "by a wire". That harness is not in the repo.
