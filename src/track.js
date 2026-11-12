// Tracks are closed loops defined by a few control points. The points are
// smoothed with a Catmull-Rom spline and re-sampled at an even spacing, so
// every sample is one "step" of progress around the lap.

export const Tracks = [
  {
    id: "sunny",
    name: "Sunny Loop",
    width: 170,
    points: [
      [600, 400], [1400, 300], [2200, 380], [2750, 750], [2650, 1250],
      [2000, 1400], [1700, 1000], [1300, 1100], [1400, 1650], [900, 1800],
      [400, 1550], [300, 950],
    ],
  },
  {
    id: "twisty",
    name: "Twisty Hills",
    width: 160,
    points: [
      [500, 450], [1200, 250], [1750, 650], [2400, 300], [2950, 700],
      [2900, 1250], [2500, 1300], [2450, 1700], [2150, 2000], [1500, 2000],
      [950, 1750], [1000, 1300], [500, 1100], [300, 800],
    ],
  },
];

export function trackById(id) {
  return Tracks.find((track) => track.id === id) ?? Tracks[0];
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const axis = (i) =>
    0.5 *
    (2 * p1[i] +
      (-p0[i] + p2[i]) * t +
      (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 +
      (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  return [axis(0), axis(1)];
}

const Spacing = 14;

export function buildTrack(def) {
  const points = def.points;
  const count = points.length;
  const dense = [];
  for (let i = 0; i < count; i += 1) {
    for (let step = 0; step < 24; step += 1) {
      dense.push(
        catmull(
          points[(i - 1 + count) % count],
          points[i],
          points[(i + 1) % count],
          points[(i + 2) % count],
          step / 24,
        ),
      );
    }
  }

  const cumulative = [0];
  for (let i = 0; i < dense.length; i += 1) {
    const a = dense[i];
    const b = dense[(i + 1) % dense.length];
    cumulative.push(cumulative[i] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const length = cumulative[cumulative.length - 1];
  const N = Math.round(length / Spacing);

  const samples = [];
  let j = 0;
  for (let k = 0; k < N; k += 1) {
    const target = (k * length) / N;
    while (cumulative[j + 1] < target) {
      j += 1;
    }
    const f = (target - cumulative[j]) / (cumulative[j + 1] - cumulative[j]);
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    samples.push({ x: a[0] + (b[0] - a[0]) * f, y: a[1] + (b[1] - a[1]) * f, tx: 0, ty: 0 });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < N; k += 1) {
    const prev = samples[(k - 1 + N) % N];
    const next = samples[(k + 1) % N];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    samples[k].tx = dx / len;
    samples[k].ty = dy / len;
    minX = Math.min(minX, samples[k].x);
    minY = Math.min(minY, samples[k].y);
    maxX = Math.max(maxX, samples[k].x);
    maxY = Math.max(maxY, samples[k].y);
  }

  // Path2D only exists in browsers (the track checks in Node skip it).
  let path = null;
  if (typeof Path2D !== "undefined") {
    path = new Path2D();
    samples.forEach((s, k) => (k === 0 ? path.moveTo(s.x, s.y) : path.lineTo(s.x, s.y)));
    path.closePath();
  }

  return {
    def,
    N,
    samples,
    length,
    halfWidth: def.width / 2,
    bounds: { minX, minY, maxX, maxY },
    path,
  };
}

// Index of the centre-line sample closest to (x, y). With a hint only samples
// near the hint are checked (cars move a little each frame), which is fast and
// also stops a car from "jumping" to a different part of the loop.
export function nearest(track, x, y, hint) {
  const { samples, N } = track;
  let best = 0;
  let bestD = Infinity;
  const check = (i) => {
    const s = samples[i];
    const d = (s.x - x) * (s.x - x) + (s.y - y) * (s.y - y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  };
  if (hint == null) {
    for (let i = 0; i < N; i += 1) {
      check(i);
    }
  } else {
    for (let o = -40; o <= 40; o += 1) {
      check((hint + o + N) % N);
    }
  }
  return { idx: best, dist: Math.sqrt(bestD) };
}
