// The 3D race view (three.js): a camera behind the kart, a 3D road with kerbs,
// low-poly scenery, 3D karts, sky, fog and lights.
//
// The game itself stays 2D underneath: physics, tracks and online play all use
// (x, y) in "world pixels". Here that plane is laid on the ground:
//   game (x, y)  ->  three (x, 0, y)      heading a  ->  rotation.y = -a
// so a kart model is built facing +x. Screen-space extras (HUD, minimap, names,
// rain, particles) are still drawn by render.js on the 2D canvas on top, using
// project() from this module.

import * as THREE from "three";
import { KartScale, Physics, angleDiff } from "./game.js";
import { createScenery } from "./scenery.js";

const Themes = {
  meadow: { top: "#4da3f5", horizon: "#cfe9ff", fog: "#cfe6f7", sun: "#fff4dc", ground: "#4a9a52", hills: ["#5d9a6b", "#6aa775", "#7fb58a"] },
  forest: { top: "#5f97cf", horizon: "#d3e6dc", fog: "#c9dcd2", sun: "#fff0d8", ground: "#3d7f4c", hills: ["#3f7552", "#4b845c", "#5f9a6e"] },
  autumn: { top: "#5d6ccf", horizon: "#ffc489", fog: "#f2c79c", sun: "#ffd2a0", ground: "#8d9a4d", hills: ["#a2794a", "#b88b52", "#c79d63"] },
};
const NightSky = { top: "#050a1e", horizon: "#1c2a52", fog: "#111a35" };
const RainSky = { top: "#59677a", horizon: "#a9b4c2", fog: "#9aa6b4" };

// ------------------------------------------------------------ small helpers

function canvasTexture(w, h, draw, repeat = true) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  return tex;
}

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

// A ribbon along the track centre line, from `inner` to `outer` (signed offsets
// from the centre), with u across and v = distance / texLength.
function ribbon(track, inner, outer, y, texLength) {
  const { samples, N } = track;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const uv = new Float32Array((N + 1) * 2 * 2);
  let dist = 0;
  for (let k = 0; k <= N; k += 1) {
    const s = samples[k % N];
    if (k > 0) {
      const p = samples[k - 1];
      dist += Math.hypot(s.x - p.x, s.y - p.y);
    }
    const nx = -s.ty;
    const ny = s.tx;
    const v = dist / texLength;
    const a = k * 2;
    pos.set([s.x + nx * inner, y, s.y + ny * inner], a * 3);
    pos.set([s.x + nx * outer, y, s.y + ny * outer], (a + 1) * 3);
    uv.set([0, v], a * 2);
    uv.set([1, v], (a + 1) * 2);
  }
  const index = [];
  for (let k = 0; k < N; k += 1) {
    const a = k * 2;
    // wound so the top faces up (three looks at +y from above)
    index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------ textures

function roadTexture(width) {
  // 512 px across the whole road width; one tile = `width` world px long
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = "#464b59";
    c.fillRect(0, 0, w, h);
    const rnd = seeded(77);
    for (let i = 0; i < 5000; i += 1) {
      const v = rnd();
      c.fillStyle = v < 0.5 ? `rgba(255,255,255,${0.03 + rnd() * 0.04})` : `rgba(0,0,0,${0.05 + rnd() * 0.06})`;
      c.fillRect(rnd() * w, rnd() * h, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    // darker racing line in the middle, worn by tyres
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.35, "rgba(0,0,0,0.07)");
    g.addColorStop(0.65, "rgba(0,0,0,0.07)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    const px = w / width; // texture pixels per world pixel
    // dashed centre line
    c.fillStyle = "rgba(255,255,255,0.42)";
    for (let y = 0; y < h; y += h / 4) c.fillRect(w / 2 - 3 * px, y, 6 * px, h / 8);
    // solid white edge lines
    c.fillStyle = "rgba(240,248,255,0.85)";
    c.fillRect(15 * px, 0, 6 * px, h);
    c.fillRect(w - 21 * px, 0, 6 * px, h);
  });
}

function kerbTexture() {
  return canvasTexture(64, 128, (c, w, h) => {
    c.fillStyle = "#e23d3a";
    c.fillRect(0, 0, w, h / 2);
    c.fillStyle = "#f7f7f7";
    c.fillRect(0, h / 2, w, h / 2);
    c.fillStyle = "rgba(0,0,0,0.12)";
    c.fillRect(0, 0, 6, h);
  });
}

function grassTexture(base) {
  return canvasTexture(512, 512, (c, w, h) => {
    c.fillStyle = base;
    c.fillRect(0, 0, w, h);
    const rnd = seeded(4242);
    for (let i = 0; i < 90; i += 1) {
      c.fillStyle = rnd() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,30,10,0.05)";
      c.beginPath();
      c.ellipse(rnd() * w, rnd() * h, 20 + rnd() * 70, 14 + rnd() * 50, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
    // mowing stripes
    for (let y = 0; y < h; y += 64) {
      c.fillStyle = (y / 64) % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.03)";
      c.fillRect(0, y, w, 64);
    }
    for (let i = 0; i < 2600; i += 1) {
      c.fillStyle = rnd() < 0.5 ? "rgba(20,60,20,0.18)" : "rgba(170,220,140,0.14)";
      c.fillRect(rnd() * w, rnd() * h, 1, 2 + rnd() * 3);
    }
    for (let i = 0; i < 60; i += 1) {
      c.fillStyle = rnd() < 0.55 ? "rgba(255,248,190,0.7)" : "rgba(255,255,255,0.6)";
      c.beginPath();
      c.arc(rnd() * w, rnd() * h, 1.2 + rnd() * 1.4, 0, Math.PI * 2);
      c.fill();
    }
  });
}

function checkerTexture() {
  const tex = canvasTexture(64, 256, (c, w, h) => {
    const cell = 32;
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        c.fillStyle = (x / cell + y / cell) % 2 === 0 ? "#ffffff" : "#1b1b1b";
        c.fillRect(x, y, cell, cell);
      }
    }
  });
  tex.magFilter = THREE.NearestFilter;
  return tex;
}

