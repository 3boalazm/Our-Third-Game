import test from "node:test";
import assert from "node:assert/strict";
import { gamepadInput } from "../src/input.js";

function pad({ axis = 0, pressed = [], value = {} } = {}) {
  return {
    connected: true,
    axes: [axis, 0],
    buttons: Array.from({ length: 10 }, (_, i) => ({
      pressed: pressed.includes(i),
      value: value[i] ?? 0,
    })),
  };
}

test("the left stick steers with a dead zone", () => {
  assert.equal(gamepadInput(null), null);
  assert.equal(gamepadInput(pad({ axis: 0.1 })).steer, 0);
  const half = gamepadInput(pad({ axis: 0.5 })).steer;
  assert.ok(half > 0.35 && half < 0.5, `steer ${half}`);
  assert.equal(gamepadInput(pad({ axis: -1 })).steer, -1);
});

test("buttons and triggers map to the driving controls", () => {
  assert.equal(gamepadInput(pad({ pressed: [0] })).gas, true);
  assert.equal(gamepadInput(pad({ value: { 7: 0.8 } })).gas, true);
  assert.equal(gamepadInput(pad({ pressed: [1] })).brake, true);
  assert.equal(gamepadInput(pad({ value: { 6: 0.5 } })).brake, true);
  assert.equal(gamepadInput(pad({ pressed: [2] })).drift, true);
  assert.equal(gamepadInput(pad({ pressed: [5] })).drift, true);
  assert.equal(gamepadInput(pad({ pressed: [3] })).nitro, true);
  assert.equal(gamepadInput(pad({ pressed: [9] })).pause, true);
});

test("a disconnected pad is ignored", () => {
  assert.equal(gamepadInput({ connected: false, axes: [1], buttons: [] }), null);
});
