// Item boxes and the items inside them (offline races only).
//
//   boost   an instant burst of speed
//   shield  8 seconds of protection that blocks one hit
//   rocket  flies along the road and homes in on the kart just ahead
//   oil     a slick dropped behind you; whoever drives into it spins out
//
// A box gives an item after a short "roulette". Karts at the back are more
// likely to get rockets and boosts, the leader shields and oil. Bots use their
// items on their own. Pure logic (no drawing), tested in tests/items.test.mjs.
// Kart fields used: item, itemRoll, itemPending, itemHeld, shieldTimer, spinTimer.

export const ItemKinds = ["boost", "shield", "rocket", "oil"];
export const ItemInfo = {
  boost: { name: "Boost", icon: "⚡" },
  shield: { name: "Shield", icon: "🛡" },
  rocket: { name: "Rocket", icon: "🚀" },
  oil: { name: "Oil slick", icon: "🛢" },
};

const RowFractions = [0.07, 0.38, 0.69]; // away from the boost pads and nitro canisters
const BoxRespawn = 3;
const BoxRadius = 42;
const RollTime = 0.9;
export const ShieldTime = 8;
export const SpinTime = 1.0;
const RocketSpeed = 980; // px / s
const RocketLife = 5;
const OilLife = 25;
const OilRadius = 40;
const Spacing = 14; // track sample spacing (see track.js)

// Boxes in rows across the road, on fairly straight bits near RowFractions.
export function buildItemBoxes(track) {
  const { samples, N, halfWidth } = track;
  const boxes = [];
  for (const fraction of RowFractions) {
    let best = Math.round(fraction * N);
    let bestScore = -Infinity;
    for (let o = -Math.round(N * 0.03); o <= Math.round(N * 0.03); o += 2) {
      const i = (Math.round(fraction * N) + o + N) % N;
      const a = samples[(i - 15 + N) % N];
      const b = samples[(i + 15) % N];
      const score = a.tx * b.tx + a.ty * b.ty - Math.abs(o) / N;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const s = samples[best];
    for (const lane of [-0.6, -0.2, 0.2, 0.6]) {
      const off = lane * halfWidth;
      boxes.push({ idx: best, x: s.x - s.ty * off, y: s.y + s.tx * off, activeAt: 0 });
    }
  }
  return boxes;
}

// Weights for each item by race position: 0 = leading, 1 = last.
export function itemWeights(fraction) {
  const f = Math.max(0, Math.min(1, fraction));
  const lead = { shield: 0.4, oil: 0.45, boost: 0.15, rocket: 0 };
  const last = { shield: 0.1, oil: 0.05, boost: 0.4, rocket: 0.45 };
  const out = {};
  for (const k of ItemKinds) out[k] = lead[k] + (last[k] - lead[k]) * f;
  return out;
}

export function rollItem(fraction, rng = Math.random) {
  const w = itemWeights(fraction);
  let r = rng() * ItemKinds.reduce((sum, k) => sum + w[k], 0);
  for (const k of ItemKinds) {
    r -= w[k];
    if (r <= 0) return k;
  }
  return "boost";
}

function sampleAt(track, p) {
  const { samples, N } = track;
  const base = Math.floor(p);
  const f = p - base;
  const a = samples[((base % N) + N) % N];
  const b = samples[(((base + 1) % N) + N) % N];
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, tx: a.tx, ty: a.ty };
}

function lateral(track, kart) {
  const s = track.samples[kart.lastIdx ?? 0];
  return (kart.x - s.x) * -s.ty + (kart.y - s.y) * s.tx;
}

