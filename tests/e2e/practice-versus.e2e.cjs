// Two players with the cameras (practice.html, "Another player"): darts thrown after a bust stay the
// thrower's until the darts come out; the pull-out passes the turn at once; and the next player's dart,
// thrown the moment the board is clear, is theirs. (Nov 17, 2026: a bust's third dart went in as the
// other player's, and every visit after it was off by one until it was put right by hand.)
const H = require("./harness.cjs");
const E = require("../../public/practice-engine.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const settings = { kind: "x01", startScore: 301, doubleOut: true, rank: "club", first: "player", entry: "board", confirm: false, camera: true, mute: true, opponent: "human", oppName: "Ashley", oppEmail: "ash@example.com" };
    const page = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_practice_settings: JSON.stringify(settings) } });
    page.on("dialog", (d) => d.accept());
    await page.goto(`http://127.0.0.1:${H.PORT}/practice.html`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const liveGame = async () => { const d = await station.read("liveGames", uid); return d ? JSON.parse(d.state) : null; };
    const at = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));
    const camDart = (label) => { const p = at(label); return station.send(H.dart(label, p.x, p.y)); };
    const camText = () => page.$eval("#camStatus", (e) => e.textContent);

    // A game in play: you on 3 (the checkout battle that went wrong), Ashley on 20.
    const game = E.createGame({ kind: "x01", startScore: 301, first: "player", bot: null });
    game.remaining.player = 3; game.visitStart = 3; game.remaining.bot = 20;
    const state = { v: 1, gameId: "e2evs" + Date.now().toString(36), game, editing: null, startedAt: Date.now() - 60000, settings,
      match: { human: true, names: { player: "Tester", bot: "Ashley" }, opponentEmail: "ash@example.com" }, series: null, timer: null, camSeq: 0, camDarts: [], msg: "", over: null };
    await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "liveGames", uid), { uid, vid: "inj" + Date.now().toString(36), parent: "", by: "e2e-injector", at: Date.now(), phase: "play", rev: 1, state: JSON.stringify(state) }));
    await until(async () => /watching the board/i.test(await camText()), 15000);

    // ---- your bust, and the dart you throw after it -------------------------------------------------
    await camDart("S1"); await H.sleep(700);
    await camDart("S2"); // 3 - 1 - 2 = 0, not on a double: bust
    let st = await until(async () => { const g = await liveGame(); return g && g.game.turn === "bot" ? g : null; }, 8000);
    check(st && st.game.remaining.player === 3 && st.game.visits.length === 1, "the bust: still 3, and the turn passes to Ashley on its timer: " + JSON.stringify(st && { left: st.game.remaining, turn: st.game.turn }));
    await camDart("S1"); // the third dart, thrown anyway
    await H.sleep(1500);
    st = await liveGame();
    check(st.game.darts.bot.length === 0 && st.game.visitDarts.length === 0, "the dart after the bust is not Ashley's: " + JSON.stringify(st.game.darts.bot));
    check(/S1|Single 1/.test(await camText()) && /not counted/.test(await camText()), "and it says so: " + await camText());
    check(st.camHold && st.camHold.after > 0, "the game knows your darts are still in the board");

    // ---- you pull them out, and Ashley throws at once -------------------------------------------------
    await station.send({ type: "takeout", darts: 3 });
    st = await until(async () => { const g = await liveGame(); return g && g.camHold && !g.camHold.after ? g : null; }, 6000);
    check(st && !st.camHold.after, "the pull-out: your darts are out");
    await H.sleep(300);
    await camDart("S10");
    st = await until(async () => { const g = await liveGame(); return g && g.game.visitDarts.length === 1 ? g : null; }, 6000);
    check(st && st.game.turn === "bot" && st.game.visitDarts[0] === "S10" && st.game.remaining.bot === 10, "Ashley's first dart is hers: " + JSON.stringify(st && { turn: st.game.turn, darts: st.game.visitDarts }));
    await camDart("D5");
    st = await until(async () => { const g = await liveGame(); return g && g.game.winner ? g : null; }, 6000);
    check(st && st.game.winner === "bot", "and her D5 checks out: " + JSON.stringify(st && st.game.winner));

    // ---- a visit ended by the pull-out: the next player's quick dart is theirs ----------------------------
    const g2 = E.createGame({ kind: "x01", startScore: 301, first: "player", bot: null });
    const s2 = Object.assign({}, state, { gameId: "e2evs2" + Date.now().toString(36), game: g2, camHold: { wait: 0, queue: [], after: 0 } });
    await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "liveGames", uid), { uid, vid: "inj2" + Date.now().toString(36), parent: "", by: "e2e-injector", at: Date.now(), phase: "play", rev: 1, state: JSON.stringify(s2) }));
    await until(async () => { const g = await liveGame(); return g && g.gameId === s2.gameId && g.game.visits.length === 0; }, 8000);
    await H.sleep(1500);
    await camDart("T20"); await H.sleep(700);
    await camDart("S20");
    await H.sleep(700);
    await station.send({ type: "takeout", darts: 2 }); // the third was never seen: a miss, and the darts are out
    await H.sleep(250);
    await camDart("S19"); // Ashley, straight away
    st = await until(async () => { const g = await liveGame(); return g && g.game.visits.length === 1 && g.game.visitDarts.length === 1 ? g : null; }, 8000);
    check(st && st.game.visits[0].darts.join(" ") === "T20 S20 MISS" && st.game.turn === "bot" && st.game.visitDarts[0] === "S19",
      "your visit ends at the pull-out (a miss for the dart not seen) and the turn passes at once: Ashley's S19 is hers: " + JSON.stringify(st && { visits: st.game.visits.map((v) => v.darts), turn: st.game.turn, darts: st.game.visitDarts }));
    check(page.errors.length === 0, "no page errors: " + page.errors.join(" | "));
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
