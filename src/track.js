// Tracks are closed loops defined by a few control points. The points are
// smoothed with a Catmull-Rom spline and re-sampled at an even spacing, so
// every sample is one "step" of progress around the lap.

export const Tracks = [
  {
    id: "sunny",
    name: "Sunny Loop",
    width: 290,
    scale: 1.75, // the control points below are drawn small; this sets the real size
    smooth: 600, // rounds off tight bends (see smooth() below)
    points: [
      [600, 400], [1400, 300], [2200, 380], [2750, 750], [2650, 1250],
      [2000, 1400], [1700, 1000], [1300, 1100], [1400, 1650], [900, 1800],
      [400, 1550], [300, 950],
    ],
  },
  {
    id: "twisty",
    name: "Twisty Hills",
    width: 280,
    scale: 1.75,
    smooth: 600,
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

// Evenly spaced points along a closed polyline.
function resample(poly, spacing) {
  const n = poly.length;
  const cumulative = [0];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    cumulative.push(cumulative[i] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  const length = cumulative[n];
  const N = Math.round(length / spacing);
  const out = [];
  let j = 0;
  for (let k = 0; k < N; k += 1) {
    const target = (k * length) / N;
    while (cumulative[j + 1] < target) {
      j += 1;
    }
    const f = (target - cumulative[j]) / (cumulative[j + 1] - cumulative[j]);
    const a = poly[j];
    const b = poly[(j + 1) % n];
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
  }
  return { points: out, length, N };
}

// Rounds off tight bends: every pass pulls each point towards the average of
// its neighbours (a smoothing of the whole loop, so no corner stays sharp).
function smooth(points, passes) {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    const n = current.length;
    current = current.map((pt, i) => {
      const a = current[(i - 1 + n) % n];
      const b = current[(i + 1) % n];
      return { x: (a.x + 2 * pt.x + b.x) / 4, y: (a.y + 2 * pt.y + b.y) / 4 };
    });
  }
  return current;
}

export function buildTrack(def) {
  const scale = def.scale ?? 1;
  const points = def.points.map(([x, y]) => [x * scale, y * scale]);
  const count = points.length;
  const dense = [];
  for (let i = 0; i < count; i += 1) {
    for (let step = 0; step < 24; step += 1) {
      const [x, y] = catmull(
        points[(i - 1 + count) % count],
        points[i],
        points[(i + 1) % count],
        points[(i + 2) % count],
        step / 24,
      );
      dense.push({ x, y });
    }
  }

  let even = resample(dense, Spacing).points;
  if (def.smooth) {
    even = smooth(even, def.smooth);
  }
  const resampled = resample(even, Spacing);
  const { length, N } = resampled;
  const samples = resampled.points.map((p) => ({ x: p.x, y: p.y, tx: 0, ty: 0 }));

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