function padTexture() {
  return canvasTexture(256, 128, (c, w, h) => {
    c.fillStyle = "rgba(40,170,255,0.35)";
    c.fillRect(0, 0, w, h);
    c.strokeStyle = "rgba(210,245,255,0.95)";
    c.lineWidth = 14;
    c.lineCap = "round";
    c.lineJoin = "round";
    for (let i = 0; i < 3; i += 1) {
      const x = 40 + i * 70;
      c.beginPath();
      c.moveTo(x, 22);
      c.lineTo(x + 36, h / 2);
      c.lineTo(x, h - 22);
      c.stroke();
    }
    c.strokeStyle = "rgba(160,230,255,0.9)";
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
  });
}

function blobTexture() {
  return canvasTexture(64, 64, (c, w, h) => {
    const g = c.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,0.55)");
    g.addColorStop(0.6, "rgba(0,0,0,0.25)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }, false);
}

function skyTexture(top, horizon) {
  return canvasTexture(4, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top);
    g.addColorStop(0.62, horizon);
    g.addColorStop(1, horizon);
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }, false);
}

// ------------------------------------------------------------ the kart model

const Dark = new THREE.MeshLambertMaterial({ color: 0x23262f });
const Rubber = new THREE.MeshLambertMaterial({ color: 0x15161b });
const Metal = new THREE.MeshLambertMaterial({ color: 0xb9c0cc });
const Suit = new THREE.MeshLambertMaterial({ color: 0x2c3140 });
const Visor = new THREE.MeshLambertMaterial({ color: 0x0d1220, emissive: 0x0a1630 });
const White = new THREE.MeshLambertMaterial({ color: 0xf4f6fa });
const Lamp = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
const TailLamp = new THREE.MeshBasicMaterial({ color: 0xff3b3b });

function box(w, h, d, mat, x, y, z) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

// The decal painted on top of the body (a transparent texture, see buildKartModel).
const decalCache = new Map();
function liveryTexture(livery) {
  if (decalCache.has(livery)) return decalCache.get(livery);
  // drawn with the kart's nose to the right (+u), 256 x 128
  const tex = canvasTexture(256, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    if (livery === "stripe") {
      c.fillStyle = "rgba(255,255,255,0.95)";
      c.fillRect(0, h * 0.38, w, h * 0.24);
    } else if (livery === "twin") {
      c.fillStyle = "rgba(255,255,255,0.95)";
      c.fillRect(0, h * 0.2, w, h * 0.14);
      c.fillRect(0, h * 0.66, w, h * 0.14);
    } else if (livery === "checker") {
      const cell = h / 4;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < w / cell; x += 1) {
          c.fillStyle = (x + y) % 2 === 0 ? "rgba(255,255,255,0.95)" : "rgba(15,15,20,0.9)";
          c.fillRect(x * cell, y * cell, cell, cell);
        }
      }
    } else if (livery === "number") {
      c.fillStyle = "rgba(255,255,255,0.97)";
      c.beginPath();
      c.arc(w * 0.42, h / 2, h * 0.4, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = "#11141c";
      c.font = "900 " + Math.round(h * 0.56) + "px system-ui, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.save();
      c.translate(w * 0.42, h / 2);
      c.rotate(Math.PI / 2); // reads upright from behind the kart
      c.fillText("7", 0, 2);
      c.restore();
    } else if (livery === "flames") {
      // flames licking back from the nose
      const grad = c.createLinearGradient(w, 0, 0, 0);
      grad.addColorStop(0, "#fff3a0");
      grad.addColorStop(0.35, "#ffb22e");
      grad.addColorStop(0.8, "#ff4b1f");
      grad.addColorStop(1, "rgba(255,60,20,0)");
      c.fillStyle = grad;
      for (const [y0, len] of [[0.22, 0.9], [0.5, 1], [0.78, 0.85]]) {
        c.beginPath();
        c.moveTo(w, h * (y0 - 0.16));
        for (let i = 0; i <= 6; i += 1) {
          const x = w - (w * len * i) / 6;
          const wobble = (i % 2 === 0 ? -1 : 1) * h * 0.07;
          c.lineTo(x, h * y0 + wobble - h * 0.12 * (1 - i / 6));
        }
        for (let i = 6; i >= 0; i -= 1) {
          const x = w - (w * len * i) / 6;
          const wobble = (i % 2 === 0 ? 1 : -1) * h * 0.05;
          c.lineTo(x, h * y0 + wobble + h * 0.12 * (1 - i / 6));
        }
        c.closePath();
        c.fill();
      }
    }
  }, false);
  decalCache.set(livery, tex);
  return tex;
}

const GoldRim = new THREE.MeshLambertMaterial({ color: 0xe0b44a, emissive: 0x2a1c00 });

