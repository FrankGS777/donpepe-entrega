"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs"), { join, dirname } = require("node:path"), { tmpdir } = require("node:os");
const { DatabaseSync } = require("node:sqlite");
const { createIdentityStore } = require("../security/identity");
const { ROLE_CEILINGS, assertCommandAllowed } = require("../security/policy");
const { createSimulation } = require("../core/engine");
const NEW_PERMISSIONS = ["autonomy.read", "config.autonomy.manage", "autonomy.authorize", "autonomy.exception.resolve"];
function databaseFixture(t) {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-autonomy-grants-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "identity.sqlite"), initial = createIdentityStore(filename);
  const people = initial.db.prepare("SELECT * FROM people ORDER BY id").all();
  initial.db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run("fixture-session", "u-store", "fixture-csrf", 9999999999999);
  initial.close();
  return { filename, people };
}
function preUpgrade(filename, mutate) {
  const db = new DatabaseSync(filename);
  db.prepare("DELETE FROM security_meta WHERE key='autonomy_grants_v5'").run();
  const remove = db.prepare("DELETE FROM role_grants WHERE permission=?");
  for (const permission of NEW_PERMISSIONS) remove.run(permission);
  if (mutate) mutate(db);
  db.close();
}
test("la actualización autónoma hereda permisos de negocio una sola vez y conserva identidades y sesiones", t => {
  const { filename, people } = databaseFixture(t); preUpgrade(filename);
  const updated = createIdentityStore(filename); t.after(() => updated.close());
  assert.deepEqual(updated.db.prepare("SELECT * FROM people ORDER BY id").all(), people);
  assert.equal(updated.db.prepare("SELECT COUNT(*) n FROM people").get().n, 3);
  assert.equal(updated.db.prepare("SELECT COUNT(*) n FROM people WHERE role='admin'").get().n, 1);
  assert.equal(updated.db.prepare("SELECT COUNT(*) n FROM web_sessions WHERE token='fixture-session'").get().n, 1);
  for (const [role, permissions] of Object.entries({ admin: ["autonomy.read", "config.autonomy.manage"], operations: ["autonomy.read", "autonomy.authorize", "autonomy.exception.resolve"], store: ["autonomy.read"] })) {
    for (const permission of permissions) assert.ok(updated.grants(role).includes(permission), `${role}: ${permission}`);
    assert.ok(updated.grants(role).every(permission => ROLE_CEILINGS[role].includes(permission)));
  }
  assert.equal(updated.db.prepare("SELECT value FROM security_meta WHERE key='autonomy_grants_v5'").get().value, "1");
});
test("padres previamente revocados no se amplían mediante la migración de autonomía", t => {
  const { filename } = databaseFixture(t);
  preUpgrade(filename, db => {
    db.prepare("DELETE FROM role_grants WHERE role='admin' AND permission IN ('inventory.summary.read','config.settings.manage')").run();
    db.prepare("DELETE FROM role_grants WHERE role='operations' AND permission IN ('inventory.read','purchase.create','order.release','incident.resolve')").run();
    db.prepare("DELETE FROM role_grants WHERE role='store' AND permission='inventory.read'").run();
  });
  const updated = createIdentityStore(filename); t.after(() => updated.close());
  for (const role of ["admin", "operations", "store"]) for (const permission of NEW_PERMISSIONS) assert.ok(!updated.grants(role).includes(permission), `${role}: ${permission}`);
});
test("revocar un permiso autónomo después de migrar persiste tras reiniciar sin duplicar usuarios", t => {
  const { filename, people } = databaseFixture(t), db = new DatabaseSync(filename);
  const remove = db.prepare("DELETE FROM role_grants WHERE permission=?"); for (const permission of NEW_PERMISSIONS) remove.run(permission); db.close();
  const reopened = createIdentityStore(filename); t.after(() => reopened.close());
  for (const role of ["admin", "operations", "store"]) for (const permission of NEW_PERMISSIONS) assert.ok(!reopened.grants(role).includes(permission));
  assert.deepEqual(reopened.db.prepare("SELECT * FROM people ORDER BY id").all(), people);
});
test("los techos RBAC rechazan permisos autónomos falsificados y mantienen separación de funciones", () => {
  const admin = { id: "A", role: "admin", permissions: [...ROLE_CEILINGS.admin, "autonomy.authorize", "autonomy.exception.resolve"] };
  const store = { id: "S", role: "store", branchId: "TIENDA-1", permissions: [...ROLE_CEILINGS.store, "config.autonomy.manage", "autonomy.authorize", "autonomy.exception.resolve"] };
  const ops = { id: "O", role: "operations", permissions: [...ROLE_CEILINGS.operations, "config.autonomy.manage"] };
  for (const actor of [admin, store]) for (const command of ["autonomy.authorize", "autonomy.retry"]) assert.throws(() => assertCommandAllowed(actor, command), { status: 403 });
  for (const actor of [ops, store]) assert.throws(() => assertCommandAllowed(actor, "config.autonomy.update"), { status: 403 });
  for (const command of ["purchase.create", "order.release", "order.dispatch", "equipment.fault"]) assert.throws(() => assertCommandAllowed(admin, command), { status: 403 });
});
test("autorizar autonomía no permite recuperar compras o salidas cuyo permiso de negocio está revocado", t => {
  const { filename: identityFile } = databaseFixture(t), filename = join(dirname(identityFile), "simulation.sqlite"), ops = { id: "O", role: "operations" };
  const legacy = createSimulation({ filename, academicLegacyFixture: true });
  const purchase = legacy.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, ops);
  legacy.command("order.release", { id: "PED-00001" }, ops); legacy.close();
  const production = createSimulation({ filename }); t.after(() => production.close());
  const noPurchases = { ...ops, permissions: ROLE_CEILINGS.operations.filter(permission => permission !== "purchase.create") };
  const noOrders = { ...ops, permissions: ROLE_CEILINGS.operations.filter(permission => permission !== "order.release") };
  assert.throws(() => production.command("autonomy.authorize", { kind: "PURCHASE", id: purchase.id }, noPurchases), { status: 403 });
  assert.throws(() => production.command("autonomy.authorize", { kind: "ORDER", id: "PED-00001" }, noOrders), { status: 403 });
  assert.deepEqual(production.snapshot(ops).autonomy.jobs, []);
});
test("tienda no consulta procesos, evidencias ni infraestructura de otra sucursal en modo productivo", t => {
  // Deliberately no legacy fixture: this uses the autonomous production default.
  const sim = createSimulation(); t.after(() => sim.close());
  const ops = { id: "O", role: "operations" }, own = { id: "S1", role: "store", branchId: "TIENDA-1" }, other = { id: "S2", role: "store", branchId: "TIENDA-2" };
  const order = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, other);
  sim.command("order.release", { id: order.id }, ops);
  const foreignJob = sim.snapshot(ops).autonomy.jobs.find(job => job.documentId === order.id);
  assert.ok(foreignJob);
  const view = sim.snapshot(own);
  assert.ok(!view.orders.some(row => row.id === order.id));
  assert.ok(!view.autonomy.jobs.some(row => row.id === foreignJob.id));
  assert.ok(view.autonomy.evidence.every(row => row.jobId !== foreignJob.id));
  assert.deepEqual(view.autonomy.notices, []);
  assert.ok(view.autonomyDevices.every(device => device.branchId === own.branchId));
  assert.ok(view.autonomyConfiguration.assets.every(asset => asset.branchId === own.branchId));
  assert.throws(() => sim.command("autonomy.authorize", { kind: "ORDER", id: order.id }, own), { status: 403 });
});
