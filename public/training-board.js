// Board mode for the Training page (training.html), on the shared Board mode kit (board-mode.js): one
// huge target, the board with this visit's darts, the three dart slots, the strip of every target, and
// big buttons for when the cameras miss one (how many of the 3 darts went in). Tap a dart (on the
// board or its slot) to fix what the cameras read. Everything it shows comes from
// TrainingEngine.boardView().
//
//   const board = TrainingBoard.mount(document.body, TrainingEngine, handlers);
//   board.update(model);   // on every change (cheap when nothing changed)
//   board.tick(clockText); // every half second
//
// handlers: exit(), start(), pause(), voice(), camera(), manual("h0" | "h1" | "h2" | "h3"), undo(),
//           fix(index, seq, { label, x, y } | { remove: true }), and the done screen's actions
//           (again(), pick()).
(function (root) {
  "use strict";
  const B = root.BoardMode;

  // Fixing a dart: what it could have been, at the double it was thrown at.
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
      opts.push({ id: "T" + n, text: `Triple ${n}`, cur: d.label === "T" + n });
      opts.push({ id: "O" + n, text: "Outside the wire", cur: d.label === "MISS" && /Just past/.test(d.sub || "") });
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
    return B.mount(host, {
      id: "boardMode",
      modeLabel: "Training",
      heroAria: "Current target",
      stripAria: "Every target",
      pad: [{ man: "h0", text: "No hits", cls: "m" }, { man: "h1", text: "1 hit" }, { man: "h2", text: "2 hits" }, { man: "h3", text: "3 hits" }],
      idleTitle: "Training",
      idleSub: "Pick a drill on the page, then throw. The cameras enter the darts.",
      idleStart: "Start",
      doneBig: "Done",
      doneStart: "Play again",
      big: (key) => (key === "DBULL" ? "BULL" : key || ""),
      longTarget: (t) => t === "DBULL",
      lit: (v) => (!v.target ? [] : v.target === "DBULL" ? [{ n: "BULL", beds: "I" }] : [{ n: Number(v.target.slice(1)), beds: "D", tint: true }]),
      fixOptions: (d, v) => fixOptions(E, d, v.target),
      fixSub: (d) => (d.kind === "spare"
        ? "The cameras read it after the visit's 3 darts, so it doesn't count. Pull your darts out."
        : `The cameras read it as ${d.read === "Outside" ? "outside the wire" : d.read}${d.key ? `, thrown at ${d.key === "DBULL" ? "the bull" : d.key}` : ""}. What was it?`),
      fixValue: (id) => (id === "remove" ? { remove: true } : fixFor(E, id)),
    }, h);
  }

  root.TrainingBoard = { mount, fixOptions };
})(typeof self !== "undefined" ? self : this);
