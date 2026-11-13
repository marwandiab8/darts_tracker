// The JDC Challenge's Board mode and the round shared between devices (challenge.html,
// challenge-engine.js): an iPad in Board mode with the cameras and the voice, a computer following
// the same round. Camera darts go to their own target; a dart the cameras couldn't read waits for a
// tap and the darts after it wait behind it; a Shanghai fills the screen; a 4th dart before the
// pull-out isn't counted; the pull-out ends a visit; tapping a dart fixes it; Undo works from the
// other device; 3 misses; the doubles part (three doubles a visit, its own buttons); the voice on the
// iPad only; a reload keeps Board mode.
const H = require("./harness.cjs");
const C = require("../../public/challenge-engine.js");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const url = `http://127.0.0.1:${H.PORT}/challenge.html`;
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_challengeBoard: "1", dt_challengeVoice: "1", dt_challengeCamera: "1" } });
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    for (const p of [ipad, computer]) p.on("dialog", (d) => d.accept());
    await computer.goto(url);
    const uid = await H.signIn(computer);
    station = await H.makeStation(uid);
    await ipad.goto(url);
    await H.signIn(ipad);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const live = async () => { const d = await station.read("liveChallenges", uid); return d && d.state ? JSON.parse(d.state).round : null; };
    const said = (p) => p.evaluate(() => window.__said.slice());
    const send = async (label, n, ring) => { const s = n == null ? { x: 0, y: -1.2 } : n === "BULL" ? { x: 0.01, y: 0 } : H.spot(n, ring); await station.send(H.dart(label, s.x, s.y)); await H.sleep(900); };
    const bm = () => ipad.evaluate(() => {
      const b = document.getElementById("boardMode");
      const q = (sel) => b.querySelector(sel);
      return {
        label: q("[data-ref=label]").textContent, target: q(".bm-target").textContent, count: q("[data-ref=count]").textContent,
        info: q("[data-ref=info]").textContent,
        slots: [...b.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        pad: [...b.querySelectorAll("[data-man]")].filter((x) => !x.hidden).map((x) => x.textContent),
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=moment]").textContent,
        cells: [...b.querySelectorAll(".bm-cell")].length,
      };
    });

    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    await ipad.click("#boardMode [data-act=start]");
    let b = await until(async () => { const x = await bm(); return x.target === "10" ? x : null; }, 10000) || await bm();
    check(b.target === "10" && /Shanghai 10/.test(b.label) && b.cells === 19, "Board mode: Shanghai 10, the 19 visits: " + b.label + " / " + b.cells);
    check(await until(async () => /PlayCard|/.test("") && !(await computer.$eval("#playCard", (e) => e.classList.contains("hidden")))), "the computer joins the round");
    await until(async () => /watching the board/i.test(await ipad.$eval("#camNote", (e) => e.textContent)), 15000);

    // ---- a Shanghai through a dart the cameras couldn't read ------------------------------------
    await send("T10", 10, "T");
    await station.send({ type: "unreadable" }); await H.sleep(900);
    await send("S10", 10, "S");
    b = await bm();
    check(b.slots[0] === "T10|30" && b.slots[1] === "Not read|Tap what it hit" && b.slots[2] === "Held|Behind the dart they couldn't read", "T10, a dart to tap, S10 held behind it: " + b.slots.join(" / "));
    await ipad.click("#boardMode [data-man='2']"); // the dart they couldn't read: a double 10
    b = await until(async () => { const x = await bm(); return x.moment ? x : null; }, 5000) || await bm();
    check(/SHANGHAI/.test(b.moment), "T10, D10, S10: a Shanghai fills the screen: " + b.moment);
    let r = await until(async () => { const x = await live(); return x && x.darts.length === 3 ? x : null; }) || await live();
    check(r.darts.join("") === "321", "the darts in order: T10 D10 S10 (" + r.darts.join("") + ")");
    check(await until(async () => (await said(ipad)).some((x) => /SHANGHAI! 160\./.test(x))), "the iPad says it: " + JSON.stringify((await said(ipad)).slice(-2)));
    check((await said(computer)).length === 0, "the computer (Voice off) says nothing");

    // ---- the pull-out, then a 4th dart that isn't counted ---------------------------------------
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1200);
    await send("S11", 11, "S"); await send("S5", 5, "S"); await send("S11", 11, "S");
    await send("T12", 12, "T"); // a 4th dart, no pull-out seen
    r = await live();
    check(r.darts.length === 6 && r.darts.slice(3).join("") === "101", "the 4th dart isn't counted: 11 has S, miss, S (" + r.darts.join("") + ")");
    b = await bm();
    check(/Next door|In the 5/.test(b.slots[1]), "the miss says where it went: " + b.slots[1]);
    // ---- fixing a dart by tapping it ------------------------------------------------------------
    await ipad.click("#boardMode .bm-slot[data-i='1']");
    await ipad.waitForSelector("#boardMode [data-ref=sheet]:not([hidden])", { timeout: 5000 });
    const options = await ipad.$$eval("#boardMode [data-fix]", (els) => els.map((e) => e.textContent));
    check(options.join(" / ") === "Treble 11: 33 / Double 11: 22 / Single 11: 11 / Miss (what it is now)", "the fix sheet: " + options.join(" / "));
    await ipad.click("#boardMode [data-fix='2']");
    r = await until(async () => { const x = await live(); return x && x.darts[4] === 2 ? x : null; }) || await live();
    check(r.darts.slice(3).join("") === "121" && r.meta[4].f === 1, "fixed: a double 11, so S D S (" + r.darts.slice(3).join("") + ")");
    // ---- Undo from the computer -------------------------------------------------------------------
    await computer.click("#undoBtn");
    r = await until(async () => { const x = await live(); return x && x.darts[4] === 0 ? x : null; }) || await live();
    check(r.darts[4] === 0, "Undo on the computer takes the fix back");
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1200);

    // ---- 3 misses, then on to the doubles part -----------------------------------------------------
    await ipad.click("#boardMode [data-man='x3']");
    r = await until(async () => { const x = await live(); return x && x.darts.length === 9 ? x : null; }) || await live();
    check(r.darts.length === 9 && r.darts.slice(6).join("") === "000", "3 misses fills the visit at 12");
    for (let k = 0; k < 9; k += 1) { await computer.keyboard.press("1"); await H.sleep(120); } // 13, 14, 15 typed on the computer
    b = await until(async () => { const x = await bm(); return x.target === "D1" ? x : null; }, 8000) || await bm();
    check(b.target === "D1" && /Pull your darts out/.test(b.label), "after the 15s: pull your darts out, then D1: " + b.label);
    check(b.pad.join(",") === "Hit D1,Miss,3 misses", "its buttons: " + b.pad.join(","));
    await send("D1", 1, "D");
    b = await bm();
    check(/Doubles: D1 · D2 · D3/.test(b.label) && b.target === "D2", "the doubles part: the visit's three doubles, now D2: " + b.label + " / " + b.target);
    await send("S3", 3, "S"); await send("D3", 3, "D");
    r = await until(async () => { const x = await live(); return x && x.darts.length === 21 ? x : null; }) || await live();
    check(r.darts.slice(18).join("") === "101", "D1 hit, D2 missed (in the 3), D3 hit: each dart at its own double (" + r.darts.slice(18).join("") + ")");
    check(await until(async () => (await said(ipad)).some((x) => /^D 1, D 2, D 3: hit, miss, hit\. 100\./.test(x))), "and the voice says the visit: " + (await said(ipad)).slice(-1));

    // ---- a reload keeps Board mode and the round --------------------------------------------------
    await ipad.reload();
    await ipad.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    b = await until(async () => { const x = await bm(); return /D4|D1/.test(x.target) ? x : null; }, 10000) || await bm();
    check(/D1|D4/.test(b.target), "after a reload: Board mode and the round: " + b.target);
    await ipad.click("#boardMode [data-act=exit]");
    check(await ipad.evaluate(() => document.getElementById("boardMode").hidden), "Exit leaves Board mode");
    check(ipad.errors.length === 0 && computer.errors.length === 0, "no page errors: " + ipad.errors.concat(computer.errors).join(" | "));
  } catch (error) {
    check(false, "the test ran to the end: " + (error && error.stack || error));
  } finally {
    if (station) await station.env.clearFirestore().catch(() => {});
    if (station) await station.stop().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    console.log(failed() ? `${failed()} check(s) failed` : "all checks passed");
    process.exit(failed() ? 1 : 0);
  }
})();
