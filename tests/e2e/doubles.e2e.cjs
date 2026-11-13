// The Doubles page on two devices of one account, both with the cameras on: a computer on the normal
// page and an iPad in Board mode with the voice on. Each camera dart counted once, the board showing
// the visit, a dart fixed by tapping it, Undo back several steps from the other device, the buttons,
// darts pulled out before all 3 were seen, Board mode / Camera / Voice remembered after a reload, the
// screen kept on, and a finished round saved.
const H = require("./harness.cjs");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_doublesBoard: "1", dt_doublesVoice: "1" } });
    const url = `http://127.0.0.1:${H.PORT}/doubles.html`;
    await Promise.all([computer.goto(url), ipad.goto(url)]);
    const uid = await H.signIn(computer);
    await H.signIn(ipad);
    station = await H.makeStation(uid);
    const throwAt = async (n, ring, label, wait = 1400) => { const p = H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    const state = () => station.read("doublesState", uid);
    const page = (p) => p.evaluate(() => ({ target: document.getElementById("target").textContent, done: document.getElementById("doneCount").textContent }));
    const boardView = () => ipad.evaluate(() => {
      const bm = document.getElementById("boardMode");
      const q = (s) => bm.querySelector(s);
      return {
        shown: !bm.hidden,
        target: q(".bm-target").textContent,
        slots: [...bm.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        dots: bm.querySelectorAll(".bm-dart").length,
        undo: q("[data-act=undo]").textContent,
        cam: q("[data-act=camera]").getAttribute("aria-pressed"),
        cell: (k) => null,
        cells: [...bm.querySelectorAll(".bm-cell")].map((c) => c.className.replace("bm-cell ", "") + ":" + c.textContent),
        idle: !q("[data-ref=idle]").hidden,
        idleText: q("[data-ref=idle]").textContent.replace(/\s+/g, " ").trim(),
      };
    });
    const said = () => ipad.evaluate(() => window.__said.slice());

    // Board mode is on for the iPad (remembered), with nothing started yet: a big Start.
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    let b = await boardView();
    check(b.shown && b.idle, "iPad opens in Board mode, waiting for a round");
    await computer.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await computer.click("#startBtn");
    await H.sleep(1500);
    b = await boardView();
    check(b.target === "D1" && !b.idle, "the round shows on the iPad's board: " + b.target);
    check((await said()).includes("Throw at D 1."), "the iPad says the first double: " + JSON.stringify(await said()));

    // Cameras on, on both devices (the iPad through Board mode's Cameras button).
    await computer.check("#camToggle");
    await ipad.click("#boardMode [data-act=camera]");
    for (const p of [computer, ipad]) await p.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    check(await ipad.waitForFunction(() => document.querySelector("#boardMode [data-act=camera]").getAttribute("aria-pressed") === "true", null, { timeout: 3000 }).then(() => true, () => false), "Board mode shows the cameras on");

    // D1: a single 1, outside the 20, then D1: a hit on dart 3. Counted once with both listening.
    await throwAt(1, "S", "S1");
    b = await boardView();
    check(b.slots[0].startsWith("S1|") && b.dots === 1, "dart 1 shows in its slot and on the board: " + b.slots[0]);
    await throwAt(20, "O", "MISS");
    await throwAt(1, "D", "D1");
    let st = await state();
    check(st.activeSession.doubles.D1.hitDart === 3 && st.activeSession.doubles.D1.attempts === 1 && st.lifetime.doubles.D1.hits3 === 1, "D1 hit on dart 3, counted once");
    b = await boardView();
    check(b.target === "D2" && b.slots[2] === "D1|Hit on dart 3", "the iPad moves on to D2 and shows the hit: " + b.slots.join(" / "));
    check(b.slots[1] === "Outside|Off the board", "the dart outside the 20 reads as off the board: " + b.slots[1]);
    check(b.cells[0] === "done:13rd", "D1's cell says 3rd: " + b.cells[0]);
    check((await said()).includes("D 1, dart 3. D 2."), "the iPad says the hit and the next double");
    check((await computer.evaluate(() => window.__said.length)) === 0, "the computer (voice off) says nothing");
    check((await page(computer)).target === "D2", "the computer's page agrees: D2");

    // Pull the darts out, then D2: three singles, a miss; the iPad fixes the 3rd: it was in D2.
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1200);
    await throwAt(2, "S", "S2"); await throwAt(2, "S", "S2"); await throwAt(2, "S", "S2");
    st = await state();
    check(st.activeSession.doubles.D2.attempts === 1 && !st.activeSession.doubles.D2.completed, "D2 missed with 3 darts");
    b = await boardView();
    check(b.target === "D3" && b.slots[2] === "S2|Inside the wire", "the board shows the 3rd dart inside the wire, now at D3: " + b.slots[2]);
    const undoBefore = b.undo;
    await ipad.click("#boardMode .bm-slot[data-i='2']");
    await ipad.waitForSelector("#boardMode [data-ref=sheet]:not([hidden])", { timeout: 5000 });
    const options = await ipad.$$eval("#boardMode [data-fix]", (els) => els.map((e) => e.textContent));
    check(options[0] === "In D2: a hit" && options.some((o) => /Single 2, inside the wire \(what the cameras saw\)/.test(o)), "the fix sheet offers D2 and marks what the cameras saw: " + options.join(" / "));
    await ipad.click("#boardMode [data-fix='D2']");
    await H.sleep(1500);
    st = await state();
    const d2 = st.activeSession.doubles.D2;
    check(d2.completed && d2.hitDart === 3 && d2.attempts === 1 && st.lifetime.doubles.D2.hits3 === 1 && st.lifetime.doubles.D2.attempts === 1, `fixed: D2 hit on dart 3 (tries ${d2.attempts}, dart ${d2.hitDart})`);
    b = await boardView();
    check(b.target === "D3" && b.slots[2].startsWith("D2|Hit on dart 3"), "the board shows the fixed dart: " + b.slots[2]);
    check((await page(computer)).done === "2/21", "the computer sees the fix: " + (await page(computer)).done);
    check((await said()).includes("D 2, dart 3. D 3."), "the iPad says the fixed hit");
    check(st.activeSession.throws.find((t) => t.l === "D2" && t.f === 1), "the throw log keeps the fixed dart");

    // Undo three steps from the computer: the fix, the D2 miss, the D1 hit.
    for (let i = 0; i < 3; i += 1) { await computer.click("#undoBtn"); await H.sleep(1300); }
    st = await state();
    check(!st.activeSession.doubles.D1.completed && st.activeSession.doubles.D1.attempts === 0 && st.activeSession.doubles.D2.attempts === 0 && st.lifetime.doubles.D1.hits === 0 && st.lifetime.doubles.D2.attempts === 0, "three Undos take back the fix, the miss and the hit");
    b = await boardView();
    check(b.target === "D1" && /Undo/.test(undoBefore), `the iPad is back at D1 (undo button was "${undoBefore}", now "${b.undo}")`);

    // The buttons in Board mode: Hit on 1 for D1.
    await ipad.click("#boardMode [data-man='hit1']"); await H.sleep(1300);
    st = await state();
    check(st.activeSession.doubles.D1.completed && st.activeSession.doubles.D1.hitDart === 1, "Board mode's Hit on 1 logs D1 on dart 1");

    // One dart at D2, darts out: the 2 not seen are misses, and the slots say so.
    await station.send({ type: "takeout", darts: 0 }); await H.sleep(800);
    await throwAt(2, "S", "S2");
    await station.send({ type: "takeout", darts: 1 }); await H.sleep(1500);
    st = await state();
    b = await boardView();
    check(st.activeSession.doubles.D2.attempts === 1 && !st.activeSession.doubles.D2.completed && b.target === "D3", "D2 missed with the 2 unseen darts, on to D3");
    check(b.slots[1] === "Not seen|Counted as a miss" && b.slots[2] === "Not seen|Counted as a miss", "the unseen darts show in their slots: " + b.slots.join(" / "));

    // The iPad reloads: Board mode, the cameras and the voice are still on.
    await ipad.reload();
    await ipad.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    const back = await ipad.waitForFunction(() => {
      const bm = document.getElementById("boardMode");
      return bm && !bm.hidden && document.getElementById("camToggle").checked && document.getElementById("voiceToggle").checked && /watching the board/i.test(document.getElementById("camNote").textContent);
    }, null, { timeout: 20000 }).then(() => true, () => false);
    check(back, "after a reload the iPad is still in Board mode with the cameras and the voice on");
    await throwAt(3, "D", "D3", 1800);
    st = await state();
    check(st.activeSession.doubles.D3.attempts === 1 && st.activeSession.doubles.D3.hitDart === 1, "D3 counted once with both devices listening after the reload");
    check((await said()).includes("D 3, dart 1. D 4."), "the reloaded iPad speaks the new hit (and not the old ones): " + JSON.stringify(await said()));
    check((await said()).length === 1, "nothing from before the reload is said again");
    check((await ipad.evaluate(() => window.__wake)) > 0, "Board mode keeps the iPad's screen on");

    // Finish with the computer's buttons: every open double hit on dart 1 (D2 comes back at the end).
    for (let k = 0; k < 20; k += 1) {
      const t = (await page(computer)).target;
      if (t === "Done" || t === "-") break; // finished (and maybe already saved and cleared)
      await computer.click("#hit1"); await H.sleep(700);
    }
    await H.sleep(2500);
    st = await state();
    const saved = (await station.list("doublesSessions")).filter((s) => s.uid === uid);
    check(st.activeSession === null && saved.length === 1, `the finished round is saved and cleared (${saved.length} saved)`);
    if (saved[0]) check(Array.isArray(saved[0].throws) && saved[0].throws.length >= 8, `the saved round keeps where the camera darts landed (${saved[0].throws && saved[0].throws.length})`);
    b = await boardView();
    check(b.idle && /Round done/.test(b.idleText) && /Last round: \d+ darts/.test(b.idleText), "the iPad's Board mode shows the round is done: " + b.idleText);
    check((await said()).some((x) => /All 21 done\. \d+ darts in/.test(x)), "the iPad says the round is done");

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
