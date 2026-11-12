// Track-side decoration: trees, bushes, rocks, tyre stacks, a grandstand and
// the start-line flags. Everything is placed with a seeded random generator from
// the track id, so a track looks the same every time, and nothing is ever put on
// the road. render.js bakes this into one offscreen canvas per track.

import { nearest } from "./track.js";

// dark / mid / highlight shades, so a canopy reads as a rounded tree from above
const TreeShades = [
  ["#1f5a30", "#2f7d43", "#4aa55f"],
  ["#256b39", "#378c4c", "#5bb271"],
  ["#1b522b", "#2a6f3d", "#418d54"],
  ["#2a7340", "#419a56", "#63bb78"],
  ["#174825", "#256437", "#3c864c"],
];
const PineShades = [
  ["#123f24", "#1d5c31", "#2c7a3f"],
  ["#0f3720", "#1a522c", "#276e39"],
  ["#154828", "#226434", "#318246"],
];
const BushShades = [
  ["#2b7438", "#3f9c53", "#67c47b"],
  ["#246a33", "#357f45", "#57ae6b"],
];
// Sunset Ridge in autumn colours
const AutumnShades = [
  ["#6e2918", "#b23a24", "#e8703f"],
  ["#7a3f12", "#c46a1e", "#f0a53a"],
  ["#6b5310", "#b8921c", "#efd160"],
  ["#5c4a14", "#9c7a1c", "#d4b03a"],
  ["#663a1c", "#a85a2a", "#e08a4a"],
];
const AutumnBushShades = [
  ["#5f6a1f", "#879331", "#c0c94a"],
  ["#6d5a1b", "#a08a2a", "#d8bd4c"],
];
const AutumnPines = [
  ["#3c4a14", "#5c6a1c", "#8a9330"],
  ["#443f12", "#66601c", "#99902f"],
];
const CrowdColors = ["#ff7378", "#ffd36b", "#7fd1ff", "#3ddc97", "#c79bff", "#ffffff"];
function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createScenery(track) {
  const rng = mulberry32(hash(`${track.def.id}:${track.def.name}`));
  const { samples, N, halfWidth: half, bounds } = track;
  const theme = track.def.theme ?? "meadow";
  const objects = [];
  const placed = []; // { x, y, r } footprints already taken
  const pick = (list) => list[Math.floor(rng() * list.length)];

  const fits = (x, y, r, gap = 24) =>
    x > bounds.minX - 620 &&
    x < bounds.maxX + 620 &&
    y > bounds.minY - 620 &&
    y < bounds.maxY + 620 &&
    nearest(track, x, y).dist > half + gap + r &&
    placed.every((o) => Math.hypot(o.x - x, o.y - y) > (o.r + r) * 0.82);

  const reserve = (x, y, r) => placed.push({ x, y, r });

  // A point in the grass beside the road, at a chosen distance from the edge.
  function beside(minOffset, maxOffset) {
    const s = samples[Math.floor(rng() * N)];
    const side = rng() < 0.5 ? -1 : 1;
    const offset = half + minOffset + rng() * (maxOffset - minOffset);
    return {
      x: s.x - s.ty * side * offset + (rng() - 0.5) * 54,
      y: s.y + s.tx * side * offset + (rng() - 0.5) * 54,
      s,
    };
  }

  // --- trees and pines ---
  let trees = 0;
  for (let guard = 0; trees < 92 && guard < 4000; guard += 1) {
    const p = beside(110, 480);
    const r = 27 + rng() * 23;
    if (!fits(p.x, p.y, r)) continue;
    reserve(p.x, p.y, r * 0.8);
    const pineChance = theme === "forest" ? 0.62 : theme === "autumn" ? 0.22 : 0.34;
    const kind = rng() < pineChance ? "pine" : "tree";
    const shades =
      kind === "pine"
        ? theme === "autumn"
          ? pick(AutumnPines)
          : pick(PineShades)
        : theme === "autumn"
          ? pick(AutumnShades)
          : pick(TreeShades);
    objects.push({ kind, x: p.x, y: p.y, r, shades, seed: rng() });
    trees += 1;
  }

  // --- bushes ---
  let bushes = 0;
  for (let guard = 0; bushes < 64 && guard < 3000; guard += 1) {
    const p = beside(85, 340);
    const r = 13 + rng() * 9;
    if (!fits(p.x, p.y, r, 14)) continue;
    reserve(p.x, p.y, r * 0.9);
    objects.push({
      kind: "bush",
      x: p.x,
      y: p.y,
      r,
      shades: theme === "autumn" ? pick(AutumnBushShades) : pick(BushShades),
      seed: rng(),
    });
    bushes += 1;
  }

  // --- rocks ---
  let rocks = 0;
  for (let guard = 0; rocks < 24 && guard < 2000; guard += 1) {
    const p = beside(95, 400);
    const r = 11 + rng() * 13;
    if (!fits(p.x, p.y, r, 20)) continue;
    reserve(p.x, p.y, r);
    objects.push({
      kind: "rock",
      x: p.x,
      y: p.y,
      r,
      shade: rng(),
      seed: rng(),
    });
    rocks += 1;
  }

  // --- tyre stacks on the outside of the sharper bends ---
  const corners = [];
  for (let i = 0; i < N; i += 9) {
    const a = samples[i];
    const b = samples[(i + 9) % N];
    const turn = Math.abs(a.tx * b.ty - a.ty * b.tx);
    if (turn > 0.055) corners.push(i);
  }
  let stacks = 0;
  for (let c = 0; c < corners.length && stacks < 20; c += Math.max(1, Math.floor(corners.length / 10))) {
    const s = samples[corners[c]];
    for (const side of [-1, 1]) {
      if (stacks >= 20 || rng() < 0.3) continue;
      const offset = half + 34 + rng() * 20;
      const x = s.x - s.ty * side * offset;
      const y = s.y + s.tx * side * offset;
      if (!fits(x, y, 15, 8)) continue;
      reserve(x, y, 15);
      objects.push({ kind: "tyres", x, y, r: 15, side, seed: rng() });
      stacks += 1;
    }
  }

  // --- start-line pylons and a small grandstand ---
  const start = samples[0];
  for (const side of [-1, 1]) {
    const x = start.x - start.ty * side * (half + 42);
    const y = start.y + start.tx * side * (half + 42);
    objects.push({ kind: "pylon", x, y, r: 10, side, seed: rng() });
    reserve(x, y, 10);
  }

  const standAngle = Math.atan2(start.ty, start.tx);
  for (const side of [-1, 1]) {
    const offset = half + 112;
    const cx = start.x - start.ty * side * offset;
    const cy = start.y + start.tx * side * offset;
    // The stand is 248 x 92; every corner has to be clear of the road.
    let clear = true;
    for (const [dx, dy] of [
      [-124, -46],
      [124, -46],
      [-124, 46],
      [124, 46],
    ]) {
      const x = cx + dx * Math.cos(standAngle) - dy * Math.sin(standAngle);
      const y = cy + dx * Math.sin(standAngle) + dy * Math.cos(standAngle);
      if (nearest(track, x, y).dist < half + 26) clear = false;
    }
    if (!clear) continue;
    objects.push({
      kind: "stand",
      x: cx,
      y: cy,
      r: 126,
      angle: standAngle,
      side,
      seed: rng(),
    });
    break;
  }

  return { objects };
}

