// The garage: coins, performance upgrades and parts. Pure logic (no DOM), so it
// can be tested in Node. main.js keeps the player's state in prefs:
//   prefs.coins            number
//   prefs.upgrades         { engine, accel, handling }   levels 0..MaxLevel
//   prefs.owned            ids of bought items (free items are always owned)
//   prefs.color / livery / wheels / spoiler   what is fitted now

export const MaxLevel = 5;

// Cost of the next level (index = current level).
export const UpgradeCosts = [250, 500, 900, 1400, 2200];

export const Upgrades = [
  { id: "engine", name: "Engine", stat: "Top speed", perLevel: 0.025 },
  { id: "accel", name: "Turbo", stat: "Acceleration", perLevel: 0.05 },
  { id: "handling", name: "Suspension", stat: "Grip & steering", perLevel: 0.04 },
];

// Paint, decals, wheels and rear wings. Free items cost 0.
export const Colors = [
  { id: "#4f6bff", name: "Racing blue", cost: 0 },
  { id: "#ff5a5f", name: "Coral red", cost: 0 },
  { id: "#2bb673", name: "Emerald", cost: 0 },
  { id: "#f5a623", name: "Amber", cost: 0 },
  { id: "#a259ff", name: "Violet", cost: 0 },
  { id: "#14b8c4", name: "Teal", cost: 0 },
  { id: "#ff2d95", name: "Hot pink", cost: 300 },
  { id: "#ffd400", name: "Taxi yellow", cost: 300 },
  { id: "#f2f4f8", name: "Pearl white", cost: 400 },
  { id: "#1c1f2a", name: "Stealth black", cost: 400 },
  { id: "#ff6a00", name: "Lava orange", cost: 500 },
  { id: "#c9a24b", name: "Champion gold", cost: 1200 },
];

export const Liveries = [
  { id: "stripe", name: "Racing stripe", cost: 0 },
  { id: "twin", name: "Twin stripes", cost: 0 },
  { id: "clean", name: "Clean", cost: 0 },
  { id: "number", name: "Race number", cost: 250 },
  { id: "checker", name: "Checkered", cost: 450 },
  { id: "flames", name: "Flames", cost: 700 },
];

export const Wheels = [
  { id: "standard", name: "Standard", cost: 0 },
  { id: "sport", name: "Gold sport rims", cost: 500 },
  { id: "offroad", name: "Chunky off-road", cost: 650 },
];

export const Spoilers = [
  { id: "standard", name: "Standard wing", cost: 0 },
  { id: "none", name: "No wing", cost: 0 },
  { id: "gt", name: "GT wing", cost: 600 },
];

export const Catalogue = { color: Colors, livery: Liveries, wheels: Wheels, spoiler: Spoilers };

export function itemFor(slot, id) {
  return (Catalogue[slot] ?? []).find((item) => item.id === id) ?? null;
}

export function isOwned(state, slot, id) {
  const item = itemFor(slot, id);
  if (!item) return false;
  return item.cost === 0 || (state.owned ?? []).includes(`${slot}:${id}`);
}

// A fresh, valid garage state from whatever was saved (old saves have none).
export function readGarage(saved = {}) {
  const levels = saved.upgrades ?? {};
  const clampLevel = (v) => Math.max(0, Math.min(MaxLevel, Math.floor(Number(v) || 0)));
  const owned = Array.isArray(saved.owned) ? saved.owned.filter((s) => typeof s === "string").slice(0, 200) : [];
  const state = {
    coins: Math.max(0, Math.floor(Number(saved.coins) || 0)),
    upgrades: { engine: clampLevel(levels.engine), accel: clampLevel(levels.accel), handling: clampLevel(levels.handling) },
    owned,
  };
  const pick = (slot, value, fallback) => (isOwned(state, slot, value) ? value : fallback);
  state.color = pick("color", saved.color, Colors[0].id);
  state.livery = pick("livery", saved.livery, "stripe");
  state.wheels = pick("wheels", saved.wheels, "standard");
  state.spoiler = pick("spoiler", saved.spoiler, "standard");
  return state;
}

