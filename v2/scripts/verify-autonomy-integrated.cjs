"use strict";

// Diagnostic journeys use only in-memory stores and freshly created temporary
// databases. They never connect to the running service or open v2/data.
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { resolve, join } = require("node:path");
const { execFileSync } = require("node:child_process");
const { createSimulation } = require("../core/engine");
const { createStore } = require("../core/store");

const OPS = { id: "QA-OPERATIONS", role: "operations" };
const ADMIN = { id: "QA-ADMIN", role: "admin" };
const STORE = { id: "QA-STORE", role: "store", branchId: "TIENDA-1" };
const output = resolve(__dirname, "../../../DonPepe-Autonomia-2026-10-18/validacion-integral-recursos.json");
const temporary = mkdtempSync(join(tmpdir(), "donpepe-integrated-autonomy-"));
const report = {
  generatedAt: new Date().toISOString(),
  scope: "SIMULATED_LOGIC_ONLY_NOT_CONNECTED_PHYSICAL_HARDWARE",
  actualDatabaseAccess: false,
  fixtureModes: [],
  mapOrAnimationChanges: false,
  temporaryDirectory: temporary,
  cases: [],
  sourceFiles: ["v2/core/autonomy-domain.js", "v2/core/autonomy-config.js", "v2/core/engine.js", "v2/core/device-settings.js", "v2/core/store.js", "v2/tests/autonomy-core.test.js"],
  unresolvedBoundaries: [
    { area: "FAILED_INBOUND_DISPOSITION", missing: "Terminal rejection/return-to-supplier custody flow for loads never accepted into inventory. Retry is not disposal and does not release an unresolved physical load." },
    { area: "REVERSE_LOGISTICS_EVIDENCE", missing: "Existing store-return states and quarantine do not yet share the new autonomous Auto-ID/custody evidence contract end to end." },
    { area: "EXTERNAL_DEVICE_INTEGRATION", missing: "Per-device authenticated ingestion, edge gateway, command acknowledgments, durable distributed queues, certificate lifecycle and commissioning against a real manufacturer's interface." },
    { area: "FAILURE_RECOVERY", missing: "Configured/manual simulation recovery is not a machine repair, certified safety reset, or proof of an autonomous recovery on real equipment." },
  ],
};
const view = sim => sim.snapshot(OPS);
const terminal = state => ["COMPLETED", "CANCELLED"].includes(state);
const physical = s => s.hus.reduce((sum, hu) => sum + hu.cases, 0) + s.storeStock.reduce((sum, row) => sum + row.cases, 0) + s.returns.filter(row => row.state !== "QUARANTINED").reduce((sum, row) => sum + row.cases, 0);
function drive(sim, condition, collect = () => {}, limit = 2400) {
  for (let second = 0; second < limit; second++) {
    const state = view(sim);
    collect(state);
    if (condition(state)) return state;
    sim.advance(1);
  }
  throw new Error("The journey did not reach its expected state within its simulated time bound.");
}
function purchase(sim, skuId, cases, commandId) {
  const sku = view(sim).catalog.skus.find(row => row.id === skuId);
  return sim.command("purchase.create", { supplierId: sku.supplierId, lines: [{ skuId, cases }], commandId }, OPS);
}
function configure(sim, id, settings) {
  return sim.command("config.asset.configure", { id, settings, expectedRevision: view(sim).configuration.revision }, ADMIN);
}
function settle(sim) {
  return drive(sim, s => s.missions.every(row => terminal(row.state)) && s.trucks.every(row => row.state === "AVAILABLE") && s.robots.every(row => !row.missionId && !row.carryingHuId) && s.autonomyDevices.every(row => !row.processId && !row.carryingHuId));
}
function mutateTemporary(filename, mutation) {
  assert.ok(filename.startsWith(temporary + "/"), "Only this diagnostic's own temporary database may be changed.");
  const store = createStore(filename);
  try { store.transaction(() => { const state = store.read(); mutation(state); store.write(state); }); } finally { store.close(); }
}
function run(name, task) {
  try { report.cases.push({ name, passed: true, ...task() }); }
  catch (error) { report.cases.push({ name, passed: false, error: error.stack || String(error) }); process.exitCode = 1; }
  process.stdout.write(`${name}: ${report.cases.at(-1).passed ? "PASS" : "FAIL"}\n`);
}

