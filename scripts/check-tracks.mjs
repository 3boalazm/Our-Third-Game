// Sanity checks for the track definitions: a loop must not run into itself,
// otherwise cars could shortcut or the road would overlap.
import { Tracks, buildTrack } from "../src/track.js";

let failed = false;
for (const def of Tracks) {
  const track = buildTrack(def);
  const { N, samples, halfWidth } = track;
  // Two parts of the road that are far apart along the loop must also be
  // clearly apart in space (room for both roads plus a gap of grass).
  const farApart = Math.floor(N * 0.12);
  let minGap = Infinity;
  for (let i = 0; i < N; i += 1) {
    for (let j = i + 1; j < N; j += 1) {
      const around = Math.min(j - i, N - (j - i));
      if (around < farApart) continue;
      const d = Math.hypot(samples[i].x - samples[j].x, samples[i].y - samples[j].y);
      minGap = Math.min(minGap, d);
    }
  }
  // sharpest turn: angle change between neighbouring tangents per step
  let sharpest = 0;
  for (let i = 0; i < N; i += 1) {
    const a = samples[i];
    const b = samples[(i + 3) % N];
    const turn = Math.abs(Math.atan2(a.tx * b.ty - a.ty * b.tx, a.tx * b.tx + a.ty * b.ty));
    sharpest = Math.max(sharpest, turn);
  }
  // Tightest bend: radius of the circle through three samples 6 steps apart.
  let minRadius = Infinity;
  for (let i = 0; i < N; i += 1) {
    const a = samples[(i - 6 + N) % N];
    const b = samples[i];
    const c = samples[(i + 6) % N];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    const ca = Math.hypot(a.x - c.x, a.y - c.y);
    const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area2 > 1e-6) minRadius = Math.min(minRadius, (ab * bc * ca) / (2 * area2));
  }
  const needed = halfWidth * 2 + 60;
  // A kart at 400 px/s turns at about 1.8 rad/s, so bends tighter than ~250 px
  // force the player to brake hard: keep every bend gentler than that.
  const MinBendRadius = 250;
  const ok = minGap >= needed && minRadius >= MinBendRadius;
  if (!ok) failed = true;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${def.name}: ${N} samples, length ${Math.round(track.length)}px, ` +
      `closest roads ${Math.round(minGap)}px (need >= ${needed}), tightest bend radius ${Math.round(minRadius)}px (need >= ${MinBendRadius})`,
  );
}
process.exit(failed ? 1 : 0);
