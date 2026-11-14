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
  nitroPickupRespawn: 12, // seconds before the same kart can collect that canister again

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
export const LiveryOptions = ["stripe", "twin", "clean", "number", "checker", "flames"];
export const WheelOptions = ["standard", "sport", "offroad"];
export const SpoilerOptions = ["standard", "none", "gt"];

export function makeKart({
  id,
  name,
  color,
  bot = false,
  skill = 1,
  isMe = false,
  isRemote = false,
  livery = "stripe",
  wheels = "standard",
  spoiler = "standard",
}) {
  return {
    id,
    name,
    color,
    livery: LiveryOptions.includes(livery) ? livery : "stripe",
    wheels: WheelOptions.includes(wheels) ? wheels : "standard",
    spoiler: SpoilerOptions.includes(spoiler) ? spoiler : "standard",
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
    driftNitroReward: 0, // one-shot nitro earned by the last clean drift
    boostTimer: 0, // seconds of mini-boost left
    boostSource: null, // "drift" or "pad"; temporary burst is separate from nitro fuel
    drafting: false, // in another kart's slipstream right now
    draft: 0, // 0..1 strength
    padCooldown: 0, // seconds until a boost pad can be used again
    nitroPickupCooldowns: [],
    nitroPickupHit: 0,
    nitroPickupReward: 0,
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
    // weather multipliers (set by applyWeather; all 1 in clear weather)
    grip: 1,
    topScale: 1,
    accelScale: 1,
    steerScale: 1,
    rubber: 1, // bot rubber-banding, and 1 for every human kart
    // items (see items.js)
    item: null,
    itemRoll: 0,
    itemPending: null,
    itemHeld: 0,
    shieldTimer: 0,
    spinTimer: 0,
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
  kart.driftNitroReward = 0;
  kart.boostTimer = 0;
  kart.boostSource = null;
  kart.hit = 0;
  kart.driftReward = 0;
  kart.padHit = 0;
  kart.bump = 0;
  kart.drafting = false;
  kart.draft = 0;
  kart.padCooldown = 0;
  kart.nitroPickupCooldowns = [];
  kart.nitroPickupHit = 0;
  kart.nitroPickupReward = 0;
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
  // Hit by a rocket or oil: the kart spins round once, losing speed, and
  // ignores the controls until it has stopped spinning.
  if ((kart.spinTimer ?? 0) > 0) {
    kart.spinTimer = Math.max(0, kart.spinTimer - dt);
    input = { steer: 0, gas: false, brake: false, drift: false, nitro: false };
    kart.a += (Math.PI * 2 / 1.0) * dt;
    const drag = Math.exp(-2.4 * dt);
    kart.vx *= drag;
    kart.vy *= drag;
    kart.driftTime = 0;
  }
  let fx = Math.cos(kart.a);
  let fy = Math.sin(kart.a);
  let along = kart.vx * fx + kart.vy * fy;
  let side = kart.vx * -fy + kart.vy * fx;

  const bx = fx; // heading at the start of the step
  const by = fy;
  const onRoad = kart.dist <= track.halfWidth;
  kart.padCooldown = Math.max(0, kart.padCooldown - dt);
  for (let i = 0; i < (track.nitroPickups ?? []).length; i += 1) {
    kart.nitroPickupCooldowns[i] = Math.max(0, (kart.nitroPickupCooldowns[i] ?? 0) - dt);
  }

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
  if (kart.boostTimer === 0) kart.boostSource = null;

  let power = kart.nitroOn ? P.nitroTop : kart.boostTimer > 0 ? P.boostTop : 1;
  let thrust = kart.nitroOn ? P.nitroAccel : kart.boostTimer > 0 ? P.boostAccel : 1;
  if (draft > 0 && !kart.nitroOn && kart.boostTimer <= 0) {
    power = Math.max(power, 1 + P.draftTop * draft);
    thrust = Math.max(thrust, 1 + P.draftAccel * draft);
  }
  const rubber = kart.bot ? (kart.rubber ?? 1) : 1;
  const top =
    P.maxSpeed *
    kart.skill *
    (onRoad ? 1 : P.offRoadFactor) *
    power *
    (kart.topScale ?? 1) *
    rubber;

  // --- throttle / brake ---
  if (canDrive && (input.gas || kart.nitroOn) && !input.brake) {
    if (along < top) {
      along = Math.min(top, along + P.accel * thrust * (kart.accelScale ?? 1) * dt);
    }
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
      const nitroBeforeDrift = kart.nitro;
      kart.nitro = Math.min(
        1,
        kart.nitro + Math.min(P.driftNitroCap, kart.driftTime * P.driftToNitro),
      );
      kart.driftNitroReward = kart.nitro - nitroBeforeDrift;
      kart.boostTimer = Math.min(1, 0.3 + kart.driftTime * 0.15);
      kart.boostSource = "drift";
      kart.driftReward = kart.driftTime;
    }
    kart.driftTime = 0;
  }
  kart.drifting = drifting;
  side *= Math.exp(-(drifting ? P.driftGrip : P.grip) * (kart.grip ?? 1) * dt);

  // --- steering ---
  const control = clamp(Math.abs(along) / 170, 0, 1);
  const slowDown = 1 - 0.3 * clamp(Math.abs(along) / P.maxSpeed, 0, 1);
  kart.a +=
    steer * P.turnRate * (drifting ? P.driftTurn : 1) * control * slowDown *
    (kart.steerScale ?? 1) * (along >= 0 ? 1 : -1) * dt;

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

  // --- collectible nitro canisters ---
  if (canDrive && !kart.offRoad && kart.nitro < 1) {
    for (let i = 0; i < (track.nitroPickups ?? []).length; i += 1) {
      const pickup = track.nitroPickups[i];
      if ((kart.nitroPickupCooldowns[i] ?? 0) > 0) continue;
      const distance = Math.hypot(kart.x - pickup.x, kart.y - pickup.y);
      if (distance > (pickup.radius ?? 34) + 18) continue;
      const before = kart.nitro;
      kart.nitro = Math.min(1, kart.nitro + (pickup.amount ?? 0.35));
      kart.nitroPickupReward = kart.nitro - before;
      kart.nitroPickupHit = 1;
      kart.nitroPickupCooldowns[i] = P.nitroPickupRespawn;
      break;
    }
  }

  // --- boost pads ---
  if (canDrive && kart.padCooldown <= 0 && along > P.padMinSpeed) {
    for (const pad of track.pads ?? []) {
      const dx = kart.x - pad.x;
      const dy = kart.y - pad.y;
      const lon = dx * pad.tx + dy * pad.ty;
      const lat = Math.abs(-dx * pad.ty + dy * pad.tx);
      if (Math.abs(lon) <= pad.length / 2 && lat <= pad.half) {
        kart.boostTimer = Math.max(kart.boostTimer, P.padBoostTime);
        kart.boostSource = "pad";
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

// Gentle rubber-banding for offline bots: a bot that is far behind gets a
// little more top speed, one that is far ahead eases off. It never turns a slow
// bot into a rocket, it only keeps a race from turning into a lonely drive.
export function rubberBand(kart, leader, lapLength, strength = 1) {
  if (!leader || !lapLength) return 1;
  const gap = (leader.progress - kart.progress) / lapLength;
  return 1 + clamp(gap * 0.4 * strength, -0.14, 0.14);
}

// A bot looks a few samples ahead on the centre line, brakes for tight corners,
// drifts when the road bends and spends its nitro once the road straightens out.
export function botInput(kart, track) {
  const { samples, N } = track;
  const speed = kart.speed ?? 0;
  const lookahead = 8 + Math.floor(speed / 52);
  const target = samples[(kart.lastIdx + lookahead) % N];
  const desired = Math.atan2(target.y - kart.y, target.x - kart.x);
  const diff = angleDiff(desired, kart.a);
  const sharp = Math.abs(diff);

  // How much the road bends just ahead: the difference between the tangent now
  // and the tangent further along the centre line.
  const near = samples[(kart.lastIdx + 6) % N];
  const far = samples[(kart.lastIdx + 34) % N];
  const curve = Math.abs(angleDiff(Math.atan2(far.ty, far.tx), Math.atan2(near.ty, near.tx)));

  const wanted = Physics.maxSpeed * kart.skill * (1 - Math.min(0.5, sharp * 0.75));
  const boosting = kart.nitroOn;
  const onRoad = (kart.dist ?? 0) <= track.halfWidth;
  // Bots with a bit of skill slide through real corners, then let go so the
  // drift reward pays out; they never start a drift when pointing at a wall.
  const corner = curve > 0.3 && sharp < 0.9 && onRoad;
  const keepDrift = kart.drifting && curve > 0.16;
  const wantDrift = kart.skill >= 0.72 && speed > Physics.driftMinSpeed * 1.1;
  const drift = !!wantDrift && (corner || keepDrift);

  const straight = curve < 0.09 && sharp < 0.12;
  const nitro = boosting ? kart.nitro > 0.02 && sharp < 0.2 : kart.nitro > 0.55 && straight;
  return {
    steer: clamp(diff * 2.4, -1, 1),
    gas: speed < wanted || boosting,
    brake: !boosting && speed > wanted * 1.25 && sharp > 0.45,
    drift,
    nitro,
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
