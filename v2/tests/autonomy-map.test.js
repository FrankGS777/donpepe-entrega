"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createSimulation } = require("../core/engine");
const { createBlueprint } = require("../core/blueprint");
const { migrateAutomationBlueprint } = require("../core/automation-blueprint");
const { autonomyMapFrame, stageDuration } = require("../core/autonomy-map");
const { MECHANICAL_TIMING_VERSION, stationTransferSeconds, INBOUND_TRANSFER_MIN_SECONDS } = require("../core/mechanical-timing");
const { createStore } = require("../core/store");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const OPS = { id: "O", role: "operations" }, ADMIN = { id: "A", role: "admin" };
const view = (sim) => sim.snapshot(OPS);
function simulation(t, options = {}) { const sim = createSimulation(options); t.after(() => sim.close()); return sim; }
function purchase(sim, cases = 4, skuId = "SKU-ARROZ") {
  const sku = view(sim).catalog.skus.find((row) => row.id === skuId);
  return sim.command("purchase.create", { supplierId: sku.supplierId, lines: [{ skuId, cases }] }, OPS);
}
function until(sim, condition, limit = 2000) {
  for (let i = 0; i < limit; i++) { const state = view(sim); if (condition(state)) return state; sim.advance(1); }
  assert.fail("No se alcanzó el estado físico esperado");
}
const overlaps = (a, b) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2;

test("anexo aditivo: conserva geometría previa y separa maquinaria, buffer y rutas existentes", () => {
  const layout = createBlueprint(), { automation } = layout;
  delete layout.automation;
  const before = structuredClone(layout), state = { layout };
  assert.equal(migrateAutomationBlueprint(state), true);
  const { automation: added, ...original } = state.layout;
  assert.deepEqual(original, before);
  assert.deepEqual(added, automation);
  assert.equal(migrateAutomationBlueprint(state), false);
  assert.equal(added.annex.areaM2, 1056);
  const inbound = added.stations.filter((station) => ["AUTO_UNLOADER", "AUTO_ID_GATE", "PIE_STATION", "INBOUND_CONVEYOR"].includes(station.type));
  for (let i = 0; i < inbound.length; i++) for (let j = i + 1; j < inbound.length; j++) assert.equal(overlaps(inbound[i], inbound[j]), false);
  for (const slot of added.receivingBufferSlots) {
    assert.equal(inbound.some((station) => overlaps(slot, station)), false);
    assert.equal(before.nodes.some((node) => overlaps(slot, { ...node, width: 1.2, depth: 1.2 })), false);
  }
  const paths = Object.values(added.phasePaths);
  for (let i = 1; i < paths.length; i++) assert.deepEqual(paths[i][0], paths[i - 1].at(-1));
  assert.deepEqual(paths.at(-1).at(-1), { x: -34, y: 0.18, z: 17 });
  assert.equal(added.stations.filter((station) => station.type === "STORE_RECEIVING_STATION").length, 3);
  for (const store of added.stations.filter((station) => station.type === "STORE_RECEIVING_STATION")) {
    const truckSweptLane = { x: store.truckPose.x - 7, z: store.truckPose.z, width: 34, depth: 4.8 };
    assert.equal(overlaps(store, truckSweptLane), false);
    for (const slot of store.bufferSlots) {
      assert.equal(overlaps(slot, truckSweptLane), false);
      assert.equal(overlaps(slot, store), false);
    }
    assert.equal(store.bufferSlots.length, 24);
    assert.equal(store.retractableTransfer, true);
    assert.equal(store.handoffPoint.x, store.truckPose.x - 7.2);
  }
});

