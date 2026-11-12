// Best-lap ghost: a compact recording of one lap that can be played back as a
// translucent kart. Frames are stored in localStorage per track, only when a
// lap is faster than the ghost already there.
//
// A frame is [time, x, y, angle]; time is seconds since the lap started.

const StorageKey = "kart-ghosts-v1";
export const GhostRate = 15; // samples per second
export const MaxGhostFrames = 1800; // 120 s, far longer than any of our laps

function readStore() {
  try {
    const raw = localStorage.getItem(StorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(StorageKey, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

function validFrames(frames) {
  if (!Array.isArray(frames) || frames.length < 2) return false;
  let last = -Infinity;
  for (const frame of frames) {
    if (!Array.isArray(frame) || frame.length !== 4) return false;
    const [t, x, y, a] = frame;
    if (![t, x, y, a].every(Number.isFinite)) return false;
    if (t <= last) return false;
    last = t;
  }
  return true;
}

export function loadGhost(trackId) {
  const record = readStore()[trackId];
  if (!record || !Number.isFinite(record.time) || record.time <= 0) return null;
  if (!validFrames(record.frames)) return null;
  return { time: record.time, frames: record.frames };
}

// Returns true when the lap was fast enough to become the new ghost.
export function saveGhost(trackId, time, frames) {
  if (!Number.isFinite(time) || time <= 0 || !validFrames(frames)) return false;
  const store = readStore();
  const current = store[trackId];
  if (current && Number.isFinite(current.time) && current.time <= time) return false;
  store[trackId] = {
    time: Math.round(time * 1000) / 1000,
    frames: frames.slice(0, MaxGhostFrames).map(([t, x, y, a]) => [
      Math.round(t * 100) / 100,
      Math.round(x * 10) / 10,
      Math.round(y * 10) / 10,
      Math.round(a * 1000) / 1000,
    ]),
  };
  return writeStore(store);
}

// Add a sample if enough time has passed since the last one.
export function recordGhostFrame(frames, t, x, y, a, rate = GhostRate) {
  if (frames.length >= MaxGhostFrames) return false;
  const last = frames.length ? frames[frames.length - 1][0] : -Infinity;
  if (t - last < 1 / rate - 1e-6) return false;
  frames.push([t, x, y, a]);
  return true;
}

// Position at time t, linearly interpolated between the two nearest frames.
export function sampleGhost(frames, t) {
  if (!Array.isArray(frames) || frames.length === 0) return null;
  if (t <= frames[0][0]) {
    const [, x, y, a] = frames[0];
    return { x, y, a };
  }
  let lo = 0;
  let hi = frames.length - 1;
  if (t >= frames[hi][0]) {
    const [, x, y, a] = frames[hi];
    return { x, y, a };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = b[0] - a[0] || 1;
  const f = Math.max(0, Math.min(1, (t - a[0]) / span));
  let da = b[3] - a[3];
  while (da > Math.PI) da -= Math.PI * 2;
  while (da < -Math.PI) da += Math.PI * 2;
  return {
    x: a[1] + (b[1] - a[1]) * f,
    y: a[2] + (b[2] - a[2]) * f,
    a: a[3] + da * f,
  };
}
