const assert = require("node:assert/strict");
const test = require("node:test");
const P = require("../public/players.js");

const game = (over = {}) => Object.assign({ opponentName: "Sam", opponentEmail: "sam@example.com", timestamp: "2026-11-16 20:14", result: "won" }, over);

test("a player's id comes from their email address, whatever its capitals", () => {
  assert.equal(P.idOf("Sam@Example.com "), P.idOf("sam@example.com"));
  assert.notEqual(P.idOf("sam@example.com"), P.idOf("sam@example.org"));
  assert.match(P.idOf("sam@example.com"), /^p[0-9a-z]{4,}$/);
});

test("the saved document as a list: the latest played or added first, broken entries left out", () => {
  const list = P.listOf({ players: {
    a: { name: "Ash", email: "ash@example.com", addedAt: 100, usedAt: 300 },
    b: { name: "  Sam   Smith ", email: "sam@example.com", addedAt: 500, usedAt: 0 },
    c: { name: "No address" },
    d: "not a player",
    e: { email: "new@example.com", addedAt: 200 },
  } });
  assert.deepEqual(list.map((p) => p.id), ["b", "a", "e"]);
  assert.equal(list[0].name, "Sam Smith");
  assert.equal(list[2].name, "New", "no name: made from the address");
  assert.deepEqual(P.listOf(null), []);
  assert.deepEqual(P.listOf({ players: "x" }), []);
});

test("a player is found by address, and a clash is someone else with it", () => {
  const list = P.listOf({ players: { a: { name: "Ash", email: "Ash@Example.com" }, b: { name: "Sam", email: "sam@example.com" } } });
  assert.equal(P.find(list, " ash@example.com").id, "a");
  assert.equal(P.find(list, "nobody@example.com"), null);
  assert.equal(P.find(list, ""), null);
  assert.equal(P.clash(list, "sam@example.com", "a").id, "b");
  assert.equal(P.clash(list, "sam@example.com", "b"), null);
  assert.equal(P.clash(list, "new@example.com", "a"), null);
});

test("what is saved for a player: a typed name, or the one from before, or one from the address", () => {
  const fresh = P.entry(null, { name: "  Dave ", email: " dave@example.com " }, 1000, false);
  assert.deepEqual(fresh, { id: P.idOf("dave@example.com"), fields: { name: "Dave", email: "dave@example.com", addedAt: 1000, usedAt: 0 } });
  const was = { id: fresh.id, name: "Dave", email: "dave@example.com", addedAt: 1000, usedAt: 0 };
  assert.deepEqual(P.entry(was, { name: "", email: "dave@example.com" }, 5000, true).fields, { name: "Dave", email: "dave@example.com", addedAt: 1000, usedAt: 5000 }, "played: the name and the day added stay");
  assert.equal(P.entry(was, { name: "David", email: "dave@example.com" }, 6000, false).fields.name, "David");
  // Being edited: only the dates are kept, so a cleared name goes back to the one from the address.
  const edited = P.entry({ addedAt: 1000, usedAt: 5000 }, { name: "", email: "d.wadih@example.com" }, 7000, false);
  assert.deepEqual(edited.fields, { name: "D.wadih", email: "d.wadih@example.com", addedAt: 1000, usedAt: 5000 });
  assert.notEqual(edited.id, fresh.id, "a new address is a new id");
  assert.equal(P.entry(null, { name: "x".repeat(60), email: "a@b.co" }, 1, false).fields.name.length, 40);
});

test("the list right after a change", () => {
  const list = P.listOf({ players: { a: { name: "Ash", email: "ash@example.com", addedAt: 100, usedAt: 300 } } });
  const added = P.apply(list, { b: { name: "Sam", email: "sam@example.com", addedAt: 900, usedAt: 0 } });
  assert.deepEqual(added.map((p) => p.name), ["Sam", "Ash"]);
  assert.deepEqual(P.apply(added, { a: null }).map((p) => p.id), ["b"]);
  assert.deepEqual(P.apply(added, { b: null, c: { name: "Sam", email: "sam@example.org", addedAt: 900, usedAt: 0 } }).map((p) => p.id), ["c", "a"], "an address changed: the old one goes");
  assert.equal(list.length, 1, "the list given is left as it was");
});

