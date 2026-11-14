import test from "node:test";
import assert from "node:assert/strict";

// Load the input module as a touch device so we can exercise its live
// DeviceOrientation listener without depending on a physical phone.
const listeners = new Map();
const fakeWindow = {
  matchMedia: () => ({ matches: true }),
  DeviceOrientationEvent: class DeviceOrientationEvent {},
  addEventListener(type, listener) {
    listeners.set(type, listener);
  },
  removeEventListener(type) {
    listeners.delete(type);
  },
};
Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, "screen", {
  configurable: true,
  value: { orientation: { angle: 0 } },
});

const input = await import("../src/input.js?gyro-runtime-tests");

function sendOrientation(beta, gamma = 0) {
  const listener = listeners.get("deviceorientation");
  assert.ok(listener, "gyro listener should be registered");
  listener({ beta, gamma });
}

test("landscape rotation rebases the gyro instead of carrying a left/right offset", async () => {
  input.setControls({ steer: "tilt", autoDrift: true });
  assert.equal(await input.enableTilt(), "granted");

  input.setScreenAngleOverride(90);
  sendOrientation(20);
  assert.equal(input.usingTilt(), true);
  assert.equal(input.readInput(1 / 60).steer, 0, "first reading is the neutral pose");

  sendOrientation(30);
  assert.ok(input.readInput(0.2).steer > 0, "a real tilt should steer before rotation");

  input.setScreenAngleOverride(270);
  assert.equal(input.usingTilt(), false, "old coordinates are ignored while rebasing");
  assert.equal(input.readInput(0.2).steer, 0, "rotation clears the old steering offset");

  sendOrientation(30);
  assert.equal(input.usingTilt(), true);
  assert.equal(input.readInput(1 / 60).steer, 0, "first reading in the new orientation is neutral");
});

test("manual reset averages recent sensor samples and clears accumulated steering", async () => {
  input.setScreenAngleOverride(90);
  sendOrientation(10);
  sendOrientation(24);
  assert.ok(input.readInput(0.2).steer > 0, "sensor should be off-centre before reset");

  assert.equal(input.recenterTilt(), true);
  assert.equal(input.readInput(0.2).steer, 0, "reset restores the steering centre immediately");
});