test("transferencia física nueva separa salida de cinta y AMR sin reescribir rutas ni ciclos antiguos", (t) => {
  const sim = simulation(t, { seed: false }); purchase(sim);
  const state = view(sim), job = state.autonomy.jobs[0], layout = state.layout.automation;
  assert.equal(job.mechanicalTimingVersion, MECHANICAL_TIMING_VERSION);
  assert.equal(stageDuration(state, job, "RECEIVING"), INBOUND_TRANSFER_MIN_SECONDS);
  assert.equal(stageDuration(state, { ...job, mechanicalTimingVersion: undefined }, "RECEIVING"), 3);
  assert.deepEqual(layout.phasePaths.RECEIVING.at(-1), { x: -34, y: .18, z: 17 });
  assert.deepEqual(layout.mechanicalPhasePaths.RECEIVING.at(-1), { x: -37, y: .18, z: 17 });
  const legacy = structuredClone(state); delete legacy.layout.automation.mechanicalVersion;
  delete legacy.layout.automation.mechanicalReceivingRoute; delete legacy.layout.automation.mechanicalPhasePaths;
  const oldPaths = structuredClone(legacy.layout.automation.phasePaths), oldNodes = structuredClone(legacy.layout.nodes);
  assert.equal(migrateAutomationBlueprint(legacy), true);
  assert.deepEqual(legacy.layout.automation.phasePaths, oldPaths);
  assert.deepEqual(legacy.layout.nodes, oldNodes);
  assert.equal(migrateAutomationBlueprint(legacy), false);
});

test("fotogramas de recepción recorren todas las estaciones; un ASN no se duplica como inventario", (t) => {
  const sim = simulation(t, { seed: false });
  purchase(sim);
  const phases = new Set();
  let hadReceipt = false;
  for (let i = 0; i < 160; i++) {
    const state = view(sim), map = state.autonomy.map, load = map.loads[0];
    if (load?.visible) {
      phases.add(load.stage);
      assert.equal(load.inventoryRecognized, false);
      assert.equal(load.huIds.length, 0);
      assert.ok(load.progress >= 0 && load.progress <= 1);
      assert.ok(load.position.x >= Math.min(load.from.x, load.to.x) && load.position.x <= Math.max(load.from.x, load.to.x));
    }
    if (load?.received) {
      assert.equal(load.visible, false);
      assert.equal(load.inventoryRecognized, true);
      assert.equal(state.hus.filter((hu) => load.huIds.includes(hu.id)).reduce((sum, hu) => sum + hu.cases, 0), 4);
      hadReceipt = true;
      const history = load.motionHistory;
      for (const stage of ["UNLOADING", "IDENTIFYING", "INSPECTING", "RECEIVING"]) assert.ok(history.some((frame) => frame.stage === stage));
      assert.ok(history.length <= 180);
      break;
    }
    assert.equal(state.metrics.warehouseCases, 0);
    sim.advance(1);
  }
  assert.equal(hadReceipt, true);
  assert.deepEqual([...phases], ["UNLOADING", "IDENTIFYING", "INSPECTING", "RECEIVING"]);
  assert.equal(sim.movements(OPS, { type: "RECEIPT" }).total, 1);
});

test("pausa y excepción congelan la posición observada sin seguir aceptando existencias", (t) => {
  const sim = simulation(t, { seed: false }); purchase(sim);
  const first = until(sim, (state) => state.autonomy.map.loads[0]?.stage === "UNLOADING" && state.autonomy.map.loads[0].phaseElapsed === 3);
  sim.command("simulation.pause", { paused: true }, OPS);
  sim.advance(30);
  const paused = view(sim).autonomy.map;
  assert.equal(paused.paused, true);
  assert.equal(paused.loads[0].moving, false);
  assert.deepEqual(paused.loads[0].position, first.autonomy.map.loads[0].position);
  // Read model of an actual held checkpoint uses saved progress, never the
  // elapsed wall time since the failure. It remains strictly read-only.
  const state = view(sim), job = state.autonomy.jobs[0];
  state.clock.paused = false;
  Object.assign(job, { state: "EXCEPTION", blockedState: "UNLOADING", blockedStageElapsed: 3, stageElapsed: 0 });
  state.clock.elapsed += 100;
  state.clock.now = new Date(Date.parse(state.clock.now) + 100000).toISOString();
  const before = structuredClone(state), held = autonomyMapFrame(state);
  assert.deepEqual(state, before);
  assert.equal(held.loads[0].moving, false);
  assert.equal(held.loads[0].blocked, true);
  assert.deepEqual(held.loads[0].position, first.autonomy.map.loads[0].position);
  assert.equal(state.metrics.warehouseCases, 0);
});

