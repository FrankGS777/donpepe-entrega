"use strict";
// Apply an additive media migration without advancing the simulation clock.
// Requires a fresh verified backup; comparison never prints account secrets.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { createSimulation } = require("../core/engine");
const { autonomyAssetMedia } = require("../core/autonomy-media");
const backup = process.argv[2];
if (!backup || !path.isAbsolute(backup)) throw Error("Se requiere la ruta absoluta del respaldo recién verificado.");
const data = path.resolve(__dirname, "../data");
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function read(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw Error("Base sin integridad: " + path.basename(file));
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name);
    return Object.fromEntries(names.map(name => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]));
  } finally { db.close(); }
}
function equal(a, b, message) { if (digest(a) !== digest(b)) throw Error(message); }
const previousIdentity = read(path.join(backup, "identity.sqlite"));
const previous = read(path.join(backup, "simulation.sqlite"));
equal(read(path.join(data, "identity.sqlite")), previousIdentity, "La identidad cambió desde el respaldo; no se aplicará esta migración.");
equal(read(path.join(data, "simulation.sqlite")), previous, "La operación cambió desde el respaldo; no se aplicará esta migración.");
const expected = JSON.parse(previous.simulation[0].state_json);
const updatedAssets = [];
for (const asset of expected.catalog.assets) {
  const media = autonomyAssetMedia(asset.type);
  if (media && asset.imageUrl === "/images/automation-cell.svg" && asset.imageKind === "TECHNICAL_ILLUSTRATION" && asset.imageScope === "LOGICAL_AUTOMATION_INFRASTRUCTURE" && asset.integrationMode === "SIMULATED") {
    Object.assign(asset, media); updatedAssets.push(asset.id);
  }
}
const simulation = createSimulation({ filename: path.join(data, "simulation.sqlite") });
simulation.close();
const after = read(path.join(data, "simulation.sqlite"));
const state = JSON.parse(after.simulation[0].state_json);
equal(state, expected, "La migración produjo un cambio fuera de los campos de imagen previstos; revisar el respaldo.");
equal(read(path.join(data, "identity.sqlite")), previousIdentity, "La identidad cambió inesperadamente.");
for (const name of Object.keys(previous).filter(name => name !== "simulation")) equal(after[name], previous[name], "Cambió una tabla transaccional: " + name);
const report = {
  ok: true, verifiedAt: new Date().toISOString(), backup,
  scope: "Only seeded autonomous-equipment image fields; no clock advancement",
  updatedAssets, updatedAssetCount: updatedAssets.length,
  accounts: previousIdentity.people.length, accountTablesUnchanged: true,
  entireOperationalStateUnchangedExceptImages: true, transactionalTablesUnchanged: true,
  counts: { products: state.catalog.skus.length, suppliers: state.catalog.suppliers.length,
    assets: state.catalog.assets.length, orders: state.orders.length,
    purchases: state.purchases.length, handlingUnits: state.hus.length,
    autonomousJobs: state.autonomy.jobs.length },
};
const output = path.resolve(__dirname, "../../../DonPepe-Equipos-Media-2026-10-18/preservacion-datos-reales.json");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
