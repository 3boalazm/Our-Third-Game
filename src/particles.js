// A small fixed-size particle pool (no allocations while racing).

const Max = 360;

export function createParticles() {
  const pool = Array.from({ length: Max }, () => ({
    live: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 4, grow: 0, color: "#fff", kind: "dot",
  }));
  let cursor = 0;

  function emit(kind, x, y, vx, vy, life, size, color, grow = 0) {
    // reuse the oldest slot when the pool is full
    const p = pool[cursor];
    cursor = (cursor + 1) % Max;
    p.live = true;
    p.kind = kind;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.size = size;
    p.grow = grow;
    p.color = color;
  }

  function update(dt) {
    for (const p of pool) {
      if (!p.live) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.live = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - Math.min(1, 2.2 * dt);
      p.vy *= 1 - Math.min(1, 2.2 * dt);
      p.size += p.grow * dt;
    }
  }

  function draw(ctx) {
    for (const p of pool) {
      if (!p.live) continue;
      const k = p.life / p.max;
      if (p.kind === "spark") {
        ctx.globalAlpha = k;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04);
        ctx.stroke();
      } else if (p.kind === "flame") {
        ctx.globalAlpha = k * 0.9;
        ctx.globalCompositeOperation = "lighter";
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * k), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      } else if (p.kind === "grass") {
        ctx.globalAlpha = Math.min(1, k * 1.5);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      } else {
        // smoke
        ctx.globalAlpha = k * 0.55;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function clear() {
    for (const p of pool) p.live = false;
  }

  return { emit, update, draw, clear };
}
