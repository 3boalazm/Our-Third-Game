import { KartScale, Physics, angleDiff } from "./game.js";
import { createParticles } from "./particles.js";
import { viewport } from "./layout.js";

const Grass = "#4a9a52";
const GrassLine = "rgba(0, 0, 0, 0.07)";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  // "chase": the camera sits behind the kart, so the road ahead always runs up the
  // screen. "fixed": the map stays put and the kart turns on it.
  let cameraMode = "chase";
  const AheadWorld = 640; // road (in world pixels) we want to see in front of the kart
  const cam = { x: 0, y: 0, zoom: 1, angle: 0, ready: false };
  const particles = createParticles();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let maxDpr = 2;
  let shakeAmount = 0;
  let boostVisual = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    // the size of the game's own drawing area (swapped when turned sideways)
    ({ w: width, h: height } = viewport());
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  resize();

  function drawTrack(track) {
    const w = track.def.width;
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

    // start / finish line
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
    // nose stripe
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.fillRect(14, -2.5, 8, 5);
    ctx.restore();
  }

  function drawName(kart) {
    ctx.save();
    ctx.translate(kart.x, kart.y);
    // keep the text upright even though the whole world is turned by the chase camera
    ctx.rotate(cameraMode === "chase" ? cam.angle + Math.PI / 2 : 0);
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeText(kart.name, 0, -30 * KartScale);
    ctx.fillStyle = "#fff";
    ctx.fillText(kart.name, 0, -30 * KartScale);
    ctx.restore();
  }

  function drawMinimap(track, karts, me) {
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
    ctx.restore();
  }

  function draw({ track, karts, me }, dt) {
    const focus = me ?? karts[0];
    const chase = cameraMode === "chase";
    if (!cam.ready) {
      cam.x = focus.x;
      cam.y = focus.y;
      cam.angle = focus.a;
      cam.ready = true;
    }
    const follow = Math.min(1, dt * (chase ? 10 : 7));
    cam.x += (focus.x - cam.x) * follow;
    cam.y += (focus.y - cam.y) * follow;
    if (chase) {
      cam.angle += angleDiff(focus.a, cam.angle) * Math.min(1, dt * 6);
    } else {
      cam.angle = focus.a; // so switching to the chase camera starts from the right angle
    }
    // zoom out a little at speed so you can see further ahead
    const zoomTarget = 1 - 0.16 * Math.min(1, focus.speed / Physics.maxSpeed);
    cam.zoom += (zoomTarget - cam.zoom) * Math.min(1, dt * 2);
    let fit = Math.max(0.35, Math.min(width, height) / 760) * 1.14;
    // On a short (landscape) screen the kart sits low and only ~70% of the height is
    // road ahead: zoom out enough to still see a good stretch of it.
    if (chase) {
      fit = Math.min(fit, (0.72 * height) / AheadWorld);
    }
    const scale = fit * cam.zoom;
    const anchorY = chase ? height * 0.72 : height / 2;

    shakeAmount *= Math.exp(-9 * dt);
    const shakeX = shakeAmount > 0.2 ? (Math.random() - 0.5) * shakeAmount : 0;
    const shakeY = shakeAmount > 0.2 ? (Math.random() - 0.5) * shakeAmount : 0;
    boostVisual += ((focus.nitroOn ? 1 : 0) - boostVisual) * Math.min(1, dt * 6);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = Grass;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2 + shakeX, anchorY + shakeY);
    ctx.scale(scale, scale);
    if (chase) {
      ctx.rotate(-Math.PI / 2 - cam.angle); // the kart's heading points up the screen
    }
    ctx.translate(-cam.x, -cam.y);

    // faint grid so you can feel the speed on the grass (a square that covers any rotation)
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

    drawTrack(track);
    particles.draw(ctx);
    const ordered = [...karts].sort((a, b) => a.y - b.y);
    for (const kart of ordered) {
      drawKart(kart, kart === me);
    }
    for (const kart of ordered) {
      if (kart !== me) {
        drawName(kart);
      }
    }
    ctx.restore();

    if (boostVisual > 0.03) {
      drawSpeedLines();
    }
    drawMinimap(track, karts, me);
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
    setCameraMode(mode) {
      cameraMode = mode === "fixed" ? "fixed" : "chase";
    },
    shake(amount) {
      shakeAmount = Math.max(shakeAmount, amount);
    },
    // lower the canvas resolution on slow devices
    setMaxDpr(value) {
      maxDpr = value;
      resize();
    },
  };
}