run("fresh_empty_warehouse_purchase_to_store_delivery_and_resource_release", () => {
  const sim = createSimulation({ seed: false });
  try {
    assert.equal(view(sim).metrics.warehouseCases, 0);
    assert.equal(view(sim).orders.length, 0);
    const purchases = [purchase(sim, "SKU-ARROZ", 12, "integrated-rice"), purchase(sim, "SKU-YOGUR", 8, "integrated-yogurt"), purchase(sim, "SKU-HELADO", 6, "integrated-frozen")];
    const timeline = [], signatures = new Set(), stageSets = new Map(), missionTypes = new Set(), truckStates = new Set(), loadPhases = new Set();
    const capture = state => {
      assert.equal(physical(state), state.ledger.initialCases + state.ledger.receivedCases - state.ledger.consumedCases - state.ledger.writtenOffCases);
      for (const job of state.autonomy.jobs) {
        if (!stageSets.has(job.id)) stageSets.set(job.id, new Set());
        stageSets.get(job.id).add(job.state);
        const signature = `${job.id}:${job.state}`;
        if (!signatures.has(signature)) { signatures.add(signature); timeline.push({ elapsed: state.clock.elapsed, jobId: job.id, documentId: job.documentId, kind: job.kind, state: job.state }); }
      }
      for (const mission of state.missions) missionTypes.add(mission.kind);
      for (const truck of state.trucks) { truckStates.add(truck.state); if (truck.loadingState) loadPhases.add(truck.loadingState); }
    };
    drive(sim, s => s.autonomy.jobs.length === 3 && s.autonomy.jobs.every(row => row.state === "COMPLETED"), capture);
    let state = view(sim);
    assert.equal(state.metrics.warehouseCases, 26);
    assert.ok(state.hus.every(hu => hu.state === "STORED" && hu.purchaseId));
    const order = sim.command("order.create", { commandId: "integrated-store-request", lines: [{ skuId: "SKU-ARROZ", cases: 6 }, { skuId: "SKU-YOGUR", cases: 4 }, { skuId: "SKU-HELADO", cases: 3 }] }, STORE);
    assert.equal(view(sim).storeStock.length, 0);
    const releasePayload = { id: order.id, commandId: "integrated-release" };
    const released = sim.command("order.release", releasePayload, OPS);
    assert.deepEqual(sim.command("order.release", releasePayload, OPS), released);
    drive(sim, s => s.autonomy.jobs.some(job => job.documentId === order.id && job.state === "COMPLETED"), capture);
    state = settle(sim); capture(state);
    const orderJob = state.autonomy.jobs.find(job => job.documentId === order.id && job.kind === "ORDER");
    assert.equal(state.orders.find(row => row.id === order.id).state, "RECEIVED");
    assert.equal(state.metrics.warehouseCases, 13);
    assert.equal(state.metrics.storeCases, 13);
    assert.equal(physical(state), 26);
    assert.equal(state.autonomy.jobs.length, 4);
    assert.equal(state.autonomy.exceptions.length, 0);
    assert.equal(state.receipts.length, 3);
    assert.equal(sim.movements(OPS, { type: "RECEIPT", pageSize: 100 }).total, 3);
    assert.equal(state.autonomy.notices.length, 3);
    assert.ok(state.autonomy.evidence.every(row => row.source === "SIMULATED_DEVICE" && row.decision === "PASS"));
    assert.ok(orderJob.branchReceiptEvidenceId);
    assert.ok(state.hus.filter(hu => hu.orderId === order.id).every(hu => hu.traceLabel?.deviceId === "CASE-PICKER-1"));
    const orderStages = [...stageSets.get(orderJob.id)];
    for (const required of ["PREPARING", "LOADING", "TRANSPORTING", "DESTINATION_RECEIVING", "RETURNING", "COMPLETED"]) assert.ok(orderStages.includes(required), `Missing order stage ${required}`);
    assert.ok(state.events.some(row => row.type === "AUTONOMY_DISPATCH" && row.orderId === order.id));
    for (const job of state.autonomy.jobs.filter(job => job.kind === "PURCHASE")) for (const required of ["WAITING_ARRIVAL", "UNLOADING", "IDENTIFYING", "INSPECTING", "RECEIVING", "PUTAWAY", "COMPLETED"]) assert.ok(stageSets.get(job.id).has(required), `Missing inbound stage ${required}`);
    const seenPurchaseIds = new Set(purchases.map(row => row.id));
    assert.ok(state.storeStock.every(row => seenPurchaseIds.has(state.hus.find(hu => hu.id === row.huId)?.purchaseId) || row.lot.startsWith("FAB-")));
    return { seed: false, purchasedCases: 26, deliveredCases: 13, warehouseCases: 13, conservationZones: ["DRY", "COLD", "FROZEN"], purchaseCount: purchases.length, orderId: order.id, receiptCount: state.receipts.length, evidenceCount: state.autonomy.evidence.length, evidenceSources: [...new Set(state.autonomy.evidence.map(row => row.source))], activeJobs: state.autonomy.jobs.filter(row => !terminal(row.state)).length, activeMissions: state.missions.filter(row => !terminal(row.state)).length, heldDeviceCount: state.autonomyDevices.filter(row => row.processId || row.carryingHuId).length, heldRobotCount: state.robots.filter(row => row.missionId || row.carryingHuId).length, trucks: state.trucks.map(({ id, state, orderId, returnId }) => ({ id, state, orderId, returnId })), missionTypes: [...missionTypes], truckStates: [...truckStates], loadPhases: [...loadPhases], transientStateNote: "WAITING_DISPATCH may transition to LOADING within one tick when compatible resources are already available; dispatch evidence is asserted independently.", timeline };
  } finally { sim.close(); }
});