test("transferencia del buffer al AMR observa la duración mecánica de la misión y conserva custodia hasta terminar", (t) => {
  const sim = simulation(t, { seed: false }); purchase(sim);
  const start = until(sim, (state) => state.autonomy.map.bufferTransfers.some((transfer) => transfer.visible));
  const transfer = start.autonomy.map.bufferTransfers.find((row) => row.visible);
  assert.equal(transfer.stage, "HANDOFF_TO_AMR");
  assert.equal(transfer.phaseDuration, stationTransferSeconds("RECEIVE"));
  assert.equal(transfer.phaseElapsed, 0);
  assert.equal(start.hus.find((hu) => hu.id === transfer.huId).locationId, "RECEIVE");
  sim.advance(1);
  const middle = view(sim).autonomy.map.bufferTransfers.find((row) => row.id === transfer.id);
  assert.equal(middle.phaseElapsed, 1);
  assert.equal(middle.moving, true);
  sim.advance(transfer.phaseDuration - 1);
  const end = view(sim), finished = end.autonomy.map.bufferTransfers.find((row) => row.id === transfer.id);
  assert.equal(finished.visible, false);
  assert.equal(finished.progress, 1);
  assert.equal(end.hus.find((hu) => hu.id === transfer.huId).locationId, transfer.robotId);
  assert.ok(finished.motionHistory.some((frame) => frame.visible && frame.phaseElapsed > 0 && frame.phaseElapsed < transfer.phaseDuration));
});

test("transferencias PACK observan descarga y recogida reales sin adelantar su custodia", (t) => {
  const sim = simulation(t);
  sim.command("order.release", { id: "PED-00001" }, OPS);
  const start = until(sim, (state) => state.autonomy.map.bufferTransfers.some((row) => row.visible && row.toStationId === "PACK"));
  const incoming = start.autonomy.map.bufferTransfers.find((row) => row.visible && row.toStationId === "PACK");
  assert.equal(incoming.stage, "HANDOFF_FROM_AMR");
  assert.equal(incoming.phaseElapsed, 0);
  assert.equal(start.hus.find((hu) => hu.id === incoming.huId).locationId, incoming.robotId);
  // A full platform cannot be represented as a completed physical handoff.
  const heldState = structuredClone(start);
  heldState.hus.push(...Array.from({ length: 4 }, (_, index) => ({ id: `TEST-PACK-${index}`, locationId: "PACK", cases: 1 })));
  const before = structuredClone(heldState), held = autonomyMapFrame(heldState).bufferTransfers.find((row) => row.id === incoming.id);
  assert.equal(held.blocked, true); assert.equal(held.moving, false); assert.deepEqual(heldState, before);
  sim.advance(1);
  assert.equal(view(sim).autonomy.map.bufferTransfers.find((row) => row.id === incoming.id).phaseElapsed, 1);
  sim.advance(incoming.phaseDuration - 1);
  const deposited = view(sim), ended = deposited.autonomy.map.bufferTransfers.find((row) => row.id === incoming.id);
  assert.equal(ended.visible, false); assert.equal(ended.progress, 1);
  assert.equal(deposited.hus.find((hu) => hu.id === incoming.huId).locationId, "PACK");
  assert.ok(ended.motionHistory.some((frame) => frame.visible && frame.toStationId === "PACK" && frame.fromRobotId === incoming.robotId));
  const collected = until(sim, (state) => state.autonomy.map.bufferTransfers.some((row) => row.visible && row.fromStationId === "PACK"));
  const outgoing = collected.autonomy.map.bufferTransfers.find((row) => row.visible && row.fromStationId === "PACK");
  assert.equal(outgoing.stage, "HANDOFF_TO_AMR");
  assert.equal(outgoing.phaseDuration, stationTransferSeconds("PACK"));
  assert.equal(collected.hus.find((hu) => hu.id === outgoing.huId).locationId, "PACK");
  sim.advance(outgoing.phaseDuration);
  const loaded = view(sim), carried = loaded.autonomy.map.bufferTransfers.find((row) => row.id === outgoing.id);
  assert.equal(carried.visible, false); assert.equal(carried.progress, 1);
  assert.equal(loaded.hus.find((hu) => hu.id === outgoing.huId).locationId, outgoing.robotId);
});

