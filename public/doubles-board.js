// Board mode for the Doubles page (doubles.html): a full-screen scoreboard to read from the oche.
// One huge target, the board with this visit's darts, the three dart slots, the 21 doubles, and big
// buttons for when the cameras miss one. Tap a dart (on the board or its slot) to fix what the cameras
// read. It only draws and reports taps: the page owns the data, and everything it shows comes from
// DoublesEngine.boardView().
//
//   const board = DoublesBoard.mount(document.body, DoublesEngine, handlers);
//   board.update(model);   // on every change (cheap when nothing changed)
//   board.tick(clockText); // every half second
//
// handlers: exit(), start(), pause(), voice(), camera(), manual("hit1" | "hit2" | "hit3" | "miss"),
//           undo(), fix(index, seq, { label, x, y } | { remove: true })
(function (root) {
  "use strict";
  const SEG = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const R = { bullIn: 0.05, bullOut: 0.12, tIn: 0.54, tOut: 0.62, dIn: 0.9, dOut: 1 };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const show = (el, on) => { el.hidden = !on; };
  const big = (key) => (key === "DBULL" ? "BULL" : key || "");

  const ICON_BACK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
  const ICON_VOICE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>';

  const HTML = `
  <div class="bm-top">
    <button class="bm-chip" type="button" data-act="exit" aria-label="Leave Board mode">${ICON_BACK}Exit</button>
    <span class="bm-mode">Classic round</span>
    <span class="bm-sp"></span>
    <div class="bm-clock"><span class="t" data-ref="clock">0:00</span><span class="d" data-ref="darts"></span></div>
    <button class="bm-chip" type="button" data-act="voice" data-ref="voice" aria-pressed="false">${ICON_VOICE}<span data-ref="voiceText">Voice</span></button>
    <button class="bm-chip" type="button" data-act="camera" data-ref="camera" aria-pressed="false"><span class="bm-dot" aria-hidden="true"></span>Cameras</button>
    <button class="bm-chip" type="button" data-act="pause" data-ref="pause">Pause</button>
  </div>
  <section class="bm-hero" data-ref="hero" aria-label="Current double">
    <div>
      <div class="bm-label" data-ref="label">Throwing at</div>
      <div class="bm-target" data-ref="target" aria-live="polite"></div>
    </div>
    <div class="bm-side">
      <div class="bm-count" data-ref="count"></div>
      <div class="bm-next" data-ref="next"></div>
    </div>
  </section>
  <div class="bm-done" data-ref="done" hidden>
    <div class="bm-done-big">All 21 done</div>
    <div class="bm-done-sub" data-ref="doneSub"></div>
    <div class="bm-row"><button type="button" class="bm-primary" data-act="start">Start another round</button><button type="button" class="bm-chip" data-act="exit">Exit Board mode</button></div>
  </div>
  <div class="bm-board" data-ref="board" aria-label="The board, with this visit's darts"></div>
  <div class="bm-slots" data-ref="slots"></div>
  <section class="bm-strip" aria-label="The 21 doubles">
    <div class="bm-cap"><span><strong data-ref="doneCount">0 of 21</strong> done</span><span data-ref="capNote"></span></div>
    <div class="bm-cells" data-ref="cells"></div>
  </section>
  <div class="bm-pad" data-ref="pad" aria-label="Enter a visit by hand">
    <button type="button" data-man="hit1">Hit on 1</button>
    <button type="button" data-man="hit2">Hit on 2</button>
    <button type="button" data-man="hit3">Hit on 3</button>
    <button type="button" data-man="miss" class="m">Miss</button>
    <button type="button" data-act="undo" data-ref="undo" class="u">Undo</button>
  </div>
  <div class="bm-idle" data-ref="idle" hidden>
    <div class="bm-idle-title" data-ref="idleTitle">Doubles, D1 to the bull</div>
    <div class="bm-idle-sub" data-ref="idleSub">Every double, against the clock. The cameras enter the darts.</div>
    <div class="bm-row"><button type="button" class="bm-primary" data-act="start">Start a round</button><button type="button" class="bm-chip" data-act="exit">Exit Board mode</button></div>
  </div>
  <div class="bm-backdrop" data-ref="sheet" hidden>
    <div class="bm-sheet" role="dialog" aria-modal="true" aria-labelledby="bmSheetTitle">
      <h2 id="bmSheetTitle" data-ref="sheetTitle">Dart</h2>
      <p data-ref="sheetSub"></p>
      <div class="bm-opts" data-ref="opts"></div>
      <button type="button" class="bm-cancel" data-act="cancel">Keep it as it is</button>
    </div>
  </div>`;

  // ---- the board drawing ----
  const pt = (r, deg) => { const a = (deg * Math.PI) / 180; return [r * Math.cos(a), r * Math.sin(a)]; };
  function sector(r1, r2, a1, a2) {
    const p1 = pt(r2, a1), p2 = pt(r2, a2), p3 = pt(r1, a2), p4 = pt(r1, a1);
    return `M${p1}A${r2},${r2} 0 0 1 ${p2}L${p3}A${r1},${r1} 0 0 0 ${p4}Z`;
  }
  function boardSvg(target, darts) {
    const t = target === "DBULL" ? "BULL" : target ? Number(target.slice(1)) : null;
    let s = `<svg viewBox="-1.25 -1.25 2.5 2.5" role="img" aria-label="${esc(target ? "Board: " + target + " lit" : "Board")}"><circle r="1.24" fill="var(--bm-surround)"/>`;
    SEG.forEach((n, i) => {
      const c = -90 + i * 18, a1 = c - 9, a2 = c + 9, even = i % 2 === 0;
      const seg = even ? "var(--bm-seg-a)" : "var(--bm-seg-b)", ring = even ? "var(--bm-ring-a)" : "var(--bm-ring-b)";
      s += `<path d="${sector(R.bullOut, R.tIn, a1, a2)}" fill="${seg}"/><path d="${sector(R.tIn, R.tOut, a1, a2)}" fill="${ring}"/>`;
      s += `<path d="${sector(R.tOut, R.dIn, a1, a2)}" fill="${seg}"/><path d="${sector(R.dIn, R.dOut, a1, a2)}" fill="${n === t ? "var(--accent)" : ring}"/>`;
      if (n === t) s += `<path d="${sector(R.bullOut, R.dIn, a1, a2)}" fill="var(--accent)" fill-opacity=".13"/>`;
      const p = pt(1.13, c);
      s += `<text x="${p[0]}" y="${p[1]}" text-anchor="middle" dominant-baseline="central" font-size="${n === t ? 0.13 : 0.09}" font-weight="${n === t ? 900 : 700}" fill="${n === t ? "var(--accent)" : "var(--bm-num)"}">${n}</text>`;
    });
    [R.bullOut, R.tIn, R.tOut, R.dIn, R.dOut].forEach((r) => { s += `<circle r="${r}" fill="none" stroke="var(--bg)" stroke-width=".008"/>`; });
    SEG.forEach((n, i) => { const a = pt(R.bullOut, -99 + i * 18), b = pt(R.dOut, -99 + i * 18); s += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="var(--bg)" stroke-width=".008"/>`; });
    s += `<circle r="${R.bullOut}" fill="var(--bm-ring-a)" stroke="var(--bg)" stroke-width=".008"/><circle r="${R.bullIn}" fill="${t === "BULL" ? "var(--accent)" : "var(--bm-bull)"}"/>`;
    darts.forEach((d) => {
      if (!Number.isFinite(d.x) || !Number.isFinite(d.y)) return;
      const x = Math.max(-1.2, Math.min(1.2, d.x)), y = Math.max(-1.2, Math.min(1.2, d.y));
      const col = d.kind === "hit" ? "var(--bm-hit)" : d.kind === "stay" ? "var(--accent)" : d.kind === "spare" ? "var(--bm-num)" : "var(--bm-miss)";
      s += `<g class="bm-dart" data-i="${d.index}" role="button" tabindex="0" aria-label="Dart ${d.index + 1}: ${esc(d.read)}. Tap to fix.">`;
      s += `<circle cx="${x}" cy="${y}" r=".11" fill="transparent"/><circle cx="${x}" cy="${y}" r=".055" fill="${col}" stroke="var(--bg)" stroke-width=".018"/>`;
      s += `<text x="${x + 0.085}" y="${y - 0.075}" font-size=".09" font-weight="900" fill="#fff" stroke="var(--bg)" stroke-width=".025" paint-order="stroke">${d.index + 1}</text></g>`;
    });
    return s + "</svg>";
  }

  // ---- fixing a dart: what it could have been ----
  function fixOptions(E, d, fallbackKey) {
    if (d.kind === "spare") return [{ id: "remove", text: "Not a dart: remove it" }];
    const key = d.key || fallbackKey;
    const opts = [];
    if (key === "DBULL") {
      opts.push({ id: "DB", text: "In the bullseye: a hit", hit: true, cur: d.label === "DB" });
      opts.push({ id: "SB", text: "Outer bull (25)", cur: d.label === "SB" });
    } else if (key) {
      const n = key.slice(1);
      opts.push({ id: key, text: `In ${key}: a hit`, hit: true, cur: d.label === key });
      opts.push({ id: "S" + n, text: `Single ${n}, inside the wire`, cur: d.label === "S" + n });
      opts.push({ id: "O" + n, text: "Outside the wire", cur: d.label === "MISS" && d.sub === `Just past the ${key} wire` });
    }
    const known = opts.some((o) => o.cur);
    opts.push({ id: "other", text: "Another number", cur: !known });
    opts.push({ id: "remove", text: "Not a dart: remove it" });
    return opts;
  }
  const fixFor = (E, id) => {
    if (/^O\d+$/.test(id)) return Object.assign({ label: "MISS" }, E.spot(id));
    return Object.assign({ label: id }, E.spot(id));
  };

  function mount(host, E, h) {
    const el = document.createElement("div");
    el.className = "bm";
    el.id = "boardMode";
    el.hidden = true;
    el.innerHTML = HTML;
    host.appendChild(el);
    const ref = {};
    el.querySelectorAll("[data-ref]").forEach((n) => { ref[n.dataset.ref] = n; });
    let model = null, sig = "", fixing = null;

    function openFix(i) {
      const v = model && model.view;
      const d = v && v.darts[i];
      if (!d) return;
      fixing = { index: i, seq: d.s };
      ref.sheetTitle.textContent = `Dart ${i + 1}`;
      ref.sheetSub.textContent = d.kind === "spare"
        ? `The cameras read it as ${d.read === "Outside" ? "outside the wire" : d.read}. It doesn't count: ${d.key} went in earlier this visit. To change that, tap the dart that went in.`
        : `The cameras read it as ${d.read === "Outside" ? "outside the wire" : d.read}${d.key ? `, thrown at ${d.key}` : ""}. What was it?`;
      ref.opts.innerHTML = fixOptions(E, d, v.target).map((o) =>
        `<button type="button" class="bm-opt${o.hit ? " h" : ""}${o.cur ? " cur" : ""}" data-fix="${o.id}">${esc(o.text)}${o.cur ? " <span>(what the cameras saw)</span>" : ""}</button>`).join("");
      show(ref.sheet, true);
      const first = ref.opts.querySelector("button");
      if (first) first.focus();
    }
    function numbersPicker() {
      ref.sheetSub.textContent = "Which number did it land in?";
      const nums = SEG.slice().sort((a, b) => a - b).map((n) => `<button type="button" class="bm-num" data-fix="S${n}">${n}</button>`).join("");
      ref.opts.innerHTML = `<div class="bm-nums">${nums}<button type="button" class="bm-num" data-fix="SB">25</button><button type="button" class="bm-num" data-fix="DB">Bull</button></div>`;
    }
    const closeFix = () => { fixing = null; show(ref.sheet, false); };

    el.addEventListener("click", (e) => {
      const fixBtn = e.target.closest("[data-fix]");
      if (fixBtn && fixing) {
        const id = fixBtn.dataset.fix;
        if (id === "other") { numbersPicker(); return; }
        const f = fixing;
        closeFix();
        h.fix(f.index, f.seq, id === "remove" ? { remove: true } : fixFor(E, id));
        return;
      }
      if (e.target === ref.sheet) { closeFix(); return; }
      const dart = e.target.closest("[data-i]");
      if (dart) { openFix(Number(dart.dataset.i)); return; }
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

    function slotsHtml(v, m) {
      let html = "";
      for (let i = 0; i < 3; i += 1) {
        const d = v.darts[i];
        if (d) {
          html += `<button type="button" class="bm-slot ${d.kind}" data-i="${i}"><span class="n">${i + 1}</span><span class="r">${esc(d.read)}</span><span class="s">${esc(d.sub)}${d.fixed ? " · fixed" : ""}</span></button>`;
        } else if (v.unseen && i >= v.darts.length && i < v.darts.length + v.unseen) {
          html += `<div class="bm-slot miss unseen"><span class="n">${i + 1}</span><span class="r">Not seen</span><span class="s">Counted as a miss</span></div>`;
        } else if (!v.visitDone && i === v.darts.length && !m.paused && m.camOn) {
          html += `<div class="bm-slot wait"><span class="n">${i + 1}</span><span class="r">Throw</span><span class="s">The cameras are watching</span></div>`;
        } else {
          html += `<div class="bm-slot empty"><span class="n">${i + 1}</span><span class="r">–</span><span class="s">&nbsp;</span></div>`;
        }
      }
      return html + `<div class="bm-note${m.noteWarn ? " warn" : ""}" aria-live="polite">${esc(m.note || "")}</div>`;
    }

    return {
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
        ref.pause.disabled = !v || v.finished;
        ref.darts.textContent = m.dartsText || "";
        ref.undo.textContent = m.undoCount > 1 ? `Undo (${m.undoCount})` : "Undo";
        ref.undo.disabled = !m.undoCount;
        el.classList.toggle("idle", !v);
        el.classList.toggle("finished", !!(v && v.finished));
        el.classList.toggle("paused", !!m.paused);
        show(ref.idle, !v);
        show(ref.done, !!(v && v.finished));
        if (!v) {
          ref.idleTitle.textContent = m.idleTitle || "Doubles, D1 to the bull";
          ref.idleSub.textContent = m.lastRound || "Every double, against the clock. The cameras enter the darts.";
          sig = "";
          return;
        }
        ref.pad.querySelectorAll("[data-man]").forEach((b) => { b.disabled = !!(m.paused || v.finished); });
        ref.doneSub.textContent = v.finished ? m.doneText || "" : "";
        // The rest only when something changed (it's redrawn every half second otherwise).
        const s = JSON.stringify([v, m.paused, m.camOn, m.note, m.noteWarn]);
        if (s === sig) return;
        sig = s;
        ref.label.textContent = m.paused ? "Paused" : v.pullOut ? "Pull your darts out, then" : "Throwing at";
        el.classList.toggle("pullout", !!v.pullOut && !m.paused);
        ref.target.textContent = v.finished ? "Done" : big(v.target);
        ref.target.classList.toggle("long", v.target === "DBULL");
        ref.count.innerHTML = v.finished ? "" : v.pullOut ? "Next visit" : `Dart ${v.dartNo} <span>of 3</span>`;
        ref.next.innerHTML = v.next.length ? "<b>Next</b>" + v.next.map((k) => `<span>${esc(big(k))}</span>`).join("") : "";
        ref.board.innerHTML = boardSvg(v.target, v.darts);
        ref.slots.innerHTML = slotsHtml(v, m);
        ref.cells.innerHTML = v.cells.map((c) => `<div class="bm-cell ${c.state}" title="${c.key}">${c.num}${c.sub ? `<small>${esc(c.sub)}</small>` : ""}</div>`).join("");
        ref.doneCount.textContent = `${v.done} of 21`;
        ref.capNote.textContent = v.note;
        if (fixing && !(v.darts[fixing.index] && v.darts[fixing.index].s === fixing.seq)) closeFix();
      },
    };
  }

  root.DoublesBoard = { mount, boardSvg, fixOptions };
})(typeof self !== "undefined" ? self : this);
