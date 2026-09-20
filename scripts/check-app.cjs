// The whole app is one HTML file with inline scripts and no build step, so nothing else would
// notice a syntax error before it reached the phone. This parses every inline <script> block
// (without running it) and fails if any does not parse.
//
//   node scripts/check-app.cjs [path-to-html]      defaults to public/index.html
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const file = path.resolve(process.argv[2] || path.join(__dirname, "..", "public", "index.html"));
const html = fs.readFileSync(file, "utf8");
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);

if (!blocks.length) {
  console.error(`No inline <script> found in ${path.relative(process.cwd(), file)}.`);
  process.exit(1);
}

let failed = 0;
blocks.forEach((code, index) => {
  try {
    new vm.Script(code, { filename: `${path.basename(file)} <script #${index + 1}>` });
  } catch (error) {
    failed += 1;
    console.error(`Syntax error in inline script #${index + 1}: ${error.message}`);
  }
});

if (failed) process.exit(1);
console.log(`OK: ${blocks.length} inline script block(s) in ${path.relative(process.cwd(), file)} parse.`);
