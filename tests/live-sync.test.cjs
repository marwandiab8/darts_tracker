// live-sync.js: devices sharing one game document, with the security rules' check that a new
// version is made from the latest one (firestore.rules, liveGames).
const assert = require("node:assert/strict");
const test = require("node:test");
const { createLiveDoc } = require("../public/live-sync.js");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

// A Firestore server holding one document, and clients that behave as the web SDK does: a write
// shows straight away (hasPendingWrites), goes to the server in order, and is undone if the server
// refuses it; the server's changes reach each client after its latency. Listeners hear about
// changes to what they see, not about writes merely being confirmed.
function makeServer() {
  const server = { doc: null, clients: [], refused: 0 };
  server.commit = (data) => {
    const cur = server.doc;
    if (cur && data.parent !== cur.vid && data.parent !== "") { server.refused += 1; return false; }
    server.doc = clone(data);
    for (const c of server.clients) c.push(server.doc);
    return true;
  };
  server.client = (latency) => {
    const client = { known: server.doc, pending: [], listeners: new Set(), lastShown: undefined, sending: false };
    const view = () => (client.pending.length ? client.pending[client.pending.length - 1].data : client.known);
    const tell = () => {
      const data = view(), text = JSON.stringify(data);
      if (text === client.lastShown) return;
      client.lastShown = text;
      const snap = { exists: !!data, data: () => clone(data), metadata: { hasPendingWrites: client.pending.length > 0, fromCache: false } };
      for (const fn of client.listeners) fn(snap);
    };
    client.push = (doc) => setTimeout(() => { client.known = doc; tell(); }, latency / 2);
    const send = async () => {
      if (client.sending) return;
      client.sending = true;
      while (client.pending.length) {
        const w = client.pending[0];
        await sleep(latency / 2);
        const ok = server.commit(w.data);
        await sleep(latency / 2);
        client.pending.shift();
        if (ok) { client.known = clone(w.data); w.resolve(); } else w.reject(Object.assign(new Error("Missing or insufficient permissions."), { code: "permission-denied" }));
        tell();
      }
      client.sending = false;
    };
    client.ref = {
      set(data) {
        return new Promise((resolve, reject) => {
          client.pending.push({ data: clone(data), resolve, reject });
          tell();
          send();
        });
      },
      onSnapshot(next) {
        client.listeners.add(next);
        setTimeout(() => { client.lastShown = JSON.stringify(view()); const data = view(); next({ exists: !!data, data: () => clone(data), metadata: { hasPendingWrites: client.pending.length > 0, fromCache: false } }); }, latency / 2);
        return () => client.listeners.delete(next);
      },
    };
    server.clients.push(client);
    return client;
  };
  return server;
}

// A page keeping a list of darts the cameras saw, as practice.html does with camera events: a dart is
// put in only if it is newer than the last one in the game (camSeq), and darts this page put in that
// didn't get in (its version was refused) are put in again on top of the version that did.
function cameraPage(client) {
  const page = { state: null, pending: [], remote: 0 };
  page.live = createLiveDoc({
    ref: client.ref, uid: "u",
    onRemote(v) {
      page.remote += 1;
      page.state = v && v.state ? clone(v.state) : { darts: [], camSeq: 0 };
      const redo = page.pending.filter((seq) => seq > page.state.camSeq);
      page.pending = [];
      redo.forEach((seq) => page.see(seq));
    },
    onSaved(v) { page.pending = page.pending.filter((seq) => seq > v.cam); },
  });
  page.see = (seq) => {
    if (!page.state || seq <= page.state.camSeq) return;
    page.state.darts.push(seq);
    page.state.camSeq = seq;
    page.pending.push(seq);
    page.live.write("play", clone(page.state));
  };
  return page;
}

test("a change on one device shows on the other", async () => {
  const server = makeServer();
  const a = server.client(20), b = server.client(30);
  const seenB = [];
  const liveA = createLiveDoc({ ref: a.ref, uid: "u" });
  const liveB = createLiveDoc({ ref: b.ref, uid: "u", onRemote: (v) => seenB.push(v && v.state) });
  liveA.start(); liveB.start();
  await sleep(40);
  assert.deepEqual(seenB, [null], "nothing there yet");
  const first = liveA.write("play", { score: 501 }, { fresh: true });
  await sleep(80);
  assert.deepEqual(seenB.slice(-1)[0], { score: 501 });
  // B changes it; A follows.
  const seenA = [];
  const liveA2 = createLiveDoc({ ref: a.ref, uid: "u", onRemote: (v) => seenA.push(v && v.state) });
  liveA2.start();
  await sleep(40);
  liveB.write("play", { score: 441 });
  await sleep(100);
  assert.deepEqual(seenA.slice(-1)[0], { score: 441 });
  assert.equal(server.doc.parent, first.vid, "B's version is made from A's");
  assert.equal(liveA.latest.vid, server.doc.vid, "and A has B's version now");
});

