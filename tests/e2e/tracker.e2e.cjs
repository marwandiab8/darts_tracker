// The tracker (index.html) on devices of one account: a computer with the cameras, an iPad, and a
// laptop opened part way through. The bugs that corrupted saved sessions, each checked on the real
// page: the cameras' visits never shift the session (a dart tapped as well as seen, a visit the
// cameras couldn't read), a typed row moves the aim on, taps made at the same moment on two devices
// both go in, the game mode and Pause are shared, a device that taps before the shared session has
// loaded adds to it instead of replacing it, a partial session is saved as partial, Load then Save
// updates that session (no duplicate), every session saves under its own id, an odd timestamp
// doesn't break the chart, and the Camera tick box is remembered.
const H = require("./harness.cjs");
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
    // An old session whose timestamp isn't text (a number), as an import could leave it.
    await station.env.withSecurityRulesDisabled((ctx) => require("firebase/firestore").setDoc(require("firebase/firestore").doc(ctx.firestore(), "sessions", "oddStamp"), { uid, timestamp: Date.UTC(2026, 0, 5, 12), mode: "standard", entry: {}, total: 40 }));
    await ipad.goto(url);
    await H.signIn(ipad);
    const ready = (p) => p.waitForFunction(() => /Connected/.test(document.getElementById("syncText").textContent) && document.getElementById("nextTargetValue").textContent !== "—", null, { timeout: 20000 });
    await Promise.all([ready(computer), ready(ipad)]);

    const live = async () => { const d = await station.read("liveSessions", uid); return d ? JSON.parse(d.state) : null; };
    const aim = (p) => p.$eval("#nextTargetValue", (e) => e.textContent);
    const rowOf = (st, t) => (st.entry[t] || []).join("");
    const tap = async (p, n, ring) => {
      const c = p.locator("#dartboardCanvas");
      await c.scrollIntoViewIfNeeded();
      const box = await c.boundingBox();
      const s = n === "BULL" ? { x: 0, y: 0 } : ring === "O" ? { x: 0, y: -1.3 } : H.spot(n, ring);
      await c.click({ position: { x: box.width / 2 + s.x * box.width / 2, y: box.height / 2 + s.y * box.height / 2 } });
    };
    const until = async (fn, what, ms = 6000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const throwCam = async (n, ring, label) => { const s = n === null ? { x: 0, y: -1.2 } : H.spot(n, ring); await station.send(H.dart(label, s.x, s.y)); await H.sleep(900); };

    check((await computer.evaluate(() => document.querySelectorAll("#historyBody tr").length)) === 1 && computer.errors.length === 0,
      "bug 10: a session with a number for a timestamp shows in the history and the chart doesn't break: " + computer.errors.join(" | "));

    // ---- bug 8: the game mode and Pause are shared --------------------------------------------
    await computer.selectOption("#scoreModeSelect", "single");
    check(await until(async () => (await ipad.$eval("#scoreModeSelect", (e) => e.value)) === "single"), "bug 8: Singles chosen on the computer shows on the iPad");
    await tap(ipad, 20, "S");
    await H.sleep(1200);
    check((await computer.$eval("#scoreModeSelect", (e) => e.value)) === "single", "bug 8: the iPad's next dart doesn't switch the computer back to Standard");
    await computer.selectOption("#scoreModeSelect", "standard");
    await until(async () => (await ipad.$eval("#scoreModeSelect", (e) => e.value)) === "standard");
    const paused = await computer.click("#practiceTimer .pt-btn", { timeout: 5000 }).then(() => true, () => false);
    check(paused, "the computer has the timer the iPad's dart started, with its Pause button");
    check(await until(async () => /Paused/.test(await ipad.$eval("#practiceTimer", (e) => e.textContent))), "bug 8: Pause on the computer shows on the iPad");
    await H.sleep(800);
    check((await live()).timer && (await live()).timer.runningSince == null, "bug 8: the shared session's timer is paused");

    // ---- bug 6: two devices tap at the same moment: both darts go in -------------------------
    await Promise.all([tap(computer, 20, "T"), tap(ipad, 20, "S")]);
    let st = await until(async () => { const v = await live(); return v && v.thrown["20"] === 3 ? v : null; }, "both", 8000) || await live();
    check(st.thrown["20"] === 3 && rowOf(st, "20").replace(/-/g, "").length === 3, "bug 6: both taps made at once went in (20: " + rowOf(st, "20") + ", thrown " + st.thrown["20"] + ")");
    check((await aim(computer)) === "19" && (await aim(ipad)) === "19", "both devices move on to 19");

    // ---- cameras: bug 1, a dart tapped as well as seen ---------------------------------------
    await computer.check("#cameraToggle");
    await computer.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    await throwCam(19, "S", "S19");
    await tap(ipad, 19, "S");            // the same dart, tapped on the iPad too
    await H.sleep(900);
    await throwCam(19, "T", "T19");
    await throwCam(19, "S", "S19");      // the visit's 3rd dart: 19 already has three
    await station.send({ type: "takeout", darts: 3 }); await H.sleep(1200);
    st = await live();
    check(!st.thrown["18"] && (await aim(computer)) === "18", "bug 1: the visit's extra dart isn't put at 18, and no misses are filled there (18 thrown: " + st.thrown["18"] + ")");

    // ---- bug 3: a typed row moves the aim on --------------------------------------------------
    const input18 = computer.locator('#entryBody tr[data-target="18"] input');
    await input18.fill("SS");
    await H.sleep(900);
    check((await aim(computer)) === "17", "bug 3: typing 18's row moves the aim to 17: " + (await aim(computer)));
    await throwCam(17, "S", "S17");
    st = await live();
    check(rowOf(st, "17") === "S--" && rowOf(st, "18") === "SS-", "bug 3: the next camera dart goes to 17, not 18 (17: " + rowOf(st, "17") + ", 18: " + rowOf(st, "18") + ")");
    await station.send({ type: "takeout", darts: 1 }); await H.sleep(1200);
    check((await aim(computer)) === "16", "the pull-out after one dart at 17 fills its two misses there");

    // ---- bug 2: a visit the cameras couldn't read --------------------------------------------
    for (let k = 0; k < 3; k += 1) { await station.send({ type: "unreadable" }); await H.sleep(500); }
    await H.sleep(600);
    check((await aim(computer)) === "16", "three unreadable darts wait at 16 for taps");
    await throwCam(15, "S", "S15");   // the next visit, at 15
    st = await live();
    check(st.thrown["16"] === 3 && rowOf(st, "15") === "S--", "bug 2: 16's three unread darts are misses and the next visit counts at 15 (15: " + rowOf(st, "15") + ")");
    await station.send({ type: "takeout", darts: 1 }); await H.sleep(1200);

    // ---- bug 7: a device that taps before the shared session loads adds to it ---------------
    const before = await live();
    const laptop = await H.device(browser, "laptop", { viewport: { width: 1280, height: 900 } });
    laptop.on("dialog", (d) => d.accept());
    // Its reads of the shared session are held up for a few seconds; it taps meanwhile.
    let hold = true;
    await laptop.context().route(/Listen\/channel/, async (r) => { if (hold) await H.sleep(4000); r.continue().catch(() => {}); });
    await laptop.goto(url);
    await H.signIn(laptop);
    await laptop.waitForSelector("#dartboardCanvas", { state: "visible", timeout: 15000 });
    await H.sleep(600);
    const early = await laptop.$eval("#syncText", (e) => e.textContent);
    await tap(laptop, 14, "S");
    hold = false;
    await H.sleep(5500);
    st = await live();
    check(!/Connected/.test(early), "the laptop tapped before the shared session reached it (" + early + ")");
    check(rowOf(st, "14") === "S--", "bug 7: the laptop's early tap counts at 14, on top of the session (14: " + rowOf(st, "14") + ", 20: " + rowOf(st, "20") + ")");
    const kept = ["20", "19", "18", "17", "16", "15"].every((t) => st.thrown[t] === 3 || (before.thrown[t] || 0) <= (st.thrown[t] || 0));
    check(kept && rowOf(st, "19") === rowOf(before, "19") && rowOf(st, "15") === rowOf(before, "15"), "bug 7: the laptop's early tap didn't replace the session in progress (19: " + rowOf(st, "19") + ", 15: " + rowOf(st, "15") + ")");
    await laptop.context().close();

    // ---- bug 9: a partial session is saved as partial, under the session's own id -----------
    const sid = (await live()).sid;
    await computer.click("#saveBtn");
    const panel = await computer.waitForSelector("#savePanel:not([hidden])", { timeout: 4000 }).then(() => true, () => false);
    check(panel, "bug 9: Save on a session part way through asks how to save it, on the page");
    if (panel) await computer.click("#savePanel [data-save=partial]");
    const saved = await until(async () => (await station.list("sessions")).filter((s) => s.id !== "oddStamp"), "saved", 8000);
    check(saved && saved.length === 1 && saved[0].complete === false, "bug 9: saved with complete: false: " + JSON.stringify(saved && saved.map((s) => s.complete)));
    check(saved && saved[0].id === sid, "bug 5: saved as sessions/{the session's id} (" + (saved && saved[0].id) + " vs " + sid + ")");
    const kpi = await computer.$eval("#kpiBest", (e) => e.textContent);
    check(kpi === "40", "the partial session isn't a personal best: PB shows " + kpi);
    check(await until(async () => (await live()).sid !== sid || !(await live()).sid), "a new session starts after the save, with a new id");

    // ---- bug 4: Load then Save updates that session ------------------------------------------
    const savedId = saved[0].id, stamp = saved[0].timestamp;
    await computer.click(`#historyBody button[data-act=load][data-id="${savedId}"]`);
    await H.sleep(1200);
    check((await computer.$eval("#sessionDate", (e) => e.value)) === stamp.slice(0, 10), "bug 4: Load shows the session's own date");
    await computer.locator('#entryBody tr[data-target="5"] input').fill("T");
    await H.sleep(500);
    await computer.click("#saveBtn");
    const fixed = await until(async () => { const all = (await station.list("sessions")).filter((s) => s.id !== "oddStamp"); return all.length === 1 && all[0].total !== saved[0].total ? all : null; }, "updated", 8000);
    const all = (await station.list("sessions")).filter((s) => s.id !== "oddStamp");
    check(all.length === 1, "bug 4: Load then Save makes no second session (" + all.length + ")");
    check(fixed && fixed[0].id === savedId && fixed[0].timestamp === stamp, "bug 4: it updates the loaded session and keeps its date (" + (fixed && fixed[0].timestamp) + ")");

    // ---- bug 12: the Camera tick box is remembered on reload --------------------------------
    await computer.reload();
    await ready(computer);
    check(await computer.$eval("#cameraToggle", (e) => e.checked), "bug 12: the Camera tick box is still ticked after a reload");

    const errs = [computer, ipad].flatMap((p) => p.errors);
    check(errs.length === 0, "no page errors: " + errs.join(" | "));
  } catch (error) {
    check(false, "the test ran to the end: " + (error && error.stack || error));
  } finally {
    if (station) await station.stop().catch(() => {});
    await browser.close().catch(() => {});
    server.kill();
    console.log(failed() ? `${failed()} check(s) failed` : "all checks passed");
    process.exit(failed() ? 1 : 0);
  }
})();
