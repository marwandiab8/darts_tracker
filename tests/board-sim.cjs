// A pretend camera rig for testing board-vision.js without cameras: draws what a camera at a given
// spot sees of a regulation board with darts in it, so the tests know exactly where every dart is.
//
// Units are millimetres in board space: x to the right, y down, z out of the board toward the
// player, origin at the centre of the bull. A dart is { at: {x, y} (mm, where it went in), lean:
// {x, y} (how far its tail leans, as a fraction of its length, e.g. {x: 0, y: -0.3} for a tail that
// sits up) }.
const V = require("../public/board-vision.js");

const R = V.MM.edge;

function norm(v) {
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scaleV = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const addV = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

// A camera at `pos` looking at `look` (default the bull), with a picture width x height and a
// horizontal field of view in degrees. `roll` turns the picture (degrees).
function camera({ pos, look = { x: 0, y: 0, z: 0 }, width = 960, height = 540, hfov = 76, roll = 0 }) {
  const f = norm(sub(look, pos));
  // The picture's right and down follow the board's x and y as far as the camera's angle allows.
  let right = norm(sub({ x: 1, y: 0, z: 0 }, scaleV(f, f.x)));
  let down = norm(cross(f, right));
  if (down.y < 0) down = scaleV(down, -1);
  if (roll) {
    const c = Math.cos((roll * Math.PI) / 180), s = Math.sin((roll * Math.PI) / 180);
    const r2 = addV(scaleV(right, c), scaleV(down, s)), d2 = addV(scaleV(down, c), scaleV(right, -s));
    right = r2; down = d2;
  }
  const fpx = width / 2 / Math.tan((hfov * Math.PI) / 360);
  return {
    pos, f, right, down, fpx, width, height, cx: width / 2, cy: height / 2,
    project(p) {
      const v = sub(p, pos), z = dot(v, f);
      if (z <= 1) return null;
      return { x: this.cx + (this.fpx * dot(v, right)) / z, y: this.cy + (this.fpx * dot(v, down)) / z, depth: z };
    },
    // Where the ray through picture pixel (u, v) meets the board, in mm.
    onBoard(u, v) {
      const d = addV(f, addV(scaleV(right, (u - this.cx) / this.fpx), scaleV(down, (v - this.cy) / this.fpx)));
      if (d.z >= 0) return null;
      const t = -pos.z / d.z;
      return { x: pos.x + d.x * t, y: pos.y + d.y * t, dist: t * Math.hypot(d.x, d.y, d.z) };
    },
  };
}

// The colour of the board at (x, y) mm.
function boardColour(x, y) {
  const r = Math.hypot(x, y);
  if (r > 225) {
    const n = ((Math.sin(x * 0.7) * Math.cos(y * 0.9) + 1) * 6) | 0; // foam surround texture
    return [118 + n, 120 + n, 126 + n];
  }
  // Wires: thin silver lines on every ring and between the numbers.
  for (const key of ["bullIn", "bullOut", "tripleIn", "tripleOut", "doubleIn", "edge"]) {
    if (Math.abs(r - V.MM[key]) < 0.5) return [170, 170, 172];
  }
  if (r > R) return [24, 24, 26];
  const hit = V.classify(x / R, y / R, V.REAL);
  if (r > V.MM.bullOut) {
    const wedge = (Math.PI * 2) / 20;
    let rel = Math.atan2(y, x) - (-Math.PI / 2 - wedge / 2);
    while (rel < 0) rel += Math.PI * 2;
    const off = rel % wedge;
    if (Math.min(off, wedge - off) * r < 0.5) return [170, 170, 172];
  }
  if (hit.target === "BULL") return hit.ring === "D" ? [196, 32, 36] : [22, 128, 62];
  const index = V.SEG_ORDER.indexOf(Number(hit.target));
  const dark = index % 2 === 0; // the 20 is a black single with red double and treble
  if (hit.ring === "S") return dark ? [22, 22, 24] : [232, 222, 196];
  return dark ? [196, 32, 36] : [22, 128, 62];
}

// The parts of a dart along its length (mm from where it enters the board): the visible bit of the
// steel point, the barrel, the shaft, and the flight.
const DART = {
  point: { from: 0, to: 22, radius: 1.15, colour: [196, 196, 200] },
  barrel: { from: 22, to: 70, radius: 3.6, colour: [62, 62, 68] },
  shaft: { from: 70, to: 104, radius: 2.2, colour: [20, 20, 22] },
  flight: { from: 92, to: 132, half: 17, colour: [226, 214, 40] },
};

function dartSamples(dart) {
  const P = { x: dart.at.x, y: dart.at.y, z: 0 };
  const lean = dart.lean || { x: 0, y: 0 };
  const d = norm({ x: lean.x, y: lean.y, z: 1 });
  const e1 = norm(cross(d, Math.abs(d.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }));
  const e2 = cross(d, e1);
  const out = [];
  for (const part of [DART.point, DART.barrel, DART.shaft]) {
    const around = Math.max(10, Math.round(part.radius * 6));
    for (let s = part.from; s <= part.to; s += 0.4) {
      for (let k = 0; k < around; k += 1) {
        const a = (k / around) * Math.PI * 2;
        const q = addV(addV(P, scaleV(d, s)), addV(scaleV(e1, Math.cos(a) * part.radius), scaleV(e2, Math.sin(a) * part.radius)));
        // A little shading so the barrel is not one flat colour.
        const shade = 0.8 + 0.3 * Math.max(0, Math.cos(a - 0.6));
        out.push({ p: q, c: part.colour.map((v) => Math.min(255, v * shade)) });
      }
    }
  }
  const spin = dart.spin || 0.4;
  for (const turn of [0, Math.PI / 2]) {
    const e = addV(scaleV(e1, Math.cos(spin + turn)), scaleV(e2, Math.sin(spin + turn)));
    const fl = DART.flight;
    for (let s = fl.from; s <= fl.to; s += 0.5) {
      const half = s < fl.from + 12 ? (fl.half * (s - fl.from)) / 12 : fl.half;
      for (let o = -half; o <= half; o += 0.5) {
        out.push({ p: addV(addV(P, scaleV(d, s)), scaleV(e, o)), c: fl.colour.map((v) => v * (0.9 + 0.1 * Math.sign(o))) });
      }
    }
  }
  return out;
}

// A small, repeatable random number source.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// A renderer for one camera and one view's crop: picture pixel = crop.sx + (ax + 0.5) * sw / width.
// It draws the board once and the darts on top for each frame.
function renderer(cam, view, { light = { x: 0.35, y: -0.6, z: 1 }, shadow = 0.72, noise = 3, seed = 1 } = {}) {
  const { width, height } = view;
  const kx = view.crop.sw / width, ky = view.crop.sh / height;
  const base = new Float32Array(width * height * 3);
  const depth = new Float32Array(width * height);
  for (let ay = 0; ay < height; ay += 1) {
    for (let ax = 0; ax < width; ax += 1) {
      const u = view.crop.sx + (ax + 0.5) * kx, v = view.crop.sy + (ay + 0.5) * ky;
      const hit = cam.onBoard(u, v), i = ay * width + ax;
      const c = hit ? boardColour(hit.x, hit.y) : [10, 10, 10];
      base[i * 3] = c[0]; base[i * 3 + 1] = c[1]; base[i * 3 + 2] = c[2];
      depth[i] = hit ? hit.dist : 1e9;
    }
  }
  const random = rng(seed);
  // Camera noise from a table (much faster than fresh random numbers for every pixel), read from a
  // different place each frame.
  const NOISE = new Float32Array(1 << 16);
  for (let i = 0; i < NOISE.length; i += 1) NOISE[i] = (random() + random() + random() - 1.5) * noise * 2;
  const L = norm(light);
  const toCrop = (p) => {
    const q = cam.project(p);
    return q ? { x: (q.x - view.crop.sx) / kx - 0.5, y: (q.y - view.crop.sy) / ky - 0.5, depth: q.depth } : null;
  };
  return function frame(darts, { gain = 1 } = {}) {
    const rgb = Float32Array.from(base), z = Float32Array.from(depth);
    for (const dart of darts) {
      const samples = dartSamples(dart);
      // Shadow on the board: each sample pushed along the light onto z = 0, darkening the board there.
      if (shadow < 1) {
        const seen = new Uint8Array(width * height);
        for (const { p } of samples) {
          const t = p.z / L.z, s = { x: p.x - L.x * t, y: p.y - L.y * t, z: 0 };
          const q = toCrop(s);
          if (!q) continue;
          const x = Math.round(q.x), y = Math.round(q.y);
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const i = y * width + x;
          if (seen[i] || z[i] < depth[i]) continue;
          seen[i] = 1;
          rgb[i * 3] *= shadow; rgb[i * 3 + 1] *= shadow; rgb[i * 3 + 2] *= shadow;
        }
      }
      for (const { p, c } of samples) {
        const q = toCrop(p);
        if (!q) continue;
        const x0 = Math.round(q.x), y0 = Math.round(q.y);
        for (let dy = 0; dy <= 1; dy += 1) {
          for (let dx = 0; dx <= 1; dx += 1) {
            const x = x0 + dx - (q.x < x0 ? 1 : 0), y = y0 + dy - (q.y < y0 ? 1 : 0);
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = y * width + x;
            if (q.depth >= z[i]) continue;
            z[i] = q.depth;
            rgb[i * 3] = c[0]; rgb[i * 3 + 1] = c[1]; rgb[i * 3 + 2] = c[2];
          }
        }
      }
    }
    const data = new Uint8ClampedArray(width * height * 4);
    let k = (random() * NOISE.length) | 0;
    const step = 1 + ((random() * 97) | 0) * 2;
    for (let i = 0; i < width * height; i += 1) {
      for (let ch = 0; ch < 3; ch += 1) {
        data[i * 4 + ch] = rgb[i * 3 + ch] * gain + NOISE[k];
        k = (k + step) & 0xffff;
      }
      data[i * 4 + 3] = 255;
    }
    return { data, width, height };
  };
}

// Calibration as a person would do it: the five points, each tapped up to `jitter` pixels off.
function tapCalibration(cam, jitter, random) {
  const taps = V.CAL_POINTS.map((point) => {
    const q = cam.project({ x: point.x * R, y: point.y * R, z: 0 });
    return { x: q.x + (random() * 2 - 1) * jitter, y: q.y + (random() * 2 - 1) * jitter };
  });
  return V.calibrate(taps, cam.width, cam.height);
}

module.exports = { camera, renderer, tapCalibration, rng, dartSamples, boardColour, R };
