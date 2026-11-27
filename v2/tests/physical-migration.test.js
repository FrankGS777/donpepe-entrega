"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs"), { join } = require("node:path"), { tmpdir } = require("node:os");
const { createSimulation } = require("../core/engine"), { createStore } = require("../core/store");
const OPS = { id: "OPS", role: "operations" };
function legacy(t, change) {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-guidance-upgrade-")), filename = join(folder, "scenario.sqlite");
  let sim = createSimulation({ filename, academicLegacyFixture: true }); sim.close();
  const db = createStore(filename), state = db.read(); change(state); db.write(state); db.close();
  sim = createSimulation({ filename, academicLegacyFixture: true });
  t.after(() => { sim.close(); rmSync(folder, { recursive: true, force: true }); });
  return sim;
}
function until(sim, condition, max = 500) {
  for (let step = 0; step < max; step++) { const state = sim.snapshot(OPS); if (condition(state)) return state; sim.advance(1); }
  assert.fail("El recorrido heredado no llegó a su destino físico.");
}

test("legacy outbound replans a fourteen-metre turn from its real pose without losing custody", t => {
  const sim = legacy(t, state => {
    const truck = state.trucks[0], hu = state.hus[0], order = state.orders[0];
    Object.assign(truck, { state: "OUTBOUND", orderId: order.id, branchId: "TIENDA-1", x: -90, z: 60, heading: -Math.PI / 2, progress: .8,
      trip: { startedAt: 0, duration: 36, length: 132, from: { x: 28, z: 60 }, to: { x: -76, z: 60 }, waypoints: [{ x: 28, z: 60 }, { x: -90, z: 60 }, { x: -76, z: 60 }] } });
    Object.assign(hu, { locationId: truck.id, state: "IN_TRANSIT", truckSlotId: truck.loadPositions[0].id, orderId: order.id }); truck.loadPositions[0].huId = hu.id;
    order.state = "DISPATCHED"; order.truckId = truck.id;
  });
  const before = sim.snapshot(OPS), truckBefore = before.trucks[0];
  assert.equal(truckBefore.trip.physicalGuideVersion, undefined);
  sim.advance(.001);
  const first = sim.snapshot(OPS), rebuilt = first.trucks[0];
  assert.ok(Math.hypot(rebuilt.x - truckBefore.x, rebuilt.z - truckBefore.z) < .01);
  assert.equal(rebuilt.trip.startedAt, truckBefore.trip.startedAt); assert.equal(rebuilt.trip.physicalGuideVersion, 3);
  assert.ok(rebuilt.trip.duration >= truckBefore.trip.duration * (1 - truckBefore.progress));
  assert.deepEqual(first.hus.map(({ motionHistory, ...hu }) => hu), before.hus.map(({ motionHistory, ...hu }) => hu));
  const after = until(sim, state => state.trucks[0].state === "AT_STORE");
  assert.equal(after.orders[0].state, "ARRIVED"); assert.deepEqual(after.trucks[0].loadPositions, before.trucks[0].loadPositions);
  assert.equal(after.metrics.storeCases, 0); assert.equal(after.ledger.initialCases, before.ledger.initialCases);
});

test("legacy return avoids parked neighbours and completes without moving inventory or teleporting", t => {
  const sim = legacy(t, state => {
    Object.assign(state.trucks[0], { state: "RETURNING", orderId: null, branchId: null, x: -20, z: 60, heading: Math.PI / 2, progress: .4,
      trip: { startedAt: 10, duration: 36, length: 120, from: { x: -76, z: 60 }, to: { x: 29, z: 75 }, waypoints: [{ x: -76, z: 60 }, { x: 29, z: 60 }, { x: 29, z: 75 }] } });
  });
  const before = sim.snapshot(OPS); sim.advance(.001); const first = sim.snapshot(OPS);
  assert.ok(Math.hypot(first.trucks[0].x + 20, first.trucks[0].z - 60) < .01);
  const after = until(sim, state => state.trucks[0].state === "AVAILABLE");
  assert.equal(after.trucks[0].x, 29); assert.equal(after.trucks[0].z, 75);
  assert.deepEqual(after.hus.map(({ motionHistory, ...hu }) => hu), before.hus.map(({ motionHistory, ...hu }) => hu));
  assert.deepEqual(after.trucks.slice(1).map(({ motionHistory, ...truck }) => truck), before.trucks.slice(1).map(({ motionHistory, ...truck }) => truck));
});
