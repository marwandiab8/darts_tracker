// Screenshots of Doubles Board mode mid-round, for review: iPad portrait and landscape, a phone and a
// desktop, plus the fix sheet. Run inside the emulators:
//   firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/shots.cjs /some/folder"
const path = require("path");
const fs = require("fs");
const H = require("./harness.cjs");

(async () => {
  const out = path.resolve(process.argv[2] || path.join(H.REPO, "tests", "e2e", "shots"));
  fs.mkdirSync(out, { recursive: true });
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const page = await H.device(browser, "shots", { viewport: { width: 820, height: 1180 }, storage: { dt_doublesBoard: "1", dt_doublesVoice: "1" } });
    await page.goto(`http://127.0.0.1:${H.PORT}/doubles.html`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    await page.waitForSelector("#boardMode:not([hidden]) [data-ref=idle] [data-act=start]", { timeout: 15000 });
    await page.click("#boardMode [data-ref=idle] [data-act=start]");
    await H.sleep(1200);
    // D1-D6 by hand: D3 missed.
    for (const m of ["hit1", "hit3", "miss", "hit2", "hit1", "hit2"]) { await page.click(`#boardMode [data-man='${m}']`); await H.sleep(500); }
    await page.click("#boardMode [data-act=camera]");
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    // Two camera darts at D7: just outside the wire, then next door in the 16.
    for (const [n, ring, label] of [[7, "O", "MISS"], [16, "S", "S16"]]) {
      const p = H.spot(n, ring);
      await station.send(H.dart(label, p.x, p.y));
      await H.sleep(1300);
    }
    await page.evaluate(() => { const n = document.querySelector(".bm-note"); if (n) n.blur(); });
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
    console.log("screenshots in " + out);
    if (page.errors.length) console.log("page errors: " + page.errors.join(" | "));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
