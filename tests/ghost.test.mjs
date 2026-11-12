import test from "node:test";
import assert from "node:assert/strict";
import { loadGhost, recordGhostFrame, sampleGhost, saveGhost } from "../src/ghost.js";

const lapFrames = [
  [0, 0, 0, 0],
  [1, 100, 200, 0],
];

test("a ghost is sampled between its recorded frames", () => {
  const mid = sampleGhost(lapFrames, 0.5);
  assert.equal(mid.x, 50);
  assert.equal(mid.y, 100);
  assert.equal(mid.a, 0);
  const before = sampleGhost(lapFrames, -2);
  assert.equal(before.x, 0);
  const after = sampleGhost(lapFrames, 9);
  assert.equal(after.x, 100);
  assert.equal(sampleGhost([], 0.5), null);
});

test("ghost angles take the short way around", () => {
  const wrapped = sampleGhost(
    [
      [0, 0, 0, 3.0],
      [1, 0, 0, -3.0],
    ],
    0.5,
  );
  assert.ok(Math.abs(Math.abs(wrapped.a) - Math.PI) < 0.1, `got ${wrapped.a}`);
});

test("frames are recorded at the ghost rate, not every step", () => {
  const frames = [];
  assert.equal(recordGhostFrame(frames, 0, 1, 1, 0), true);
  assert.equal(recordGhostFrame(frames, 0.03, 2, 2, 0), false);
  assert.equal(recordGhostFrame(frames, 0.08, 3, 3, 0), true);
  assert.equal(frames.length, 2);
});

test("only a faster lap replaces the saved ghost", () => {
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (key) => (memory.has(key) ? memory.get(key) : null),
    setItem: (key, value) => memory.set(key, String(value)),
  };
  try {
    assert.equal(loadGhost("ridge"), null);
    assert.equal(saveGhost("ridge", 30, lapFrames), true);
    const saved = loadGhost("ridge");
    assert.equal(saved.time, 30);
    assert.equal(saved.frames.length, 2);
    assert.equal(saveGhost("ridge", 35, lapFrames), false, "a slower lap must not win");
    assert.equal(saveGhost("ridge", 28, lapFrames), true, "a faster lap should be kept");
    assert.equal(loadGhost("ridge").time, 28);
  } finally {
    delete globalThis.localStorage;
  }
});
