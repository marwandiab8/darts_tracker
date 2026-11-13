// Board mode for the Doubles page (doubles.html), on the shared Board mode kit (board-mode.js): one
// huge double, the board with this visit's darts, the three dart slots, the 21 doubles, and big
// buttons for when the cameras miss one. Tap a dart (on the board or its slot) to fix what the cameras
// read. Everything it shows comes from DoublesEngine.boardView().
//
//   const board = DoublesBoard.mount(document.body, DoublesEngine, handlers);
//   board.update(model);   // on every change (cheap when nothing changed)
//   board.tick(clockText); // every half second
//
// handlers: exit(), start(), pause(), voice(), camera(), manual("hit1" | "hit2" | "hit3" | "miss"),
//           undo(), fix(index, seq, { label, x, y } | { remove: true })
(function (root) {
  "use strict";
  const B = root.BoardMode;
  const big = (key) => (key === "DBULL" ? "BULL" : key || "");

  // Fixing a dart: what it could have been.
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
    return B.mount(host, {
      id: "boardMode",
      modeLabel: "Classic round",
      heroAria: "Current double",
      stripAria: "The 21 doubles",
      pad: [{ man: "hit1", text: "Hit on 1" }, { man: "hit2", text: "Hit on 2" }, { man: "hit3", text: "Hit on 3" }, { man: "miss", text: "Miss", cls: "m" }],
      idleTitle: "Doubles, D1 to the bull",
      idleSub: "Every double, against the clock. The cameras enter the darts.",
      idleStart: "Start a round",
      doneBig: "All 21 done",
      doneStart: "Start another round",
      big,
      longTarget: (t) => t === "DBULL",
      lit: (v) => (!v.target ? [] : v.target === "DBULL" ? [{ n: "BULL", beds: "I" }] : [{ n: Number(v.target.slice(1)), beds: "D", tint: true }]),
      fixOptions: (d, v) => fixOptions(E, d, v.target),
      fixSub: (d) => (d.kind === "spare"
        ? `The cameras read it as ${d.read === "Outside" ? "outside the wire" : d.read}. It doesn't count: ${d.key} went in earlier this visit. To change that, tap the dart that went in.`
        : `The cameras read it as ${d.read === "Outside" ? "outside the wire" : d.read}${d.key ? `, thrown at ${d.key}` : ""}. What was it?`),
      fixValue: (id) => (id === "remove" ? { remove: true } : fixFor(E, id)),
    }, h);
  }

  root.DoublesBoard = { mount, boardSvg: B.boardSvg, fixOptions };
})(typeof self !== "undefined" ? self : this);
