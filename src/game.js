import { nearest } from "./track.js";

// Arcade physics: tuned by feel, in pixels and seconds. The simulation always
// advances in FixedStep slices so it behaves the same at any frame rate.
export const FixedStep = 1 / 60;

// The karts are drawn this much bigger than their "physical" size (cosmetic only),
// so they stay easy to see on the wide roads.
export const KartScale = 1.35;

export const Physics = {
  maxSpeed: 560,
  accel: 460,
  brake: 900,
  reverseMax: 150,
  coast: 0.55, // speed lost per second when no pedal is pressed
  turnRate: 2.6, // radians per second at full steering
  grip: 14, // how fast sideways sliding dies out (high = planted)
  offRoadFactor: 0.42, // top speed on grass relative to the road
  barrierMargin: 95, // invisible wall this far outside the road edge

  // Drift: hold the button while steering to slide. A long, clean slide that
  // you release on the road is paid back as nitro and a short mini-boost.
  driftGrip: 5,
  driftTurn: 1.35, // extra turn rate while drifting
  driftMinSpeed: 240,
  driftSlipMin: 100, // sideways speed that counts as a real slide
  driftMinTime: 0.6, // slides shorter than this earn nothing
  driftToNitro: 0.16, // nitro earned per second of sliding
  driftNitroCap: 0.5,
  driftSpeedLoss: 0.15,

  // Nitro
  startNitro: 0.3,
  nitroDrain: 0.34, // per second while held (a full tank lasts ~3 s)
  nitroStartMin: 0.08, // can't start on fumes
  nitroTop: 1.4,
  nitroAccel: 2.4,
  regenHuman: 0.015,
  regenBot: 0.045,

  // Mini-boost after a good drift
  boostTop: 1.22,
  boostAccel: 1.7,

  // Boost pads painted on the road: a free, short boost.
  padBoostTime: 1.05,
  padCooldown: 1.4, // so one pad cannot be farmed by circling on it
  padMinSpeed: 110,

  // Slipstream: tucking in behind another kart makes you quicker.
  draftTop: 0.13, // extra top speed at full draft
  draftAccel: 0.55, // extra acceleration at full draft
  draftAhead: 230, // how far behind a kart the air is still disturbed
  draftSide: 72,
  draftMinSpeed: 240,

  // Kart-to-kart contact: a soft circle around each kart. Rubbing wheels costs
  // a little speed and shoves both karts apart, but never stops the race.
  kartRadius: 25,
  bumpRestitution: 0.45,
};

export const KartColors = ["#4f6bff", "#ff5a5f", "#2bb673", "#f5a623", "#a259ff", "#14b8c4"];

export function makeKart({
  id,
  name,
  color,
  bot = false,
  skill = 1,
  isMe = false,
  isRemote = false,
}) {
  return {
    id,
    name,
    color,
    bot,
    skill,
    isMe, // the kart this browser drives
    isRemote, // the friend's kart (driven by their browser, only drawn here)
    x: 0,
    y: 0,
    a: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    lastIdx: 0,
    dist: 0,
    offRoad: false,
    progress: 0, // samples travelled; 0 is the start line, lap n ends at n * N
    finished: false,
    finishTime: 0,
    // abilities
    nitro: Physics.startNitro, // 0..1 tank
    nitroOn: false,
    drifting: false,
    driftTime: 0, // seconds of the current slide
    boostTimer: 0, // seconds of mini-boost left
    drafting: false, // in another kart's slipstream right now
    draft: 0, // 0..1 strength
    padCooldown: 0, // seconds until a boost pad can be used again
    // lap timing
    lapsDone: 0,
    lapStart: 0, // race time when the current lap started
    lapTimes: [],
    lastLap: 0,
    bestLap: 0,
    // one-shot events, read and cleared by the game loop (sound, particles)
    hit: 0, // wall impact speed this step
    driftReward: 0, // seconds of the slide that was just paid out
    padHit: 0, // drove over a boost pad this step
    bump: 0, // speed of a kart-to-kart hit this step (for sound and sparks)
  };
}

