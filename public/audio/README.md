# Crowd/horn sound effects

These clips are layered under the spoken score for the bigger tiers (see `SCORE_TIERS` and
`visitAnnouncement` in `public/practice-engine.js`, and `playSfx`/`warmUpSpeech` in
`public/practice.html`). They are **not** recordings of any real, named darts announcer or
broadcast - a genuine PDC/Sky Sports clip (e.g. Russ Bray calling a 180) is copyrighted broadcast
audio and can't legally be downloaded and shipped in this app. Instead these are stock crowd/horn
recordings, all downloaded from [Mixkit](https://mixkit.co)'s free sound-effects library under the
[Mixkit Free License](https://mixkit.co/license/): free for use in a project like this, no
attribution or sign-up required.

| File | Used for | Mixkit source |
|---|---|---|
| `crowd-light.mp3` | a "ton" (100-139) | https://mixkit.co/free-sound-effects/cheer/ - "Audience light applause" (id 354) |
| `crowd-cheer.mp3` | 140-159, and a Cricket clean sweep | https://mixkit.co/free-sound-effects/crowd/ - "Male crowd cheering short" (id 459) |
| `crowd-roar.mp3` | 160-179 | https://mixkit.co/free-sound-effects/crowd/ - "Cheering crowd loud whistle" (id 610) |
| `crowd-victory.mp3` | 180 | https://mixkit.co/free-sound-effects/crowd/ - "Huge crowd cheering victory" (id 462) |
| `horn-fanfare.mp3` | "Game shot!" (winning the leg) | https://mixkit.co/free-sound-effects/horn/ - "Successful horns fanfare" (id 722) |

A plain return (under 100) and "No score"/"Bust"/"No marks" stay voice-only - no clip plays.
