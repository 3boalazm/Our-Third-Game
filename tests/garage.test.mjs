import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MaxLevel,
  UpgradeCosts,
  applyUpgrades,
  botCatchUp,
  buyOrFit,
  buyUpgrade,
  coinsForRace,
  isOwned,
  previewItem,
  previewUpgrade,
  readGarage,
  upgradeCost,
  upgradeMultipliers,
} from "../src/garage.js";

test("an old save without garage data starts with stock parts and no coins", () => {
  const g = readGarage({ color: "#ff5a5f", livery: "twin" });
  assert.equal(g.coins, 0);
  assert.deepEqual(g.upgrades, { engine: 0, accel: 0, handling: 0 });
  assert.equal(g.color, "#ff5a5f");
  assert.equal(g.livery, "twin");
  assert.equal(g.wheels, "standard");
  assert.equal(g.spoiler, "standard");
});

test("an item that was never bought cannot be fitted from a save", () => {
  const g = readGarage({ coins: 50, color: "#c9a24b", livery: "flames", wheels: "sport" });
  assert.equal(g.color, "#4f6bff");
  assert.equal(g.livery, "stripe");
  assert.equal(g.wheels, "standard");
});

test("broken saved values are cleaned up", () => {
  const g = readGarage({ coins: -40, upgrades: { engine: 99, accel: "x", handling: -2 }, owned: "nope" });
  assert.equal(g.coins, 0);
  assert.deepEqual(g.upgrades, { engine: MaxLevel, accel: 0, handling: 0 });
  assert.deepEqual(g.owned, []);
});

test("upgrades cost more each level and stop at the top level", () => {
  const g = readGarage({ coins: 100000 });
  let spent = 0;
  for (let i = 0; i < MaxLevel; i += 1) {
    const cost = upgradeCost(g, "engine");
    assert.equal(cost, UpgradeCosts[i]);
    assert.ok(buyUpgrade(g, "engine"));
    spent += cost;
  }
  assert.equal(g.upgrades.engine, MaxLevel);
  assert.equal(upgradeCost(g, "engine"), null);
  assert.equal(buyUpgrade(g, "engine"), false);
  assert.equal(g.coins, 100000 - spent);
});

test("you cannot buy what you cannot afford", () => {
  const g = readGarage({ coins: 100 });
  assert.equal(buyUpgrade(g, "accel"), false);
  assert.equal(g.coins, 100);
  assert.equal(buyOrFit(g, "livery", "flames"), "short");
  assert.equal(g.livery, "stripe");
});

test("buying an item fits it and keeps it owned; refitting is free", () => {
  const g = readGarage({ coins: 1000 });
  assert.equal(buyOrFit(g, "wheels", "sport"), "bought");
  assert.equal(g.coins, 500);
  assert.equal(g.wheels, "sport");
  assert.ok(isOwned(g, "wheels", "sport"));
  assert.equal(buyOrFit(g, "wheels", "standard"), "fitted");
  assert.equal(buyOrFit(g, "wheels", "sport"), "fitted");
  assert.equal(g.coins, 500);
  // and it survives a save / load
  const again = readGarage(JSON.parse(JSON.stringify(g)));
  assert.equal(again.wheels, "sport");
});

test("upgrades make the kart faster, quicker and grippier", () => {
  const stock = upgradeMultipliers({});
  assert.deepEqual(stock, { top: 1, accel: 1, grip: 1, steer: 1 });
  const maxed = upgradeMultipliers({ engine: MaxLevel, accel: MaxLevel, handling: MaxLevel });
  assert.ok(maxed.top > 1.1 && maxed.top < 1.15);
  assert.ok(maxed.accel > 1.2);
  assert.ok(maxed.grip > 1.15);
  const kart = { topScale: 0.95, accelScale: 1, grip: 0.8, steerScale: 1 }; // rain
  applyUpgrades(kart, { engine: 2 });
  assert.ok(Math.abs(kart.topScale - 0.95 * 1.05) < 1e-9);
  assert.equal(kart.grip, 0.8);
});

test("bots catch up by half of the player's top-speed gain", () => {
  assert.equal(botCatchUp({}), 1);
  const m = upgradeMultipliers({ engine: 4 });
  assert.ok(Math.abs(botCatchUp({ engine: 4 }) - (1 + (m.top - 1) / 2)) < 1e-9);
});

test("race coins reward the finishing place and the extras", () => {
  const win = coinsForRace({ place: 1, karts: 4, laps: 3 });
  const last = coinsForRace({ place: 4, karts: 4, laps: 3 });
  assert.ok(win.total > last.total);
  const extras = coinsForRace({ place: 2, karts: 4, laps: 3, stats: { drifts: 3, pickups: 2, overtakes: 1 }, newRecord: true, daily: true });
  const plain = coinsForRace({ place: 2, karts: 4, laps: 3 });
  assert.equal(extras.total, plain.total + 3 * 8 + 2 * 6 + 10 + 150 + 250);
  assert.equal(extras.lines.reduce((s, l) => s + l.coins, 0), extras.total);
  // longer races pay more, a time trial has no position prize
  assert.ok(coinsForRace({ place: 1, laps: 5 }).total > win.total);
  assert.ok(coinsForRace({ mode: "trial", laps: 3 }).total < win.total);
});

test("a preview shows the price without spending a single coin", () => {
  const g = readGarage({ coins: 700 });
  const part = previewItem(g, "wheels", "sport");
  assert.equal(part.name, "Gold sport rims");
  assert.equal(part.cost, 500);
  assert.equal(part.affordable, true);
  assert.equal(part.coinsAfter, 200);
  // nothing happened to the garage state
  assert.equal(g.coins, 700);
  assert.equal(g.wheels, "standard");
  assert.equal(isOwned(g, "wheels", "sport"), false);

  const tooDear = previewItem(g, "color", "#c9a24b");
  assert.equal(tooDear.affordable, false);
  assert.equal(tooDear.cost, 1200);
  assert.equal(tooDear.coinsAfter, -500); // the card says how much is missing

  const mine = previewItem(g, "wheels", "standard");
  assert.equal(mine.owned, true);
  assert.equal(mine.cost, 0);
  assert.equal(mine.coinsAfter, 700);

  assert.equal(previewItem(g, "wheels", "nope"), null);
});

test("an upgrade preview spells out the next level and what it costs", () => {
  const g = readGarage({ coins: 300, upgrades: { engine: 1 } });
  const preview = previewUpgrade(g, "engine");
  assert.equal(preview.level, 1);
  assert.equal(preview.nextLevel, 2);
  assert.equal(preview.cost, UpgradeCosts[1]);
  assert.equal(preview.affordable, false); // 500 coins for 300 in the wallet
  assert.equal(g.upgrades.engine, 1);
  assert.equal(g.coins, 300);

  // after a confirmed buy the preview matches the new state
  g.coins = 900;
  assert.equal(buyUpgrade(g, "engine"), true);
  assert.equal(previewUpgrade(g, "engine").level, 2);
  assert.equal(previewUpgrade(g, "engine").cost, UpgradeCosts[2]);
});

test("a maxed upgrade has nothing left to preview or buy", () => {
  const g = readGarage({ coins: 99999, upgrades: { accel: MaxLevel } });
  const preview = previewUpgrade(g, "accel");
  assert.equal(preview.maxed, true);
  assert.equal(preview.nextLevel, MaxLevel);
  assert.equal(preview.cost, 0);
  assert.equal(preview.affordable, false);
  assert.equal(buyUpgrade(g, "accel"), false);
  assert.equal(previewUpgrade(g, "nope"), null);
});
