// The scoring drills on the Training page, on two devices of one account (a computer on the page,
// an iPad in Board mode with the voice): Triple 20 Marathon with the cameras, ending on the last
// triple mid-visit and saved with its best (fewer darts); Big Triples by hand and with the cameras,
// darts unseen at the take-out; Game of 9 by hand, a number passed, the pass mark in the caption;
// the choice settings; Stop keeps a run as unfinished.
const H = require("./harness.cjs");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_trainingBoard: "1", dt_trainingVoice: "1" } });
    const url = `http://127.0.0.1:${H.PORT}/training.html?drill=marathon`;
    await Promise.all([computer.goto(url), ipad.goto(url)]);
    const uid = await H.signIn(computer);
    await H.signIn(ipad);
    station = await H.makeStation(uid);
    // The e2e files share one emulator and one account: start from an empty database.
    await station.clear();
    await H.sleep(800);
    const throwAt = async (n, ring, label, wait = 1400) => { const p = n === "BULL" ? { x: 0, y: 0 } : H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    const takeout = async (wait = 1200) => { await station.send({ type: "takeout", darts: 3 }); await H.sleep(wait); };
    const state = () => station.read("trainingState", uid);
    const saved = async () => (await station.list("trainingSessions")).filter((s) => s.uid === uid);
    const page = (p) => p.evaluate(() => ({
      scoreLabel: document.getElementById("scoreLabel").textContent,
      score: document.getElementById("score").textContent,
      target: document.getElementById("target").textContent,
      hitsRow: !document.getElementById("hitsRow").hidden,
      playing: !document.getElementById("playCard").hidden,
      result: !document.getElementById("resultCard").hidden,
      resultBig: document.getElementById("resultBig").textContent,
      resultSub: document.getElementById("resultSub").textContent,
      newBest: !document.getElementById("newBest").hidden,
      pace: document.getElementById("pace").textContent,
      cells: [...document.querySelectorAll("#cells .cell")].map((c) => c.className.replace("cell ", "") + ":" + c.textContent),
      facts: [...document.querySelectorAll("#facts .fact")].map((f) => f.textContent.replace(/\s+/g, " ").trim()),
    }));
    const boardView = () => ipad.evaluate(() => {
      const bm = document.getElementById("boardMode");
      const q = (s) => bm.querySelector(s);
      return {
        target: q(".bm-target").textContent,
        label: q("[data-ref=label]").textContent,
        opp: [...q("[data-ref=opp]").children].map((c) => c.textContent).join(" ").trim(),
        slots: [...bm.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        pad: [...bm.querySelectorAll("[data-man]")].filter((b) => !b.hidden).map((b) => b.textContent),
        cells: [...bm.querySelectorAll("[data-ref=cells] .bm-cell")].map((c) => c.className.replace("bm-cell ", "") + ":" + c.textContent),
        cap: q("[data-ref=capLeft]").textContent,
        done: !q("[data-ref=done]").hidden,
        doneBig: q("[data-ref=doneBig]").textContent,
        doneSub: q("[data-ref=doneSub]").textContent,
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=momentBig]").textContent,
        mode: q("[data-ref=mode]").textContent,
      };
    });
    const said = () => ipad.evaluate(() => window.__said.slice());

    // ---- Triple 20 Marathon, 2 to hit ----
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    await computer.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    check(await computer.$eval("#drillHead", (e) => e.textContent) === "Triple 20 Marathon", "the drill card for the marathon (from ?drill=)");
    check(await computer.$eval("#set_number", (e) => e.tagName + ":" + e.value) === "SELECT:20", "the triple is a choice, T20 by default");
    await computer.fill("#set_need", "2");
    await computer.$eval("#set_need", (e) => e.dispatchEvent(new Event("change")));
    await H.sleep(300);
    await computer.click("#startBtn");
    await H.sleep(1500);
    let p = await page(computer); let b = await boardView();
    check(p.playing && p.scoreLabel === "Hit" && p.score === "0 of 2" && p.target === "T20" && p.hitsRow, `the marathon starts: ${p.scoreLabel} ${p.score}, at ${p.target}`);
    check(b.target === "T20" && b.pad.join(",") === "No hits,1 hit,2 hits,3 hits" && b.cells.length === 2 && /Hit 0 of 2/.test(b.opp), `Board mode: ${b.target}, pad ${b.pad.join(",")}, ${b.cells.length} cells, ${b.opp}`);
    await ipad.click("#boardMode [data-act=camera]");
    await ipad.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    await throwAt(20, "T", "T20");
    await throwAt(20, "S", "S20");
    b = await boardView();
    check(b.slots[0] === "T20|In T20" && b.slots[1] === "S20|Single 20", "the slots read the triple and the single: " + b.slots.slice(0, 2).join(" ; "));
    await throwAt(20, "T", "T20", 2500);
    let st = await state(); p = await page(computer); b = await boardView();
    check(st.activeSession.finishedAt && st.activeSession.play.darts === 3 && st.activeSession.play.hits === 2, `the second triple on the 3rd dart ends it: 3 darts (darts ${st.activeSession.play.darts}, hits ${st.activeSession.play.hits})`);
    check(p.result && p.resultBig === "3" && /2 T20s in 3 darts \(67%\)/.test(p.resultSub), `the result: ${p.resultBig}, ${p.resultSub}`);
    check(b.done && b.doneBig === "3" && /Triple 20 Marathon: 2 in 3 darts/.test(b.doneSub), `Board mode's done screen: ${b.doneBig}, ${b.doneSub}`);
    let heard = await said();
    check(heard.some((s) => s === "Two hits. 2 of 2. All 2. 3 darts."), "the voice: " + heard.slice(-2).join(" / "));
    await H.sleep(1500);
    let docs = await saved();
    check(docs.length === 1 && docs[0].drill === "marathon" && docs[0].key === 3 && docs[0].complete === true, `saved with its key (darts) ${docs[0] && docs[0].key}`);
    st = await state();
    check(st.bests && st.bests["marathon:20:2"] && st.bests["marathon:20:2"].key === 3, "the best is kept under the marathon's key: " + JSON.stringify(st.bests));
    p = await page(computer);
    check(p.newBest, "New best! on the result card");
    // Play again: the pace against the best, fewer darts being better.
    await computer.click("#againBtn"); await H.sleep(1500);
    await throwAt(20, "S", "S20"); await throwAt(20, "S", "S20"); await throwAt(20, "T", "T20", 1800);
    p = await page(computer);
    check(p.playing && p.score === "1 of 2" && p.pace === "2 darts behind your best", `the pace against the best: "${p.pace}" (${p.score})`);
    await takeout();
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(1800);
    docs = await saved();
    check(docs.length === 2 && docs.some((d) => d.complete === false && d.drill === "marathon"), "Stop keeps the second run as unfinished");

    // ---- Big Triples: T20 and T19, 3 darts each ----
    await computer.click("[data-drill='bigtriples']"); await H.sleep(600);
    await computer.selectOption("#set_numbers", "20 19");
    await computer.fill("#set_per", "3");
    await computer.$eval("#set_per", (e) => e.dispatchEvent(new Event("change")));
    await H.sleep(300);
    await computer.click("#startBtn"); await H.sleep(1500);
    p = await page(computer); b = await boardView();
    check(p.scoreLabel === "Triples" && p.target === "T20" && p.cells.length === 2 && b.mode === "Big Triples", `Big Triples: ${p.scoreLabel}, at ${p.target}, ${p.cells.length} visits`);
    await computer.click("#h2"); await H.sleep(1500);
    st = await state(); b = await boardView();
    check(st.activeSession.play.cursor === 1 && st.activeSession.play.total === 2 && b.target === "T19", `2 hits by hand at T20, on to T19 (${b.target})`);
    heard = await said();
    check(heard[heard.length - 1] === "T 20. Two hits. 2 at T 20. Next, T 19.", "the voice: " + heard[heard.length - 1]);
    await throwAt(19, "T", "T19");
    await takeout(2200);
    st = await state(); p = await page(computer);
    check(st.activeSession.finishedAt && st.activeSession.play.total === 3 && st.activeSession.throws.filter((t) => t.src === "unseen").length === 2, `the take-out after one dart: two unseen misses, 3 triples, done (total ${st.activeSession.play.total})`);
    check(p.result && p.resultBig === "3" && p.facts.some((f) => /^2 \/ 3\s*T20$/.test(f)) && p.facts.some((f) => /^1 \/ 3\s*T19$/.test(f)), "the result facts per number: " + p.facts.join(" | "));
    await computer.click("#doneBtn"); await H.sleep(1200);

    // ---- Game of 9: pass 7 of 9 ----
    await computer.click("[data-drill='gameof9']"); await H.sleep(600);
    await computer.click("#startBtn"); await H.sleep(1500);
    p = await page(computer); b = await boardView();
    check(p.scoreLabel === "Darts" && p.score === "0" && p.target === "20" && b.cells.length === 7 && /7 of 9 to pass/.test(b.cap), `Game of 9: ${p.scoreLabel} ${p.score}, at ${p.target}; ${b.cap}`);
    await computer.click("#h3"); await H.sleep(900);
    await computer.click("#h2"); await H.sleep(900);
    await computer.click("#h2"); await H.sleep(1800);
    st = await state(); p = await page(computer); b = await boardView();
    check(st.activeSession.play.stage === 1 && st.activeSession.play.darts === 9 && p.target === "19" && p.cells[0] === "done h3:201 try", `7 in 9 passes the 20 (stage ${st.activeSession.play.stage}, ${p.cells[0]})`);
    heard = await said();
    check(heard[heard.length - 1] === "20 passed. 7 in 9. Next, 19.", "the voice: " + heard[heard.length - 1]);
    check(b.moment === "20 passed" || b.cells[0] === "done h3:201 try", "a moment for the pass: " + b.moment);
    await computer.click("#h1"); await H.sleep(1200);
    b = await boardView();
    check(/try 1 at 19: 1 in 3/.test(b.cap), "the caption follows the try: " + b.cap);
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(1800);
    docs = await saved();
    check(docs.some((d) => d.drill === "gameof9" && d.complete === false && d.result.darts === 12), "Stop keeps the run as unfinished with its darts");

    const errors = [...computer.errors, ...ipad.errors];
    check(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
  } catch (error) {
    check(false, String(error.stack || error));
  } finally {
    if (station) await station.stop();
    await browser.close();
    server.kill();
    console.log(failed() ? `${failed()} FAILED` : "ALL PASSED");
    process.exit(failed() ? 1 : 0);
  }
})();
