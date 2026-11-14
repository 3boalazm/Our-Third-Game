import { KartScale, Physics, angleDiff } from "./game.js";
import { createParticles } from "./particles.js";
import { createScenery, drawScenery } from "./scenery.js";
import { viewport } from "./layout.js";

const Grass = "#4a9a52";
const GrassLine = "rgba(0, 0, 0, 0.06)";
const MaxMarks = 850;

// The road never changes during a race. Rasterize its heavy geometry into the
// same per-track offscreen layer as the scenery, instead of stroking ~900-point
// paths and rebuilding both edge guides on every animation frame.
function drawStaticTrack(ctx, track) {
  const w = track.def.width;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.strokeStyle = "#d8423f";
  ctx.lineWidth = w + 40;
  ctx.stroke(track.path);
  ctx.strokeStyle = "#f6f6f6";
  ctx.setLineDash([38, 38]);
  ctx.stroke(track.path);
  ctx.setLineDash([]);
  ctx.strokeStyle = "#454a58";
  ctx.lineWidth = w;
  ctx.stroke(track.path);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
  ctx.lineWidth = 5;
  ctx.setLineDash([28, 34]);
  ctx.stroke(track.path);
  ctx.setLineDash([]);

  // Thin painted edge guides are static too; bake them with the road.
  ctx.strokeStyle = "rgba(234, 246, 255, 0.62)";
  ctx.lineWidth = 4;
  ctx.setLineDash([24, 20]);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 0; i < track.N; i += 1) {
      const s = track.samples[i];
      const offset = side * (track.halfWidth - 17);
      const x = s.x - s.ty * offset;
      const y = s.y + s.tx * offset;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The start / finish line is part of the baked track layer as well.
  const s = track.samples[0];
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(Math.atan2(s.ty, s.tx));
  const half = track.halfWidth;
  const cell = 20;
  for (let row = 0, y = -half; y < half; row += 1, y += cell) {
    for (let col = 0; col < 2; col += 1) {
      ctx.fillStyle = (row + col) % 2 === 0 ? "#ffffff" : "#1b1b1b";
      ctx.fillRect(col * cell - cell, y, cell, Math.min(cell, half - y));
    }
  }
  ctx.restore();
  ctx.restore();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  // "chase": the camera sits behind the kart, so the road ahead always runs up the
  // screen. "fixed": the map stays put and the kart turns on it.
  let cameraMode = "chase";
  const AheadWorld = 820; // keep a longer stretch of road visible in the chase view
  const cam = { x: 0, y: 0, zoom: 1, angle: 0, ready: false };
  const particles = createParticles();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let maxDpr = 2;
  let shakeAmount = 0;
  let boostVisual = 0;
  let clock = 0;
  let boostGradient = null;
  const rainDrops = Array.from({ length: 150 }, (_, i) => {
    const seed = Math.sin(i * 127.1 + 11.7) * 43758.5453;
    const r = seed - Math.floor(seed);
    return {
      x: r,
      y: (r * 7.13) % 1,
      speed: 0.7 + ((r * 13.7) % 1) * 0.9,
      len: 10 + ((r * 31.3) % 1) * 16,
      alpha: 0.16 + ((r * 17.9) % 1) * 0.3,
    };
  });

  // tyre marks are kept in a fixed ring buffer, in world pixels
  const marks = Array.from({ length: MaxMarks }, () => ({ x1: 0, y1: 0, x2: 0, y2: 0, kind: 0 }));
  let markCursor = 0;
  let markCount = 0;

  // one offscreen canvas per track, holding the grass texture and the scenery
  let layer = null;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    // the size of the game's own drawing area (swapped when turned sideways)
    ({ w: width, h: height } = viewport());
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const cx = width / 2;
    const cy = height / 2;
    const reach = Math.max(width, height) * 0.72;
    boostGradient = ctx.createRadialGradient(cx, cy, Math.min(width, height) * 0.18, cx, cy, reach);
    boostGradient.addColorStop(0, "rgba(120, 210, 255, 0)");
    boostGradient.addColorStop(0.62, "rgba(90, 190, 255, 0.12)");
    boostGradient.addColorStop(1, "rgba(70, 170, 255, 0.5)");
  }
  resize();

  // Build the static layer for a track once: grass patches, trees, stands.
  function ensureLayer(track) {
    if (layer && layer.id === track.def.id) {
      return layer;
    }
    const scenery = createScenery(track);
    const margin = 700;
    const b = track.bounds;
    const worldW = b.maxX - b.minX + margin * 2;
    const worldH = b.maxY - b.minY + margin * 2;
    const scale = Math.min(0.6, 2200 / Math.max(worldW, worldH));
    const off = document.createElement("canvas");
    off.width = Math.ceil(worldW * scale);
    off.height = Math.ceil(worldH * scale);
    const lc = off.getContext("2d");
    lc.scale(scale, scale);
    lc.translate(-(b.minX - margin), -(b.minY - margin));

    // soft light and shade so the grass is not one flat colour
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < 260; i += 1) {
      const x = b.minX - margin + rnd() * worldW;
      const y = b.minY - margin + rnd() * worldH;
      const r = 22 + rnd() * 72;
      lc.fillStyle = rnd() < 0.5 ? "rgba(255, 255, 255, 0.028)" : "rgba(0, 40, 12, 0.034)";
      lc.beginPath();
      lc.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
      lc.fill();
    }
    // a few tiny flowers, just enough to break up the green
    for (let i = 0; i < 220; i += 1) {
      const x = b.minX - margin + rnd() * worldW;
      const y = b.minY - margin + rnd() * worldH;
      lc.fillStyle = rnd() < 0.55 ? "rgba(255, 248, 190, 0.5)" : "rgba(255, 255, 255, 0.38)";
      lc.beginPath();
      lc.arc(x, y, 1.4 + rnd() * 1.8, 0, Math.PI * 2);
      lc.fill();
    }
    drawScenery(lc, scenery);
    drawStaticTrack(lc, track);
    layer = { id: track.def.id, canvas: off, x: b.minX - margin, y: b.minY - margin, w: worldW, h: worldH };
    return layer;
  }

  function resetMarks(karts) {
    markCursor = 0;
    markCount = 0;
    for (const kart of karts ?? []) kart.__marks = null;
  }

  // Glowing chevrons across the road. A pulse runs along them towards the
  // direction of travel, so the pad reads from a distance.
  function drawPads(track) {
    for (const pad of track.pads ?? []) {
      ctx.save();
      ctx.translate(pad.x, pad.y);
      ctx.rotate(Math.atan2(pad.ty, pad.tx));
      const pulse = 0.55 + 0.45 * Math.sin(clock * 4 + pad.idx);
      ctx.fillStyle = `rgba(70, 190, 255, ${0.13 + pulse * 0.12})`;
      ctx.beginPath();
      ctx.roundRect(-pad.length / 2, -pad.half, pad.length, pad.half * 2, 16);
      ctx.fill();
      ctx.strokeStyle = `rgba(150, 225, 255, ${0.35 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i += 1) {
        const x = -pad.length / 2 + 24 + i * 34 + (clock * 34) % 34;
        if (x > pad.length / 2 - 12) continue;
        ctx.strokeStyle = `rgba(215, 245, 255, ${0.35 + pulse * 0.45})`;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(x - 12, -pad.half * 0.55);
        ctx.lineTo(x + 2, 0);
        ctx.lineTo(x - 12, pad.half * 0.55);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // Collectible fuel canisters are deliberately different from the flat blue
  // boost strips: these refill the actual nitro tank when the kart drives through.
  function drawNitroPickups(track, me) {
    for (let i = 0; i < (track.nitroPickups ?? []).length; i += 1) {
      const pickup = track.nitroPickups[i];
      if ((me?.nitroPickupCooldowns?.[i] ?? 0) > 0) continue;
      const pulse = 0.72 + 0.28 * Math.sin(clock * 4.6 + pickup.idx);
      const bob = Math.sin(clock * 3.2 + pickup.idx) * 3;
      ctx.save();
      ctx.translate(pickup.x, pickup.y + bob);
      ctx.rotate(Math.atan2(pickup.ty, pickup.tx));

      ctx.globalAlpha = pulse;
      ctx.shadowColor = "rgba(58, 211, 255, .95)";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "rgba(47, 185, 235, .2)";
      ctx.beginPath();
      ctx.ellipse(0, 0, 31, 31, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.strokeStyle = "rgba(145, 239, 255, .92)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(4, 24, 39, .9)";
      ctx.beginPath();
      ctx.roundRect(-15, -21, 30, 42, 8);
      ctx.fill();
      ctx.strokeStyle = "#9ceeff";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = "#39c9f3";
      ctx.beginPath();
      ctx.roundRect(-8, -26, 16, 8, 3);
      ctx.fill();
      ctx.fillStyle = "#d9fbff";
      ctx.beginPath();
      ctx.moveTo(3, -15);
      ctx.lineTo(-6, 1);
      ctx.lineTo(0, 1);
      ctx.lineTo(-3, 14);
      ctx.lineTo(8, -3);
      ctx.lineTo(2, -3);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = "#e7fbff";
      ctx.font = "900 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = "rgba(0, 0, 0, .75)";
      ctx.shadowBlur = 4;
      ctx.fillText("+35%", 0, 39);
      ctx.restore();
    }
  }

  function drawKart(kart, isMe) {
    ctx.save();
    ctx.translate(kart.x, kart.y);
    ctx.rotate(kart.a);
    ctx.scale(KartScale, KartScale);
    // shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.roundRect(-24, -12, 52, 28, 8);
    ctx.fill();
    // nitro flame
    if (kart.nitroOn) {
      const flicker = 10 + Math.random() * 8;
      const flame = ctx.createLinearGradient(-24, 0, -24 - 22 - flicker, 0);
      flame.addColorStop(0, "rgba(255, 240, 160, 0.95)");
      flame.addColorStop(0.5, "rgba(255, 120, 40, 0.85)");
      flame.addColorStop(1, "rgba(120, 200, 255, 0)");
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.moveTo(-23, -6);
      ctx.lineTo(-24 - 22 - flicker, 0);
      ctx.lineTo(-23, 6);
      ctx.closePath();
      ctx.fill();
    } else if (kart.boostTimer > 0) {
      const flicker = 4 + Math.random() * 5;
      ctx.fillStyle = "rgba(140, 220, 255, 0.75)";
      ctx.beginPath();
      ctx.moveTo(-23, -5);
      ctx.lineTo(-30 - flicker, 0);
      ctx.lineTo(-23, 5);
      ctx.closePath();
      ctx.fill();
    }
    // wheels
    ctx.fillStyle = "#16181f";
    for (const [wx, wy] of [[-16, -15], [14, -15], [-16, 9], [14, 9]]) {
      ctx.fillRect(wx, wy, 12, 7);
    }
    // body
    ctx.fillStyle = kart.color;
    ctx.beginPath();
    ctx.roundRect(-22, -11, 46, 22, 8);
    ctx.fill();
    ctx.lineWidth = isMe ? 3 : 1.5;
    ctx.strokeStyle = isMe ? "#ffffff" : "rgba(0, 0, 0, 0.35)";
    ctx.stroke();
    // cockpit
    ctx.fillStyle = "rgba(20, 24, 34, 0.85)";
    ctx.beginPath();
    ctx.roundRect(-4, -7, 14, 14, 4);
    ctx.fill();
    // nose livery
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    if (kart.livery === "twin") {
      ctx.fillRect(14, -6, 10, 2.5);
      ctx.fillRect(14, 3.5, 10, 2.5);
    } else if (kart.livery !== "clean") {
      ctx.fillRect(14, -2.5, 8, 5);
    }
    ctx.restore();
  }

  function drawName(kart) {
    if (!kart.name) return;
    ctx.save();
    ctx.translate(kart.x, kart.y);
    // keep the text upright even though the whole world is turned by the chase camera
    ctx.rotate(cameraMode !== "fixed" ? cam.angle + Math.PI / 2 : 0);
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeText(kart.name, 0, -30 * KartScale);
    ctx.fillStyle = "#fff";
    ctx.fillText(kart.name, 0, -30 * KartScale);
    ctx.restore();
  }

  // Leave two dark lines behind a kart that is sliding or on the grass.
  function rememberMarks(karts) {
    for (const kart of karts) {
      const laying =
        (kart.drifting && kart.speed > 150) || (kart.offRoad && kart.speed > 120);
      const cos = Math.cos(kart.a);
      const sin = Math.sin(kart.a);
      const rear = 20 * KartScale;
      const wheel = 10 * KartScale;
      const lx = kart.x - cos * rear - sin * wheel;
      const ly = kart.y - sin * rear + cos * wheel;
      const rx = kart.x - cos * rear + sin * wheel;
      const ry = kart.y - sin * rear - cos * wheel;
      const prev = kart.__marks;
      if (laying && prev) {
        const jump = Math.hypot(lx - prev.lx, ly - prev.ly);
        if (jump > 1.5 && jump < 80) {
          const mark = marks[markCursor];
          markCursor = (markCursor + 1) % MaxMarks;
          markCount = Math.min(MaxMarks, markCount + 1);
          mark.x1 = prev.lx;
          mark.y1 = prev.ly;
          mark.x2 = lx;
          mark.y2 = ly;
          mark.kind = kart.offRoad ? 1 : 0;
          const mark2 = marks[markCursor];
          markCursor = (markCursor + 1) % MaxMarks;
          markCount = Math.min(MaxMarks, markCount + 1);
          mark2.x1 = prev.rx;
          mark2.y1 = prev.ry;
          mark2.x2 = rx;
          mark2.y2 = ry;
          mark2.kind = kart.offRoad ? 1 : 0;
        }
        kart.__marks = { lx, ly, rx, ry };
      } else if (laying) {
        kart.__marks = { lx, ly, rx, ry };
      } else {
        kart.__marks = null;
      }
    }
  }

  function drawMarks() {
    if (markCount === 0) return;
    ctx.save();
    ctx.lineCap = "round";
    for (const kind of [0, 1]) {
      ctx.strokeStyle = kind === 0 ? "rgba(22, 22, 28, 0.2)" : "rgba(56, 42, 22, 0.18)";
      ctx.lineWidth = kind === 0 ? 7 : 8;
      ctx.beginPath();
      for (let i = 0; i < markCount; i += 1) {
        const m = marks[i];
        if (m.kind !== kind) continue;
        ctx.moveTo(m.x1, m.y1);
        ctx.lineTo(m.x2, m.y2);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawMinimap(track, karts, me, ghost) {
    const boxW = Math.min(150, width * 0.32);
    const boxH = boxW * 0.72;
    const pad = 10;
    const b = track.bounds;
    const k = Math.min(
      (boxW - 16) / (b.maxX - b.minX + track.def.width),
      (boxH - 16) / (b.maxY - b.minY + track.def.width),
    );
    const ox = width - boxW - pad + (boxW - (b.maxX - b.minX) * k) / 2 - b.minX * k;
    const oy = pad + (boxH - (b.maxY - b.minY) * k) / 2 - b.minY * k;
    ctx.save();
    ctx.fillStyle = "rgba(10, 14, 26, 0.55)";
    ctx.beginPath();
    ctx.roundRect(width - boxW - pad, pad, boxW, boxH, 12);
    ctx.fill();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    ctx.lineJoin = "round";
    ctx.strokeStyle = "rgba(255, 255, 255, 0.75)";
    ctx.lineWidth = 7 / k;
    ctx.stroke(track.path);
    // boost pads
    ctx.fillStyle = "rgba(120, 215, 255, 0.9)";
    for (const p of track.pads ?? []) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.6 / k, 0, Math.PI * 2);
      ctx.fill();
    }
    // collectible nitro canisters
    ctx.fillStyle = "#8ceeff";
    ctx.strokeStyle = "rgba(7, 36, 54, .9)";
    ctx.lineWidth = 1.5 / k;
    for (let i = 0; i < (track.nitroPickups ?? []).length; i += 1) {
      if ((me?.nitroPickupCooldowns?.[i] ?? 0) > 0) continue;
      const pickup = track.nitroPickups[i];
      ctx.beginPath();
      ctx.arc(pickup.x, pickup.y, 4.2 / k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // start line
    const s = track.samples[0];
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.lineWidth = 2 / k;
    ctx.beginPath();
    ctx.moveTo(s.x - s.ty * track.halfWidth, s.y + s.tx * track.halfWidth);
    ctx.lineTo(s.x + s.ty * track.halfWidth, s.y - s.tx * track.halfWidth);
    ctx.stroke();
    for (const kart of karts) {
      ctx.fillStyle = kart.color;
      ctx.beginPath();
      ctx.arc(kart.x, kart.y, (kart === me ? 8 : 6) / k, 0, Math.PI * 2);
      ctx.fill();
      if (kart === me) {
        ctx.lineWidth = 2 / k;
        ctx.strokeStyle = "#fff";
        ctx.stroke();
      }
    }
    if (ghost) {
      ctx.strokeStyle = "rgba(220, 246, 255, 0.9)";
      ctx.lineWidth = 2 / k;
      ctx.beginPath();
      ctx.arc(ghost.x, ghost.y, 7 / k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // The saved best lap: a pale copy of the kart, drawn under the real karts.
  function drawGhost(ghost) {
    ctx.save();
    ctx.globalAlpha = 0.45;
    drawKart(
      {
        x: ghost.x,
        y: ghost.y,
        a: ghost.a,
        color: "#d9f4ff",
        livery: "clean",
        nitroOn: false,
        boostTimer: 0,
      },
      false,
    );
    ctx.restore();
    ctx.save();
    ctx.translate(ghost.x, ghost.y);
    ctx.rotate(cameraMode !== "fixed" ? cam.angle + Math.PI / 2 : 0);
    ctx.font = "700 12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.45)";
    ctx.strokeText("GHOST", 0, -27 * KartScale);
    ctx.fillStyle = "rgba(220, 246, 255, 0.9)";
    ctx.fillText("GHOST", 0, -27 * KartScale);
    ctx.restore();
  }

  // Rain streaks, a wet dark tint and night headlights. Drawn in screen space
  // after the world so it never changes how the track itself is drawn.
  function drawWeather(weather, dt, project, me, chase, photo) {
    if (!weather || weather.id === "clear") return;
    if (weather.id === "rain") {
      ctx.save();
      ctx.fillStyle = "rgba(22, 36, 58, 0.22)";
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(190, 220, 255, 0.45)";
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (const drop of rainDrops) {
        drop.y += drop.speed * dt;
        if (drop.y > 1.08) {
          drop.y -= 1.16;
          drop.x = (drop.x + 0.37) % 1;
        }
        const x = ((drop.x + drop.y * 0.05) % 1) * width;
        const y = drop.y * height;
        ctx.moveTo(x, y);
        ctx.lineTo(x - drop.len * 0.22, y + drop.len);
      }
      ctx.stroke();
      ctx.restore();
      return;
    }
    if (weather.id === "night") {
      ctx.save();
      ctx.fillStyle = "rgba(4, 8, 24, 0.56)";
      ctx.fillRect(0, 0, width, height);
      if (me) {
        const p = project(me.x, me.y);
        const heading = chase ? -Math.PI / 2 - (photo?.orbit ?? 0) : me.a;
        ctx.globalCompositeOperation = "lighter";
        ctx.translate(p.x, p.y);
        ctx.rotate(heading);
        const beam = ctx.createLinearGradient(0, 0, 300, 0);
        beam.addColorStop(0, "rgba(255, 235, 170, 0.22)");
        beam.addColorStop(0.65, "rgba(255, 232, 160, 0.08)");
        beam.addColorStop(1, "rgba(255, 232, 160, 0)");
        ctx.fillStyle = beam;
        ctx.beginPath();
        ctx.moveTo(8, -20);
        ctx.lineTo(310, -115);
        ctx.lineTo(310, 115);
        ctx.lineTo(8, 20);
        ctx.closePath();
        ctx.fill();
        const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 170);
        glow.addColorStop(0, "rgba(255, 236, 178, 0.28)");
        glow.addColorStop(0.45, "rgba(255, 226, 160, 0.10)");
        glow.addColorStop(1, "rgba(255, 226, 160, 0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(0, 0, 170, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function draw({ track, karts, me, ghost, weather, photo, showStartMarker = false }, dt) {
    clock += dt;
    const focus = me ?? karts[0];
    const chase = photo ? true : cameraMode !== "fixed";
    const rear = !photo && cameraMode === "rear";
    // Lead the camera ahead of the kart as speed rises. This moves the kart
    // toward the bottom of the screen and gives the player more time to read turns.
    const lookAhead = chase && !photo ? Math.min(88, Math.max(0, focus.speed * 0.16)) : 0;
    const rearOffset = rear ? 175 : 0;
    const targetX = focus.x + Math.cos(focus.a) * (lookAhead - rearOffset);
    const targetY = focus.y + Math.sin(focus.a) * (lookAhead - rearOffset);
    if (!cam.ready) {
      cam.x = targetX;
      cam.y = targetY;
      cam.angle = focus.a;
      cam.ready = true;
    }
    if (photo) {
      // Framed shot: centre the kart, orbit with the pointer/keys, free zoom.
      const follow = Math.min(1, dt * 8);
      cam.x += (focus.x - cam.x) * follow;
      cam.y += (focus.y - cam.y) * follow;
      cam.angle += angleDiff(focus.a + (photo.orbit ?? 0), cam.angle) * follow;
      cam.zoom += ((photo.zoom ?? 1.35) - cam.zoom) * follow;
    } else {
      const follow = Math.min(1, dt * (chase ? 7 : 7));
      cam.x += (targetX - cam.x) * follow;
      cam.y += (targetY - cam.y) * follow;
      if (chase) {
        cam.angle += angleDiff(focus.a, cam.angle) * Math.min(1, dt * 5.5);
      } else {
        cam.angle = focus.a; // so switching to the chase camera starts from the right angle
      }
      // Zoom out at speed to keep a longer braking / cornering window in view.
      const zoomTarget = 1 - 0.16 * Math.min(1, focus.speed / Physics.maxSpeed);
      cam.zoom += (zoomTarget - cam.zoom) * Math.min(1, dt * 2);
    }
    let fit = Math.max(0.35, Math.min(width, height) / 760) * 1.14;
    // Keep extra road in view for the speed-based chase-camera lead.
    if (chase) {
      fit = Math.min(fit, (0.74 * height) / AheadWorld);
    }
    const scale = fit * cam.zoom;
    const anchorY = chase ? (photo ? height / 2 : height * (rear ? 0.77 : 0.70)) : height / 2;

    shakeAmount *= Math.exp(-9 * dt);
    const shakeX = shakeAmount > 0.2 ? (Math.random() - 0.5) * shakeAmount : 0;
    const shakeY = shakeAmount > 0.2 ? (Math.random() - 0.5) * shakeAmount : 0;
    boostVisual += ((focus.nitroOn ? 1 : 0) - boostVisual) * Math.min(1, dt * 6);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = track.def.grass ?? Grass;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2 + shakeX, anchorY + shakeY);
    ctx.scale(scale, scale);
    if (chase) {
      ctx.rotate(-Math.PI / 2 - cam.angle); // the kart's heading points up the screen
    }
    ctx.translate(-cam.x, -cam.y);

    // faint grid (under the road and the scenery) so you can feel the speed on the grass (a square that covers any rotation)
    const grid = 180;
    const reach = Math.hypot(width, height) / scale + grid;
    ctx.strokeStyle = GrassLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.floor((cam.x - reach) / grid) * grid; x < cam.x + reach; x += grid) {
      ctx.moveTo(x, cam.y - reach);
      ctx.lineTo(x, cam.y + reach);
    }
    for (let y = Math.floor((cam.y - reach) / grid) * grid; y < cam.y + reach; y += grid) {
      ctx.moveTo(cam.x - reach, y);
      ctx.lineTo(cam.x + reach, y);
    }
    ctx.stroke();

    // static grass texture and scenery, baked once per track
    const world = ensureLayer(track);
    ctx.drawImage(world.canvas, world.x, world.y, world.w, world.h);
    drawPads(track);
    drawNitroPickups(track, me);
    rememberMarks(karts);
    drawMarks();

    particles.draw(ctx);
    if (ghost) drawGhost(ghost);
    const ordered = [...karts].sort((a, b) => a.y - b.y);
    for (const kart of ordered) {
      drawKart(kart, kart === me);
    }
    if (!photo) {
      for (const kart of ordered) {
        if (kart !== me) {
          drawName(kart);
        }
      }
    }
    ctx.restore();

    // screen-space projection, used by the night headlights
    const theta = chase ? -Math.PI / 2 - cam.angle : 0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const project = (x, y) => {
      const dx = x - cam.x;
      const dy = y - cam.y;
      return {
        x: width / 2 + shakeX + scale * (dx * cosT - dy * sinT),
        y: anchorY + shakeY + scale * (dx * sinT + dy * cosT),
      };
    };
    drawWeather(weather, dt, project, focus, chase, photo);

    // Keep the player's grid position obvious while the race is about to start.
    // This is drawn in screen space so it stays legible in both camera modes.
    if (!photo && showStartMarker && me) {
      const point = project(me.x, me.y);
      const pulse = 0.78 + 0.18 * (0.5 + 0.5 * Math.sin(clock * 6));
      const radiusX = Math.max(27, scale * 44);
      const radiusY = Math.max(18, scale * 29);
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "#a7efff";
      ctx.lineWidth = 3;
      ctx.shadowColor = "rgba(91, 213, 255, 0.9)";
      ctx.shadowBlur = 16;
      ctx.beginPath();
      ctx.ellipse(0, 0, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;

      const labelY = -(radiusY + 26);
      ctx.fillStyle = "rgba(5, 14, 26, 0.94)";
      ctx.beginPath();
      ctx.roundRect(-31, labelY - 10, 62, 20, 8);
      ctx.fill();
      ctx.strokeStyle = "rgba(167, 239, 255, 0.9)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("YOU", 0, labelY);
      ctx.restore();
    }

    if (!photo && boostVisual > 0.03) {
      drawSpeedLines();
      ctx.save();
      ctx.globalAlpha = boostVisual;
      ctx.fillStyle = boostGradient;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    if (!photo) drawMinimap(track, karts, me, ghost);
  }

  // streaks flying out from the centre while the nitro is on
  function drawSpeedLines() {
    const cx = width / 2;
    const cy = height / 2;
    const reach = Math.hypot(cx, cy);
    ctx.save();
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.22 * boostVisual})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 18; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const from = reach * (0.35 + Math.random() * 0.3);
      const to = from + reach * (0.15 + Math.random() * 0.25);
      ctx.moveTo(cx + Math.cos(angle) * from, cy + Math.sin(angle) * from);
      ctx.lineTo(cx + Math.cos(angle) * to, cy + Math.sin(angle) * to);
    }
    ctx.stroke();
    ctx.restore();
  }

  return {
    draw,
    resize,
    particles,
    resetMarks,
    resetCamera() {
      cam.ready = false;
      cam.zoom = 1;
    },
    setCameraMode(mode) {
      cameraMode = ["fixed", "rear"].includes(mode) ? mode : "chase";
    },
    shake(amount) {
      shakeAmount = Math.max(shakeAmount, amount);
    },
    snapshot() {
      try {
        return canvas.toDataURL("image/png");
      } catch {
        return null;
      }
    },
    // lower the canvas resolution on slow devices
    setMaxDpr(value) {
      maxDpr = value;
      resize();
    },
  };
}
