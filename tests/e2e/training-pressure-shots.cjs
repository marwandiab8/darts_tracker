// Screenshots of Phase 4 on the Training page for review: the Warm-up in Board mode (iPad, a phone),
// Score More mid-visit, two-player Score More with the other player's card, the page on a phone. Run
// inside the emulators:
//   firebase emulators:exec --config tests/e2e/firebase.json --only firestore,auth --project demo-darts "node tests/e2e/training-pressure-shots.cjs /some/folder"
const path = require("path");
const fs = require("fs");
const H = require("./harness.cjs");

(async () => {
  const out = path.resolve(process.argv[2] || path.join(H.REPO, "tests", "e2e", "shots-training-pressure"));
  fs.mkdirSync(out, { recursive: true });
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const page = await H.device(browser, "shots4", { viewport: { width: 820, height: 1180 } });
    await page.goto(`http://127.0.0.1:${H.PORT}/training.html?drill=warmup`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    await station.clear();
    const throwAt = async (n, ring, label, wait = 1300) => { const p = H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await page.screenshot({ path: path.join(out, "warmup-card.png"), fullPage: true });
    await page.click("#startBtn"); await H.sleep(1200);
    for (const n of [2, 3, 1]) { await page.click(`#h${n}`); await H.sleep(500); }
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await page.screenshot({ path: path.join(out, "warmup-board-ipad.png") });
    await page.setViewportSize({ width: 390, height: 844 }); await H.sleep(500);
    await page.screenshot({ path: path.join(out, "warmup-board-phone.png") });
    await page.setViewportSize({ width: 820, height: 1180 }); await H.sleep(300);
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.click("#abandonBtn"); await page.click("#abandonYesBtn"); await H.sleep(1500);
    // Score More: the mark, a visit beaten, then a visit under way with the cameras.
    await page.click("[data-drill='scoremore']"); await H.sleep(600);
    await page.click("#startBtn"); await H.sleep(1200);
    for (const id of ["p2", "p2", "p3", "p1", "p2", "pm"]) { await page.click("#" + id); await H.sleep(450); }
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(800);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await page.click("#boardMode [data-act=camera]");
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    await throwAt(20, "T", "T20");
    await page.screenshot({ path: path.join(out, "scoremore-board-ipad.png") });
    await page.setViewportSize({ width: 1180, height: 820 }); await H.sleep(500);
    await page.screenshot({ path: path.join(out, "scoremore-board-landscape.png") });
    await page.setViewportSize({ width: 820, height: 1180 }); await H.sleep(300);
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.click("#abandonBtn"); await page.click("#abandonYesBtn"); await H.sleep(1500);
    // Two players: the card with someone new typed in, then a round in Board mode.
    await page.click("[data-drill='scoremore2']"); await H.sleep(800);
    await page.fill("#oppName", "Sam"); await page.fill("#oppEmail", "sam@example.com"); await H.sleep(300);
    await page.screenshot({ path: path.join(out, "scoremore2-card.png"), fullPage: true });
    await page.click("#startBtn"); await H.sleep(1500);
    await page.click("#boardMode [data-act=camera]").catch(() => {});
    await throwAt(20, "T", "T20"); await throwAt(20, "S", "S20"); await throwAt(5, "S", "S5", 1500);
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(900);
    await throwAt(20, "S", "S20"); await throwAt(20, "S", "S20"); await throwAt(1, "S", "S1", 1500);
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(900);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await H.sleep(500);
    await page.screenshot({ path: path.join(out, "scoremore2-board-ipad.png") });
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.setViewportSize({ width: 390, height: 844 }); await H.sleep(400);
    await page.screenshot({ path: path.join(out, "scoremore2-page-phone.png"), fullPage: true });
    console.log("screenshots in " + out);
    if (page.errors.length) console.log("page errors: " + page.errors.join(" | "));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
  }
})().catch((e) => { console.error(e); process.exit(1); });
