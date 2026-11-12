// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import test from "node:test";
import assert from "node:assert/strict";
import { Tracks, buildTrack } from "../src/track.js";
import {
  FixedStep,
  Physics,
  angleDiff,
  makeKart,
  placeOnGrid,
  stepKart,
} from "../src/game.js";

function newKart(track, slot = 0) {
  const kart = makeKart({ id: "t", name: "t", color: "#fff", isMe: true });
  placeOnGrid(kart, track, slot);
  return kart;
}

const straight = { steer: 0, gas: true, brake: false, drift: false, nitro: false };

// A simple driver that follows the road. Options add drift / nitro presses.
function pilot(kart, track, { drift = false, nitro = false } = {}) {
  const look = 8 + Math.floor(kart.speed / 60);
  const target = track.samples[(kart.lastIdx + look) % track.N];
  const diff = angleDiff(Math.atan2(target.y - kart.y, target.x - kart.x), kart.a);
  const sharp = Math.abs(diff);
  return {
    steer: Math.max(-1, Math.min(1, diff * 2.6)),
    gas: true,
    brake: kart.speed > 330 && sharp > 0.6,
    drift: drift && (kart.drifting ? sharp > 0.07 : sharp > 0.2) && kart.speed > 280,
    nitro: nitro && sharp < 0.05 && kart.nitro > 0.3,
  };
}

function lap(track, options) {
  const kart = newKart(track);
  const rewards = [];
  let time = 0;
  let offRoad = 0;
  while (kart.progress < track.N && time < 120) {
    stepKart(kart, pilot(kart, track, options), FixedStep, track, true);
    if (kart.driftReward) {
      rewards.push(kart.driftReward);
      kart.driftReward = 0;
    }
    if (kart.offRoad) offRoad += FixedStep;
    time += FixedStep;
  }
  return { kart, time, rewards, offRoad };
}

for (const def of Tracks) {
  const track = buildTrack(def);

  test(`${def.name}: a kart accelerates at the expected rate from the grid`, () => {
    const kart = newKart(track);
    for (let i = 0; i < 48; i += 1) {
      stepKart(kart, straight, FixedStep, track, true);
    }
    // 0.8 s at 460 px/s^2 is about 368 px/s
    assert.ok(kart.speed > 330 && kart.speed < 400, `speed ${kart.speed}`);
  });

  test(`${def.name}: a clean lap with the road-following driver stays on the road`, () => {
    const { time, offRoad } = lap(track, {});
    assert.ok(time < 40, `lap took ${time}s`);
    assert.ok(offRoad < 0.5, `${offRoad}s off the road`);
  });

  test(`${def.name}: drifting through corners earns nitro and stays controllable`, () => {
    const plain = lap(track, {});
    const drifty = lap(track, { drift: true });
    assert.ok(drifty.rewards.length > 0, "no drift ever paid out");
    assert.ok(drifty.kart.nitro > 0.5, `only ${drifty.kart.nitro} nitro after a drifty lap`);
    assert.ok(drifty.offRoad < 3, `${drifty.offRoad}s off the road while drifting`);
    assert.ok(drifty.time < plain.time + 3, "drifting should not be a big slowdown");
  });

  test(`${def.name}: nitro makes the lap faster`, () => {
    const drifty = lap(track, { drift: true });
    const boosted = lap(track, { drift: true, nitro: true });
    assert.ok(boosted.time <= drifty.time + 0.05, `${boosted.time} vs ${drifty.time}`);
  });
}

const track = buildTrack(Tracks[0]);

test("the simulation does not depend on the frame rate", () => {
  const a = newKart(track);
  const b = newKart(track);
  for (let i = 0; i < 120; i += 1) stepKart(a, straight, 1 / 60, track, true);
  for (let i = 0; i < 240; i += 1) stepKart(b, straight, 1 / 120, track, true);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) < 12, "positions differ too much");
});

test("driving straight into the grass slows the kart and the wall stops it", () => {
  const kart = newKart(track);
  kart.a += Math.PI / 2;
  for (let i = 0; i < 60 * 8; i += 1) stepKart(kart, straight, FixedStep, track, true);
  const limit = track.halfWidth + Physics.barrierMargin;
  assert.ok(kart.dist <= limit + 1, `dist ${kart.dist} beyond wall ${limit}`);
  assert.ok(kart.speed < Physics.maxSpeed * 0.7, `speed ${kart.speed}`);
});

test("nitro needs fuel and never exceeds its own top speed", () => {
  const kart = newKart(track);
  kart.nitro = 0;
  for (let i = 0; i < 180; i += 1) {
    stepKart(kart, { ...straight, nitro: true }, FixedStep, track, true);
  }
  assert.equal(kart.nitroOn, false, "nitro must not run on an empty tank");

  const full = newKart(track);
  full.nitro = 1;
  let fastest = 0;
  for (let i = 0; i < 60 * 3; i += 1) {
    stepKart(full, { ...pilot(full, track), nitro: true }, FixedStep, track, true);
    fastest = Math.max(fastest, full.speed);
  }
  assert.ok(fastest > Physics.maxSpeed * 1.05, `nitro too weak: ${fastest}`);
  assert.ok(fastest <= Physics.maxSpeed * Physics.nitroTop * 1.01, `nitro too strong: ${fastest}`);
  assert.ok(full.nitro < 0.3, "the tank should drain while boosting");
});

test("pressing drift without a real slide earns nothing", () => {
  const kart = newKart(track);
  for (let i = 0; i < 180; i += 1) stepKart(kart, pilot(kart, track), FixedStep, track, true);
  const before = kart.nitro;
  for (let i = 0; i < 12; i += 1) {
    stepKart(kart, { ...pilot(kart, track), drift: true, steer: 1 }, FixedStep, track, true);
  }
  for (let i = 0; i < 30; i += 1) stepKart(kart, pilot(kart, track), FixedStep, track, true);
  assert.ok(kart.nitro - before < 0.05, `got ${kart.nitro - before} nitro for a tap`);
});

test("hitting the wall reports the impact and cancels the drift reward", () => {
  const kart = newKart(track);
  for (let i = 0; i < 120; i += 1) stepKart(kart, pilot(kart, track), FixedStep, track, true);
  kart.a += Math.PI / 2;
  let hit = 0;
  for (let i = 0; i < 60 * 6; i += 1) {
    stepKart(kart, { ...straight, drift: true }, FixedStep, track, true);
    hit = Math.max(hit, kart.hit);
    kart.hit = 0;
  }
  assert.ok(hit > 0, "wall impact was never reported");
  assert.equal(kart.driftReward, 0);
});

test("race progress counts samples forward around the lap", () => {
  const kart = newKart(track);
  const start = kart.progress;
  for (let i = 0; i < 180; i += 1) stepKart(kart, pilot(kart, track), FixedStep, track, true);
  assert.ok(kart.progress > start + 20, `progress only ${kart.progress - start}`);
});