export function createItems(track, { rng = Math.random } = {}) {
  const boxes = buildItemBoxes(track);
  const rockets = [];
  const oils = [];
  const events = [];

  function hit(kart, by, kind) {
    if ((kart.shieldTimer ?? 0) > 0) {
      kart.shieldTimer = 0;
      events.push({ type: "blocked", kart, by, kind });
      return false;
    }
    kart.spinTimer = SpinTime;
    events.push({ type: "hit", kart, by, kind });
    return true;
  }

  // Use the item a kart holds. `order` is the race order (leader first).
  function use(kart, time, order) {
    const kind = kart.item;
    if (!kind || (kart.spinTimer ?? 0) > 0) return false;
    kart.item = null;
    kart.itemHeld = 0;
    if (kind === "boost") {
      kart.boostTimer = Math.max(kart.boostTimer ?? 0, 1.4);
      kart.boostSource = "item";
    } else if (kind === "shield") {
      kart.shieldTimer = ShieldTime;
    } else if (kind === "oil") {
      oils.push({
        x: kart.x - Math.cos(kart.a) * 58,
        y: kart.y - Math.sin(kart.a) * 58,
        born: time,
        owner: kart,
      });
    } else if (kind === "rocket") {
      const rank = order.indexOf(kart);
      const target = rank > 0 ? order[rank - 1] : null;
      rockets.push({
        p: (kart.progress ?? 0) + 3,
        offset: lateral(track, kart),
        x: kart.x,
        y: kart.y,
        a: kart.a,
        target,
        owner: kart,
        life: RocketLife,
        homing: false,
      });
    }
    events.push({ type: "use", kart, kind });
    return true;
  }

  function botThink(kart, dt, time, order) {
    kart.itemHeld = (kart.itemHeld ?? 0) + dt;
    if (kart.itemHeld < (kart.itemDelay ?? 1.2)) return;
    const rank = order.indexOf(kart);
    const kind = kart.item;
    let go = false;
    if (kind === "shield" || kind === "boost") go = true;
    else if (kind === "rocket") go = rank > 0 || kart.itemHeld > 6;
    else if (kind === "oil") {
      const behind = order[rank + 1];
      go = !behind || Math.hypot(behind.x - kart.x, behind.y - kart.y) < 650 || kart.itemHeld > 7;
    }
    if (go) use(kart, time, order);
  }

  function update(dt, time, karts, order) {
    // timers on the karts
    for (const kart of karts) {
      if ((kart.shieldTimer ?? 0) > 0) kart.shieldTimer = Math.max(0, kart.shieldTimer - dt);
      if ((kart.itemRoll ?? 0) > 0) {
        kart.itemRoll = Math.max(0, kart.itemRoll - dt);
        if (kart.itemRoll === 0 && kart.itemPending) {
          kart.item = kart.itemPending;
          kart.itemPending = null;
          kart.itemHeld = 0;
          kart.itemDelay = 0.8 + rng() * 2.5;
          events.push({ type: "got", kart, kind: kart.item });
        }
      }
    }
    // picking up boxes
    for (const box of boxes) {
      if (time < box.activeAt) continue;
      for (const kart of karts) {
        if (kart.finished) continue;
        if (Math.hypot(kart.x - box.x, kart.y - box.y) > BoxRadius) continue;
        box.activeAt = time + BoxRespawn;
        if (!kart.item && !(kart.itemRoll > 0)) {
          const rank = order.indexOf(kart);
          const fraction = order.length > 1 ? rank / (order.length - 1) : 0;
          kart.itemPending = rollItem(fraction, rng);
          kart.itemRoll = RollTime;
          events.push({ type: "box", kart });
        }
        break;
      }
    }
    // bots use what they hold
    for (const kart of karts) {
      if (kart.bot && kart.item && !kart.finished) botThink(kart, dt, time, order);
    }
    // rockets
    for (let i = rockets.length - 1; i >= 0; i -= 1) {
      const r = rockets[i];
      r.life -= dt;
      const t = r.target;
      if (t && !r.homing) {
        const ahead = (t.progress ?? 0) - r.p;
        if (ahead < 8 || Math.hypot(t.x - r.x, t.y - r.y) < 260) r.homing = true;
      }
      if (r.homing && t) {
        const dx = t.x - r.x;
        const dy = t.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        const step = Math.min(d, RocketSpeed * dt);
        r.x += (dx / d) * step;
        r.y += (dy / d) * step;
        r.a = Math.atan2(dy, dx);
      } else {
        r.p += (RocketSpeed * dt) / Spacing;
        if (t) r.offset += (lateral(track, t) - r.offset) * Math.min(1, dt * 2);
        const s = sampleAt(track, r.p);
        r.x = s.x - s.ty * r.offset;
        r.y = s.y + s.tx * r.offset;
        r.a = Math.atan2(s.ty, s.tx);
      }
      let done = r.life <= 0;
      for (const kart of karts) {
        if (done || kart === r.owner || kart.finished) continue;
        if (Math.hypot(kart.x - r.x, kart.y - r.y) < 44) {
          hit(kart, r.owner, "rocket");
          done = true;
        }
      }
      if (done) {
        events.push({ type: "boom", x: r.x, y: r.y });
        rockets.splice(i, 1);
      }
    }
    // oil slicks
    for (let i = oils.length - 1; i >= 0; i -= 1) {
      const o = oils[i];
      let done = time - o.born > OilLife;
      for (const kart of karts) {
        if (done || kart.finished) continue;
        if (kart === o.owner && time - o.born < 1.2) continue; // let the dropper get away
        if (Math.hypot(kart.x - o.x, kart.y - o.y) < OilRadius) {
          hit(kart, o.owner, "oil");
          done = true;
        }
      }
      if (done) oils.splice(i, 1);
    }
  }

  return { boxes, rockets, oils, events, update, use };
}
