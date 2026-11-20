// Screenshots of the checkout drills (121 Checkout Ladder, Two-Dart Finishes) for review: the drill
// card with its settings, the ladder in Board mode mid-visit with the route (iPad portrait and
// landscape, a phone), the fix sheet for an x01 dart, the page with the darts buttons, and the
// two-dart drill after its setup dart. Run inside the emulators:
//   firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/training-checkout-shots.cjs /some/folder"
const path = require("path");
const fs = require("fs");
const H = require("./harness.cjs");

(async () => {
  const out = path.resolve(process.argv[2] || path.join(H.REPO, "tests", "e2e", "shots-training-checkouts"));
  fs.mkdirSync(out, { recursive: true });
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const page = await H.device(browser, "shots2", { viewport: { width: 820, height: 1180 } });
    await page.goto(`http://127.0.0.1:${H.PORT}/training.html?drill=ladder121`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    const throwAt = async (n, ring, label, wait = 1300) => { const p = H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await page.screenshot({ path: path.join(out, "ladder-card.png"), fullPage: true });
    await page.click("#startBtn");
    await H.sleep(1200);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await page.click("#boardMode [data-act=camera]");
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    // A visit: T17 then S10 (a stray single): 60 left with one dart, no finish.
    await throwAt(17, "T", "T17");
    await page.screenshot({ path: path.join(out, "ladder-board-dart1.png") });
    await throwAt(10, "S", "S10");
    const sizes = [["ipad-portrait", 820, 1180], ["ipad-landscape", 1180, 820], ["phone", 390, 844]];
    for (const [name, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await H.sleep(600);
      await page.screenshot({ path: path.join(out, `ladder-board-${name}.png`) });
    }
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.click("#boardMode .bm-slot[data-i='1']");
    await H.sleep(400);
    await page.screenshot({ path: path.join(out, "ladder-fix.png") });
    await page.click("#boardMode [data-act=cancel]");
    // The 3rd dart checks nothing out (60 left, one dart): the visit ends; then the take-out and a checkout visit.
    await throwAt(20, "S", "S20");
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1000);
    await throwAt(20, "D", "D20", 600);
    await H.sleep(300);
    await page.screenshot({ path: path.join(out, "ladder-moment.png") });
    await H.sleep(2500);
    await page.click("#boardMode [data-act=exit]");
    await H.sleep(800);
    await page.setViewportSize({ width: 390, height: 844 });
    await H.sleep(400);
    await page.screenshot({ path: path.join(out, "ladder-page-phone.png"), fullPage: true });
    // Two-Dart Finishes: stop the ladder, pick the drill, start, the setup dart in.
    await page.click("#abandonBtn"); await page.click("#abandonYesBtn"); await H.sleep(1500);
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.click("[data-drill='twodart']"); await H.sleep(600);
    await page.screenshot({ path: path.join(out, "twodart-card.png"), fullPage: true });
    await page.click("#startBtn"); await H.sleep(1200);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await throwAt(15, "T", "T15");
    await page.screenshot({ path: path.join(out, "twodart-board-setup.png") });
    await throwAt(8, "D", "D8", 600);
    await H.sleep(300);
    await page.screenshot({ path: path.join(out, "twodart-moment.png") });
    await H.sleep(2500);
    await station.send({ type: "takeout", darts: 2 }); await H.sleep(1000);
    await page.setViewportSize({ width: 390, height: 844 });
    await H.sleep(500);
    await page.screenshot({ path: path.join(out, "twodart-board-phone.png") });
    console.log("screenshots in " + out);
    if (page.errors.length) console.log("page errors: " + page.errors.join(" | "));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
