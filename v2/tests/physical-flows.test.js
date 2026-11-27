"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createSimulation } = require("../core/engine");
const { box, bodyProfile, overlaps } = require("../core/physical-contact");
const OPS = { id: "OPS", role: "operations" };

test("two autonomous deliveries share the apron in turn and both return without intersecting trucks", t => {
  const sim = createSimulation(); t.after(() => sim.close());
  const second = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, { id: "STORE-2", role: "store", branchId: "TIENDA-2" });
  sim.command("order.release", { id: "PED-00001" }, OPS); sim.command("order.release", { id: second.id }, OPS);
  let complete = false;
  for (let tick = 0; tick < 4000; tick++) {
    sim.advance(1); const state = sim.snapshot(OPS);
    const trucks = state.trucks.map(truck => box(truck, bodyProfile("TRUCK"), { id: truck.id }));
    for (let first = 0; first < trucks.length; first++) for (let other = first + 1; other < trucks.length; other++) assert.equal(overlaps(trucks[first], trucks[other]), false, `trucks overlap at ${tick}`);
    if (state.autonomy.jobs.length === 2 && state.autonomy.jobs.every(job => job.state === "COMPLETED")) {
      complete = true; assert.ok(state.trucks.every(truck => truck.state === "AVAILABLE"));
      assert.equal(state.metrics.storeCases, 7); assert.equal(state.metrics.warehouseCases + state.metrics.storeCases, 360); break;
    }
  }
  assert.equal(complete, true);
});

test("simultaneously dispatched trucks queue at the actual motor until the previous return clears", t => {
  const sim = createSimulation({ academicLegacyFixture: true }); t.after(() => sim.close());
  const second = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, { id: "STORE-2", role: "store", branchId: "TIENDA-2" });
  for (const id of ["PED-00001", second.id]) {
    sim.command("order.release", { id }, OPS);
    let ready = false;
    for (let tick = 0; tick < 300; tick++) { const state = sim.snapshot(OPS); if (state.orders.find(order => order.id === id).state === "READY") { ready = true; break; } sim.advance(10); }
    assert.equal(ready, true);
  }
  sim.command("order.dispatch", { id: "PED-00001" }, OPS); sim.command("order.dispatch", { id: second.id }, OPS);
  let queued = false, completed = false;
  for (let tick = 0; tick < 1600; tick++) {
    sim.advance(1); const state = sim.snapshot(OPS);
    queued ||= Boolean(state.physicalTraffic?.queue.length);
    const trucks = state.trucks.map(truck => box(truck, bodyProfile("TRUCK"), { id: truck.id }));
    for (let a = 0; a < trucks.length; a++) for (let b = a + 1; b < trucks.length; b++) assert.equal(overlaps(trucks[a], trucks[b]), false);
    for (const order of state.orders.filter(order => order.state === "ARRIVED")) sim.command("order.receive", { id: order.id }, { id: `STORE:${order.branchId}`, role: "store", branchId: order.branchId });
    if (state.orders.filter(order => order.state === "RECEIVED").length === 2 && state.trucks.every(truck => truck.state === "AVAILABLE")) { completed = true; assert.equal(state.metrics.storeCases, 7); break; }
  }
  assert.equal(queued, true); assert.equal(completed, true);
});

test("the long L access to Jesús María preserves the load and returns through the clear pocket", t => {
  const sim = createSimulation(); t.after(() => sim.close());
  const order = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, { id: "STORE-3", role: "store", branchId: "TIENDA-3" });
  sim.command("order.release", { id: order.id }, OPS);
  let complete = false;
  for (let tick = 0; tick < 1800; tick++) {
    sim.advance(1); const state = sim.snapshot(OPS);
    if (state.autonomy.jobs.find(job => job.documentId === order.id)?.state === "COMPLETED") {
      assert.equal(state.metrics.storeCases, 1); assert.ok(state.trucks.every(truck => truck.state === "AVAILABLE")); complete = true; break;
    }
  }
  assert.equal(complete, true);
});
