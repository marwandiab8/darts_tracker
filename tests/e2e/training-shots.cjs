// Screenshots of the Training page and Bob's 27 in Board mode, for review: the drill picker, the board
// mid-round at iPad portrait and landscape, a phone and a desktop, the fix sheet, a moment, and the
// results. Run inside the emulators:
//   firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/training-shots.cjs /some/folder"
const path = require("path");
const fs = require("fs");
const H = require("./harness.cjs");

(async () => {
  const out = path.resolve(process.argv[2] || path.join(H.REPO, "tests", "e2e", "shots-training"));
  fs.mkdirSync(out, { recursive: true });
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const page = await H.device(browser, "shots", { viewport: { width: 1280, height: 900 } });
    await page.goto(`http://127.0.0.1:${H.PORT}/training.html`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await page.screenshot({ path: path.join(out, "picker-desktop.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await H.sleep(400);
    await page.screenshot({ path: path.join(out, "picker-phone.png"), fullPage: true });
    // Start, then six doubles by hand, into Board mode.
    await page.click("#startBtn");
    await H.sleep(1200);
    for (const n of [2, 1, 0, 3, 1, 2]) { await page.click(`#h${n}`); await H.sleep(500); }
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await page.click("#boardMode [data-act=camera]");
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    // Two camera darts at D7: just outside the wire, then next door in the 16.
    for (const [n, ring, label] of [[7, "O", "MISS"], [16, "S", "S16"]]) {
      const p = H.spot(n, ring);
      await station.send(H.dart(label, p.x, p.y));
      await H.sleep(1300);
    }
    const sizes = [["ipad-portrait", 820, 1180], ["ipad-landscape", 1180, 820], ["phone", 390, 844], ["desktop", 1280, 900]];
    for (const [name, width, height] of sizes) {
      await page.setViewportSize({ width, height });
      await H.sleep(600);
      await page.screenshot({ path: path.join(out, `board-${name}.png`) });
    }
    await page.setViewportSize({ width: 820, height: 1180 });
    await page.click("#boardMode .bm-slot[data-i='1']");
    await H.sleep(400);
    await page.screenshot({ path: path.join(out, "board-fix.png") });
    await page.click("#boardMode [data-act=cancel]");
    // The 3rd dart in D7: a moment? No: a moment needs 3 hits. Finish the visit, then 3 hits at D8 by button for the moment.
    const p7 = H.spot(7, "D");
    await station.send(H.dart("D7", p7.x, p7.y));
    await H.sleep(1300);
    await station.send({ type: "takeout", darts: 3 });
    await H.sleep(900);
    await page.click("#boardMode [data-man='h3']");
    await H.sleep(350);
    await page.screenshot({ path: path.join(out, "board-moment.png") });
    await H.sleep(2500);
    // Through to the end by button, for the results.
    for (let k = 0; k < 13; k += 1) { await page.click("#boardMode [data-man='h1']"); await H.sleep(450); }
    await H.sleep(2500);
    await page.screenshot({ path: path.join(out, "board-done.png") });
    await page.click("#boardMode [data-act=exit]");
    await H.sleep(800);
    await page.setViewportSize({ width: 390, height: 844 });
    await H.sleep(400);
    await page.screenshot({ path: path.join(out, "results-phone.png"), fullPage: true });
    console.log("screenshots in " + out);
    if (page.errors.length) console.log("page errors: " + page.errors.join(" | "));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
