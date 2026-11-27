"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  migrateAutonomyConfiguration,
  autonomyConfigurationCommand,
  autonomyConfigurationReadModel,
  automaticEquipmentReady,
  automaticEquipmentStatus,
  AUTONOMY_ASSET_SCHEMAS,
  AUTONOMY_POLICY_FIELDS,
} = require("../core/autonomy-config");
const {
  migrateDeviceSettings,
  configureDevice,
  tickDeviceSettings,
  DEVICE_SETTING_SCHEMAS,
} = require("../core/device-settings");
const {
  safeToService,
  maintenanceCommand,
  assetCommand,
} = require("../core/equipment-domain");
const {
  assertCommandAllowed,
  effectivePermissions,
} = require("../security/policy");
const ADMIN = { id: "A", role: "admin" },
  OPS = { id: "O", role: "operations" },
  STORE = { id: "S", role: "store", branchId: "TIENDA-1" };
function fixture() {
  const state = {
    clock: { now: "2026-10-18T13:00:00.000Z" },
    configuration: { revision: 7, settings: {} },
    catalog: {
      assets: [
        {
          id: "ASSET-CUSTOM",
          code: "CUSTOM",
          name: "Registro histórico personalizado",
          deviceId: null,
          type: "AMR",
          active: true,
          status: "PLANNED",
          settings: {
            autoAssign: false,
            speedProfile: "ECO",
            allowedTasks: ["RETURN_TO_QUARANTINE"],
            priority: 20,
            chargeBelowPercent: 20,
            resumeAtPercent: 80,
          },
        },
      ],
      branches: [
        { id: "TIENDA-1", name: "San Miguel", active: true },
        { id: "TIENDA-2", name: "Pueblo Libre", active: true },
      ],
    },
    robots: [],
    trucks: [],
    layout: { stations: [], nodes: [] },
    maintenance: [],
    routeLocks: {},
    dockReservations: {},
    missions: [],
    hus: [{ id: "HU-HISTORICAL", cases: 10 }],
    orders: [{ id: "PED-HISTORICAL", state: "ARRIVED" }],
    events: [],
  };
  const context = {
    actor: ADMIN,
    id: (_, prefix) =>
      `${prefix}-${state.maintenance.length + state.catalog.assets.length}`,
    event: (s, type, message, data) =>
      s.events.push({ type, message, ...data }),
    safeToService,
  };
  migrateAutonomyConfiguration(state);
  migrateDeviceSettings(state);
  return { state, context };
}
test("migración aditiva crea infraestructura especializada sin mover mercancía, pedidos ni geometría", () => {
  const { state } = fixture(),
    before = structuredClone(state);
  assert.equal(state.catalog.assets.length, 8);
  assert.equal(state.autonomyDevices.length, 7);
  assert.ok(
    state.catalog.assets
      .slice(1)
      .every(
        (asset) =>
          asset.imageUrl === `/images/representations/equipment-${asset.type.toLowerCase()}.webp` &&
          asset.imageKind === "GENERATED_REPRESENTATION" &&
          asset.imageProvenance.actualDevicePhoto === false,
      ),
  );
  assert.deepEqual(state.hus, [{ id: "HU-HISTORICAL", cases: 10 }]);
  assert.deepEqual(state.orders, [{ id: "PED-HISTORICAL", state: "ARRIVED" }]);
  assert.equal(migrateAutonomyConfiguration(state), false);
  assert.deepEqual(state, before);
  state.catalog.assets[1].name = "Nombre conservado";
  state.catalog.assets[1].active = false;
  state.catalog.assets[1].settings.cycleSeconds = 20;
  assert.equal(migrateAutonomyConfiguration(state), false);
  assert.equal(state.catalog.assets[1].name, "Nombre conservado");
  assert.equal(state.catalog.assets[1].active, false);
  assert.equal(state.catalog.assets[1].settings.cycleSeconds, 20);
  state.catalog.branches.push({
    id: "TIENDA-3",
    name: "Nueva sucursal",
    active: true,
  });
  assert.equal(migrateAutonomyConfiguration(state), true);
  assert.equal(
    state.autonomyDevices.filter((device) => device.branchId === "TIENDA-3")
      .length,
    1,
  );
  assert.deepEqual(state.layout, before.layout);
});
test("configuración valida límites, coherencia temporal y parámetros protegidos antes de mutar", () => {
  const { state, context } = fixture(),
    before = structuredClone(state);
  assert.throws(
    () =>
      autonomyConfigurationCommand(
        state,
        {
          settings: {
            mode: "LIVE",
            disabledInterlocks: true,
            unloadSeconds: 180,
            eventTimeoutSeconds: 30,
            maxAutoRetries: 100,
            weightTolerancePercent: 0,
          },
        },
        ADMIN,
        context,
      ),
    (error) =>
      [
        "mode",
        "disabledInterlocks",
        "eventTimeoutSeconds",
        "maxAutoRetries",
        "weightTolerancePercent",
      ].every((key) => error.fieldErrors[key]),
  );
  assert.deepEqual(state, before);
  for (const actor of [OPS, STORE, { ...ADMIN, permissions: [] }])
    assert.throws(
      () =>
        autonomyConfigurationCommand(
          state,
          { settings: { enabled: false } },
          actor,
          context,
        ),
      { status: 403 },
    );
  autonomyConfigurationCommand(
    state,
    { settings: { enabled: false, unloadSeconds: 15 } },
    ADMIN,
    context,
  );
  assert.equal(state.configuration.autonomy.enabled, false);
  assert.equal(state.configuration.autonomy.mode, "SIMULATED");
  assert.equal(state.configuration.revision, 8);
  assert.equal(state.events.at(-1).type, "AUTONOMY_CONFIGURATION_UPDATED");
  assert.deepEqual(state.hus, before.hus);
  assert.throws(
    () =>
      autonomyConfigurationCommand(
        state,
        { settings: { enabled: false } },
        ADMIN,
        context,
      ),
    { status: 409 },
  );
  assert.ok(
    AUTONOMY_POLICY_FIELDS.every(
      (field) => field.type === "boolean" || Number.isFinite(field.max),
    ),
  );
});
test("readiness requiere comunicación, puesta en servicio, seguridad y disponibilidad, nunca inventa sensores", () => {
  const { state } = fixture(),
    id = "ASSET-AUTO-UNLOADER-IN-1",
    asset = state.catalog.assets.find((row) => row.id === id),
    device = state.autonomyDevices.find((row) => row.id === asset.deviceId);
  assert.equal(automaticEquipmentReady(state, id), true);
  for (const [target, field, value] of [
    [asset, "active", false],
    [asset, "status", "MAINTENANCE"],
    [asset.settings, "commissioned", false],
    [asset.settings, "autoAssign", false],
    [device, "online", false],
    [device, "safetyState", "UNVERIFIED"],
    [device, "faultReason", "Sensor sin evidencia"],
    [device, "state", "FAULT"],
  ]) {
    const prior = target[field];
    target[field] = value;
    assert.equal(automaticEquipmentReady(state, id), false, field);
    assert.ok(automaticEquipmentStatus(state, id).reason);
    if (prior === undefined) delete target[field];
    else target[field] = prior;
  }
  assert.equal(automaticEquipmentReady(state, "NO-DEVICE"), false);
  assert.ok(
    AUTONOMY_ASSET_SCHEMAS.PIE_STATION.capabilities.includes(
      "TEMPERATURE_EVIDENCE",
    ),
  );
  assert.ok(
    AUTONOMY_ASSET_SCHEMAS.AUTO_UNLOADER.requiredInterlocks.includes(
      "VEHICLE_RESTRAINED",
    ),
  );
  assert.equal(
    state.robots.length,
    0,
    "no se convierten AMR en carretillas capaces de entrar a cualquier tráiler",
  );
  Object.assign(device, { state: "RESERVED", processId: "OWNER-JOB" });
  assert.equal(automaticEquipmentReady(state, id), false);
  assert.equal(
    automaticEquipmentStatus(state, id, { processId: "FOREIGN-JOB" }).ready,
    false,
  );
  assert.equal(
    automaticEquipmentStatus(state, id, { processId: "OWNER-JOB" }).ready,
    true,
  );
  const heartbeat = device.heartbeatAt;
  for (const value of [
    null,
    "no-date",
    "2026-10-18T13:00:01.000Z",
    "2026-10-18T12:57:59.999Z",
  ]) {
    device.heartbeatAt = value;
    assert.equal(
      automaticEquipmentStatus(state, id, { processId: "OWNER-JOB" }).ready,
      false,
    );
  }
  device.heartbeatAt = heartbeat;
});
test("cada clase expone únicamente parámetros acotados compatibles con su función", () => {
  const { state, context } = fixture(),
    asset = state.catalog.assets.find((row) => row.id === "ASSET-AUTO-ID-IN-1");
  assert.deepEqual(
    DEVICE_SETTING_SCHEMAS.AUTO_ID_GATE.fields.map((field) => field.key),
    ["autoAssign", "commissioned", "readTimeoutSeconds"],
  );
  assert.throws(
    () =>
      configureDevice(
        state,
        asset,
        {
          settings: {
            safetyState: "VERIFIED",
            skipScan: true,
            readRetries: 4,
            readTimeoutSeconds: 0,
          },
        },
        ADMIN,
        context,
      ),
    (error) =>
      ["safetyState", "skipScan", "readRetries", "readTimeoutSeconds"].every(
        (key) => error.fieldErrors[key],
      ),
  );
  configureDevice(
    state,
    asset,
    { settings: { readTimeoutSeconds: 20 } },
    ADMIN,
    context,
  );
  assert.equal(
    state.autonomyDevices.find((row) => row.id === asset.deviceId)
      .runtimeSettings.readTimeoutSeconds,
    20,
  );
});
test("configuración con proceso activo espera la retirada segura y conserva custodia", () => {
  const { state, context } = fixture(),
    asset = state.catalog.assets.find((row) => row.id === "ASSET-PIE-IN-1"),
    device = state.autonomyDevices.find((row) => row.id === asset.deviceId);
  Object.assign(device, {
    state: "RESERVED",
    processId: "AUTO-PURCHASE-1",
    carryingHuId: "HU-HISTORICAL",
  });
  configureDevice(
    state,
    asset,
    { settings: { autoAssign: false, inspectionSeconds: 15 } },
    ADMIN,
    context,
  );
  assert.equal(asset.pendingSettings.settings.autoAssign, false);
  assert.equal(asset.settings.autoAssign, true);
  assert.equal(safeToService(state, asset), false);
  tickDeviceSettings(state, context);
  assert.equal(device.carryingHuId, "HU-HISTORICAL");
  assert.ok(asset.pendingSettings);
  assert.equal(automaticEquipmentStatus(state, asset.id).ready, false);
  assert.equal(
    automaticEquipmentStatus(state, asset.id, { processId: "AUTO-PURCHASE-1" })
      .ready,
    true,
  );
  assert.equal(
    automaticEquipmentStatus(state, asset.id, { processId: "OTHER-JOB" }).ready,
    false,
  );
  asset.status = "WAITING_SAFE";
  assert.equal(
    automaticEquipmentStatus(state, asset.id, { processId: "AUTO-PURCHASE-1" })
      .ready,
    true,
  );
  device.safetyState = "UNVERIFIED";
  assert.equal(
    automaticEquipmentStatus(state, asset.id, { processId: "AUTO-PURCHASE-1" })
      .ready,
    false,
  );
  device.safetyState = "VERIFIED";
  device.online = false;
  assert.equal(
    automaticEquipmentStatus(state, asset.id, { processId: "AUTO-PURCHASE-1" })
      .ready,
    false,
  );
  device.online = true;
  asset.status = "MAINTENANCE";
  assert.equal(
    automaticEquipmentStatus(state, asset.id, { processId: "AUTO-PURCHASE-1" })
      .ready,
    false,
  );
  asset.status = "AVAILABLE";
  Object.assign(device, { state: "IDLE", processId: null, carryingHuId: null });
  tickDeviceSettings(state, context);
  assert.equal(asset.pendingSettings, undefined);
  assert.equal(asset.settings.inspectionSeconds, 15);
  assert.equal(automaticEquipmentReady(state, asset.id), false);
});
test("mantenimiento de infraestructura fija aplica checklist y espera a terminar el proceso", () => {
  const { state, context } = fixture(),
    asset = state.catalog.assets.find(
      (row) => row.id === "ASSET-INBOUND-CONVEYOR-1",
    ),
    device = state.autonomyDevices.find((row) => row.id === asset.deviceId);
  const result = maintenanceCommand(
    state,
    "request",
    {
      assetId: asset.id,
      reason: "Revisión programada del transportador de entrada",
    },
    OPS,
    context,
  );
  maintenanceCommand(
    state,
    "approve",
    { id: result.id, technician: "Servicio técnico autorizado" },
    ADMIN,
    context,
  );
  assert.ok(state.maintenance[0].checklist.length >= 4);
  Object.assign(device, { state: "RESERVED", processId: "AUTO-1" });
  maintenanceCommand(state, "start", { id: result.id }, ADMIN, context);
  assert.equal(state.maintenance[0].state, "WAITING_SAFE");
  assert.equal(device.processId, "AUTO-1");
  assert.throws(
    () => assetCommand(state, "deactivate", { id: asset.id }, context),
    { status: 409 },
  );
});
test("separación de funciones impide que admin opere, operaciones configure y tienda suplantar recepción", () => {
  for (const type of [
    "autonomy.authorize",
    "autonomy.adopt",
    "autonomy.retry",
    "autonomy.exception.resolve",
  ]) {
    assertCommandAllowed(OPS, type);
    for (const actor of [ADMIN, STORE])
      assert.throws(() => assertCommandAllowed(actor, type), { status: 403 });
  }
  assertCommandAllowed(ADMIN, "config.autonomy.update");
  for (const actor of [OPS, STORE])
    assert.throws(() => assertCommandAllowed(actor, "config.autonomy.update"), {
      status: 403,
    });
  assert.equal(
    effectivePermissions("store", [
      "config.autonomy.manage",
      "autonomy.authorize",
    ]).length,
    0,
  );
  const { state } = fixture(),
    own = autonomyConfigurationReadModel(state, STORE);
  assert.equal(own.assets.length, 1);
  assert.equal(own.assets[0].branchId, STORE.branchId);
  assert.equal(own.canConfigure, false);
  assert.deepEqual(own.fields, []);
  assert.equal(
    autonomyConfigurationReadModel(state, { ...STORE, permissions: [] }),
    null,
  );
});
