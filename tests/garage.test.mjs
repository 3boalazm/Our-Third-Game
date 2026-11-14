import test from "node:test";
import assert from "node:assert/strict";
import { GarageVehicles, GarageTunes, loadoutStats } from "../src/garage.js";
import { makeKart } from "../src/game.js";

test("the garage offers distinct chassis with gameplay trade-offs", () => {
  assert.equal(GarageVehicles.length, 3);
  const sprint = makeKart({ id: "sprint", name: "Sprint", color: "blue", vehicle: "sprint" });
  const thunder = makeKart({ id: "thunder", name: "Thunder", color: "red", vehicle: "thunder" });
  assert.ok(sprint.accelFactor > thunder.accelFactor);
  assert.ok(sprint.handlingFactor > thunder.handlingFactor);
  assert.ok(thunder.speedFactor > sprint.speedFactor);
});

test("workshop kits affect race loadouts and their displayed stats", () => {
  assert.equal(GarageTunes.length, 4);
  assert.ok(makeKart({ id: "engine", name: "Engine", color: "blue", tune: "engine" }).speedFactor > 1);
  assert.ok(makeKart({ id: "grip", name: "Grip", color: "blue", tune: "suspension" }).handlingFactor > 1);
  assert.ok(makeKart({ id: "nitro", name: "Nitro", color: "blue", tune: "nitro" }).nitroFactor > 1);
  assert.ok(loadoutStats("thunder", "engine").speed > 100);
});

test("invalid stored loadouts fall back to a safe default", () => {
  const kart = makeKart({ id: "unknown", name: "Unknown", color: "blue", vehicle: "missing", tune: "missing" });
  assert.equal(kart.vehicle, "apex");
  assert.equal(kart.tune, "balanced");
});