run("offline_auto_id_does_not_heal_by_clock_or_create_stock_and_requires_corrected_retry", () => {
  const filename = join(temporary, "offline.sqlite");
  let sim = createSimulation({ filename, seed: false }); sim.close();
  mutateTemporary(filename, s => { s.autonomyDevices.find(row => row.id === "AUTO-ID-IN-1").online = false; });
  sim = createSimulation({ filename });
  let job, beforeEvidence, heartbeat;
  try {
    purchase(sim, "SKU-ARROZ", 4, "offline-inbound");
    const held = drive(sim, s => s.autonomy.jobs[0].state === "EXCEPTION");
    job = held.autonomy.jobs[0]; beforeEvidence = held.autonomy.evidence; heartbeat = held.autonomyDevices.find(row => row.id === "AUTO-ID-IN-1").heartbeatAt;
    assert.equal(held.metrics.warehouseCases, 0);
    assert.equal(held.receipts.length, 0);
    assert.equal(held.autonomy.exceptions[0].code, "EQUIPMENT_NOT_READY");
    sim.advance(200);
    assert.equal(view(sim).autonomyDevices.find(row => row.id === "AUTO-ID-IN-1").online, false);
    assert.equal(view(sim).autonomyDevices.find(row => row.id === "AUTO-ID-IN-1").heartbeatAt, heartbeat);
    assert.equal(view(sim).autonomy.jobs[0].state, "EXCEPTION");
    assert.equal(view(sim).autonomy.notices[0].loads[0].bufferReservation.releasedAt, null);
  } finally { sim.close(); }
  mutateTemporary(filename, s => { const device = s.autonomyDevices.find(row => row.id === "AUTO-ID-IN-1"); device.online = true; device.heartbeatAt = s.clock.now; });
  sim = createSimulation({ filename });
  try {
    sim.advance(10);
    assert.equal(view(sim).autonomy.jobs[0].state, "EXCEPTION");
    sim.command("autonomy.retry", { id: job.id, expectedRevision: job.revision, reason: "Pasarela de prueba restablecida y comunicación comprobada" }, OPS);
    const done = drive(sim, s => s.autonomy.jobs[0].state === "COMPLETED");
    assert.equal(done.metrics.warehouseCases, 4);
    assert.equal(done.receipts.length, 1);
    assert.deepEqual(done.autonomy.evidence.slice(0, beforeEvidence.length), beforeEvidence);
    return { stockWhileOffline: 0, originalEvidencePreserved: true, clockDidNotHealOfflineDevice: true, reserveRetainedDuringFailure: true, explicitRetryRequired: true, recoveryMethod: "TEST_FIXTURE_RESTORED_SIMULATED_COMMUNICATION_NOT_A_REAL_DEVICE_REPAIR", finalCases: 4, finalReceiptCount: 1 };
  } finally { sim.close(); }
});

