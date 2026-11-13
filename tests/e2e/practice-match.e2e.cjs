// The bot game's bot and match settings (practice.html): a bot with its average set by hand and a
// style, played on a real board (model 2, kept with the game); a bull-up for who throws first (the
// closer starts); a leg of a match saved with the match's id, its number and first-to; and the
// ladder's step worked out from saved ladder games.
const H = require("./harness.cjs");
const E = require("../../public/practice-engine.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const base = { kind: "x01", startScore: 201, doubleOut: true, rank: "custom", botTarget: 60, botStyle: "grinder", first: "bullup", entry: "board", confirm: false, camera: false, mute: true, opponent: "bot", seriesTarget: 2 };
    const page = await H.device(browser, "laptop", { viewport: { width: 1280, height: 1000 }, storage: { dt_practice_settings: JSON.stringify(base) } });
    page.on("dialog", (d) => d.accept());
    await page.goto(`http://127.0.0.1:${H.PORT}/practice.html`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const liveGame = async () => { const d = await station.read("liveGames", uid); return d ? JSON.parse(d.state) : null; };
    const tapBoard = async (p) => {
      const c = page.locator("#board");
      await c.scrollIntoViewIfNeeded();
      const box = await c.boundingBox();
      const size = await page.$eval("#board", (e) => e.width);
      const k = (size * 0.44) * (box.width / size);
      await c.click({ position: { x: box.width / 2 + p.x * k, y: box.height / 2 + p.y * k } });
    };

    // ---- the ladder's step from saved ladder games ---------------------------------------------
    for (const [i, r] of [[1, "won"], [2, "lost"], [3, "won"]]) {
      await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "botGames", "lad" + i), { uid, timestamp: "2026-11-0" + i + " 18:00", kind: "x01", startScore: 501, doubleOut: true, rank: "club", first: "player", result: r, playerDarts: [], botDarts: [], ladder: true, botTarget: 52, botModel: 2 }));
    }
    await page.reload();
    await page.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
    await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    await page.selectOption("#rank", "ladder");
    check(await until(async () => /step at 55/.test(await page.$eval("#rankBlurb", (e) => e.textContent))), "the ladder: 2 of 3 won at 52, so the step is 55: " + await page.$eval("#rankBlurb", (e) => e.textContent));
    check(/Highest average beaten: 52/.test(await page.$eval("#rankBlurb", (e) => e.textContent)), "and the highest average beaten");
    await page.selectOption("#rank", "custom");
    await page.fill("#botTarget", "60");
    await page.dispatchEvent("#botTarget", "change");
    check(/about 60/.test(await page.$eval("#rankBlurb", (e) => e.textContent)), "its average set by hand: " + await page.$eval("#rankBlurb", (e) => e.textContent));

    // ---- a match with a bull-up ----------------------------------------------------------------
    await page.click("#startBtn");
    let st = await until(async () => { const g = await liveGame(); return g && g.game && g.game.bullUp ? g : null; }, 10000);
    check(st && st.game.botModel === E.BOT_MODEL && st.game.bot.target === 60 && st.game.bot.style === "grinder" && st.game.bot.level === "custom", "the game keeps its bot: model 2, 60, a grinder");
    check(/Bull-up/.test(await page.$eval("#status", (e) => e.textContent)), "the status asks for a dart at the bull: " + await page.$eval("#status", (e) => e.textContent));
    await tapBoard({ x: 0.02, y: 0 });
    st = await until(async () => { const g = await liveGame(); return g && g.game.bullUp && g.game.bullUp.done ? g : null; }, 10000);
    check(st && (st.game.first === "player" || st.game.first === "bot"), "the bull-up is decided: " + (st && st.game.first));
    check(st && /closer/.test(st.msg), "and it says who was closer: " + (st && st.msg));
    check(st && st.series && st.series.nextFirst === st.game.first && typeof st.series.id === "string", "the match starts with the bull-up's winner, and has an id");

    // ---- a leg won: saved with the match's id, the leg and the bot -------------------------------
    const g = E.createGame({ kind: "x01", startScore: 201, first: "player", bot: { level: "custom", target: 60, style: "grinder" } });
    g.remaining.player = 40; g.visitStart = 40;
    const gameId = "e2ematch" + Date.now().toString(36);
    const state = Object.assign({}, st, { gameId, game: g, msg: "", over: null, camSeq: 0, camDarts: [] });
    await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "liveGames", uid), { uid, vid: "inj" + Date.now().toString(36), parent: "", by: "e2e", at: Date.now(), phase: "play", rev: 1, state: JSON.stringify(state) }));
    await until(async () => /40/.test(await page.$eval("#scoreboard", (e) => e.textContent)), 10000);
    await H.sleep(800);
    await tapBoard(E.aimPoint("20", "D"));
    await H.sleep(600);
    await page.click("#nextBtn");
    const rec = await until(() => station.read("botGames", gameId), 10000);
    check(rec && rec.result === "won" && rec.matchId === st.series.id && rec.leg === 1 && rec.legsToWin === 2, "the leg is saved with the match: " + JSON.stringify(rec && { matchId: rec.matchId, leg: rec.leg, legsToWin: rec.legsToWin }));
    check(rec && rec.botModel === 2 && rec.botTarget === 60 && rec.botStyle === "grinder" && rec.rank === "club" && !rec.ladder, "and the bot: model 2, 60, a grinder (rank: the nearest level)");
    check(/Match:\s*You 1 - 0/.test(await page.$eval("#overSeries", (e) => e.textContent)), "the match score: " + await page.$eval("#overSeries", (e) => e.textContent));
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
