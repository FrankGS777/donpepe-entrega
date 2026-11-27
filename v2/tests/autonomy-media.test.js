"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AUTONOMY_MEDIA_TYPES,
  autonomyAssetMedia,
  migrateSeededAutonomyMedia,
} = require("../core/autonomy-media");
const {
  migrateAutonomyConfiguration,
  autonomyConfigurationReadModel,
} = require("../core/autonomy-config");
const { assetCommand } = require("../core/equipment-domain");

const ADMIN = { id: "ADMIN", role: "admin" };
function fixture() {
  return {
    clock: { now: "2026-10-18T15:00:00.000Z" },
    catalog: { assets: [], branches: [
      { id: "TIENDA-1", name: "San Miguel" },
      { id: "TIENDA-2", name: "Pueblo Libre" },
      { id: "TIENDA-3", name: "Jesús María" },
    ] },
    hus: [{ id: "HU-PRESERVE", cases: 12, lot: "LOTE-ORIGINAL" }],
    orders: [{ id: "PED-PRESERVE", state: "DISPATCHED" }],
    purchases: [{ id: "OC-PRESERVE", state: "PARTIAL" }],
    ledger: [{ id: "MOV-PRESERVE", cases: 12 }],
    robots: [], trucks: [], maintenance: [],
    layout: { stations: [] },
  };
}
function placeholder(asset) {
  asset.imageUrl = "/images/automation-cell.svg";
  asset.imageKind = "TECHNICAL_ILLUSTRATION";
  asset.imageScope = "LOGICAL_AUTOMATION_INFRASTRUCTURE";
  delete asset.imageProvenance;
  return asset;
}

test("seis recursos especializados abastecen ocho activos, con alcance de clase y sin afirmar fotografía OEM", () => {
  const state = fixture();
  assert.equal(migrateAutonomyConfiguration(state), true);
  assert.equal(state.catalog.assets.length, 8);
  assert.equal(new Set(state.catalog.assets.map(row => row.imageUrl)).size, 6);
  for (const asset of state.catalog.assets) {
    const media = autonomyAssetMedia(asset.type);
    assert.deepEqual(Object.fromEntries(Object.keys(media).map(key => [key, asset[key]])), media);
    assert.equal(asset.imageKind, "GENERATED_REPRESENTATION");
    assert.equal(asset.imageProvenance.actualDevicePhoto, false);
    assert.equal(asset.integrationMode, "SIMULATED");
    assert.notEqual(asset.imageUrl, "/images/automation-cell.svg");
  }
  assert.equal(AUTONOMY_MEDIA_TYPES.length, 6);
  assert.equal(autonomyAssetMedia("AMR"), null);
});

test("migración sustituye sólo placeholder sembrado; conserva configuración, transacciones, custodia y revisiones", () => {
  const state = fixture();
  migrateAutonomyConfiguration(state);
  for (const asset of state.catalog.assets) {
    placeholder(asset);
    asset.name += " · personalizado";
    asset.status = "WAITING_SAFE";
    asset.active = false;
    asset.serviceHours = 38.21;
    asset.pendingSettings = { autoAssign: false };
    asset.settingsRevision = 9;
    asset.updatedAt = "2026-10-18T14:00:00.000Z";
    asset.settings = { ...asset.settings, autoAssign: false };
  }
  state.configuration.revision = 41;
  state.autonomyDevices[0].state = "RESERVED";
  state.autonomyDevices[0].processId = "JOB-EXISTING";
  state.autonomyDevices[0].carryingHuId = "HU-PRESERVE";
  const before = structuredClone(state);
  assert.equal(migrateAutonomyConfiguration(state), true);
  const expected = structuredClone(before);
  expected.catalog.assets.forEach(asset => Object.assign(asset, autonomyAssetMedia(asset.type)));
  assert.deepEqual(state, expected);
  const upgraded = structuredClone(state);
  assert.equal(migrateAutonomyConfiguration(state), false);
  assert.deepEqual(state, upgraded);
});

