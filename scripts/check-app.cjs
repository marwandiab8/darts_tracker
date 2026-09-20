// The whole app is one HTML file with inline scripts and no build step, so nothing else would
// notice a syntax error before it reached the phone. This parses every inline <script> block
// (without running it) and fails if any does not parse.
//
//   node scripts/check-app.cjs [file ...]      defaults to the app's pages and scripts in public/
//
// A path ending in .js is parsed as a whole script; anything else as HTML with inline scripts.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const files = (process.argv.length > 2 ? process.argv.slice(2) : ["index.html", "practice.html", "practice-engine.js"].map((name) => path.join(__dirname, "..", "public", name))).map((f) => path.resolve(f));

let failed = 0;
for (const file of files) {
  const label = path.relative(process.cwd(), file);
  const text = fs.readFileSync(file, "utf8");
  const isScript = file.endsWith(".js");
  const blocks = isScript ? [text] : [...text.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);

  if (!blocks.length) {
    console.error(`No inline <script> found in ${label}.`);
    failed += 1;
    continue;
  }

  let bad = 0;
  blocks.forEach((code, index) => {
    try {
      new vm.Script(code, { filename: `${path.basename(file)} <script #${index + 1}>` });
    } catch (error) {
      bad += 1;
      console.error(`Syntax error in ${label}, script #${index + 1}: ${error.message}`);
    }
  });
  failed += bad;
  if (!bad) console.log(`OK: ${isScript ? "script" : blocks.length + " inline script block(s) in"} ${label} parse${isScript ? "s" : ""}.`);
}

if (failed) process.exit(1);
