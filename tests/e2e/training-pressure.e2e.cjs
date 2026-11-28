// Phase 4 on the Training page, on a computer and an iPad in Board mode (voice on), one account:
// Warm-up with the cameras (the clock line; minutes on each number, moving on at the end of the visit in
// which its time is up; the end the same way; no best; up to 12 darts a visit, the station asked for them
// and back to 3 after; free throwing with Finish from Board mode; "Warm up first" then "On to" the
// drill); Score More by hand and with the cameras (the mark, "Beat", strikes, the longest run saved as
// its best); Score More with two players (a new player typed, kept with your saved players; the lower
// scorer must beat their own score; the other player's email saved with the session, not shown).
const H = require("./harness.cjs");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const computer = await H.device(browser, "computer", { viewport: { width: 1280, height: 1000 } });
    const ipad = await H.device(browser, "ipad", { viewport: { width: 820, height: 1180 }, storage: { dt_trainingBoard: "1", dt_trainingVoice: "1" } });
    const url = `http://127.0.0.1:${H.PORT}/training.html?drill=warmup`;
    await Promise.all([computer.goto(url), ipad.goto(url)]);
    const uid = await H.signIn(computer);
    await H.signIn(ipad);
    station = await H.makeStation(uid);
    await station.clear();
    await H.sleep(800);
    const throwAt = async (n, ring, label, wait = 1300) => { const p = H.spot(n, ring); await station.send(H.dart(label, p.x, p.y)); await H.sleep(wait); };
    const takeout = async (wait = 1200) => { await station.send({ type: "takeout", darts: 3 }); await H.sleep(wait); };
    const state = () => station.read("trainingState", uid);
    const saved = async () => (await station.list("trainingSessions")).filter((s) => s.uid === uid);
    // The practice clock moved on: as if `ms` of active time had gone by, throwing all along.
    const clockAt = async (ms) => {
      const st = await state();
      const now = Date.now();
      st.activeSession.timer = Object.assign(st.activeSession.timer, { activeMs: ms, runningSince: now, lastActivityAt: now, pausedBy: null, pausedAt: null });
      await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "trainingState", uid), st));
      await H.sleep(1200);
    };
    const page = (p) => p.evaluate(() => ({
      head: document.getElementById("drillHead").textContent,
      scoreLabel: document.getElementById("scoreLabel").textContent, score: document.getElementById("score").textContent,
      target: document.getElementById("target").textContent, hero: document.getElementById("heroLabel").textContent,
      pace: document.getElementById("pace").textContent, playing: !document.getElementById("playCard").hidden,
      result: !document.getElementById("resultCard").hidden, resultBig: document.getElementById("resultBig").textContent,
      resultSub: document.getElementById("resultSub").textContent, newBest: !document.getElementById("newBest").hidden,
      pb: document.getElementById("pbLine").textContent, after: document.getElementById("afterWarmBtn").hidden ? "" : document.getElementById("afterWarmBtn").textContent,
      pad: ["p1", "p2", "p3", "pm"].map((id) => document.getElementById(id)).filter((b) => !b.hidden).map((b) => b.textContent),
      hitsRow: !document.getElementById("hitsRow").hidden,
    }));
    const boardView = () => ipad.evaluate(() => {
      const bm = document.getElementById("boardMode");
      const q = (s) => bm.querySelector(s);
      return {
        target: q(".bm-target").textContent, label: q("[data-ref=label]").textContent,
        opp: [...q("[data-ref=opp]").children].map((c) => c.textContent).join(" ").trim(),
        info: q("[data-ref=info]").textContent, cap: q("[data-ref=capLeft]").textContent,
        moment: q("[data-ref=moment]").hidden ? "" : q("[data-ref=momentBig]").textContent,
        done: !q("[data-ref=done]").hidden, doneBig: q("[data-ref=doneBig]").textContent,
      };
    });
    const said = () => ipad.evaluate(() => window.__said.slice());
    const hand = async (ids) => { for (const id of ids) { await computer.click("#" + id); await H.sleep(700); } };
    const other = async (label) => { await computer.selectOption("#segPick", label); await computer.click("#segAdd"); await H.sleep(700); };

    // ---- Warm-up: 3 minutes on each number, visits of 3, with the cameras --------------------------------
    await ipad.waitForSelector("#boardMode:not([hidden])", { timeout: 15000 });
    await computer.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    let p = await page(computer);
    check(p.head === "Warm-up" && /No best to chase/.test(p.pb), "the warm-up card: no best to chase: " + p.pb);
    check(await computer.$eval("#warmBtn", (e) => e.hidden), "no Warm up first on the warm-up itself");
    await computer.selectOption("#set_each", "3");
    await computer.selectOption("#set_visit", "3");
    await H.sleep(300);
    await computer.click("#startBtn");
    await H.sleep(1500);
    p = await page(computer);
    check(p.playing && p.target === "20" && p.hitsRow && p.scoreLabel === "In the number" && /^(3:00|2:5\d) at the 20s, then the 19s$/.test(p.pace), `the warm-up starts at the 20: ${p.target}, "${p.pace}"`);
    let b = await boardView();
    check(b.target === "20" && /no best: a warm-up/.test(b.opp) && /left/.test(b.cap), `Board mode: ${b.target}, ${b.opp}, ${b.cap}`);
    await ipad.click("#boardMode [data-act=camera]");
    await ipad.waitForFunction(() => /watching the board/i.test(document.getElementById("camNote").textContent), null, { timeout: 15000 });
    let cs = await station.read("cameraStations", uid);
    check(!(cs.ask && cs.ask.visit), "visits of 3: nothing asked of the station");
    await throwAt(20, "T", "T20"); await throwAt(20, "S", "S20"); await throwAt(1, "S", "S1", 1800);
    let st = await state();
    check(st.activeSession.play.hits === 2 && st.activeSession.play.darts === 3, "any ring of the 20 counts, the 1 doesn't: 2 of 3");
    await takeout();
    await clockAt(3.1 * 60000);
    p = await page(computer);
    check(/Time's up at the 20s: the 19s after this visit/.test(p.pace), "the 20s' time is up: " + p.pace);
    await throwAt(20, "S", "S20"); await throwAt(20, "S", "S20"); await throwAt(20, "D", "D20", 1800);
    b = await boardView();
    p = await page(computer);
    check(p.target === "19" && b.target === "19", "the visit in which the time was up moves it to the 19: " + p.target);
    check(/^(3:00|2:5\d) at the 19s$|left at the 19s/.test(p.pace), "the 19s get their own 3 minutes: " + p.pace);
    let heard = await said();
    check(heard.some((x) => x === "The 19s now."), "the voice at the change: " + heard.slice(-2).join(" / "));
    await takeout();
    await clockAt(6.4 * 60000);
    await throwAt(19, "S", "S19"); await throwAt(19, "T", "T19"); await throwAt(7, "S", "S7", 2500);
    p = await page(computer);
    st = await state();
    check(p.result && p.resultBig === "78%" && /7 of 9 darts in the number/.test(p.resultSub) && !p.newBest, `the time was up: the visit ends it: ${p.resultBig}, ${p.resultSub}`);
    heard = await said();
    check(heard.some((x) => x === "Warm-up done. 78% in the number."), "the voice at the end: " + heard.slice(-1)[0]);
    let docs = await saved();
    check(docs.length === 1 && docs[0].drill === "warmup" && docs[0].key === 78 && docs[0].complete && !(st.bests && Object.keys(st.bests).some((k) => /^warmup/.test(k))), "saved with its rate, and no best kept");
    await takeout();
    await computer.click("#doneBtn"); await H.sleep(1200);

    // ---- Warm-up with up to 12 darts: the station is asked for bigger visits -----------------------------
    const visitAsked = async (want, ms = 8000) => {
      const until = Date.now() + ms;
      let got;
      do { const d = await station.read("cameraStations", uid); got = d && d.ask && d.ask.visit ? d.ask.visit.darts : 3; if (got === want) return got; await H.sleep(500); } while (Date.now() < until);
      return got;
    };
    await computer.selectOption("#set_visit", "12");
    await computer.selectOption("#set_numbers", "20-15 BULL");
    await H.sleep(300);
    await computer.click("#startBtn"); await H.sleep(1500);
    p = await page(computer);
    check(p.playing && p.target === "20" && !p.hitsRow && p.pad.join(",") === "T20,S20,D20,Miss", `up to 12: one dart at a time by hand: ${p.pad.join(",")}`);
    check((await visitAsked(12)) === 12, "the station is asked for visits of up to 12");
    const seven = [[20, "T", "T20"], [20, "S", "S20"], [1, "S", "S1"], [20, "S", "S20"], [20, "D", "D20"], [5, "S", "S5"], [20, "S", "S20"]];
    for (const [n, ring, label] of seven) await throwAt(n, ring, label, 900);
    await H.sleep(1200);
    st = await state();
    check(st.activeSession.cam.visit.darts.length === 7 && st.activeSession.play.darts === 0, "seven darts in, the visit still open: " + st.activeSession.cam.visit.darts.length);
    const slots = await ipad.evaluate(() => { const el = document.querySelector("#boardMode [data-ref=slots]"); return { many: el.classList.contains("many"), n: el.querySelectorAll(".bm-slot").length, count: document.querySelector("#boardMode [data-ref=count]").textContent }; });
    check(slots.many && slots.n === 8 && /Dart 8 of up to 12/.test(slots.count), `Board mode: small boxes, the 7 darts and the next: ${JSON.stringify(slots)}`);
    await station.send({ type: "takeout", darts: 7 }); await H.sleep(1500);
    st = await state();
    check(st.activeSession.play.darts === 7 && st.activeSession.play.hits === 5, `pulled out: the visit is the 7 darts, none filled in: ${st.activeSession.play.hits} of ${st.activeSession.play.darts}`);
    // Stopped: back to visits of 3.
    await computer.click("#abandonBtn"); await computer.click("#abandonYesBtn"); await H.sleep(1500);
    check((await visitAsked(3)) === 3, "stopped: the station is back to visits of 3");
    docs = await saved();
    check(docs.some((d) => d.drill === "warmup" && d.complete === false && d.result.darts === 7), "the stopped warm-up kept as unfinished");

    // ---- Free throwing: no target, Finish, and the station asked for up to 12 -----------------------------
    await computer.click("[data-drill='free']"); await H.sleep(600);
    p = await page(computer);
    check(p.head === "Free throwing" && /throw at whatever you like/i.test(p.pb), "the free throwing card: " + p.pb);
    await computer.selectOption("#set_minutes", "0");
    await H.sleep(300);
    await computer.click("#startBtn"); await H.sleep(1500);
    p = await page(computer);
    check(p.playing && p.target === "Any" && /press Finish/.test(p.pace) && !(await computer.$eval("#finishBtn", (e) => e.hidden)), `free throwing starts: ${p.target}, ${p.pace}`);
    check((await visitAsked(12)) === 12, "free throwing asks for visits of up to 12 too");
    for (const [n, ring, label] of [[20, "T", "T20"], [19, "T", "T19"], [5, "S", "S5"], [20, "D", "D20"]]) await throwAt(n, ring, label, 900);
    await H.sleep(1000);
    b = await boardView();
    check(b.target === "Any" && /4 darts/.test(await ipad.$eval("#boardMode [data-ref=darts]", (e) => e.textContent)), "Board mode: " + b.target + ", the darts still in the board counted");
    await ipad.click("#boardMode [data-man=fin]"); await H.sleep(2000);
    p = await page(computer);
    check(p.result && p.resultBig === "4 darts" && /2 triples, 1 double/.test(p.resultSub), `Finish (from Board mode): ${p.resultBig}, ${p.resultSub}`);
    docs = await saved();
    check(docs.some((d) => d.drill === "free" && d.complete && d.key === 4), "free throwing saved, finished, with its darts");
    check((await visitAsked(3)) === 3, "finished: the station is back to visits of 3");
    heard = await said();
    check(heard.some((x) => x === "Free throwing done. 4 darts."), "the voice at the end: " + heard.slice(-1)[0]);
    await computer.click("#doneBtn"); await H.sleep(1200);

    // ---- Warm up first, from Big Triples ------------------------------------------------------------------
    await computer.click("[data-drill='bigtriples']"); await H.sleep(600);
    check(!(await computer.$eval("#warmBtn", (e) => e.hidden)), "Warm up first on another drill's card");
    // The warm-up as this computer last set it up: the 20s only, a minute, up to 12 darts.
    await computer.evaluate(() => localStorage.setItem("dt_training_warmup", JSON.stringify({ numbers: "20", each: "1", visit: "12" })));
    await computer.click("#warmBtn"); await H.sleep(1800);
    p = await page(computer);
    check(p.playing && p.target === "20" && /Warm-up/.test(await computer.$eval("#playHead", (e) => e.textContent)), "Warm up first starts the warm-up");
    await clockAt(1 * 60000 + 1000);
    await station.send(H.dart("S20", H.spot(20, "S").x, H.spot(20, "S").y)); await H.sleep(1300);
    await station.send({ type: "takeout", darts: 1 }); await H.sleep(2000);
    p = await page(computer);
    check(p.result && p.after === "On to Big Triples", "when it's done: " + p.after);
    await computer.click("#afterWarmBtn"); await H.sleep(1500);
    p = await page(computer);
    check(p.head === "Big Triples" && !p.playing && !p.result, "On to Big Triples: its card, ready to start");

    // ---- Score More, on your own: strikes 2 ------------------------------------------------------------------
    await computer.click("[data-drill='scoremore']"); await H.sleep(600);
    await computer.fill("#set_strikes", "2");
    await computer.$eval("#set_strikes", (e) => e.dispatchEvent(new Event("change")));
    await H.sleep(300);
    await computer.click("#startBtn"); await H.sleep(1500);
    p = await page(computer);
    check(p.playing && p.target === "Score" && p.hero === "First visit: set the mark" && p.pad.join(",") === "T20,S20,S5,Miss", `Score More starts: ${p.hero} ${p.target}; pad ${p.pad.join(",")}`);
    await hand(["p2", "p2", "p3"]); // 45: the mark
    p = await page(computer); b = await boardView();
    check(p.target === "45" && p.hero === "Beat" && b.target === "45", `the mark: beat ${p.target}`);
    heard = await said();
    check(heard[heard.length - 1] === "45. The mark. Beat 45.", "the voice: " + heard[heard.length - 1]);
    await takeout(); // the darts entered by hand come out of the board
    await throwAt(20, "T", "T20"); await throwAt(20, "T", "T20"); await throwAt(5, "S", "S5", 1800); // 125 with the cameras: run 1
    await takeout();
    p = await page(computer);
    check(p.score === "1" && p.target === "125", `125 beats 45: a run of 1, now beat 125 (${p.score}, ${p.target})`);
    await hand(["p1", "pm", "pm"]); // 60: strike 1
    await other("S1"); await hand(["pm", "pm"]); // 1: strike 2, over
    p = await page(computer);
    check(p.result && p.resultBig === "1" && /Longest run 1/.test(p.resultSub) && p.newBest, `two strikes: done, longest run 1, a new best: ${p.resultBig} ${p.resultSub}`);
    docs = await saved();
    check(docs.some((d) => d.drill === "scoremore" && d.key === 1 && d.result.visits === 4), "saved with its longest run");
    await computer.click("#doneBtn"); await H.sleep(1200);

    // ---- Score More, two players: a new player, strikes 1 ------------------------------------------------------
    await computer.click("[data-drill='scoremore2']"); await H.sleep(800);
    check(!(await computer.$eval("#oppBox", (e) => e.hidden)) && await computer.$eval("#oppPick", (e) => e.value) === "new", "the other player: someone new (no saved players yet)");
    check(await computer.$eval("#startBtn", (e) => e.disabled), "no start without their email");
    await computer.fill("#oppName", "Sam"); await computer.fill("#oppEmail", "sam@example.com"); await H.sleep(300);
    check(!(await computer.$eval("#startBtn", (e) => e.disabled)) && /Sam is kept with your players/.test(await computer.$eval("#oppHint", (e) => e.textContent)), "typed in: Sam is kept with your players");
    await computer.fill("#set_strikes", "1");
    await computer.$eval("#set_strikes", (e) => e.dispatchEvent(new Event("change")));
    await H.sleep(300);
    await computer.click("#startBtn"); await H.sleep(1800);
    const sp = await station.read("savedPlayers", uid);
    check(sp && Object.values(sp.players || {}).some((x) => x.email === "sam@example.com" && x.name === "Sam"), "Sam is in your saved players");
    p = await page(computer);
    check(p.playing && p.hero === "You: throw", "you first: " + p.hero + " (" + await computer.$eval("#camNote", (e) => e.textContent) + ")");
    await hand(["p1", "p2", "p3"]); // you 85
    p = await page(computer);
    check(p.hero === "Sam: throw", "then Sam: " + p.hero);
    await hand(["p2", "p2"]); await other("S1"); // Sam 41: lower, must beat 41
    await hand(["p2", "pm", "pm"]); // you 20
    p = await page(computer); b = await boardView();
    check(p.hero === "Sam: beat" && p.target === "41" && b.target === "41", `Sam must beat his 41: ${p.hero} ${p.target}`);
    await hand(["p2", "p2"]); await other("S1"); // Sam 41 again: strike 1, out
    p = await page(computer);
    check(p.result && p.resultBig === "Won" && /You won after 2 rounds/.test(p.resultSub), `Sam strikes out: ${p.resultBig}, ${p.resultSub}`);
    heard = await said();
    check(heard[heard.length - 1] === "41. Strike 1 for Sam. You win.", "the voice: " + heard[heard.length - 1]);
    docs = await saved();
    const two = docs.find((d) => d.drill === "scoremore2");
    check(two && two.opponent && two.opponent.email === "sam@example.com" && two.opponent.name === "Sam" && two.result.winner === 0, "saved with the other player's name and email");
    const hist = await computer.$$eval("#historyBody tr", (rows) => rows.map((r) => r.textContent));
    check(hist.length >= 1 && /Won/.test(hist[0]) && /Sam/.test(hist[0]) && !/sam@example\.com/.test(hist.join(" ")), "the history: the result and Sam's name, not the address: " + hist[0]);
    // Play again keeps Sam.
    await computer.click("#againBtn"); await H.sleep(1800);
    st = await state();
    check(st.activeSession.meta.opponent && st.activeSession.meta.opponent.email === "sam@example.com", "Play again: Sam again");

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
