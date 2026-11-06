// Reading darts from cameras: the maths, with no DOM in it, so `node --test tests/board-vision.test.cjs`
// can check it and the pages load the same file with a plain <script> tag (as BoardVision).
//
// How it works, in short (docs/camera-scoring.md has the long version):
//
// 1. Calibration. For each camera you tap five known points of the board on its picture: where four
//    of the wires between numbers meet the outside of the double ring, and the centre of the bull.
//    From those a homography is worked out: a map from any pixel of that camera to the point of the
//    board (the flat face, where darts go in) that the pixel looks at.
// 2. Spotting a dart. The page keeps the picture from just before each throw. When the picture
//    changes and then holds still again, the difference between the two is the new dart.
// 3. Finding its point. Seen from a camera to one side, a dart is a streak: thin at the point and
//    barrel, wide at the flight. Mapped onto the board, that streak lies along a straight line that
//    passes exactly through the hole the dart made, whichever way the dart leans. Each camera gives
//    one such line, and where the two lines cross is the dart's point. With one camera, the thin
//    end of the streak is used instead.
//
// Board coordinates are real ones here: fractions of the radius of the outside of the double ring
// (170 mm), centre 0,0, y growing downward. The app's drawn board has wider trebles, doubles and
// bulls than a real one, so `realToApp` turns a real position into the app position that scores the
// same, which is what the practice pages take.
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoardVision = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // --- the board ---------------------------------------------------------------------------------

  // Regulation sizes, as radii in millimetres (WDF/PDC).
  const MM = { bullIn: 6.35, bullOut: 15.9, tripleIn: 99, tripleOut: 107, doubleIn: 162, edge: 170 };
  const RING_KEYS = ["bullIn", "bullOut", "tripleIn", "tripleOut", "doubleIn", "edge"];
  const REAL = {};
  for (const key of RING_KEYS) REAL[key] = MM[key] / MM.edge;
  // The app's drawn board. Must match GEOM in practice-engine.js and drawBoard in index.html.
  const APP = { bullIn: 0.05, bullOut: 0.12, tripleIn: 0.54, tripleOut: 0.62, doubleIn: 0.9, edge: 1 };
  const SEG_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
  const WEDGE = (Math.PI * 2) / 20;

  // What a dart at (x, y) scores on a board with the given ring sizes (REAL or APP).
  function classify(x, y, geom) {
    const g = geom || REAL;
    const r = Math.hypot(x, y);
    if (!(r <= g.edge)) return { target: null, ring: null, label: "MISS", points: 0 };
    if (r <= g.bullIn) return { target: "BULL", ring: "D", label: "DB", points: 50 };
    if (r <= g.bullOut) return { target: "BULL", ring: "S", label: "SB", points: 25 };
    let rel = Math.atan2(y, x) - (-Math.PI / 2 - WEDGE / 2);
    while (rel < 0) rel += Math.PI * 2;
    while (rel >= Math.PI * 2) rel -= Math.PI * 2;
    const number = SEG_ORDER[Math.floor(rel / WEDGE)] || 20;
    let ring = "S";
    if (r >= g.doubleIn) ring = "D";
    else if (r >= g.tripleIn && r <= g.tripleOut) ring = "T";
    const mult = ring === "T" ? 3 : ring === "D" ? 2 : 1;
    return { target: String(number), ring, label: ring + number, points: number * mult };
  }

  // How far (in board radii) a point is from the nearest wire: a ring or the wire between two
  // numbers. A dart that close is worth a second look.
  function wireDistance(x, y) {
    const r = Math.hypot(x, y);
    let best = Infinity;
    for (const key of RING_KEYS) best = Math.min(best, Math.abs(r - REAL[key]));
    if (r > REAL.bullOut && r <= 1) {
      let rel = Math.atan2(y, x) - (-Math.PI / 2 - WEDGE / 2);
      while (rel < 0) rel += Math.PI * 2;
      const off = rel % WEDGE;
      best = Math.min(best, r * Math.sin(Math.min(off, WEDGE - off)));
    }
    return best;
  }

  // Ring by ring, a straight stretch from one board's radii to the other's, so a point keeps its
  // number and ring. Off the board (past 1) nothing changes.
  function remapRadius(r, from, to) {
    if (!(r > 0)) return 0;
    let r0 = 0, t0 = 0;
    for (const key of RING_KEYS) {
      const r1 = from[key], t1 = to[key];
      if (r <= r1) return t0 + ((r - r0) * (t1 - t0)) / (r1 - r0);
      r0 = r1; t0 = t1;
    }
    return r;
  }

  function realToApp(p) {
    const r = Math.hypot(p.x, p.y);
    if (!r) return { x: 0, y: 0 };
    const k = remapRadius(r, REAL, APP) / r;
    return { x: p.x * k, y: p.y * k };
  }

  function appToReal(p) {
    const r = Math.hypot(p.x, p.y);
    if (!r) return { x: 0, y: 0 };
    const k = remapRadius(r, APP, REAL) / r;
    return { x: p.x * k, y: p.y * k };
  }

  // The wire between SEG_ORDER[i] and SEG_ORDER[i + 1], as an angle (0 is 3 o'clock, clockwise).
  const wireAngle = (i) => -Math.PI / 2 + WEDGE / 2 + i * WEDGE;
  const onEdge = (i) => ({ x: Math.cos(wireAngle(i)), y: Math.sin(wireAngle(i)) });

  // The points tapped on each camera's picture to calibrate it, in order. Four are on the outside
  // of the double ring a quarter of the way round from each other, so they are far apart in every
  // camera, and the bull ties down the middle (five points also show up a mistap).
  const CAL_POINTS = [
    { id: "20-1", short: "20 | 1", text: "Where the wire between 20 and 1 meets the outside of the double ring (top)", ...onEdge(0) },
    { id: "6-10", short: "6 | 10", text: "Where the wire between 6 and 10 meets the outside of the double ring (right)", ...onEdge(5) },
    { id: "3-19", short: "3 | 19", text: "Where the wire between 3 and 19 meets the outside of the double ring (bottom)", ...onEdge(10) },
    { id: "11-14", short: "11 | 14", text: "Where the wire between 11 and 14 meets the outside of the double ring (left)", ...onEdge(15) },
    { id: "bull", short: "Bull", text: "The centre of the bull", x: 0, y: 0 },
  ];

  // --- 3x3 matrices and homographies -------------------------------------------------------------
  // A matrix is a flat array of 9 numbers, row by row.

  function mul3(a, b) {
    const out = new Array(9);
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) out[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
    return out;
  }

  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (!det || !Number.isFinite(det)) return null;
    const inv = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d];
    return inv.map((v) => v / det);
  }

  function applyH(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    if (!w || !Number.isFinite(w)) return null;
    return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
  }

  // Least squares, by Gaussian elimination with partial pivoting. Returns null if singular.
  function solveLinear(A, b) {
    const n = b.length, M = A.map((row, i) => row.concat([b[i]]));
    for (let col = 0; col < n; col += 1) {
      let pivot = col;
      for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
      if (Math.abs(M[pivot][col]) < 1e-12) return null;
      [M[col], M[pivot]] = [M[pivot], M[col]];
      for (let r = col + 1; r < n; r += 1) {
        const f = M[r][col] / M[col][col];
        if (!f) continue;
        for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r -= 1) {
      let s = M[r][n];
      for (let c = r + 1; c < n; c += 1) s -= M[r][c] * x[c];
      x[r] = s / M[r][r];
    }
    return x;
  }

  // Moves points to be centred on 0,0 with an average distance of sqrt(2), which keeps the
  // homography's equations well conditioned whatever the picture size.
  function normalizer(pts) {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p.x; my += p.y; }
    mx /= pts.length; my /= pts.length;
    let d = 0;
    for (const p of pts) d += Math.hypot(p.x - mx, p.y - my);
    d /= pts.length;
    const s = d > 0 ? Math.SQRT2 / d : 1;
    return [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1];
  }

  // The homography that takes each of `src` to the matching `dst` (four or more pairs, best fit
  // when there are more). Null when the points cannot define one (three in a line, say).
  function homography(src, dst) {
    if (!src || !dst || src.length < 4 || src.length !== dst.length) return null;
    const Ts = normalizer(src), Td = normalizer(dst);
    const AtA = Array.from({ length: 8 }, () => new Array(8).fill(0)), Atb = new Array(8).fill(0);
    const add = (row, rhs) => {
      for (let i = 0; i < 8; i += 1) {
        Atb[i] += row[i] * rhs;
        for (let j = 0; j < 8; j += 1) AtA[i][j] += row[i] * row[j];
      }
    };
    for (let k = 0; k < src.length; k += 1) {
      const s = applyH(Ts, src[k].x, src[k].y), d = applyH(Td, dst[k].x, dst[k].y);
      add([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y], d.x);
      add([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y], d.y);
    }
    const h = solveLinear(AtA, Atb);
    if (!h) return null;
    const TdInv = inv3(Td);
    if (!TdInv) return null;
    const H = mul3(mul3(TdInv, h.concat([1])), Ts);
    if (!H.every(Number.isFinite) || Math.abs(H[8]) < 1e-15) return null;
    return H.map((v) => v / H[8]);
  }

  // The calibration for one camera from the pixels tapped for CAL_POINTS (in order; null for a
  // point not tapped). `error` is how far, on average, the tapped points sit from where the fit
  // puts them, in millimetres on the board. More than about 3 mm means a point was mistapped.
  function calibrate(tapped, width, height) {
    const src = [], dst = [];
    CAL_POINTS.forEach((point, i) => {
      if (tapped[i]) { src.push(tapped[i]); dst.push({ x: point.x, y: point.y }); }
    });
    const H = homography(src, dst);
    if (!H) return null;
    let sum = 0;
    src.forEach((p, i) => {
      const q = applyH(H, p.x, p.y);
      sum += q ? Math.hypot(q.x - dst[i].x, q.y - dst[i].y) ** 2 : 1;
    });
    return { H, width, height, points: tapped.map((p) => (p ? { x: p.x, y: p.y } : null)), error: Math.sqrt(sum / src.length) * MM.edge };
  }

  // --- a camera's view of the board ----------------------------------------------------------------

  // The part of one camera's picture that is worth looking at, sized for working on quickly.
  //
  // `cal` is a calibration (H maps a pixel of a picture cal.width x cal.height to the board). The
  // view crops the picture (frameW x frameH, which can be another size of the same picture) to the
  // board and a margin around it (out to `roiR` board radii), scaled so its longer side is at most
  // `maxSide` pixels (640 keeps about 1.5 pixels per millimetre of board from a 720p camera).
  // `center` is where the camera's lens points in the calibrated picture, if not its middle. Frames handed to the detector are that crop: { data (RGBA), width, height }.
  function makeView(cal, frameW, frameH, options) {
    const o = Object.assign({ roiR: 1.2, maxSide: 640 }, options);
    let H = cal.H;
    if (cal.width && cal.height && (cal.width !== frameW || cal.height !== frameH)) {
      H = mul3(H, [cal.width / frameW, 0, 0, 0, cal.height / frameH, 0, 0, 0, 1]);
    }
    const Hi = inv3(H);
    if (!Hi) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < 96; k += 1) {
      const a = (k / 96) * Math.PI * 2;
      const p = applyH(Hi, Math.cos(a) * o.roiR, Math.sin(a) * o.roiR);
      if (!p) continue;
      x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(frameW, Math.ceil(x1)); y1 = Math.min(frameH, Math.ceil(y1));
    if (!(x1 - x0 >= 8 && y1 - y0 >= 8)) return null;
    const sw = x1 - x0, sh = y1 - y0;
    const scale = Math.min(1, o.maxSide / Math.max(sw, sh));
    const width = Math.max(8, Math.round(sw * scale)), height = Math.max(8, Math.round(sh * scale));
    // The middle of crop pixel (ax, ay) is picture pixel (x0 + (ax + 0.5) * sw / width, ...).
    const kx = sw / width, ky = sh / height;
    const Ha = mul3(H, [kx, 0, x0 + 0.5 * kx, 0, ky, y0 + 0.5 * ky, 0, 0, 1]);
    const Hai = inv3(Ha);
    const n = width * height;
    const bx = new Float32Array(n), by = new Float32Array(n), roi = new Uint8Array(n);
    for (let ay = 0; ay < height; ay += 1) {
      for (let ax = 0; ax < width; ax += 1) {
        const i = ay * width + ax, p = applyH(Ha, ax, ay);
        if (!p) continue;
        bx[i] = p.x; by[i] = p.y;
        if (Math.hypot(p.x, p.y) <= o.roiR) roi[i] = 1;
      }
    }
    // Crop pixels per board radius, around the middle of the board.
    const c = applyH(Hai, 0, 0), ex = applyH(Hai, 0.2, 0), ey = applyH(Hai, 0, 0.2);
    const pxPerR = c && ex && ey ? (Math.hypot(ex.x - c.x, ex.y - c.y) + Math.hypot(ey.x - c.x, ey.y - c.y)) / 0.4 : Math.min(width, height) / 2;
    const pose = cameraPose(cal.H, cal.width || frameW, cal.height || frameH, o.center);
    const view = { crop: { sx: x0, sy: y0, sw, sh }, width, height, H: Ha, Hinv: Hai, bx, by, roi, pxPerR, roiR: o.roiR, frameW, frameH, pose };
    finishRoi(view);
    return view;
  }

  function finishRoi(view) {
    let count = 0;
    for (let i = 0; i < view.roi.length; i += 1) count += view.roi[i];
    const idx = new Int32Array(count);
    for (let i = 0, k = 0; i < view.roi.length; i += 1) if (view.roi[i]) idx[k++] = i;
    view.roiIdx = idx;
    view.roiCount = count;
  }

  // For a picture holding two cameras side by side (OBS): the middle of the half this calibration's
  // board is in, which is where that camera's lens points.
  function halfCenter(cal) {
    const Hi = inv3(cal.H), c = Hi && applyH(Hi, 0, 0);
    const w = cal.width, h = cal.height;
    if (!c || !w || !h) return null;
    return { x: c.x < w / 2 ? w / 4 : (w * 3) / 4, y: h / 2 };
  }

  // Two views cut from the same picture (OBS showing both cameras side by side, say) must not both
  // watch the same pixels: each keeps only the pixels nearer (in board radii) to its own board.
  function separateViews(a, b) {
    const toFrame = (view, i) => {
      const ax = i % view.width, ay = (i / view.width) | 0;
      return { x: view.crop.sx + ((ax + 0.5) * view.crop.sw) / view.width, y: view.crop.sy + ((ay + 0.5) * view.crop.sh) / view.height };
    };
    const radiusIn = (view, p) => {
      const ax = ((p.x - view.crop.sx) * view.width) / view.crop.sw - 0.5, ay = ((p.y - view.crop.sy) * view.height) / view.crop.sh - 0.5;
      const q = applyH(view.H, ax, ay);
      return q ? Math.hypot(q.x, q.y) : Infinity;
    };
    for (const [mine, other] of [[a, b], [b, a]]) {
      for (const i of mine.roiIdx) {
        const p = toFrame(mine, i);
        const rOther = radiusIn(other, p);
        if (rOther < Math.hypot(mine.bx[i], mine.by[i])) mine.roi[i] = 0;
      }
    }
    finishRoi(a);
    finishRoi(b);
  }

  // --- what changed between two frames -------------------------------------------------------------

  const DEFAULTS = {
    threshold: 30, // a pixel has changed when a colour channel moves by more than this (0-255)
    motionThreshold: 26, // the same, between one frame and the next, to tell when things hold still
    shadow: true, // ignore pixels that only got darker, keeping their colour (a dart's shadow)
    shadowLo: 0.5,
    shadowHi: 0.92,
    shadowChroma: 0.07,
    stillFrames: 3, // frames in a row with nothing moving before a change is read
    minSettleMs: 250,
    refreshMs: 4000, // with nothing going on, the "before" picture is refreshed this often (light drifts)
    // Sizes as fractions of (crop pixels per board radius) squared, so they suit any camera distance.
    changeArea: 0.003, // this much change starts a look
    motionArea: 0.0012, // less movement than this between frames counts as still
    blobArea: 0.0006, // smaller specks of change are ignored
    dartArea: 0.004, // a new dart changes at least this much
    joinGap: 0.15, // pieces of change this close together (board radii, in crop pixels) are one dart
    thickR: 0.03, // parts of a dart thicker than this (board radii) are flight, not point or barrel
    runGapR: 0.35, // a gap this long along the dart's line splits it (board radii)
    // A share of everything watched: more change than this is a hand or a body, not a dart.
    bigShare: 0.09,
    emptyArea: 0.006, // the board counts as clear when it differs from the empty board by less
  };

  // Brightness drift between two frames (the camera adjusting its exposure, a cloud): the middle
  // value of new/old brightness over a sample of the board, so a hand over part of it barely counts.
  function gainOf(ref, cur, view) {
    const hist = new Uint32Array(97);
    let n = 0;
    const idx = view.roiIdx;
    for (let k = 0; k < idx.length; k += 5) {
      const i = idx[k] << 2;
      const a = ref[i] + ref[i + 1] + ref[i + 2], b = cur[i] + cur[i + 1] + cur[i + 2];
      if (a < 45 || b < 45) continue;
      const bin = Math.round((Math.log2(b / a) + 1.5) * 32);
      hist[Math.max(0, Math.min(96, bin))] += 1;
      n += 1;
    }
    if (n < 40) return 1;
    let seen = 0;
    for (let bin = 0; bin < hist.length; bin += 1) {
      seen += hist[bin];
      if (seen * 2 >= n) return Math.pow(2, bin / 32 - 1.5);
    }
    return 1;
  }

  // How many pixels changed (a sample of every `step`th one, scaled back up).
  function countChanged(a, b, view, threshold, step, gain) {
    let n = 0;
    const idx = view.roiIdx, g = gain || 1;
    for (let k = 0; k < idx.length; k += step) {
      const i = idx[k] << 2;
      const d = Math.max(Math.abs(b[i] - a[i] * g), Math.abs(b[i + 1] - a[i + 1] * g), Math.abs(b[i + 2] - a[i + 2] * g));
      if (d > threshold) n += 1;
    }
    return n * step;
  }

  // The changed pixels, as a mask the size of the crop (1 = changed), with lone specks removed.
  function diffMask(ref, cur, view, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const g = gainOf(ref, cur, view);
    const n = view.width * view.height, raw = new Uint8Array(n);
    const idx = view.roiIdx, T = o.threshold;
    for (let k = 0; k < idx.length; k += 1) {
      const p = idx[k], i = p << 2;
      const r0 = ref[i] * g, g0 = ref[i + 1] * g, b0 = ref[i + 2] * g;
      const r1 = cur[i], g1 = cur[i + 1], b1 = cur[i + 2];
      if (Math.max(Math.abs(r1 - r0), Math.abs(g1 - g0), Math.abs(b1 - b0)) <= T) continue;
      if (o.shadow) {
        const s0 = r0 + g0 + b0, s1 = r1 + g1 + b1;
        if (s0 > 120 && s1 > s0 * o.shadowLo && s1 < s0 * o.shadowHi) {
          const chroma = Math.abs(r1 / s1 - r0 / s0) + Math.abs(g1 / s1 - g0 / s0) + Math.abs(b1 / s1 - b0 / s0);
          if (chroma < o.shadowChroma) continue;
        }
      }
      raw[p] = 1;
    }
    // Keep a pixel only if at least two of its eight neighbours changed too. Thin lines (a barrel
    // seen from far off) survive; camera noise, which comes in single pixels, does not.
    const w = view.width, h = view.height, mask = new Uint8Array(n);
    let count = 0;
    for (let y = 1; y < h - 1; y += 1) {
      for (let x = 1; x < w - 1; x += 1) {
        const i = y * w + x;
        if (!raw[i]) continue;
        const s = raw[i - w - 1] + raw[i - w] + raw[i - w + 1] + raw[i - 1] + raw[i + 1] + raw[i + w - 1] + raw[i + w] + raw[i + w + 1];
        if (s >= 2) { mask[i] = 1; count += 1; }
      }
    }
    return { mask, count, gain: g };
  }

  // Connected pieces of a mask (8-connected), biggest first, each { pixels, area, x0, y0, x1, y1 }.
  function components(mask, w, h, minArea) {
    const seen = new Uint8Array(mask.length), stack = new Int32Array(mask.length), out = [];
    for (let start = 0; start < mask.length; start += 1) {
      if (!mask[start] || seen[start]) continue;
      let top = 0, size = 0;
      stack[top++] = start; seen[start] = 1;
      const pixels = [];
      let x0 = w, y0 = h, x1 = 0, y1 = 0;
      while (top) {
        const i = stack[--top];
        pixels.push(i); size += 1;
        const x = i % w, y = (i / w) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy += 1) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx += 1) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (mask[j] && !seen[j]) { seen[j] = 1; stack[top++] = j; }
          }
        }
      }
      if (size >= minArea) out.push({ pixels, area: size, x0, y0, x1, y1 });
    }
    return out.sort((a, b) => b.area - a.area);
  }

  // The biggest piece and every piece near it: one dart often shows as a few (the point, the
  // barrel, the flight) where parts of it match the board behind.
  function dartCluster(parts, gap) {
    if (!parts.length) return null;
    const box = { x0: parts[0].x0, y0: parts[0].y0, x1: parts[0].x1, y1: parts[0].y1 };
    const used = new Set([0]);
    let grew = true;
    while (grew) {
      grew = false;
      parts.forEach((part, i) => {
        if (used.has(i)) return;
        const dx = Math.max(0, box.x0 - part.x1, part.x0 - box.x1), dy = Math.max(0, box.y0 - part.y1, part.y0 - box.y1);
        if (Math.hypot(dx, dy) > gap) return;
        used.add(i); grew = true;
        box.x0 = Math.min(box.x0, part.x0); box.y0 = Math.min(box.y0, part.y0);
        box.x1 = Math.max(box.x1, part.x1); box.y1 = Math.max(box.y1, part.y1);
      });
    }
    const pixels = [];
    used.forEach((i) => { for (const p of parts[i].pixels) pixels.push(p); });
    return { pixels, area: pixels.length, box, pieces: used.size };
  }

  // --- one dart, as one camera sees it --------------------------------------------------------------

  // Distance (in pixels, chamfer 3-4) from each set pixel of m (w x h) to the nearest unset one.
  // With `outsideUnset`, everything beyond the edges counts as unset too.
  function insideDistance(m, w, h, outsideUnset) {
    const d = new Float32Array(w * h), BIG = 1e9;
    for (let i = 0; i < d.length; i += 1) d[i] = m[i] ? BIG : 0;
    const edge = outsideUnset ? 3 : BIG;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = y * w + x;
        if (!d[i]) continue;
        let v = d[i];
        v = Math.min(v, x > 0 ? d[i - 1] + 3 : edge);
        if (y > 0) {
          v = Math.min(v, d[i - w] + 3);
          if (x > 0) v = Math.min(v, d[i - w - 1] + 4);
          if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4);
        } else v = Math.min(v, edge);
        d[i] = v;
      }
    }
    for (let y = h - 1; y >= 0; y -= 1) {
      for (let x = w - 1; x >= 0; x -= 1) {
        const i = y * w + x;
        if (!d[i]) continue;
        let v = d[i];
        v = Math.min(v, x < w - 1 ? d[i + 1] + 3 : edge);
        if (y < h - 1) {
          v = Math.min(v, d[i + w] + 3);
          if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4);
          if (x > 0) v = Math.min(v, d[i + w - 1] + 4);
        } else v = Math.min(v, edge);
        d[i] = v;
      }
    }
    for (let i = 0; i < d.length; i += 1) d[i] /= 3;
    return d;
  }

  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Best-fit line (through the mean, along the main direction) of the points listed in `idx`.
  function pcaLine(xs, ys, idx) {
    let mx = 0, my = 0;
    for (const i of idx) { mx += xs[i]; my += ys[i]; }
    mx /= idx.length; my /= idx.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const i of idx) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { x: mx, y: my, ux: Math.cos(theta), uy: Math.sin(theta) };
  }

  // The dart's line and both of its ends, in crop pixels, from its pixels.
  //
  // A dart from the side is thin parts (point, barrel, shaft) and a flight, whose wings can be
  // anything from a broad shape (seen face-on) to a thin line (seen edge-on, which lies exactly on
  // the dart's line). A broad wing can be bigger than the rest and skew any fit of the whole shape,
  // so the line is fitted to the thin parts only: everything left after taking away what is
  // thicker than `thick` pixels, with a robust (RANSAC) fit so stray bits don't pull it.
  //
  // Which end is the point is decided later (by the other camera, or by where this camera sits);
  // `preferStart` is the guess from the shape alone: the point is the end farther from the thick
  // part (the barrel and shaft are longer than a flight sticks out past its widest part).
  function fitStreak(pixels, w, options) {
    const o = Object.assign({ thick: 4, gap: 60, tol: 1.6 }, options);
    const n = pixels.length;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const p of pixels) {
      const x = p % w, y = (p / w) | 0;
      if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y;
    }
    const bw = bx1 - bx0 + 3, bh = by1 - by0 + 3;
    const m = new Uint8Array(bw * bh);
    for (const p of pixels) m[((((p / w) | 0) - by0 + 1) * bw) + (p % w) - bx0 + 1] = 1;
    const dIn = insideDistance(m, bw, bh, true);
    const notCore = new Uint8Array(bw * bh);
    let cores = 0;
    for (let i = 0; i < m.length; i += 1) {
      if (m[i] && dIn[i] > o.thick) cores += 1;
      else notCore[i] = 1;
    }
    const dCore = cores ? insideDistance(notCore, bw, bh, false) : null;
    const xs = [], ys = [], thin = [];
    for (let i = 0; i < m.length; i += 1) {
      if (!m[i]) continue;
      const k = xs.length;
      xs.push((i % bw) + bx0 - 1); ys.push(((i / bw) | 0) + by0 - 1);
      // Not the fringe the opening leaves along the edge of a thick part, either.
      if (!dCore || (dIn[i] <= o.thick && dCore[i] > o.thick + 2.5)) thin.push(k);
    }
    const all = xs.map((_, i) => i);
    const blob = { length: 0, ok: false, thinCount: thin.length, cores };
    const whole = pcaLine(xs, ys, all);
    blob.tip = { x: whole.x, y: whole.y };
    blob.dir = { x: whole.ux, y: whole.uy };
    if (n < 6) return blob;

    // RANSAC for the dart's line. Point, barrel, shaft and flight all sit on it, so of the lines
    // through two of the dart's pixels it is the one along which those pixels run furthest without
    // a gap; the edge or the diagonal of a flight is much shorter. Pairs with a thin pixel in them
    // (the barrel) are tried more often.
    const every = Math.max(1, Math.ceil(all.length / 1200));
    const pick = every > 1 ? all.filter((_, i) => i % every === 0) : all;
    const band = Math.max(o.tol, o.thick * 0.6);
    const reach = (line, gap) => {
      const ss = [];
      for (const k of pick) {
        const dx = xs[k] - line.x, dy = ys[k] - line.y;
        if (Math.abs(-dx * line.uy + dy * line.ux) <= band) ss.push(dx * line.ux + dy * line.uy);
      }
      const out = { len: 0, a: 0, b: 0, count: ss.length };
      if (ss.length < 3) return out;
      ss.sort((p, q) => p - q);
      let start = 0;
      for (let i = 1; i <= ss.length; i += 1) {
        if (i === ss.length || ss[i] - ss[i - 1] > gap) {
          const len = ss[i - 1] - ss[start];
          if (len > out.len) { out.len = len; out.a = ss[start]; out.b = ss[i - 1]; }
          start = i;
        }
      }
      return out;
    };
    const rand = seeded(n * 7919 + thin.length);
    const scoreGap = Math.max(4, o.gap * 0.35);
    let line = whole, best = reach(whole, scoreGap), bestScore = best.len + 0.02 * best.count;
    for (let it = 0; it < 220; it += 1) {
      const i = thin.length >= 6 && it % 2 ? thin[(rand() * thin.length) | 0] : all[(rand() * all.length) | 0];
      const j = all[(rand() * all.length) | 0];
      const dx = xs[j] - xs[i], dy = ys[j] - ys[i], len = Math.hypot(dx, dy);
      if (len < 4) continue;
      const cand = { x: xs[i], y: ys[i], ux: dx / len, uy: dy / len };
      const r = reach(cand, scoreGap), score = r.len + 0.02 * r.count;
      if (score > bestScore) { bestScore = score; best = r; line = cand; }
    }
    // Straighten it through the middle of the pixels along it.
    for (let round = 0; round < 2; round += 1) {
      const inl = [];
      for (const k of all) {
        const dx = xs[k] - line.x, dy = ys[k] - line.y, sk = dx * line.ux + dy * line.uy;
        if (Math.abs(-dx * line.uy + dy * line.ux) <= band && sk >= best.a - 1 && sk <= best.b + 1) inl.push(k);
      }
      if (inl.length < 3) break;
      const fit = pcaLine(xs, ys, inl);
      if (fit.ux * line.ux + fit.uy * line.uy < 0) { fit.ux = -fit.ux; fit.uy = -fit.uy; }
      line = fit;
      best = reach(line, scoreGap);
    }
    // The pixels on the line, along it; the longest stretch without a long gap is the dart.
    const on = all.filter((k) => Math.abs(-(xs[k] - line.x) * line.uy + (ys[k] - line.y) * line.ux) <= band);
    const along = on.map((k) => (xs[k] - line.x) * line.ux + (ys[k] - line.y) * line.uy).sort((p, q) => p - q);
    if (along.length < 3) return blob;
    let runStart = 0, bestRun = [0, 0];
    for (let i = 1; i <= along.length; i += 1) {
      if (i === along.length || along[i] - along[i - 1] > scoreGap) {
        if (along[i - 1] - along[runStart] > (along[bestRun[1] - 1] || 0) - (along[bestRun[0]] || 0) || bestRun[1] === 0) bestRun = [runStart, i];
        runStart = i;
      }
    }
    const run = along.slice(bestRun[0], bestRun[1]);
    const inset = Math.min(2, Math.floor((run.length - 1) / 2));
    const sA = run[inset], sB = run[run.length - 1 - inset];
    const A = { x: line.x + line.ux * sA, y: line.y + line.uy * sA }, B = { x: line.x + line.ux * sB, y: line.y + line.uy * sB };
    blob.length = sB - sA;
    blob.runPixels = run.length;
    if (blob.length < 4) return blob;
    // Shape-only guess at the point: the end farther from the thick part.
    let preferStart = true;
    if (dCore) {
      const coreDist = (p) => {
        const i = (Math.round(p.y) - by0 + 1) * bw + Math.round(p.x) - bx0 + 1;
        return i >= 0 && i < dCore.length && notCore[i] ? dCore[i] : 0;
      };
      preferStart = coreDist(A) >= coreDist(B);
    }
    if (o.debug) blob.debug = { thin: thin.map((k) => [xs[k], ys[k]]), on: on.map((k) => [xs[k], ys[k]]), line };
    const endA = { tip: A, dir: { x: line.ux, y: line.uy }, thin: run.length };
    const endB = { tip: B, dir: { x: -line.ux, y: -line.uy }, thin: run.length };
    const main = preferStart ? endA : endB, other = preferStart ? endB : endA;
    blob.tip = main.tip;
    blob.dir = main.dir;
    blob.thin = run.length;
    blob.other = other;
    blob.ok = true;
    return blob;
  }

  // Everything one camera can say about a new dart, from the "before" and "after" frames.
  function readView(view, mask, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const R2 = view.pxPerR * view.pxPerR;
    const parts = components(mask, view.width, view.height, Math.max(4, o.blobArea * R2));
    const cluster = dartCluster(parts, o.joinGap * view.pxPerR);
    const out = { ok: false, area: cluster ? cluster.area : 0, pieces: cluster ? cluster.pieces : 0, cluster };
    if (!cluster || cluster.area < o.dartArea * R2) return Object.assign(out, { reason: "nothing new" });
    const streak = fitStreak(cluster.pixels, view.width, { thick: Math.max(2, o.thickR * view.pxPerR), gap: o.runGapR * view.pxPerR });
    const lengthR = streak.length / view.pxPerR;
    // One end of the streak taken as the point, on the board: where it is, and which way the
    // dart's line runs from there toward the flight.
    const onBoard = (end) => {
      const tip = applyH(view.H, end.tip.x, end.tip.y);
      if (!tip) return null;
      const step = Math.max(6, streak.length * 0.25);
      const along = applyH(view.H, end.tip.x + end.dir.x * step, end.tip.y + end.dir.y * step);
      let dir = null;
      if (along) {
        const len = Math.hypot(along.x - tip.x, along.y - tip.y);
        if (len > 1e-9) dir = { x: (along.x - tip.x) / len, y: (along.y - tip.y) / len };
      }
      return { tip, dir, lineOk: streak.ok && !!dir && end.thin >= 4 && lengthR >= 0.05, tipPx: end.tip, dirPx: end.dir };
    };
    let main = onBoard(streak);
    if (!main) return Object.assign(out, { reason: "off the picture" });
    let other = streak.ok && streak.other ? onBoard(streak.other) : null;
    // Which end is the point, from where the camera is: anything standing off the board lands
    // farther from the camera's spot on the board (straight below it) than the point does, so the
    // streak runs away from that spot, starting at the point. `endSure` is how clear that is.
    let endSure = 0.3;
    if (view.pose && other && main.dir && other.dir) {
      const away = (end) => {
        const fx = end.tip.x - view.pose.x, fy = end.tip.y - view.pose.y, len = Math.hypot(fx, fy) || 1;
        return (end.dir.x * fx + end.dir.y * fy) / len;
      };
      const a = away(main), b = away(other);
      if (b > a) [main, other] = [other, main];
      endSure = Math.min(1, Math.abs(a - b) / 1.2);
    }
    // How sure: a long, straight line of thin pixels, and a clear point end.
    const quality = Math.max(0.05, Math.min(1, (main.lineOk ? 0.45 : 0.1) + 0.35 * endSure + Math.min(0.2, lengthR * 0.4)));
    // The dart's pixels on the board (at most ~1500 of them), for `fuse` to find where cameras agree.
    const every = Math.max(1, Math.ceil(cluster.pixels.length / 1500));
    const board = new Float32Array(Math.ceil(cluster.pixels.length / every) * 2);
    for (let k = 0, j = 0; k < cluster.pixels.length; k += every, j += 2) {
      board[j] = view.bx[cluster.pixels[k]]; board[j + 1] = view.by[cluster.pixels[k]];
    }
    return Object.assign(out, main, {
      board,
      ok: true,
      other,
      quality,
      endSure,
      lengthR,
      lengthPx: streak.length,
      thinCount: streak.thinCount,
    });
  }

  // Where the camera is, from its calibration (H maps pixels of a picture width x height to the
  // board), assuming square pixels and the lens centred on the picture, as webcams have (or on
  // `center`, for a camera that is only part of the picture, like one half of OBS's). Returns
  // { x, y } (the spot on the board straight below the camera), `height` (how far out from the
  // board it is) in board radii, and `f`, the focal length in pixels. Null when the camera faces
  // the board too squarely to tell (then it does not matter much which way streaks run).
  function cameraPose(H, width, height, center) {
    const G = inv3(H); // board to picture
    if (!G) return null;
    const cx = center ? center.x : width / 2, cy = center ? center.y : height / 2;
    const col = (j) => ({ u: G[j] - cx * G[6 + j], v: G[3 + j] - cy * G[6 + j], w: G[6 + j] });
    const c1 = col(0), c2 = col(1), c3 = col(2);
    // The board's x and y axes, seen by the camera, must be at right angles and the same length:
    // two ways to get the focal length. Use whichever the camera's angle makes better defined.
    const scale = Math.max(Math.abs(c1.w), Math.abs(c2.w), 1e-12) ** 2;
    const den1 = c1.w * c2.w, den2 = c2.w * c2.w - c1.w * c1.w;
    let f2 = NaN;
    if (Math.abs(den1) >= Math.abs(den2) && Math.abs(den1) > scale * 1e-3) f2 = -(c1.u * c2.u + c1.v * c2.v) / den1;
    else if (Math.abs(den2) > scale * 1e-3) f2 = (c1.u * c1.u + c1.v * c1.v - c2.u * c2.u - c2.v * c2.v) / den2;
    if (!(f2 > 0)) return null;
    const f = Math.sqrt(f2);
    if (f < width * 0.2 || f > width * 6) return null;
    const k1 = [c1.u / f, c1.v / f, c1.w], k2 = [c2.u / f, c2.v / f, c2.w], k3 = [c3.u / f, c3.v / f, c3.w];
    const len = (v) => Math.hypot(v[0], v[1], v[2]);
    let lam = 2 / (len(k1) + len(k2));
    if (k3[2] * lam < 0) lam = -lam; // the board is in front of the camera
    const r1 = k1.map((v) => v * lam), r2 = k2.map((v) => v * lam), t = k3.map((v) => v * lam);
    const r3 = [r1[1] * r2[2] - r1[2] * r2[1], r1[2] * r2[0] - r1[0] * r2[2], r1[0] * r2[1] - r1[1] * r2[0]];
    const dotT = (r) => r[0] * t[0] + r[1] * t[1] + r[2] * t[2];
    const C = [-dotT(r1), -dotT(r2), -dotT(r3)];
    // Board z (x right cross y down) points into the board, so a camera in front has negative z.
    if (!(C[2] < 0)) return null;
    return { x: C[0], y: C[1], height: -C[2], f };
  }

  // --- both cameras together ---------------------------------------------------------------------------

  const SIN_MIN_ANGLE = Math.sin((12 * Math.PI) / 180);

  // How far q is from the nearest of a camera's dart pixels on the board (at most `cap`).
  function nearestOn(board, q, cap) {
    let best = cap * cap;
    for (let j = 0; j < board.length; j += 2) {
      const dx = board[j] - q.x, dy = board[j + 1] - q.y, d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // Where both cameras' darts cover the same bit of board, as the middles of those patches,
  // biggest first. That is where the point is: everything that stands off the board lands in
  // different places for two cameras in different places.
  function overlaps(a, b, cell) {
    const half = 1.3, size = Math.ceil((half * 2) / cell);
    const grid = new Uint8Array(size * size);
    const mark = (board, bit) => {
      for (let j = 0; j < board.length; j += 2) {
        const gx = Math.floor((board[j] + half) / cell), gy = Math.floor((board[j + 1] + half) / cell);
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const x = gx + dx, y = gy + dy;
            if (x >= 0 && y >= 0 && x < size && y < size) grid[y * size + x] |= bit;
          }
        }
      }
    };
    mark(a, 1);
    mark(b, 2);
    const seen = new Uint8Array(size * size), out = [], stack = [];
    for (let start = 0; start < grid.length; start += 1) {
      if (grid[start] !== 3 || seen[start]) continue;
      let sx = 0, sy = 0, cells = 0;
      stack.push(start); seen[start] = 1;
      while (stack.length) {
        const i = stack.pop(), x = i % size, y = (i / size) | 0;
        sx += x; sy += y; cells += 1;
        for (const j of [i - 1, i + 1, i - size, i + size]) {
          if (j < 0 || j >= grid.length || seen[j] || grid[j] !== 3) continue;
          if (Math.abs((j % size) - x) > 1) continue;
          seen[j] = 1; stack.push(j);
        }
      }
      out.push({ x: ((sx / cells) + 0.5) * cell - half, y: ((sy / cells) + 0.5) * cell - half, cells });
    }
    return out.sort((p, q) => q.cells - p.cells);
  }

  const lineGap = (r, q) => Math.abs(-(q.x - r.tip.x) * r.dir.y + (q.y - r.tip.y) * r.dir.x);

  // Where two lines (a point and a direction each) cross, or null if they are too near parallel.
  function crossing(a, b) {
    if (!a.dir || !b.dir) return null;
    const cross = a.dir.x * b.dir.y - a.dir.y * b.dir.x;
    if (Math.abs(cross) < SIN_MIN_ANGLE) return null;
    const dx = b.tip.x - a.tip.x, dy = b.tip.y - a.tip.y;
    const s = (dx * b.dir.y - dy * b.dir.x) / cross, t = (dx * a.dir.y - dy * a.dir.x) / cross;
    return { x: a.tip.x + s * a.dir.x, y: a.tip.y + s * a.dir.y, s, t, angle: Math.asin(Math.min(1, Math.abs(cross))) };
  }

  // One position from what each camera read.
  //
  // With two cameras, the point is the one place on the board where both see dart: the point goes
  // into the board, and the rest of the dart stands off it, so it lands in different places for
  // cameras in different places. The candidates are each camera's two line ends, where the two
  // lines cross, and where the two darts overlap on the board; the winner is the one closest to
  // dart in both cameras and to an end of each streak. Then, if both lines run through it, their
  // crossing gives the exact spot (the end of a streak is less exact: the steel point is thin and
  // often lost against the board).
  function fuse(readings, options) {
    const o = Object.assign({ cell: 0.006, endPenalty: 0.02, snap: 0.035, unsure: 0.05 }, options);
    const good = readings.map((r, i) => (r && r.ok ? Object.assign({ camera: i }, r) : null)).filter(Boolean).sort((x, y) => y.quality - x.quality);
    if (!good.length) return null;
    const result = (point, method, extra) => {
      const real = { x: point.x, y: point.y };
      const hit = classify(real.x, real.y, REAL);
      const near = wireDistance(real.x, real.y) < 0.012; // within 2 mm of a wire
      return Object.assign({ real, app: realToApp(real), label: hit.label, target: hit.target, ring: hit.ring, points: hit.points, method, cameras: good.length, nearWire: near }, extra);
    };
    if (good.length === 1) {
      const r = good[0];
      return result(r.tip, "one camera", { uncertain: r.quality < 0.6, confidence: r.quality * 0.8, labels: [classify(r.tip.x, r.tip.y, REAL).label] });
    }
    const [a, b] = good;
    const endsOf = (r) => [{ tip: r.tip, flipped: 0 }].concat(r.other ? [{ tip: r.other.tip, flipped: 1 }] : []);
    const EA = endsOf(a), EB = endsOf(b);
    const cands = [];
    for (const e of EA.concat(EB)) cands.push({ p: e.tip, from: "end", penalty: o.endPenalty * e.flipped });
    const cr = a.lineOk && b.lineOk ? crossing(a, b) : null;
    if (cr) cands.push({ p: cr, from: "crossing", penalty: 0 });
    for (const patch of overlaps(a.board, b.board, o.cell).slice(0, 4)) cands.push({ p: patch, from: "overlap", penalty: 0 });
    const cap = 0.25;
    const toEnd = (E, q) => Math.min(cap, ...E.map((e) => Math.hypot(e.tip.x - q.x, e.tip.y - q.y)));
    let best = null;
    for (const c of cands) {
      const cost = nearestOn(a.board, c.p, cap) + nearestOn(b.board, c.p, cap) + 0.25 * (toEnd(EA, c.p) + toEnd(EB, c.p)) + c.penalty;
      if (!best || cost < best.cost) best = Object.assign({ cost }, c);
    }
    let point = best.p, method = best.from;
    // Pin it down with the crossing of the two lines, if both run through it.
    if (cr && best.from !== "crossing" && lineGap(a, point) < o.snap && lineGap(b, point) < o.snap && Math.hypot(cr.x - point.x, cr.y - point.y) < o.snap * 1.5) {
      point = cr; method = "crossing";
    }
    const labels = [a, b].map((r) => {
      const ends = endsOf(r).sort((e, f) => Math.hypot(e.tip.x - point.x, e.tip.y - point.y) - Math.hypot(f.tip.x - point.x, f.tip.y - point.y));
      return classify(ends[0].tip.x, ends[0].tip.y, REAL).label;
    });
    const uncertain = best.cost > o.unsure;
    return result(point, method, {
      uncertain,
      confidence: Math.max(0.05, Math.min(1, 1 - best.cost * 6)),
      cost: best.cost,
      labels,
      flipped: best.from === "end" && best.penalty > 0,
    });
  }

  // --- watching for darts ----------------------------------------------------------------------------

  // Feed it a frame from every view, over and over (about 10 a second is plenty). It answers with
  // events:
  //   { type: "ready" }                       first frames in; the board as it is now is the start
  //   { type: "moving" }                      something changed; waiting for it to hold still
  //   { type: "dart", real, app, label, ... } a new dart, with what each camera read in `readings`
  //   { type: "unreadable", readings }        something dart-sized changed but no camera could read it
  //   { type: "takeout", darts }              the darts were pulled out: the board is clear again
  //   { type: "blocked" }                     a big change (a hand, a person) that left no new dart
  //   { type: "quiet" }                       a change too small to be a dart (it may have bounced out)
  function createDetector(views, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const cams = views.map((view) => ({ view, ref: null, prev: null, empty: null, R2: view.pxPerR * view.pxPerR }));
    let state = "start", still = 0, movedAt = 0, refreshedAt = 0, darts = 0;
    let last = null; // what the last read was made from, for saving test pictures

    const take = (frames) => frames.map((f) => f.data);

    function read(cur, now) {
      const events = [];
      state = "watching"; refreshedAt = now;
      const masks = cams.map((c, i) => diffMask(c.ref, cur[i], c.view, o));
      const big = cams.some((c, i) => masks[i].count > o.bigShare * c.view.roiCount);
      const before = cams.map((c) => c.ref);
      last = { before, after: cur, masks: masks.map((m) => m.mask) };
      if (big) {
        const clear = cams.every((c, i) => diffMask(c.empty, cur[i], c.view, o).count < o.emptyArea * c.R2);
        cams.forEach((c, i) => { c.ref = cur[i]; if (clear) c.empty = cur[i]; });
        if (clear) {
          const n = darts;
          darts = 0;
          events.push({ type: "takeout", darts: n });
        } else events.push({ type: "blocked" });
        return events;
      }
      const readings = cams.map((c, i) => readView(c.view, masks[i].mask, o));
      cams.forEach((c, i) => { c.ref = cur[i]; });
      if (!readings.some((r, i) => r.area >= o.dartArea * cams[i].R2)) {
        events.push({ type: "quiet", readings });
        return events;
      }
      const fused = fuse(readings, o);
      if (!fused) {
        events.push({ type: "unreadable", readings });
        return events;
      }
      darts += 1;
      events.push(Object.assign({ type: "dart", index: darts, readings }, fused));
      return events;
    }

    return {
      get state() { return state; },
      get darts() { return darts; },
      get last() { return last; },
      views,
      options: o,
      // Starts over from the board as these frames show it. With `empty`, it is also the clear board
      // that tells when darts have been pulled out.
      reset(frames, empty) {
        const cur = take(frames);
        cams.forEach((c, i) => { c.ref = cur[i]; c.prev = cur[i]; if (empty || !c.empty) c.empty = cur[i]; });
        state = "watching"; still = 0; darts = 0;
      },
      markEmpty(frames) {
        const cur = take(frames);
        cams.forEach((c, i) => { c.empty = cur[i]; c.ref = cur[i]; c.prev = cur[i]; });
        darts = 0; state = "watching";
      },
      push(frames, now) {
        if (!frames || frames.length !== cams.length || frames.some((f) => !f)) return [];
        const cur = take(frames);
        if (state === "start") {
          cams.forEach((c, i) => { c.ref = cur[i]; c.prev = cur[i]; c.empty = cur[i]; });
          state = "watching"; refreshedAt = now;
          return [{ type: "ready" }];
        }
        let moving = false, changed = false;
        cams.forEach((c, i) => {
          if (countChanged(c.prev, cur[i], c.view, o.motionThreshold, 3, gainOf(c.prev, cur[i], c.view)) > o.motionArea * c.R2) moving = true;
          if (state === "watching" && countChanged(c.ref, cur[i], c.view, o.threshold, 3, gainOf(c.ref, cur[i], c.view)) > o.changeArea * c.R2) changed = true;
          c.prev = cur[i];
        });
        if (state === "watching") {
          if (!changed) {
            if (!moving && now - refreshedAt > o.refreshMs) { cams.forEach((c, i) => { c.ref = cur[i]; }); refreshedAt = now; }
            return [];
          }
          state = "settling"; movedAt = now; still = 0;
          return [{ type: "moving" }];
        }
        // settling
        still = moving ? 0 : still + 1;
        if (still < o.stillFrames || now - movedAt < o.minSettleMs) return [];
        return read(cur, now);
      },
    };
  }

  return {
    MM,
    REAL,
    APP,
    SEG_ORDER,
    CAL_POINTS,
    DEFAULTS,
    classify,
    wireDistance,
    realToApp,
    appToReal,
    mul3,
    inv3,
    applyH,
    homography,
    calibrate,
    makeView,
    separateViews,
    halfCenter,
    gainOf,
    countChanged,
    diffMask,
    components,
    fitStreak,
    cameraPose,
    readView,
    fuse,
    createDetector,
  };
});
