# Pre-recorded announcer calls

These 44 clips are the fixed set of "big call" phrases (`FIXED_CLIPS`/`clipForScore` in
`public/practice-engine.js`): every x01 score from 140 to 180, plus "Bust", "No score" and
"GAME SHOT!". Everything else (a normal return, a "ton", Cricket's marks-and-points combinations)
still uses the browser's own voice, because those have far too many distinct possible phrases to
record one-by-one.

## Why recordings instead of the browser's voice for just these

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
(`audio/calls/score-<n>.wav`, `bust.wav`, `no-score.wav`, `game-shot.wav`), not how they were made,
so the voice can be swapped by regenerating this folder with a different Piper voice/speaker and the
same file names. The exact phrase for each file is whatever `E.sayNumber`/`SCORE_TIERS.style` in
`practice-engine.js` produces for that score - see `visitAnnouncement`.
