// "Landscape" mode that does not depend on the phone's own rotation.
//
// If the phone is held (or locked) upright, the whole game is turned sideways
// with CSS so it is always drawn as a wide screen. Which way it is turned
// follows how the phone is really held (from the gravity sensor), exactly like
// the phone's own auto-rotate would. If the phone really is in landscape, or the
// mode is off, nothing is rotated.

import { deviceGravity, isTouchDevice, recenterTilt, setScreenAngleOverride } from "./input.js";

let appElement = null;
let force = false;
let rotated = false;
let direction = 90; // 90: turned clockwise (content top = phone's right edge), 270: counter-clockwise
const listeners = new Set();

// The size of the drawing area as the game sees it (swapped when rotated).
export function viewport() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return rotated ? { w: h, h: w, rotated: true } : { w, h, rotated: false };
}

export function isRotated() {
  return rotated;
}

export function onLayout(callback) {
  listeners.add(callback);
}

export function setForceLandscape(on) {
  force = on;
  apply();
}

export function initLayout(element) {
  appElement = element;
  window.addEventListener("resize", apply);
  window.addEventListener("orientationchange", apply);
  // Follow the way the phone is held: flip the rotation when it is turned over.
  setInterval(() => {
    if (!rotated) return;
    const gravity = deviceGravity();
    if (!gravity) return;
    if (gravity.x < -0.5 && direction !== 90) {
      direction = 90;
      apply();
    } else if (gravity.x > 0.5 && direction !== 270) {
      direction = 270;
      apply();
    }
  }, 300);
  apply();
}

function apply() {
  if (!appElement) return;
  const portrait = window.innerHeight > window.innerWidth;
  const wasRotated = rotated;
  const wasDirection = appElement.dataset.rot;
  rotated = force && isTouchDevice && portrait;

  const style = appElement.style;
  if (rotated) {
    const w = window.innerHeight; // the rotated app is as wide as the screen is tall
    const h = window.innerWidth;
    style.position = "fixed";
    style.left = "0";
    style.top = "0";
    style.right = "auto";
    style.bottom = "auto";
    style.width = `${w}px`;
    style.height = `${h}px`;
    style.transformOrigin = "top left";
    style.transform =
      direction === 90 ? "rotate(90deg) translateY(-100%)" : "rotate(-90deg) translateX(-100%)";
    // CSS "vw"/"vh" units refer to the real screen: give the game its own.
    style.setProperty("--vw", `${w / 100}px`);
    style.setProperty("--vh", `${h / 100}px`);
    appElement.dataset.rot = String(direction);
    setScreenAngleOverride(direction);
  } else {
    for (const name of ["position", "left", "top", "right", "bottom", "width", "height", "transformOrigin", "transform"]) {
      style.removeProperty(name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
    }
    style.removeProperty("--vw");
    style.removeProperty("--vh");
    delete appElement.dataset.rot;
    setScreenAngleOverride(null);
  }

  const { w, h } = viewport();
  document.documentElement.classList.toggle("short", h <= 520);
  document.documentElement.classList.toggle("compact", h <= 520 && w > h);

  if (rotated !== wasRotated || (rotated && String(direction) !== wasDirection)) {
    recenterTilt(); // the phone's pose changed: "straight" is different now
  }
  listeners.forEach((callback) => callback());
}
