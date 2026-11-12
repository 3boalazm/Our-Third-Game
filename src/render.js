import { Physics } from "./game.js";
import { createParticles } from "./particles.js";

const Grass = "#4a9a52";
const GrassLine = "rgba(0, 0, 0, 0.07)";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const cam = { x: 0, y: 0, zoom: 1, ready: false };
  const particles = createParticles();
  let width = 0;
  let height = 0;
  let dpr = 1;
  let maxDpr = 2;
  let shakeAmount = 0;
  let boostVisual = 0;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  resize();
  window.addEventListener("resize", resize);

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
    ctx.font = "600 15px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.strokeText(kart.name, kart.x, kart.y - 30);
    ctx.fillStyle = "#fff";
    ctx.fillText(kart.name, kart.x, kart.y - 30);
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
    if (!cam.ready) {
      cam.x = focus.x;
      cam.y = focus.y;
      cam.ready = true;
    }
    const follow = Math.min(1, dt * 7);
    cam.x += (focus.x - cam.x) * follow;
    cam.y += (focus.y - cam.y) * follow;
    // zoom out a little at speed so you can see further ahead
    const zoomTarget = 1 - 0.16 * Math.min(1, focus.speed / Physics.maxSpeed);
    cam.zoom += (zoomTarget - cam.zoom) * Math.min(1, dt * 2);
    const scale = Math.max(0.35, Math.min(width, height) / 760) * cam.zoom * 1.05;

    shakeAmount *= Math.exp(-9 * dt);
    const shakeX = shakeAmount > 0.2 ? (Math.random() - 0.5) * shakeAmount : 0;
    const shakeY = shakeAmount > 0.2 ? (Math.random() - 0.5) * shakeAmount : 0;
    boostVisual += ((focus.nitroOn ? 1 : 0) - boostVisual) * Math.min(1, dt * 6);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = Grass;
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.translate(width / 2 + shakeX, height / 2 + shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-cam.x, -cam.y);

    // faint grid so you can feel the speed on the grass
    const grid = 180;
    const halfW = width / 2 / scale;
    const halfH = height / 2 / scale;
    ctx.strokeStyle = GrassLine;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = Math.floor((cam.x - halfW) / grid) * grid; x < cam.x + halfW; x += grid) {
      ctx.moveTo(x, cam.y - halfH);
      ctx.lineTo(x, cam.y + halfH);
    }
    for (let y = Math.floor((cam.y - halfH) / grid) * grid; y < cam.y + halfH; y += grid) {
      ctx.moveTo(cam.x - halfW, y);
      ctx.lineTo(cam.x + halfW, y);
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