// ---------- drawing (world pixels) ----------

function shadow(ctx, x, y, rx, ry, alpha = 0.16) {
  ctx.fillStyle = `rgba(10, 26, 16, ${alpha})`;
  ctx.beginPath();
  ctx.ellipse(x + 9, y + 8, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
}

export function drawScenery(ctx, scenery) {
  for (const o of scenery.objects) {
    if (o.kind === "tree" || o.kind === "pine") drawTree(ctx, o);
    else if (o.kind === "bush") drawBush(ctx, o);
    else if (o.kind === "rock") drawRock(ctx, o);
    else if (o.kind === "tyres") drawTyres(ctx, o);
    else if (o.kind === "stand") drawStand(ctx, o);
    else if (o.kind === "pylon") drawPylon(ctx, o);
  }
}

const Canopy = [
  [-0.4, -0.08, 0.62],
  [0.38, -0.14, 0.58],
  [0.06, 0.4, 0.55],
  [-0.04, -0.36, 0.6],
  [0.2, 0.16, 0.62],
  [-0.22, 0.14, 0.58],
];

function drawTree(ctx, o) {
  const [dark, mid, light] = o.shades;
  shadow(ctx, o.x, o.y, o.r * 1.05, o.r * 0.64);
  // the silhouette, then the lit top of the same shape
  ctx.fillStyle = dark;
  for (const [dx, dy, k] of Canopy) {
    ctx.beginPath();
    ctx.arc(o.x + dx * o.r, o.y + dy * o.r, o.r * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = mid;
  for (const [dx, dy, k] of Canopy) {
    ctx.beginPath();
    ctx.arc(o.x + (dx - 0.09) * o.r, o.y + (dy - 0.1) * o.r, o.r * k * 0.78, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = light;
  for (const [dx, dy, k] of Canopy.slice(0, 2)) {
    ctx.beginPath();
    ctx.arc(o.x + (dx - 0.24) * o.r, o.y + (dy - 0.28) * o.r, o.r * k * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.07)";
  ctx.beginPath();
  ctx.ellipse(o.x - o.r * 0.32, o.y - o.r * 0.36, o.r * 0.3, o.r * 0.16, -0.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawBush(ctx, o) {
  const [dark, mid, light] = o.shades;
  shadow(ctx, o.x, o.y, o.r * 1.05, o.r * 0.55, 0.12);
  ctx.fillStyle = dark;
  for (const [dx, dy, k] of [
    [-0.45, 0.1, 0.66],
    [0.4, 0.16, 0.6],
    [0, -0.3, 0.72],
  ]) {
    ctx.beginPath();
    ctx.arc(o.x + dx * o.r, o.y + dy * o.r, o.r * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = mid;
  for (const [dx, dy, k] of [
    [-0.42, 0.04, 0.5],
    [0.36, 0.1, 0.46],
    [-0.02, -0.32, 0.55],
  ]) {
    ctx.beginPath();
    ctx.arc(o.x + dx * o.r, o.y + dy * o.r, o.r * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = light;
  ctx.beginPath();
  ctx.arc(o.x - o.r * 0.28, o.y - o.r * 0.34, o.r * 0.26, 0, Math.PI * 2);
  ctx.fill();
}

function drawRock(ctx, o) {
  shadow(ctx, o.x, o.y, o.r * 0.95, o.r * 0.55, 0.14);
  const base = 118 + Math.round(o.shade * 40);
  ctx.fillStyle = `rgb(${base}, ${base + 6}, ${base + 10})`;
  ctx.beginPath();
  const points = 7;
  for (let i = 0; i < points; i += 1) {
    const a = (i / points) * Math.PI * 2;
    const r = o.r * (0.76 + ((i * 37) % 11) / 45);
    const x = o.x + Math.cos(a) * r;
    const y = o.y + Math.sin(a) * r * 0.82;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.beginPath();
  ctx.ellipse(o.x - o.r * 0.2, o.y - o.r * 0.24, o.r * 0.4, o.r * 0.22, -0.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawTyres(ctx, o) {
  shadow(ctx, o.x, o.y, o.r * 1.15, o.r * 0.6, 0.16);
  const bands = ["#e8e8e8", "#d8423f", "#e8e8e8"];
  for (let i = 0; i < 3; i += 1) {
    const x = o.x + (i - 1) * o.r * 1.15;
    const y = o.y + (i % 2 === 0 ? 1 : -1) * o.r * 0.4;
    ctx.fillStyle = "#191c24";
    ctx.beginPath();
    ctx.arc(x, y, o.r * 0.9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bands[i];
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(x, y, o.r * 0.55, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawPylon(ctx, o) {
  shadow(ctx, o.x, o.y, 9, 5, 0.2);
  ctx.fillStyle = "#e9edf7";
  ctx.fillRect(o.x - 4, o.y - 4, 8, 8);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(o.x - 4, o.y - 4, 8, 8);
  // a small checkered flag, pointing away from the road
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.side > 0 ? -0.5 : 0.5);
  const cell = 4;
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "#171a22";
      ctx.fillRect(6 + col * cell, -12 + row * cell, cell, cell);
    }
  }
  ctx.restore();
}

function drawStand(ctx, o) {
  ctx.save();
  ctx.translate(o.x, o.y);
  ctx.rotate(o.angle);
  ctx.fillStyle = "rgba(10, 26, 16, 0.2)";
  ctx.beginPath();
  ctx.roundRect(-124, -39, 252, 88, 10);
  ctx.fill();
  ctx.fillStyle = "#39415c";
  ctx.beginPath();
  ctx.roundRect(-124, -46, 248, 92, 8);
  ctx.fill();
  // four rows of seats, each with a few spectators
  for (let row = 0; row < 4; row += 1) {
    const y = -36 + row * 20;
    ctx.fillStyle = row % 2 === 0 ? "#4b5578" : "#424b6a";
    ctx.fillRect(-114, y, 228, 16);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(-114, y, 228, 2);
    for (let seat = 0; seat < 16; seat += 1) {
      if (((seat * 7 + row * 13 + Math.floor(o.seed * 40)) % 5) === 0) continue;
      ctx.fillStyle = CrowdColors[(seat + row * 3 + Math.floor(o.seed * 6)) % CrowdColors.length];
      ctx.beginPath();
      ctx.arc(-106 + seat * 13.6, y + 8, 2.9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 2;
  ctx.strokeRect(-124, -46, 248, 92);
  ctx.restore();
}
