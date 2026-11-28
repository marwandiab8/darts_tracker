// Board mode for the Training page (training.html), on the shared Board mode kit (board-mode.js): one
// huge target (the double, or the score you require), the board with this visit's darts, the dart
// slots, the strip of every target, and big buttons for when the cameras miss one: how many of the 3
// darts went in (Bob's 27), or the route's darts and Miss (the checkout drills, where a tap on the
// board itself also enters a dart where it landed). Tap a dart (on the board or its slot) to fix what
// the cameras read. Everything it shows comes from TrainingEngine.boardView() and padFor().
//
//   const board = TrainingBoard.mount(document.body, TrainingEngine, handlers);
//   board.update(model);   // on every change (cheap when nothing changed)
//   board.tick(clockText); // every half second
//
// handlers: exit(), start(), pause(), voice(), camera(), manual("h0".."h3" | "p1".."p3" | "pm" | "fin"),
//           boardTap(x, y), undo(), fix(index, seq, { label, x, y } | { remove: true }), and the done
//           screen's actions (again(), pick()).
(function (root) {
  "use strict";
  const B = root.BoardMode;

  // What a fix option means for the engine: a label with a typical spot ("O7": a miss just outside D7).
  const fixFor = (E, id) => {
    if (id === "remove") return { remove: true };
    if (/^O\d+$/.test(id)) return Object.assign({ label: "MISS" }, E.spot(id));
    if (id === "MISS") return { label: "MISS", x: 0, y: -1.2 };
    return Object.assign({ label: id }, E.spot(id));
  };

  function mount(host, E, h) {
    return B.mount(host, {
      id: "boardMode",
      modeLabel: "Training",
      heroAria: "Current target",
      stripAria: "Every target",
      pad: [
        { man: "h0", text: "No hits", cls: "m" }, { man: "h1", text: "1 hit" }, { man: "h2", text: "2 hits" }, { man: "h3", text: "3 hits" },
        { man: "p1", text: "" }, { man: "p2", text: "" }, { man: "p3", text: "" }, { man: "pm", text: "Miss", cls: "m" },
        { man: "fin", text: "Finish", cls: "m" },
      ],
      idleTitle: "Training",
      idleSub: "Pick a drill on the page, then throw. The cameras enter the darts.",
      idleStart: "Start",
      doneBig: "Done",
      doneStart: "Play again",
      big: (t) => (t == null ? "" : String(t)),
      longTarget: (t) => String(t || "").length > 3,
      lit: (v) => v.lit || [],
      fixOptions: (d, v) => E.fixOptions(d, v),
      fixSub: (d, v) => (d.kind === "spare"
        ? "The cameras read it after the visit was over, so it doesn't count. Pull your darts out."
        : v && v.input === "darts"
          ? `Read as ${d.read === "Outside" ? "outside the board" : d.read}${Number.isFinite(d.rem) ? `, with ${d.rem} required` : ""}. What was it?`
          : `The cameras read it as ${d.read === "Outside" ? "outside the wire" : d.read}${d.key ? `, thrown at ${d.key === "DBULL" ? "the bull" : d.key}` : ""}. What was it?`),
      fixValue: (id) => fixFor(E, id),
      pickRing: (v) => !!(v && v.input === "darts"),
    }, h);
  }

  root.TrainingBoard = { mount, fixFor };
})(typeof self !== "undefined" ? self : this);
