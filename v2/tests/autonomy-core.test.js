"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createHash } = require("node:crypto"),
  { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync } = require("node:fs"),
  { tmpdir } = require("node:os"),
  { join } = require("node:path");
const { createSimulation } = require("../core/engine"),
  { createStore } = require("../core/store");
const { validateTelemetry } = require("../core/autonomy-domain");
const OPS = { id: "O", role: "operations" },
  ADMIN = { id: "A", role: "admin" },
  STORE = { id: "S", role: "store", branchId: "TIENDA-1" };
const view = (sim) => sim.snapshot(OPS);
function setup(t, options = {}) {
  const sim = createSimulation(options);
  t.after(() => sim.close());
  return sim;
}
function order(sim, cases = 3, skuId = "SKU-ARROZ") {
  const sku = view(sim).catalog.skus.find((row) => row.id === skuId);
  return sim.command(
    "purchase.create",
    {
      supplierId: sku.supplierId,
      lines: [{ skuId, cases }],
      commandId: `purchase-${skuId}-${cases}`,
    },
    OPS,
  );
}
function until(sim, condition, limit = 1800) {
  for (let i = 0; i < limit; i++) {
    if (condition(view(sim))) return;
    sim.advance(1);
  }
  assert.fail("El ciclo no alcanzó la condición esperada");
}
function configure(sim, id, settings) {
  return sim.command(
    "config.asset.configure",
    { id, settings, expectedRevision: view(sim).configuration.revision },
    ADMIN,
  );
}
function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-autonomy-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return join(folder, "test.sqlite");
}

