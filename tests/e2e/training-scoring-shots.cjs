// Screenshots of the scoring drills (Triple 20 Marathon, Big Triples, Game of 9) for review. Run inside
// the emulators:
//   firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/training-scoring-shots.cjs /some/folder"
const path = require("path");
const fs = require("fs");
const H = require("./harness.cjs");

(async () => {
  const out = path.resolve(process.argv[2] || path.join(H.REPO, "tests", "e2e", "shots-training-scoring"));
  fs.mkdirSync(out, { recursive: true });
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const page = await H.device(browser, "shots3", { viewport: { width: 820, height: 1180 } });
    await page.goto(`http://127.0.0.1:${H.PORT}/training.html?drill=marathon`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    const throwAt = async (n, ring, label, wait = 1300) => { const p = n === "BULL" ? { x: 0, y: 0 } : H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await page.screenshot({ path: path.join(out, "picker-ipad.png"), fullPage: true });
    await page.click("#startBtn");
    await H.sleep(1200);
    for (const n of [1, 0, 2]) { await page.click(`#h${n}`); await H.sleep(500); }
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await page.click("#boardMode [data-act=camera]");
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    await throwAt(20, "T", "T20"); await throwAt(5, "S", "S5");
    await page.screenshot({ path: path.join(out, "marathon-board-ipad.png") });
    await page.setViewportSize({ width: 390, height: 844 }); await H.sleep(500);
    await page.screenshot({ path: path.join(out, "marathon-board-phone.png") });
    await page.setViewportSize({ width: 820, height: 1180 }); await H.sleep(300);
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.click("#abandonBtn"); await page.click("#abandonYesBtn"); await H.sleep(1500);
    // Big Triples: two visits in, the third on the board.
    await page.click("[data-drill='bigtriples']"); await H.sleep(600);
    await page.screenshot({ path: path.join(out, "bigtriples-card.png"), fullPage: true });
    await page.click("#startBtn"); await H.sleep(1200);
    for (const n of [2, 1]) { await page.click(`#h${n}`); await H.sleep(500); }
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await throwAt(20, "T", "T20"); await throwAt(20, "D", "D20");
    await page.screenshot({ path: path.join(out, "bigtriples-board-ipad.png") });
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.click("#abandonBtn"); await page.click("#abandonYesBtn"); await H.sleep(1500);
    // Game of 9: the 20 passed, the 19 under way.
    await page.click("[data-drill='gameof9']"); await H.sleep(600);
    await page.click("#startBtn"); await H.sleep(1200);
    for (const n of [3, 2, 2, 1]) { await page.click(`#h${n}`); await H.sleep(500); }
    await H.sleep(2500);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await throwAt(19, "S", "S19"); await throwAt(3, "S", "S3");
    await page.screenshot({ path: path.join(out, "gameof9-board-ipad.png") });
    await page.setViewportSize({ width: 1180, height: 820 }); await H.sleep(500);
    await page.screenshot({ path: path.join(out, "gameof9-board-landscape.png") });
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.setViewportSize({ width: 390, height: 844 }); await H.sleep(400);
    await page.screenshot({ path: path.join(out, "gameof9-page-phone.png"), fullPage: true });
    console.log("screenshots in " + out);
    if (page.errors.length) console.log("page errors: " + page.errors.join(" | "));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
