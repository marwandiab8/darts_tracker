const assert = require("node:assert/strict");
const test = require("node:test");
const T = require("../public/practice-timer.js");

const MIN = 60 * 1000;
const at = (m, s = 0) => Date.parse("2026-10-12T15:00:00Z") + m * MIN + s * 1000;

test("it times while you play, and you can pause and resume it", () => {
  const t = T.start(at(0));
  T.activity(t, at(1));
  assert.equal(T.seconds(t, at(2)), 120);
  T.pause(t, at(2));
  assert.equal(T.isPaused(t, at(10)), true);
  assert.equal(T.seconds(t, at(10)), 120, "paused: the clock stands still");
  assert.equal(t.pausedBy, "you");
  T.resume(t, at(10));
  assert.equal(T.seconds(t, at(11)), 180);
});

test("if you forget to pause, it pauses itself after 3 minutes with no throws", () => {
  const t = T.start(at(0));
  T.activity(t, at(2));
  // Off to eat at minute 2; back two hours later.
  assert.equal(T.isPaused(t, at(4)), false, "2 minutes without a throw: still timing");
  assert.equal(T.isPaused(t, at(5)), true, "3 minutes without a throw: paused itself");
  assert.equal(t.pausedBy, "idle");
  assert.equal(T.seconds(t, at(122)), 5 * 60, "the 3 minutes count, the rest of the break doesn't");
  // The next throw carries on.
  T.activity(t, at(122));
  assert.equal(T.isPaused(t, at(122, 30)), false);
  assert.equal(T.seconds(t, at(123)), 6 * 60);
});

test("a throw while you have paused it carries on timing", () => {
  const t = T.start(at(0));
  T.pause(t, at(1));
  T.activity(t, at(4));
  assert.equal(T.isPaused(t, at(4)), false);
  assert.equal(T.seconds(t, at(5)), 120);
});

test("a timer survives a reload, and the time away counts like any break", () => {
  const t = T.start(at(0));
  T.activity(t, at(1));
  const saved = JSON.parse(JSON.stringify(t));
  const quick = T.restore(saved, at(2));
  assert.equal(T.isPaused(quick, at(2)), false, "a quick reload keeps timing");
  const later = T.restore(saved, at(90));
  assert.equal(T.isPaused(later, at(90)), true);
  assert.equal(T.seconds(later, at(90)), 4 * 60, "1 minute played + 3 minutes before it paused itself");
  assert.equal(T.restore(null, at(0)), null);
  assert.equal(T.restore({ startedAt: "x" }, at(0)), null);
});

test("the clock reads like a stopwatch", () => {
  assert.equal(T.format(65 * 1000), "1:05");
  assert.equal(T.format((3600 + 125) * 1000), "1:02:05");
  assert.equal(T.format(0), "0:00");
  assert.equal(T.seconds(null, at(0)), 0);
});
