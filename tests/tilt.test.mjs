import test from "node:test";
import assert from "node:assert/strict";
import { tiltFromGravity, tiltSteerTarget } from "../src/input.js";

const near = (actual, expected, message) =>
  assert.ok(Math.abs(actual - expected) < 0.5, `${message}: got ${actual}, expected ${expected}`);

test("phone held flat, rolled so the right edge goes down, steers right", () => {
  near(tiltFromGravity(0, 20, 0), 20, "right roll");
  near(tiltFromGravity(0, -15, 0), -15, "left roll");
  near(tiltFromGravity(0, 0, 0), 0, "level");
});

test("phone held upright in portrait and turned like a wheel", () => {
  // Gravity (sin 20, -cos 20, 0) in the phone's axes is beta = 70, gamma = 90.
  near(tiltFromGravity(70, 90, 0), 20, "wheel turned right");
  near(tiltFromGravity(110, 90, 0), -20, "wheel turned left");
  near(tiltFromGravity(90, 0, 0), 0, "upright, no turn");
});

test("landscape (screen angle 90 and 270)", () => {
  // angle 90: the phone's top points left, so the screen's right is the phone's bottom.
  near(tiltFromGravity(20, 0, 90), 20, "landscape 90, bottom edge down = right");
  near(tiltFromGravity(-20, 0, 90), -20, "landscape 90, other way");
  near(tiltFromGravity(20, 0, 270), -20, "landscape 270 is mirrored");
  near(tiltFromGravity(-20, 0, 270), 20, "landscape 270 mirrored, other way");
});

test("upside-down portrait is mirrored", () => {
  near(tiltFromGravity(0, 20, 180), -20, "180 mirrored");
});

test("the result never goes beyond +-90 degrees", () => {
  for (const angle of [0, 90, 180, 270]) {
    for (let beta = -180; beta <= 180; beta += 30) {
      for (let gamma = -90; gamma <= 90; gamma += 30) {
        const value = tiltFromGravity(beta, gamma, angle);
        assert.ok(Number.isFinite(value) && Math.abs(value) <= 90.0001);
      }
    }
  }
});


test("a calibrated neutral angle always maps to zero steering", () => {
  near(tiltSteerTarget(24, 24), 0, "neutral centre");
  near(tiltSteerTarget(-18, -18), 0, "negative neutral centre");
});

test("the gyro dead zone filters tiny drift around the calibrated centre", () => {
  near(tiltSteerTarget(25, 24), 0, "one degree of sensor noise");
  assert.ok(tiltSteerTarget(30, 24) > 0, "a deliberate right tilt should steer right");
});

test("gyro direction can be flipped and remains clamped", () => {
  const normal = tiltSteerTarget(14, 0, 24, false);
  const flipped = tiltSteerTarget(14, 0, 24, true);
  assert.ok(normal > 0);
  near(flipped, -normal, "flipped direction");
  assert.equal(tiltSteerTarget(100, 0, 24), 1);
  assert.equal(tiltSteerTarget(-100, 0, 24), -1);
});

test("a level phone (zero degrees) always drives straight", () => {
  near(tiltSteerTarget(0, 0), 0, "level");
  near(tiltSteerTarget(1.5, 0), 0, "tiny wobble");
});
