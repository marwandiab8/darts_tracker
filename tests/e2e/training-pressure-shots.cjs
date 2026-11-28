// Screenshots of Phase 4 on the Training page for review: the Warm-up with up to 12 darts in Board mode
// (iPad, landscape, a phone), Free throwing (the card, Board mode, Finish, the result),
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
    // The warm-up with up to 12 darts (the default): seven darts in the board, read by the cameras.
    await page.click("#startBtn"); await H.sleep(1200);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await page.click("#boardMode [data-act=camera]");
    await page.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    for (const [n, ring, label] of [[20, "T", "T20"], [20, "S", "S20"], [1, "S", "S1"], [20, "S", "S20"], [20, "D", "D20"], [5, "S", "S5"], [20, "S", "S20"]]) await throwAt(n, ring, label, 700);
    await H.sleep(800);
    await page.screenshot({ path: path.join(out, "warmup-board-ipad.png") });
    await page.setViewportSize({ width: 1180, height: 820 }); await H.sleep(500);
    await page.screenshot({ path: path.join(out, "warmup-board-landscape.png") });
    await page.setViewportSize({ width: 390, height: 844 }); await H.sleep(500);
    await page.screenshot({ path: path.join(out, "warmup-board-phone.png") });
    await page.evaluate(() => { const bm = document.getElementById("boardMode"); bm.scrollTop = bm.scrollHeight; }); await H.sleep(300);
    await page.screenshot({ path: path.join(out, "warmup-board-phone-low.png") });
    await page.setViewportSize({ width: 820, height: 1180 }); await H.sleep(300);
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.screenshot({ path: path.join(out, "warmup-page.png"), fullPage: true });
    await station.send({ type: "takeout", darts: 7 }); await H.sleep(900);
    await page.click("#abandonBtn"); await page.click("#abandonYesBtn"); await H.sleep(1500);
    // Free throwing, no time limit: nine darts, then Finish.
    await page.click("[data-drill='free']"); await H.sleep(600);
    await page.selectOption("#set_minutes", "0"); await H.sleep(300);
    await page.screenshot({ path: path.join(out, "free-card.png"), fullPage: true });
    await page.click("#startBtn"); await H.sleep(1200);
    for (const [n, ring, label] of [[20, "T", "T20"], [20, "S", "S20"], [19, "T", "T19"], [16, "D", "D16"], [3, "S", "S3"], [19, "S", "S19"], [18, "T", "T18"], [20, "S", "S20"], [17, "S", "S17"]]) await throwAt(n, ring, label, 700);
    await page.click("#boardBtn2");
    await page.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    await H.sleep(800);
    await page.screenshot({ path: path.join(out, "free-board-ipad.png") });
    await page.click("#boardMode [data-man=fin]"); await H.sleep(1800);
    await page.screenshot({ path: path.join(out, "free-board-done.png") });
    await page.click("#boardMode [data-act=exit]"); await H.sleep(600);
    await page.screenshot({ path: path.join(out, "free-result.png"), fullPage: true });
    await page.click("#doneBtn"); await H.sleep(1200);
    // The cameras off again, as the drills after expect.
    await page.evaluate(() => { const c = document.getElementById("camToggle"); c.checked = false; c.dispatchEvent(new Event("change")); }); await H.sleep(400);
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