test("un handoff antiguo reanudado conserva sus dos segundos y no adelanta custodia", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-legacy-handoff-")), filename = join(folder, "test.sqlite");
  let sim = createSimulation({ filename, seed: false });
  t.after(() => { sim.close(); rmSync(folder, { recursive: true, force: true }); });
  purchase(sim);
  const starting = until(sim, (state) => state.autonomy.map.bufferTransfers.some((row) => row.visible));
  const transfer = starting.autonomy.map.bufferTransfers.find((row) => row.visible);
  sim.close();
  const db = createStore(filename), saved = db.read(), mission = saved.missions.find((row) => row.id === transfer.id);
  delete mission.transferDuration; mission.timer = 1;
  db.write(saved); db.close();
  sim = createSimulation({ filename });
  const middle = view(sim).autonomy.map.bufferTransfers.find((row) => row.id === transfer.id);
  assert.equal(middle.phaseDuration, 2); assert.equal(middle.phaseElapsed, 1);
  assert.equal(view(sim).hus.find((hu) => hu.id === transfer.huId).locationId, "RECEIVE");
  sim.command("simulation.pause", { paused: true }, OPS); sim.advance(20);
  assert.equal(view(sim).autonomy.map.bufferTransfers.find((row) => row.id === transfer.id).phaseElapsed, 1);
  sim.command("simulation.pause", { paused: false }, OPS); sim.advance(1);
  assert.equal(view(sim).hus.find((hu) => hu.id === transfer.huId).locationId, transfer.robotId);
});

test("un solo muelle de proveedor conserva propietario y libera la cola sin duplicar cargas", (t) => {
  const sim = simulation(t, { seed: false });
  const first = purchase(sim, 30), second = purchase(sim, 5, "SKU-ACEITE");
  const state = until(sim, (next) => next.autonomy.jobs[0].state === "INSPECTING");
  assert.equal(state.autonomy.map.supplierDock.documentId, first.id);
  const waiting = state.autonomy.jobs.find((job) => job.documentId === second.id);
  assert.equal(waiting.state, "WAITING_DOCK");
  assert.match(waiting.waitingReason, /muelle/);
  assert.equal(state.autonomy.map.loads.filter((load) => load.visible).length, 1);
  const completed = until(sim, (next) => next.autonomy.jobs.every((job) => job.state === "COMPLETED"));
  assert.ok(completed.autonomy.jobs.every((job) => job.inboundDockAcquiredAt && job.inboundDockReleasedAt));
  const [a, b] = completed.autonomy.jobs;
  assert.ok(Date.parse(b.inboundDockAcquiredAt) >= Date.parse(a.inboundDockReleasedAt));
  assert.equal(completed.autonomy.map.supplierDock.occupied, false);
  assert.equal(completed.metrics.warehouseCases, 35);
  assert.equal(sim.movements(OPS, { type: "RECEIPT" }).total, 3);
});

test("una carga retenida bloquea el muelle de proveedor y la siguiente compra no cruza la línea", (t) => {
  const sim = simulation(t, { seed: false });
  sim.command("config.asset.configure", { id: "ASSET-AUTO-ID-IN-1", settings: { autoAssign: false }, expectedRevision: view(sim).configuration.revision }, ADMIN);
  purchase(sim); purchase(sim, 2, "SKU-ACEITE");
  const state = until(sim, (next) => next.autonomy.jobs[0].state === "EXCEPTION");
  sim.advance(40);
  const held = view(sim);
  assert.equal(held.autonomy.map.supplierDock.jobId, state.autonomy.jobs[0].id);
  assert.equal(held.autonomy.map.supplierDock.blocked, true);
  assert.equal(held.autonomy.jobs[1].state, "WAITING_DOCK");
  assert.equal(held.metrics.warehouseCases, 0);
  assert.equal(held.autonomy.map.loads.filter((load) => load.visible).length, 1);
});

test("mapa autónomo respeta permisos; tienda no obtiene anexo ni equipos de otra sucursal", (t) => {
  const sim = simulation(t); purchase(sim);
  assert.equal(sim.snapshot(ADMIN).autonomy.map, null);
  const store = sim.snapshot({ id: "S", role: "store", branchId: "TIENDA-2" });
  assert.equal(store.autonomy.map, null);
  assert.equal(store.layout.automation.annex, undefined);
  assert.equal(store.layout.automation.stations.length, 1);
  assert.equal(store.layout.automation.stations[0].branchId, "TIENDA-2");
  assert.equal(sim.snapshot({ ...OPS, permissions: [] }).autonomy.map, null);
  assert.equal(view(sim).autonomy.map.devices.length, 8);
});

