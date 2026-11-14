import { test } from "node:test";
import assert from "node:assert/strict";
import { Tracks } from "../src/track.js";
import {
  Cups,
  cupStandings,
  finishCup,
  isFinished,
  isUnlocked,
  pointsFor,
  readCupRecords,
  recordRace,
  startCupRun,
  trophyFor,
} from "../src/cups.js";

test("every cup has three races on real tracks and three prizes", () => {
  const ids = Tracks.map((t) => t.id);
  for (const cup of Cups) {
    assert.equal(cup.races.length, 3);
    for (const race of cup.races) assert.ok(ids.includes(race.trackId));
    assert.equal(cup.prizes.length, 3);
    assert.ok(cup.prizes[0] > cup.prizes[1] && cup.prizes[1] > cup.prizes[2]);
    assert.equal(cup.rivals.length, 3);
  }
});

test("points go 10, 6, 4, 2", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(pointsFor), [10, 6, 4, 2, 0]);
});

test("only the first cup is open at the start; a podium opens the next", () => {
  const records = readCupRecords({});
  assert.ok(isUnlocked(records, "rookie"));
  assert.ok(!isUnlocked(records, "pro"));
  records.rookie = 4;
  assert.ok(!isUnlocked(records, "pro"), "4th is not a podium");
  records.rookie = 3;
  assert.ok(isUnlocked(records, "pro"));
  assert.ok(!isUnlocked(records, "legend"));
});

test("a full cup adds up the points and pays the prize", () => {
  const run = startCupRun("rookie", ["me", "a", "b", "c"]);
  recordRace(run, ["a", "me", "b", "c"]); // me 6
  assert.ok(!isFinished(run));
  recordRace(run, ["me", "a", "c", "b"]); // me 16, a 16
  recordRace(run, ["me", "b", "a", "c"]); // me 26, a 20
  assert.ok(isFinished(run));
  const standings = cupStandings(run);
  assert.equal(standings[0], "me");
  assert.equal(run.points.me, 26);
  const records = readCupRecords({});
  const result = finishCup(run, records, "me");
  assert.equal(result.place, 1);
  assert.equal(result.prize, Cups[0].prizes[0]);
  assert.ok(result.improved);
  assert.equal(records.rookie, 1);
  assert.equal(trophyFor(1), "gold");
});

test("ties go to whoever did better in the last race", () => {
  const run = startCupRun("pro", ["me", "a"]);
  recordRace(run, ["a", "me"]);
  recordRace(run, ["me", "a"]);
  assert.equal(run.points.me, run.points.a);
  assert.equal(cupStandings(run)[0], "me");
});

test("a worse result never overwrites the best one", () => {
  const records = readCupRecords({ rookie: 2 });
  const run = startCupRun("rookie", ["me", "a", "b", "c"]);
  for (let i = 0; i < 3; i += 1) recordRace(run, ["a", "b", "c", "me"]);
  const result = finishCup(run, records, "me");
  assert.equal(result.place, 4);
  assert.equal(result.prize, 0);
  assert.equal(result.improved, false);
  assert.equal(records.rookie, 2);
});
