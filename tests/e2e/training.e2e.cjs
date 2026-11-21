// The Training page on two devices of one account, both with the cameras on: a computer on the normal
// page and an iPad in Board mode with the voice on, playing Bob's 27. Each camera dart counted once;
// a visit scored on its 3rd dart; a 4th dart before the take-out not counted; a dart fixed by tapping
// it; Undo back several steps from the other device; the buttons; darts pulled out before all 3 were
// seen; Board mode / Camera / Voice remembered after a reload; the screen kept on; a finished drill
// saved once with its best, taken back by Undo and saved again; Play again; Stop keeps the visits as
// unfinished.
const H = require("./harness.cjs");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_trainingBoard: "1", dt_trainingVoice: "1" } });
    const url = `http://127.0.0.1:${H.PORT}/training.html`;
    await Promise.all([computer.goto(url), ipad.goto(url)]);
    const uid = await H.signIn(computer);
    await H.signIn(ipad);
    station = await H.makeStation(uid);
    // The e2e files share one emulator and one account: start from an empty database.
    await station.clear();
    await H.sleep(800);
    const throwAt = async (n, ring, label, wait = 1400) => { const p = n === "BULL" ? { x: 0, y: 0 } : H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    const state = () => station.read("trainingState", uid);
    const saved = async () => (await station.list("trainingSessions")).filter((s) => s.uid === uid);
    const page = (p) => p.evaluate(() => ({ score: document.getElementById("score").textContent, target: document.getElementById("target").textContent, playing: !document.getElementById("playCard").hidden, result: !document.getElementById("resultCard").hidden, resultBig: document.getElementById("resultBig").textContent, undo: document.getElementById("undoBtn").textContent, note: document.getElementById("camNote").textContent }));
    const boardView = () => ipad.evaluate(() => {
      const bm = document.getElementById("boardMode");
      const q = (s) => bm.querySelector(s);
      return {
        shown: !bm.hidden,
        target: q(".bm-target").textContent,
        label: q("[data-ref=label]").textContent,
        count: q("[data-ref=count]").textContent,
        opp: q("[data-ref=opp]").textContent.replace(/\s+/g, " ").trim(),
        slots: [...bm.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        dots: bm.querySelectorAll(".bm-dart").length,
        undo: q("[data-ref=undo]").textContent,
        cam: q("[data-act=camera]").getAttribute("aria-pressed"),
        cells: [...bm.querySelectorAll("[data-ref=cells] .bm-cell")].map((c) => c.className.replace("bm-cell ", "") + ":" + c.textContent),
        cap: q("[data-ref=capLeft]").textContent,
        idle: !q("[data-ref=idle]").hidden,
        idleText: q("[data-ref=idle]").textContent.replace(/\s+/g, " ").trim(),
        done: !q("[data-ref=done]").hidden,
        doneBig: q("[data-ref=doneBig]").textContent,
        doneSub: q("[data-ref=doneSub]").textContent,
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=momentBig]").textContent,
        mode: q("[data-ref=mode]").textContent,
      };
    });
    const said = () => ipad.evaluate(() => window.__said.slice());

    // Board mode is on for the iPad (remembered), nothing started: a big Start for the drill.
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    let b = await boardView();
    check(b.shown && b.idle && /Bob's 27/.test(b.idleText), "the iPad opens in Board mode, waiting for Bob's 27: " + b.idleText);
    await computer.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    check(await computer.$eval("#drillHead", (e) => e.textContent) === "Bob's 27", "the computer shows the drill card for Bob's 27");
    await computer.click("#startBtn");
    await H.sleep(1500);
    b = await boardView();
    check(b.target === "D1" && !b.idle && b.mode === "Bob's 27", `the round shows on the iPad's board: ${b.target} (${b.mode})`);
    check(/Score\s*27/.test(b.opp), "the score shows beside the target: " + b.opp);
    let p = await page(computer);
    check(p.playing && p.score === "27" && p.target === "D1", `the computer is playing: ${p.score} at ${p.target}`);

    // Cameras on, on both devices (the iPad through Board mode's Cameras button).
    await computer.check("#camToggle");
    await ipad.click("#boardMode [data-act=camera]");
    for (const d of [computer, ipad]) await d.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    check((await boardView()).cam === "true", "Board mode shows the cameras on");

    // D1: a single 1, a dart in D1, one off the board. Nothing scores until the 3rd dart; counted once.
    await throwAt(1, "S", "S1");
    b = await boardView();
    check(b.slots[0] === "S1|Inside the wire" && b.dots === 1 && b.count.replace(/\s+/g, " ") === "Dart 2 of 3", `dart 1 shows in its slot and on the board: ${b.slots[0]}, ${b.count}`);
    await throwAt(1, "D", "D1");
    let st = await state();
    check(st.activeSession.play.score === 27 && st.activeSession.play.cursor === 0, "nothing scores before the 3rd dart");
    await throwAt(20, "O", "MISS");
    st = await state();
    check(st.activeSession.play.score === 29 && st.activeSession.play.cursor === 1 && st.activeSession.play.visits[0].hits === 1, "D1: one hit, +2, counted once with both devices listening");
    b = await boardView();
    check(b.target === "D2" && b.slots[1] === "D1|In D1: +2" && b.slots[2] === "Outside|Off the board", "the iPad moves on to D2 and shows the visit: " + b.slots.join(" / "));
    check(/Pull your darts out/.test(b.label), `after the 3rd dart the board says to pull the darts out: "${b.label}"`);
    check(b.cells[0] === "done h1:1+2" && /current/.test(b.cells[1]), "the strip shows D1 done with +2 and D2 current: " + b.cells.slice(0, 2).join(" ; "));
    check((await said()).includes("D 1. One hit. 29. Next, D 2."), "the iPad says the visit and the next double: " + JSON.stringify(await said()));
    check((await computer.evaluate(() => window.__said.length)) === 0, "the computer (voice off) says nothing");
    p = await page(computer);
    check(p.score === "29" && p.target === "D2", `the computer's page agrees: ${p.score} at ${p.target}`);

    // A 4th dart before the take-out is not counted.
    await throwAt(2, "D", "D2");
    st = await state();
    const notes = [(await page(computer)).note, (await boardView()).slots.slice(-1)[0], await ipad.evaluate(() => document.getElementById("camNote").textContent)];
    check(st.activeSession.play.score === 29 && st.activeSession.play.cursor === 1 && st.activeSession.cam.visit.darts.length === 3 && notes.some((n) => /not counted/i.test(n)), "a 4th dart before the take-out is not counted (whichever device put it in says so): " + notes.join(" / "));

    // Darts out, then D2: three singles; the iPad fixes the 3rd, it was in D2.
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1200);
    await throwAt(2, "S", "S2"); await throwAt(2, "S", "S2"); await throwAt(2, "S", "S2");
    st = await state();
    check(st.activeSession.play.score === 25 && st.activeSession.play.cursor === 2, "D2 missed with 3 darts: 25");
    b = await boardView();
    check(b.target === "D3" && b.slots[2] === "S2|Inside the wire", "the board shows the 3rd dart inside the wire, now at D3: " + b.slots[2]);
    await ipad.click("#boardMode .bm-slot[data-i='2']");
    await ipad.waitForSelector("#boardMode [data-ref=sheet]:not([hidden])", { timeout: 5000 });
    const options = await ipad.$$eval("#boardMode [data-fix]", (els) => els.map((e) => e.textContent));
    check(options[0] === "In D2: a hit" && options.some((o) => /Single 2, inside the wire \(what the cameras saw\)/.test(o)), "the fix sheet offers D2 and marks what the cameras saw: " + options.join(" / "));
    await ipad.click("#boardMode [data-fix='D2']");
    await H.sleep(1500);
    st = await state();
    check(st.activeSession.play.score === 33 && st.activeSession.play.visits[1].hits === 1, `fixed: D2 one hit, 33 (score ${st.activeSession.play.score})`);
    b = await boardView();
    check(b.target === "D3" && b.slots[2] === "D2|In D2: +4 · fixed", "the board shows the fixed dart, marked fixed: " + b.slots[2]);
    check((await page(computer)).score === "33", "the computer sees the fix: " + (await page(computer)).score);
    check((await said()).includes("D 2. One hit. 33. Next, D 3."), "the iPad says the fixed visit");
    check(st.activeSession.throws.some((t) => t.l === "D2" && t.f === 1 && t.src === "cam"), "the throw log keeps the fixed dart");
    check(st.undoStack.length === 2, `two undo steps so far (${st.undoStack.length})`);

    // Undo two steps from the computer: the fixed D2 visit, then D1.
    for (let i = 0; i < 2; i += 1) { await computer.click("#undoBtn"); await H.sleep(1300); }
    st = await state();
    b = await boardView();
    check(st.activeSession.play.score === 27 && st.activeSession.play.cursor === 0 && b.target === "D1" && st.activeSession.throws.length === 0, `two Undos take back both visits: ${st.activeSession.play.score} at ${b.target}`);
    check(b.undo === "Undo" && (await page(computer)).undo === "Undo", "nothing left to undo");

    // The buttons in Board mode: 2 hits at D1.
    await ipad.click("#boardMode [data-man='h2']"); await H.sleep(1300);
    st = await state();
    check(st.activeSession.play.score === 31 && st.activeSession.play.visits[0].hits === 2 && st.activeSession.throws[0].src === "btn", "Board mode's 2 hits logs D1 as +4 by hand");

    // One dart in D2, darts out: the 2 not seen are misses, +4.
    await throwAt(2, "D", "D2");
    await station.send({ type: "takeout", darts: 1 }); await H.sleep(1500);
    st = await state();
    b = await boardView();
    check(st.activeSession.play.score === 35 && st.activeSession.play.cursor === 2 && b.target === "D3", "D2 scored at the take-out with the 2 unseen darts as misses: 35, on to D3");
    check(b.slots[1] === "Not seen|Counted as a miss" && b.slots[2] === "Not seen|Counted as a miss", "the unseen darts show in their slots: " + b.slots.join(" / "));

    // The iPad reloads: Board mode, the cameras and the voice are still on; a reloaded page says only new lines.
    await ipad.reload();
    await ipad.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    const back = await ipad.waitForFunction(() => {
      const bm = document.getElementById("boardMode");
      return bm && !bm.hidden && document.getElementById("camToggle").checked && document.getElementById("voiceToggle").checked && /watching the board/i.test(document.getElementById("camNote").textContent);
    }, null, { timeout: 20000 }).then(() => true, () => false);
    check(back, "after a reload the iPad is still in Board mode with the cameras and the voice on");
    b = await boardView();
    check(b.target === "D3" && /Score\s*35/.test(b.opp), `the reloaded iPad shows the drill where it was: ${b.target}, ${b.opp}`);
    await throwAt(3, "D", "D3", 900); await throwAt(3, "D", "D3", 900); await throwAt(3, "D", "D3", 1600);
    st = await state();
    check(st.activeSession.play.score === 53 && st.activeSession.play.visits[2].hits === 3, "D3: three hits, +18 = 53, counted once after the reload");
    check((await said()).includes("D 3. Three hits. 53. Next, D 4.") && (await said()).length === 1, "the reloaded iPad says the new visit only: " + JSON.stringify(await said()));
    check((await ipad.evaluate(() => window.__wake)) > 0, "Board mode keeps the iPad's screen on");

    // Finish with the computer's buttons: one hit at every double left.
    for (let k = 0; k < 20; k += 1) {
      p = await page(computer);
      if (!p.playing) break;
      await computer.click("#h1"); await H.sleep(700);
    }
    await H.sleep(3000);
    st = await state();
    let docs = await saved();
    const expected = 53 + (8 + 10 + 12 + 14 + 16 + 18 + 20 + 22 + 24 + 26 + 28 + 30 + 32 + 34 + 36 + 38 + 40) + 50;
    check(st.activeSession && st.activeSession.finishedAt && st.activeSession.saved === true && st.activeSession.play.score === expected, `the drill is finished (${st.activeSession && st.activeSession.play.score}, expected ${expected}) and marked saved`);
    check(docs.length === 1 && docs[0].complete === true && docs[0].key === expected && docs[0].throws.length === 63 && docs[0].drill === "bobs27", `the finished drill is saved once (${docs.length}): key ${docs[0] && docs[0].key}, ${docs[0] && docs[0].throws.length} darts`);
    check(st.bests && st.bests["bobs27:27:stop"] && st.bests["bobs27:27:stop"].key === expected, "the best is kept with the state");
    p = await page(computer);
    check(p.result && p.resultBig === String(expected), `the computer shows the result: ${p.resultBig}`);
    check(await computer.$eval("#newBest", (e) => !e.hidden), "the computer shows New best!");
    b = await boardView();
    check(b.done && b.doneBig === String(expected) && /Bob's 27: all 21 doubles/.test(b.doneSub), `the iPad shows the round is done: ${b.doneBig} / ${b.doneSub}`);
    check((await said()).some((x) => /All 21 done\./.test(x)) && (await said()).some((x) => /^New best\./.test(x)), "the iPad says the round is done and the new best: " + JSON.stringify((await said()).slice(-2)));

    // Undo after the finish takes the last visit back and the saved round out of history; finishing again saves it again.
    await computer.click("#resultUndoBtn"); await H.sleep(2000);
    st = await state();
    docs = await saved();
    check(st.activeSession && !st.activeSession.finishedAt && st.activeSession.play.cursor === 20 && st.activeSession.saved === false, "Undo after the finish un-finishes the drill");
    check(docs.length === 0 && !(st.bests && st.bests["bobs27:27:stop"]), `the saved round is gone from history (${docs.length}) and the best with it`);
    check((await page(computer)).playing, "the computer is back to playing, at the bull");
    await computer.click("#h2"); await H.sleep(3000);
    st = await state();
    docs = await saved();
    check(docs.length === 1 && docs[0].key === expected + 50 && st.activeSession.saved === true, `finished again: saved once more with the new score (${docs[0] && docs[0].key})`);

    // Play again from the iPad: a new round at D1 with nothing to undo.
    await ipad.click("#boardMode [data-act=again]"); await H.sleep(1500);
    st = await state();
    b = await boardView();
    check(st.activeSession && !st.activeSession.finishedAt && st.activeSession.play.cursor === 0 && b.target === "D1" && b.undo === "Undo", `Play again starts a new round at D1 (finishedAt ${st.activeSession && st.activeSession.finishedAt}, cursor ${st.activeSession && st.activeSession.play.cursor}, target ${b.target}, undo "${b.undo}", saved ${st.activeSession && st.activeSession.saved})`);
    check(/best \d+/.test(b.opp), "the new round shows the best beside the score: " + b.opp);

    // Stop with nothing thrown: nothing saved. One visit then Stop: kept as unfinished.
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(1500);
    st = await state();
    check(st.activeSession === null && (await saved()).length === 1, "stopping an empty round saves nothing");
    await computer.click("#startBtn"); await H.sleep(1200);
    await computer.click("#h1"); await H.sleep(1000);
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(2000);
    docs = await saved();
    const partial = docs.find((d) => d.complete === false);
    check(docs.length === 2 && partial && partial.result.doublesPlayed === 1 && partial.throws.length === 3, `a stopped round with a visit is kept as unfinished (${docs.length} saved)`);
    check((await state()).activeSession === null, "and the state is clear");
    b = await boardView();
    check(b.idle && /Your best: \d+/.test(b.idleText), "the iPad's Board mode is back to Start, with the best: " + b.idleText);
    const rows = await computer.$$eval("#historyBody tr", (els) => els.map((e) => e.textContent));
    check(rows.length === 2 && rows.some((r) => /unfinished/.test(r)), "the history list shows both rounds, one unfinished: " + rows.join(" | "));

    // Exit Board mode on the iPad: back to the page, and it stays off after a reload.
    await ipad.click("#boardMode [data-act=exit]");
    await ipad.reload();
    await ipad.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    await H.sleep(2500);
    check(await ipad.evaluate(() => document.getElementById("boardMode").hidden), "Exit leaves Board mode, also after a reload");

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
