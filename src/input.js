// Keyboard + phone controls.
//
// Keyboard: arrows / WASD to drive, Shift = drift, Space = nitro, P or Esc = pause.
//
// Phone (default): the kart accelerates by itself and you steer by TILTING the
// phone like a steering wheel. The only buttons used all the time are Nitro and
// Brake. Drift is automatic when you turn hard (it can be switched back to a
// button in the settings). If the phone has no motion sensor, or you pick
// "Buttons", on-screen arrows steer instead.

const keys = new Set();
const touch = { left: false, right: false, brake: false, drift: false, nitro: false, item: false };
let handlers = null;
let steerValue = 0;
let autoDriftOn = false;

const SteerPress = 7; // units per second toward full lock while a direction is held
const SteerRelease = 12; // units per second back to centre after letting go
const TiltFollow = 14; // how quickly the kart follows the tilt of the phone
const PadFollow = 16; // same, for a gamepad stick
const PadDead = 0.14; // ignore a stick that is only slightly off centre
const AutoDriftOn = 0.72; // steering beyond this starts a drift (auto-drift)
const AutoDriftOff = 0.55; // ... and it ends below this

export const isTouchDevice =
  typeof window !== "undefined" &&
  (window.matchMedia?.("(pointer: coarse)").matches || "ontouchstart" in window);

// ---------- tilt (gyroscope) ----------

// Degrees the screen's right edge is lowered by, whatever the phone's pose
// (held upright and turned like a wheel, held flat and rolled, portrait or
// landscape). beta/gamma come from the deviceorientation event and `angle` is
// the screen rotation (0, 90, 180, 270).
//
// The gravity direction in the phone's own axes is
//   (sin(gamma) * cos(beta), -sin(beta), -cos(gamma) * cos(beta))
// and we take its component along the screen's "right" direction.
export function tiltFromGravity(beta, gamma, angle = 0) {
  const b = (beta * Math.PI) / 180;
  const g = (gamma * Math.PI) / 180;
  const gx = Math.sin(g) * Math.cos(b);
  const gy = -Math.sin(b);
  const turns = ((Math.round(angle / 90) % 4) + 4) % 4;
  // The screen's right direction expressed in the phone's axes.
  const along = [gx, -gy, -gx, gy][turns];
  return (Math.asin(Math.max(-1, Math.min(1, along))) * 180) / Math.PI;
}

// While the game is turned sideways by CSS (see layout.js) the phone itself
// still reports "portrait", so layout.js tells us the angle it is drawn at.
let screenAngleOverride = null;
let lastResolvedScreenAngle = null;

function screenAngle() {
  if (screenAngleOverride !== null) {
    return screenAngleOverride;
  }
  if (typeof screen !== "undefined" && screen.orientation) {
    return screen.orientation.angle;
  }
  return typeof window !== "undefined" && typeof window.orientation === "number"
    ? window.orientation
    : 0;
}

const tilt = {
  status: "idle", // idle | granted | denied | unsupported
  listening: false,
  raw: 0, // degrees, filtered
  // "Straight" is always the phone's true level (screen's right edge neither up
  // nor down), never however the phone happened to be held when the race began.
  neutral: 0,
  lastEvent: 0,
  lastBeta: null,
  lastGamma: null,
  samples: [],
  recenterPending: false,
  gx: 0, // gravity direction in the phone's own x / y axes (-1..1)
  gy: 0,
  range: 24, // degrees of tilt for full lock
  flip: false,
};

function scheduleTiltRecenter() {
  tilt.recenterPending = true;
  steerValue = 0;
  autoDriftOn = false;
}

export function setScreenAngleOverride(angle) {
  const previousAngle = lastResolvedScreenAngle;
  screenAngleOverride = angle;
  const nextAngle = screenAngle();
  if (previousAngle === null || previousAngle !== nextAngle) {
    // The screen's "right" axis changed. Rebase on the first reading in the
    // new orientation so the old landscape/portrait zero cannot pull left.
    scheduleTiltRecenter();
  }
  lastResolvedScreenAngle = nextAngle;
}

// Which way the phone is held, for layout.js. null when there is no sensor.
export function deviceGravity() {
  return performance.now() - tilt.lastEvent < 700 ? { x: tilt.gx, y: tilt.gy } : null;
}

