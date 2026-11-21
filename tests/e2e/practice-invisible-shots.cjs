// Screenshots of the Invisible Man in the bot game for review: the setup (iPad, phone), Board mode mid-leg
// (iPad portrait and landscape, a phone), out of darts, the report. Run inside the emulators:
//   firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/practice-invisible-shots.cjs /some/folder"
const path = require("path");
const fs = require("fs");
const H = require("./harness.cjs");
const E = require("../../public/practice-engine.js");

(async () => {
  const out = path.resolve(process.argv[2] || path.join(H.REPO, "tests", "e2e", "shots-invisible"));
  fs.mkdirSync(out, { recursive: true });
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const settings = JSON.stringify({ kind: "x01", startScore: 501, doubleOut: true, rank: "club", first: "player", entry: "board", confirm: false, camera: true, mute: false, opponent: "limit", dartLimit: 24, seriesTarget: 2 });
    const page = await H.device(browser, "shotsim", { viewport: { width: 820, height: 1180 }, storage: { dt_practice_settings: settings } });
    page.on("dialog", (d) => d.accept());
    await page.goto(`http://127.0.0.1:${H.PORT}/practice.html`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    await station.clear();
    const at = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));
    const camDart = async (label, wait = 1000) => { const p = at(label); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    const takeout = async (wait = 1500) => { await station.send({ type: "takeout", darts: 3 }); await H.sleep(wait); };
    await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await H.sleep(800);
    await page.screenshot({ path: path.join(out, "setup-ipad.png"), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 }); await H.sleep(400);
    await page.screenshot({ path: path.join(out, "setup-phone.png"), fullPage: true });
    await page.setViewportSize({ width: 820, height: 1180 }); await H.sleep(300);
    await page.click("#startBtn"); await H.sleep(1500);
    await page.click("#boardBtn");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 8000 });
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camStatus").textContent), null, { timeout: 15000 }).catch(() => {});
    for (const v of [["T20", "S20", "S5"], ["T20", "T20", "S1"], ["S20", "T19", "S3"], ["T20", "S20", "S20"]]) { for (const l of v) await camDart(l); await takeout(); }
    await camDart("T20");
    for (const [name, width, height] of [["board-ipad", 820, 1180], ["board-landscape", 1180, 820], ["board-phone", 390, 844]]) {
      await page.setViewportSize({ width, height }); await H.sleep(600);
      await page.screenshot({ path: path.join(out, name + ".png") });
    }
    await page.setViewportSize({ width: 820, height: 1180 }); await H.sleep(300);
    await camDart("S20"); await camDart("S1", 1500); await takeout();
    // 15 darts thrown: three more visits run the limit (24) out.
    const rest = [["S20", "S20", "S20"], ["S1", "S1", "S1"], ["S1", "S1", "S1"]];
    for (let k = 0; k < rest.length; k += 1) { for (const l of rest[k]) await camDart(l, 900); if (k < rest.length - 1) await takeout(); }
    await H.sleep(400);
    await page.screenshot({ path: path.join(out, "out-of-darts-ipad.png") });
    await takeout(3000);
    await page.screenshot({ path: path.join(out, "report-ipad.png") });
    console.log("screenshots in " + out);
    if (page.errors.length) console.log("page errors: " + page.errors.join(" | "));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