test("fotos propias, decisiones de biblioteca y registros no sembrados no se sobrescriben", () => {
  const state = fixture();
  migrateAutonomyConfiguration(state);
  const choices = [
    { imageUrl: `/images/catalog/uploads/${"a".repeat(64)}.png`, imageKind: "USER_IMAGE" },
    { imageUrl: "/images/representations/custom-machine.webp" },
    { imageUrl: "/images/automation-cell.svg", imageKind: "USER_IMAGE" },
    { imageUrl: "/images/automation-cell.svg", imageScope: "USER_CHOSEN" },
    { imageUrl: "/images/automation-cell.svg", integrationMode: "EXTERNAL" },
  ];
  for (const [index, choice] of choices.entries()) Object.assign(placeholder(state.catalog.assets[index]), choice);
  const unrelated = placeholder({
    id: "USER-CELL", code: "USER-CELL", type: "AUTO_ID_GATE", integrationMode: "SIMULATED",
    name: "Equipo planificado por el usuario", deviceId: null,
  });
  state.catalog.assets.push(unrelated);
  const before = structuredClone(state.catalog.assets);
  migrateAutonomyConfiguration(state);
  assert.deepEqual(state.catalog.assets.slice(0, choices.length), before.slice(0, choices.length));
  assert.deepEqual(state.catalog.assets.at(-1), before.at(-1));
  assert.equal(migrateSeededAutonomyMedia(placeholder({ type: "AMR", integrationMode: "SIMULATED" }), "AUTO_ID_GATE"), false);
});

test("readmodel entrega recurso completo y procedencia, limitado a la estación de la tienda", () => {
  const state = fixture();
  migrateAutonomyConfiguration(state);
  const admin = autonomyConfigurationReadModel(state, ADMIN);
  assert.equal(admin.assets.length, 8);
  assert.ok(admin.assets.every(asset => asset.imageUrl && asset.imageScope && asset.imageProvenance.actualDevicePhoto === false));
  const own = autonomyConfigurationReadModel(state, { id: "S", role: "store", branchId: "TIENDA-2" });
  assert.equal(own.assets.length, 1);
  assert.equal(own.assets[0].branchId, "TIENDA-2");
  assert.equal(own.assets[0].imageUrl, autonomyAssetMedia("STORE_RECEIVING_STATION").imageUrl);
  own.assets[0].imageProvenance.resourceVersion = 500;
  assert.equal(state.catalog.assets.find(asset => asset.branchId === "TIENDA-2").imageProvenance.resourceVersion, 1);
});

test("alta planificada utiliza foto de su clase y edición de imagen no conserva procedencia generada incorrecta", () => {
  const state = fixture();
  migrateAutonomyConfiguration(state);
  const context = { actor: ADMIN, id: () => "EQUIPO-CUSTOM" };
  const data = {
    code: "AUTO-ID-PLAN", name: "Portal planificado", type: "AUTO_ID_GATE",
    manufacturer: "Integración DonPepe", model: "Lector previsto", serialNumber: "SERIE-NEW-123",
    commissionDate: "2026-10-18", serviceIntervalHours: 250,
    capacityCases: 24, capacityKg: 1500, temperatureClass: "AMBIENT",
  };
  const id = assetCommand(state, "create", { data }, context);
  const asset = state.catalog.assets.find(row => row.id === id);
  assert.equal(asset.imageUrl, autonomyAssetMedia(data.type).imageUrl);
  assert.equal(asset.imageKind, "GENERATED_REPRESENTATION");
  assert.equal(asset.status, "PLANNED");
  assert.equal(asset.deviceId, null);
  assetCommand(state, "update", { id, data: { imageUrl: "/images/catalog/uploads/my-device.webp" } }, context);
  assert.equal(asset.imageUrl, "/images/catalog/uploads/my-device.webp");
  assert.equal(asset.imageKind, "USER_IMAGE");
  assert.equal(asset.imageProvenance, null);
  assetCommand(state, "update", { id, data: { imageUrl: autonomyAssetMedia(data.type).imageUrl } }, context);
  assert.equal(asset.imageKind, "GENERATED_REPRESENTATION");
  assert.equal(asset.imageProvenance.actualDevicePhoto, false);
});
