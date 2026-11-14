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

test("straight is the phone's true level, not the pose at the first reading", async () => {
  input.setControls({ steer: "tilt", autoDrift: true });
  assert.equal(await input.enableTilt(), "granted");

  input.setScreenAngleOverride(90);
  sendOrientation(20);
  assert.equal(input.usingTilt(), true);
  assert.ok(input.readInput(0.3).steer > 0, "a phone already tilted at the start still steers");

  sendOrientation(0);
  sendOrientation(0);
  sendOrientation(0);
  sendOrientation(0);
  sendOrientation(0);
  sendOrientation(0);
  sendOrientation(0);
  sendOrientation(0);
  assert.ok(Math.abs(input.readInput(0.5).steer) < 0.05, "a level phone drives straight");
});

test("turning the screen clears the old steering", async () => {
  input.setScreenAngleOverride(90);
  sendOrientation(30);
  assert.ok(input.readInput(0.2).steer > 0, "a real tilt should steer before rotation");

  input.setScreenAngleOverride(270);
  assert.equal(input.usingTilt(), false, "old coordinates are ignored until a fresh reading");
  assert.equal(input.readInput(0.2).steer, 0, "rotation clears the old steering offset");

  sendOrientation(0);
  assert.equal(input.usingTilt(), true);
  assert.equal(input.readInput(1 / 60).steer, 0, "level in the new orientation is straight");
});

test("clearing the steering does not move the centre", async () => {
  input.setScreenAngleOverride(90);
  sendOrientation(24);
  sendOrientation(24);
  assert.ok(input.readInput(0.2).steer > 0);

  input.recenterTilt();
  assert.equal(input.readInput(0).steer, 0, "built-up steering is cleared");
  assert.ok(input.readInput(0.3).steer > 0, "the phone is still tilted, so it still steers");
});