export function placeOnGrid(kart, track, slot) {
  const { samples, N, halfWidth } = track;
  const back = 4 + slot * 5;
  const idx = (N - back) % N;
  const s = samples[idx];
  const side = slot % 2 === 0 ? -1 : 1;
  const offset = side * halfWidth * 0.42;
  kart.x = s.x - s.ty * offset;
  kart.y = s.y + s.tx * offset;
  kart.a = Math.atan2(s.ty, s.tx);
  kart.vx = 0;
  kart.vy = 0;
  kart.speed = 0;
  kart.lastIdx = idx;
  kart.dist = Math.abs(offset);
  kart.offRoad = false;
  kart.progress = -back;
  kart.finished = false;
  kart.finishTime = 0;
  kart.nitro = Physics.startNitro;
  kart.nitroOn = false;
  kart.drifting = false;
  kart.driftTime = 0;
  kart.boostTimer = 0;
  kart.hit = 0;
  kart.driftReward = 0;
  kart.padHit = 0;
  kart.bump = 0;
  kart.drafting = false;
  kart.draft = 0;
  kart.padCooldown = 0;
  kart.lapsDone = 0;
  kart.lapStart = 0;
  kart.lapTimes = [];
  kart.lastLap = 0;
  kart.bestLap = 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// 0..1: how much of another kart's slipstream we are in. A kart counts when it
// is ahead of us, roughly in line, moving fast and close enough.
export function slipstream(kart, others = []) {
  const P = Physics;
  const fx = Math.cos(kart.a);
  const fy = Math.sin(kart.a);
  let best = 0;
  for (const other of others) {
    if (other === kart) continue;
    const dx = other.x - kart.x;
    const dy = other.y - kart.y;
    const ahead = dx * fx + dy * fy;
    const side = Math.abs(-dx * fy + dy * fx);
    if (ahead < 24 || ahead > P.draftAhead || side > P.draftSide) continue;
    if ((other.speed ?? 0) < P.draftMinSpeed) continue;
    const closeness = 1 - (ahead - 24) / (P.draftAhead - 24) * 0.45;
    const centered = 1 - (side / P.draftSide) * 0.35;
    best = Math.max(best, Math.min(1, closeness * centered));
  }
  return best;
}

// input: { steer: -1..1 (negative = left), gas, brake, drift, nitro }
export function stepKart(kart, input, dt, track, canDrive, others = []) {
  const P = Physics;
  let fx = Math.cos(kart.a);
  let fy = Math.sin(kart.a);
  let along = kart.vx * fx + kart.vy * fy;
  let side = kart.vx * -fy + kart.vy * fx;

  const bx = fx; // heading at the start of the step
  const by = fy;
  const onRoad = kart.dist <= track.halfWidth;
  kart.padCooldown = Math.max(0, kart.padCooldown - dt);

  // --- slipstream ---
  const draft = canDrive && onRoad ? slipstream(kart, others) : 0;
  kart.draft = draft;
  kart.drafting = draft > 0.35;

  // --- nitro tank ---
  if (canDrive && input.nitro && kart.nitro > (kart.nitroOn ? 0 : P.nitroStartMin)) {
    kart.nitroOn = true;
    kart.nitro = Math.max(0, kart.nitro - P.nitroDrain * dt);
    if (kart.nitro === 0) kart.nitroOn = false;
  } else {
    kart.nitroOn = false;
    kart.nitro = Math.min(1, kart.nitro + (kart.bot ? P.regenBot : P.regenHuman) * dt);
  }
  kart.boostTimer = Math.max(0, kart.boostTimer - dt);

  let power = kart.nitroOn ? P.nitroTop : kart.boostTimer > 0 ? P.boostTop : 1;
  let thrust = kart.nitroOn ? P.nitroAccel : kart.boostTimer > 0 ? P.boostAccel : 1;
  if (draft > 0 && !kart.nitroOn && kart.boostTimer <= 0) {
    power = Math.max(power, 1 + P.draftTop * draft);
    thrust = Math.max(thrust, 1 + P.draftAccel * draft);
  }
  const top = P.maxSpeed * kart.skill * (onRoad ? 1 : P.offRoadFactor) * power;

  // --- throttle / brake ---
  if (canDrive && (input.gas || kart.nitroOn) && !input.brake) {
    if (along < top) along = Math.min(top, along + P.accel * thrust * dt);
  } else if (canDrive && input.brake) {
    along = Math.max(-P.reverseMax, along - P.brake * dt);
  } else {
    along *= Math.exp(-P.coast * dt);
  }
  if (along > top) {
    along -= (along - top) * Math.min(1, 4 * dt); // grass (or the end of a boost) slows you down
  }

  // --- drift ---
  const steer = canDrive ? input.steer : 0;
  const slip = Math.abs(side);
  const drifting =
    canDrive && !!input.drift && onRoad && along > P.driftMinSpeed && Math.abs(steer) > 0.25;
  if (drifting) {
    if (slip > P.driftSlipMin) kart.driftTime += dt;
    along *= Math.exp(-P.driftSpeedLoss * dt);
  } else if (kart.driftTime > 0) {
    if (kart.driftTime >= P.driftMinTime && onRoad) {
      kart.nitro = Math.min(
        1,
        kart.nitro + Math.min(P.driftNitroCap, kart.driftTime * P.driftToNitro),
      );
      kart.boostTimer = Math.min(1, 0.3 + kart.driftTime * 0.15);
      kart.driftReward = kart.driftTime;
    }
    kart.driftTime = 0;
  }
  kart.drifting = drifting;
  side *= Math.exp(-(drifting ? P.driftGrip : P.grip) * dt);

  // --- steering ---
  const control = clamp(Math.abs(along) / 170, 0, 1);
  const slowDown = 1 - 0.3 * clamp(Math.abs(along) / P.maxSpeed, 0, 1);
  kart.a +=
    steer * P.turnRate * (drifting ? P.driftTurn : 1) * control * slowDown *
    (along >= 0 ? 1 : -1) * dt;

  // Rebuild the velocity with the heading from *before* this step's steering.
  // The kart then keeps travelling where it was going while its nose turns, so
  // next step part of its speed is sideways: that is the slide.
  kart.vx = bx * along + -by * side;
  kart.vy = by * along + bx * side;
  kart.x += kart.vx * dt;
  kart.y += kart.vy * dt;

  const near = nearest(track, kart.x, kart.y, kart.lastIdx);
  kart.dist = near.dist;

  // Invisible wall: stops shortcuts across the grass.
  const limit = track.halfWidth + P.barrierMargin;
  if (near.dist > limit) {
    const s = track.samples[near.idx];
    const dx = (kart.x - s.x) / near.dist;
    const dy = (kart.y - s.y) / near.dist;
    kart.x = s.x + dx * limit;
    kart.y = s.y + dy * limit;
    kart.dist = limit;
    const outward = kart.vx * dx + kart.vy * dy;
    if (outward > 0) {
      kart.vx -= dx * outward * 1.3;
      kart.vy -= dy * outward * 1.3;
      kart.hit = Math.max(kart.hit, outward);
      kart.driftTime = 0; // crashing cancels the drift reward
    }
  }
  kart.offRoad = kart.dist > track.halfWidth;

  // --- boost pads ---
  if (canDrive && kart.padCooldown <= 0 && along > P.padMinSpeed) {
    for (const pad of track.pads ?? []) {
      const dx = kart.x - pad.x;
      const dy = kart.y - pad.y;
      const lon = dx * pad.tx + dy * pad.ty;
      const lat = Math.abs(-dx * pad.ty + dy * pad.tx);
      if (Math.abs(lon) <= pad.length / 2 && lat <= pad.half) {
        kart.boostTimer = Math.max(kart.boostTimer, P.padBoostTime);
        kart.padCooldown = P.padCooldown;
        kart.padHit = 1;
        break;
      }
    }
  }

  let delta = near.idx - kart.lastIdx;
  if (delta > track.N / 2) delta -= track.N;
  if (delta < -track.N / 2) delta += track.N;
  kart.progress += delta;
  kart.lastIdx = near.idx;
  kart.speed = Math.hypot(kart.vx, kart.vy);
}

// Soft contact between karts. The friend's kart (isRemote) owns its position on
// their browser, so here it only pushes us away; both local karts move equally.
export function resolveContacts(karts) {
  const P = Physics;
  const reach = P.kartRadius * 2;
  for (let i = 0; i < karts.length; i += 1) {
    const a = karts[i];
    if (a.isGhost) continue;
    for (let j = i + 1; j < karts.length; j += 1) {
      const b = karts[j];
      if (b.isGhost) continue;
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let dist = Math.hypot(dx, dy);
      if (dist >= reach) continue;
      if (dist < 0.001) {
        // exactly on top of each other: pick a stable direction
        dx = Math.cos(a.a + Math.PI / 2);
        dy = Math.sin(a.a + Math.PI / 2);
        dist = 0.001;
      }
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = reach - dist;
      const aMove = a.isRemote ? 0 : 1;
      const bMove = b.isRemote ? 0 : 1;
      const movers = aMove + bMove;
      if (movers === 0) continue;
      if (aMove) {
        a.x -= nx * overlap * (aMove / movers);
        a.y -= ny * overlap * (aMove / movers);
      }
      if (bMove) {
        b.x += nx * overlap * (bMove / movers);
        b.y += ny * overlap * (bMove / movers);
      }

      // Only a closing pair gets an impulse; once they are separating the
      // separation above is enough.
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (closing <= 0) continue;
      const share = (1 + P.bumpRestitution) / 2;
      if (aMove) {
        const push = aMove === 1 && bMove === 0 ? closing : closing * share;
        a.vx -= nx * push;
        a.vy -= ny * push;
      }
      if (bMove) {
        const push = bMove === 1 && aMove === 0 ? closing : closing * share;
        b.vx += nx * push;
        b.vy += ny * push;
      }
      a.bump = Math.max(a.bump, closing);
      if (bMove) b.bump = Math.max(b.bump, closing);
      a.speed = Math.hypot(a.vx, a.vy);
      if (bMove) b.speed = Math.hypot(b.vx, b.vy);
    }
  }
}

// A bot looks a few samples ahead on the centre line and steers at that point.
// It spends its nitro on straights and never drifts (keeps the AI simple).
export function botInput(kart, track) {
  const { samples, N } = track;
  const lookahead = 9 + Math.floor(kart.speed / 55);
  const target = samples[(kart.lastIdx + lookahead) % N];
  const desired = Math.atan2(target.y - kart.y, target.x - kart.x);
  const diff = angleDiff(desired, kart.a);
  const sharp = Math.abs(diff);
  const wanted = Physics.maxSpeed * kart.skill * (1 - Math.min(0.5, sharp * 0.75));
  const boosting = kart.nitroOn;
  return {
    steer: clamp(diff * 2.4, -1, 1),
    gas: kart.speed < wanted || boosting,
    brake: !boosting && kart.speed > wanted * 1.25 && sharp > 0.45,
    drift: false,
    nitro: boosting ? kart.nitro > 0.02 && sharp < 0.2 : kart.nitro > 0.6 && sharp < 0.06,
  };
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "--:--.---";
  }
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
}
