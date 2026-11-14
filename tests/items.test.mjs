import { test } from "node:test";
import assert from "node:assert/strict";
import { Tracks, buildTrack, nearest } from "../src/track.js";
import { makeKart, placeOnGrid, stepKart } from "../src/game.js";
import { ItemKinds, ShieldTime, buildItemBoxes, createItems, itemWeights, rollItem } from "../src/items.js";

const track = buildTrack(Tracks[0]);

function kartAt(idx, offset = 0, extra = {}) {
  const k = makeKart({ id: `k${idx}`, name: "K", color: "#fff", ...extra });
  const s = track.samples[idx % track.N];
  k.x = s.x - s.ty * offset;
  k.y = s.y + s.tx * offset;
  k.a = Math.atan2(s.ty, s.tx);
  k.lastIdx = idx % track.N;
  k.progress = idx;
  return k;
}

test("every track gets 3 rows of 4 boxes, all on the road", () => {
  for (const def of Tracks) {
    const t = buildTrack(def);
    const boxes = buildItemBoxes(t);
    assert.equal(boxes.length, 12);
    for (const b of boxes) assert.ok(nearest(t, b.x, b.y).dist < t.halfWidth, "box on the road");
  }
});

test("the leader never gets a rocket, the last kart mostly attacks", () => {
  assert.equal(itemWeights(0).rocket, 0);
  const last = itemWeights(1);
  assert.ok(last.rocket + last.boost > 0.8);
  let seq = 0;
  const rng = () => ((seq += 0.137) % 1);
  for (let i = 0; i < 200; i += 1) assert.notEqual(rollItem(0, rng), "rocket");
  for (let i = 0; i < 50; i += 1) assert.ok(ItemKinds.includes(rollItem(Math.random())));
});

test("driving through a box gives an item after the roulette, and the box comes back", () => {
  const items = createItems(track, { rng: () => 0.99 });
  const box = items.boxes[0];
  const kart = kartAt(box.idx);
  kart.x = box.x;
  kart.y = box.y;
  items.update(0.016, 1, [kart], [kart]);
  assert.equal(kart.item, null);
  assert.ok(kart.itemRoll > 0);
  assert.ok(box.activeAt > 1);
  for (let t = 1; t < 2.2; t += 0.1) items.update(0.1, t, [kart], [kart]);
  assert.ok(ItemKinds.includes(kart.item));
  assert.ok(items.events.some((e) => e.type === "got"));
});

test("a shield blocks one rocket; without it the kart spins out", () => {
  const items = createItems(track);
  const leader = kartAt(200);
  const shooter = kartAt(170);
  const order = [leader, shooter];
  leader.shieldTimer = ShieldTime;
  shooter.item = "rocket";
  assert.ok(items.use(shooter, 0, order));
  assert.equal(items.rockets.length, 1);
  for (let t = 0; t < 3 && items.rockets.length; t += 0.016) items.update(0.016, t, order, order);
  assert.equal(items.rockets.length, 0);
  assert.equal(leader.shieldTimer, 0, "the shield was used up");
  assert.equal(leader.spinTimer, 0, "and the kart kept going");
  assert.ok(items.events.some((e) => e.type === "blocked"));

  shooter.item = "rocket";
  items.use(shooter, 5, order);
  for (let t = 5; t < 8 && items.rockets.length; t += 0.016) items.update(0.016, t, order, order);
  assert.ok(leader.spinTimer > 0, "hit without a shield");
});

test("oil spins out whoever drives into it, but not the dropper straight away", () => {
  const items = createItems(track);
  const dropper = kartAt(300);
  dropper.item = "oil";
  items.use(dropper, 0, [dropper]);
  assert.equal(items.oils.length, 1);
  items.update(0.016, 0.1, [dropper], [dropper]);
  assert.equal(dropper.spinTimer, 0);
  const victim = kartAt(296);
  victim.x = items.oils[0].x;
  victim.y = items.oils[0].y;
  items.update(0.016, 2, [dropper, victim], [dropper, victim]);
  assert.ok(victim.spinTimer > 0);
  assert.equal(items.oils.length, 0);
});

test("a spinning kart loses speed and ignores the controls", () => {
  const kart = makeKart({ id: "a", name: "A", color: "#fff" });
  placeOnGrid(kart, track, 0);
  kart.vx = Math.cos(kart.a) * 500;
  kart.vy = Math.sin(kart.a) * 500;
  kart.speed = 500;
  kart.spinTimer = 1;
  for (let i = 0; i < 60; i += 1) stepKart(kart, { steer: 1, gas: true, brake: false, drift: false, nitro: true }, 1 / 60, track, true);
  assert.equal(kart.spinTimer, 0);
  assert.ok(Math.hypot(kart.vx, kart.vy) < 260, "slowed right down");
  assert.equal(kart.nitroOn, false);
});

test("bots use their items by themselves", () => {
  const items = createItems(track);
  const bot = kartAt(100, 0, { bot: true });
  bot.item = "shield";
  bot.itemDelay = 0.2;
  for (let t = 0; t < 1; t += 0.05) items.update(0.05, t, [bot], [bot]);
  assert.equal(bot.item, null);
  assert.ok(bot.shieldTimer > 0);
});
