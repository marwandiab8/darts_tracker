// Replays a "Save test pictures" file from camera.html through board-vision.js, dart by dart, to
// see what each camera read and why. For tuning the camera scoring on real pictures.
//
//   node scripts/replay-camera-test.cjs dart-camera-test-....json [--verbose]
//
// Decoding the saved JPEGs needs `sharp`, which is not one of this project's dependencies:
// `npm install --no-save sharp` first, or set SHARP_PATH to an installed copy.
const fs = require("node:fs");
const path = require("node:path");
const V = require("../public/board-vision.js");

let sharp;
try {
  sharp = require(process.env.SHARP_PATH || "sharp");
} catch (_) {
  console.error("This needs sharp to read the pictures: npm install --no-save sharp (or set SHARP_PATH).");
  process.exit(2);
}

async function decode(dataUrl, width, height) {
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height) throw new Error(`picture is ${info.width}x${info.height}, expected ${width}x${height}`);
  return new Uint8ClampedArray(data.buffer, data.byteOffset, data.length);
}

(async () => {
  const file = process.argv[2];
  const verbose = process.argv.includes("--verbose");
  if (!file) { console.error("Usage: node scripts/replay-camera-test.cjs <test file.json> [--verbose]"); process.exit(2); }
  const test = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));

  // The views exactly as the page made them.
  const cams = test.cameras;
  const views = cams.map((cam) => {
    const shared = cams.filter((c) => c.label === cam.label).length > 1;
    return V.makeView(cam.cal, cam.frame[0], cam.frame[1], shared ? { center: V.halfCenter(cam.cal) } : {});
  });
  for (let i = 0; i < cams.length; i += 1) for (let j = i + 1; j < cams.length; j += 1) if (cams[i].label === cams[j].label) V.separateViews(views[i], views[j]);
  views.forEach((view, i) => {
    const pose = view.pose ? `camera at ${(view.pose.x * 170).toFixed(0)}, ${(view.pose.y * 170).toFixed(0)} mm, ${(view.pose.height * 170).toFixed(0)} mm out` : "camera position unknown";
    console.log(`Camera ${i + 1} "${cams[i].label}": crop ${view.width}x${view.height}, ${(view.pxPerR / 170).toFixed(2)} px/mm, ${pose}, calibration fit ${cams[i].cal.error.toFixed(2)} mm`);
  });

  let agreed = 0, withTruth = 0, rightVsTruth = 0;
  for (const [n, dart] of test.darts.entries()) {
    const readings = [];
    for (const [i, cam] of dart.cameras.entries()) {
      const view = views[i];
      const before = await decode(cam.before, view.width, view.height), after = await decode(cam.after, view.width, view.height);
      const diff = V.diffMask(before, after, view);
      readings.push(V.readView(view, diff.mask));
    }
    const f = V.fuse(readings);
    const truth = dart.truth;
    const mm = (p, q) => (Math.hypot(p.x - q.x, p.y - q.y) * 170).toFixed(1);
    let line = `Dart ${n + 1}: page read ${dart.read.label}, replay reads ${f ? f.label : "nothing"} (${f ? f.method : "-"})`;
    if (f && f.label === dart.read.label) agreed += 1;
    if (truth) {
      withTruth += 1;
      if (f && f.label === truth.label) rightVsTruth += 1;
      line += `, really ${truth.label}` + (f ? `, ${mm(f.real, truth)} mm off` : "");
    }
    console.log(line);
    if (verbose || (truth && f && f.label !== truth.label)) {
      readings.forEach((r, i) => {
        if (!r.ok) { console.log(`    camera ${i + 1}: ${r.reason} (area ${r.area})`); return; }
        const t = (p) => (truth ? `${mm(p, truth)} mm from the truth` : V.classify(p.x, p.y).label);
        console.log(`    camera ${i + 1}: point ${t(r.tip)}, other end ${r.other ? t(r.other.tip) : "-"}, quality ${r.quality.toFixed(2)}, end sure ${r.endSure.toFixed(2)}, line ${r.lineOk ? "ok" : "weak"}, ${r.area} px in ${r.pieces} piece(s)`);
      });
      if (f) console.log(`    fused: cost ${f.cost !== undefined ? f.cost.toFixed(3) : "-"}, ${f.uncertain ? "unsure" : "sure"}${f.nearWire ? ", by a wire" : ""}`);
    }
  }
  console.log(`\n${test.darts.length} darts; the replay agrees with the page on ${agreed}.` + (withTruth ? ` ${rightVsTruth} of ${withTruth} corrected darts read right.` : ""));
})().catch((error) => { console.error(error); process.exit(1); });
