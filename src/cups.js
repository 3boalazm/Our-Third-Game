// Championship cups: three races in a row against the same rivals, with points
// after every race and a podium (and coins) at the end. A podium finish in one
// cup unlocks the next. Pure logic, tested in tests/cups.test.mjs.

export const Cups = [
  {
    id: "rookie",
    name: "Rookie Cup",
    blurb: "Three gentle races to learn the ropes.",
    difficulty: "easy",
    laps: 2,
    races: [
      { trackId: "sunny", weather: "clear" },
      { trackId: "twisty", weather: "clear" },
      { trackId: "ridge", weather: "clear" },
    ],
    prizes: [500, 300, 150],
    rivals: ["Zip", "Bolt", "Turbo"],
  },
  {
    id: "pro",
    name: "Pro Cup",
    blurb: "Faster rivals, three laps a race.",
    difficulty: "normal",
    laps: 3,
    races: [
      { trackId: "twisty", weather: "clear" },
      { trackId: "ridge", weather: "rain" },
      { trackId: "sunny", weather: "clear" },
    ],
    prizes: [900, 550, 300],
    rivals: ["Blaze", "Nova", "Comet"],
  },
  {
    id: "legend",
    name: "Legend Cup",
    blurb: "The fastest rivals, in the rain and at night.",
    difficulty: "hard",
    laps: 3,
    races: [
      { trackId: "ridge", weather: "night" },
      { trackId: "sunny", weather: "rain" },
      { trackId: "twisty", weather: "night" },
    ],
    prizes: [1600, 950, 500],
    rivals: ["Viper", "Storm", "Apex"],
  },
];

export const Points = [10, 6, 4, 2];

export function cupById(id) {
  return Cups.find((cup) => cup.id === id) ?? null;
}

export function pointsFor(place) {
  return Points[place - 1] ?? 0;
}

// Best finishing place per cup (1, 2, 3, 4...) or 0 when never finished.
export function readCupRecords(saved) {
  const out = {};
  for (const cup of Cups) {
    const v = Math.floor(Number(saved?.[cup.id]) || 0);
    out[cup.id] = v > 0 ? v : 0;
  }
  return out;
}

export function isUnlocked(records, id) {
  const i = Cups.findIndex((cup) => cup.id === id);
  if (i <= 0) return i === 0;
  const before = records[Cups[i - 1].id] ?? 0;
  return before >= 1 && before <= 3;
}

export function trophyFor(place) {
  return place === 1 ? "gold" : place === 2 ? "silver" : place === 3 ? "bronze" : null;
}

// A championship in progress: entrants are kart ids, round is 0-based.
export function startCupRun(cupId, entrantIds) {
  const cup = cupById(cupId);
  if (!cup) throw new Error(`no cup ${cupId}`);
  const points = {};
  for (const id of entrantIds) points[id] = 0;
  return { cupId, round: 0, points, results: [] };
}

// Record a finished race. `orderIds` is the finishing order (winner first).
export function recordRace(run, orderIds) {
  const gained = {};
  orderIds.forEach((id, i) => {
    gained[id] = pointsFor(i + 1);
    run.points[id] = (run.points[id] ?? 0) + gained[id];
  });
  run.results.push({ order: [...orderIds], gained });
  run.round += 1;
  return gained;
}

export function isFinished(run) {
  const cup = cupById(run.cupId);
  return run.round >= cup.races.length;
}

// Standings: most points first; ties go to the better result in the last race.
export function cupStandings(run) {
  const last = run.results[run.results.length - 1]?.order ?? [];
  return Object.keys(run.points).sort(
    (a, b) => run.points[b] - run.points[a] || last.indexOf(a) - last.indexOf(b),
  );
}

// Finish a cup: returns { place, prize, improved } and updates `records`.
export function finishCup(run, records, playerId) {
  const cup = cupById(run.cupId);
  const place = cupStandings(run).indexOf(playerId) + 1;
  const prize = cup.prizes[place - 1] ?? 0;
  const before = records[cup.id] ?? 0;
  const improved = before === 0 || place < before;
  if (improved) records[cup.id] = place;
  return { place, prize, improved };
}