export function tiltSupported() {
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

// iPhones ask for permission, and only from a tap.
export function tiltNeedsPermission() {
  return (
    tiltSupported() && typeof window.DeviceOrientationEvent.requestPermission === "function"
  );
}

function onOrientation(event) {
  if (event.beta == null || event.gamma == null) {
    return;
  }
  tilt.lastBeta = event.beta;
  tilt.lastGamma = event.gamma;
  const b = (event.beta * Math.PI) / 180;
  const g = (event.gamma * Math.PI) / 180;
  tilt.gx = Math.sin(g) * Math.cos(b);
  tilt.gy = -Math.sin(b);
  const degrees = tiltFromGravity(event.beta, event.gamma, screenAngle());

  if (tilt.recenterPending) {
    // First fresh sample after a screen rotation: start the smoothing from it.
    tilt.raw = degrees;
    tilt.samples = [degrees];
    tilt.recenterPending = false;
    steerValue = 0;
    autoDriftOn = false;
  } else {
    tilt.raw += (degrees - tilt.raw) * 0.5; // light smoothing against sensor noise
    tilt.samples.push(degrees);
    if (tilt.samples.length > 8) tilt.samples.shift();
  }
  tilt.lastEvent = performance.now();
}

export async function enableTilt() {
  if (!tiltSupported()) {
    tilt.status = "unsupported";
    return tilt.status;
  }
  if (tiltNeedsPermission() && tilt.status !== "granted") {
    try {
      const answer = await window.DeviceOrientationEvent.requestPermission();
      tilt.status = answer === "granted" ? "granted" : "denied";
    } catch {
      tilt.status = "denied";
    }
  } else if (tilt.status !== "denied") {
    tilt.status = "granted";
  }
  if (tilt.status === "granted" && !tilt.listening) {
    window.addEventListener("deviceorientation", onOrientation);
    tilt.listening = true;
  }
  return tilt.status;
}

// Clears the steering that has built up. The centre itself stays the phone's
// true level; it is not moved to the current pose.
export function recenterTilt() {
  const fresh = performance.now() - tilt.lastEvent < 700;
  if (fresh && tilt.samples.length > 0 && !tilt.recenterPending) {
    tilt.raw = tilt.samples[tilt.samples.length - 1];
    tilt.recenterPending = false;
  } else {
    // If the sensor is asleep, let the next live reading establish the zero.
    scheduleTiltRecenter();
  }
  steerValue = 0;
  autoDriftOn = false;
  return fresh;
}

export function setTiltOptions({ range, flip }) {
  if (range) tilt.range = range;
  if (flip !== undefined) tilt.flip = flip;
}

// Convert the calibrated sensor angle into a -1..1 steering target.
// Kept pure so the landscape/portrait calibration behaviour can be tested.
export function tiltSteerTarget(raw, neutral, range = 24, flip = false) {
  let degrees = raw - neutral;
  if (flip) degrees = -degrees;
  const dead = 2;
  degrees = Math.abs(degrees) < dead ? 0 : degrees - Math.sign(degrees) * dead;
  return Math.max(-1, Math.min(1, degrees / (range - dead)));
}

// True while the sensor is really delivering readings.
export function tiltAlive() {
  return tilt.status === "granted" && performance.now() - tilt.lastEvent < 700;
}

export function tiltStatus() {
  return tilt.status;
}

// -1..1 as the kart currently sees it (for the on-screen gauge).
export function steerNow() {
  return steerValue;
}

// ---------- settings that change how input is read ----------

const controls = { steer: "tilt", autoDrift: true };

export function setControls(next) {
  Object.assign(controls, next);
}

// ---------- gamepad ----------
// Any connected pad using the standard mapping can drive. The four driving
// actions can be remapped from the menu; Start stays as the pause button.

export const DefaultPadBindings = { gas: 0, brake: 1, drift: 2, nitro: 3 };
export const PadButtonNames = [
  "A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "L3", "R3", "Up", "Down", "Left", "Right",
];

export function normalizePadBindings(bindings) {
  const out = { ...DefaultPadBindings };
  if (!bindings || typeof bindings !== "object") return out;
  for (const action of Object.keys(DefaultPadBindings)) {
    const index = bindings[action];
    if (Number.isInteger(index) && index >= 0 && index < 32) out[action] = index;
  }
  return out;
}

let padBindings = { ...DefaultPadBindings };

export function setPadBindings(next) {
  padBindings = normalizePadBindings(next);
}

export function gamepadInput(pad, bindings = padBindings) {
  if (!pad || pad.connected === false) return null;
  const map = normalizePadBindings(bindings);
  const pressed = (i) => pad.buttons?.[i]?.pressed === true;
  const value = (i) => {
    const v = pad.buttons?.[i]?.value;
    return Number.isFinite(v) ? v : 0;
  };
  const active = (i) => pressed(i) || value(i) > 0.5;
  const axis = Number.isFinite(pad.axes?.[0]) ? pad.axes[0] : 0;
  const magnitude = Math.abs(axis) < PadDead ? 0 : (Math.abs(axis) - PadDead) / (1 - PadDead);
  const bound = new Set(Object.values(map));
  const spare = (button) => !bound.has(button);
  return {
    steer: Math.sign(axis) * Math.min(1, magnitude),
    gas: active(map.gas) || (spare(7) && value(7) > 0.15),
    brake: active(map.brake) || (spare(6) && value(6) > 0.15),
    drift: active(map.drift) || (spare(5) && pressed(5)),
    nitro: active(map.nitro) || (spare(4) && value(4) > 0.5),
    item: pressed(6) || pressed(7),
    pause: pressed(9),
  };
}

export function activeGamepad() {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return null;
  }
  try {
    for (const pad of navigator.getGamepads()) {
      if (pad && pad.connected) return pad;
    }
  } catch {
    // some browsers throw until the pad has been used once
  }
  return null;
}

