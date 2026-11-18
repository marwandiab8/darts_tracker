// Your players (practice.html, "Another player"; public/players.js): the people you play against are
// kept with your account, so each is typed once and chosen with a tap on any device. Added with Save
// player or by starting a game with them, changed, removed, renamed during a game, and a list that
// starts with the people already in your record.
const H = require("./harness.cjs");
const P = require("../../public/players.js");
const { doc, setDoc } = require("firebase/firestore");
const { check, failed } = H.checker();

(async () => {
  const server = await H.startServer();
  const browser = await H.launch();
  let station = null;
  try {
    const base = { kind: "x01", startScore: 201, doubleOut: true, rank: "club", first: "player", entry: "board", confirm: false, camera: false, mute: true, opponent: "bot" };
    const open = async (name, viewport) => {
      const page = await H.device(browser, name, { viewport, storage: { dt_practice_settings: JSON.stringify(base) } });
      page.promptAnswer = "";
      page.on("dialog", (d) => (d.type() === "prompt" ? d.accept(page.promptAnswer) : d.accept()));
      await page.goto(`http://127.0.0.1:${H.PORT}/practice.html`);
      return page;
    };
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await H.sleep(150); } return v; };
    const ready = async (page) => {
      await page.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
      await page.waitForSelector("#startBtn", { state: "visible", timeout: 15000 });
    };
    // What the box under "Another player" shows.
    const view = (page) => page.evaluate(() => {
      const shown = (id) => { const e = document.getElementById(id); return !!e && !e.classList.contains("hidden") && e.offsetParent !== null; };
      const text = (id) => document.getElementById(id).textContent.trim();
      return {
        chips: shown("playerPick") ? [...document.querySelectorAll("#playerChips button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")) : null,
        card: shown("playerCard") ? [text("playerCardName"), text("playerCardEmail"), text("playerCardRecord")] : null,
        form: shown("playerForm") ? [document.getElementById("oppName").value, document.getElementById("oppEmail").value] : null,
        save: shown("playerSaveBtn") ? text("playerSaveBtn") + (document.getElementById("playerSaveBtn").disabled ? " (off)" : "") : null,
        cancel: shown("playerCancelBtn"),
        hint: text("oppHint"), start: !document.getElementById("startBtn").disabled,
      };
    });
    const chip = (page, name) => page.click(`#playerChips button:text-is("${name}")`);
    const settled = (page, fn, ms) => until(async () => { const v = await view(page); return fn(v) ? v : null; }, ms).then((v) => v || view(page));

    const phone = await open("phone", { width: 420, height: 900 });
    const uid = await H.signIn(phone);
    station = await H.makeStation(uid);
    await station.clear();
    await phone.reload();
    await ready(phone);
    const saved = async () => P.listOf(await station.read("savedPlayers", uid));
    const liveGame = async () => { const d = await station.read("liveGames", uid); return d && d.state ? JSON.parse(d.state) : null; };

    // ---- nobody saved yet: the two boxes, as before -------------------------------------------------
    await phone.click('input[name="opp"][value="human"] + span');
    let v = await settled(phone, (x) => x.save !== null);
    check(v.chips === null && v.card === null && v.form && v.form.join("|") === "|", "nobody saved yet: just the two boxes: " + JSON.stringify(v));
    check(!v.start && v.save === "Save player (off)" && !v.cancel && /Type their email address/.test(v.hint), "nothing to start or save until an address is typed: " + v.save + " / " + v.hint);
    await phone.fill("#oppName", "Sam");
    await phone.fill("#oppEmail", "sam@example.com");
    v = await view(phone);
    check(v.start && v.save === "Save player" && /emailed to you \(tester@example\.com\) and to sam@example\.com\. They are kept in your players/.test(v.hint), "an address typed: the game can start, and it says they'll be kept: " + v.hint);

    // ---- Save player -------------------------------------------------------------------------------
    await phone.click("#playerSaveBtn");
    v = await settled(phone, (x) => x.chips);
    check(v.chips && v.chips.join(",") === "Sam*,+ New player", "saved: a button for Sam, chosen: " + JSON.stringify(v.chips));
    check(v.card && v.card.join("|") === "Sam|sam@example.com|No games together yet." && v.form === null && v.start, "their card in place of the boxes: " + JSON.stringify(v.card));
    check(/and to sam@example\.com\.$/.test(v.hint), "who the result is emailed to: " + v.hint);
    let list = await until(async () => { const l = await saved(); return l.length === 1 ? l : null; }) || await saved();
    check(list.length === 1 && list[0].name === "Sam" && list[0].email === "sam@example.com" && list[0].id === P.idOf("sam@example.com") && list[0].addedAt > 0 && list[0].usedAt === 0,
      "kept with the account: " + JSON.stringify(list));

    // ---- a second one: New player, Cancel, then only an address and Enter ---------------------------
    await chip(phone, "+ New player");
    v = await view(phone);
    check(v.chips.join(",") === "Sam,+ New player*" && v.form && v.form.join("|") === "|" && !v.start && v.cancel && v.card === null, "New player: empty boxes, Cancel beside Save: " + JSON.stringify(v));
    await phone.click("#playerCancelBtn");
    v = await view(phone);
    check(v.chips.join(",") === "Sam*,+ New player" && v.form === null && v.start, "Cancel: back to Sam: " + JSON.stringify(v.chips));
    await chip(phone, "+ New player");
    await phone.fill("#oppEmail", "ashtrower@example.com");
    await phone.press("#oppEmail", "Enter");
    v = await settled(phone, (x) => x.chips && x.chips.length === 3);
    check(v.chips.join(",") === "Ashtrower*,Sam,+ New player" && v.card && v.card[0] === "Ashtrower", "Enter saves; no name typed, so one from the address; the newest first: " + JSON.stringify(v.chips));

    // ---- the same players on another device, with nothing typed --------------------------------------
    const tablet = await open("tablet", { width: 1100, height: 800 });
    await H.signIn(tablet);
    await ready(tablet);
    await tablet.click('input[name="opp"][value="human"] + span');
    let t = await settled(tablet, (x) => x.chips && x.chips.length === 3);
    check(t.chips && t.chips.join(",") === "Ashtrower,Sam,+ New player" && t.form === null && t.card === null, "another device has them, none chosen yet: " + JSON.stringify(t.chips));
    check(!t.start && /Choose who you're playing/.test(t.hint), "it asks who: " + t.hint);
    await chip(tablet, "Sam");
    t = await view(tablet);
    check(t.chips.join(",") === "Ashtrower,Sam*,+ New player" && t.card && t.card[1] === "sam@example.com" && t.start, "one tap and the game can start: " + JSON.stringify(t.card));
    check(await tablet.evaluate(() => { const s = JSON.parse(localStorage.getItem("dt_practice_settings")); return s.oppName + "|" + s.oppEmail; }) === "Sam|sam@example.com", "the game is set up with their name and address");

    // ---- changing a player ---------------------------------------------------------------------------
    await phone.click("#playerEditBtn");
    v = await view(phone);
    check(v.form && v.form.join("|") === "Ashtrower|ashtrower@example.com" && v.save === "Save changes" && v.chips.join(",") === "Ashtrower*,Sam,+ New player", "Edit: the boxes with what is saved: " + JSON.stringify(v.form));
    await phone.fill("#oppEmail", "sam@example.com");
    v = await view(phone);
    check(/already saved for Sam/.test(v.hint) && v.save === "Save changes (off)" && !v.start, "an address someone else has is refused: " + v.hint);
    await phone.fill("#oppName", "Ash");
    await phone.fill("#oppEmail", "ash@example.com");
    await phone.click("#playerSaveBtn");
    v = await settled(phone, (x) => x.chips && x.chips[0] === "Ash*");
    check(v.chips.join(",") === "Ash*,Sam,+ New player" && v.card && v.card.slice(0, 2).join("|") === "Ash|ash@example.com", "changed: " + JSON.stringify(v.chips) + " " + JSON.stringify(v.card));
    list = await until(async () => { const l = await saved(); return l.some((p) => p.email === "ash@example.com") && l.length === 2 ? l : null; }) || await saved();
    check(list.length === 2 && list.map((p) => p.id).sort().join() === [P.idOf("ash@example.com"), P.idOf("sam@example.com")].sort().join(), "one player still, under the new address: " + JSON.stringify(list.map((p) => p.email)));
    t = await settled(tablet, (x) => x.chips && x.chips[0] === "Ash");
    check(t.chips.join(",") === "Ash,Sam*,+ New player", "and the other device shows the change by itself: " + JSON.stringify(t.chips));

    // ---- a game with a chosen player: who it is played with, and they move to the front --------------
    await tablet.close();
    await chip(phone, "Sam");
    await phone.click("#startBtn");
    let st = await until(async () => { const g = await liveGame(); return g && g.game && g.match && g.match.human ? g : null; }, 10000);
    check(st && st.match.names.bot === "Sam" && st.match.opponentEmail === "sam@example.com" && st.match.names.player === "Tester", "the game is against Sam: " + JSON.stringify(st && st.match));
    list = await until(async () => { const l = await saved(); return l[0] && l[0].name === "Sam" && l[0].usedAt > 0 ? l : null; }) || await saved();
    check(list[0].name === "Sam" && list[0].usedAt > 0 && list.length === 2, "the player just played comes first: " + JSON.stringify(list.map((p) => p.name)));

    // ---- a name changed during the game is their name from then on -----------------------------------
    phone.promptAnswer = "Samuel";
    await phone.evaluate(() => document.querySelector(".side.bot .name-btn").click());
    list = await until(async () => { const l = await saved(); return l.some((p) => p.name === "Samuel") ? l : null; }) || await saved();
    check(list.length === 2 && list[0].name === "Samuel" && list[0].email === "sam@example.com", "Edit name in the game renames the saved player: " + JSON.stringify(list.map((p) => p.name)));
    await phone.click("#quitBtn"); // nothing thrown: back to the setup, nothing saved
    v = await settled(phone, (x) => x.chips && x.chips[0] === "Samuel*");
    check(v.chips.join(",") === "Samuel*,Ash,+ New player" && v.card && v.card[0] === "Samuel", "back at the setup: " + JSON.stringify(v.chips));

    // ---- removing a player -------------------------------------------------------------------------
    await chip(phone, "Ash");
    await phone.click("#playerRemoveBtn"); // the question is answered yes
    v = await settled(phone, (x) => x.chips && x.chips.length === 2);
    check(v.chips.join(",") === "Samuel,+ New player" && v.card === null && v.form === null && !v.start && /Choose who you're playing/.test(v.hint), "removed, and nobody chosen: " + JSON.stringify(v));
    list = await until(async () => { const l = await saved(); return l.length === 1 ? l : null; }) || await saved();
    check(list.length === 1 && list[0].name === "Samuel", "gone from the account too: " + JSON.stringify(list.map((p) => p.name)));

    // ---- a new player typed and played straight away is kept without Save ----------------------------
    await chip(phone, "+ New player");
    await phone.fill("#oppName", "Dee");
    await phone.fill("#oppEmail", "Dee@Example.com");
    v = await view(phone);
    check(v.start && /kept in your players/.test(v.hint), "a new player can start a game at once: " + v.hint);
    await phone.click("#startBtn");
    st = await until(async () => { const g = await liveGame(); return g && g.game && g.match && g.match.names.bot === "Dee" ? g : null; }, 10000);
    check(st && st.match.opponentEmail === "Dee@Example.com", "the game is against Dee: " + JSON.stringify(st && st.match));
    list = await until(async () => { const l = await saved(); return l.length === 2 ? l : null; }) || await saved();
    check(list.length === 2 && list[0].name === "Dee" && list[0].email === "Dee@Example.com" && list[0].usedAt > 0, "and Dee is kept: " + JSON.stringify(list.map((p) => p.name + " " + p.email)));
    await phone.click("#quitBtn");
    v = await settled(phone, (x) => x.chips && x.chips[0] === "Dee*");
    check(v.chips.join(",") === "Dee*,Samuel,+ New player" && v.form === null, "chosen on the setup afterwards: " + JSON.stringify(v.chips));
    // The same address typed again, in other capitals: the same player, not a second one.
    await chip(phone, "+ New player");
    await phone.fill("#oppEmail", "dee@example.com");
    await phone.click("#playerSaveBtn");
    v = await settled(phone, (x) => x.chips && x.form === null);
    check(v.chips.join(",") === "Dee*,Samuel,+ New player" && v.card && v.card[0] === "Dee", "an address already there is that player, name kept: " + JSON.stringify(v.chips));
    check(phone.errors.length === 0, "no page errors: " + phone.errors.join(" | "));

    // ---- no saved list yet: it starts with the people in your record ---------------------------------
    await station.clear();
    const versus = (id, name, email, timestamp, result) => station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "versusGames", id), {
      uid, timestamp, kind: "x01", startScore: 501, doubleOut: true, first: "player", result, playerName: "Tester", playerEmail: "tester@example.com", opponentName: name, opponentEmail: email, playerDarts: [], opponentDarts: [] }));
    await versus("v1", "Ashley", "ashtrower@example.com", "2026-10-12 18:17", "won");
    await versus("v2", "Ashtrower", "ashtrower@example.com", "2026-11-14 23:16", "lost");
    await versus("v3", "Ashtrower", "ashtrower@example.com", "2026-11-14 23:25", "abandoned");
    await versus("v4", "Davidw", "davidw@example.com", "2026-11-16 17:38", "won");
    await phone.evaluate(() => localStorage.removeItem("dt_practice_settings"));
    await phone.reload();
    await ready(phone);
    await phone.click('input[name="opp"][value="human"] + span');
    v = await settled(phone, (x) => x.chips && x.chips.length === 3, 15000);
    check(v.chips && v.chips.join(",") === "Davidw,Ashley,+ New player" && v.form === null && !v.start, "the people already played, the latest first, under the name typed for them: " + JSON.stringify(v.chips));
    list = await until(async () => { const l = await saved(); return l.length === 2 ? l : null; }) || await saved();
    check(list.length === 2 && list[1].email === "ashtrower@example.com" && list[1].name === "Ashley", "saved as the account's list: " + JSON.stringify(list.map((p) => p.name)));
    await chip(phone, "Ashley");
    v = await view(phone);
    check(v.card && /^2 games played: you won 1, Ashley won 1\. Last played Nov 14/.test(v.card[2]), "their card has your games against them: " + (v.card && v.card[2]));
    // Removed, they stay removed: the list is only started once.
    await phone.click("#playerRemoveBtn");
    await settled(phone, (x) => x.chips && x.chips.length === 2);
    await until(async () => (await saved()).length === 1);
    await phone.reload();
    await ready(phone);
    v = await settled(phone, (x) => x.chips && x.chips.length >= 2, 15000);
    await H.sleep(1500);
    v = await view(phone);
    check(v.chips && v.chips.join(",") === "Davidw,+ New player", "a removed player doesn't come back from the record: " + JSON.stringify(v.chips));

    // ---- a full list: the game is still played, the player just isn't kept ----------------------------
    const many = {};
    for (let i = 0; i < P.MAX; i += 1) many["full" + i] = { name: "Player " + (i + 1), email: "player" + (i + 1) + "@example.com", addedAt: 1000 + i, usedAt: 0 };
    await station.env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "savedPlayers", uid), { uid, updatedAt: Date.now(), players: many }));
    v = await settled(phone, (x) => x.chips && x.chips.length === P.MAX + 1, 15000);
    await chip(phone, "+ New player");
    await phone.fill("#oppEmail", "onemore@example.com");
    v = await view(phone);
    check(v.chips.length === P.MAX + 1 && v.start && v.save === "Save player (off)" && /list is full \(50\), so they are not kept/.test(v.hint), "a full list says so, and the game can still start: " + v.hint);
    await phone.fill("#oppEmail", "player7@example.com");
    v = await view(phone);
    check(v.save === "Save player" && !/full/.test(v.hint), "someone already on it is fine: " + v.hint);
    await phone.click("#playerCancelBtn");
    check(phone.errors.length === 0, "no page errors: " + phone.errors.join(" | "));
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
