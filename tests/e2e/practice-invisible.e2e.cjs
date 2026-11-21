// The Invisible Man in the bot game (practice.html): no bot, a leg of 501 against a dart limit. On a
// computer (the setup, the score keypad) and an iPad in Board mode with the cameras, one account: the
// setup hides the bot's level and who throws first; a leg runs out of darts and is lost (his side shows
// the darts left); a leg checked out within the limit is won, the pull-out finishing it; "You require"
// comes after your own visit; the match is first to 2; each leg is saved with its limit and no bot
// level; the report has your column only; the history says "Invisible Man (24)"; "Moves with you"
// starts at 27 (fixed legs don't move it).
const H = require("./harness.cjs");
const E = require("../../public/practice-engine.js");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const settings = JSON.stringify({ kind: "x01", startScore: 501, doubleOut: true, rank: "club", first: "player", entry: "keypad", confirm: false, camera: false, mute: false, opponent: "bot" });
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 }, storage: { dt_practice_settings: settings } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_practice_settings: settings.replace('"keypad"', '"board"'), dt_practiceBoard: "1" } });
    for (const p of [computer, ipad]) p.on("dialog", (d) => d.accept());
    const url = `http://127.0.0.1:${H.PORT}/practice.html`;
    await Promise.all([computer.goto(url), ipad.goto(url)]);
    const uid = await H.signIn(computer);
    await H.signIn(ipad);
    station = await H.makeStation(uid);
    await station.clear();
    await H.sleep(800);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const at = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));
    const camDart = async (label, wait = 1000) => { const p = at(label); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    const takeout = async (wait = 1500) => { await station.send({ type: "takeout", darts: 3 }); await H.sleep(wait); };
    const fetched = [];
    ipad.on("request", (r) => { const m = r.url().match(/audio\/calls\/(require-\d+)\.wav/); if (m) fetched.push(m[1]); });
    const saved = async () => (await station.list("botGames")).filter((g) => g.uid === uid).sort((a, b) => (a.leg || 0) - (b.leg || 0));
    const shown = (p, id) => p.$eval("#" + id, (e) => !e.classList.contains("hidden") && !e.hidden);
    const bm = () => ipad.evaluate(() => {
      const b = document.getElementById("boardMode");
      const q = (sel) => b.querySelector(sel);
      return {
        label: q("[data-ref=label]").textContent, target: q(".bm-target").textContent, count: q("[data-ref=count]").textContent.replace(/\s+/g, " ").trim(),
        opp: [...q("[data-ref=opp]").children].map((c) => c.textContent).join(" ").trim(), info: q("[data-ref=info]").textContent.replace(/\s+/g, " ").trim(),
        mode: q("[data-ref=mode]").textContent,
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=moment]").textContent.replace(/\s+/g, " ").trim(),
        done: q("[data-ref=done]").hidden ? "" : q("[data-ref=done]").textContent.replace(/\s+/g, " ").trim(),
        pad: [...b.querySelectorAll("[data-man]")].filter((x) => !x.hidden).map((x) => x.textContent),
      };
    });

    // ---- the setup ---------------------------------------------------------------------------------
    await computer.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await computer.click("label:has(input[name=opp][value=limit])");
    await H.sleep(300);
    check(await shown(computer, "limitBox") && !(await shown(computer, "rankBox")) && !(await shown(computer, "firstBox")) && !(await shown(computer, "styleBox")) && !(await shown(computer, "startScoreBox")),
      "Invisible Man: the limit shows; the bot's level, its style, who throws first and the start score don't");
    check(await computer.$eval("#dartLimit", (e) => e.value) === "auto", "the limit moves with you by default");
    const blurb = await computer.$eval("#limitBlurb", (e) => e.textContent);
    check(/Your next leg: 27 darts/.test(blurb), "moving, it starts at 27: " + blurb);
    check(await computer.$eval("input[name=kind][value=cricket]", (e) => e.disabled), "Cricket can't be chosen against the Invisible Man");
    await computer.selectOption("#dartLimit", "24");
    await computer.selectOption("#seriesTarget", "2");
    await H.sleep(300);
    check(/check out within 24 darts/.test(await computer.$eval("#limitBlurb", (e) => e.textContent)), "a fixed limit says so");
    await computer.click("#startBtn");
    await H.sleep(2000);
    let b = await until(async () => { const x = await bm(); return /Invisible/.test(x.opp) ? x : null; }, 10000) || await bm();
    check(b.target === "501" && /Your throw/i.test(b.label) && /Invisible Man\s*24\s*darts left of 24/.test(b.opp), `Board mode: ${b.label} ${b.target}; ${b.opp}`);
    check(/Invisible Man · 24 darts/.test(b.mode), "the mode line: " + b.mode);
    check(/You\s*0\s*–\s*0\s*Invisible/.test(b.count), "the legs score: " + b.count);
    check(/24 of 24 darts left/.test(await computer.$eval("#status", (e) => e.textContent)), "the status line counts the darts left");

    // ---- leg 1: out of darts (the keypad on the computer) ---------------------------------------------
    for (let i = 0; i < 7; i += 1) { await computer.click("[aria-label='Score 60']"); await computer.click("#kpEnter"); await H.sleep(350); }
    let st = await station.read("liveGames", uid);
    let g = JSON.parse(st.state).game;
    check(g.turn === "player" && g.darts.player.length === 21 && g.remaining.player === 81 && g.limit === 24, `7 visits of 60: still your turn, 21 darts, 81 left (${g.darts.player.length}, ${g.remaining.player})`);
    b = await bm();
    check(/3\s*darts left of 24/.test(b.opp), "his side: 3 darts left: " + b.opp);
    await computer.click("[aria-label='Score 60']"); await computer.click("#kpEnter"); await H.sleep(1200);
    const status = await computer.$eval("#keypad", (e) => e.textContent);
    check(/Out of darts: the Invisible Man wins the leg/.test(status), "the 24th dart without a checkout: out of darts");
    b = await bm();
    check(b.label === "Out of darts" && /Out of darts/.test(b.count) && b.pad.includes("Finish game"), `Board mode: ${b.label}, ${b.count}, ${b.pad.join(",")}`);
    await computer.click("#kpConfirm button:not(.secondary)");
    await H.sleep(2500);
    let docs = await saved();
    check(docs.length === 1 && docs[0].result === "lost" && docs[0].dartLimit === 24 && docs[0].rank === undefined && docs[0].botDarts.length === 0 && docs[0].leg === 1 && docs[0].legsToWin === 2 && !docs[0].limitAuto,
      "leg 1 saved: lost, its limit, no bot level or darts, leg 1 of a first-to-2: " + JSON.stringify(docs[0] && { r: docs[0].result, l: docs[0].dartLimit, rank: docs[0].rank, leg: docs[0].leg }));
    check(/The Invisible Man won/.test(await computer.$eval("#overTitle", (e) => e.textContent)), "the game-over title");
    const report = await computer.$eval("#overReport", (e) => e.textContent);
    check(/Darts\s*24 of 24/.test(report) && !/Invisible Man/.test(await computer.$eval("#overReport table", (e) => e.rows[0].textContent)), "the report: your column only, darts 24 of 24");

    // ---- leg 2: a nine-darter with the cameras (the iPad), "You require" after your own visit ------------
    await until(async () => { const x = await station.read("liveGames", uid); return x && JSON.parse(x.state).game && JSON.parse(x.state).game.visits.length === 0 && x.phase === "play"; }, 12000);
    await H.sleep(1500);
    await ipad.click("#boardMode [data-act=camera]");
    await until(async () => /watching the board/i.test(await ipad.$eval("#camStatus", (e) => e.textContent)), 15000);
    await camDart("T20"); await camDart("T20"); await camDart("T20", 1500);
    await takeout(2500);
    await camDart("T20"); await camDart("T20"); await camDart("T20", 1500);
    await takeout(2500);
    b = await bm();
    check(b.target === "141" && /18\s*darts left of 24/.test(b.opp), `two visits of 180: 141 left, 18 darts left: ${b.target}; ${b.opp}`);
    check(fetched.includes("require-141"), "You require 141, after your own visit: " + fetched.join(","));
    await camDart("T20"); await camDart("T19"); await camDart("D12", 1500);
    b = await bm();
    check(/Game shot/.test(b.count) && /Checked out in 9/.test(b.label), `the winning double: ${b.label}, ${b.count}`);
    await takeout(500);
    b = await until(async () => { const x = await bm(); return x.moment ? x : null; }, 3000) || await bm();
    check(/141\s*Ton-plus finish! In 9 darts/.test(b.moment), "the pull-out closes the visit, with its moment: " + b.moment);
    await H.sleep(3000);
    docs = await saved();
    check(docs.length === 2 && docs[1].result === "won" && docs[1].playerDarts.length === 9 && docs[1].leg === 2 && docs[1].matchId === docs[0].matchId, "the pull-out finishes leg 2: won in 9 darts, same match");
    b = await bm();
    check(/You\s*1\s*–\s*1\s*Invisible/.test(await ipad.$eval("#boardMode", (e) => e.textContent)) || /1 - 1/.test(await computer.$eval("#overSeries", (e) => e.textContent)), "the match: 1-1");

    // ---- leg 3 decides the match ---------------------------------------------------------------------
    await until(async () => { const x = await station.read("liveGames", uid); return x && x.phase === "play" && JSON.parse(x.state).game.visits.length === 0; }, 12000);
    await H.sleep(1500);
    await camDart("T20"); await camDart("T20"); await camDart("T20", 1500); await takeout(2500);
    await camDart("T20"); await camDart("T20"); await camDart("T20", 1500); await takeout(2500);
    await camDart("T20"); await camDart("T19"); await camDart("D12", 2500);
    await takeout(3500);
    docs = await saved();
    check(docs.length === 3 && docs[2].result === "won", "leg 3 won and saved");
    check(/You beat the Invisible Man!/.test(await computer.$eval("#overTitle", (e) => e.textContent)) && /won the match 2-1/.test(await computer.$eval("#overSeries", (e) => e.textContent)), "the match is won 2-1");
    const hist = await computer.$$eval("#historyBody tr", (rows) => rows.map((r) => r.textContent));
    check(hist.length === 3 && hist.every((t) => /Invisible Man \(24\)/.test(t)), "the history: " + hist[0]);

    // ---- moves with you: fixed legs don't move it ---------------------------------------------------------
    await computer.click("#changeBtn");
    await H.sleep(800);
    await computer.selectOption("#dartLimit", "auto");
    await H.sleep(300);
    const after = await computer.$eval("#limitBlurb", (e) => e.textContent);
    check(/Your next leg: 27 darts/.test(after) && /won 2 of 3 legs; fewest darts 9/.test(after), "moving still starts at 27; the record counts every leg: " + after);

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