test("compra genera ASN y SSCC; exige Auto-ID+PIE y recibe una sola vez antes de almacenar", (t) => {
  const sim = setup(t),
    purchase = order(sim, 30),
    initial = view(sim);
  assert.equal(initial.autonomy.notices.length, 1);
  assert.equal(initial.autonomy.notices[0].loads.length, 2);
  assert.equal(initial.metrics.warehouseCases, 360);
  const identity = initial.autonomy.notices[0].loads.map((row) => ({
    lot: row.lot,
    expiry: row.expiry,
    sscc: row.sscc,
  }));
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  const state = view(sim),
    job = state.autonomy.jobs[0];
  assert.equal(state.metrics.warehouseCases, 390);
  assert.equal(state.purchases[0].state, "RECEIVED");
  assert.equal(job.receiptIds.length, 2);
  assert.equal(state.autonomy.evidence.length, 6);
  assert.ok(
    state.autonomy.evidence.every(
      (row) => row.source === "SIMULATED_DEVICE" && row.decision === "PASS",
    ),
  );
  assert.deepEqual(
    state.autonomy.notices[0].loads.map((row) => ({
      lot: row.lot,
      expiry: row.expiry,
      sscc: row.sscc,
    })),
    identity,
  );
  assert.ok(
    state.hus
      .filter((row) => row.purchaseId === purchase.id)
      .every(
        (row) =>
          row.state === "STORED" &&
          identity.some(
            (item) =>
              item.sscc === row.sscc &&
              item.lot === row.lot &&
              item.expiry === row.expiry,
          ),
      ),
  );
  assert.deepEqual(order(sim, 30), purchase);
  sim.advance(100);
  assert.equal(view(sim).metrics.warehouseCases, 390);
  assert.equal(view(sim).autonomy.notices.length, 1);
  assert.equal(sim.movements(OPS, { type: "RECEIPT", pageSize: 100 }).total, 2);
});
test("autorizar preparación ejecuta carga, reparto, recepción de tienda y retorno sin confirmaciones manuales", (t) => {
  const sim = setup(t);
  sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  const state = view(sim),
    job = state.autonomy.jobs[0],
    receipt = state.autonomy.evidence.find(
      (row) => row.type === "BRANCH_RECEIPT",
    );
  assert.equal(state.orders[0].state, "RECEIVED");
  assert.equal(state.metrics.storeCases, 6);
  assert.ok(state.trucks.every((row) => row.state === "AVAILABLE"));
  assert.equal(receipt.decision, "PASS");
  assert.equal(job.branchReceiptEvidenceId, receipt.id);
  assert.ok(state.events.some((row) => row.type === "AUTONOMY_DISPATCH"));
  assert.ok(
    state.events.some((row) => row.type === "AUTONOMY_BRANCH_RECEIVED"),
  );
  assert.equal(state.metrics.warehouseCases + state.metrics.storeCases, 360);
  for (const command of [
    "order.dispatch",
    "order.receive",
    "purchase.arrive",
    "purchase.inspect",
    "purchase.receive",
  ])
    assert.throws(
      () =>
        sim.command(
          command,
          { id: "PED-00001" },
          command === "order.receive" ? STORE : OPS,
        ),
      { status: 409 },
    );
});
test("sin equipo listo no existe recepción; la corrección se reevalúa conservando excepción e historial", (t) => {
  const sim = setup(t);
  configure(sim, "ASSET-AUTO-ID-IN-1", { autoAssign: false });
  order(sim, 4);
  until(sim, (state) => state.autonomy.jobs[0].state === "EXCEPTION");
  let state = view(sim),
    job = state.autonomy.jobs[0];
  assert.equal(state.metrics.warehouseCases, 360);
  assert.equal(state.autonomy.exceptions[0].code, "EQUIPMENT_NOT_READY");
  const previous = structuredClone(state.autonomy.evidence);
  configure(sim, "ASSET-AUTO-ID-IN-1", { autoAssign: true });
  sim.command(
    "autonomy.retry",
    {
      id: job.id,
      expectedRevision: job.revision,
      reason: "Portal habilitado tras verificar su configuración",
    },
    OPS,
  );
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  state = view(sim);
  assert.equal(state.metrics.warehouseCases, 364);
  assert.equal(state.autonomy.exceptions[0].state, "RESOLVED");
  assert.deepEqual(state.autonomy.evidence.slice(0, previous.length), previous);
  assert.equal(state.autonomy.jobs[0].retryHistory.length, 1);
});
test("configurar una estación reservada espera retirada segura sin atascar el proceso propietario", (t) => {
  const sim = setup(t);
  order(sim);
  until(
    sim,
    (state) =>
      state.autonomyDevices.find((row) => row.id === "AUTO-UNLOADER-IN-1")
        .processId,
  );
  configure(sim, "ASSET-AUTO-UNLOADER-IN-1", { cycleSeconds: 7 });
  assert.ok(
    view(sim).catalog.assets.find(
      (row) => row.id === "ASSET-AUTO-UNLOADER-IN-1",
    ).pendingSettings,
  );
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  const asset = view(sim).catalog.assets.find(
    (row) => row.id === "ASSET-AUTO-UNLOADER-IN-1",
  );
  assert.equal(asset.settings.cycleSeconds, 7);
  assert.equal(asset.pendingSettings, undefined);
});
test("una pausa administrativa impide nuevos ciclos pero no abandona cargas ya autorizadas", (t) => {
  const sim = setup(t);
  order(sim);
  sim.command(
    "config.autonomy.update",
    {
      expectedRevision: view(sim).configuration.revision,
      settings: { enabled: false },
    },
    ADMIN,
  );
  const before = view(sim);
  assert.throws(
    () =>
      sim.command(
        "purchase.create",
        { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] },
        OPS,
      ),
    { status: 409 },
  );
  assert.throws(() => sim.command("order.release", { id: "PED-00001" }, OPS), {
    status: 409,
  });
  assert.equal(view(sim).purchases.length, before.purchases.length);
  assert.deepEqual(view(sim).orders, before.orders);
  assert.deepEqual(view(sim).hus, before.hus);
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  assert.equal(view(sim).metrics.warehouseCases, 363);
});
test("reinicio conserva etapa/evidencias y no duplica recepción, ASN ni kardex", (t) => {
  const filename = fixture(t);
  let sim = createSimulation({ filename });
  order(sim);
  sim.advance(23);
  const before = view(sim);
  sim.close();
  sim = createSimulation({ filename });
  // Witnessed animation frames are ephemeral; business state and the current
  // physical pose must survive, while a restart begins a new render history.
  const withoutFrames = (value) => JSON.parse(JSON.stringify(value, (key, item) => key === "motionHistory" ? undefined : item));
  assert.deepEqual(withoutFrames(view(sim).autonomy), withoutFrames(before.autonomy));
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  const ids = view(sim).autonomy.evidence.map((row) => row.id);
  sim.close();
  sim = createSimulation({ filename });
  sim.advance(100);
  assert.deepEqual(
    view(sim).autonomy.evidence.map((row) => row.id),
    ids,
  );
  assert.equal(view(sim).metrics.warehouseCases, 363);
  assert.equal(sim.movements(OPS, { type: "RECEIPT" }).total, 1);
  sim.close();
});
test("expediente antiguo no entrega automáticamente al desplegar; sólo tras adopción expresa", (t) => {
  const filename = fixture(t);
  let sim = createSimulation({ filename, controlledReceivingFixture: true });
  sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, (state) => state.orders[0].state === "READY");
  sim.command("order.dispatch", { id: "PED-00001" }, OPS);
  until(sim, (state) => state.orders[0].state === "ARRIVED");
  sim.close();
  sim = createSimulation({ filename });
  sim.advance(100);
  let state = view(sim);
  assert.equal(state.metrics.storeCases, 0);
  assert.equal(state.orders[0].state, "ARRIVED");
  assert.equal(state.autonomy.jobs.length, 0);
  assert.equal(
    state.fleetReadModels.find((row) => row.orderId === "PED-00001").nextAction,
    "AUTHORIZE_AUTONOMY",
  );
  assert.throws(
    () =>
      sim.command(
        "autonomy.authorize",
        { kind: "ORDER", id: "PED-00001", expectedRevision: 999 },
        OPS,
      ),
    { status: 409 },
  );
  sim.command(
    "autonomy.authorize",
    {
      kind: "ORDER",
      id: "PED-00001",
      expectedRevision: state.orders[0].revision,
    },
    OPS,
  );
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  assert.equal(view(sim).metrics.storeCases, 6);
  assert.equal(view(sim).autonomy.jobs[0].legacyAdoption, true);
  sim.close();
});
test("error de persistencia revierte evidencias, saldos, kardex y reloj de forma atómica", (t) => {
  const filename = fixture(t),
    sim = setup(t, { filename });
  order(sim);
  sim.advance(23);
  const before = view(sim),
    prior = sim.movements(OPS).total;
  const db = new DatabaseSync(filename);
  db.exec(
    "CREATE TRIGGER autonomy_test_fail BEFORE UPDATE ON simulation BEGIN SELECT RAISE(ABORT,'test atomic failure'); END;",
  );
  assert.throws(() => sim.advance(20), /test atomic failure/);
  assert.deepEqual(view(sim).autonomy, before.autonomy);
  assert.deepEqual(view(sim).clock, before.clock);
  assert.equal(sim.movements(OPS).total, prior);
  db.exec("DROP TRIGGER autonomy_test_fail");
  db.close();
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  assert.equal(view(sim).metrics.warehouseCases, 363);
  assert.equal(sim.movements(OPS, { type: "RECEIPT" }).total, 1);
});
test("reintentos no aceptan motivo vacío, revisión obsoleta ni repetición de proceso activo", (t) => {
  const sim = setup(t);
  const p = order(sim);
  assert.throws(
    () =>
      sim.command("autonomy.authorize", { kind: "PURCHASE", id: p.id }, OPS),
    { status: 409 },
  );
  configure(sim, "ASSET-AUTO-ID-IN-1", { autoAssign: false });
  until(sim, (state) => state.autonomy.jobs[0].state === "EXCEPTION");
  const job = view(sim).autonomy.jobs[0];
  assert.throws(
    () => sim.command("autonomy.retry", { id: job.id, reason: "x" }, OPS),
    { status: 422 },
  );
  assert.throws(
    () =>
      sim.command(
        "autonomy.retry",
        {
          id: job.id,
          reason: "Revisión de control completada",
          expectedRevision: 999,
        },
        OPS,
      ),
    { status: 409 },
  );
  for (const actor of [ADMIN, STORE])
    assert.throws(
      () =>
        sim.command(
          "autonomy.authorize",
          { kind: "PURCHASE", id: p.id },
          actor,
        ),
      { status: 403 },
    );
});
function telemetryFixture(t) {
  const sim = setup(t);
  order(sim, 3, "SKU-YOGUR");
  until(sim, (state) =>
    state.autonomy.evidence.some((row) => row.checkpoint === "PIE"),
  );
  const state = view(sim),
    job = state.autonomy.jobs[0],
    load = state.autonomy.notices[0].loads[0],
    reading = state.autonomy.evidence.find((row) => row.checkpoint === "PIE"),
    asset = state.catalog.assets.find((row) => row.id === reading.assetId);
  return { state, job, load, reading, asset };
}
function modify(f, change) {
  const next = structuredClone(f);
  change(next);
  next.reading.payloadHash = createHash("sha256")
    .update(JSON.stringify(next.reading.payload))
    .digest("hex");
  const index = next.state.autonomy.evidence.findIndex(
    (row) => row.id === next.reading.id,
  );
  next.state.autonomy.evidence[index] = next.reading;
  return validateTelemetry(
    next.state,
    next.job,
    next.load,
    next.reading,
    next.asset,
    "PIE",
  );
}
test("validación Auto-ID/PIE rechaza origen, correlación, tiempo, duplicados e identidad alterada", (t) => {
  const f = telemetryFixture(t);
  assert.deepEqual(
    validateTelemetry(f.state, f.job, f.load, f.reading, f.asset, "PIE"),
    [],
  );
  assert.ok(
    modify(f, (x) => {
      x.reading.source = "UNAUTHENTICATED";
    }).includes("UNTRUSTED_SOURCE"),
  );
  assert.ok(
    modify(f, (x) => {
      x.reading.deviceId = "OTHER";
    }).includes("WRONG_CORRELATION"),
  );
  assert.ok(
    modify(f, (x) => {
      x.reading.observedElapsed -= 121;
    }).includes("STALE_EVENT"),
  );
  assert.ok(
    modify(f, (x) => {
      x.reading.observedAt = "2030-01-01T00:00:00Z";
    }).includes("STALE_EVENT"),
  );
  assert.ok(
    modify(f, (x) => {
      x.state.autonomy.evidence.push(structuredClone(x.reading));
    }).includes("DUPLICATE_EVENT"),
  );
  for (const [key, value] of [
    ["lot", "OTRO"],
    ["skuId", "OTRO"],
    ["barcode", "OTRO"],
    ["cases", 900],
    ["expiry", "2027-01-01"],
    ["sscc", "000000000000000000"],
  ])
    assert.ok(
      modify(f, (x) => {
        x.reading.payload[key] = value;
      }).includes("ASN_MISMATCH"),
    );
});
test("PIE valida temperatura, embalaje, peso/perfil y caducidad; no hace análisis alimentario de laboratorio", (t) => {
  const f = telemetryFixture(t);
  for (const temperatureC of [12, NaN, undefined])
    assert.ok(
      modify(f, (x) => {
        x.reading.payload.temperatureC = temperatureC;
      }).includes("TEMPERATURE_HOLD"),
    );
  for (const field of ["packaging", "pallet", "label"])
    assert.ok(
      modify(f, (x) => {
        x.reading.payload[field] = "DAMAGED";
      }).includes("VISIBLE_QUALITY_HOLD"),
    );
  assert.ok(
    modify(f, (x) => {
      x.reading.payload.profile = null;
    }).includes("MISSING_PHYSICAL_PROFILE"),
  );
  assert.ok(
    modify(f, (x) => {
      x.reading.payload.profile.weightKg *= 1.2;
    }).includes("WEIGHT_MISMATCH"),
  );
  assert.ok(
    modify(f, (x) => {
      x.reading.payload.profile.widthM = 2;
    }).includes("PHYSICAL_ENVELOPE"),
  );
  assert.ok(
    modify(f, (x) => {
      x.load.expiry = "2026-02-30";
      x.reading.payload.expiry = x.load.expiry;
    }).includes("SHELF_LIFE_HOLD"),
  );
  assert.match(f.reading.payload.scope, /NOT_LABORATORY/);
});
test("tienda sólo obtiene procesos y estaciones propios; una revocación de lectura oculta evidencias", (t) => {
  const sim = setup(t);
  order(sim);
  sim.command("order.release", { id: "PED-00001" }, OPS);
  sim.advance(30);
  const own = sim.snapshot(STORE);
  assert.equal(own.autonomy.notices.length, 0);
  assert.ok(
    own.autonomy.jobs.every(
      (row) => row.kind === "ORDER" && row.branchId === STORE.branchId,
    ),
  );
  assert.ok(
    own.autonomyDevices.every((row) => row.branchId === STORE.branchId),
  );
  const noRead = sim.snapshot({ ...OPS, permissions: ["overview.view"] });
  assert.equal(noRead.autonomy.evidence.length, 0);
  assert.equal(noRead.autonomy.jobs.length, 0);
  assert.equal(noRead.autonomyDevices.length, 0);
});
test("veinte llegadas respetan doce plazas y el ritmo físico de descarga sin inventar recepciones", (t) => {
  const sim = setup(t);
  const initialCases = view(sim).metrics.warehouseCases;
  for (let i = 1; i <= 6; i++)
    configure(sim, `ASSET-AMR-${i}`, { autoAssign: false });
  for (let i = 0; i < 20; i++)
    sim.command(
      "purchase.create",
      {
        supplierId: "PROV-1",
        lines: [{ skuId: "SKU-ARROZ", cases: 1 }],
        commandId: `concurrent-${i}`,
      },
      OPS,
    );
  for (let second = 0; second < 200; second++) {
    sim.advance(1);
    const state = view(sim),
      physical = state.hus.filter(
        (row) => row.cases && row.locationId === "RECEIVE",
      ).length,
      reserved = state.autonomy.notices
        .flatMap((row) => row.loads)
        .filter(
          (row) => row.bufferReservation && !row.bufferReservation.releasedAt,
        ).length;
    assert.ok(
      physical + reserved <= 12,
      `Capacidad de recepción excedida: ${physical}+${reserved}`,
    );
    assert.ok(
      state.autonomy.jobs.every((row) => row.state !== "EXCEPTION"),
      "La contención normal de estaciones no debe convertirse en una avería",
    );
  }
  const state = view(sim);
  // The physical discharge cycle and occupied outfeed can admit fewer than
  // twelve loads in 200 seconds, especially with every AMR paused. Capacity
  // is an upper bound, not a promised throughput or a reason to skip a cycle.
  const admitted = state.receipts.reduce((sum, row) => sum + row.totalCases, 0);
  assert.ok(admitted > 0 && admitted <= 12);
  const pending = state.purchases.reduce((sum, row) => sum + row.lines.reduce((n, line) => n + line.cases - line.receivedCases, 0), 0);
  assert.equal(pending, 20 - admitted);
  assert.equal(state.metrics.warehouseCases, initialCases + admitted);
  assert.equal(state.hus.filter(row => row.purchaseId && row.cases > 0).reduce((sum, row) => sum + row.cases, 0), admitted);
});
test("cancelar una compra simulada retenida libera el muelle y el búfer sin incorporar stock", (t) => {
  const sim = setup(t);
  configure(sim, "ASSET-AUTO-ID-IN-1", { autoAssign: false });
  const purchase = order(sim);
  until(sim, state => state.autonomy.jobs[0].state === "EXCEPTION");
  const before = view(sim);
  const pending = before.purchases.find(row => row.id === purchase.id);
  assert(pending.canCancel);
  assert(before.autonomy.notices[0].loads[0].bufferReservation);
  sim.command("purchase.cancel", {
    id: pending.id, expectedRevision: pending.revision, reason: "Cierre de la llegada simulada retenida."
  }, OPS);
  const after = view(sim), job = after.autonomy.jobs[0], load = after.autonomy.notices[0].loads[0];
  assert.equal(after.purchases.find(row => row.id === pending.id).state, "CANCELLED");
  assert.equal(after.autonomy.exceptions[0].state, "RESOLVED");
  assert.equal(after.finance.bills.find(bill => bill.purchaseId === pending.id).status, "CANCELLED");
  assert.equal(job.state, "CANCELLED");
  assert(job.inboundDockReleasedAt);
  assert(load.bufferReservation.releasedAt);
  assert.deepEqual(after.receipts, before.receipts);
  assert.deepEqual(after.hus, before.hus);
});
test("lectura lenta respeta timeout del portal y no cambia una identidad faltante por aceptación", (t) => {
  const sim = setup(t);
  sim.command(
    "config.autonomy.update",
    {
      expectedRevision: view(sim).configuration.revision,
      settings: { identifySeconds: 5 },
    },
    ADMIN,
  );
  configure(sim, "ASSET-AUTO-ID-IN-1", { readTimeoutSeconds: 3 });
  order(sim);
  until(sim, (state) => state.autonomy.jobs[0].state === "EXCEPTION");
  const state = view(sim);
  assert.equal(state.autonomy.exceptions[0].code, "READ_TIMEOUT");
  assert.equal(state.metrics.warehouseCases, 360);
  assert.equal(state.receipts.length, 0);
  assert.equal(
    state.autonomy.notices[0].loads[0].bufferReservation.releasedAt,
    null,
  );
});
test("la separación de cajas exige célula robótica disponible y mantiene carga hasta una reevaluación autorizada", (t) => {
  const sim = setup(t);
  configure(sim, "ASSET-CASE-PICKER-1", { autoAssign: false });
  sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, (state) => state.autonomy.jobs[0].state === "EXCEPTION");
  const held = view(sim),
    job = held.autonomy.jobs[0];
  assert.equal(held.autonomy.exceptions[0].code, "CASE_PICKING_NOT_READY");
  assert.equal(held.metrics.warehouseCases, 360);
  assert.equal(held.metrics.storeCases, 0);
  assert.ok(
    held.hus.some(
      (hu) => hu.state === "PACKING" && hu.packContext.orderId === "PED-00001",
    ),
  );
  configure(sim, "ASSET-CASE-PICKER-1", { autoAssign: true });
  sim.advance(20);
  assert.equal(
    view(sim).autonomy.jobs[0].state,
    "EXCEPTION",
    "habilitar el equipo no suplanta la decisión de reevaluar",
  );
  sim.command(
    "autonomy.retry",
    {
      id: job.id,
      expectedRevision: job.revision,
      reason: "Célula verificada y habilitada para retomar cajas cerradas",
    },
    OPS,
  );
  until(sim, (state) => state.autonomy.jobs[0].state === "COMPLETED");
  const done = view(sim);
  assert.equal(done.metrics.storeCases, 6);
  assert.equal(done.metrics.warehouseCases + done.metrics.storeCases, 360);
  assert.ok(
    done.hus
      .filter((hu) => hu.orderId === "PED-00001")
      .every((hu) => hu.traceLabel?.deviceId === "CASE-PICKER-1"),
  );
});
test("el ciclo mínimo global de descarga no se ignora ante un equipo con ciclo más corto", (t) => {
  const sim = setup(t);
  sim.command(
    "config.autonomy.update",
    {
      expectedRevision: view(sim).configuration.revision,
      settings: { unloadSeconds: 20 },
    },
    ADMIN,
  );
  order(sim);
  until(sim, (state) => state.autonomy.jobs[0].state === "UNLOADING");
  sim.advance(10);
  assert.equal(
    view(sim).autonomy.evidence.filter((row) => row.checkpoint === "UNLOAD")
      .length,
    0,
  );
  until(sim, (state) =>
    state.autonomy.evidence.some((row) => row.checkpoint === "UNLOAD"),
  );
});
