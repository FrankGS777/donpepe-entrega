"use strict";
// Offline, additive installation with a full-state preflight on a private copy.
// Never advances the business clock or replays a mission to populate the map.
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { createSimulation } = require("../core/engine");
const { migrateAutomationBlueprint } = require("../core/automation-blueprint");
const backup = process.argv[2];
if (!backup || !path.isAbsolute(backup)) throw Error("Indica un respaldo absoluto y verificado con el servicio detenido.");
const data = path.resolve(__dirname, "../data");
function read(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
    return Object.fromEntries(tables.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '" ORDER BY rowid').all()]));
  } finally { db.close(); }
}
function verify(tables, expected, previous) {
  assert.deepEqual(JSON.parse(tables.simulation[0].state_json), expected, "El estado cambió fuera de la ampliación física prevista");
  for (const name of Object.keys(previous).filter(name => name !== "simulation"))
    assert.deepEqual(tables[name], previous[name], `Cambió la tabla transaccional ${name}`);
}
const previous = read(path.join(backup, "simulation.sqlite"));
const identity = read(path.join(backup, "identity.sqlite"));
assert.deepEqual(read(path.join(data, "simulation.sqlite")), previous, "La operación cambió desde el respaldo; detén el servicio y crea un respaldo nuevo");
assert.deepEqual(read(path.join(data, "identity.sqlite")), identity, "Las cuentas cambiaron desde el respaldo");
const expected = JSON.parse(previous.simulation[0].state_json);
migrateAutomationBlueprint(expected);
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-map-preflight-"));
fs.chmodSync(temporary, 0o700);
const copy = path.join(temporary, "simulation.sqlite");
fs.copyFileSync(path.join(backup, "simulation.sqlite"), copy); fs.chmodSync(copy, 0o600);
try {
  createSimulation({ filename: copy }).close();
  verify(read(copy), expected, previous);
  // Recheck immediately before applying the same already-verified migration.
  assert.deepEqual(read(path.join(data, "simulation.sqlite")), previous);
  createSimulation({ filename: path.join(data, "simulation.sqlite") }).close();
  verify(read(path.join(data, "simulation.sqlite")), expected, previous);
  assert.deepEqual(read(path.join(data, "identity.sqlite")), identity);
  const report = { ok: true, verifiedAt: new Date().toISOString(), backup,
    change: "Additive layout.automation only", privatePreflightPassed: true,
    accountsUnchanged: true, operationalDataUnchanged: true, transactionalTablesUnchanged: true,
    clockUnchanged: true, annexAreaM2: expected.layout.automation.annex.areaM2,
    automaticStations: expected.layout.automation.stations.length,
    counts: { products: expected.catalog.skus.length, suppliers: expected.catalog.suppliers.length,
      assets: expected.catalog.assets.length, orders: expected.orders.length, purchases: expected.purchases.length,
      handlingUnits: expected.hus.length, autonomousJobs: expected.autonomy.jobs.length } };
  const output = process.env.DONPEPE_MAP_INSTALL_REPORT || path.resolve(__dirname, "../../../DonPepe-Mapa-Autonomo-2026-10-18/preservacion-datos-reales.json");
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  // Only the specifically created private preflight directory is removed.
  fs.rmSync(temporary, { recursive: true, force: true });
}
