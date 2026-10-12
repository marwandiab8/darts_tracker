// The practice timer shared by every practice page (the doubles tracker, games against the bot or a
// friend, the JDC Challenge): it starts when you start playing, you can pause and resume it, and if you
// forget, it pauses itself after 3 minutes with no throws - those 3 minutes count, the rest of the break
// doesn't. A throw while it is paused carries on timing. The time it shows is what a practice is saved
// (and sent to Time Left) with.
//
// The timer is plain data so a page can keep it in localStorage and pick it up after a reload:
//   { startedAt, activeMs, runningSince (ms, or null while paused), lastActivityAt, pausedBy: null|"you"|"idle", pausedAt }
// Loaded as a plain <script> (window.PracticeTimer) and by the tests (module.exports).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PracticeTimer = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const IDLE_PAUSE_MS = 3 * 60 * 1000;
  const MAX_SECONDS = 86400;

  function start(now) {
    const at = Number(now) || 0;
    return { startedAt: at, activeMs: 0, runningSince: at, lastActivityAt: at, pausedBy: null, pausedAt: null };
  }

  // A running timer with no throw for 3 minutes paused itself at that moment. Mutates and returns `t`.
  function settle(t, now) {
    if (t && t.runningSince != null) {
      const idleAt = t.lastActivityAt + IDLE_PAUSE_MS;
      if (now >= idleAt) {
        t.activeMs += Math.max(0, idleAt - t.runningSince);
        t.runningSince = null;
        t.pausedBy = "idle";
        t.pausedAt = idleAt;
      }
    }
    return t;
  }

  function pause(t, now) {
    if (!t) return t;
    settle(t, now);
    if (t.runningSince != null) {
      t.activeMs += Math.max(0, now - t.runningSince);
      t.runningSince = null;
      t.pausedBy = "you";
      t.pausedAt = now;
    }
    return t;
  }

  function resume(t, now) {
    if (!t) return t;
    settle(t, now);
    if (t.runningSince == null) {
      t.runningSince = now;
      t.lastActivityAt = now;
      t.pausedBy = null;
      t.pausedAt = null;
    }
    return t;
  }

  // A throw (or any entry): playing, so the timer runs - from a pause too.
  function activity(t, now) {
    if (!t) return t;
    settle(t, now);
    if (t.runningSince == null) resume(t, now);
    t.lastActivityAt = Math.max(t.lastActivityAt, now);
    return t;
  }

  function isPaused(t, now) {
    return !!t && settle(t, now).runningSince == null;
  }

  function elapsedMs(t, now) {
    if (!t) return 0;
    settle(t, now);
    return t.activeMs + (t.runningSince != null ? Math.max(0, now - t.runningSince) : 0);
  }

  function seconds(t, now) {
    return Math.max(0, Math.min(MAX_SECONDS, Math.round(elapsedMs(t, now) / 1000)));
  }

  // A timer saved before a reload, checked; null when it isn't one. Time away counts like any break.
  function restore(saved, now) {
    if (!saved || typeof saved !== "object") return null;
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
    const startedAt = num(saved.startedAt);
    const activeMs = num(saved.activeMs);
    const lastActivityAt = num(saved.lastActivityAt);
    if (startedAt == null || activeMs == null || lastActivityAt == null) return null;
    const runningSince = saved.runningSince == null ? null : num(saved.runningSince);
    const pausedBy = saved.pausedBy === "you" || saved.pausedBy === "idle" ? saved.pausedBy : runningSince == null ? "you" : null;
    return settle({ startedAt, activeMs: Math.max(0, activeMs), runningSince, lastActivityAt, pausedBy, pausedAt: num(saved.pausedAt) }, now);
  }

  // "4:05", or "1:02:09" past an hour.
  function format(ms) {
    const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
  }

  // ---- on the page --------------------------------------------------------------------------------
  // mount(container, { get, onChange }) draws the clock with a Pause/Resume button into `container` and
  // keeps it ticking. `get()` returns the current timer (or null: nothing shown); `onChange(timer)` is
  // called after Pause/Resume so the page can save it. Returns { refresh }.
  const STYLE = `
.ptimer { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 10px; padding: 6px 10px; border: 1px solid var(--border, rgba(255,255,255,.12)); border-radius: 12px; background: rgba(255,255,255,.03); }
.ptimer .pt-clock { font-variant-numeric: tabular-nums; font-weight: 900; font-size: 20px; min-width: 64px; }
.ptimer.paused .pt-clock { color: var(--muted, #94a3b8); }
.ptimer .pt-state { font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; color: var(--accent, #f59e0b); }
.ptimer.paused .pt-state { color: var(--muted, #94a3b8); }
.ptimer .pt-btn { margin-left: auto; padding: 6px 14px; border-radius: 10px; font-weight: 800; cursor: pointer; }
.ptimer .pt-note { flex-basis: 100%; font-size: 12px; color: var(--muted, #94a3b8); }
.ptimer .pt-note:empty { display: none; }`;

  function mount(container, { get, onChange } = {}) {
    if (!container || typeof document === "undefined") return { refresh() {} };
    if (!document.getElementById("practice-timer-style")) {
      const style = document.createElement("style");
      style.id = "practice-timer-style";
      style.textContent = STYLE;
      document.head.appendChild(style);
    }
    container.innerHTML = '<div class="ptimer" role="timer" aria-live="off"><span class="pt-state"></span><span class="pt-clock"></span><button type="button" class="pt-btn secondary"></button><div class="pt-note"></div></div>';
    const box = container.firstElementChild;
    const [state, clock, button, note] = ["pt-state", "pt-clock", "pt-btn", "pt-note"].map((c) => box.querySelector("." + c));
    function refresh() {
      const t = get && get();
      container.hidden = !t;
      if (!t) return;
      const now = Date.now();
      const paused = isPaused(t, now);
      box.classList.toggle("paused", paused);
      state.textContent = paused ? "Paused" : "Timing";
      clock.textContent = format(elapsedMs(t, now));
      button.textContent = paused ? "Resume" : "Pause";
      button.setAttribute("aria-label", paused ? "Resume the practice timer" : "Pause the practice timer");
      note.textContent = paused && t.pausedBy === "idle"
        ? "Paused itself after 3 minutes with no throws. Your next throw carries on, or press Resume."
        : paused ? "Your next throw carries on timing too." : "";
    }
    button.addEventListener("click", () => {
      const t = get && get();
      if (!t) return;
      const now = Date.now();
      if (isPaused(t, now)) resume(t, now);
      else pause(t, now);
      if (onChange) onChange(t);
      refresh();
    });
    setInterval(refresh, 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
    refresh();
    return { refresh };
  }

  return { IDLE_PAUSE_MS, start, settle, pause, resume, activity, isPaused, elapsedMs, seconds, restore, format, mount };
});
