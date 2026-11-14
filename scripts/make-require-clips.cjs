#!/usr/bin/env node
// Records public/audio/calls/require-1.wav ... require-170.wav ("You require eighty one.") with the
// same Piper voice as the 140-180 calls (see public/audio/calls/README.md). Run it offline, once:
//
//   PIPER_DIR=~/.local/share/piper-tts node scripts/make-require-clips.cjs
//
// PIPER_DIR holds piper/piper (the Linux release of https://github.com/rhasspy/piper) and
// voices/en_US-libritts_r-medium.onnx (+ .onnx.json). Pass numbers to redo only those:
//   node scripts/make-require-clips.cjs 81 121
"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const E = require("../public/practice-engine.js");

const SPEAKER = 182; // LibriTTS-R reader 7540, the voice of the existing calls
const dir = process.env.PIPER_DIR || path.join(require("node:os").homedir(), ".local/share/piper-tts");
const piper = path.join(dir, "piper", "piper");
const model = path.join(dir, "voices", "en_US-libritts_r-medium.onnx");
for (const f of [piper, model]) if (!fs.existsSync(f)) { console.error("missing " + f); process.exit(1); }

const out = path.join(__dirname, "..", "public", "audio", "calls");
const wanted = process.argv.slice(2).map(Number);
const nums = wanted.length ? wanted : Array.from({ length: E.REQUIRE_MAX }, (_, i) => i + 1);
const lines = nums.map((n) => {
  const clip = E.requireClip(n);
  if (!clip) { console.error("no clip for " + n); process.exit(1); }
  return JSON.stringify({ text: E.requireText(n), speaker_id: SPEAKER, output_file: path.join(out, path.basename(clip)) });
});
const r = spawnSync(piper, ["--model", model, "--json-input", "--quiet"], { input: lines.join("\n") + "\n", stdio: ["pipe", "ignore", "inherit"] });
if (r.status !== 0) { console.error("piper failed: " + (r.error || r.status)); process.exit(1); }
const missing = nums.filter((n) => !fs.existsSync(path.join(out, "require-" + n + ".wav")));
if (missing.length) { console.error("not written: " + missing.join(", ")); process.exit(1); }
console.log("wrote " + nums.length + " clip(s) to " + out);
