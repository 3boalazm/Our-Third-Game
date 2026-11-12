import test from "node:test";
import assert from "node:assert/strict";
import {
  challengeForDate,
  dayKey,
  isChallengeDone,
  markChallengeDone,
} from "../src/challenges.js";

test("the daily challenge is stable for a date and changes over time", () => {
  const a = challengeForDate(new Date(2026, 10, 12));
  const b = challengeForDate(new Date(2026, 10, 12));
  assert.deepEqual(a, b);
  assert.equal(a.day, "2026-11-12");
  assert.equal(a.laps, 1);
  const days = new Set();
  for (let i = 1; i <= 14; i += 1) {
    const c = challengeForDate(new Date(2026, 10, i));
    days.add(`${c.trackId}/${c.tier}`);
  }
  assert.ok(days.size > 3, "challenges should rotate across tracks and tiers");
});

test("day keys use the local calendar date", () => {
  assert.equal(dayKey(new Date(2026, 0, 5)), "2026-01-05");
});

test("a completed daily challenge is remembered for that day only", () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
  try {
    assert.equal(isChallengeDone("2026-11-12"), false);
    assert.equal(markChallengeDone("2026-11-12"), true);
    assert.equal(markChallengeDone("2026-11-12"), false);
    assert.equal(isChallengeDone("2026-11-12"), true);
    assert.equal(isChallengeDone("2026-11-13"), false);
  } finally {
    delete globalThis.localStorage;
  }
});
