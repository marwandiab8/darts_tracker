// Runs every tests/e2e/*.e2e.cjs (or those whose name contains $E2E) one after another, inside
// `firebase emulators:exec` (see package.json: npm run test:e2e, or E2E=doubles npm run test:e2e).
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const filter = process.env.E2E || "";
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".e2e.cjs") && f.includes(filter)).sort();
let failed = 0;
for (const f of files) {
  console.log(`\n# ${f}`);
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) failed += 1;
}
console.log(failed ? `\n${failed} of ${files.length} e2e file(s) FAILED` : `\nall ${files.length} e2e file(s) passed`);
process.exit(failed ? 1 : 0);