test("célula y recepción de tienda comunican custodia real y progreso acotado", (t) => {
  const sim = simulation(t);
  sim.command("order.release", { id: "PED-00001" }, OPS);
  const packing = until(sim, (state) => state.autonomy.map.devices.some((device) => device.stage === "CASE_PICKING"));
  const cell = packing.autonomy.map.devices.find((device) => device.stage === "CASE_PICKING");
  assert.ok(cell.carryingHuId);
  assert.equal(packing.hus.find((hu) => hu.id === cell.carryingHuId).state, "PACKING");
  assert.ok(cell.phaseDuration > 0 && cell.progress >= 0 && cell.progress <= 1);
  const destination = until(sim, (state) => state.autonomy.map.devices.some((device) => device.stage === "DESTINATION_RECEIVING"));
  const station = destination.autonomy.map.devices.find((device) => device.stage === "DESTINATION_RECEIVING");
  assert.equal(station.branchId, "TIENDA-1");
  assert.ok(station.truckId);
  assert.ok(station.huIds.length > 0);
  assert.ok(station.huIds.every((id) => destination.hus.find((hu) => hu.id === id).locationId === station.truckId));
  assert.equal(destination.metrics.storeCases, 0);
  const done = until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  assert.equal(done.metrics.storeCases, 6);
  assert.ok(done.trucks.every((truck) => truck.state === "AVAILABLE"));
});

test("cada caja reservada consume su ciclo mecánico y el split espera el último ciclo", (t) => {
  const sim = simulation(t);
  sim.command("order.release", { id: "PED-00001" }, OPS);
  const starting = until(sim, (state) => state.autonomy.map.devices.some((device) => device.stage === "CASE_PICKING" && device.phaseElapsed === 0));
  const cell = starting.autonomy.map.devices.find((device) => device.stage === "CASE_PICKING");
  const asset = starting.catalog.assets.find((record) => record.id === cell.assetId);
  const source = starting.hus.find((hu) => hu.id === cell.carryingHuId);
  assert.equal(cell.phaseDuration, cell.cases * asset.settings.caseCycleSeconds);
  sim.advance(cell.phaseDuration - 1);
  const beforeLast = view(sim);
  assert.equal(beforeLast.hus.find((hu) => hu.id === source.id).cases, source.cases);
  assert.equal(beforeLast.autonomy.map.devices.find((device) => device.deviceId === "CASE-PICKER-1").carryingHuId, source.id);
  sim.advance(1);
  const afterLast = view(sim);
  assert.equal(afterLast.hus.find((hu) => hu.id === source.id).cases, source.cases - cell.cases);
  assert.equal(afterLast.hus.filter((hu) => hu.parentId === source.id).reduce((sum, hu) => sum + hu.cases, 0), cell.cases);
});

test("historial efímero conserva destino de preparación aunque un sondeo omita el ciclo entero", (t) => {
  const sim = simulation(t);
  sim.command("order.release", { id: "PED-00001" }, OPS);
  const incoming = until(sim, (state) => state.missions.some((mission) => mission.destinationId === "PACK" && mission.phase === "UNLOADING"));
  const mission = incoming.missions.find((row) => row.destinationId === "PACK" && row.phase === "UNLOADING");
  const cell = incoming.catalog.assets.find((asset) => asset.id === "ASSET-CASE-PICKER-1");
  assert.equal(incoming.hus.find((hu) => hu.id === mission.huId).packContext, undefined);
  sim.advance((mission.transferDuration || 2) + cell.settings.caseCycleSeconds * mission.allocatedCases + 2);
  const after = view(sim), source = after.hus.find((hu) => hu.id === mission.huId);
  assert.equal(source.packContext, undefined);
  const packingFrame = source.motionHistory.find((frame) => frame.state === "PACKING");
  assert.ok(packingFrame);
  assert.equal(packingFrame.packContext.shipmentHuId, mission.shipmentHuId);
  assert.equal(packingFrame.packContext.cases, mission.allocatedCases);
  assert.equal(source.motionHistory.at(-1).packContext, null);
  assert.ok(after.hus.some((hu) => hu.id === packingFrame.packContext.shipmentHuId && hu.parentId === source.id));
  packingFrame.packContext.shipmentHuId = "MUTATED-SNAPSHOT";
  assert.equal(view(sim).hus.find((hu) => hu.id === source.id).motionHistory.find((frame) => frame.state === "PACKING").packContext.shipmentHuId, mission.shipmentHuId);
});

