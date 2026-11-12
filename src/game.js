import { nearest } from "./track.js";

// Arcade physics: tuned by feel, in pixels and seconds.
export const Physics = {
  maxSpeed: 560,
  accel: 460,
  brake: 900,
  reverseMax: 150,
  coast: 0.55, // speed lost per second when no pedal is pressed
  turnRate: 2.6, // radians per second at full steering
  grip: 7, // how fast sideways sliding dies out
  offRoadFactor: 0.42, // top speed on grass relative to the road
  barrierMargin: 95, // invisible wall this far outside the road edge
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
    progress: 0, // samples travelled; 0 is the start line, lap n ends at n * N
    finished: false,
    finishTime: 0,
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
  kart.progress = -back;
  kart.finished = false;
  kart.finishTime = 0;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function angleDiff(target, current) {
  let d = target - current;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// input: { steer: -1..1 (negative = left), gas: bool, brake: bool }
export function stepKart(kart, input, dt, track, canDrive) {
  const P = Physics;
  let fx = Math.cos(kart.a);
  let fy = Math.sin(kart.a);
  let along = kart.vx * fx + kart.vy * fy;
  let side = kart.vx * -fy + kart.vy * fx;

  const onRoad = kart.dist <= track.halfWidth;
  const top = P.maxSpeed * kart.skill * (onRoad ? 1 : P.offRoadFactor);

  if (canDrive && input.gas && !input.brake) {
    if (along < top) along = Math.min(top, along + P.accel * dt);
  } else if (canDrive && input.brake) {
    along = Math.max(-P.reverseMax, along - P.brake * dt);
  } else {
    along *= Math.exp(-P.coast * dt);
  }
  if (along > top) {
    along -= (along - top) * Math.min(1, 4 * dt); // grass slows you down
  }
  side *= Math.exp(-P.grip * dt);

  const steer = canDrive ? input.steer : 0;
  const control = clamp(Math.abs(along) / 170, 0, 1);
  const slowDown = 1 - 0.3 * clamp(Math.abs(along) / P.maxSpeed, 0, 1);
  kart.a += steer * P.turnRate * control * slowDown * (along >= 0 ? 1 : -1) * dt;

  fx = Math.cos(kart.a);
  fy = Math.sin(kart.a);
  kart.vx = fx * along + -fy * side;
  kart.vy = fy * along + fx * side;
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
    }
  }

  let delta = near.idx - kart.lastIdx;
  if (delta > track.N / 2) delta -= track.N;
  if (delta < -track.N / 2) delta += track.N;
  kart.progress += delta;
  kart.lastIdx = near.idx;
  kart.speed = Math.hypot(kart.vx, kart.vy);
}

// A bot looks a few samples ahead on the centre line and steers at that point.
export function botInput(kart, track) {
  const { samples, N } = track;
  const lookahead = 9 + Math.floor(kart.speed / 55);
  const target = samples[(kart.lastIdx + lookahead) % N];
  const desired = Math.atan2(target.y - kart.y, target.x - kart.x);
  const diff = angleDiff(desired, kart.a);
  const sharp = Math.abs(diff);
  const wanted = Physics.maxSpeed * kart.skill * (1 - Math.min(0.5, sharp * 0.75));
  return {
    steer: clamp(diff * 2.4, -1, 1),
    gas: kart.speed < wanted,
    brake: kart.speed > wanted * 1.25 && sharp > 0.45,
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