run("robot_fault_preserves_mission_and_load_before_authorized_simulated_recovery", () => {
  const sim = createSimulation({ seed: false });
  try {
    purchase(sim, "SKU-ARROZ", 5, "robot-custody");
    const moving = drive(sim, s => s.robots.some(row => row.type === "AMR" && row.carryingHuId));
    const robot = moving.robots.find(row => row.type === "AMR" && row.carryingHuId);
    sim.command("equipment.fault", { id: robot.id, reason: "Incidencia de diagnóstico para verificar custodia de carga" }, OPS);
    sim.advance(30);
    const held = view(sim), stopped = held.robots.find(row => row.id === robot.id);
    assert.equal(stopped.state, "FAULT");
    assert.equal(stopped.carryingHuId, robot.carryingHuId);
    assert.equal(stopped.missionId, robot.missionId);
    assert.equal(physical(held), 5);
    assert.ok(!held.missions.some(row => row.huId === robot.carryingHuId && row.robotId && row.robotId !== robot.id));
    sim.command("equipment.recover", { id: robot.id }, OPS);
    drive(sim, s => s.autonomy.jobs[0].state === "COMPLETED");
    const done = settle(sim);
    assert.equal(done.metrics.warehouseCases, 5);
    assert.equal(done.receipts.length, 1);
    return { robotId: robot.id, huId: robot.carryingHuId, missionId: robot.missionId, physicalCasesDuringFault: 5, custodyPreserved: true, duplicatedAssignment: false, recoveryMethod: "OPERATIONS_SIMULATION_RECOVER_COMMAND_NOT_CERTIFIED_PHYSICAL_RESET", finalState: done.autonomy.jobs[0].state };
  } finally { sim.close(); }
});

run("restart_during_inbound_and_truck_loading_preserves_custody_and_exactly_one_receipt", () => {
  const filename = join(temporary, "restart.sqlite");
  let sim = createSimulation({ filename, seed: false });
  purchase(sim, "SKU-ARROZ", 10, "restart-inbound");
  drive(sim, s => s.autonomy.jobs[0].state === "INSPECTING");
  const before = view(sim); sim.close();
  sim = createSimulation({ filename });
  try {
    assert.deepEqual(view(sim).autonomy, before.autonomy);
    drive(sim, s => s.autonomy.jobs[0].state === "COMPLETED");
    const order = sim.command("order.create", { commandId: "restart-order", lines: [{ skuId: "SKU-ARROZ", cases: 5 }] }, STORE);
    sim.command("order.release", { id: order.id, commandId: "restart-release" }, OPS);
    drive(sim, s => s.orders.find(row => row.id === order.id).state === "LOADING");
    const loading = view(sim); sim.close(); sim = createSimulation({ filename });
    const reopened = view(sim);
    assert.deepEqual(reopened.autonomy, loading.autonomy);
    const persistedTrucks = rows => rows.map(({ motionHistory, ...persisted }) => persisted);
    assert.deepEqual(persistedTrucks(reopened.trucks), persistedTrucks(loading.trucks));
    assert.deepEqual(reopened.missions, loading.missions);
    drive(sim, s => s.autonomy.jobs.find(row => row.kind === "ORDER").state === "COMPLETED");
    let done = settle(sim);
    const evidenceIds = done.autonomy.evidence.map(row => row.id), receiptCount = done.receipts.length, movementCount = sim.movements(OPS).total;
    sim.close(); sim = createSimulation({ filename }); sim.advance(20); done = view(sim);
    assert.equal(done.metrics.storeCases, 5); assert.equal(done.metrics.warehouseCases, 5);
    assert.equal(done.receipts.length, receiptCount); assert.equal(receiptCount, 1);
    assert.deepEqual(done.autonomy.evidence.map(row => row.id), evidenceIds);
    assert.equal(sim.movements(OPS).total, movementCount);
    assert.ok(done.trucks.every(row => row.state === "AVAILABLE"));
    return { restartPoints: [before.autonomy.jobs[0].state, loading.autonomy.jobs.find(row => row.kind === "ORDER").state, "COMPLETED"], stageAndCustodyPreserved: true, evidencePreservedWithoutDuplication: true, receiptCount, storeCases: 5, warehouseCases: 5, allTrucksAvailable: true, database: "NEW_TEMPORARY_SQLITE_ONLY" };
  } finally { sim.close(); }
});

