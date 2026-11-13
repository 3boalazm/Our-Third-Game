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
  resolveContacts,
  rubberBand,
  slipstream,
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

test("slipstream is strongest right behind a fast kart in line", () => {
  const kart = newKart(track);
  kart.a = 0;
  const ahead = { x: kart.x + 90, y: kart.y, speed: 400 };
  const close = slipstream(kart, [ahead]);
  assert.ok(close > 0.5, `expected a strong draft, got ${close}`);
  const far = slipstream(kart, [{ x: kart.x + 600, y: kart.y, speed: 400 }]);
  assert.equal(far, 0);
  const beside = slipstream(kart, [{ x: kart.x + 90, y: kart.y + 260, speed: 400 }]);
  assert.equal(beside, 0, "a kart off to the side does not create a draft");
  const slow = slipstream(kart, [{ x: kart.x + 90, y: kart.y, speed: 120 }]);
  assert.equal(slow, 0, "a slow kart does not create a draft");
});

test("nitro requires strictly more than the 8 percent activation threshold", () => {
  const kart = newKart(track);
  kart.nitro = Physics.nitroStartMin;
  stepKart(kart, { ...straight, nitro: true }, FixedStep, track, true);
  assert.equal(kart.nitroOn, false, "exactly 8 percent should not activate nitro");
  assert.ok(kart.nitro > Physics.nitroStartMin, "idle fuel should begin to refill");
  stepKart(kart, { ...straight, nitro: true }, FixedStep, track, true);
  assert.equal(kart.nitroOn, true, "nitro should activate once fuel is above 8 percent");
});

test("passive nitro regeneration is visible at the documented rate", () => {
  const kart = newKart(track);
  kart.nitro = 0;
  for (let i = 0; i < 60; i += 1) {
    stepKart(kart, straight, 1 / 60, track, true);
  }
  assert.ok(Math.abs(kart.nitro - Physics.regenHuman) < 0.0001, `nitro ${kart.nitro}`);
});

test("releasing a clean drift reports the nitro it actually refilled", () => {
  const kart = newKart(track);
  kart.dist = 0;
  kart.a = 0;
  kart.vx = 320;
  kart.vy = 0;
  kart.driftTime = 2;
  stepKart(kart, straight, FixedStep, track, true);
  assert.ok(Math.abs(kart.driftNitroReward - 0.32) < 0.0001, `gain ${kart.driftNitroReward}`);
  assert.equal(kart.boostSource, "drift");
  assert.ok(kart.boostTimer > 0.5, `no drift burst: ${kart.boostTimer}`);
});

test("a boost pad fires once, then waits for its cooldown", () => {
  const pad = track.pads[0];
  const kart = newKart(track);
  kart.x = pad.x;
  kart.y = pad.y;
  kart.lastIdx = pad.idx;
  kart.dist = 0;
  kart.a = Math.atan2(pad.ty, pad.tx);
  kart.vx = pad.tx * 320;
  kart.vy = pad.ty * 320;
  kart.speed = 320;
  kart.boostTimer = 0;
  const nitroBeforePad = kart.nitro;
  stepKart(kart, straight, FixedStep, track, true);
  assert.equal(kart.padHit, 1, "the pad should report a hit");
  assert.ok(kart.boostTimer > 0.6, `no boost: ${kart.boostTimer}`);
  assert.equal(kart.boostSource, "pad");
  assert.ok(kart.nitro - nitroBeforePad < 0.002, "a pad burst must not refill the nitro tank");
  kart.padHit = 0;
  kart.x = pad.x;
  kart.y = pad.y;
  kart.lastIdx = pad.idx;
  stepKart(kart, straight, FixedStep, track, true);
  assert.equal(kart.padHit, 0, "the same pad must not fire again during the cooldown");
});

test("rubber-banding helps a bot that is behind and eases one that is ahead", () => {
  const bot = newKart(track);
  const leader = newKart(track);
  bot.progress = 100;
  leader.progress = 100 + track.N * 0.5;
  const behind = rubberBand(bot, leader, track.N);
  assert.ok(behind > 1 && behind <= 1.15, `behind factor ${behind}`);
  bot.progress = leader.progress + track.N * 0.5;
  const ahead = rubberBand(bot, leader, track.N);
  assert.ok(ahead < 1 && ahead >= 0.86, `ahead factor ${ahead}`);
  assert.equal(rubberBand(bot, null, track.N), 1);
});

test("karts bump instead of passing through each other", () => {
  const a = newKart(track);
  const b = newKart(track);
  a.x = 1000;
  a.y = 1000;
  a.vx = 300;
  a.vy = 0;
  a.speed = 300;
  b.x = 1030;
  b.y = 1000;
  b.vx = 0;
  b.vy = 0;
  b.speed = 0;
  resolveContacts([a, b]);
  const gap = Math.hypot(a.x - b.x, a.y - b.y);
  assert.ok(gap >= Physics.kartRadius * 2 - 0.01, `still overlapping: ${gap}`);
  assert.ok(a.speed < 300, "the kart in front should take some of the hit");
  assert.ok(b.speed > 0, "the kart behind should be shoved forward");
  assert.ok(a.bump > 0 && b.bump > 0, "both karts should report the bump");
});

test("the friend's kart only pushes us away, never moves on our screen", () => {
  const mine = newKart(track);
  const friend = newKart(track);
  mine.x = 2000;
  mine.y = 1200;
  friend.x = 2000;
  friend.y = 1230;
  friend.isRemote = true;
  const fx = friend.x;
  const fy = friend.y;
  resolveContacts([mine, friend]);
  assert.ok(Math.abs(mine.y - 1200) > 1, "we should be pushed clear");
  assert.equal(friend.x, fx);
  assert.equal(friend.y, fy);
});

test("race progress counts samples forward around the lap", () => {
  const kart = newKart(track);
  const start = kart.progress;
  for (let i = 0; i < 180; i += 1) stepKart(kart, pilot(kart, track), FixedStep, track, true);
  assert.ok(kart.progress > start + 20, `progress only ${kart.progress - start}`);
});

test("rain and night change grip without breaking normal driving", async () => {
  const { applyWeather } = await import("../src/weather.js");
  const k = newKart(track);
  applyWeather([k], "rain");
  assert.ok(k.grip < 1 && k.topScale < 1 && k.steerScale < 1);
  applyWeather([k], "night");
  assert.ok(k.grip < 1 && k.grip > 0.8);
  applyWeather([k], "clear");
  assert.equal(k.grip, 1);
  assert.equal(k.topScale, 1);
});

test("rain costs a little top speed, and clear weather does not", async () => {
  const { applyWeather } = await import("../src/weather.js");
  const straight = {
    N: 240,
    halfWidth: 100000,
    pads: [],
    samples: Array.from({ length: 240 }, (_, i) => ({
      x: i * 100,
      y: 0,
      tx: 1,
      ty: 0,
    })),
  };
  const run = (weather) => {
    const k = newKart(track);
    applyWeather([k], weather);
    k.x = 100;
    k.y = 0;
    k.a = 0;
    k.lastIdx = 1;
    for (let i = 0; i < 180; i += 1) {
      stepKart(k, { steer: 0, gas: true, brake: false, drift: false, nitro: false }, 1 / 60, straight, true);
    }
    return k.speed;
  };
  const clear = run("clear");
  const rain = run("rain");
  assert.ok(rain < clear - 1, `rain ${rain} should be slower than clear ${clear}`);
});
