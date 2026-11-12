// Keyboard + on-screen touch buttons.
//
// Keyboard: arrows / WASD to drive, Shift = drift, Space = nitro, P or Esc = pause.
// Phone: the kart accelerates by itself; left thumb steers, right thumb drifts
// and boosts. Steering is smoothed so a tap is a gentle nudge and a hold is a
// full turn, instead of an on/off switch.

const keys = new Set();
const touch = { left: false, right: false, brake: false, drift: false, nitro: false };
let handlers = null;
let steerValue = 0;

const SteerPress = 7; // units per second toward full lock while a direction is held
const SteerRelease = 12; // units per second back to centre after letting go

export const isTouchDevice =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

export function bindInput(touchRoot, { onPause } = {}) {
  unbindInput();
  const down = (event) => {
    if (event.repeat) {
      return;
    }
    keys.add(event.code);
    if (event.code === "Escape" || event.code === "KeyP") {
      onPause?.();
    }
    if (event.code.startsWith("Arrow") || event.code === "Space") {
      event.preventDefault();
    }
  };
  const up = (event) => keys.delete(event.code);
  const blur = () => {
    keys.clear();
    Object.keys(touch).forEach((k) => (touch[k] = false));
    touchRoot?.querySelectorAll(".pressed").forEach((el) => el.classList.remove("pressed"));
  };
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);
  window.addEventListener("blur", blur);

  const cleanups = [];
  touchRoot?.querySelectorAll("[data-touch]").forEach((button) => {
    const name = button.dataset.touch;
    const press = (event) => {
      event.preventDefault();
      touch[name] = true;
      button.classList.add("pressed");
      button.setPointerCapture?.(event.pointerId);
    };
    const release = () => {
      touch[name] = false;
      button.classList.remove("pressed");
    };
    button.addEventListener("pointerdown", press);
    button.addEventListener("pointerup", release);
    button.addEventListener("pointercancel", release);
    button.addEventListener("lostpointercapture", release);
    cleanups.push(() => {
      button.removeEventListener("pointerdown", press);
      button.removeEventListener("pointerup", release);
      button.removeEventListener("pointercancel", release);
      button.removeEventListener("lostpointercapture", release);
    });
  });

  handlers = () => {
    window.removeEventListener("keydown", down);
    window.removeEventListener("keyup", up);
    window.removeEventListener("blur", blur);
    cleanups.forEach((fn) => fn());
  };
}

export function unbindInput() {
  handlers?.();
  handlers = null;
  keys.clear();
  steerValue = 0;
}

export function resetInput() {
  steerValue = 0;
  Object.keys(touch).forEach((k) => (touch[k] = false));
}

// dt is the fixed physics step, so steering feels the same at any frame rate.
export function readInput(dt) {
  const left = keys.has("ArrowLeft") || keys.has("KeyA") || touch.left;
  const right = keys.has("ArrowRight") || keys.has("KeyD") || touch.right;
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const rate = target === 0 || Math.sign(target) !== Math.sign(steerValue) ? SteerRelease : SteerPress;
  const delta = target - steerValue;
  steerValue += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);

  return {
    steer: steerValue,
    brake: keys.has("ArrowDown") || keys.has("KeyS") || touch.brake,
    gas: keys.has("ArrowUp") || keys.has("KeyW") || isTouchDevice,
    drift: keys.has("ShiftLeft") || keys.has("ShiftRight") || keys.has("KeyZ") || touch.drift,
    nitro: keys.has("Space") || keys.has("KeyX") || touch.nitro,
  };
}
