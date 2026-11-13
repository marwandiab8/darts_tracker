// The tracker's Board mode (index.html + board-mode.js): the scoreboard read from the oche, on an
// iPad with the cameras, and a computer following the same session. Each dart's box says what it
// counted as; a dart the cameras couldn't read waits for a tap on the board; tapping a dart fixes it
// (the number is scored again); Undo on the other device takes the fix back; the big buttons enter
// darts (the bull's say Outer bull / Bullseye); the voice says each dart and each finished number on
// the device with Voice on only; pace against the saved sessions; the recap at the end; Save keeps
// every dart (throws) and when the session started; a reload keeps Board mode, the cameras and the
// voice; the screen is kept on.
const H = require("./harness.cjs");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const url = `http://127.0.0.1:${H.PORT}/index.html`;
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 } });
    for (const p of [computer, ipad]) p.on("dialog", (d) => d.accept());
    await computer.goto(url);
    const uid = await H.signIn(computer);
    station = await H.makeStation(uid);
    // Three saved sessions to pace against: 20 scored 2, 3 and 4 in them; the best is 70.
    const row = (r) => r.split("");
    const saved = [["S--", 50, "2026-11-01 18:00"], ["SD-", 60, "2026-11-02 18:00"], ["TS-", 70, "2026-11-03 18:00"]];
    for (const [r, total, ts] of saved) {
      await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "sessions", "h" + total), { uid, timestamp: ts, mode: "standard", entry: { "20": row(r) }, total, complete: true }));
    }
    await ipad.goto(url);
    await H.signIn(ipad);
    const ready = (p) => p.waitForFunction(() => /Connected/.test(document.getElementById("syncText").textContent) && document.getElementById("nextTargetValue").textContent !== "—", null, { timeout: 20000 });
    await Promise.all([ready(computer), ready(ipad)]);
    const until = async (fn, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const live = async () => { const d = await station.read("liveSessions", uid); return d ? JSON.parse(d.state) : null; };
    const bm = (p) => p.evaluate(() => {
      const b = document.getElementById("boardMode");
      const q = (sel) => b.querySelector(sel);
      return {
        shown: !b.hidden,
        label: q("[data-ref=label]").textContent,
        target: q(".bm-target").textContent,
        count: q("[data-ref=count]").textContent,
        info: q("[data-ref=info]").textContent,
        slots: [...b.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        dots: b.querySelectorAll(".bm-dart").length,
        undo: q("[data-act=undo]").textContent,
        cells: [...b.querySelectorAll(".bm-cell")].map((c) => c.className.replace("bm-cell ", "") + ":" + c.textContent),
        pad: [...b.querySelectorAll("[data-man]")].map((x) => x.textContent + (x.disabled ? "(off)" : "")),
        done: !q("[data-ref=done]").hidden ? q("[data-ref=done]").textContent.replace(/\s+/g, " ").trim() : "",
        note: (q(".bm-note") || { textContent: "" }).textContent,
      };
    });
    const said = (p) => p.evaluate(() => window.__said.slice());
    const send = async (label, n, ring) => { const s = n == null ? { x: 0, y: -1.2 } : H.spot(n, ring); await station.send(H.dart(label, s.x, s.y)); await H.sleep(1000); };
    const tapSvg = async (n, ring) => {
      const svg = ipad.locator("#boardMode .bm-board svg");
      const box = await svg.boundingBox();
      const size = Math.min(box.width, box.height), s = H.spot(n, ring);
      await svg.click({ position: { x: box.width / 2 + (s.x / 2.5) * size, y: box.height / 2 + (s.y / 2.5) * size } });
    };

    // ---- Board mode on, the voice comes on with it ----------------------------------------------
    await ipad.click("#boardBtn");
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 5000 });
    let b = await bm(ipad);
    check(b.target === "20" && /Dart 1 of 3/.test(b.count), "Board mode: 20, dart 1 of 3: " + b.target + " " + b.count);
    check(/best 70/.test(b.info) && /average 60\.0/.test(b.info), "before a number is done it shows your best and average: " + b.info);
    check(await ipad.evaluate(() => localStorage.getItem("dt_tapVoice") === "1" && document.querySelector("#boardMode [data-act=voice]").getAttribute("aria-pressed") === "true"), "turning Board mode on turns the voice on");
    check(b.cells.length === 21 && b.cells[0] === "current:20", "the strip has the 21 numbers, 20 current: " + b.cells[0]);
    await ipad.click("#boardMode [data-act=camera]");
    check(await until(async () => /watching the board/i.test(await ipad.$eval("#camNote", (e) => e.textContent)), 15000), "the Cameras button turns the iPad's cameras on");

    // ---- camera darts: what each counted as -------------------------------------------------
    await send("T20", 20, "T");
    b = await bm(ipad);
    check(b.slots[0] === "T20|Treble: 3 marks" && b.dots === 1, "dart 1 shows in its box and on the board: " + b.slots[0]);
    check(/Throw/.test(b.slots[1]), "the next box waits for the dart: " + b.slots[1]);
    await send("S1", 1, "S");
    b = await bm(ipad);
    check(b.slots[1] === "S1|Next door, in the 1", "a dart in the 1 is a miss next door: " + b.slots[1]);
    check((await said(ipad)).join(" / ") === "Treble. / Miss.", "the iPad says each dart: " + JSON.stringify(await said(ipad)));
    check((await said(computer)).length === 0, "the computer (Voice off) says nothing");
    await station.send({ type: "unreadable" }); await H.sleep(1000);
    b = await bm(ipad);
    check(b.slots[2] === "Not read|Tap the board where it landed", "a dart they couldn't read waits for a tap: " + b.slots[2]);
    await tapSvg(20, "S");
    b = await until(async () => { const x = await bm(ipad); return /S20/.test(x.slots[2]) ? x : null; }) || await bm(ipad);
    check(b.slots[2] === "S20|Single: 1 mark", "tapped on the board, it fills the box: " + b.slots[2]);
    check(b.target === "19" && /Pull your darts out/.test(b.label), "20 is done: pull your darts out, then 19 (" + b.label + " " + b.target + ")");
    check(await until(async () => (await said(ipad)).includes("20: treble, miss, single. 4 in all. Next, 19.")), "the iPad says the visit and the total: " + JSON.stringify(await said(ipad)));
    check(/After 20: 4/.test(b.info) && /avg 2\.7/.test(b.info) && /PB pace 4/.test(b.info), "pace after 20 against the saved sessions (1, 3, 4; the best had 4): " + b.info);

    // ---- fixing a dart by tapping it --------------------------------------------------------
    await ipad.click("#boardMode .bm-slot[data-i='1']");
    await ipad.waitForSelector("#boardMode [data-ref=sheet]:not([hidden])", { timeout: 5000 });
    const options = await ipad.$$eval("#boardMode [data-fix]", (els) => els.map((e) => e.textContent));
    check(options.join(" / ") === "Treble 20 / Double 20 / Single 20 / A miss: not in the 20 (what it is now) / Not a dart: remove it", "the fix sheet: " + options.join(" / "));
    await ipad.click("#boardMode [data-fix='D']");
    b = await until(async () => { const x = await bm(ipad); return /D20/.test(x.slots[1]) ? x : null; }) || await bm(ipad);
    check(b.slots[1] === "D20|Double: 2 marks · fixed", "fixed: dart 2 was a double 20: " + b.slots[1]);
    let st = await until(async () => { const v = await live(); return v && v.entry["20"].join("") === "TDS" ? v : null; }, 6000) || await live();
    check(st.entry["20"].join("") === "TDS", "the number is scored again from its darts (20: " + st.entry["20"].join("") + ")");
    check(await until(async () => (await computer.$eval("#sessionTotal", (e) => e.textContent)) === "6"), "the computer's total follows the fix: 6");
    check((await said(ipad)).includes("Fixed: double."), "the iPad says the fix");

    // ---- the pull-out, then Undo from the other device --------------------------------------
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1200);
    b = await bm(ipad);
    check(b.target === "19" && b.label === "Throwing at" && b.slots.every((x) => /^–|^Throw/.test(x)), "pulled out: 19, with empty boxes: " + b.slots.join(" / "));
    await computer.click("#undoTapBtn");
    check(await until(async () => (await live()).entry["20"].join("") === "TS-"), "Undo on the computer takes the fix back");
    check(await until(async () => (await computer.$eval("#sessionTotal", (e) => e.textContent)) === "4"), "back to 4 on the computer");

    // ---- the big buttons --------------------------------------------------------------------
    await ipad.click("#boardMode [data-act=camera]"); // cameras off: the buttons from here
    await H.sleep(400);
    for (const m of ["T", "-", "S"]) { await ipad.click(`#boardMode [data-man='${m}']`); await H.sleep(250); }
    st = await until(async () => { const v = await live(); return v && v.thrown["19"] === 3 ? v : null; }) || await live();
    check(st.entry["19"].join("") === "TS-", "Treble, Miss, Single go in at 19: " + st.entry["19"].join(""));
    b = await bm(ipad);
    check(b.slots.join(" / ") === "T19|Treble: 3 marks / Miss|Entered by hand / S19|Single: 1 mark", "their boxes: " + b.slots.join(" / "));
    // The rest typed in on the computer, down to the bull.
    for (let n = 18; n >= 1; n -= 1) await computer.fill(`#entryBody tr[data-target="${n}"] input`, "S");
    await until(async () => (await bm(ipad)).target === "BULL", 8000);
    b = await bm(ipad);
    check(b.target === "BULL" && b.pad.join(",") === "Outer bull,Bullseye,Treble(off),Miss", "at the bull the buttons are Outer bull and Bullseye: " + b.pad.join(","));
    for (const m of ["D", "-", "S"]) { await ipad.click(`#boardMode [data-man='${m}']`); await H.sleep(300); }

    // ---- the recap, and Save ----------------------------------------------------------------
    b = await until(async () => { const x = await bm(ipad); return x.done ? x : null; }) || await bm(ipad);
    check(/^29/.test(b.done) && /Practise next/.test(b.done) && /Save the session/.test(b.done), "the recap: 29, what to practise, Save: " + b.done.slice(0, 160));
    check(await until(async () => (await said(ipad)).some((x) => /^Bull: bullseye, miss, outer bull\. That's all 21: 29\.$/.test(x))), "the iPad says the end: " + (await said(ipad)).slice(-1));
    const wakeBefore = await ipad.evaluate(() => window.__wake);
    await ipad.click("#boardMode [data-act=save]");
    const rec = await until(async () => (await station.list("sessions")).find((s) => s.uid === uid && !/^h\d/.test(s.id)), 10000);
    check(rec && rec.total === 29 && rec.complete === true, "saved: 29, complete");
    check(rec && Array.isArray(rec.throws) && rec.throws.length === 63, "saved with every dart: " + (rec && rec.throws && rec.throws.length));
    check(rec && rec.throws[1].l === "S1" && rec.throws[1].r === "-" && Number.isFinite(rec.throws[1].x) && rec.throws[0].src === "cam", "a camera miss is saved with where it landed: " + JSON.stringify(rec && rec.throws[1]));
    check(rec && rec.throws[3].src === "btn" && rec.throws[6].src === "typed", "button and typed darts say so");
    check(rec && rec.startedAtMs > 0, "saved with when it started");
    b = await until(async () => { const x = await bm(ipad); return x.target === "20" && x.note ? x : null; }) || await bm(ipad);
    check(b.target === "20" && /Saved: 29/.test(b.note), "after Save, a new session at 20, and the note says it saved: " + b.note);
    check(wakeBefore > 0, "Board mode keeps the iPad's screen on");

    // ---- a reload keeps Board mode, the cameras and the voice -------------------------------
    await ipad.click("#boardMode [data-act=camera]");
    await H.sleep(500);
    await ipad.reload();
    await ipad.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    check(await ipad.evaluate(() => document.querySelector("#boardMode [data-act=camera]").getAttribute("aria-pressed") === "true" && document.querySelector("#boardMode [data-act=voice]").getAttribute("aria-pressed") === "true"), "after a reload: Board mode, the cameras and the voice are on");
    await until(async () => /watching the board/i.test(await ipad.$eval("#camNote", (e) => e.textContent)), 15000);
    await send("S20", 20, "S");
    check(await until(async () => (await said(ipad)).join("|") === "Single."), "the reloaded iPad says the new dart, and nothing from before: " + JSON.stringify(await said(ipad)));
    await ipad.click("#boardMode [data-act=exit]");
    check(await ipad.evaluate(() => document.getElementById("boardMode").hidden), "Exit leaves Board mode");

    check(ipad.errors.length === 0 && computer.errors.length === 0, "no page errors: " + ipad.errors.concat(computer.errors).join(" | "));
  } catch (error) {
    check(false, "the test ran to the end: " + (error && error.stack || error));
  } finally {
    // The next test file runs in the same emulators, as the same account: leave nothing behind.
    if (station) await station.env.clearFirestore().catch(() => {});
    if (station) await station.stop().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    console.log(failed() ? `${failed()} check(s) failed` : "all checks passed");
    process.exit(failed() ? 1 : 0);
  }
})();
