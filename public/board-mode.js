// Board mode: a full-screen scoreboard to read from the oche, shared by the games (Doubles, the
// tracker, ...). One huge target, the board with this visit's darts, the three dart slots, a strip of
// every target, and big buttons for when the cameras miss one. Tap a dart (on the board or its slot)
// to fix what the cameras read. It only draws and reports taps: the page owns the data and says what
// to show (a "view", worked out by the game's engine).
//
//   const board = BoardMode.mount(document.body, config, handlers);
//   board.show(true);      // Board mode on (body.bm-open)
//   board.update(model);   // on every change (cheap when nothing changed)
//   board.tick(clockText); // every half second
//
// config (what differs between the games):
//   modeLabel, heroAria, stripAria   texts
//   pad          [{ man, text, cls }]: the manual buttons (Undo is added after them)
//   idleTitle, idleSub, idleStart    the screen before a round (view null)
//   doneBig, doneStart               the screen when it's over (view.finished)
//   big(target), longTarget(target)  the huge target's text
//   lit(view)    which beds of the board are lit: [{ n: 20 | "BULL", beds: "SDT" | "D" | "I" | "B", tint }]
//                (S the singles, D the double, T the treble, B the outer bull, I the bullseye; tint
//                shades the whole number)
//   fixOptions(dart, view) -> [{ id, text, hit, cur }]  ("other" opens the numbers, "remove" removes)
//   fixSub(dart, view) -> text;  fixValue(id, dart, view) -> what handlers.fix gets
//   curNote      what marks the option the dart is now ("what the cameras saw")
//   pickRing     "Another number" asks for the ring as well (where every bed scores)
// Also in the model: oppHtml (the other side's score, beside the target); in the view: nextLabel
// (the chips' label, "Next" by default, shown as they are), labelClass, cols (the strip's columns),
// capHtml (the strip's caption, in place of "n of 21 done"). board.moment({ big, sub, kind, who })
// shows a big moment full screen for a couple of seconds (a tap skips it).
// handlers: exit(), start(), pause(), voice(), camera(), manual(man), undo(),
//           fix(index, seq, value), boardTap(x, y) (optional: a tap on the board, in board radii),
//           and any other data-act of model.doneActions
// model: { view, paused, camOn, voiceOn, undoCount, note, noteWarn, dartsText, info, doneText,
//          doneHtml, doneActions: [{ act, text, primary }], pad: [{ man, text, disabled }],
//          idleTitle, lastRound }
// view:  { target, finished, label?, next: [], dartNo, darts: [{ index, s, x, y, kind, read, sub, fixed }],
//          unseen, waiting: [{ read, sub }], visitDone, pullOut, cells: [{ key, num, state, sub }],
//          done, of, note }
//
// Also: BoardMode.boardSvg(lit, darts), BoardMode.voice(isOn), BoardMode.wakeLock(),
// BoardMode.spotIn(label, x, y), BoardMode.numberAt(x, y), BoardMode.neighbours(n).
(function (root) {
  "use strict";
  const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  // The drawn board's rings, as fractions of its radius (the app's board: board-vision.js APP).
  const R = { bullIn: 0.05, bullOut: 0.12, tIn: 0.54, tOut: 0.62, dIn: 0.9, dOut: 1 };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const show = (el, on) => { if (el) el.hidden = !on; };

  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_VOICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>';

  // ---- where things are on the board ----
  const pt = (r, deg) => { const a = (deg * Math.PI) / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
  // The number a point is in (y grows downward), or "BULL" inside the outer bull, or null off the board.
  function numberAt(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = Math.hypot(x, y);
    if (r > R.dOut) return null;
    if (r <= R.bullOut) return "BULL";
    const deg = (Math.atan2(y, x) * 180) / Math.PI + 90 + 9; // 20 at the top, clockwise
    return SEG[Math.floor((((deg % 360) + 360) % 360) / 18)];
  }
  const neighbours = (n) => {
    const i = SEG.indexOf(Number(n));
    return i < 0 ? [] : [SEG[(i + 19) % 20], SEG[(i + 1) % 20]];
  };
  // The point of a bed nearest to (x, y), for a dart fixed by hand: label "T20", "D5", "S7", "SB",
  // "DB", or "MISS" (just outside the wire, at the same angle). Without a point, the middle of the bed.
  function spotIn(label, x, y) {
    const has = Number.isFinite(x) && Number.isFinite(y);
    const r0 = has ? Math.hypot(x, y) : null;
    const clampR = (lo, hi, mid) => (r0 == null ? mid : Math.max(lo + 0.01, Math.min(hi - 0.01, r0)));
    if (label === "DB") return has && r0 <= R.bullIn ? { x, y } : { x: 0, y: 0 };
    if (label === "SB") {
      const r = clampR(R.bullIn, R.bullOut, (R.bullIn + R.bullOut) / 2);
      const a = has && r0 > 0 ? Math.atan2(y, x) : -Math.PI / 2;
      return { x: Math.round(r * Math.cos(a) * 1000) / 1000, y: Math.round(r * Math.sin(a) * 1000) / 1000 };
    }
    if (label === "MISS") {
      const a = has ? Math.atan2(y, x) : -Math.PI / 2;
      const r = Math.max(1.04, r0 || 0);
      return { x: Math.round(r * Math.cos(a) * 1000) / 1000, y: Math.round(r * Math.sin(a) * 1000) / 1000 };
    }
    const m = /^([SDT])(\d+)$/.exec(label || "");
    if (!m) return has ? { x, y } : { x: 0, y: 0 };
    const n = Number(m[2]), i = SEG.indexOf(n);
    if (i < 0) return { x: 0, y: 0 };
    const centre = -90 + i * 18;
    let deg = has ? (Math.atan2(y, x) * 180) / Math.PI : centre;
    let d = ((deg - centre + 540) % 360) - 180; // -180..180 from the wedge's centre
    d = Math.max(-8, Math.min(8, d));
    deg = centre + d;
    let r;
    if (m[1] === "D") r = clampR(R.dIn, R.dOut, (R.dIn + R.dOut) / 2);
    else if (m[1] === "T") r = clampR(R.tIn, R.tOut, (R.tIn + R.tOut) / 2);
    else if (r0 != null && r0 > R.tOut && r0 < R.dIn) r = r0;
    else if (r0 != null && r0 > R.bullOut && r0 < R.tIn) r = r0;
    else r = r0 != null && r0 >= R.dIn ? R.dIn - 0.03 : r0 != null && r0 >= R.tIn && r0 <= R.tOut ? (r0 - R.tIn < R.tOut - r0 ? R.tIn - 0.03 : R.tOut + 0.03) : (R.tOut + R.dIn) / 2;
    const p = pt(r, deg);
    return { x: Math.round(p[0] * 1000) / 1000, y: Math.round(p[1] * 1000) / 1000 };
  }

  // ---- the board drawing ----
  function sector(r1, r2, a1, a2) {
    const p1 = pt(r2, a1), p2 = pt(r2, a2), p3 = pt(r1, a2), p4 = pt(r1, a1);
    return `M${p1}A${r2},${r2} 0 0 1 ${p2}L${p3}A${r1},${r1} 0 0 0 ${p4}Z`;
  }
  // lit: [{ n, beds, tint }] (see config.lit); darts: [{ index, x, y, kind, read }].
  function boardSvg(lit, darts, opts) {
    const o = opts || {};
    const L = new Map();
    (lit || []).forEach((l) => { if (l && l.n != null) L.set(l.n === "BULL" ? "BULL" : Number(l.n), l); });
    const names = [...L.keys()].map((k) => (k === "BULL" ? "the bull" : String(k)));
    let s = `<svg viewBox="-1.25 -1.25 2.5 2.5" role="img" aria-label="${esc(names.length ? "Board: " + names.join(", ") + " lit" : "Board")}"><circle r="1.24" fill="var(--bm-surround)"/>`;
    SEG.forEach((n, i) => {
      const c = -90 + i * 18, a1 = c - 9, a2 = c + 9, even = i % 2 === 0;
      const l = L.get(n), beds = (l && l.beds) || "";
      const seg = even ? "var(--bm-seg-a)" : "var(--bm-seg-b)", ring = even ? "var(--bm-ring-a)" : "var(--bm-ring-b)";
      const single = beds.includes("S") ? "var(--accent)" : seg;
      const sOp = beds.includes("S") ? ' fill-opacity=".38"' : "";
      s += `<path d="${sector(R.bullOut, R.tIn, a1, a2)}" fill="${single}"${sOp}/><path d="${sector(R.tIn, R.tOut, a1, a2)}" fill="${beds.includes("T") ? "var(--accent)" : ring}"/>`;
      s += `<path d="${sector(R.tOut, R.dIn, a1, a2)}" fill="${single}"${sOp}/><path d="${sector(R.dIn, R.dOut, a1, a2)}" fill="${beds.includes("D") ? "var(--accent)" : ring}"/>`;
      if (l && l.tint) s += `<path d="${sector(R.bullOut, R.dIn, a1, a2)}" fill="var(--accent)" fill-opacity=".13"/>`;
      const p = pt(1.13, c);
      s += `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" dominant-baseline="central" font-size="${l ? 0.13 : 0.09}" font-weight="${l ? 900 : 700}" fill="${l ? "var(--accent)" : "var(--bm-num)"}">${n}</text>`;
    });
    [R.bullOut, R.tIn, R.tOut, R.dIn, R.dOut].forEach((r) => { s += `<circle r="${r}" fill="none" stroke="var(--bg)" stroke-width=".008"/>`; });
    SEG.forEach((n, i) => { const a = pt(R.bullOut, -99 + i * 18), b = pt(R.dOut, -99 + i * 18); s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="var(--bg)" stroke-width=".008"/>`; });
    const bull = L.get("BULL"), bb = (bull && bull.beds) || "";
    s += `<circle r="${R.bullOut}" fill="${bb.includes("B") ? "var(--accent)" : "var(--bm-ring-a)"}" stroke="var(--bg)" stroke-width=".008"/><circle r="${R.bullIn}" fill="${bb.includes("I") ? "var(--accent)" : "var(--bm-bull)"}"${bb.includes("B") && bb.includes("I") ? ' stroke="var(--bg)" stroke-width=".012"' : ""}/>`;
    (darts || []).forEach((d) => {
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
      const x = Math.max(-1.2, Math.min(1.2, d.x)), y = Math.max(-1.2, Math.min(1.2, d.y));
      const col = d.kind === "hit" ? "var(--bm-hit)" : d.kind === "stay" ? "var(--accent)" : d.kind === "spare" ? "var(--bm-num)" : "var(--bm-miss)";
      const r = o.small ? 0.03 : 0.055;
      if (o.small) { s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" fill-opacity=".8"/>`; return; }
      s += `<g class="bm-dart" data-i="${d.index}" role="button" tabindex="0" aria-label="Dart ${d.index + 1}: ${esc(d.read)}. Tap to fix.">`;
      s += `<circle cx="${x}" cy="${y}" r=".11" fill="transparent"/><circle cx="${x}" cy="${y}" r="${r}" fill="${col}" stroke="var(--bg)" stroke-width=".018"/>`;
      s += `<text x="${x + 0.085}" y="${y - 0.075}" font-size=".09" font-weight="900" fill="#fff" stroke="var(--bg)" stroke-width=".025" paint-order="stroke">${d.index + 1}</text></g>`;
    });
    return s + "</svg>";
  }

  // ---- the screen ----
  function html(cfg) {
    const pad = (cfg.pad || []).map((b) => `<button type="button" data-man="${esc(b.man)}"${b.cls ? ` class="${esc(b.cls)}"` : ""}>${esc(b.text)}</button>`).join("");
    return `
  <div class="bm-top">
    <button class="bm-chip" type="button" data-act="exit" aria-label="Leave Board mode">${ICON_BACK}Exit</button>
    <span class="bm-mode" data-ref="mode">${esc(cfg.modeLabel || "")}</span>
    <span class="bm-sp"></span>
    <div class="bm-clock"><span class="t" data-ref="clock">0:00</span><span class="d" data-ref="darts"></span></div>
    <button class="bm-chip" type="button" data-act="voice" data-ref="voice" aria-pressed="false">${ICON_VOICE}<span data-ref="voiceText">Voice</span></button>
    <button class="bm-chip" type="button" data-act="camera" data-ref="camera" aria-pressed="false"><span class="bm-dot" aria-hidden="true"></span>Cameras</button>
    <button class="bm-chip" type="button" data-act="pause" data-ref="pause">Pause</button>
  </div>
  <section class="bm-hero" data-ref="hero" aria-label="${esc(cfg.heroAria || "Target")}">
    <div>
      <div class="bm-label" data-ref="label">Throwing at</div>
      <div class="bm-target" data-ref="target" aria-live="polite"></div>
    </div>
    <div class="bm-side">
      <div class="bm-opp" data-ref="opp" hidden></div>
      <div class="bm-count" data-ref="count"></div>
      <div class="bm-info" data-ref="info"></div>
      <div class="bm-next" data-ref="next"></div>
    </div>
  </section>
  <div class="bm-done" data-ref="done" hidden>
    <div class="bm-done-big" data-ref="doneBig">${esc(cfg.doneBig || "Done")}</div>
    <div class="bm-done-sub" data-ref="doneSub"></div>
    <div class="bm-recap" data-ref="recap"></div>
    <div class="bm-row" data-ref="doneRow"></div>
  </div>
  <div class="bm-board" data-ref="board" aria-label="The board, with this visit's darts"></div>
  <div class="bm-slots" data-ref="slots"></div>
  <section class="bm-strip" aria-label="${esc(cfg.stripAria || "Targets")}">
    <div class="bm-cap"><span data-ref="capLeft"><strong>0 of 21</strong> done</span><span data-ref="capNote"></span></div>
    <div class="bm-cells" data-ref="cells"></div>
  </section>
  <div class="bm-pad" data-ref="pad" aria-label="Enter a dart by hand" style="--bm-pad:${(cfg.pad || []).length + 1}">
    ${pad}
    <button type="button" data-act="undo" data-ref="undo" class="u">Undo</button>
  </div>
  <div class="bm-idle" data-ref="idle" hidden>
    <div class="bm-idle-title" data-ref="idleTitle">${esc(cfg.idleTitle || "")}</div>
    <div class="bm-idle-sub" data-ref="idleSub">${esc(cfg.idleSub || "")}</div>
    <div class="bm-row"><button type="button" class="bm-primary" data-act="start">${esc(cfg.idleStart || "Start")}</button><button type="button" class="bm-chip" data-act="exit">Exit Board mode</button></div>
  </div>
  <div class="bm-moment" data-ref="moment" hidden role="status" aria-live="assertive"><div class="bm-moment-big" data-ref="momentBig"></div><div class="bm-moment-sub" data-ref="momentSub"></div></div>
  <div class="bm-backdrop" data-ref="sheet" hidden>
    <div class="bm-sheet" role="dialog" aria-modal="true" aria-labelledby="bmSheetTitle">
      <h2 id="bmSheetTitle" data-ref="sheetTitle">Dart</h2>
      <p data-ref="sheetSub"></p>
      <div class="bm-opts" data-ref="opts"></div>
      <button type="button" class="bm-cancel" data-act="cancel">Keep it as it is</button>
    </div>
  </div>`;
  }

  function slotsHtml(v, m) {
    let out = "";
    const waiting = v.waiting || [];
    let w = 0;
    for (let i = 0; i < 3; i += 1) {
      const d = v.darts[i];
      if (d) {
        out += `<button type="button" class="bm-slot ${esc(d.kind)}" data-i="${i}"><span class="n">${i + 1}</span><span class="r">${esc(d.read)}</span><span class="s">${esc(d.sub)}${d.fixed ? " · fixed" : ""}</span></button>`;
      } else if (w < waiting.length) {
        const x = waiting[w++];
        out += `<div class="bm-slot unread"><span class="n">${i + 1}</span><span class="r">${esc(x.read)}</span><span class="s">${esc(x.sub)}</span></div>`;
      } else if (v.unseen && i >= v.darts.length + waiting.length && i < v.darts.length + waiting.length + v.unseen) {
        out += `<div class="bm-slot miss unseen"><span class="n">${i + 1}</span><span class="r">Not seen</span><span class="s">Counted as a miss</span></div>`;
      } else if (!v.visitDone && i === v.darts.length + waiting.length && !m.paused && m.camOn) {
        out += `<div class="bm-slot wait"><span class="n">${i + 1}</span><span class="r">Throw</span><span class="s">The cameras are watching</span></div>`;
      } else {
        out += `<div class="bm-slot empty"><span class="n">${i + 1}</span><span class="r">–</span><span class="s">&nbsp;</span></div>`;
      }
    }
    return out + `<div class="bm-note${m.noteWarn ? " warn" : ""}" aria-live="polite">${esc(m.note || "")}</div>`;
  }

  function mount(host, cfg, h) {
    const el = document.createElement("div");
    el.className = "bm";
    el.id = cfg.id || "boardMode";
    el.hidden = true;
    el.innerHTML = html(cfg);
    host.appendChild(el);
    const ref = {};
    el.querySelectorAll("[data-ref]").forEach((n) => { ref[n.dataset.ref] = n; });
    const big = cfg.big || ((t) => (t == null ? "" : String(t)));
    let model = null, sig = "", fixing = null, doneSig = "", padSig = "";

    function openFix(i) {
      const v = model && model.view;
      const d = v && v.darts[i];
      if (!d || !cfg.fixOptions) return;
      const opts = cfg.fixOptions(d, v);
      if (!opts || !opts.length) return; // this dart can't be fixed here
      fixing = { index: i, seq: d.s };
      ref.sheetTitle.textContent = `Dart ${i + 1}`;
      ref.sheetSub.textContent = cfg.fixSub ? cfg.fixSub(d, v) : `The cameras read it as ${d.read}. What was it?`;
      ref.opts.innerHTML = opts.map((o) =>
        `<button type="button" class="bm-opt${o.hit ? " h" : ""}${o.cur ? " cur" : ""}" data-fix="${esc(o.id)}">${esc(o.text)}${o.cur ? ` <span>(${esc(cfg.curNote || "what the cameras saw")})</span>` : ""}</button>`).join("");
      show(ref.sheet, true);
      const first = ref.opts.querySelector("button");
      if (first) first.focus();
    }
    function numbersPicker() {
      ref.sheetSub.textContent = "Which number did it land in?";
      // With cfg.pickRing, a number then asks for its ring (the bot game, where every bed scores).
      const attr = cfg.pickRing ? "data-num" : "data-fix";
      const nums = SEG.slice().sort((a, b) => a - b).map((n) => `<button type="button" class="bm-num" ${attr}="${cfg.pickRing ? n : "S" + n}">${n}</button>`).join("");
      ref.opts.innerHTML = `<div class="bm-nums">${nums}<button type="button" class="bm-num" data-fix="SB">25</button><button type="button" class="bm-num" data-fix="DB">Bull</button></div>`;
    }
    function ringPicker(n) {
      ref.sheetSub.textContent = `Where in the ${n}?`;
      ref.opts.innerHTML = [["T", "Treble"], ["D", "Double"], ["S", "Single"]].map(([r, w]) => `<button type="button" class="bm-opt" data-fix="${r}${n}">${w} ${n}</button>`).join("");
    }
    const closeFix = () => { fixing = null; show(ref.sheet, false); };

    // A big moment (a 180, a high finish, game shot): full screen for a couple of seconds, a tap skips it.
    let momentShown = false, momentTimer = null;
    function hideMoment() { momentShown = false; clearTimeout(momentTimer); show(ref.moment, false); el.classList.remove("moment-on"); }
    function moment(m) {
      if (!m) return;
      ref.momentBig.textContent = m.big || "";
      ref.momentSub.textContent = m.sub || "";
      ref.moment.className = "bm-moment " + (m.kind ? "k-" + m.kind : "") + (m.who ? " w-" + m.who : "");
      show(ref.moment, true);
      el.classList.add("moment-on");
      momentShown = true;
      clearTimeout(momentTimer);
      momentTimer = setTimeout(hideMoment, m.ms || 2200);
    }

    el.addEventListener("click", (e) => {
      const numBtn = e.target.closest("[data-num]");
      if (numBtn && fixing) { ringPicker(numBtn.dataset.num); return; }
      if (momentShown && e.target.closest("[data-ref=moment]")) { hideMoment(); return; }
      const fixBtn = e.target.closest("[data-fix]");
      if (fixBtn && fixing) {
        const id = fixBtn.dataset.fix;
        if (id === "other") { numbersPicker(); return; }
        const f = fixing, v = model && model.view, d = v && v.darts[f.index];
        closeFix();
        h.fix(f.index, f.seq, cfg.fixValue ? cfg.fixValue(id, d, v) : id);
        return;
      }
      if (e.target === ref.sheet) { closeFix(); return; }
      const dart = e.target.closest("[data-i]");
      if (dart) { openFix(Number(dart.dataset.i)); return; }
      // A tap on the board itself (not on a dart): where it landed, in board radii (y down).
      const svg = h.boardTap && e.target.closest(".bm-board svg");
      if (svg) {
        const r = svg.getBoundingClientRect(), size = Math.min(r.width, r.height);
        if (size > 0) {
          const x = ((e.clientX - (r.left + (r.width - size) / 2)) / size) * 2.5 - 1.25;
          const y = ((e.clientY - (r.top + (r.height - size) / 2)) / size) * 2.5 - 1.25;
          if (Math.abs(x) <= 1.25 && Math.abs(y) <= 1.25) h.boardTap(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000);
        }
        return;
      }
      const man = e.target.closest("[data-man]");
      if (man && !man.disabled) { h.manual(man.dataset.man); return; }
      const act = e.target.closest("[data-act]");
      if (!act || act.disabled) return;
      const a = act.dataset.act;
      if (a === "cancel") closeFix();
      else if (typeof h[a] === "function") h[a]();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && fixing) { closeFix(); return; }
      const dart = e.target.closest && e.target.closest(".bm-dart[data-i]");
      if (dart && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); openFix(Number(dart.dataset.i)); }
    });

    return {
      el,
      moment,
      show(on) {
        show(el, on);
        document.body.classList.toggle("bm-open", !!on);
        if (!on) closeFix();
      },
      tick(clock) { if (ref.clock.textContent !== clock) ref.clock.textContent = clock; },
      update(m) {
        model = m;
        const v = m.view;
        // Top bar
        ref.voice.setAttribute("aria-pressed", String(!!m.voiceOn));
        ref.voiceText.textContent = m.voiceOn ? "Voice" : "Voice off";
        ref.camera.setAttribute("aria-pressed", String(!!m.camOn));
        ref.pause.textContent = m.paused ? "Resume" : "Pause";
        ref.pause.disabled = !v || v.finished || m.pauseOff;
        ref.darts.textContent = m.dartsText || "";
        ref.undo.textContent = m.undoCount > 1 ? `Undo (${m.undoCount})` : "Undo";
        ref.undo.disabled = !m.undoCount;
        if (m.modeLabel != null && ref.mode.textContent !== m.modeLabel) ref.mode.textContent = m.modeLabel;
        el.classList.toggle("idle", !v);
        el.classList.toggle("finished", !!(v && v.finished));
        el.classList.toggle("done-only", !!(v && v.finished && m.doneOnly));
        el.classList.toggle("paused", !!m.paused);
        show(ref.idle, !v);
        show(ref.done, !!(v && v.finished));
        if (!v) {
          ref.idleTitle.textContent = m.idleTitle || cfg.idleTitle || "";
          ref.idleSub.textContent = m.lastRound || cfg.idleSub || "";
          sig = "";
          return;
        }
        // The manual buttons: their text and whether they work right now.
        const padNow = JSON.stringify([m.pad || null, !!(m.paused || v.finished)]);
        if (padNow !== padSig) {
          padSig = padNow;
          ref.pad.querySelectorAll("[data-man]").forEach((b) => {
            const o = (m.pad || []).find((p) => p.man === b.dataset.man);
            const base = (cfg.pad || []).find((p) => p.man === b.dataset.man);
            b.textContent = (o && o.text) || (base && base.text) || b.textContent;
            b.disabled = !!(m.paused || v.finished || (o && o.disabled));
            b.hidden = !!(o && o.hidden);
          });
        }
        // The end of the round.
        if (v.finished) {
          const d = JSON.stringify([m.doneBig, m.doneText, m.doneHtml, m.doneActions]);
          if (d !== doneSig) {
            doneSig = d;
            ref.doneBig.textContent = m.doneBig || cfg.doneBig || "Done";
            ref.doneSub.textContent = m.doneText || "";
            ref.recap.innerHTML = m.doneHtml || "";
            show(ref.recap, !!m.doneHtml);
            const acts = m.doneActions || [{ act: "start", text: cfg.doneStart || "Start another round", primary: true }];
            ref.doneRow.innerHTML = acts.map((a) => `<button type="button" class="${a.primary ? "bm-primary" : "bm-chip"}" data-act="${esc(a.act)}">${esc(a.text)}</button>`).join("")
              + '<button type="button" class="bm-chip" data-act="exit">Exit Board mode</button>';
          }
        } else doneSig = "";
        // The rest only when something changed (it's redrawn every half second otherwise).
        const s = JSON.stringify([v, m.paused, m.camOn, m.note, m.noteWarn, m.info, m.oppHtml]);
        if (s === sig) return;
        sig = s;
        ref.label.textContent = m.paused ? "Paused" : v.label || (v.pullOut ? "Pull your darts out, then" : "Throwing at");
        el.classList.toggle("pullout", !!v.pullOut && !m.paused);
        ref.target.textContent = v.finished ? "Done" : big(v.target);
        ref.target.classList.toggle("long", !!(cfg.longTarget && cfg.longTarget(v.target)));
        ref.count.innerHTML = v.countHtml != null ? v.countHtml : v.finished ? "" : v.pullOut ? "Next visit" : `Dart ${v.dartNo} <span>of 3</span>`;
        ref.info.innerHTML = m.info || "";
        show(ref.info, !!m.info);
        ref.next.innerHTML = v.next && v.next.length ? `<b>${esc(v.nextLabel || "Next")}</b>` + v.next.map((k) => `<span>${esc(v.nextLabel ? k : big(k))}</span>`).join("") : "";
        ref.opp.innerHTML = m.oppHtml || "";
        show(ref.opp, !!m.oppHtml);
        ref.label.className = "bm-label" + (v.labelClass ? " " + v.labelClass : "");
        ref.board.innerHTML = boardSvg(cfg.lit ? cfg.lit(v) : [], v.darts);
        ref.slots.innerHTML = slotsHtml(v, m);
        ref.cells.style.setProperty("--bm-cols", String(Math.max(1, v.cols || v.cells.length || 21)));
        ref.cells.innerHTML = v.cells.map((c) => `<div class="bm-cell ${esc(c.state)}" title="${esc(c.title || c.key)}">${esc(c.num)}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</div>`).join("");
        ref.capLeft.innerHTML = v.capHtml != null ? v.capHtml : `<strong>${esc(v.done)} of ${esc(v.of || 21)}</strong> done`;
        ref.capNote.textContent = v.note || "";
        if (fixing && !(v.darts[fixing.index] && v.darts[fixing.index].s === fixing.seq)) closeFix();
      },
    };
  }

  // ---- the voice ----
  // An iPad only speaks after one utterance was started inside a tap (the end of it: touchend or
  // click), so every tap warms the voice up until something is actually heard. isOn(): whether this
  // device has Voice on.
  function voice(isOn) {
    const can = typeof window !== "undefined" && !!window.speechSynthesis && typeof window.SpeechSynthesisUtterance === "function";
    let ready = false;
    function warmUp() {
      if (!can || ready || !isOn()) return;
      try {
        const synth = window.speechSynthesis;
        if (synth.paused) synth.resume();
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0; u.lang = "en-GB";
        u.onstart = () => { ready = true; };
        u.onend = () => { ready = true; };
        synth.speak(u);
      } catch (_) { /* no voice here */ }
    }
    if (can) ["touchend", "pointerup", "click", "keydown"].forEach((type) => window.addEventListener(type, warmUp, { capture: true, passive: true }));
    if (can) window.addEventListener("pageshow", () => { ready = false; });
    function speak(text, opts) {
      if (!can || !isOn() || !text) return;
      try {
        const synth = window.speechSynthesis;
        if (synth.paused) synth.resume();
        if (opts && opts.interrupt) synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.lang = "en-GB";
        u.onstart = () => { ready = true; };
        synth.speak(u);
      } catch (_) { /* no voice here */ }
    }
    return { speak, warmUp, get ready() { return ready; } };
  }

  // ---- keeping the screen on ----
  function wakeLock() {
    let lock = null, tried = 0;
    return function keepAwake(on) {
      if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
      if (!on) { if (lock) { lock.release().catch(() => {}); lock = null; } return; }
      if (lock || document.visibilityState !== "visible" || Date.now() - tried < 10000) return;
      tried = Date.now();
      navigator.wakeLock.request("screen").then((l) => {
        lock = l;
        l.addEventListener("release", () => { if (lock === l) lock = null; });
      }).catch(() => { /* not allowed right now: tried again in a while */ });
    };
  }

  root.BoardMode = { mount, boardSvg, voice, wakeLock, spotIn, numberAt, neighbours, SEG, RINGS: R };
})(typeof self !== "undefined" ? self : this);