test("two devices changing it at once: one gets in, the other takes that one", async () => {
  const server = makeServer();
  const a = server.client(20), b = server.client(20);
  const got = { a: [], b: [] }, refused = { a: 0, b: 0 };
  const liveA = createLiveDoc({ ref: a.ref, uid: "u", onRemote: (v) => got.a.push(v && v.state), onRefused: () => { refused.a += 1; } });
  const liveB = createLiveDoc({ ref: b.ref, uid: "u", onRemote: (v) => got.b.push(v && v.state), onRefused: () => { refused.b += 1; } });
  liveA.start(); liveB.start();
  await sleep(30);
  liveA.write("play", { n: 0 }, { fresh: true });
  await sleep(60);
  // Both from version n:0, at the same moment.
  liveA.write("play", { n: 1, by: "a" });
  liveB.write("play", { n: 1, by: "b" });
  await sleep(120);
  assert.equal(refused.a + refused.b, 1, "exactly one is refused");
  const winner = server.doc;
  assert.equal(liveA.latest.vid, winner.vid);
  assert.equal(liveB.latest.vid, winner.vid);
  const loser = refused.a ? got.a : got.b;
  assert.deepEqual(loser.slice(-1)[0], JSON.parse(winner.state), "the refused device took the version that got in");
});

test("a version made from a refused one is refused too", async () => {
  const server = makeServer();
  const a = server.client(10), b = server.client(60);
  const liveA = createLiveDoc({ ref: a.ref, uid: "u" });
  const liveB = createLiveDoc({ ref: b.ref, uid: "u" });
  liveA.start(); liveB.start();
  await sleep(50);
  liveA.write("play", { n: 0 }, { fresh: true });
  await sleep(100);
  liveA.write("play", { n: 1 });         // gets in first (A is quicker)
  liveB.write("play", { n: 1, b: true }); // refused
  liveB.write("play", { n: 2, b: true }); // made from B's refused version: refused as well
  await sleep(250);
  assert.equal(server.refused, 2);
  assert.deepEqual(JSON.parse(server.doc.state), { n: 1 });
  assert.equal(liveB.latest.vid, server.doc.vid);
});

test("a new game replaces whatever was there", async () => {
  const server = makeServer();
  const a = server.client(10), b = server.client(10);
  const liveA = createLiveDoc({ ref: a.ref, uid: "u" }), liveB = createLiveDoc({ ref: b.ref, uid: "u" });
  liveA.start(); liveB.start();
  await sleep(20);
  liveA.write("play", { game: 1 }, { fresh: true });
  await sleep(40);
  liveA.write("play", { game: 1, darts: 1 });
  liveB.write("play", { game: 2 }, { fresh: true }); // without seeing A's last change
  await sleep(80);
  assert.deepEqual(JSON.parse(server.doc.state), { game: 2 });
  assert.equal(server.doc.rev, 1);
});

test("both devices see every camera dart: each goes in once", async () => {
  for (const [la, lb] of [[20, 20], [10, 70], [70, 10], [5, 150]]) {
    const server = makeServer();
    const a = cameraPage(server.client(la)), b = cameraPage(server.client(lb));
    a.live.start(); b.live.start();
    await sleep(Math.max(la, lb));
    a.live.write("play", { darts: [], camSeq: 0 }, { fresh: true });
    await sleep(Math.max(la, lb) * 2);
    // The station's darts reach each device at slightly different times.
    for (let seq = 1; seq <= 12; seq += 1) {
      setTimeout(() => a.see(seq), Math.random() * 15);
      setTimeout(() => b.see(seq), Math.random() * 15);
      await sleep(seq % 3 ? 25 : 90);
    }
    await sleep(Math.max(la, lb) * 8);
    const final = JSON.parse(server.doc.state);
    assert.deepEqual(final.darts, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `latencies ${la}/${lb}: every dart once, in order`);
    assert.deepEqual(a.state.darts, final.darts, "the first device shows it");
    assert.deepEqual(b.state.darts, final.darts, "the second device shows it");
  }
});

test("a dart is not lost when another device changes something else at the same moment", async () => {
  const server = makeServer();
  const camera = cameraPage(server.client(40));
  const other = server.client(5);
  const tapper = createLiveDoc({ ref: other.ref, uid: "u" });
  camera.live.start(); tapper.start();
  await sleep(40);
  camera.live.write("play", { darts: [], camSeq: 0 }, { fresh: true });
  await sleep(100);
  // The other device (no camera) pauses the timer just as the camera's dart goes in.
  camera.see(1);
  tapper.write("play", Object.assign(clone(JSON.parse(server.doc.state)), { paused: true }));
  await sleep(400);
  const final = JSON.parse(server.doc.state);
  assert.deepEqual(final.darts, [1], "the dart was put in again on top of the other change");
  assert.equal(final.paused, true, "and the other change stays");
});

test("too big to keep: not written", () => {
  const server = makeServer();
  const live = createLiveDoc({ ref: server.client(10).ref, uid: "u" });
  assert.equal(live.write("play", { text: "x".repeat(950000) }), null);
});
