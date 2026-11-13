// The stats page (stats.html, stats-engine.js) and Today's practice on the tracker page, over saved
// games: partial sessions, unfinished bot games and hidden games never count; a game hidden from the
// stats page stays saved; the practice plan opens each game and ticks what was played today; every
// page has the shared navigation.
const H = require("./harness.cjs");
const TE = require("../../public/tracker-engine.js");
const DE = require("../../public/practice-engine.js");
const CE = require("../../public/challenge-engine.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const page = await H.device(browser, "laptop", { viewport: { width: 1280, height: 1000 } });
    await page.goto(`http://127.0.0.1:${H.PORT}/stats.html`);
    const uid = await H.signIn(page);
    station = await H.makeStation(uid);
    await station.clear(); // the test files share one emulator run: start from nothing
    const put = (coll, id, data) => station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), coll, id), Object.assign({ uid }, data)));
    const d = new Date(), iso = (k) => { const x = new Date(d); x.setDate(x.getDate() - k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`; };
    // Tracker: 5 finished sessions (the last today), one partial.
    for (let k = 0; k < 5; k += 1) {
      const entry = Object.assign(TE.blankEntry(), { "20": ["T", "S", "-"], "19": ["S", "-", "-"], "BULL": k ? ["-", "-", "-"] : ["D", "-", "-"] });
      await put("sessions", "s" + k, { timestamp: iso(4 - k) + " 18:00", mode: "standard", entry, total: TE.totalOf(entry, "standard"), complete: true });
    }
    await put("sessions", "partial", { timestamp: iso(0) + " 19:00", mode: "standard", entry: Object.assign(TE.blankEntry(), { "20": ["T", "T", "T"] }), total: 9, complete: false });
    // Bot: a finished game with its visits and a test game left unfinished.
    const g = DE.createGame({ kind: "x01", startScore: 201, first: "player" });
    const at = (l) => DE.aimPoint(l.slice(1), l[0]);
    [["T20", "S20", "S20"], ["S1", "S1", "S1"], ["S20", "S20", "S1"], ["S1", "S1", "S1"], ["S20", "D20"]].forEach((v) => { v.forEach((l) => DE.throwDart(g, at(l))); DE.endVisit(g); });
    await put("botGames", "b1", { timestamp: iso(1) + " 18:00", kind: "x01", startScore: 201, doubleOut: true, rank: "club", first: "player", result: "won", playerAvg: 75.4, botAvg: 3, playerDarts: g.darts.player, botDarts: g.darts.bot, visits: DE.visitsRecord(g) });
    await put("botGames", "test", { timestamp: "2026-09-27 12:00", kind: "x01", startScore: 501, doubleOut: true, rank: "club", result: "abandoned", playerAvg: 140, playerDarts: [], botDarts: [] });
    // JDC and Doubles.
    const darts = CE.STEPS.flatMap((st) => Array(st.darts).fill(st.kind === "double" ? 1 : 2));
    await put("challengeGames", "j1", CE.record(uid, darts, { timestamp: iso(2) + " 18:00" }));
    await put("doublesSessions", "d1", { startedAtMs: Date.now() - 2 * 86400000, activeMs: 600000, totalDarts: 60, perDouble: { D16: { attempts: 1, completed: true, hitDart: 1 }, D6: { attempts: 3, completed: false } },
      throws: [{ s: 1, k: "D6", l: "S6", x: 0.3, y: 0.6, t: 1 }, { s: 2, k: "D6", l: "MISS", x: 0.4, y: 0.95, t: 2 }, { s: 3, k: "D16", l: "D16", x: -0.8, y: 0.4, t: 3 }] });

    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(200); } return v; };
    const text = (sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, " ").trim());
    await until(async () => /Partial tracker sessions/.test(await text("#loadNote")), 10000);
    check(/Days in a row\s*5/.test(await text("#overall")), "five days in a row, today included: " + (await text("#overall")).slice(0, 80));
    check(/Tracker: Best session/.test(await text("#records")) && /Bot: Highest checkout\D*60/.test(await text("#records")), "records: the best session and the highest checkout: " + (await text("#records")).slice(0, 200));
    let panel = await text("#panel");
    check(/Sessions\s*5(?!\d)/.test(panel) && /1 saved part way through don't count/.test(panel), "the tracker: 5 sessions, the partial one left out: " + panel.slice(0, 160));
    check((await page.$$eval("#panel table tbody tr", (r) => r.length)) >= 21, "each number in a table");
    await page.click('#tabs [data-tab="bot"]');
    panel = await text("#panel");
    check(/Games\s*1(?!\d)/.test(panel) && /1 unfinished never count/.test(panel) && /Checkout\s*100%/.test(panel), "the bot game: the finished game only, its checkout: " + panel.slice(0, 200));
    await page.click('#tabs [data-tab="jdc"]');
    check(/Rounds\s*1(?!\d)/.test(await text("#panel")), "the JDC Challenge: 1 round");
    await page.click('#tabs [data-tab="doubles"]');
    await page.selectOption("#dblKey", "D6");
    check(/2 camera darts: 0% in, 50% inside the wire, 50% outside it/.test(await text("#panel")), "Doubles: where the darts at D6 went: " + (await text("#panel")).match(/\d+ camera darts[^.]*\./));

    // Hide a session: it stays saved, it just doesn't count.
    await page.click('#tabs [data-tab="tracker"]');
    await page.click('#panel [data-hide="s0"]');
    check(await until(async () => /Sessions\s*4(?!\d)/.test(await text("#panel"))), "hidden from the stats: 4 sessions");
    const hid = await until(async () => { const x = await station.read("statsHidden", uid); return x && x.ids && x.ids.includes("s0") ? x : null; });
    check(hid && hid.ids.includes("s0") && !!(await station.read("sessions", "s0")), "it's in statsHidden and still saved");
    await page.click('#panel [data-hide="s0"]');
    check(await until(async () => /Sessions\s*5(?!\d)/.test(await text("#panel"))), "shown again: 5 sessions");

    // Today's practice on the tracker page.
    await page.goto(`http://127.0.0.1:${H.PORT}/index.html`);
    await page.waitForSelector("#planCard:not([hidden])", { timeout: 15000 });
    const readPlan = () => page.$$eval("#plan li", (els) => els.map((e) => e.className + "|" + e.textContent.replace(/\s+/g, " ").trim() + "|" + e.querySelector("a").getAttribute("href")));
    const plan = await until(async () => { const x = await readPlan(); return /Watch/.test(x[0] || "") && /D6/.test(x[1] || "") ? x : null; }, 12000) || await readPlan();
    check(plan.length === 4, "four items: " + plan.length);
    check(/^done\|A tracker session/.test(plan[0]) && /index\.html\?board=1$/.test(plan[0]), "a tracker session, done today: " + plan[0]);
    check(/D6/.test(plan[1]) && /doubles\.html$/.test(plan[1]) && !/^done/.test(plan[1]), "Doubles: D6 needs the most work: " + plan[1]);
    check(/practice\.html$/.test(plan[2]) && /challenge\.html$/.test(plan[3]), "the bot game and the JDC Challenge");
    check(await page.$eval('nav.dt-nav a[aria-current="page"]', (a) => a.textContent) === "Tracker", "the shared navigation marks the page");
    await page.click("#plan li:first-child a");
    check(await page.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 }).then(() => true, () => false), "the plan's tracker link opens Board mode");
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