// A low-poly racing kart, ~62 world px long, facing +x.
//   parts: { wheels: "standard" | "sport" | "offroad", spoiler: "standard" | "none" | "gt" }
export function buildKartModel(color, livery = "stripe", { ghost = false, wheels: wheelStyle = "standard", spoiler = "standard" } = {}) {
  const S = KartScale;
  const group = new THREE.Group();
  const body = new THREE.Group(); // leans and pitches; the wheels stay level
  group.add(body);
  const paint = new THREE.MeshLambertMaterial({ color: new THREE.Color(color) });
  const paintDark = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.62) });
  const mats = [paint, paintDark];

  // floor pan and bumpers
  body.add(box(48 * S, 4 * S, 24 * S, Dark, 0, 5 * S, 0));
  body.add(box(5 * S, 4 * S, 30 * S, Dark, 25 * S, 5 * S, 0));
  body.add(box(4 * S, 5 * S, 28 * S, Dark, -25 * S, 7 * S, 0));
  // main body tub
  body.add(box(30 * S, 8 * S, 18 * S, paint, 2 * S, 11 * S, 0));
  // nose: a wedge (a 3-sided cylinder lying across)
  const noseGeo = new THREE.CylinderGeometry(6 * S, 6 * S, 18 * S, 3);
  noseGeo.rotateX(Math.PI / 2);
  const nose = new THREE.Mesh(noseGeo, paint);
  nose.rotation.z = -Math.PI / 6;
  nose.position.set(19 * S, 9.5 * S, 0);
  nose.scale.set(1.5, 0.75, 1);
  body.add(nose);
  // front wing
  body.add(box(5 * S, 1.6 * S, 34 * S, paintDark, 27 * S, 4.5 * S, 0));
  // side pods
  for (const side of [-1, 1]) {
    body.add(box(22 * S, 6 * S, 5 * S, paintDark, -2 * S, 9 * S, side * 11.5 * S));
  }
  // engine and exhausts
  body.add(box(12 * S, 9 * S, 14 * S, Dark, -16 * S, 13 * S, 0));
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(1.4 * S, 1.6 * S, 8 * S, 8), Metal);
    pipe.rotation.z = Math.PI / 2;
    pipe.position.set(-23 * S, 12 * S, side * 4 * S);
    body.add(pipe);
  }
  // rear wing on two posts (or a tall GT wing, or none)
  if (spoiler === "gt") {
    for (const side of [-1, 1]) body.add(box(2.4 * S, 17 * S, 2.4 * S, Dark, -22 * S, 23 * S, side * 8 * S));
    const plate = box(10 * S, 2 * S, 38 * S, paint, -24 * S, 32 * S, 0);
    plate.rotation.z = 0.12;
    body.add(plate);
    body.add(box(10 * S, 8 * S, 1.6 * S, Dark, -24 * S, 30 * S, 19 * S));
    body.add(box(10 * S, 8 * S, 1.6 * S, Dark, -24 * S, 30 * S, -19 * S));
    body.add(box(9 * S, 1 * S, 36 * S, White, -24.5 * S, 33.4 * S, 0));
  } else if (spoiler !== "none") {
    for (const side of [-1, 1]) body.add(box(2 * S, 9 * S, 2 * S, Dark, -21 * S, 19 * S, side * 9 * S));
    body.add(box(7 * S, 1.8 * S, 30 * S, paint, -22 * S, 24 * S, 0));
    body.add(box(7 * S, 5 * S, 1.4 * S, paintDark, -22 * S, 22 * S, 15 * S));
    body.add(box(7 * S, 5 * S, 1.4 * S, paintDark, -22 * S, 22 * S, -15 * S));
  }
  // driver
  body.add(box(9 * S, 9 * S, 11 * S, Suit, -5 * S, 18 * S, 0));
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(5.6 * S, 14, 10), ghost ? White : paint);
  helmet.position.set(-4 * S, 26 * S, 0);
  body.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(5.7 * S, 14, 8, Math.PI - 0.9, 1.8, 1.1, 0.8), Visor);
  visor.position.copy(helmet.position);
  body.add(visor);
  const wheelRing = new THREE.Mesh(new THREE.TorusGeometry(3 * S, 0.7 * S, 6, 12), Dark);
  wheelRing.rotation.y = Math.PI / 2;
  wheelRing.rotation.x = 0.4;
  wheelRing.position.set(4 * S, 17 * S, 0);
  body.add(wheelRing);
  // the livery is a decal across the top of the body and nose
  if (livery !== "clean") {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(44 * S, 17 * S),
      new THREE.MeshLambertMaterial({ map: liveryTexture(livery), transparent: true, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(8 * S, 15.2 * S, 0);
    body.add(decal);
    if (livery === "flames" || livery === "checker") {
      // and down the side pods
      for (const side of [-1, 1]) {
        const sideDecal = new THREE.Mesh(
          new THREE.PlaneGeometry(22 * S, 6 * S),
          new THREE.MeshLambertMaterial({ map: liveryTexture(livery), transparent: true, depthWrite: false }),
        );
        sideDecal.position.set(-2 * S, 9 * S, side * 14.1 * S);
        if (side < 0) sideDecal.rotation.y = Math.PI;
        body.add(sideDecal);
      }
    }
  }
  // lamps
  for (const side of [-1, 1]) {
    body.add(box(1 * S, 2 * S, 4 * S, Lamp, 27.6 * S, 7.5 * S, side * 8 * S));
    body.add(box(1 * S, 2 * S, 4 * S, TailLamp, -27.2 * S, 8 * S, side * 9 * S));
  }

  // wheels: front ones steer, all of them spin
  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(6.2 * S, 6.2 * S, 6 * S, 14);
  wheelGeo.rotateX(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(3 * S, 3 * S, 6.4 * S, 10);
  hubGeo.rotateX(Math.PI / 2);
  const offroad = wheelStyle === "offroad";
  const sport = wheelStyle === "sport";
  for (const [x, z, front] of [[17, 15, true], [17, -15, true], [-17, 16, false], [-17, -16, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x * S, (offroad ? 7.6 : 6.2) * S, z * S * (offroad ? 1.08 : 1));
    const spin = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, Rubber);
    const hub = new THREE.Mesh(hubGeo, sport ? GoldRim : Metal);
    if (sport) hub.scale.set(1.45, 1.45, 1.02);
    if (!front) spin.scale.set(1.12, 1.12, 1.2);
    if (offroad) {
      spin.scale.multiplyScalar(1.22);
      spin.scale.z *= 1.25;
      // tread blocks round the tyre
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        const block = box(2.4 * S, 1.6 * S, 6.4 * S, Rubber, Math.cos(a) * 6.4 * S, Math.sin(a) * 6.4 * S, 0);
        block.rotation.z = a;
        spin.add(block);
      }
    }
    spin.add(tyre, hub);
    // a spoke so the spin is visible
    spin.add(box(1.2 * S, 9 * S, 6.6 * S, Dark, 0, 0, 0));
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ pivot, spin, front });
  }

  // nitro / boost flame out of the back
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0xffb04a,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flameGeo = new THREE.ConeGeometry(3.2 * S, 16 * S, 10, 1, true);
  flameGeo.rotateZ(Math.PI / 2); // tip towards -x
  flameGeo.translate(-8 * S, 0, 0);
  const flames = [];
  for (const side of [-1, 1]) {
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.position.set(-27 * S, 12 * S, side * 4 * S);
    f.visible = false;
    body.add(f);
    flames.push(f);
  }

  if (ghost) {
    group.traverse((o) => {
      if (o.isMesh) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.opacity = 0.4;
        o.material.depthWrite = false;
        if (o.material.color) o.material.color.lerp(new THREE.Color("#d9f4ff"), 0.7);
      }
    });
  }

  return { group, body, wheels, flames, flameMat, mats, color, livery };
}

