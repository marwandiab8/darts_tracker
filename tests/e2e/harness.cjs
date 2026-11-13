// Browser tests: real pages and the real Firebase SDK in headless Chrome, against the local Firestore
// and Auth emulators (never production: those hosts are blocked), plus a pretend camera station that
// sends darts the way station.html does. Several "devices" (browser contexts) can share one account.
//
//   npm run test:e2e                (every *.e2e.cjs here)
//   npm run test:e2e -- doubles     (the ones whose name has "doubles")
//
// Chrome: /usr/bin/google-chrome, or CHROME=/path/to/chrome.
const { chromium } = require("playwright-core");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, collection, getDocs } = require("firebase/firestore");

const REPO = path.resolve(__dirname, "..", "..");
const PORT = 8124, PROJECT = "demo-darts";
const CHROME = process.env.CHROME || "/usr/bin/google-chrome";

// Points the page's Firebase at the emulators the moment the page initializes it.
const hook = `(() => {
  let fb;
  Object.defineProperty(window, "firebase", {
    configurable: true,
    get() { return fb; },
    set(v) {
      fb = v;
      if (v && v.initializeApp && !v.__hooked) {
        v.__hooked = true;
        const orig = v.initializeApp.bind(v);
        v.initializeApp = (config, name) => {
          const app = orig(Object.assign({}, config, { projectId: "${PROJECT}", authDomain: "127.0.0.1" }), name);
          v.firestore().useEmulator("127.0.0.1", 8080);
          v.auth().useEmulator("http://127.0.0.1:9099", { disableWarnings: true });
          window.__emulated = true;
          return app;
        };
      }
    },
  });
})();`;

// Records what the page says out loud (and lets it think it was heard), and the screen wake lock.
const voiceAndWake = `(() => {
  window.__said = [];
  window.__wake = 0;
  const synth = { paused: false, speaking: false, resume() {}, cancel() {}, getVoices() { return []; },
    speak(u) { if (u.text && u.text.trim()) window.__said.push(u.text); setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, 0); } };
  Object.defineProperty(window, "speechSynthesis", { configurable: true, get() { return synth; } });
  window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  try {
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request() { window.__wake += 1; const l = new EventTarget(); l.release = () => Promise.resolve(); return Promise.resolve(l); } } });
  } catch (_) {}
})();`;

async function startServer() {
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", path.join(REPO, "public")], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 700));
  return server;
}

const launch = () => chromium.launch({ executablePath: CHROME, headless: true });

async function device(browser, name, { viewport, storage } = {}) {
  const context = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  await context.route(/^https:\/\/(firestore|identitytoolkit|securetoken|firebaseinstallations)\.googleapis\.com\//, (r) => r.abort());
  await context.addInitScript(hook);
  await context.addInitScript(voiceAndWake);
  if (storage) await context.addInitScript((st) => { try { if (!sessionStorage.getItem("seeded")) { for (const [k, v] of Object.entries(st)) localStorage.setItem(k, v); sessionStorage.setItem("seeded", "1"); } } catch (_) {} }, storage);
  const page = await context.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(name + ": " + String(e)));
  // Two devices writing the same round at once: Firestore refuses one transaction's commit (400) and
  // the SDK runs it again. That's how transactions work, not an error; any other 400 is.
  page.on("console", (m) => { if (m.type() === "error" && !/404|Missing or insufficient permissions|favicon|status of 400/.test(m.text())) page.errors.push(name + ": " + m.text()); });
  page.on("response", (r) => { if (r.status() === 400 && !/documents:commit/.test(r.url())) page.errors.push(name + ": 400 from " + r.url().slice(0, 140)); });
  page.devName = name;
  return page;
}

// Signs the page in through the Auth emulator (a pretend Google account, the same on every device).
async function signIn(page) {
  await page.waitForFunction(() => window.firebase && window.__emulated, null, { timeout: 15000 });
  return page.evaluate(async () => {
    const cred = firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: "darts-tester", email: "tester@example.com", email_verified: true, name: "Tester" }));
    const res = await firebase.auth().signInWithCredential(cred);
    return res.user.uid;
  });
}

// A camera station for the account, as station.html leaves it: calibrated cameras, seen just now.
async function makeStation(uid) {
  const rules = fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8");
  const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: 8080, rules } });
  const account = JSON.parse(fs.readFileSync(path.join(__dirname, "station-account.json"), "utf8"));
  let seq = Date.now(), events = [];
  const admin = (fn) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore()));
  const beat = () => admin((db) => setDoc(doc(db, "cameraStations", uid), { uid, setup: account.setup, station: { name: "Test station", seen: Date.now(), running: true, status: "Watching", devices: [], frame: [1280, 720] } }));
  await beat();
  await admin((db) => setDoc(doc(db, "cameraStations", uid, "events", "latest"), { seq, events: [], updated: Date.now() }));
  const timer = setInterval(() => beat().catch(() => {}), 15000);
  // The test's own reads, again if the emulator was too busy to answer.
  const retry = async (fn) => { for (let k = 0; ; k += 1) { try { return await fn(); } catch (error) { if (k >= 6) throw error; await new Promise((r) => setTimeout(r, 1500)); } } };
  return {
    env,
    async send(e) {
      seq = Math.max(seq + 1, Date.now());
      events = events.concat([Object.assign({ seq, at: Date.now() }, e)]).slice(-20);
      await admin((db) => setDoc(doc(db, "cameraStations", uid, "events", "latest"), { seq, events, updated: Date.now() }));
      return seq;
    },
    async read(name, id) { return retry(async () => { let out = null; await admin(async (db) => { const s = await getDoc(doc(db, name, id)); out = s.exists() ? s.data() : null; }); return out; }); },
    async list(name) { return retry(async () => { let out = []; await admin(async (db) => { const q = await getDocs(collection(db, name)); out = q.docs.map((d) => Object.assign({ id: d.id }, d.data())); }); return out; }); },
    async clear() { await env.clearFirestore(); await beat(); await admin((db) => setDoc(doc(db, "cameraStations", uid, "events", "latest"), { seq, events: [], updated: Date.now() })); events = []; },
    async stop() { clearInterval(timer); await env.cleanup(); },
  };
}

// A dart event as the station sends it, landing at app position (x, y).
function dart(label, x, y) {
  return { type: "dart", index: 0, label, target: label.replace(/^[SDT]/, ""), ring: label[0], points: 0, app: { x, y }, real: { x, y }, uncertain: false, confidence: 0.9, method: "cross", nearWire: false, labels: [label, label] };
}

// Where a dart lands: in a number's single (S), treble (T), double (D), or just outside the wire (O).
const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const RING = { S: 0.4, T: 0.58, D: 0.95, O: 1.06 };
function spot(n, ring) {
  const a = (SEG.indexOf(n) * 18 - 90) * Math.PI / 180;
  return { x: Math.round(Math.cos(a) * RING[ring] * 1000) / 1000, y: Math.round(Math.sin(a) * RING[ring] * 1000) / 1000 };
}

// A tiny test runner: check(ok, what) prints and counts failures.
function checker() {
  let failures = 0;
  const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) failures += 1; return ok; };
  return { check, failed: () => failures, fail: (what) => check(false, what) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { REPO, PORT, PROJECT, startServer, launch, device, signIn, makeStation, dart, spot, checker, sleep };
