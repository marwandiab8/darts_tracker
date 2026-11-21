// The checkout drills on the Training page, on two devices of one account: a computer on the normal
// page and an iPad in Board mode with the voice on. The 121 Checkout Ladder with the cameras: the
// route at every dart, a checkout on the 3rd dart moving the target up, a dart after it not counted,
// a bust, a dart fixed on the iPad into a checkout, Undo from the computer, darts by hand (the route's
// button, Miss, another dart from the list) with no take-out needed, a reload, Stop. Then Two-Dart
// Finishes: two darts a try, a setup and the double, a third dart not counted, the take-out ending a
// try with a dart unseen, the settings' choice.
const H = require("./harness.cjs");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_trainingBoard: "1", dt_trainingVoice: "1" } });
    const url = `http://127.0.0.1:${H.PORT}/training.html?drill=ladder121`;
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
      heroLabel: document.getElementById("heroLabel").textContent,
      target: document.getElementById("target").textContent,
      next: [...document.getElementById("upNext").children].map((c) => c.textContent).join(" ").trim(),
      chips: [...document.querySelectorAll("#camDarts .chip")].map((c) => c.className.replace("chip ", "") + ":" + c.textContent),
      hitsRow: !document.getElementById("hitsRow").hidden,
      dartsRow: !document.getElementById("dartsRow").hidden,
      pad: ["p1", "p2", "p3", "pm"].map((id) => document.getElementById(id)).filter((b) => !b.hidden).map((b) => b.textContent + (b.disabled ? "(off)" : "")),
      playing: !document.getElementById("playCard").hidden,
      result: !document.getElementById("resultCard").hidden,
      undo: document.getElementById("undoBtn").textContent,
      note: document.getElementById("camNote").textContent,
      cells: [...document.querySelectorAll("#cells .cell")].map((c) => c.className.replace("cell ", "") + ":" + c.textContent),
    }));
    const boardView = () => ipad.evaluate(() => {
      const bm = document.getElementById("boardMode");
      const q = (s) => bm.querySelector(s);
      return {
        shown: !bm.hidden,
        target: q(".bm-target").textContent,
        label: q("[data-ref=label]").textContent,
        count: q("[data-ref=count]").textContent,
        next: [...q("[data-ref=next]").children].map((c) => c.textContent).join(" ").trim(),
        nextCo: q("[data-ref=next]").classList.contains("co"),
        opp: [...q("[data-ref=opp]").children].map((c) => c.textContent).join(" ").trim(),
        slots: [...bm.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        pad: [...bm.querySelectorAll("[data-man]")].filter((b) => !b.hidden).map((b) => b.textContent + (b.disabled ? "(off)" : "")),
        padCols: q("[data-ref=pad]").style.getPropertyValue("--bm-pad"),
        undo: q("[data-ref=undo]").textContent,
        cells: [...bm.querySelectorAll("[data-ref=cells] .bm-cell")].map((c) => c.className.replace("bm-cell ", "") + ":" + c.textContent),
        cap: q("[data-ref=capLeft]").textContent,
        idle: !q("[data-ref=idle]").hidden,
        idleText: q("[data-ref=idle]").textContent.replace(/\s+/g, " ").trim(),
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=momentBig]").textContent,
        mode: q("[data-ref=mode]").textContent,
        sheet: q("[data-ref=sheet]").hidden ? null : [...bm.querySelectorAll("[data-fix]")].map((b) => b.dataset.fix),
      };
    });
    const said = () => ipad.evaluate(() => window.__said.slice());

    // ---- the ladder ----
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    let b = await boardView();
    check(b.shown && b.idle && /121 Checkout Ladder/.test(b.idleText), "the iPad opens in Board mode, waiting for the ladder: " + b.idleText);
    await computer.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    check(await computer.$eval("#drillHead", (e) => e.textContent) === "121 Checkout Ladder", "the computer shows the drill card for the ladder (from ?drill=)");
    const settingIds = await computer.$$eval("#settings input, #settings select", (els) => els.map((e) => e.id));
    check(settingIds.join(",") === "set_start,set_floor,set_visits,set_attempts", "the ladder's settings: " + settingIds.join(","));
    await computer.click("#startBtn");
    await H.sleep(1500);
    let p = await page(computer);
    check(p.playing && p.scoreLabel === "Target" && p.score === "121" && p.heroLabel === "You require" && p.target === "121", `the page: target 121, you require 121 (${p.scoreLabel} ${p.score}, ${p.heroLabel} ${p.target})`);
    check(p.next === "Route T17 T10 D20", "the route for 121 is shown: " + p.next);
    check(!p.hitsRow && p.dartsRow && p.pad.join(",") === "T17,T10,D20,Miss", "the darts buttons replace the hits buttons: " + p.pad.join(","));
    b = await boardView();
    check(b.target === "121" && b.label === "You require" && b.next === "Route T17 T10 D20" && b.nextCo, `Board mode: ${b.label} ${b.target}, ${b.next}`);
    check(b.pad.join(",") === "T17,T10,D20,Miss" && b.padCols === "5", "Board mode's pad is the route and Miss (and Undo), 5 columns: " + b.pad.join(",") + " / " + b.padCols);
    check(/Target 121/.test(b.opp), "the target beside the hero: " + b.opp);
    check(b.cells[0] === "current:1213 visits left" && b.cells.length === 10, "the strip: 10 targets, the first current: " + b.cells.slice(0, 2).join(" "));

    // Camera: T17, T10, D20: a checkout on the 3rd dart.
    await ipad.click("#boardMode [data-act=camera]");
    await ipad.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    await throwAt(17, "T", "T17");
    p = await page(computer); b = await boardView();
    check(p.target === "70" && p.next === "Route T18 D8" && b.target === "70" && b.next === "Route T18 D8", `after T17: 70 left, the route for 2 darts (${p.target} ${p.next} / ${b.target} ${b.next})`);
    check(p.chips[0] === "hit:T17" && p.pad.join(",") === "T18,D8,Miss", "the dart chip and the buttons follow the route: " + p.chips.join(" ") + " / " + p.pad.join(","));
    await throwAt(10, "T", "T10");
    b = await boardView();
    check(b.target === "40" && b.next === "Route D20" && b.count === "Dart 3 of 3", `after T10: 40 left, D20 (${b.target} ${b.next} ${b.count})`);
    await throwAt(20, "D", "D20", 2000);
    let st = await state();
    b = await boardView();
    check(st.activeSession.play.level === 122 && st.activeSession.play.outs === 1 && st.activeSession.throws.length === 3, `the 3rd dart checks out: level 122, 1 out, 3 throws (level ${st.activeSession.play.level}, throws ${st.activeSession.throws.length})`);
    check(b.label === "Pull your darts out, then" && b.target === "122" && /Target 122/.test(b.opp), `Board mode asks for the take-out, then 122 (${b.label} ${b.target}; ${b.opp})`);
    check(b.slots[2] === "D20|Game shot", "the 3rd slot says game shot: " + b.slots.join(" ; "));
    let heard = await said();
    check(heard.some((s) => s === "Game shot. 121 in 3 darts. Up to 122."), "the voice: " + heard.slice(-2).join(" / "));
    check(b.moment === "Up to 122" || b.cells[0] === "done h3:1213 darts", "a moment for the new high, and the strip's first cell done: " + b.moment + " / " + b.cells[0]);
    // A 4th dart before the take-out is not counted.
    await throwAt(5, "S", "S5");
    st = await state();
    check(st.activeSession.throws.length === 3 && st.activeSession.cam.visit.darts.length === 3, "a 4th dart before the take-out is not counted");
    await takeout();
    b = await boardView();
    check(b.target === "122" && b.label === "You require" && b.next.startsWith("Route "), `after the take-out: 122 with its route (${b.label} ${b.target} ${b.next})`);

    // Visit at 122: T20, T20, then S1 leaves 1: a bust.
    await throwAt(20, "T", "T20"); await throwAt(20, "T", "T20"); await throwAt(1, "S", "S1", 2000);
    st = await state(); b = await boardView();
    check(st.activeSession.play.attempt.remaining === 122 && st.activeSession.play.attempt.visits === 1, `a bust puts the score back to 122, one visit used (remaining ${st.activeSession.play.attempt.remaining}, visits ${st.activeSession.play.attempt.visits})`);
    check(b.slots[2] === "S1|Bust" && b.label === "Pull your darts out, then", "the 3rd slot says bust and the take-out is asked for: " + b.slots[2]);
    heard = await said();
    check(heard[heard.length - 1] === "Bust. You require 122.", "the voice says bust: " + heard[heard.length - 1]);
    // Fix the 3rd dart on the iPad: it was in D1, a checkout.
    await ipad.click("#boardMode .bm-slot[data-i='2']");
    await H.sleep(400);
    b = await boardView();
    check(b.sheet && b.sheet[0] === "D1" && b.sheet.includes("MISS") && b.sheet.includes("other") && b.sheet.includes("remove"), "the fix sheet offers the route's dart (D1), a miss, another number, remove: " + (b.sheet || []).join(","));
    await ipad.click("#boardMode [data-fix='D1']");
    await H.sleep(2000);
    st = await state(); b = await boardView();
    check(st.activeSession.play.level === 123 && st.activeSession.play.outs === 2 && st.activeSession.throws.length === 6, `the fix makes it a checkout: level 123, 2 outs, 6 throws (level ${st.activeSession.play.level}, throws ${st.activeSession.throws.length})`);
    check(b.slots[2].startsWith("D1|Game shot") && b.undo === "Undo (2)", "the slot now says game shot, and 2 undo steps: " + b.slots[2] + " / " + b.undo);
    await takeout();
    // Undo from the computer: back before the visit at 122.
    await computer.click("#undoBtn");
    await H.sleep(1800);
    st = await state(); p = await page(computer);
    check(st.activeSession.play.level === 122 && st.activeSession.play.attempt.remaining === 122 && st.activeSession.play.attempt.visits === 0 && st.activeSession.throws.length === 3, `Undo from the computer takes the visit back (level ${st.activeSession.play.level}, remaining ${st.activeSession.play.attempt.remaining}, throws ${st.activeSession.throws.length})`);
    check(p.target === "122" && p.undo === "Undo", "the page shows 122 again with one undo step left: " + p.target + " / " + p.undo);
    heard = await said();
    check(heard[heard.length - 1] === "Undone. You require 122.", "the voice: " + heard[heard.length - 1]);

    // By hand on the computer: the route's button, Miss, another dart from the list. No take-out needed.
    await computer.click("#p1"); await H.sleep(900); // T20: 62
    p = await page(computer);
    check(p.target === "62" && p.chips[0] === "hit:T20", "a tap on the route's dart enters it: " + p.target + " / " + p.chips.join(" "));
    await computer.click("#pm"); await H.sleep(900);
    p = await page(computer);
    check(p.target === "62" && p.chips[1] === "miss:Miss", "Miss enters a miss: " + p.chips.join(" "));
    await computer.selectOption("#segPick", "S2"); await computer.click("#segAdd"); await H.sleep(1500);
    st = await state(); p = await page(computer);
    check(st.activeSession.play.attempt.remaining === 60 && st.activeSession.play.attempt.visits === 1 && st.activeSession.throws.length === 6, `three darts by hand score the visit: 60 left (remaining ${st.activeSession.play.attempt.remaining}, visits ${st.activeSession.play.attempt.visits})`);
    check(p.heroLabel === "You require" && p.pad.join(",") === "S20,D20,Miss", "with the visit by hand throughout, no take-out is asked for and the buttons stay live: " + p.heroLabel + " / " + p.pad.join(","));
    check(st.activeSession.throws.slice(3).every((t) => t.src === "btn"), "the darts by hand are saved as btn");
    // A reload keeps the drill.
    await computer.reload();
    await computer.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    await computer.waitForSelector("#playCard:not([hidden])", { timeout: 15000 });
    await H.sleep(1200);
    p = await page(computer);
    check(p.playing && p.target === "60" && p.score === "122" && p.dartsRow, "a reload comes back to the ladder at 60: " + p.target);
    // Stop: kept as unfinished.
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(2000);
    let docs = await saved();
    check(docs.length === 1 && docs[0].drill === "ladder121" && docs[0].complete === false && docs[0].result.outs === 1 && docs[0].throws.length === 6, `Stop keeps the ladder round as unfinished (${docs.length} saved, outs ${docs[0] && docs[0].result.outs})`);
    const rows = await computer.$$eval("#historyHead th", (els) => els.map((e) => e.textContent));
    check(rows.join(",") === "Started,Highest,Finished on,Checked out,Time", "the history columns are the ladder's: " + rows.join(","));

    // ---- Two-Dart Finishes ----
    await computer.click("[data-drill='twodart']");
    await H.sleep(800);
    check(await computer.$eval("#set_order", (e) => e.tagName + ":" + e.value) === "SELECT:up", "the order setting is a select, in order by default");
    await computer.click("#startBtn");
    await H.sleep(1800);
    p = await page(computer); b = await boardView();
    check(p.scoreLabel === "Finishes" && p.score === "0 of 0" && p.heroLabel === "Finish" && p.target === "61" && p.next === "Route T15 D8", `the two-dart drill: ${p.heroLabel} ${p.target}, ${p.next}`);
    check(b.target === "61" && b.count === "Dart 1 of 2" && b.mode === "Two-Dart Finishes" && b.cells.length === 10, `Board mode: ${b.target}, ${b.count}, ${b.mode}, ${b.cells.length} cells`);
    await throwAt(15, "T", "T15");
    b = await boardView();
    check(b.target === "16" && b.label === "Left" && b.next === "Route D8" && b.count === "Dart 2 of 2" && b.slots[0] === "T15|45. Left 16: D8", `after T15: 16 left, D8 (${b.label} ${b.target} ${b.next}; ${b.slots[0]})`);
    await throwAt(8, "D", "D8", 2000);
    st = await state(); b = await boardView();
    check(st.activeSession.play.outs === 1 && st.activeSession.play.cursor === 1 && st.activeSession.throws.length === 2, `the 2nd dart finishes 61 (outs ${st.activeSession.play.outs}, cursor ${st.activeSession.play.cursor})`);
    check(b.label === "Pull your darts out, then" && b.target === "62" && b.cells[0] === "done h3:61in", `then 62, the first cell done (${b.label} ${b.target}; ${b.cells[0]})`);
    heard = await said();
    check(heard[heard.length - 1] === "61. Game shot. Next, 62.", "the voice: " + heard[heard.length - 1]);
    await throwAt(1, "S", "S1");
    st = await state();
    check(st.activeSession.throws.length === 2 && st.activeSession.cam.visit.darts.length === 2, "a 3rd dart before the take-out is not counted");
    await takeout();
    // 62: a setup missed, then the take-out after one dart: the dart not seen is a miss and the try is over.
    await throwAt(10, "S", "S10");
    b = await boardView();
    check(b.target === "52" && b.next === "No finish", `S10 leaves 52: no finish (${b.target} ${b.next})`);
    await takeout(2000);
    st = await state(); b = await boardView();
    check(st.activeSession.play.cursor === 2 && st.activeSession.play.tries[1].setup === false && st.activeSession.throws.length === 4 && st.activeSession.throws[3].src === "unseen", `the take-out ends the try with a dart unseen (cursor ${st.activeSession.play.cursor}, throws ${st.activeSession.throws.length})`);
    check(b.target === "63" && b.cells[1] === "done h0:62setup no", "then 63, the second cell a setup missed: " + b.cells[1]);
    heard = await said();
    check(heard[heard.length - 1] === "62. Setup missed. Next, 63.", "the voice: " + heard[heard.length - 1]);
    p = await page(computer);
    check(p.score === "1 of 2" && p.cells[0] === "done h3:61in", "the page: 1 of 2 finished: " + p.score + " / " + p.cells[0]);
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(2000);
    docs = await saved();
    check(docs.length === 2 && docs.some((d) => d.drill === "twodart" && d.complete === false && d.result.outs === 1 && d.result.tries === 2), "Stop keeps the two-dart round as unfinished");

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