export function upgradeCost(state, id) {
  const level = state.upgrades[id] ?? 0;
  return level >= MaxLevel ? null : UpgradeCosts[level];
}

// Buy the next level. Returns true when it worked.
export function buyUpgrade(state, id) {
  const cost = upgradeCost(state, id);
  if (cost == null || state.coins < cost) return false;
  state.coins -= cost;
  state.upgrades[id] += 1;
  return true;
}

// Buy (if needed) and fit an item. Returns "fitted", "bought" or "short" (not enough coins).
export function buyOrFit(state, slot, id) {
  const item = itemFor(slot, id);
  if (!item) return "short";
  if (!isOwned(state, slot, id)) {
    if (state.coins < item.cost) return "short";
    state.coins -= item.cost;
    state.owned.push(`${slot}:${id}`);
    state[slot] = id;
    return "bought";
  }
  state[slot] = id;
  return "fitted";
}

// How much the upgrades change the kart (multipliers, 1 = stock).
export function upgradeMultipliers(levels = {}) {
  const lv = (id) => Math.max(0, Math.min(MaxLevel, levels[id] ?? 0));
  return {
    top: 1 + lv("engine") * Upgrades[0].perLevel,
    accel: 1 + lv("accel") * Upgrades[1].perLevel,
    grip: 1 + lv("handling") * Upgrades[2].perLevel,
    steer: 1 + lv("handling") * Upgrades[2].perLevel * 0.6,
  };
}

// Applied to the player's kart after the weather (which sets the same fields).
export function applyUpgrades(kart, levels) {
  const m = upgradeMultipliers(levels);
  kart.topScale = (kart.topScale ?? 1) * m.top;
  kart.accelScale = (kart.accelScale ?? 1) * m.accel;
  kart.grip = (kart.grip ?? 1) * m.grip;
  kart.steerScale = (kart.steerScale ?? 1) * m.steer;
}

// Bots keep up a little as the player upgrades, so races stay close while the
// upgrades still clearly help (they get half of the player's top-speed gain).
export function botCatchUp(levels) {
  const m = upgradeMultipliers(levels);
  return 1 + (m.top - 1) * 0.5;
}

// 0..1 for the stat bars in the garage.
export function statLevel(levels, id) {
  return (levels[id] ?? 0) / MaxLevel;
}

// Coins for a finished race. Returns { total, lines: [{ label, coins }] }.
//   place     1-based finishing position (ignored in a time trial)
//   karts     how many karts raced
//   laps      laps in the race
//   mode      "race" or "trial"
//   stats     { drifts, pickups, overtakes }
//   newRecord true when a track record was set
//   daily     true when today's challenge was completed in this race
export function coinsForRace({ place = 1, karts = 4, laps = 3, mode = "race", stats = {}, newRecord = false, daily = false }) {
  const lines = [];
  const lapFactor = Math.max(0.5, Math.min(2, laps / 3));
  if (mode === "trial") {
    lines.push({ label: "Time trial finished", coins: Math.round(80 * lapFactor) });
  } else {
    const table = karts <= 2 ? [220, 90] : [300, 190, 120, 70];
    const base = table[Math.min(table.length - 1, Math.max(0, place - 1))];
    lines.push({ label: place === 1 ? "Winner" : `Finished ${place}${["st", "nd", "rd"][place - 1] ?? "th"}`, coins: Math.round(base * lapFactor) });
  }
  const drifts = Math.min(30, stats.drifts ?? 0);
  if (drifts > 0) lines.push({ label: `Drifts x${drifts}`, coins: drifts * 8 });
  const pickups = Math.min(30, stats.pickups ?? 0);
  if (pickups > 0) lines.push({ label: `Nitro canisters x${pickups}`, coins: pickups * 6 });
  const overtakes = Math.min(30, stats.overtakes ?? 0);
  if (overtakes > 0 && mode !== "trial") lines.push({ label: `Overtakes x${overtakes}`, coins: overtakes * 10 });
  if (newRecord) lines.push({ label: "New track record", coins: 150 });
  if (daily) lines.push({ label: "Daily challenge", coins: 250 });
  const total = lines.reduce((sum, line) => sum + line.coins, 0);
  return { total, lines };
}