test("un ciclo antiguo en progreso conserva su vencimiento al desplegar la duración por caja", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-map-existing-cycle-")), filename = join(folder, "test.sqlite");
  let sim = createSimulation({ filename });
  t.after(() => { sim.close(); rmSync(folder, { recursive: true, force: true }); });
  sim.command("order.release", { id: "PED-00001" }, OPS);
  const starting = until(sim, (state) => state.autonomy.map.devices.some((device) => device.stage === "CASE_PICKING" && device.phaseElapsed === 1));
  const id = starting.autonomy.map.devices.find((device) => device.stage === "CASE_PICKING").carryingHuId;
  sim.close();
  const db = createStore(filename), old = db.read(), hu = old.hus.find((record) => record.id === id);
  delete hu.casePickingDuration; delete hu.casePickingStartedElapsed;
  hu.casePickingStartedAt = new Date(Date.parse(old.clock.now) - 2000).toISOString();
  hu.packReadyAt = old.clock.elapsed + 3;
  const oldCases = hu.cases, requested = hu.packContext.cases;
  db.write(old); db.close();
  sim = createSimulation({ filename });
  const unchanged = view(sim).hus.find((record) => record.id === id);
  assert.equal(unchanged.packReadyAt, hu.packReadyAt);
  assert.equal(unchanged.casePickingDuration, undefined);
  assert.equal(view(sim).autonomy.map.devices.find((device) => device.deviceId === "CASE-PICKER-1").phaseDuration, 5);
  sim.advance(2);
  assert.equal(view(sim).hus.find((record) => record.id === id).cases, oldCases);
  sim.advance(1);
  assert.equal(view(sim).hus.find((record) => record.id === id).cases, oldCases - requested);
});

test("una pérdida de comunicación durante picking conserva el trabajo restante al reanudar", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-map-hold-"));
  const filename = join(folder, "test.sqlite");
  let sim = createSimulation({ filename });
  t.after(() => { sim.close(); rmSync(folder, { recursive: true, force: true }); });
  sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, (state) => state.autonomy.map.devices.some((device) => device.stage === "CASE_PICKING" && device.phaseElapsed === 1));
  const injectConnection = (online) => {
    sim.close();
    const db = createStore(filename), state = db.read();
    state.autonomyDevices.find((device) => device.id === "CASE-PICKER-1").online = online;
    db.write(state); db.close();
    sim = createSimulation({ filename });
  };
  injectConnection(false);
  sim.advance(1);
  const stopped = view(sim), cell = stopped.autonomy.map.devices.find((device) => device.deviceId === "CASE-PICKER-1");
  assert.equal(cell.blocked, true);
  assert.equal(cell.moving, false);
  sim.advance(30);
  const held = view(sim).autonomy.map.devices.find((device) => device.deviceId === "CASE-PICKER-1");
  assert.equal(held.phaseElapsed, cell.phaseElapsed);
  assert.equal(held.carryingHuId, cell.carryingHuId);
  injectConnection(true);
  const job = view(sim).autonomy.jobs[0];
  sim.command("autonomy.retry", { id: job.id, expectedRevision: job.revision, reason: "Enlace restablecido y célula verificada" }, OPS);
  sim.advance(1);
  const resumed = view(sim).autonomy.map.devices.find((device) => device.deviceId === "CASE-PICKER-1");
  assert.equal(resumed.carryingHuId, cell.carryingHuId);
  assert.equal(resumed.phaseElapsed, cell.phaseElapsed);
  assert.equal(resumed.moving, true);
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  assert.equal(view(sim).metrics.warehouseCases + view(sim).metrics.storeCases, 360);
});
