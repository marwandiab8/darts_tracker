// The bot game's Board mode (practice.html + board-mode.js): the scoreboard read from the oche, on an
// iPad with the cameras. Each dart's box says what it scored; tapping a dart fixes it (the visit is
// thrown again); the bot's visit stays on the board until your first dart; Undo goes back across
// visits (the bot's visit comes off); a 180 fills the screen; "You require 81" is said; pulling your
// darts out after the winning double finishes the game (no tap); the game is saved with its visits;
// the match report shows; a reload keeps Board mode.
const H = require("./harness.cjs");
const E = require("../../public/practice-engine.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const settings = JSON.stringify({ kind: "x01", startScore: 201, doubleOut: true, rank: "club", first: "player", entry: "board", confirm: false, camera: true, mute: false, opponent: "bot" });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_practice_settings: settings, dt_practiceBoard: "1" } });
    ipad.on("dialog", (d) => d.accept());
    await ipad.goto(`http://127.0.0.1:${H.PORT}/practice.html`);
    const uid = await H.signIn(ipad);
    station = await H.makeStation(uid);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const liveGame = async () => { const d = await station.read("liveGames", uid); return d ? JSON.parse(d.state) : null; };
    const at = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));
    const camDart = async (label) => { const p = at(label); await station.send(H.dart(label, p.x, p.y)); await H.sleep(900); };
    const said = () => ipad.evaluate(() => window.__said.slice());
    const bm = () => ipad.evaluate(() => {
      const b = document.getElementById("boardMode");
      const q = (sel) => b.querySelector(sel);
      return {
        shown: !b.hidden, label: q("[data-ref=label]").textContent, target: q(".bm-target").textContent,
        count: q("[data-ref=count]").textContent, info: q("[data-ref=info]").textContent, opp: q("[data-ref=opp]").textContent,
        next: q("[data-ref=next]").textContent,
        slots: [...b.querySelectorAll(".bm-slot")].map((s) => s.querySelector(".r").textContent + "|" + s.querySelector(".s").textContent),
        cells: [...b.querySelectorAll(".bm-cell")].map((c) => c.textContent),
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=moment]").textContent,
        done: q("[data-ref=done]").hidden ? "" : q("[data-ref=done]").textContent.replace(/\s+/g, " ").trim(),
        undo: q("[data-act=undo]").disabled ? "off" : "on",
      };
    });
    let n = 0;
    const inject = async (game) => {
      const gameId = "e2eboard" + (n += 1) + Date.now().toString(36);
      const state = { v: 1, gameId, game, editing: null, startedAt: Date.now() - 60000, settings: JSON.parse(settings), match: { human: false, names: { player: "You", bot: "Club bot" }, opponentEmail: "" },
        series: null, timer: null, camSeq: 0, camDarts: [], msg: "", over: null };
      await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "liveGames", uid), { uid, vid: "inj" + Date.now().toString(36) + n, parent: "", by: "e2e-injector", at: Date.now(), phase: "play", rev: 1, state: JSON.stringify(state) }));
      await until(async () => (await liveGame()) && (await ipad.evaluate((id) => document.getElementById("boardMode").textContent.length > 0, gameId)), 10000);
      await H.sleep(1500);
      return gameId;
    };

    // ---- Board mode before a game, then a game started from it --------------------------------
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    check(/A game against the bot/.test(await ipad.$eval("#boardMode", (e) => e.textContent)), "Board mode before a game: start one from here");
    await ipad.click("#boardMode [data-act=start]");
    let b = await until(async () => { const x = await bm(); return x.target === "201" ? x : null; }, 10000) || await bm();
    check(b.target === "201" && /Your throw/i.test(b.label) && /Dart 1/.test(b.count), "the game on the board: 201, your throw, dart 1: " + b.label + " " + b.target);
    check(/Club bot\s*201/.test(b.opp), "the bot's score beside it: " + b.opp);
    await until(async () => /watching the board/i.test(await ipad.$eval("#camStatus", (e) => e.textContent)), 15000);

    // ---- camera darts: what each scored, the visit's total and what it leaves ------------------------
    await camDart("T20");
    b = await bm();
    check(b.slots[0] === "T20|60" && b.target === "141", "T20: 60, leaves 141: " + b.slots[0] + " / " + b.target);
    check(/60\s*this visit · leaves\s*141/.test(b.info), "the visit's line: " + b.info);
    // ---- fixing a dart by tapping it ----------------------------------------------------------
    await ipad.click("#boardMode .bm-slot[data-i='0']");
    await ipad.waitForSelector("#boardMode [data-ref=sheet]:not([hidden])", { timeout: 5000 });
    const options = await ipad.$$eval("#boardMode [data-fix]", (els) => els.map((e) => e.textContent));
    check(options.join(" / ") === "Treble 20: 60 (what it is now) / Double 20: 40 / Single 20: 20 / Missed the board / Another number", "the fix sheet: " + options.join(" / "));
    await ipad.click("#boardMode [data-fix='other']");
    await ipad.click("#boardMode [data-num='19']");
    await ipad.click("#boardMode [data-fix='T19']");
    b = await until(async () => { const x = await bm(); return /T19/.test(x.slots[0]) ? x : null; }) || await bm();
    check(b.slots[0] === "T19|57" && b.target === "144", "fixed through Another number: T19, 144 left: " + b.slots[0] + " / " + b.target);
    let st = await until(async () => { const g = await liveGame(); return g && g.game.visitDarts.join(" ") === "T19" ? g : null; }) || await liveGame();
    check(st.game.visitDarts.join(" ") === "T19" && st.game.remaining.player === 144, "the shared game has the fix");

    // ---- the bot's visit stays on the board; Undo goes back across it --------------------------
    await camDart("S20"); await camDart("S20");
    b = await until(async () => { const x = await bm(); return /Your throw/i.test(x.label) && x.slots[0] && !/T19|S20/.test(x.slots[0]) && x.slots.some((s) => !/^–|^Throw/.test(s)) ? x : null; }, 15000) || await bm();
    st = await liveGame();
    const botVisit = st.game.visits[1];
    check(botVisit && botVisit.who === "bot" && new RegExp("Club bot (scored|bust)").test(b.info), "your turn again: the bot's visit is on the board: " + b.info + " | " + b.slots.join(" / "));
    check(b.cells.length === 2, "the strip has both visits: " + b.cells.join(" / "));
    await ipad.click("#boardMode [data-act=undo]");
    st = await until(async () => { const g = await liveGame(); return g && g.game.visits.length === 0 && g.game.visitDarts.length === 2 ? g : null; }) || await liveGame();
    check(st.game.visits.length === 0 && st.game.visitDarts.join(" ") === "T19 S20" && st.game.remaining.bot === 201, "Undo: the bot's visit comes off, yours is open again without its last dart (" + st.game.visitDarts.join(" ") + ")");
    b = await bm();
    check(b.target === "124" && /Dart 3/.test(b.count), "back to dart 3 on 124: " + b.target + " " + b.count);

    // ---- a 180 fills the screen ----------------------------------------------------------------
    const g180 = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    await inject(g180);
    await until(async () => /watching the board/i.test(await ipad.$eval("#camStatus", (e) => e.textContent)), 15000);
    await camDart("T20"); await camDart("T20"); await camDart("T20");
    b = await until(async () => { const x = await bm(); return x.moment ? x : null; }, 6000) || await bm();
    check(/180/.test(b.moment), "a 180 fills the screen: " + b.moment);
    check(/^180/.test((await bm()).cells[0] || ""), "and the strip has it: " + (await bm()).cells.join(" / "));

    // ---- "You require 81" after the bot's visit ----------------------------------------------------
    const greq = E.createGame({ kind: "x01", startScore: 201, first: "bot" });
    greq.remaining.player = 81;
    await inject(greq);
    check(await until(async () => (await said()).includes("You require 81."), 12000), "after the bot's visit: \"You require 81.\" (" + (await said()).slice(-2).join(" | ") + ")");
    b = await bm();
    check(/You require 81/.test(b.next) && /T19\s*D12/.test(b.next), "and the route on the board: " + b.next);

    // ---- the winning double, then the pull-out finishes the game ------------------------------------
    const gwin = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    gwin.remaining.player = 40; gwin.visitStart = 40;
    const winId = await inject(gwin);
    await until(async () => /watching the board/i.test(await ipad.$eval("#camStatus", (e) => e.textContent)), 15000);
    await camDart("D20");
    b = await bm();
    check(/won/i.test(b.label) && b.slots[0] === "D20|Game shot", "D20 on 40: game shot: " + b.label + " / " + b.slots[0]);
    await station.send({ type: "takeout", darts: 1 }); await H.sleep(1500);
    const rec = await until(() => station.read("botGames", winId), 10000);
    check(rec && rec.result === "won", "pulling the darts out finished the game: " + (rec && rec.result));
    check(rec && Array.isArray(rec.visits) && rec.visits.length === 1 && rec.visits[0].d[0] === "D20" && rec.visits[0].s === 40, "saved with its visits: " + JSON.stringify(rec && rec.visits));
    b = await until(async () => { const x = await bm(); return x.done ? x : null; }, 6000) || await bm();
    check(/You won/.test(b.done) && /3-dart average/.test(b.done) && /Checkout\s*100% \(1\/1\)/.test(b.done), "the match report: " + b.done.slice(0, 200));

    // ---- a reload keeps Board mode ----------------------------------------------------------------
    await ipad.reload();
    await ipad.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    check(await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 }).then(() => true, () => false), "after a reload the iPad is still in Board mode");
    await ipad.click("#boardMode [data-act=exit]");
    check(await ipad.evaluate(() => document.getElementById("boardMode").hidden), "Exit leaves Board mode");
    check(ipad.errors.length === 0, "no page errors: " + ipad.errors.join(" | "));
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
