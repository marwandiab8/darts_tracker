// Rules and bookkeeping for the Doubles game (doubles.html): finish every double, D1 to D20 and then
// the bull. No DOM or Firebase, so `node --test tests/doubles-engine.test.cjs` checks it and the page
// loads it with a <script> tag. It was the separate "My Doubles Progress" app (mydoublesprogress), and
// the rules and the shapes of the saved data are kept exactly as they were there, so its history
// carries straight over:
//
//   - Each try at a double is a visit of up to 3 darts: hit on dart 1, 2 or 3, or a miss.
//   - A missed double stays open; play moves on to the next open one, and after the bull goes back
//     round to the earliest open double, until all 21 are done.
//   - "Stayed on this double": more than 3 darts at one double (hit on dart 4-15, or missed after
//     6-15). It is stored as the 3-dart visits it really was, the darts past 3 counted as extra.
//   - "Hit a later double": the doubles skipped over are misses (3 darts each), then the hit.
//   - The timer counts active time only (pause for breaks).
//
// The state document holds { activeSession, lifetime, lastUndo }:
//   activeSession = { meta: { startedAtMs, sessionKey }, timer: {...}, flow: { cursorIndex },
//                     doubles: { D1: { attempts, completed, hitDart, completedAt, extraDarts? }, ... },
//                     cam: {...} (the cameras' darts not yet decided, below) }
//   lifetime      = { doubles: { D1: { attempts, hits, hits1, hits2, hits3 }, ... } }
//
// The cameras (board-camera.js) give each dart where it landed. cameraDart() turns darts into the same
// visits the buttons log. Each visit at the board (up to 3 darts, then pull them out) is one try at the
// double you're on, as with the buttons:
//   - a dart in the current double is a hit on that dart of the visit; the visit's other darts don't
//     count (pull them out), and the next visit starts the next double on dart 1;
//   - three darts without one are a miss, and play moves on, as if Miss had been tapped;
//   - after a miss, a dart in that same number (or its double) means you stayed on it: a hit there is
//     logged as "stayed, hit on dart N" (the misses just logged are taken back and redone as the stay),
//     and every 3 more darts there without a hit is another missed visit with 3 extra darts;
//   - a dart anywhere else is a miss at the current double;
//   - darts pulled out before the try was over: the ones the cameras didn't see count as misses there.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DoublesEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const TARGETS = [
    ...Array.from({ length: 20 }, (_, i) => ({ key: `D${i + 1}`, label: `D${i + 1}`, number: String(i + 1) })),
    { key: "DBULL", label: "DBULL", number: "BULL" },
  ];
  const KEYS = TARGETS.map((t) => t.key);
  const MAX_STAY_DARTS = 15;
  const STAY_OUTCOMES = [
    ...Array.from({ length: MAX_STAY_DARTS - 3 }, (_, i) => `hit:${i + 4}`),
    ...Array.from({ length: (MAX_STAY_DARTS - 3) / 3 }, (_, i) => `miss:${(i + 2) * 3}`),
  ];

  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  const indexOf = (key) => KEYS.indexOf(key);

  function defaultDouble() { return { attempts: 0, completed: false, hitDart: null, completedAt: null }; }
  function defaultLifeDouble() { return { attempts: 0, hits: 0, hits1: 0, hits2: 0, hits3: 0 }; }

  function defaultSession(now, sessionKey) {
    const doubles = {};
    for (const t of TARGETS) doubles[t.key] = defaultDouble();
    return {
      meta: { startedAtMs: now, sessionKey: sessionKey || null },
      timer: { isPaused: false, pauseStartedAtMs: null, activeMsAccum: 0, lastResumedAtMs: now },
      flow: { cursorIndex: 0 },
      doubles,
      cam: null,
    };
  }

  function defaultLifetime() {
    const doubles = {};
    for (const t of TARGETS) doubles[t.key] = defaultLifeDouble();
    return { doubles };
  }

  function ensureLifetime(u) {
    if (!u.lifetime) u.lifetime = defaultLifetime();
    if (!u.lifetime.doubles) u.lifetime.doubles = defaultLifetime().doubles;
    for (const t of TARGETS) if (!u.lifetime.doubles[t.key]) u.lifetime.doubles[t.key] = defaultLifeDouble();
    return u;
  }

  function ensureSession(sess, now) {
    if (!sess) return null;
    if (!sess.meta || !sess.meta.startedAtMs) sess.meta = Object.assign({}, sess.meta || {}, { startedAtMs: now || Date.now() });
    if (!sess.timer) sess.timer = { isPaused: false, pauseStartedAtMs: null, activeMsAccum: 0, lastResumedAtMs: sess.meta.startedAtMs };
    if (sess.timer.lastResumedAtMs == null) sess.timer.lastResumedAtMs = sess.meta.startedAtMs;
    if (!sess.flow) sess.flow = { cursorIndex: 0 };
    if (!sess.doubles) sess.doubles = {};
    for (const t of TARGETS) if (!sess.doubles[t.key]) sess.doubles[t.key] = defaultDouble();
    if (sess.cam === undefined) sess.cam = null;
    return sess;
  }

  function earliestUnfinishedIndex(sess) {
    for (let i = 0; i < TARGETS.length; i += 1) if (!(sess.doubles && sess.doubles[KEYS[i]] && sess.doubles[KEYS[i]].completed)) return i;
    return -1;
  }
  function nextIndexFrom(sess, startIdx) {
    for (let i = Math.max(0, startIdx); i < TARGETS.length; i += 1) if (!(sess.doubles && sess.doubles[KEYS[i]] && sess.doubles[KEYS[i]].completed)) return i;
    return -1;
  }
  const isFinished = (sess) => earliestUnfinishedIndex(sess) === -1;
  function currentIndex(sess) { return sess ? nextIndexFrom(sess, (sess.flow && sess.flow.cursorIndex) || 0) : -1; }
  function currentKey(sess) { const i = currentIndex(sess); return i === -1 ? null : KEYS[i]; }

  function computeElapsed(sess, now) {
    if (!sess) return 0;
    const started = (sess.meta && sess.meta.startedAtMs) || now;
    const t = sess.timer || {};
    const base = t.activeMsAccum || 0;
    if (t.isPaused) return base;
    return base + Math.max(0, now - (t.lastResumedAtMs != null ? t.lastResumedAtMs : started));
  }

  function pauseResume(sess, now) {
    if (!sess || isFinished(sess)) return false; // a finished round's timer is frozen
    const t = sess.timer;
    if (t.isPaused) {
      t.isPaused = false;
      t.lastResumedAtMs = now;
      t.pauseStartedAtMs = null;
    } else {
      const last = t.lastResumedAtMs != null ? t.lastResumedAtMs : (sess.meta.startedAtMs || now);
      t.activeMsAccum = (t.activeMsAccum || 0) + Math.max(0, now - last);
      t.isPaused = true;
      t.pauseStartedAtMs = now;
    }
    return true;
  }

  // The order the open doubles will be played from the current one: forward to the bull, then back
  // round to the earliest one still open. Indices into TARGETS.
  function playOrder(sess) {
    const start = currentIndex(sess);
    if (start === -1) return [];
    const open = (i) => !sess.doubles[KEYS[i]].completed;
    const order = [];
    for (let i = start; i < TARGETS.length; i += 1) if (open(i)) order.push(i);
    for (let i = 0; i < start; i += 1) if (open(i)) order.push(i);
    return order;
  }

  // Darts thrown at one double: each missed visit was 3 darts, and the visit that hit took `hitDart`.
  function dartsAt(d) {
    const attempts = (d && d.attempts) || 0;
    if (!attempts) return 0;
    return d.completed ? (attempts - 1) * 3 + (d.hitDart || 3) : attempts * 3;
  }
  const sessionDarts = (doubles) => KEYS.reduce((sum, k) => sum + dartsAt(doubles && doubles[k]), 0);
  const sessionExtra = (doubles) => KEYS.reduce((sum, k) => sum + ((doubles && doubles[k] && doubles[k].extraDarts) || 0), 0);
  const dartsLabel = (n) => `${n} dart${n === 1 ? "" : "s"}`;
  function dartsSummary(doubles) {
    const extra = sessionExtra(doubles);
    const label = dartsLabel(sessionDarts(doubles));
    return extra > 0 ? `${label}, ${extra} extra` : label;
  }

  // After visits land, play moves to the double after the last one, or back round to the earliest
  // open one when nothing is open after it.
  function advanceCursor(sess, lastIdx) {
    sess.flow.cursorIndex = lastIdx + 1;
    if (sess.flow.cursorIndex >= TARGETS.length || nextIndexFrom(sess, sess.flow.cursorIndex) === -1) {
      const e = earliestUnfinishedIndex(sess);
      sess.flow.cursorIndex = e === -1 ? TARGETS.length - 1 : e;
    }
  }

  function freezeIfFinished(sess, now) {
    if (!isFinished(sess)) return false;
    const t = sess.timer;
    if (!t.isPaused) {
      const last = t.lastResumedAtMs != null ? t.lastResumedAtMs : (sess.meta.startedAtMs || now);
      t.activeMsAccum = (t.activeMsAccum || 0) + Math.max(0, now - last);
      t.isPaused = true;
      t.pauseStartedAtMs = now;
    }
    return true;
  }

  // Records visits in play order. Each is at one double: hitDart 1-3 if it went in on that dart, null
  // for a miss; `extra` is darts past the first 3 (a stay). `takeBack` = { key, visits }: first take
  // back that many visits the cameras logged at that double (all misses), which is how a stay on a
  // double just missed is redone as the stay it was. `cam` is the cameras' state to keep.
  // Returns what Undo needs (kept in the state document as lastUndo, so Undo works from any device,
  // including after the cameras logged it): each double touched, as it was before, in the session and
  // in the lifetime totals.
  function applyChange(u, sess, change, now) {
    const sessionBefore = clone(sess);
    const prevCursor = (sess.flow && sess.flow.cursorIndex) || 0;
    const visits = change.visits || [];
    const touched = {};
    const touch = (key) => {
      if (!touched[key]) touched[key] = { prevDouble: clone(sess.doubles[key] || defaultDouble()), prevLife: clone(u.lifetime.doubles[key] || defaultLifeDouble()) };
    };
    if (change.takeBack && change.takeBack.visits > 0) {
      touch(change.takeBack.key);
      takeBackMisses(u, sess, change.takeBack.key, change.takeBack.visits);
    }
    let lastIdx = -1;
    for (const visit of visits) {
      const key = visit.key;
      touch(key);
      lastIdx = indexOf(key);
      const sd = sess.doubles[key] || defaultDouble();
      const ld = u.lifetime.doubles[key] || defaultLifeDouble();
      sd.attempts = (sd.attempts || 0) + 1;
      ld.attempts = (ld.attempts || 0) + 1;
      const d = visit.hitDart;
      if (d) {
        sd.completed = true;
        sd.hitDart = d;
        sd.completedAt = now;
        ld.hits = (ld.hits || 0) + 1;
        ld[`hits${d}`] = (ld[`hits${d}`] || 0) + 1;
      }
      if (visit.extra) sd.extraDarts = (sd.extraDarts || 0) + visit.extra;
      sess.doubles[key] = sd;
      u.lifetime.doubles[key] = ld;
    }
    if (change.cam !== undefined) sess.cam = change.cam;
    if (lastIdx !== -1) advanceCursor(sess, lastIdx);
    const finishingShot = freezeIfFinished(sess, now);
    for (const key of Object.keys(touched)) touched[key].attemptsAfter = sess.doubles[key].attempts || 0;
    return {
      startedAtMs: sess.meta.startedAtMs,
      keys: touched,
      hits: visits.filter((v) => v.hitDart).length,
      finishingShot,
      prevCursor,
      prevCam: withoutVisit(sessionBefore.cam) || null,
      sessionKey: sess.meta.sessionKey || null,
      activeMsAtFinish: sess.timer.activeMsAccum || 0,
      // Only needed to rebuild the session if the finished round was already saved and cleared.
      sessionBefore: finishingShot ? Object.assign(sessionBefore, { cam: withoutVisit(sessionBefore.cam) || null }) : null,
    };
  }
  const applyVisits = (u, sess, visits, now) => applyChange(u, sess, { visits }, now);

  // Takes back an undo record. Works on the state document u; returns an error message when it can't
  // (another session, or those doubles changed since).
  function undo(u, p, now) {
    ensureLifetime(u);
    let sess = u.activeSession ? ensureSession(u.activeSession, now) : null;
    const seqNow = (sess && sess.cam && sess.cam.seq) || 0;
    if (sess) {
      if (sess.meta.startedAtMs !== p.startedAtMs) return "Can't undo: a different session is in progress now.";
      for (const [key, k] of Object.entries(p.keys || {})) {
        if (((sess.doubles[key] && sess.doubles[key].attempts) || 0) !== k.attemptsAfter) return "Can't undo: those doubles have changed since.";
      }
    } else if (p.finishingShot && p.sessionBefore) {
      sess = ensureSession(clone(p.sessionBefore), now); // the finished round was saved and cleared
    } else {
      return "Can't undo: the session has changed.";
    }
    sess.flow.cursorIndex = p.prevCursor;
    // The darts the cameras were holding go back as they were, but darts already passed on stay passed
    // on (a later device must not count them again).
    sess.cam = Object.assign(freshCam(), clone(p.prevCam) || {});
    sess.cam.seq = Math.max(sess.cam.seq || 0, seqNow);
    if (p.finishingShot) {
      // Un-freeze the timer without counting the time spent finished.
      sess.timer = { isPaused: false, pauseStartedAtMs: null, activeMsAccum: p.activeMsAtFinish, lastResumedAtMs: now };
    }
    u.activeSession = sess;
    for (const [key, k] of Object.entries(p.keys || {})) {
      sess.doubles[key] = clone(k.prevDouble);
      u.lifetime.doubles[key] = clone(k.prevLife);
    }
    return null;
  }

  // ---- What the buttons log ----------------------------------------------------------------------
  function planResult(sess, type) { // "hit1" | "hit2" | "hit3" | "miss"
    const key = currentKey(sess);
    if (!key) return null;
    const hitDart = type === "hit1" ? 1 : type === "hit2" ? 2 : type === "hit3" ? 3 : null;
    return { visits: [{ key, hitDart }] };
  }

  // Going in on the Nth dart at one double: whole missed visits first, then the visit that hit.
  function hitVisits(key, dartsToHit) {
    const visits = Array.from({ length: Math.ceil(dartsToHit / 3) - 1 }, () => ({ key, hitDart: null }));
    visits.push(Object.assign({ key, hitDart: ((dartsToHit - 1) % 3) + 1 }, dartsToHit > 3 ? { extra: dartsToHit - 3 } : {}));
    return visits;
  }

  function planLater(sess, targetKey, totalDarts) {
    const order = playOrder(sess);
    const skipped = order.findIndex((i) => KEYS[i] === targetKey);
    if (skipped < 1) return { error: "That double isn't ahead of the current one any more." };
    const dartsToHit = totalDarts - 3 * skipped;
    if (!Number.isInteger(dartsToHit) || dartsToHit < 1 || dartsToHit > MAX_STAY_DARTS) {
      const base = 3 * skipped;
      return { error: `The ${skipped} skipped double${skipped === 1 ? "" : "s"} took ${base} darts, so hitting ${targetKey} needs a total from ${base + 1} to ${base + MAX_STAY_DARTS}.` };
    }
    const visits = order.slice(0, skipped).map((i) => ({ key: KEYS[i], hitDart: null }));
    visits.push(...hitVisits(targetKey, dartsToHit));
    return { visits };
  }

  function planStay(sess, outcome) {
    const [kind, count] = String(outcome).split(":");
    const darts = Number(count);
    const key = currentKey(sess);
    if (!key) return null;
    if (!STAY_OUTCOMES.includes(`${kind}:${darts}`)) return { error: "Pick how the extra darts ended." };
    if (kind === "hit") return { visits: hitVisits(key, darts) };
    const visits = Array.from({ length: darts / 3 }, () => ({ key, hitDart: null }));
    visits[visits.length - 1].extra = darts - 3;
    return { visits };
  }

  // ---- The cameras ---------------------------------------------------------------------------------
  // sess.cam = { seq, at, darts: [labels at the current double, not yet decided], seen: darts seen
  //              since the last take-out, over: the double hit earlier in this visit (its other darts
  //              don't count) or null, stay: { key, darts, visits } after a miss, or null }
  const SEG_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const BULL_OUT = 0.12; // outer bull radius on the app board (BoardVision.APP: the double ring ends at 1)

  function freshCam(seq) { return { seq: seq || 0, at: null, darts: [], seen: 0, stay: null, over: null }; }

  // The number (or "BULL") a dart is in, by where it is, even off the board: a dart just outside the
  // D7 wire is in the 7. x, y on the app board, double ring outer edge at radius 1.
  function numberAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.hypot(x, y) <= BULL_OUT) return "BULL";
    const wedge = (Math.PI * 2) / 20;
    let rel = Math.atan2(y, x) - (-Math.PI / 2 - wedge / 2);
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    return String(SEG_ORDER[Math.floor(rel / wedge)] || 20);
  }

  // The double a dart label is in: "D7" -> "D7", "DB" (bullseye) -> "DBULL", anything else -> null.
  function doubleOf(label) {
    if (label === "DB") return "DBULL";
    const m = /^D(\d{1,2})$/.exec(String(label || ""));
    return m && Number(m[1]) >= 1 && Number(m[1]) <= 20 ? `D${Number(m[1])}` : null;
  }

  const numberOfKey = (key) => (key === "DBULL" ? "BULL" : key ? key.slice(1) : null);
  const describe = (label) => (label === "MISS" ? "off the board" : label === "DB" ? "the bullseye" : label === "SB" ? "the outer bull" : label);

  // One dart from the cameras: { seq, label, x, y } (x, y on the app board). Returns null when it was
  // already counted (another device got it in first), or a change for applyChange():
  // { cam, visits?, takeBack?, message }, where takeBack = { key, visits }: the latest visits the
  // cameras logged at that double (all misses), taken back first, which is how a stay is redone.
  function cameraDart(sess, dart) {
    if (!sess || !dart) return null;
    const cam = Object.assign(freshCam(), clone(sess.cam) || {});
    if (dart.seq && dart.seq <= (cam.seq || 0)) return null;
    if (dart.seq) cam.seq = dart.seq;
    const cur = currentKey(sess);
    if (!cur) return { cam, message: "All doubles are done.", effect: { kind: "ignored" } };
    if (sess.timer && sess.timer.isPaused) return { cam, message: `Camera saw ${describe(dart.label)}, but the session is paused.`, effect: { kind: "ignored" } };
    // A 4th dart without a take-out: the take-out wasn't seen, so this dart starts the next visit.
    if ((cam.seen || 0) >= 3) { cam.seen = 0; cam.over = null; }
    cam.seen = (cam.seen || 0) + 1;
    // The double went in earlier in this visit: the visit's other darts don't count.
    if (cam.over) return { cam, message: `Camera: ${describe(dart.label)}, not counted: ${cam.over} went in earlier this visit. Pull your darts out.`, effect: { kind: "spare", key: cam.over } };
    if (cam.at !== cur) { cam.at = cur; cam.darts = []; }

    const hitKey = doubleOf(dart.label);
    const num = numberAt(dart.x, dart.y) || (hitKey ? numberOfKey(hitKey) : null);
    const stay = cam.stay && cam.stay.key !== cur && !sess.doubles[cam.stay.key].completed ? cam.stay : null;

    // In the current double: a hit on this dart.
    if (hitKey === cur) {
      const n = cam.darts.length + 1;
      cam.darts = [];
      cam.at = null;
      cam.stay = null;
      cam.over = cam.seen < 3 ? cur : null;
      return { cam, visits: hitVisits(cur, n), message: `Camera: ${cur} hit on dart ${n}.${cam.over ? " Pull your darts out." : ""}`, effect: { kind: "hit", key: cur, n } };
    }

    // Still at the double just missed: in its double is a stay hit, and in its number another stay dart.
    if (stay && (hitKey === stay.key || (!hitKey && num === numberOfKey(stay.key)))) {
      const total = stay.darts + cam.darts.length + 1;
      if (total <= MAX_STAY_DARTS) {
        if (hitKey === stay.key) {
          cam.darts = [];
          cam.at = null;
          cam.stay = null;
          cam.over = cam.seen < 3 ? stay.key : null;
          return { cam, takeBack: { key: stay.key, visits: stay.visits }, visits: hitVisits(stay.key, total), message: `Camera: you stayed on ${stay.key} and hit it on dart ${total}.`, effect: { kind: "stayhit", key: stay.key, n: total } };
        }
        // Another dart at the stayed-on double: the darts so far at the current one were at it too.
        // Every 3 of them is another missed visit there, its 3 darts extra.
        stay.darts = total;
        cam.darts = [];
        cam.stay = stay;
        const more = Math.floor(stay.darts / 3) - stay.visits;
        if (more > 0) {
          stay.visits += more;
          return { cam, visits: Array.from({ length: more }, () => ({ key: stay.key, hitDart: null, extra: 3 })), message: `Camera: still on ${stay.key}, ${stay.darts} darts without a hit.`, effect: { kind: "stay", key: stay.key, n: stay.darts } };
        }
        return { cam, message: `Camera: ${describe(dart.label)}, still on ${stay.key} (${stay.darts} darts).`, effect: { kind: "stay", key: stay.key, n: stay.darts } };
      }
    }

    // Anywhere else: a miss at the current double.
    cam.darts = cam.darts.concat([dart.label || "MISS"]);
    if (cam.darts.length >= 3) {
      cam.darts = [];
      cam.at = null;
      cam.stay = { key: cur, darts: 3, visits: 1 };
      return { cam, visits: [{ key: cur, hitDart: null }], message: `Camera: ${describe(dart.label)}. ${cur} missed with 3 darts.`, effect: { kind: "miss", key: cur, n: 3 } };
    }
    return { cam, message: `Camera: ${describe(dart.label)} (dart ${cam.darts.length} at ${cur}).`, effect: { kind: "miss", key: cur, n: cam.darts.length } };
  }

  // Darts pulled out: the next visit starts. When the try at the current double wasn't over (no hit,
  // fewer than 3 darts there), the darts the cameras didn't see (a bounce-out, one hidden behind
  // another) are misses there, so it's a 3-dart miss as if they'd been seen.
  function cameraTakeout(sess, e) {
    if (!sess || !e) return null;
    const cam = Object.assign(freshCam(), clone(sess.cam) || {});
    if (e.seq && e.seq <= (cam.seq || 0)) return null;
    if (e.seq) cam.seq = e.seq;
    const seen = cam.seen || 0, over = cam.over;
    cam.seen = 0;
    cam.over = null;
    const cur = currentKey(sess);
    const atCur = cam.at === cur ? (cam.darts || []).length : 0;
    if (!cur || over || seen === 0 || atCur === 0 || atCur >= 3 || (sess.timer && sess.timer.isPaused)) return { cam, message: "Darts out.", unseen: 0 };
    // Play the unseen darts on a copy (they finish the try at this double). A dart with no position
    // never counts for a stay.
    const unseen = 3 - atCur;
    const s = clone(sess);
    const scratch = { lifetime: defaultLifetime() };
    s.cam = cam;
    const visits = [];
    for (let i = 0; i < unseen; i += 1) {
      const r = cameraDart(s, { label: "MISS", x: NaN, y: NaN });
      if (!r) break;
      if (r.visits) { applyChange(scratch, s, { visits: r.visits, cam: r.cam }, sess.meta.startedAtMs || 0); visits.push(...r.visits); }
      else s.cam = r.cam;
      if (!currentKey(s)) break;
    }
    const out = { cam: Object.assign(s.cam, { seen: 0, over: null }), unseen, message: `Darts out: ${unseen} dart${unseen === 1 ? "" : "s"} the cameras didn't see counted as missed.` };
    if (visits.length) out.visits = visits;
    return out;
  }

  // Takes back the last n visits the cameras logged at one double (all misses), before a stay is redone.
  function takeBackMisses(u, sess, key, n) {
    const sd = sess.doubles[key];
    const ld = u.lifetime.doubles[key];
    const k = Math.min(n, sd.attempts || 0);
    sd.attempts -= k;
    ld.attempts = Math.max(0, (ld.attempts || 0) - k);
    const extra = Math.max(0, (k - 1) * 3);
    if (sd.extraDarts) { sd.extraDarts = Math.max(0, sd.extraDarts - extra); if (!sd.extraDarts) delete sd.extraDarts; }
    sess.flow.cursorIndex = indexOf(key);
  }

  // ---- Board mode: the visit on the board, fixing a dart, undo steps, the voice -----------------------
  // Every camera dart of the round is kept in sess.throws ({ s: seq, k: the double it was thrown at,
  // l: label, x, y, t, f: 1 when fixed by hand }), for the miss map. The darts since the last take-out
  // (at most 3) are the visit Board mode shows: sess.cam.visit = { n, cp, darts: [{ s, l, x, y, e }],
  // out }, where cp is the state just before its first dart and e what the dart counted as (the
  // effect from cameraDart). Fixing one of them puts cp back and scores the visit's darts again with
  // the same rules, so a fix can do anything the cameras could have done. A tap on the buttons, Undo,
  // or a new round ends the visit (the darts can't be fixed after that).
  const MAX_THROWS = 600;
  const UNDO_STEPS = 10;

  function withoutVisit(cam) {
    if (!cam) return cam;
    const c = clone(cam);
    delete c.visit;
    return c;
  }

  function snapshotFor(u, sess) {
    return { doubles: clone(sess.doubles), cursor: (sess.flow && sess.flow.cursorIndex) || 0, life: clone(u.lifetime.doubles), cam: withoutVisit(sess.cam) || freshCam() };
  }

  const round4 = (v) => (Number.isFinite(v) ? Math.round(v * 10000) / 10000 : null);

  function addThrow(sess, t) {
    if (!Array.isArray(sess.throws)) sess.throws = [];
    sess.throws.push(t);
    if (sess.throws.length > MAX_THROWS) sess.throws.splice(0, sess.throws.length - MAX_THROWS);
  }

  // A dart from the cameras: cameraDart(), plus the visit and the throw log. Returns null when it was
  // already counted, else { change, record } (record: what Undo needs, when visits were logged).
  function recordDart(u, sess, dart, now) {
    const r = cameraDart(sess, dart);
    if (!r) return null;
    if (r.effect && r.effect.kind !== "ignored") {
      const prev = r.cam.visit;
      const visit = !prev || prev.out || prev.darts.length >= 3
        ? { n: ((prev && prev.n) || 0) + 1, cp: snapshotFor(u, sess), darts: [], out: null }
        : prev;
      const x = round4(dart.x), y = round4(dart.y), label = dart.label || "MISS";
      visit.darts.push({ s: dart.seq || 0, l: label, x, y, e: r.effect });
      r.cam.visit = visit;
      addThrow(sess, { s: dart.seq || 0, k: r.effect.kind === "spare" ? null : r.effect.key, l: label, x, y, t: now });
    }
    const rec = applyChange(u, sess, r, now);
    return { change: r, record: (r.visits && r.visits.length) || r.takeBack ? rec : null };
  }

  // Darts pulled out: cameraTakeout(), and the visit ends (it can still be fixed until the next dart).
  function recordTakeout(u, sess, e, now) {
    const r = cameraTakeout(sess, e);
    if (!r) return null;
    if (r.cam.visit && !r.cam.visit.out) r.cam.visit.out = { darts: (e && e.darts) || 0, unseen: r.unseen || 0 };
    const rec = applyChange(u, sess, r, now);
    return { change: r, record: r.visits && r.visits.length ? rec : null };
  }

  // What Undo needs to take a change back, worked out by comparing before and after (for a fix).
  function diffRecord(u, before, lifeBefore, sess, now) {
    const keys = {};
    let hits = 0;
    for (const k of KEYS) {
      const a = before.doubles[k] || defaultDouble(), b = sess.doubles[k] || defaultDouble();
      const la = lifeBefore[k] || defaultLifeDouble(), lb = u.lifetime.doubles[k] || defaultLifeDouble();
      if (JSON.stringify(a) !== JSON.stringify(b) || JSON.stringify(la) !== JSON.stringify(lb)) {
        keys[k] = { prevDouble: clone(a), prevLife: clone(la), attemptsAfter: b.attempts || 0 };
        if (b.completed && !a.completed) hits += 1;
      }
    }
    const finishingShot = isFinished(sess) && !isFinished(before);
    return {
      startedAtMs: sess.meta.startedAtMs,
      keys,
      hits,
      finishingShot,
      prevCursor: (before.flow && before.flow.cursorIndex) || 0,
      prevCam: withoutVisit(before.cam) || null,
      sessionKey: sess.meta.sessionKey || null,
      activeMsAtFinish: sess.timer.activeMsAccum || 0,
      sessionBefore: finishingShot ? Object.assign(clone(before), { cam: withoutVisit(before.cam) || null }) : null,
    };
  }

  // Board mode: dart `index` of this visit (its seq must still be `seq`) was really fix = { label, x, y },
  // or wasn't a dart at all (fix.remove). Returns { error } or { record, changed }.
  function fixDart(u, sess, index, seq, fix, now) {
    const v = sess && sess.cam && sess.cam.visit;
    const d0 = v && v.darts[index];
    if (!d0 || (d0.s || 0) !== (seq || 0)) return { error: "That visit can't be changed any more. Use Undo, then tap what happened." };
    if (isFinished(sess)) return { error: "The round is finished. Use Undo to take the last throw back." };
    if (sess.timer && sess.timer.isPaused) return { error: "The round is paused. Resume it first." };
    ensureLifetime(u);
    const before = clone(sess), lifeBefore = clone(u.lifetime.doubles);
    const darts = v.darts.map((d) => clone(d));
    if (fix.remove) darts.splice(index, 1);
    else Object.assign(darts[index], { l: fix.label, x: round4(fix.x), y: round4(fix.y), f: 1 });
    // Back to just before the visit's first dart...
    const seqNow = (sess.cam && sess.cam.seq) || 0;
    sess.doubles = clone(v.cp.doubles);
    sess.flow.cursorIndex = v.cp.cursor;
    u.lifetime.doubles = clone(v.cp.life);
    sess.cam = Object.assign(freshCam(), clone(v.cp.cam));
    // ...and through its darts again, as the cameras would have read them.
    const apply = (r) => { if ((r.visits && r.visits.length) || r.takeBack) applyChange(u, sess, r, now); else sess.cam = r.cam; };
    for (const d of darts) {
      const r = cameraDart(sess, { seq: 0, label: d.l, x: Number.isFinite(d.x) ? d.x : NaN, y: Number.isFinite(d.y) ? d.y : NaN });
      d.e = r.effect;
      apply(r);
    }
    let out = v.out || null;
    if (out) {
      const r = cameraTakeout(sess, { seq: 0, darts: out.darts });
      out = Object.assign({}, out, { unseen: r.unseen || 0 });
      apply(r);
    }
    sess.cam.seq = Math.max(sess.cam.seq || 0, seqNow);
    sess.cam.visit = { n: v.n, cp: v.cp, darts, out };
    // The throw log follows.
    if (Array.isArray(sess.throws)) {
      if (fix.remove && seq) sess.throws = sess.throws.filter((t) => t.s !== seq);
      for (const d of darts) {
        if (!d.s) continue;
        const t = sess.throws.find((x) => x.s === d.s);
        if (t) Object.assign(t, { l: d.l, x: d.x, y: d.y, k: d.e && d.e.kind === "spare" ? null : (d.e && d.e.key) || t.k }, d.f ? { f: 1 } : {});
      }
    }
    const record = diffRecord(u, before, lifeBefore, sess, now);
    return { record, changed: Object.keys(record.keys).length > 0 };
  }

  // Undo steps: u.undoStack (newest last, at most 10), with u.lastUndo kept as its top for pages from
  // before Board mode. A record an older page wrote (no id, or not the top) starts the stack again.
  function undoStackOf(u) {
    const s = Array.isArray(u.undoStack) ? u.undoStack.slice() : [];
    const top = s[s.length - 1];
    if (!u.lastUndo) return [];
    if (!top || !top.id || top.id !== u.lastUndo.id) return [u.lastUndo];
    return s;
  }
  function pushUndo(u, rec, id) {
    if (!rec || !rec.keys || !Object.keys(rec.keys).length) return false;
    const s = undoStackOf(u);
    s.push(Object.assign(clone(rec), { id: id || String(Date.now()) }));
    u.undoStack = s.slice(-UNDO_STEPS);
    u.lastUndo = u.undoStack[u.undoStack.length - 1];
    return true;
  }
  // Takes back the newest step. Returns { error } or { record } (the step taken back).
  function undoStep(u, now) {
    const s = undoStackOf(u);
    const top = s.pop();
    if (!top) return { error: "Nothing to undo." };
    const err = undo(u, top, now);
    if (err) return { error: err };
    u.undoStack = s;
    u.lastUndo = s[s.length - 1] || null;
    return { record: top };
  }
  const undoCount = (u) => (u ? undoStackOf(u).length : 0);

  // What the voice says after a change (null: nothing new was thrown). hint = { key, n } when the
  // change knows the dart a double went in on (a stay hit counts every dart at it).
  const spokenKey = (key) => (key === "DBULL" ? "the bull" : `D ${key.slice(1)}`);
  function spokenTime(ms) {
    const sec = Math.round(Math.max(0, ms) / 1000), m = Math.floor(sec / 60), s = sec % 60;
    return m ? `${m} minute${m === 1 ? "" : "s"}${s ? ` ${s}` : ""}` : `${s} seconds`;
  }
  function voiceLine(before, after, hint) {
    if (!after) return null;
    if (!before || !before.meta || before.meta.startedAtMs !== after.meta.startedAtMs) {
      const k = currentKey(after);
      return k ? `Throw at ${spokenKey(k)}.` : null;
    }
    const parts = [];
    for (const k of KEYS) {
      const a = before.doubles[k] || defaultDouble(), b = after.doubles[k] || defaultDouble();
      const added = (b.attempts || 0) - (a.attempts || 0);
      if (b.completed && !a.completed) {
        const n = hint && hint.key === k && hint.n ? hint.n : Math.max(0, added - 1) * 3 + (b.hitDart || 1);
        parts.push(`${spokenKey(k)}, dart ${n}`);
      } else if (added > 0 && !b.completed) {
        parts.push(`Missed ${spokenKey(k)}`);
      }
    }
    if (!parts.length) return null;
    if (isFinished(after)) parts.push(`All 21 done. ${sessionDarts(after.doubles)} darts in ${spokenTime((after.timer && after.timer.activeMsAccum) || 0)}`);
    else { const k = currentKey(after); if (k) parts.push(spokenKey(k)); }
    return parts.join(". ") + ".";
  }

  // ---- Board mode: what it shows -----------------------------------------------------------------------
  const BOARD_R = { S: 0.78, T: 0.58, D: 0.95, O: 1.06 };
  const angleOf = (n) => ((-90 + SEG_ORDER.indexOf(Number(n)) * 18) * Math.PI) / 180;
  // A point in a bed of the board, for a dart fixed by hand: spot("S7"), spot("D20"), spot("DB"),
  // spot("SB"), or spot("O7") just outside the wire of the 7.
  function spot(label) {
    if (label === "DB") return { x: 0, y: 0 };
    if (label === "SB") return { x: 0, y: -0.085 };
    const m = /^([SDTO])(\d{1,2})$/.exec(String(label || ""));
    if (!m || SEG_ORDER.indexOf(Number(m[2])) === -1) return { x: NaN, y: NaN };
    const a = angleOf(m[2]), r = BOARD_R[m[1]];
    return { x: round4(Math.cos(a) * r), y: round4(Math.sin(a) * r) };
  }
  function neighbours(n) {
    const i = SEG_ORDER.indexOf(Number(n));
    return i === -1 ? [] : [SEG_ORDER[(i + 19) % 20], SEG_ORDER[(i + 1) % 20]];
  }
  const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

  // One dart of the visit, in words: { read, sub, kind: hit | miss | stay }.
  function dartWords(d) {
    const e = d.e || {}, key = e.key, num = numberOfKey(key);
    const off = Number.isFinite(d.x) && Number.isFinite(d.y) ? Math.hypot(d.x, d.y) > 1 : d.l === "MISS";
    const where = Number.isFinite(d.x) && Number.isFinite(d.y) ? numberAt(d.x, d.y) : null;
    const read = d.l === "MISS" ? (off ? "Outside" : "Miss") : d.l === "DB" ? "Bull" : d.l === "SB" ? "25" : d.l;
    if (e.kind === "hit") return { read, sub: `Hit on dart ${e.n}`, kind: "hit" };
    if (e.kind === "stayhit") return { read, sub: `Stayed, hit on dart ${e.n}`, kind: "hit" };
    if (e.kind === "stay") return { read, sub: `Still on ${key}: ${e.n} darts`, kind: "stay" };
    if (e.kind === "spare") return { read, sub: `Not counted: ${key} went in`, kind: "spare" };
    let sub = `A miss at ${key}`;
    if (d.l === "MISS" && where === num && off) sub = `Just past the ${key} wire`;
    else if (d.l === "MISS" && off) sub = "Off the board";
    else if (num !== "BULL" && /^[ST]\d/.test(d.l) && d.l.slice(1) === num) sub = d.l[0] === "S" ? "Inside the wire" : "In the treble";
    else if (num !== "BULL" && where && neighbours(num).map(String).includes(where)) sub = `Next door, in the ${where}`;
    return { read, sub, kind: "miss" };
  }

  // Everything Board mode draws, from the round: the target, what's next, this visit's darts and the
  // 21 doubles.
  function boardView(sess) {
    if (!sess) return null;
    const order = playOrder(sess);
    const cur = order.length ? KEYS[order[0]] : null;
    const cam = sess.cam || freshCam();
    const v = cam.visit || null;
    const darts = v ? v.darts.map((d, i) => Object.assign({ index: i, s: d.s || 0, label: d.l, x: d.x, y: d.y, key: d.e && d.e.key, fixed: !!d.f }, dartWords(d))) : [];
    const unseen = v && v.out ? v.out.unseen || 0 : 0;
    const atCur = cam.at === cur && !cam.over && (cam.seen || 0) < 3 ? (cam.darts || []).length : 0;
    const curIdx = cur ? indexOf(cur) : -1;
    const cells = TARGETS.map((t, i) => {
      const d = sess.doubles[t.key] || defaultDouble();
      const num = t.key === "DBULL" ? "B" : String(i + 1);
      if (d.completed) return { key: t.key, num, state: d.attempts > 1 ? "done late" : "done", sub: ordinal(d.hitDart || 1) };
      if (t.key === cur) return { key: t.key, num, state: "current", sub: d.attempts ? `×${d.attempts}` : "" };
      if (d.attempts) return { key: t.key, num, state: "open", sub: `×${d.attempts}` };
      return { key: t.key, num, state: "todo", sub: "" };
    });
    const back = order.slice(1).map((i) => KEYS[i]).find((k) => indexOf(k) < curIdx);
    const done = KEYS.filter((k) => sess.doubles[k] && sess.doubles[k].completed).length;
    return {
      target: cur,
      finished: !cur,
      next: order.slice(1, 4).map((i) => KEYS[i]),
      dartNo: Math.min(3, atCur + 1),
      darts,
      unseen,
      visitDone: !!(v && (v.out || v.darts.length >= 3 || cam.over)),
      // A hit before the visit's 3rd dart: the rest don't count; the next double starts next visit.
      pullOut: !!(cam.over && (cam.seen || 0) < 3),
      cells,
      done,
      note: back ? `${back} comes back after the bull` : "",
    };
  }

  // ---- Saved sessions ----------------------------------------------------------------------------------
  function msToLocalISODate(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  function historyPayload(sess, now) {
    const doubles = clone(sess.doubles);
    const out = {
      startedAtMs: sess.meta.startedAtMs,
      localDate: msToLocalISODate(sess.meta.startedAtMs),
      endedAtMs: (sess.timer && sess.timer.pauseStartedAtMs) || now,
      activeMs: (sess.timer && sess.timer.activeMsAccum) || 0,
      totalDarts: sessionDarts(doubles),
      extraDarts: sessionExtra(doubles),
      perDouble: doubles,
    };
    // Where every camera dart landed, for the miss map.
    if (Array.isArray(sess.throws) && sess.throws.length) out.throws = clone(sess.throws);
    return out;
  }

  // Sessions saved by every version of the old app: start time, active time and darts, when known.
  function sessionStart(s) { return typeof s.startedAtMs === "number" ? s.startedAtMs : typeof s.startedAt === "number" ? s.startedAt : null; }
  function sessionActive(s) { return typeof s.activeMs === "number" ? s.activeMs : typeof s.durationMs === "number" ? s.durationMs : null; }
  function sessionTotalDarts(s) {
    if (typeof s.totalDarts === "number") return s.totalDarts;
    if (s.perDouble) return sessionDarts(s.perDouble);
    return typeof s.dartsUsed === "number" ? s.dartsUsed : null;
  }
  function sessionExtraDarts(s) { return typeof s.extraDarts === "number" ? s.extraDarts : s.perDouble ? sessionExtra(s.perDouble) : 0; }

  function statsFromSessions(list) {
    const stats = {};
    for (const k of KEYS) stats[k] = { attempts: 0, hits: 0 };
    for (const s of list || []) {
      const per = s && (s.perDouble || s.doubles);
      if (!per) continue;
      for (const k of KEYS) {
        const d = per[k];
        if (!d) continue;
        stats[k].attempts += d.attempts || 0;
        if (d.completed) stats[k].hits += 1;
      }
    }
    return stats;
  }

  function heatByDate(list) {
    const byDate = {};
    for (const s of list || []) {
      const ms = s && sessionStart(s);
      if (!ms) continue;
      const key = msToLocalISODate(ms);
      const active = sessionActive(s) || 0;
      if (!byDate[key]) byDate[key] = { count: 0, totalActiveMs: 0, bestActiveMs: null };
      byDate[key].count += 1;
      byDate[key].totalActiveMs += active;
      byDate[key].bestActiveMs = byDate[key].bestActiveMs == null ? active : Math.min(byDate[key].bestActiveMs, active);
    }
    return byDate;
  }

  function fmt(ms) {
    const sec = Math.floor(Math.max(0, ms) / 1000);
    const m = Math.floor(sec / 60), s = sec % 60, h = Math.floor(m / 60), mm = m % 60;
    return h > 0 ? `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${mm}:${String(s).padStart(2, "0")}`;
  }

  return {
    TARGETS, KEYS, MAX_STAY_DARTS, STAY_OUTCOMES,
    defaultSession, defaultLifetime, ensureLifetime, ensureSession,
    earliestUnfinishedIndex, nextIndexFrom, isFinished, currentIndex, currentKey,
    computeElapsed, pauseResume, playOrder,
    dartsAt, sessionDarts, sessionExtra, dartsLabel, dartsSummary,
    applyChange, applyVisits, undo, planResult, planLater, planStay, hitVisits,
    freshCam, numberAt, doubleOf, cameraDart, cameraTakeout, takeBackMisses, describe,
    MAX_THROWS, UNDO_STEPS, withoutVisit, recordDart, recordTakeout, fixDart, diffRecord,
    undoStackOf, pushUndo, undoStep, undoCount, voiceLine, spokenKey, spot, neighbours, dartWords, boardView, ordinal,
    msToLocalISODate, historyPayload, sessionStart, sessionActive, sessionTotalDarts, sessionExtraDarts,
    statsFromSessions, heatByDate, fmt, clone,
  };
});