// ------------------------------------------------------------ the renderer

export function createRenderer3D(canvas) {
  let renderer = null;
  try {
    // phones with very sharp screens skip anti-aliasing: it is costly there and hardly visible
    const sharp = (window.devicePixelRatio || 1) >= 1.8;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !sharp, powerPreference: "high-performance" });
  } catch (err) {
    console.warn("3D view unavailable", err);
    return null;
  }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 8, 16000);
  const hemi = new THREE.HemisphereLight(0xdff1ff, 0x4a6b3a, 1.25);
  const sun = new THREE.DirectionalLight(0xfff4dc, 1.9);
  sun.position.set(-0.45, 1, -0.35);
  scene.add(hemi, sun, sun.target);
  // my kart's headlights at night
  const headlight = new THREE.SpotLight(0xffefc0, 0, 900, 0.55, 0.5, 1);
  headlight.decay = 0;
  scene.add(headlight, headlight.target);

  let width = 1;
  let height = 1;
  let dpr = 1;
  let world = null; // per-track meshes
  let currentWeather = "";
  const karts = new Map(); // kart object -> model
  let ghostModel = null;
  const shadowTex = blobTexture();
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const cam = { angle: 0, ready: false, x: 0, y: 0, fov: 62 };
  let mode = "behind";
  const tmp = new THREE.Vector3();

  // tyre marks: one big buffer of quads, refreshed from render.js's ring buffer
  const MaxMarkQuads = 900;
  const markPos = new Float32Array(MaxMarkQuads * 4 * 3);
  const markCol = new Float32Array(MaxMarkQuads * 4 * 4);
  const markIdx = [];
  for (let i = 0; i < MaxMarkQuads; i += 1) {
    const a = i * 4;
    markIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const markGeo = new THREE.BufferGeometry();
  markGeo.setAttribute("position", new THREE.BufferAttribute(markPos, 3));
  markGeo.setAttribute("color", new THREE.BufferAttribute(markCol, 4));
  markGeo.setIndex(markIdx);
  const markMesh = new THREE.Mesh(
    markGeo,
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
  );
  markMesh.frustumCulled = false;
  markMesh.renderOrder = 2;
  scene.add(markMesh);

  function resize(w, h, pixelRatio) {
    width = w;
    height = h;
    dpr = pixelRatio;
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }

  // ---------------- per track
  function disposeWorld() {
    if (!world) return;
    scene.remove(world.root);
    world.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        const list = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of list) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      }
    });
    world = null;
  }

  function buildWorld(track) {
    disposeWorld();
    const root = new THREE.Group();
    const def = track.def;
    const theme = Themes[def.theme] ?? Themes.meadow;
    const half = track.halfWidth;
    const b = track.bounds;
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;

    // ground
    const groundSize = Math.max(b.maxX - b.minX, b.maxY - b.minY) + 9000;
    const grass = grassTexture(def.grass ?? theme.ground);
    grass.repeat.set(groundSize / 520, groundSize / 520);
    grass.anisotropy = maxAniso;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshLambertMaterial({ map: grass }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, 0, cy);
    root.add(ground);

    // road and kerbs
    const roadTex = roadTexture(def.width);
    roadTex.anisotropy = maxAniso;
    const road = new THREE.Mesh(
      ribbon(track, -half, half, 0.6, def.width),
      new THREE.MeshLambertMaterial({ map: roadTex }),
    );
    road.renderOrder = 1;
    root.add(road);
    const kerbTex = kerbTexture();
    kerbTex.anisotropy = maxAniso;
    const kerbMat = new THREE.MeshLambertMaterial({ map: kerbTex });
    root.add(new THREE.Mesh(ribbon(track, half, half + 22, 1.4, 76), kerbMat));
    root.add(new THREE.Mesh(ribbon(track, -half - 22, -half, 1.4, 76), kerbMat));
    // a soft darker verge just outside the kerbs
    const verge = new THREE.MeshLambertMaterial({ color: new THREE.Color(def.grass ?? theme.ground).multiplyScalar(0.82) });
    root.add(new THREE.Mesh(ribbon(track, half + 22, half + 46, 0.3, 200), verge));
    root.add(new THREE.Mesh(ribbon(track, -half - 46, -half - 22, 0.3, 200), verge));

    // start / finish line and gantry
    const s0 = track.samples[0];
    const startAngle = Math.atan2(s0.ty, s0.tx);
    const checker = new THREE.Mesh(
      new THREE.PlaneGeometry(40, def.width),
      new THREE.MeshLambertMaterial({ map: checkerTexture() }),
    );
    checker.rotation.x = -Math.PI / 2;
    checker.rotation.z = -startAngle;
    checker.position.set(s0.x, 0.9, s0.y);
    root.add(checker);
    const gantry = new THREE.Group();
    const gantryMat = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
    for (const side of [-1, 1]) gantry.add(box(10, 150, 10, gantryMat, 0, 75, side * (half + 30)));
    gantry.add(box(14, 26, def.width + 70, gantryMat, 0, 150, 0));
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(def.width + 60, 22),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(1024, 64, (c, w, h) => {
          c.fillStyle = "#0e1424";
          c.fillRect(0, 0, w, h);
          c.fillStyle = "#ffffff";
          c.font = "900 44px system-ui, sans-serif";
          c.textAlign = "center";
          c.textBaseline = "middle";
          c.fillText(`${def.name.toUpperCase()}  ·  KART RACE`, w / 2, h / 2 + 2);
          c.fillStyle = "#e23d3a";
          c.fillRect(0, h - 6, w, 6);
        }, false),
      }),
    );
    banner.position.set(-7.5, 150, 0);
    banner.rotation.y = -Math.PI / 2;
    gantry.add(banner);
    const bannerBack = banner.clone();
    bannerBack.position.x = 7.5;
    bannerBack.rotation.y = Math.PI / 2;
    gantry.add(bannerBack);
    gantry.position.set(s0.x, 0, s0.y);
    gantry.rotation.y = -startAngle;
    root.add(gantry);

    // boost pads (the texture scrolls, see render())
    const padTex = padTexture();
    const padMat = new THREE.MeshBasicMaterial({ map: padTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    for (const pad of track.pads ?? []) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(pad.length, pad.half * 2), padMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(pad.ty, pad.tx);
      m.position.set(pad.x, 1.6, pad.y);
      m.renderOrder = 3;
      root.add(m);
    }

    // nitro canisters
    const pickups = [];
    const canMat = new THREE.MeshLambertMaterial({ color: 0x1aa6dc, emissive: 0x0b5f8a });
    const capMat = new THREE.MeshLambertMaterial({ color: 0xd9fbff, emissive: 0x3aa0c0 });
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    for (const pickup of track.nitroPickups ?? []) {
      const g = new THREE.Group();
      const can = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 30, 14), canMat);
      can.position.y = 30;
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 7, 10), capMat);
      cap.position.y = 48;
      const bolt = box(3, 16, 12, capMat, 11, 30, 0);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(24, 2.4, 8, 32), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 3;
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(50, 50), shadowMat);
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 1.8;
      const spin = new THREE.Group();
      spin.add(can, cap, bolt);
      g.add(spin, ring, blob);
      g.position.set(pickup.x, 0, pickup.y);
      root.add(g);
      pickups.push({ group: g, spin, ring });
    }

    // scenery: low-poly trees, bushes, rocks, tyre stacks, pylons and a stand
    buildScenery(root, track, theme);

    // hills on the horizon
    const hillRnd = seeded(def.id.length * 977 + 13);
    const far = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2 + 2600;
    for (let i = 0; i < 26; i += 1) {
      const a = (i / 26) * Math.PI * 2 + hillRnd() * 0.2;
      const r = far + hillRnd() * 900;
      const hgt = 500 + hillRnd() * 900;
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(700 + hillRnd() * 700, hgt, 7),
        new THREE.MeshLambertMaterial({ color: theme.hills[i % theme.hills.length], flatShading: true }),
      );
      hill.position.set(cx + Math.cos(a) * r, hgt / 2 - 40, cy + Math.sin(a) * r);
      hill.rotation.y = hillRnd() * 3;
      root.add(hill);
    }

    scene.add(root);
    world = { id: def.id, root, padTex, pickups, theme };
    currentWeather = "";
  }

  function buildScenery(root, track, theme) {
    const { objects } = createScenery(track);
    const byKind = (k) => objects.filter((o) => o.kind === k);
    const color = new THREE.Color();
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);

    function instanced(geo, mat, list, place, tint) {
      if (list.length === 0) return;
      const mesh = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((o, i) => {
        const { x, y, z, sx, sy, sz, rot } = place(o);
        q.setFromAxisAngle(up, rot ?? 0);
        m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
        mesh.setMatrixAt(i, m4);
        if (tint) mesh.setColorAt(i, color.set(tint(o)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      root.add(mesh);
    }

    const flat = (hex) => new THREE.MeshLambertMaterial({ color: hex, flatShading: true });
    const shadowGeo = new THREE.PlaneGeometry(1, 1);
    shadowGeo.rotateX(-Math.PI / 2);

    // round trees: trunk + two lumpy canopies
    const trees = byKind("tree");
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 6);
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = flat(0x6b4a2e);
    instanced(trunkGeo, trunkMat, trees, (o) => ({ x: o.x, y: 0, z: o.y, sx: o.r, sy: o.r * 1.5, sz: o.r }));
    const canopyGeo = new THREE.IcosahedronGeometry(1, 1);
    instanced(canopyGeo, flat(0xffffff), trees, (o) => ({ x: o.x, y: o.r * 1.9, z: o.y, sx: o.r * 1.08, sy: o.r * 0.95, sz: o.r * 1.08, rot: o.seed * 6 }), (o) => o.shades[1]);
    instanced(canopyGeo, flat(0xffffff), trees, (o) => ({ x: o.x + o.r * 0.25, y: o.r * 2.55, z: o.y - o.r * 0.15, sx: o.r * 0.7, sy: o.r * 0.62, sz: o.r * 0.7, rot: o.seed * 9 }), (o) => o.shades[2]);
    // pines: trunk + three stacked cones
    const pines = byKind("pine");
    instanced(trunkGeo, trunkMat, pines, (o) => ({ x: o.x, y: 0, z: o.y, sx: o.r * 0.8, sy: o.r * 1.1, sz: o.r * 0.8 }));
    const coneGeo = new THREE.ConeGeometry(1, 1, 7);
    coneGeo.translate(0, 0.5, 0);
    for (const [base, size, shade] of [[0.8, 1.15, 0], [1.6, 0.9, 1], [2.3, 0.62, 2]]) {
      instanced(coneGeo, flat(0xffffff), pines, (o) => ({ x: o.x, y: o.r * base, z: o.y, sx: o.r * size, sy: o.r * 1.5 * size, sz: o.r * size, rot: o.seed * 7 }), (o) => o.shades[shade]);
    }
    // shadows under trees and pines
    const treeShadow = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.8 });
    instanced(shadowGeo, treeShadow, [...trees, ...pines], (o) => ({ x: o.x + o.r * 0.35, y: 0.5, z: o.y + o.r * 0.25, sx: o.r * 2.8, sy: 1, sz: o.r * 2.4 }));

    // bushes
    const bushes = byKind("bush");
    instanced(new THREE.IcosahedronGeometry(1, 1), flat(0xffffff), bushes, (o) => ({ x: o.x, y: o.r * 0.45, z: o.y, sx: o.r * 1.2, sy: o.r * 0.85, sz: o.r * 1.2, rot: o.seed * 5 }), (o) => o.shades[1]);
    // rocks
    const rocks = byKind("rock");
    instanced(new THREE.DodecahedronGeometry(1, 0), flat(0xffffff), rocks, (o) => ({ x: o.x, y: o.r * 0.3, z: o.y, sx: o.r, sy: o.r * 0.7, sz: o.r * 0.9, rot: o.seed * 6 }), (o) => {
      const v = 0.45 + o.shade * 0.25;
      return new THREE.Color(v, v * 1.02, v * 1.06).getHex();
    });
    // tyre stacks: three tyres each, alternating red / white bands
    const stacks = byKind("tyres");
    const tyreGeo = new THREE.TorusGeometry(0.72, 0.32, 6, 12);
    tyreGeo.rotateX(Math.PI / 2);
    for (let level = 0; level < 3; level += 1) {
      instanced(tyreGeo, flat(0xffffff), stacks, (o) => ({ x: o.x, y: o.r * (0.32 + level * 0.62), z: o.y, sx: o.r, sy: o.r, sz: o.r }), () => (level === 1 ? 0xd8423f : 0x1d1f26));
    }
    // pylons
    const pylons = byKind("pylon");
    const pylonGeo = new THREE.ConeGeometry(0.5, 1.6, 10);
    pylonGeo.translate(0, 0.8, 0);
    instanced(pylonGeo, flat(0xff7a1a), pylons, (o) => ({ x: o.x, y: 0, z: o.y, sx: o.r * 2, sy: o.r * 2.4, sz: o.r * 2 }));

    // grandstand with a crowd and a roof
    for (const o of byKind("stand")) {
      const stand = new THREE.Group();
      const concrete = new THREE.MeshLambertMaterial({ color: 0x9aa3b2 });
      const seat = new THREE.MeshLambertMaterial({ color: 0x3e6fd8 });
      for (let tier = 0; tier < 5; tier += 1) {
        // tiers rise away from the road (towards +z in the stand's frame)
        stand.add(box(248, 12 + tier * 14, 16, concrete, 0, (12 + tier * 14) / 2, -36 + tier * 18));
        stand.add(box(244, 3, 10, seat, 0, 12 + tier * 14 + 1.5, -36 + tier * 18));
      }
      const crowdGeo = new THREE.BoxGeometry(7, 12, 6);
      const crowdCount = 5 * 26;
      const crowd = new THREE.InstancedMesh(crowdGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), crowdCount);
      const rnd = seeded(Math.floor(o.seed * 100000));
      const colors = [0xff7378, 0xffd36b, 0x7fd1ff, 0x3ddc97, 0xc79bff, 0xffffff];
      let n = 0;
      for (let tier = 0; tier < 5; tier += 1) {
        for (let i = 0; i < 26; i += 1) {
          m4.makeTranslation(-115 + i * 9 + rnd() * 3, 12 + tier * 14 + 9, -36 + tier * 18);
          crowd.setMatrixAt(n, m4);
          crowd.setColorAt(n, color.set(colors[Math.floor(rnd() * colors.length)]));
          n += 1;
        }
      }
      stand.add(crowd);
      const roofMat = new THREE.MeshLambertMaterial({ color: 0xe9edf3 });
      for (const x of [-118, 0, 118]) stand.add(box(4, 120, 4, concrete, x, 60, 44));
      const roof = box(262, 4, 104, roofMat, 0, 122, -6);
      roof.rotation.x = -0.12;
      stand.add(roof);
      // face the road: the stand's -z side points at the track
      stand.position.set(o.x, 0, o.y);
      stand.rotation.y = -o.angle + (o.side < 0 ? Math.PI : 0);
      root.add(stand);
    }
  }

  // ---------------- sky, fog and light for the theme and weather
  function applyLook(weatherId) {
    if (!world || currentWeather === weatherId) return;
    currentWeather = weatherId;
    const t = world.theme;
    const sky = weatherId === "night" ? NightSky : weatherId === "rain" ? RainSky : { top: t.top, horizon: t.horizon, fog: t.fog };
    if (scene.background?.dispose) scene.background.dispose();
    scene.background = skyTexture(sky.top, sky.horizon);
    scene.fog = new THREE.Fog(sky.fog, weatherId === "rain" ? 900 : 1600, weatherId === "night" ? 4200 : 7500);
    if (weatherId === "night") {
      hemi.intensity = 0.35;
      sun.intensity = 0.25;
      sun.color.set(0x9fb4ff);
      headlight.intensity = 2.6;
    } else if (weatherId === "rain") {
      hemi.intensity = 1.0;
      sun.intensity = 0.8;
      sun.color.set(0xdfe6f0);
      headlight.intensity = 0.6;
    } else {
      hemi.intensity = 1.25;
      sun.intensity = 1.9;
      sun.color.set(t.sun);
      headlight.intensity = 0;
    }
  }

  // ---------------- karts
  function modelFor(kart) {
    let m = karts.get(kart);
    if (m && (m.color !== kart.color || m.livery !== kart.livery || m.wheelStyle !== kart.wheels || m.spoiler !== kart.spoiler)) {
      scene.remove(m.root);
      karts.delete(kart);
      m = null;
    }
    if (!m) {
      const built = buildKartModel(kart.color, kart.livery, { wheels: kart.wheels, spoiler: kart.spoiler });
      const root = new THREE.Group();
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(80 * KartScale * 0.9, 46 * KartScale * 0.9), shadowMat);
      blob.rotation.x = -Math.PI / 2;
      blob.position.y = 1.9;
      built.group.add(blob);
      root.add(built.group);
      const shield = new THREE.Mesh(shieldGeo, shieldMat);
      shield.position.y = 22;
      shield.visible = false;
      root.add(shield);
      built.shield = shield;
      scene.add(root);
      m = { ...built, wheelStyle: kart.wheels, spoiler: kart.spoiler, root, lastA: kart.a, roll: 0, pitch: 0, lastSpeed: kart.speed ?? 0, wheelTurn: 0 };
      karts.set(kart, m);
    }
    return m;
  }

  function placeKart(m, kart, dt) {
    m.root.position.set(kart.x, 0, kart.y);
    if (m.shield) {
      const t = kart.shieldTimer ?? 0;
      // blinks in its last two seconds
      m.shield.visible = t > 0 && (t > 2 || Math.floor(t * 8) % 2 === 0);
      if (m.shield.visible) m.shield.scale.setScalar(1 + 0.04 * Math.sin(performance.now() / 120));
    }
    m.group.rotation.y = -kart.a;
    // lean into turns, nose up when accelerating, dip when braking
    const turnRate = dt > 0 ? angleDiff(kart.a, m.lastA) / dt : 0;
    m.lastA = kart.a;
    const speed = kart.speed ?? 0;
    const accel = dt > 0 ? (speed - m.lastSpeed) / dt : 0;
    m.lastSpeed = speed;
    const k = Math.min(1, dt * 8);
    m.roll += (Math.max(-0.12, Math.min(0.12, turnRate * speed * -0.00012)) - m.roll) * k;
    m.pitch += (Math.max(-0.06, Math.min(0.06, accel * 0.00008)) - m.pitch) * k;
    m.body.rotation.x = m.roll;
    m.body.rotation.z = m.pitch;
    // wheels: spin with speed, front ones follow the turn
    m.wheelTurn += (speed / (6.2 * KartScale)) * dt;
    const steer = Math.max(-0.45, Math.min(0.45, -turnRate * 0.25));
    for (const w of m.wheels) {
      w.spin.rotation.z = -m.wheelTurn;
      if (w.front) w.pivot.rotation.y = steer;
    }
    const burn = kart.nitroOn ? 1 : kart.boostTimer > 0 ? 0.55 : 0;
    for (const f of m.flames) {
      f.visible = burn > 0;
      if (burn > 0) {
        const flicker = 0.8 + Math.random() * 0.45;
        f.scale.set(burn * flicker * 1.3, 1, 1);
      }
    }
    m.flameMat.color.set(kart.nitroOn ? 0xffb04a : 0x8fd8ff);
  }

  function syncKarts(list, dt) {
    const seen = new Set(list);
    for (const [kart, m] of karts) {
      if (!seen.has(kart)) {
        scene.remove(m.root);
        karts.delete(kart);
      }
    }
    for (const kart of list) placeKart(modelFor(kart), kart, dt);
  }

  function syncGhost(ghost) {
    if (!ghost) {
      if (ghostModel) ghostModel.root.visible = false;
      return;
    }
    if (!ghostModel) {
      const built = buildKartModel("#d9f4ff", "clean", { ghost: true });
      const root = new THREE.Group();
      root.add(built.group);
      scene.add(root);
      ghostModel = { ...built, root };
    }
    ghostModel.root.visible = true;
    ghostModel.root.position.set(ghost.x, 0, ghost.y);
    ghostModel.group.rotation.y = -ghost.a;
  }

  // ---------------- tyre marks (from render.js's ring buffer)
  function syncMarks(marks, count) {
    const n = Math.min(count, MaxMarkQuads);
    for (let i = 0; i < MaxMarkQuads; i += 1) {
      const p = i * 12;
      const c = i * 16;
      if (i >= n) {
        markCol[c + 3] = markCol[c + 7] = markCol[c + 11] = markCol[c + 15] = 0;
        continue;
      }
      const m = marks[i];
      const dx = m.x2 - m.x1;
      const dy = m.y2 - m.y1;
      const len = Math.hypot(dx, dy) || 1;
      const w = m.kind === 0 ? 4 : 5;
      const nx = (-dy / len) * w;
      const ny = (dx / len) * w;
      markPos.set([m.x1 + nx, 1.0, m.y1 + ny, m.x1 - nx, 1.0, m.y1 - ny, m.x2 + nx, 1.0, m.y2 + ny, m.x2 - nx, 1.0, m.y2 - ny], p);
      const [r, g, bl, a] = m.kind === 0 ? [0.08, 0.08, 0.1, 0.3] : [0.25, 0.18, 0.08, 0.3];
      for (let v = 0; v < 4; v += 1) markCol.set([r, g, bl, a], c + v * 4);
    }
    markGeo.attributes.position.needsUpdate = true;
    markGeo.attributes.color.needsUpdate = true;
  }


  // ---------------- items: boxes, rockets, oil and shields
  const boxTex = canvasTexture(128, 128, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "#ff5ac8");
    g.addColorStop(0.35, "#ffd35a");
    g.addColorStop(0.7, "#5ae0ff");
    g.addColorStop(1, "#8a6bff");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = "rgba(255,255,255,0.25)";
    c.fillRect(6, 6, w - 12, h - 12);
    c.strokeStyle = "rgba(255,255,255,0.9)";
    c.lineWidth = 6;
    c.strokeRect(5, 5, w - 10, h - 10);
    c.fillStyle = "#ffffff";
    c.font = "900 86px system-ui, sans-serif";
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.shadowColor = "rgba(0,0,0,0.35)";
    c.shadowBlur = 6;
    c.fillText("?", w / 2, h / 2 + 4);
  }, false);
  const boxMat = new THREE.MeshLambertMaterial({ map: boxTex, transparent: true, opacity: 0.92, emissive: 0x222222 });
  const boxGeo = new THREE.BoxGeometry(30, 30, 30);
  const boxMeshes = [];
  const rocketMeshes = [];
  const oilMeshes = [];
  const rocketBody = new THREE.MeshLambertMaterial({ color: 0xe8423f });
  const rocketFin = new THREE.MeshLambertMaterial({ color: 0xf2f4f8 });
  const oilMat = new THREE.MeshPhongMaterial({ color: 0x15121f, shininess: 90, specular: 0x8a7cff, transparent: true, opacity: 0.92, depthWrite: false });
  const oilGeo = new THREE.CircleGeometry(40, 20);
  oilGeo.rotateX(-Math.PI / 2);
  const shieldMat = new THREE.MeshBasicMaterial({ color: 0x7fe3ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending });
  const shieldGeo = new THREE.SphereGeometry(52, 20, 14);

  function makeRocket() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 30, 10), rocketBody);
    body.rotation.z = Math.PI / 2;
    const nose = new THREE.Mesh(new THREE.ConeGeometry(5, 12, 10), rocketFin);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 21;
    g.add(body, nose);
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const fin = box(8, 1.2, 9, rocketFin, -12, Math.cos(a) * 6, Math.sin(a) * 6);
      fin.rotation.x = a;
      g.add(fin);
    }
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(5, 22, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb04a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    flame.rotation.z = Math.PI / 2;
    flame.position.x = -26;
    g.add(flame);
    g.userData.flame = flame;
    scene.add(g);
    return g;
  }

  function syncItems(items, time, clock) {
    const boxes = items?.boxes ?? [];
    while (boxMeshes.length < boxes.length) {
      const m = new THREE.Mesh(boxGeo, boxMat);
      scene.add(m);
      boxMeshes.push(m);
    }
    boxMeshes.forEach((m, i) => {
      const b = boxes[i];
      if (!b) {
        m.visible = false;
        return;
      }
      const back = time - b.activeAt; // seconds since it came back
      m.visible = time >= b.activeAt;
      const pop = back < 0.3 ? Math.max(0.05, back / 0.3) : 1;
      m.position.set(b.x, 26 + Math.sin(clock * 2.6 + i) * 4, b.y);
      m.rotation.set(0.5, clock * 1.6 + i, 0.3);
      m.scale.setScalar(pop);
    });
    const rockets = items?.rockets ?? [];
    while (rocketMeshes.length < rockets.length) rocketMeshes.push(makeRocket());
    rocketMeshes.forEach((m, i) => {
      const r = rockets[i];
      m.visible = !!r;
      if (!r) return;
      m.position.set(r.x, 22, r.y);
      m.rotation.set(0, -r.a, 0);
      m.userData.flame.scale.set(1, 0.8 + Math.random() * 0.5, 1);
    });
    const oils = items?.oils ?? [];
    while (oilMeshes.length < oils.length) {
      const m = new THREE.Mesh(oilGeo, oilMat);
      m.renderOrder = 2;
      scene.add(m);
      oilMeshes.push(m);
    }
    oilMeshes.forEach((m, i) => {
      const o = oils[i];
      m.visible = !!o;
      if (!o) return;
      m.position.set(o.x, 1.2, o.y);
      m.scale.set(1, 1, 0.8);
    });
  }

  // ---------------- camera
  function placeCamera(focus, photo, dt, shake) {
    const speedRatio = Math.min(1, Math.max(0, (focus.speed ?? 0) / Physics.maxSpeed));
    // start behind the kart, and snap back there after a jump (reset, respawn)
    if (!cam.ready || Math.abs(angleDiff(focus.a, cam.angle)) > 1.5) {
      cam.angle = focus.a;
      cam.ready = true;
    }
    let back;
    let up;
    let ahead;
    let angle;
    if (photo) {
      cam.angle += angleDiff(focus.a + (photo.orbit ?? 0), cam.angle) * Math.min(1, dt * 8);
      const zoom = photo.zoom ?? 1.35;
      back = 260 / zoom;
      up = 90 / zoom + 20;
      ahead = 0;
      angle = cam.angle;
    } else {
      cam.angle += angleDiff(focus.a, cam.angle) * Math.min(1, dt * (mode === "near" ? 6 : 4.5));
      angle = cam.angle;
      if (mode === "near") {
        back = 150 + speedRatio * 30;
        up = 62;
        ahead = 120;
      } else {
        back = 215 + speedRatio * 55;
        up = 96 + speedRatio * 10;
        ahead = 170;
      }
    }
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const sx = shake > 0.2 ? (Math.random() - 0.5) * shake * 0.8 : 0;
    const sy = shake > 0.2 ? (Math.random() - 0.5) * shake * 0.8 : 0;
    camera.position.set(focus.x - cos * back + sx, up + sy, focus.y - sin * back);
    camera.lookAt(focus.x + cos * ahead, photo ? 22 : 14, focus.y + sin * ahead);
    // a wider view at speed and on nitro sells the speed
    const boost = focus.nitroOn ? 1 : focus.boostTimer > 0 ? 0.5 : 0;
    const fovTarget = photo ? 50 : 60 + speedRatio * 9 + boost * 8;
    cam.fov += (fovTarget - cam.fov) * Math.min(1, dt * 3);
    camera.fov = cam.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // world (x, y, height) -> screen px on the overlay; null when behind the camera
  const vec = new THREE.Vector3();
  function project(x, y, h = 0) {
    vec.set(x, h, y);
    const dist = vec.distanceTo(camera.position);
    vec.project(camera);
    if (vec.z > 1 || vec.z < -1) return null;
    const scale = height / (2 * Math.tan((camera.fov * Math.PI) / 360) * Math.max(1, dist));
    return { x: ((vec.x + 1) / 2) * width, y: ((1 - vec.y) / 2) * height, scale };
  }

  function render({ track, karts: list, me, ghost, weather, photo, marks, markCount, clock, shake, items, itemTime = 0 }, dt) {
    if (!world || world.id !== track.def.id) {
      for (const [, m] of karts) scene.remove(m.root);
      karts.clear();
      buildWorld(track);
      cam.ready = false;
    }
    applyLook(weather?.id ?? "clear");
    const focus = me ?? list[0];
    syncKarts(list, dt);
    syncGhost(ghost);
    syncMarks(marks, markCount);
    syncItems(items, itemTime, clock);

    world.padTex.offset.x = -((clock * 1.4) % 1);
    world.pickups.forEach((p, i) => {
      const hidden = (me?.nitroPickupCooldowns?.[i] ?? 0) > 0;
      p.group.visible = !hidden;
      p.spin.rotation.y = clock * 2.4 + i;
      p.spin.position.y = Math.sin(clock * 3.2 + i) * 4;
      p.ring.scale.setScalar(1 + 0.08 * Math.sin(clock * 5 + i));
    });

    if (focus) {
      placeCamera(focus, photo, dt, shake);
      // the sun's light follows the action so its direction stays the same everywhere
      sun.target.position.set(focus.x, 0, focus.y);
      sun.position.set(focus.x - 900, 1800, focus.y - 700);
      if (headlight.intensity > 0) {
        const c = Math.cos(focus.a);
        const s = Math.sin(focus.a);
        headlight.position.set(focus.x + c * 30, 40, focus.y + s * 30);
        headlight.target.position.set(focus.x + c * 500, 0, focus.y + s * 500);
      }
    }
    renderer.render(scene, camera);
  }

  return {
    render,
    resize,
    project,
    setMode(value) {
      mode = value === "near" ? "near" : "behind";
    },
    resetCamera() {
      cam.ready = false;
    },
    get canvas() {
      return canvas;
    },
    get fov() {
      return camera.fov;
    },
  };
}
