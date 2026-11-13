// The game against the bot (practice.html) with the cameras on: the bugs that put wrong games in the
// record, each checked on the real page. The bot's checkout visit is closed (its "Game shot", the
// Rounds table and the saved average), Enter finishes the game while the bot's checkout waits, your
// winning dart can be undone, darts thrown while the bot is still throwing go into your next visit,
// a dart the cameras couldn't read keeps its place in the order, and the camera line says what the
// game read, not the station's own label.
const H = require("./harness.cjs");
const E = require("../../public/practice-engine.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const settings = JSON.stringify({ kind: "x01", startScore: 201, doubleOut: true, rank: "club", first: "player", entry: "board", confirm: false, camera: true, mute: true, opponent: "bot" });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_practice_settings: settings } });
    ipad.on("dialog", (d) => d.accept());
    await ipad.goto(`http://127.0.0.1:${H.PORT}/practice.html`);
    const uid = await H.signIn(ipad);
    station = await H.makeStation(uid);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(200); } return v; };
    const liveGame = async () => { const d = await station.read("liveGames", uid); return d ? JSON.parse(d.state) : null; };
    let n = 0;
    // A game put in the account's live game, as another device would leave it: this page joins it.
    const inject = async (game) => {
      const gameId = "e2egame" + (n += 1) + Date.now().toString(36);
      const state = { v: 1, gameId, game, editing: null, startedAt: Date.now() - 60000, settings: JSON.parse(settings), match: { human: false, names: { player: "You", bot: "Club bot" }, opponentEmail: "" },
        series: null, timer: null, camSeq: 0, camDarts: [], msg: "", over: null };
      await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "liveGames", uid), { uid, vid: "inj" + Date.now().toString(36) + n, parent: "", by: "e2e-injector", at: Date.now(), phase: "play", rev: 1, state: JSON.stringify(state) }));
      await until(async () => (await ipad.evaluate(() => !document.getElementById("gameCard").classList.contains("hidden"))), 10000);
      await H.sleep(800);
      return gameId;
    };
    const at = (label) => (label === "MISS" ? { x: 0, y: -1.1 } : E.aimPoint(label.slice(1), label[0]));
    const play = (game, labels) => { labels.forEach((l) => E.throwDart(game, at(l))); if (game.visitDone && !game.winner) E.endVisit(game); };
    const camDart = async (label, as) => { const p = at(label); await station.send(H.dart(as || label, p.x, p.y)); await H.sleep(900); };
    const tapBoard = async (label) => {
      const c = ipad.locator("#board");
      await c.scrollIntoViewIfNeeded();
      const box = await c.boundingBox();
      const size = await ipad.$eval("#board", (e) => e.width);
      const p = at(label), k = (size * 0.44) * (box.width / size);
      await c.click({ position: { x: box.width / 2 + p.x * k, y: box.height / 2 + p.y * k } });
    };
    const statusText = () => ipad.$eval("#status", (e) => e.textContent);
    const camText = () => ipad.$eval("#camStatus", (e) => e.textContent);

    // ---- bug 1 and Enter: the bot checks out 101 in five darts ----------------------------------
    let g = E.createGame({ kind: "x01", startScore: 201, first: "bot" });
    g.remaining.bot = 101; g.visitStart = 101;
    play(g, ["T20", "S1", "S1"]);            // the bot: 62, 39 left
    play(g, ["S1", "S1", "S1"]);             // you: 3
    play(g, ["S19", "D10"]);                 // the bot: checked out, its visit not closed yet
    const id1 = await inject(g);
    const closed = await until(async () => { const s = await liveGame(); return s && s.gameId === id1 && s.game.visits.length === 3 ? s : null; }, 12000);
    check(!!closed, "bug 1: the bot's checkout visit is closed (" + (closed ? closed.game.visits.map((v) => v.who + ":" + v.scored).join(" ") : "still open") + ")");
    check(/checked out/i.test(await statusText()), "the page waits on the bot's checkout: " + (await statusText()).slice(0, 80));
    check(/39/.test(await ipad.$eval("#log", (e) => e.textContent)), "bug 1: the Rounds table has the bot's checkout visit (39)");
    await ipad.locator("body").press("Enter");
    const rec = await until(() => station.read("botGames", id1), 10000);
    check(rec && rec.result === "lost", "bug 10: Enter finishes the game while the bot's checkout waits: " + (rec && rec.result));
    check(rec && rec.botAvg === 60.6, "bug 1: the bot's saved average counts its checkout: " + (rec && rec.botAvg) + " (101 in 5 darts is 60.6)");

    // ---- bug 2: your winning dart can be undone --------------------------------------------------
    g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    g.remaining.player = 32; g.visitStart = 32;
    await ipad.click("#againBtn").catch(() => {});
    const id2 = await inject(g);
    await until(async () => /watching the board/i.test(await camText()), 15000);
    await camDart("D16");
    let s = await liveGame();
    check(s && s.gameId === id2 && s.game.winner === "player", "D16 on 32 wins");
    check(!(await ipad.$eval("#undoBtn", (e) => e.disabled)), "bug 2: Undo works on the winning dart");
    await ipad.click("#undoBtn");
    await H.sleep(900);
    s = await liveGame();
    check(s.game.winner === null && s.game.remaining.player === 32, "bug 2: the win is taken back, 32 left (" + s.game.remaining.player + ")");

    // ---- bug 3 and bug 10: darts while the bot is still throwing ----------------------------
    g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    const id3 = await inject(g);
    await until(async () => /watching the board/i.test(await camText()), 15000);
    await camDart("S20"); await camDart("S20");
    await camDart("S20");                                       // 60: the visit passes to the bot by itself
    await until(async () => /Bot's turn/i.test(await statusText()), 4000);
    await H.sleep(600);
    await camDart("T20", "S1");                                 // your next visit, the bot still throwing (the station mislabelled it)
    check(/Treble 20/.test(await camText()) && !/Single 1/.test(await camText()), "bug 10: the camera line says what the game read (Treble 20): " + (await camText()));
    await camDart("S20");
    s = await until(async () => { const v = await liveGame(); return v && v.game.turn === "player" && v.game.visits.length === 2 ? v : null; }, 10000);
    check(s && s.game.visitDarts.join(" ") === "T20 S20", "bug 3: the two darts thrown during the bot's turn are in your visit: " + (s && s.game.visitDarts.join(" ")));
    await station.send({ type: "takeout", darts: 2 }); await H.sleep(1500);
    s = await liveGame();
    const mine = s.game.visits.filter((v) => v.who === "player");
    check(mine.length === 2 && mine[1].scored === 80, "bug 3: the pull-out ends that visit with a miss: 80 (" + mine.map((v) => v.scored).join(", ") + ")");

    // ---- bug 4: a dart the cameras couldn't read keeps its place --------------------------------
    g = E.createGame({ kind: "x01", startScore: 201, first: "player" });
    g.remaining.player = 40; g.visitStart = 40;
    const id4 = await inject(g);
    await until(async () => /watching the board/i.test(await camText()), 15000);
    await station.send({ type: "unreadable" }); await H.sleep(900);
    await camDart("D10");
    s = await liveGame();
    check(s.gameId === id4 && s.game.visitDarts.length === 0 && /held/i.test(await camText()), "bug 4: D10 waits behind the dart the cameras couldn't read: " + (await camText()));
    await tapBoard("S20");
    await H.sleep(1200);
    s = await liveGame();
    check(s.game.winner === "player" && s.game.visitDarts.join(" ") === "S20 D10", "bug 4: S20 (tapped) then D10: a checkout, not a bust (" + s.game.visitDarts.join(" ") + ", winner " + s.game.winner + ")");

    check(ipad.errors.length === 0, "no page errors: " + ipad.errors.join(" | "));
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
