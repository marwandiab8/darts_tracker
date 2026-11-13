// The JDC Challenge (challenge.html): the bugs that lost or corrupted rounds, each on the real page.
// The 57th dart can be undone before the round is saved; a round finished offline is kept and saved
// once when the connection is back, and a second one doesn't replace the first; pace compares whole
// visits; rounds saved elsewhere show up without a reload; a finished round left on the device is
// offered for saving; and two tabs with the round open stay in step.
const H = require("./harness.cjs");
const C = require("../../public/challenge-engine.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const url = `http://127.0.0.1:${H.PORT}/challenge.html`;
    const page = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 } });
    page.on("dialog", (d) => d.accept());
    await page.goto(url);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(200); } return v; };
    const rounds = async () => (await station.list("challengeGames")).filter((g) => g.uid === uid);
    const text = (sel) => page.$eval(sel, (e) => e.textContent);
    const press = async (keys) => { for (const k of keys) await page.keyboard.press(k); };
    // A whole round: every Shanghai dart a single, every double missed (6 x 3 + 21 + 6 x 3 = 57 keys).
    const allSingles = () => C.STEPS.flatMap((st) => Array(st.darts).fill(st.kind === "double" ? "0" : "1"));

    // A best round to pace against: all singles, and a saved round from another device later on.
    const best = C.record(uid, allSingles().map(Number), { timestamp: "2026-11-01 18:00", durationSec: 300 });
    await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "challengeGames", "bestOne"), best));
    await until(async () => /1/.test(await text("#progressStats").catch(() => "")), 10000);

    // ---- bug 3: pace at visit boundaries -------------------------------------------------------
    await page.click("#startBtn");
    await press(["1", "1", "1"]);            // 10: 30, level with the best
    check(/level with your best/.test(await text("#pace")), "after 10, level with the best: " + await text("#pace"));
    await press(["3"]);                      // 11: a treble, mid-visit
    check(/level with your best/.test(await text("#pace")), "bug 3: mid-visit, the treble doesn't count against the best's total from before 11: " + await text("#pace"));
    await press(["3", "3"]);                 // 11: 99
    check(/\+66 vs your best/.test(await text("#pace")), "after 11: +66 (99 against 33): " + await text("#pace"));

    // ---- bug 4: a round saved on another device shows without a reload --------------------------
    const elsewhere = C.record(uid, allSingles().map(Number), { timestamp: "2026-11-02 18:00", durationSec: 300 });
    await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "challengeGames", "elsewhere"), elsewhere));
    check(await until(async () => (await page.$$eval("#history tr", (r) => r.length)) === 2, 6000), "bug 4: the round saved elsewhere is in the list without a reload");

    // ---- bug 5 (tabs): the same round in a second tab stays in step ------------------------------
    const tab2 = await page.context().newPage();
    tab2.errors = []; tab2.on("pageerror", (e) => tab2.errors.push(String(e)));
    await tab2.goto(url);
    await tab2.waitForSelector("#resumeBtn:not(.hidden)", { timeout: 10000 });
    await tab2.click("#resumeBtn");
    await press(["2"]);                      // a dart in the first tab
    check(await until(async () => /Dart 2 of 3/.test(await tab2.$eval("#dartLabel", (e) => e.textContent))), "two tabs: a dart in one shows in the other");
    await tab2.close();

    // ---- bug 1: the 57th dart can be undone before the round is saved -------------------------
    const rest = allSingles().slice(7);       // 7 darts are in already
    await press(rest);
    await H.sleep(500);
    check(!(await page.$eval("#donePanel", (e) => e.hidden)) && (await rounds()).length === 2, "bug 1: with all 57 in, the round waits to be saved (nothing saved yet)");
    check(!(await page.$eval("#undoBtn", (e) => e.disabled)), "bug 1: Undo works on the 57th dart");
    await press(["Backspace"]);
    check(/Dart 3 of 3/.test(await text("#dartLabel")) && (await page.$eval("#donePanel", (e) => e.hidden)), "bug 1: Undo takes the 57th dart back: " + await text("#dartLabel"));
    await press(["3"]);                       // the last dart was really a treble
    await page.click("#saveNowBtn");
    let saved = await until(async () => { const r = await rounds(); return r.length === 3 ? r : null; }, 8000);
    const mine = saved && saved.find((g) => g.id !== "bestOne" && g.id !== "elsewhere");
    check(mine && mine.darts[56] === 3 && /^jdc/.test(mine.id), "bug 1: saved with the corrected last dart, under the round's own id (" + (mine && mine.id) + ")");

    // ---- bug 2: two rounds finished offline are both kept, and each saved once -----------------
    await page.click("#againBtn");
    await page.context().setOffline(true);
    await press(allSingles());
    await page.click("#saveNowBtn");
    await H.sleep(500);
    await page.click("#againBtn");
    await press(allSingles().map((k, i) => (i === 0 ? "3" : k)));
    await page.click("#saveNowBtn");
    await H.sleep(500);
    const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("dt_challenge_unsaved") || "[]"));
    check(Array.isArray(kept) && kept.length === 2, "bug 2: both rounds finished offline are kept on the device (" + (Array.isArray(kept) ? kept.length : "one record") + ")");
    await page.context().setOffline(false);
    saved = await until(async () => { const r = await rounds(); return r.length === 5 ? r : null; }, 25000);
    check(!!saved, "bug 2: back online, both are saved (" + (await rounds()).length + " rounds)");
    await H.sleep(3000);
    check((await rounds()).length === 5, "bug 2: and only once each");
    check(await until(async () => !(await page.evaluate(() => localStorage.getItem("dt_challenge_unsaved"))), 8000), "bug 2: nothing is left waiting on the device");

    // ---- bug 5: a finished round left on the device is offered and saved ------------------------
    const left = { id: "jdcLeftBehind1", darts: allSingles().map(Number), startedAt: Date.now() - 400000, timer: { startedAt: Date.now() - 400000, activeMs: 300000, runningSince: null, lastActivityAt: Date.now() - 100000, pausedBy: "you", pausedAt: Date.now() - 100000 } };
    await page.evaluate((r) => localStorage.setItem("dt_challenge_round", JSON.stringify(r)), left);
    await page.reload();
    await page.waitForSelector("#resumeBtn:not(.hidden)", { timeout: 10000 });
    check(/Save the finished round/.test(await text("#resumeBtn")), "bug 5: a finished round left on the device is offered: " + await text("#resumeBtn"));
    await page.click("#resumeBtn");
    check(await until(async () => (await rounds()).some((g) => g.id === "jdcLeftBehind1"), 8000), "bug 5: it is saved");

    // (The browser's own "disconnected" lines from the offline part are expected.)
    const errs = page.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e));
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