test("the people already in your record start the list: each address once, the latest name typed for it", () => {
  const found = P.fromGames([
    game({ opponentName: "Dave", opponentEmail: "David@Example.com", timestamp: "2026-11-16 19:00" }),
    game({ opponentName: "Davey", opponentEmail: "david@example.com", timestamp: "2026-11-16 21:30" }),
    game({ opponentName: "Ashley", opponentEmail: "ash@example.com", timestamp: "2026-10-12 18:00" }),
    game({ opponentName: "Ash", opponentEmail: "ash@example.com", timestamp: "2026-10-14 18:00" }), // made from the address: Ashley stays
    game({ opponentName: "Me again", opponentEmail: "ME@example.com" }),
    game({ opponentName: "Broken", opponentEmail: "nope" }),
    game({ opponentName: "", opponentEmail: "quiet@example.com", timestamp: "2026-09-01 10:00" }),
  ], "me@example.com");
  const list = P.listOf({ players: found });
  assert.deepEqual(list.map((p) => p.name), ["Davey", "Ashley", "Quiet"]);
  assert.equal(list[0].email, "david@example.com");
  assert.equal(list[0].id, P.idOf("david@example.com"));
  assert.equal(list[0].addedAt, Date.parse("2026-11-16T19:00"));
  assert.equal(list[0].usedAt, Date.parse("2026-11-16T21:30"));
  assert.equal(list[1].usedAt, Date.parse("2026-10-14T18:00"), "the day last played is the latest game's, whatever it was called");
  assert.deepEqual(P.fromGames([], "me@example.com"), {});
  const many = Array.from({ length: 70 }, (_, i) => game({ opponentEmail: "p" + i + "@example.com", timestamp: "2026-01-01 10:" + String(i % 60).padStart(2, "0") }));
  assert.equal(Object.keys(P.fromGames(many, "me@example.com")).length, P.MAX);
});

test("your games against a player, in a line", () => {
  const games = [
    game({ result: "won", timestamp: "2026-11-14 20:00" }),
    game({ result: "lost", timestamp: "2026-11-16 20:14", opponentEmail: "SAM@example.com" }),
    game({ result: "won", timestamp: "2026-11-15 20:00" }),
    game({ result: "abandoned", timestamp: "2026-11-17 09:00" }),
    game({ result: "won", opponentEmail: "ash@example.com" }),
  ];
  const rec = P.record(games, "sam@example.com");
  assert.deepEqual(rec, { played: 3, won: 2, lost: 1, last: "2026-11-17 09:00" });
  const today = new Date(2026, 10, 17);
  assert.equal(P.recordLine(rec, "Sam Smith", today), "3 games played: you won 2, Sam won 1. Last played Nov 17.");
  assert.equal(P.recordLine(P.record([game({ timestamp: "2025-12-31 22:00" })], "sam@example.com"), "Sam", today), "1 game played: you won 1, Sam won 0. Last played Dec 31, 2025.");
  assert.equal(P.recordLine(P.record([], "sam@example.com"), "Sam", today), "No games together yet.");
  assert.equal(P.recordLine(P.record([game({ result: "abandoned" })], "sam@example.com"), "Sam", today), "No finished games yet. Last played Nov 16.");
  assert.deepEqual(P.record(games, ""), { played: 0, won: 0, lost: 0, last: "" });
});

test("an email address is checked the way the game checks it", () => {
  assert.equal(P.looksLikeEmail("sam@example.com"), true);
  for (const bad of ["", "sam", "sam@example", "a b@example.com", "sam@example.com,x@y.co", "sam@exa\nmple.com", 5, null]) assert.equal(P.looksLikeEmail(bad), false, String(bad));
});
