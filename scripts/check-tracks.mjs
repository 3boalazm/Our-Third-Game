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
  const needed = halfWidth * 2 + 60;
  const ok = minGap >= needed;
  if (!ok) failed = true;
  console.log(
    `${ok ? "OK  " : "FAIL"} ${def.name}: ${N} samples, length ${Math.round(track.length)}px, ` +
      `closest roads ${Math.round(minGap)}px (need >= ${needed}), sharpest turn ${sharpest.toFixed(2)} rad / 3 steps`,
  );
}
process.exit(failed ? 1 : 0);
