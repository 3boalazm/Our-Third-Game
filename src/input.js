// Keyboard + on-screen touch buttons. On phones the kart accelerates by itself
// (you only steer and brake), which is much easier with thumbs.

const keys = new Set();
const touch = { left: false, right: false, brake: false, gas: false };
let handlers = null;

export const isTouchDevice =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

export function bindInput(touchRoot) {
  unbindInput();
  const down = (event) => {
    if (event.repeat) {
      return;
    }
    keys.add(event.code);
    if (event.code.startsWith("Arrow") || event.code === "Space") {
      event.preventDefault();
    }
  };
  const up = (event) => keys.delete(event.code);
  const blur = () => {
    keys.clear();
    Object.keys(touch).forEach((k) => (touch[k] = false));
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
}

export function readInput() {
  const left = keys.has("ArrowLeft") || keys.has("KeyA") || touch.left;
  const right = keys.has("ArrowRight") || keys.has("KeyD") || touch.right;
  const brake = keys.has("ArrowDown") || keys.has("KeyS") || touch.brake;
  const gas =
    keys.has("ArrowUp") || keys.has("KeyW") || keys.has("Space") || touch.gas || isTouchDevice;
  return { steer: (right ? 1 : 0) - (left ? 1 : 0), gas, brake };
}
