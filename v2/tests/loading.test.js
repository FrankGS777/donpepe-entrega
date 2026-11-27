"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createSimulation } = require("../core/engine");
const { createStore } = require("../core/store");
const OPS = { id: "OPS", role: "operations" }, ADMIN = { id: "ADMIN", role: "admin" }, STORE = { id: "STORE", role: "store", branchId: "TIENDA-1" };
const view = sim => sim.snapshot(OPS);
const physical = v => v.hus.reduce((sum, h) => sum + h.cases, 0) + v.storeStock.reduce((sum, h) => sum + h.cases, 0);
function until(sim, predicate, max = 1800) {
  for (let i = 0; i < max; i++) { const state = view(sim); if (predicate(state)) return state; sim.advance(1); }
  assert.fail("No se alcanzó la fase física esperada.");
}
function ready(sim, id = "PED-00001") { sim.command("order.release", { id }, OPS); return until(sim, v => v.orders.find(o => o.id === id).state === "READY"); }
function fixture(t, file = false) {
  const folder = file ? mkdtempSync(join(tmpdir(), "donpepe-loading-")) : null, filename = folder ? join(folder, "scenario.sqlite") : ":memory:";
  // Exercise the physical loading engine independently of the new autonomous
  // authorization layer, whose production contract has its own dedicated tests.
  let sim = createSimulation({ filename, academicLegacyFixture: true });
  t.after(() => { sim.close(); if (folder) rmSync(folder, { recursive: true, force: true }); });
  return { get sim() { return sim; }, filename, restart() { sim.close(); sim = createSimulation({ filename, academicLegacyFixture: true }); }, mutate(change) { const db = createStore(filename); const state = db.read(); change(state); db.write(state); db.close(); } };
}
test("despacho reserva recursos y mueve cada HU por montacargas y plaza real antes de viajar", t => {
  const f = fixture(t), s = f.sim; ready(s);
  const reply = s.command("order.dispatch", { id: "PED-00001", commandId: "dispatch-once" }, OPS);
  let v = view(s), order = v.orders[0], truck = v.trucks.find(r => r.id === reply.truckId);
  assert.equal(order.state, "LOADING"); assert.equal(order.loading.phase, "DOCKING"); assert.equal(v.metrics.inTransitCases, 0); assert.equal(truck.doorProgress, 0);
  assert.ok(order.allocations.every(a => v.hus.find(h => h.id === a.huId).locationId === order.dockId));
  assert.deepEqual(s.command("order.dispatch", { id: order.id, commandId: "dispatch-once" }, OPS), reply);
  assert.throws(() => s.command("order.dispatch", { id: order.id }, OPS), e => e.status === 409);
  v = until(s, v => v.trucks.find(r => r.id === truck.id).doorProgress > 0 && v.trucks.find(r => r.id === truck.id).doorProgress < 1);
  assert.ok(v.physicalTraffic, "Operaciones recibe la reserva física después de despejarse el muelle y acoplar el camión");
  assert.equal(s.snapshot(ADMIN).physicalTraffic, undefined, "Administración no recibe controles ni telemetría del mapa");
  assert.equal(s.snapshot(STORE).physicalTraffic, undefined, "Una tienda no recibe la circulación interna del centro");
  assert.equal(physical(v), 360); assert.equal(v.orders[0].state, "LOADING");
  v = until(s, v => v.robots.some(r => r.type === "FORKLIFT" && r.carryingHuId));
  const fork = v.robots.find(r => r.type === "FORKLIFT" && r.carryingHuId), hu = v.hus.find(h => h.id === fork.carryingHuId);
  assert.ok(fork.motionHistory.some(frame => frame.carryingHuId && frame.orderId === "PED-00001"), "La relación palé/montacargas/remolque debe acompañar a la pose histórica");
  assert.equal(hu.locationId, fork.id); assert.equal(hu.state, "LOADING"); assert.equal(v.trucks.find(r => r.id === truck.id).doorProgress, 1); assert.equal(v.metrics.inTransitCases, 0);
  v = until(s, v => v.hus.some(h => h.state === "ON_TRUCK"));
  const loaded = v.hus.find(h => h.state === "ON_TRUCK"), slot = v.trucks.find(r => r.id === truck.id).loadPositions.find(slot => slot.huId === loaded.id);
  assert.equal(loaded.truckSlotId, slot.id); assert.equal(slot.height, 1.9); assert.equal(v.orders[0].loading.loadedLoads, 1); assert.equal(physical(v), 360);
  v = until(s, v => v.orders[0].state === "DISPATCHED");
  assert.equal(v.orders[0].loading.phase, "COMPLETED"); assert.equal(v.trucks.find(r => r.id === truck.id).doorProgress, 0); assert.equal(v.metrics.inTransitCases, 6); assert.deepEqual(v.dockReservations, {});
  assert.ok(v.missions.filter(m => m.deviceType === "FORKLIFT").every(m => m.kind === "TRUCK_LOAD" && m.state === "COMPLETED"));
  until(s, v => v.orders[0].state === "ARRIVED"); s.command("order.receive", { id: order.id }, STORE); assert.equal(physical(view(s)), 360);
});
test("pausa, avería y reinicio conservan carga, ruta y muelle exclusivo", t => {
  const f = fixture(t, true); ready(f.sim); f.sim.command("order.dispatch", { id: "PED-00001" }, OPS);
  let v = until(f.sim, v => v.robots.some(r => r.type === "FORKLIFT" && r.carryingHuId));
  const fork = v.robots.find(r => r.type === "FORKLIFT" && r.carryingHuId), order = v.orders[0];
  f.sim.command("equipment.fault", { id: fork.id, reason: "Inspección del sensor del mástil" }, OPS);
  f.sim.advance(30); v = view(f.sim); assert.equal(v.robots.find(r => r.id === fork.id).x, fork.x); assert.equal(v.hus.find(h => h.id === fork.carryingHuId).locationId, fork.id);
  assert.equal(v.dockReservations[order.dockId].orderId, order.id); assert.match(v.orders[0].loading.blockedReason, /incidencia/);
  f.restart(); v = view(f.sim); assert.equal(v.robots.find(r => r.id === fork.id).state, "FAULT"); assert.equal(physical(v), 360);
  f.sim.command("equipment.recover", { id: fork.id }, OPS); f.sim.command("simulation.pause", { paused: true }, OPS);
  const before = view(f.sim); f.sim.advance(20); assert.equal(view(f.sim).clock.elapsed, before.clock.elapsed);
  f.sim.command("simulation.pause", { paused: false }, OPS); until(f.sim, v => v.orders[0].state === "ARRIVED");
  assert.equal(view(f.sim).hus.filter(h => h.state === "IN_TRANSIT").reduce((n, h) => n + h.cases, 0), 6); assert.equal(physical(view(f.sim)), 360);
});
test("dos expediciones no reservan el mismo muelle ni el mismo camión", t => {
  const f = fixture(t), s = f.sim; ready(s);
  const next = s.command("order.create", { branchId: "TIENDA-2", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, { ...STORE, branchId: "TIENDA-2" }); ready(s, next.id);
  const third = s.command("order.create", { branchId: "TIENDA-3", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, { ...STORE, branchId: "TIENDA-3" }); ready(s, third.id);
  let v = view(s), orders = v.orders.filter(o => o.state === "READY"), sameDock = orders.find(o => o.id !== orders[0].id && o.dockId === orders[0].dockId), otherDock = orders.find(o => o.dockId !== orders[0].dockId);
  assert.ok(sameDock && otherDock); const first = s.command("order.dispatch", { id: orders[0].id }, OPS);
  const revision = view(s).revision; assert.throws(() => s.command("order.dispatch", { id: sameDock.id }, OPS), /muelle está ocupado/); assert.equal(view(s).revision, revision);
  assert.throws(() => s.command("order.dispatch", { id: otherDock.id, truckId: first.truckId }, OPS), e => e.status === 409);
  const second = s.command("order.dispatch", { id: otherDock.id }, OPS); assert.notEqual(second.truckId, first.truckId); assert.equal(Object.keys(view(s).dockReservations).length, 2);
});
test("compatibilidad térmica, batería y capacidad se validan sin reservas parciales", t => {
  const f = fixture(t, true); ready(f.sim);
  for (const [field, value, message] of [["temperatureControlled", false, /cadena fría/], ["capacityCases", 1, /capacidad/], ["multiTemperature", false, /distinta temperatura/]]) {
    f.mutate(v => { v.trucks[0][field] = value; });
    assert.throws(() => f.sim.command("order.dispatch", { id: "PED-00001", truckId: "TRUCK-1" }, OPS), message);
    assert.equal(view(f.sim).orders[0].state, "READY"); assert.deepEqual(view(f.sim).dockReservations, {});
    f.mutate(v => { v.trucks[0][field] = field === "capacityCases" ? 120 : true; });
  }
  f.mutate(v => { v.robots.find(r => r.id === `${v.orders[0].dockId === "DOCK-1" ? "FORKLIFT-1" : "FORKLIFT-2"}`).battery = 19.95; });
  assert.throws(() => f.sim.command("order.dispatch", { id: "PED-00001" }, OPS), /recargando/); f.sim.advance(2);
  assert.equal(f.sim.command("order.dispatch", { id: "PED-00001" }, OPS).state, "LOADING");
});
test("cambio de vida útil durante carga requiere descarga real y cuarentena, nunca salida", t => {
  const f = fixture(t), s = f.sim; ready(s); s.command("order.dispatch", { id: "PED-00001" }, OPS);
  until(s, v => v.hus.some(h => h.state === "ON_TRUCK"));
  s.command("config.settings.update", { expectedRevision: view(s).configuration.revision, settings: { minShelfLifeDays: 30 } }, ADMIN);
  let v = until(s, v => v.orders[0].loading.phase === "QUALITY_HOLD");
  assert.equal(v.orders[0].state, "LOADING"); assert.equal(v.metrics.inTransitCases, 0); assert.equal(v.orders[0].loading.loadedLoads, 2);
  s.command("order.rejectPrepared", { id: "PED-00001", reason: "Retención por vida útil insuficiente" }, OPS);
  v = until(s, v => v.robots.some(r => r.type === "FORKLIFT" && r.carryingHuId));
  assert.ok(v.missions.some(m => m.kind === "TRUCK_UNLOAD" && m.state === "ACTIVE")); assert.equal(v.metrics.inTransitCases, 0);
  v = until(s, v => v.orders[0].state === "CANCELLED_AFTER_PREPARATION");
  assert.equal(v.orders[0].loading.phase, "REJECTED"); assert.equal(v.orders[0].loading.loadedLoads, 0); assert.equal(physical(v), 360);
  assert.ok(v.hus.filter(h => h.orderId === "PED-00001").every(h => h.state === "WAITING_QUARANTINE"));
  v = until(s, v => v.hus.filter(h => h.orderId === "PED-00001").every(h => h.state === "QUARANTINE")); assert.equal(physical(v), 360);
  assert.equal(v.events.filter(e => e.type === "TRAILER_LOAD_REMOVED").length, 2); assert.equal(v.events.filter(e => e.type === "ORDER_DISPATCHED").length, 0);
});
test("historial 60× es acotado, privado y no infla el estado persistido", t => {
  const f = fixture(t, true); ready(f.sim); f.sim.command("order.dispatch", { id: "PED-00001" }, OPS); f.sim.command("simulation.speed", { speed: 60 }, OPS);
  f.sim.advance(3); let v = view(f.sim);
  assert.ok(v.robots.some(r => r.motionHistory.length > 2));
  for (const device of [...v.robots, ...v.trucks]) { assert.ok(device.motionHistory.length <= 150); assert.ok(device.motionHistory.every((p, i, a) => !i || p.elapsed >= a[i - 1].elapsed)); }
  assert.ok(v.hus.every(h => h.motionHistory.length <= 40));
  assert.ok(f.sim.snapshot(STORE).robots.every(r => !r.motionHistory));
  const db = createStore(f.filename), raw = db.read(); db.close(); assert.ok(raw.robots.every(r => !r.motionHistory)); assert.ok(raw.hus.every(h => !h.motionHistory));
  const dock = v.layout.loadingDocks[0], xs = dock.stagingSlots.slice(0, 6).map(p => p.x);
  assert.ok(xs[3] - xs[2] - 1.16 >= 2); assert.equal(dock.stagingSlots.length, 24);
});
test("migración aditiva conserva cargas previas sobre camiones sin duplicar inventario", t => {
  const f = fixture(t, true); ready(f.sim); f.sim.command("order.dispatch", { id: "PED-00001" }, OPS); until(f.sim, v => v.orders[0].state === "ARRIVED");
  f.mutate(v => { delete v.physicalLoadingVersion; delete v.layout.loadingDocks; delete v.layout.truckParking; delete v.dockReservations; v.robots = v.robots.filter(r => r.type !== "FORKLIFT"); for (const truck of v.trucks) delete truck.loadPositions; for (const hu of v.hus) delete hu.truckSlotId; });
  f.restart(); const v = view(f.sim); assert.equal(physical(v), 360); assert.equal(v.orders[0].state, "ARRIVED"); assert.equal(v.robots.filter(r => r.type === "FORKLIFT").length, 2);
  assert.equal(v.trucks.find(r => r.id === v.orders[0].truckId).loadPositions.filter(p => p.huId).length, 2);
  f.sim.command("order.receive", { id: "PED-00001" }, STORE); assert.equal(physical(view(f.sim)), 360);
});
test("AGV deposita en la plaza exacta por pasillos ortogonales y conserva locks hasta retirarse", t => {
  const f = fixture(t, true); f.sim.command("order.release", { id: "PED-00001" }, OPS);
  let v = until(f.sim, v => v.missions.some(m => m.phase === "STAGING_APPROACH"));
  const mission = v.missions.find(m => m.phase === "STAGING_APPROACH"), robot = v.robots.find(r => r.id === mission.robotId), hu = v.hus.find(h => h.id === mission.huId);
  assert.equal(hu.locationId, robot.id); assert.equal(hu.stagingReserved, true); assert.equal(v.routeLocks[`node:${mission.destinationId}`], mission.id);
  assert.ok(robot.route.slice(1).every((p, i) => Math.abs(p.x - robot.route[i].x) < 0.001 || Math.abs(p.z - robot.route[i].z) < 0.001));
  v = until(f.sim, v => v.missions.find(m => m.id === mission.id).phase === "STAGING_DEPOSIT");
  const atSlot = v.robots.find(r => r.id === robot.id), slot = v.layout.loadingDocks.flatMap(d => d.stagingSlots).find(p => p.id === hu.stagingSlotId);
  assert.equal(atSlot.x, slot.x); assert.equal(atSlot.z, slot.z); assert.equal(atSlot.cargoHeight, 0.95);
  f.sim.advance(1); v = view(f.sim); assert.ok(v.robots.find(r => r.id === robot.id).cargoHeight > 0.18); assert.ok(v.robots.find(r => r.id === robot.id).cargoHeight < 0.95);
  f.sim.command("equipment.fault", { id: robot.id }, OPS); f.restart(); f.sim.advance(10);
  assert.equal(view(f.sim).robots.find(r => r.id === robot.id).state, "FAULT"); assert.equal(view(f.sim).hus.find(h => h.id === hu.id).locationId, robot.id);
  f.sim.command("equipment.recover", { id: robot.id }, OPS);
  v = until(f.sim, v => v.missions.find(m => m.id === mission.id).phase === "STAGING_EXIT");
  assert.equal(v.hus.find(h => h.id === hu.id).locationId, mission.destinationId); assert.equal(v.robots.find(r => r.id === robot.id).cargoHeight, 0.18); assert.equal(v.routeLocks[`node:${mission.destinationId}`], mission.id);
  assert.equal(v.orders[0].state, "PREPARING"); assert.equal(v.robots.find(r => r.id === robot.id).carryingHuId, null);
  v = until(f.sim, v => v.missions.find(m => m.id === mission.id).state === "COMPLETED");
  assert.notEqual(v.routeLocks[`node:${mission.destinationId}`], mission.id); assert.equal(physical(v), 360);
  until(f.sim, v => v.orders[0].state === "READY"); assert.equal(view(f.sim).hus.find(h => h.id === hu.id).stagingSlotId, slot.id);
});