run("twenty_arrivals_respect_twelve_buffer_positions_then_resume_after_transport_capacity_returns", () => {
  const sim = createSimulation({ seed: false });
  try {
    for (let n = 1; n <= 6; n++) configure(sim, `ASSET-AMR-${n}`, { autoAssign: false });
    for (let n = 0; n < 20; n++) purchase(sim, "SKU-ARROZ", 1, `buffer-${n}`);
    let peak = 0;
    for (let second = 0; second < 200; second++) {
      sim.advance(1); const state = view(sim);
      const physicalOccupancy = state.hus.filter(row => row.cases && row.locationId === "RECEIVE").length;
      const reservedOccupancy = state.autonomy.notices.flatMap(row => row.loads).filter(row => row.bufferReservation && !row.bufferReservation.releasedAt).length;
      peak = Math.max(peak, physicalOccupancy + reservedOccupancy);
      assert.ok(physicalOccupancy + reservedOccupancy <= 12);
      assert.equal(state.autonomy.exceptions.length, 0);
    }
    const waiting = view(sim);
    assert.equal(waiting.receipts.length, 12);
    assert.equal(waiting.autonomy.notices.flatMap(row => row.loads).filter(row => row.state === "DECLARED").length, 8);
    for (let n = 1; n <= 6; n++) configure(sim, `ASSET-AMR-${n}`, { autoAssign: true });
    drive(sim, s => s.autonomy.jobs.every(row => row.state === "COMPLETED"));
    const done = settle(sim);
    assert.equal(done.metrics.warehouseCases, 20); assert.equal(done.receipts.length, 20);
    assert.ok(done.hus.every(row => row.state === "STORED"));
    assert.ok(done.autonomy.notices.flatMap(row => row.loads).every(row => row.bufferReservation.releasedAt));
    return { arrivalCount: 20, bufferCapacity: 12, peakPhysicalPlusReserved: peak, acceptedWhileBlocked: 12, retainedInSupplierVehicle: 8, exceptionsFromNormalContention: 0, finalReceiptCount: 20, finalStoredCases: 20, leakedReservations: 0 };
  } finally { sim.close(); }
});

run("existing_autonomy_and_device_settings_regressions", () => {
  const tests = ["v2/tests/autonomy-core.test.js", "v2/tests/autonomy-config.test.js", "v2/tests/autonomy-grants.test.js", "v2/tests/autonomy-api.test.js", "v2/tests/device-settings.test.js"];
  const result = execFileSync(process.execPath, ["--test", "--test-reporter=tap", ...tests], { cwd: resolve(__dirname, "../.."), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  const count = key => Number(result.match(new RegExp(`^# ${key} (\\d+)$`, "m"))?.[1] || 0);
  assert.equal(count("fail"), 0); assert.ok(count("pass") > 0);
  return { testFiles: tests, tests: count("tests"), passedTests: count("pass"), failedTests: count("fail"), notes: "These existing tests also cover timeout, invalid telemetry/temperature/expiry/profile, roles, idempotency, persistence rollback, safe pending settings and explicit legacy adoption." };
});

report.passed = report.cases.every(row => row.passed);
report.completedAt = new Date().toISOString();
mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify({ passed: report.passed, cases: report.cases.map(({ name, passed, error }) => ({ name, passed, error })), report: output }, null, 2) + "\n");