export function gamepadAvailable() {
  return !!activeGamepad();
}

export function gamepadDownButtons(pad) {
  if (!pad) return [];
  return (pad.buttons ?? [])
    .map((button, index) => (button.pressed ? index : -1))
    .filter((index) => index >= 0);
}

// True only on the step where Start was pressed, so holding it does not
// toggle the pause menu forever.
let padPauseLatch = false;
export function gamepadPausePressed() {
  const pad = activeGamepad();
  const down = !!pad && gamepadInput(pad)?.pause;
  const edge = down && !padPauseLatch;
  padPauseLatch = down;
  return edge;
}

// ---------- binding ----------

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
  autoDriftOn = false;
}

export function resetInput() {
  steerValue = 0;
  autoDriftOn = false;
  Object.keys(touch).forEach((k) => (touch[k] = false));
}

// True when the steering comes from the phone's motion sensor right now.
export function usingTilt() {
  return isTouchDevice && controls.steer === "tilt" && tiltAlive() && !tilt.recenterPending;
}

// dt is the fixed physics step, so steering feels the same at any frame rate.
export function readInput(dt) {
  const pad = gamepadInput(activeGamepad());
  if (pad && Math.abs(pad.steer) > 0.001) {
    steerValue += (pad.steer - steerValue) * Math.min(1, PadFollow * dt);
  } else if (usingTilt()) {
    const target = tiltSteerTarget(tilt.raw, tilt.neutral, tilt.range, tilt.flip);
    steerValue += (target - steerValue) * Math.min(1, TiltFollow * dt);
  } else {
    const left = keys.has("ArrowLeft") || keys.has("KeyA") || touch.left;
    const right = keys.has("ArrowRight") || keys.has("KeyD") || touch.right;
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const rate =
      target === 0 || Math.sign(target) !== Math.sign(steerValue) ? SteerRelease : SteerPress;
    const delta = target - steerValue;
    steerValue += Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
  }

  // Auto-drift: turning hard drifts (with a little hysteresis so it doesn't flicker).
  if (isTouchDevice && controls.autoDrift) {
    const sharp = Math.abs(steerValue);
    autoDriftOn = autoDriftOn ? sharp > AutoDriftOff : sharp > AutoDriftOn;
  } else {
    autoDriftOn = false;
  }

  return {
    steer: steerValue,
    brake: keys.has("ArrowDown") || keys.has("KeyS") || touch.brake || !!pad?.brake,
    gas: keys.has("ArrowUp") || keys.has("KeyW") || isTouchDevice || !!pad?.gas,
    drift:
      keys.has("ShiftLeft") ||
      keys.has("ShiftRight") ||
      keys.has("KeyZ") ||
      touch.drift ||
      autoDriftOn ||
      !!pad?.drift,
    nitro: keys.has("Space") || keys.has("KeyX") || touch.nitro || !!pad?.nitro,
    item: keys.has("KeyE") || keys.has("Enter") || touch.item || !!pad?.item,
  };
}
