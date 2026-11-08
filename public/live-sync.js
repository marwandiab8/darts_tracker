// One game per account, the same on every device that is signed in: the game against the bot
// (practice.html) is kept in liveGames/{uid}, and every device showing it follows each change. Any
// of them can change it (a dart tapped on the iPad, a dart the cameras saw, the bot's darts...).
// Each change is a new version of the whole document:
//   { uid, vid, parent, by, at, phase, rev, state }
//   vid      this version's id; parent: the version it was made from, or "" for a new game, which
//            replaces whatever was there
//   by       the page that wrote it (an id per page load); at: when, in ms by the writer's clock
//   phase    "play" (a game is on), "over" (finished: the game-over screen) or "none"
//   rev      counts the versions since the game started
//   state    the game itself, as JSON text (Firestore can't hold some of its nested lists)
// When two devices change it at the same moment (both putting in the dart the cameras saw), both
// versions have the same parent. The security rules (firestore.rules) only take a version made from
// the latest one, so the second is refused, and that device goes on from the version that got in
// (onRemote). Loaded as a plain <script> (window.LiveSync) and by the tests (module.exports).
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LiveSync = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  // Firestore takes documents up to 1 MiB; the rules allow the game's text up to this.
  const MAX_STATE = 900000;

  function parse(data) {
    if (!data || typeof data.vid !== "string") return null;
    let state = null;
    try { state = typeof data.state === "string" ? JSON.parse(data.state) : null; } catch (_) { state = null; }
    return {
      vid: data.vid, parent: typeof data.parent === "string" ? data.parent : "", by: String(data.by || ""),
      at: Number(data.at) || 0, phase: data.phase === "play" || data.phase === "over" ? data.phase : "none",
      rev: Number(data.rev) || 0, state,
    };
  }

  // ref: the document (compat Firestore DocumentReference); uid: its owner.
  //   onRemote(version or null): the document as it is when it first loads, and each time it changes
  //       to something this page didn't write: another device's change, or the latest one after one
  //       of this page's was refused. null: there isn't one.
  //   onSaved(version): a version written here is in. onRefused(version, error): it was refused.
  //   onError(error): the document can't be read (offline is not an error: it waits).
  // Returns { start, stop, write(phase, state, {fresh}), latest, loaded, by, waiting }.
  function createLiveDoc({ ref, uid, onRemote = () => {}, onSaved = () => {}, onRefused = () => {}, onError = () => {} }) {
    const by = newId();
    let latest = null, loaded = false, unsub = null, waiting = 0;

    function onSnap(snap) {
      // This page's own changes, not in yet: what is shown here already has them.
      if (snap.metadata && snap.metadata.hasPendingWrites) return;
      if (!snap.exists) {
        if (snap.metadata && snap.metadata.fromCache) return; // not known yet (offline)
        const had = loaded && latest === null;
        loaded = true;
        latest = null;
        if (!had) onRemote(null);
        return;
      }
      const version = parse(snap.data());
      if (!version) return;
      loaded = true;
      if (latest && version.vid === latest.vid) return; // what this page already has
      latest = version;
      onRemote(version);
    }

    return {
      start() {
        if (unsub) return;
        unsub = ref.onSnapshot(onSnap, (error) => onError(error));
      },
      stop() {
        if (unsub) unsub();
        unsub = null;
        loaded = false;
        latest = null;
      },
      // A new version made from the latest one, or with fresh: true a new game in place of anything.
      // Returns the version (with `cam`, the camera event it went up to), or null if it is too big.
      write(phase, state, { fresh = false } = {}) {
        const text = JSON.stringify(state === undefined ? null : state);
        if (text.length > MAX_STATE) return null;
        const from = fresh ? null : latest;
        const version = {
          vid: newId(), parent: from ? from.vid : "", by, at: Date.now(), phase, rev: (from ? from.rev : 0) + 1,
          state, cam: (state && Number(state.camSeq)) || 0,
        };
        latest = version;
        waiting += 1;
        ref.set({ uid, vid: version.vid, parent: version.parent, by, at: version.at, phase, rev: version.rev, state: text })
          .then(() => { waiting -= 1; onSaved(version); }, (error) => { waiting -= 1; onRefused(version, error); });
        return version;
      },
      get latest() { return latest; },
      get loaded() { return loaded; },
      get waiting() { return waiting; },
      by,
    };
  }

  return { createLiveDoc, parse, newId, MAX_STATE };
});
