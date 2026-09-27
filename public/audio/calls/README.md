# Pre-recorded announcer calls

These 373 clips are every call the practice page makes (`clipForScore`/`clipForMarks`/
`clipForPoints`/`FIXED_CLIPS` in `public/practice-engine.js`): every x01 score 1-180
(`score-<n>.wav`), "Bust", "No score", "GAME SHOT!", and for Cricket "No marks", "One mark" to
"Nine marks" (`marks-<n>.wav`) and "and N points" for 1-180 (`points-<n>.wav`), said back to back.
The page fetches each one the first time it is needed.

The 140-180 and Bust/No score/Game shot clips came first. 1-139 and the Cricket clips were added
after the browser's own SpeechSynthesis voice, which used to say those, turned out to be silent on
iPad/iPhone while these clips played. The browser voice is now only a fallback if a clip fails to
load. The 1-139 and Cricket clips have leading and trailing silence trimmed (30 ms kept).

## Why recordings instead of the browser's voice

A real, named PDC/broadcast announcer's recording (Russ Bray calling a 180, for instance) is
copyrighted broadcast audio and can't be used here. Layering free stock crowd-noise clips under the
synthesised voice (an earlier attempt) didn't sound right either - it read as generic stock clapping,
not a caller. What was actually thin was the *voice itself* on the big lines, so these calls are
instead pre-rendered offline with a real neural text-to-speech voice, once, and shipped as static
files - the browser only ever plays them back, it never synthesises them live.

## Where the voice comes from

Generated with [Piper](https://github.com/rhasspy/piper) (MIT-licensed, local, open-source neural
TTS - no cloud service, no API key, no ongoing cost), using the `en_US-libritts_r-medium` voice's
speaker index 182 (LibriTTS-R reader `7540`), chosen for being the deepest-voiced of a dozen male
speakers sampled from the model. LibriTTS-R (https://www.openslr.org/141/) is a Google-restored,
re-processed version of LibriTTS, which is itself derived from public-domain LibriVox audiobook
narration; it's released under **CC BY 4.0**, which requires attribution: "Dataset: LibriTTS-R
(https://www.openslr.org/141/), CC BY 4.0."

## Regenerating or changing the voice

`tests/practice-engine.test.cjs` and `practice.html` only care about the file names
(`score-<n>.wav`, `marks-<n>.wav`, `points-<n>.wav`, `bust.wav`, `no-score.wav`, `no-marks.wav`,
`game-shot.wav`), not how they were made,
so the voice can be swapped by regenerating this folder with a different Piper voice/speaker and the
same file names. The exact phrase for each file is the `text` that `visitAnnouncement` in
`practice-engine.js` gives for that call. To regenerate in one run, pipe JSON lines
(`{"text": ..., "output_file": ...}`) into `piper --json-input --speaker 182`.
