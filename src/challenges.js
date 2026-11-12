// One challenge per local day, picked deterministically from the date. The
// challenge asks for a medal-standard lap on one of the tracks; the game loop
// marks it done as soon as a lap reaches that standard.

import { Tracks } from "./track.js";

const StorageKey = "kart-daily-v1";
export const ChallengeTiers = ["bronze", "silver", "gold"];

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function challengeForDate(date = new Date()) {
  const day = dayKey(date);
  const h = hash(day);
  const track = Tracks[h % Tracks.length];
  const tier = ChallengeTiers[Math.floor(h / Tracks.length) % ChallengeTiers.length];
  return {
    day,
    trackId: track.id,
    trackName: track.name,
    tier,
    laps: 1,
  };
}

function readStore() {
  try {
    const raw = localStorage.getItem(StorageKey);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function isChallengeDone(day, store) {
  const data = store ?? readStore();
  return !!data[day]?.done;
}

export function markChallengeDone(day) {
  const store = readStore();
  if (store[day]?.done) return false;
  store[day] = { done: true, at: Date.now() };
  try {
    localStorage.setItem(StorageKey, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}
