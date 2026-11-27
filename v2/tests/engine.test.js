"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createSimulation: createEngine } = require("../core/engine");
// These older physical-flow regression fixtures deliberately exercise legacy
// receipt balances; production and all controlled-receiving tests stay strict.
const createSimulation = options => createEngine({ ...options, academicLegacyFixture: true });
const { DatabaseSync } = require("node:sqlite");
const { SKUS } = require("../core/blueprint");
const EXPANDED = require("../core/expanded-catalog.json");
const CATALOG_SIZE = SKUS.length + EXPANDED.products.length;
const OPS = { id: "OPS", role: "operations" }, ADMIN = { id: "ADMIN", role: "admin" };
const STORE = { id: "STORE", role: "store", branchId: "TIENDA-1" };
const OTHER = { id: "OTHER", role: "store", branchId: "TIENDA-2" };
function setup(t, options) { const s = createSimulation(options); t.after(() => s.close()); return s; }
function state(s) { return s.snapshot(OPS); }
function until(s, condition, max = 1500) { for (let i = 0; i < max; i++) { if (condition(state(s))) return; s.advance(1); } assert.fail("El escenario no alcanzó el estado esperado."); }
function complete(s, orderId = "PED-00001", lines) {
  s.command("order.release", { id: orderId }, OPS);
  until(s, (v) => v.orders.find((o) => o.id === orderId).state === "READY");
  s.command("order.dispatch", { id: orderId }, OPS);
  until(s, (v) => v.orders.find((o) => o.id === orderId).state === "ARRIVED");
  s.command("order.receive", { id: orderId, ...(lines ? { lines } : {}) }, STORE);
}

test("el comando retirado de simular pedidos se rechaza en todos los perfiles sin mutar existencias ni pedidos", t => {
  const s=setup(t),before=state(s),payload={commandId:"retired-request"};
  for (const actor of [ADMIN,OPS,STORE,{...OPS,permissions:["simulation.request"]}])
    assert.throws(()=>s.command("simulation.request",payload,actor),{status:403});
  const after=state(s);
  assert.deepEqual(after.orders,before.orders); assert.deepEqual(after.hus,before.hus);
  assert.deepEqual(after.missions,before.missions); assert.deepEqual(after.metrics,before.metrics);
});
test("sólo la tienda crea solicitudes oficiales, de forma idempotente y sin reservar mercancía", t => {
  const s=setup(t),before=state(s),payload={commandId:"official-request",lines:[{skuId:"SKU-ARROZ",cases:2}]};
  for(const actor of [ADMIN,OPS])assert.throws(()=>s.command("order.create",payload,actor),{status:403});
  const first=s.command("order.create",payload,STORE),retry=s.command("order.create",payload,STORE),after=state(s);
  assert.deepEqual(first,retry);assert.equal(after.orders.length,before.orders.length+1);
  const order=after.orders.find(row=>row.id===first.id);
  assert.equal(order.source,"STORE");assert.equal(order.simulated,false);assert.equal(order.createdBy,STORE.id);
  assert.equal(order.branchId,STORE.branchId);assert.equal(order.state,"PENDING");assert.deepEqual(order.allocations,[]);
  assert.deepEqual(after.hus,before.hus);assert.deepEqual(after.missions,before.missions);
  assert.equal(after.metrics.availableCases,before.metrics.availableCases);
});
test("el resumen administrativo refleja reservas y compras sin publicar direcciones físicas", t => {
  const s = setup(t), initial = s.snapshot(ADMIN).inventorySummary;
  assert.equal(initial.totals.warehouseCases, 360); assert.equal(initial.totals.availableCases, 360); assert.equal(initial.products.length, CATALOG_SIZE);
  assert.equal(s.snapshot(STORE).inventorySummary, undefined); assert.equal(state(s).inventorySummary, undefined);
  s.command("order.release", { id: "PED-00001" }, OPS);
  s.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 5 }] }, OPS);
  const summary = s.snapshot(ADMIN).inventorySummary, rice = summary.products.find(row => row.skuId === "SKU-ARROZ");
  assert.equal(summary.totals.warehouseCases, 360); assert.equal(summary.totals.reservedCases, 6); assert.equal(summary.totals.availableCases, 354);
  assert.equal(rice.incomingCases, 5); assert.equal(rice.nextExpiry, "2026-12-01");
  assert.ok(!JSON.stringify(summary).includes("CD1-")); assert.ok(!Object.hasOwn(summary, "hus"));
});
test("metadatos maestros validan GTIN, imágenes locales, contacto y cambios incompatibles con trazabilidad", t => {
  const s = setup(t), product = configure(s, "config.sku.create", { code: "META-1", name: "Producto de prueba", zoneId: "DRY", supplierId: "PROV-1", unitsPerCase: 12, expiryControlled: true, brand: "Marca de prueba", category: "Abarrotes", presentation: "Bolsa 1 kg", barcode: "4006381333931", reorderPoint: 8, imageUrl: "/images/catalog/prueba.webp" });
  const getProduct = () => state(s).catalog.skus.find(sku => sku.id === product.id);
  assert.equal(getProduct().brand, "Marca de prueba"); assert.equal(getProduct().barcode, "4006381333931"); assert.equal(getProduct().reorderPoint, 8);
  assert.throws(() => configure(s, "config.sku.create", { code: "META-2", name: "Otro producto", zoneId: "DRY", supplierId: "PROV-1", unitsPerCase: 12, expiryControlled: true, barcode: "4006381333931" }), error => error.status === 409 && !!error.fieldErrors.barcode);
  for (const imageUrl of ["https://example.com/p.jpg", "/images/../private.png", "/images/%2e%2e/private.png", "data:image/png;base64,AAAA", "/images/catalog/product.png?remote=1"]) assert.throws(() => configure(s, "config.sku.update", { id: product.id, imageUrl }), error => error.status === 422 && !!error.fieldErrors.imageUrl);
  for (const barcode of ["4006381333932", "ABC", "123", "4e12"]) assert.throws(() => configure(s, "config.sku.update", { id: product.id, barcode }), error => error.status === 422 && !!error.fieldErrors.barcode);
  assert.throws(() => configure(s, "config.sku.update", { id: product.id, brand: "x".repeat(81) }), error => error.status === 422 && !!error.fieldErrors.brand);
  assert.throws(() => configure(s, "config.sku.update", { id: product.id, reorderPoint: -2 }), error => error.status === 422 && !!error.fieldErrors.reorderPoint);
  const purchase = s.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: product.id, cases: 1 }] }, OPS);
  assert.ok(purchase.id); assert.throws(() => configure(s, "config.sku.update", { id: product.id, brand: "Otra marca" }), error => error.status === 409 && !!error.fieldErrors.brand);
  configure(s, "config.supplier.update", { id: "PROV-1", contact: "Área comercial", email: "pedidos@example.com", phone: "+51 (01) 555-0123", site: "https://example.com", leadDays: 3, logoUrl: "/images/catalog/proveedor.png" });
  const supplier = state(s).catalog.suppliers.find(row => row.id === "PROV-1"); assert.equal(supplier.leadDays, 3); assert.equal(supplier.email, "pedidos@example.com");
  for (const [field, value] of [["email", "sin-arroba"], ["phone", "llamar a pepe"], ["site", "javascript:alert(1)"], ["site", "https://usuario:clave@example.com"], ["leadDays", 91]]) assert.throws(() => configure(s, "config.supplier.update", { id: supplier.id, [field]: value }), error => error.status === 422 && !!error.fieldErrors[field]);
});
test("migración enriquece las semillas anteriores y conserva maestros personalizados y saldo", t => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-catalog-migration-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "scenario.sqlite"), initial = createSimulation({ filename }); initial.close();
  const db = new DatabaseSync(filename), stored = JSON.parse(db.prepare("SELECT state_json FROM simulation WHERE id=1").get().state_json);
  delete stored.catalogMetadataVersion;
  const rice = stored.catalog.skus.find(sku => sku.id === "SKU-ARROZ"), oil = stored.catalog.skus.find(sku => sku.id === "SKU-ACEITE");
  rice.name = "Arroz extra 1 kg"; for (const key of ["brand", "category", "presentation", "barcode", "imageUrl", "reorderPoint"]) delete rice[key];
  oil.name = "Aceite especial de la cooperativa"; oil.brand = "Mi marca"; oil.updatedAt = "2026-10-17T14:00:00.000Z";
  db.prepare("UPDATE simulation SET state_json=? WHERE id=1").run(JSON.stringify(stored)); db.close();
  const restored = createSimulation({ filename }); t.after(() => restored.close());
  const view = restored.snapshot(OPS), migrated = view.catalog.skus.find(sku => sku.id === rice.id), preserved = view.catalog.skus.find(sku => sku.id === oil.id);
  assert.ok(migrated.brand); assert.ok(migrated.imageUrl); assert.notEqual(migrated.name, "Arroz extra 1 kg");
  assert.equal(preserved.name, oil.name); assert.equal(preserved.brand, "Mi marca"); assert.equal(view.metrics.warehouseCases, 360);
  for (const key of ["racks", "nodes", "edges", "loadingDocks"]) assert.deepEqual(view.layout[key], stored.layout[key]);
  assert.deepEqual(view.hus.map(({ motionHistory, ...hu }) => hu), stored.hus);
});

test("el escenario comparte plano, catálogo y 448 plazas únicas con el mapa", (t) => {
  const s = setup(t); const v = state(s);
  assert.equal(v.catalog.skus.length, CATALOG_SIZE); assert.equal(v.layout.locations.length, 448);
  assert.equal(new Set(v.layout.locations.map((l) => l.code)).size, 448);
  assert.equal(v.robots.filter((r) => r.type === "AMR").length, 6);
  assert.equal(v.robots.filter((r) => r.type === "STACKER").length, 10);
  assert.equal(v.trucks.length, 3); assert.equal(v.metrics.warehouseCases, 360);
  assert.equal(v.meta.physicalConnection, false); assert.equal(v.meta.telemetry, false);
  assert.ok(v.robots.filter((r) => r.type === "AMR").every((r) => r.capacityKg === 1500));
});
test("un borrador no reserva ni mueve mercancía; liberación FEFO no altera el total", (t) => {
  const s = setup(t); let v = state(s); assert.equal(v.missions.length, 0);
  s.command("order.release", { id: "PED-00001" }, OPS); v = state(s);
  assert.equal(v.metrics.warehouseCases, 360); assert.equal(v.metrics.availableCases, 354);
  for (const a of v.orders[0].allocations) { const h = v.hus.find((h) => h.id === a.sourceHuId); assert.match(h.lot, /-1$/); assert.equal(a.picked, false); }
});
test("pedido completo: recogida, consolidación, expedición, viaje y recepción tienda", (t) => {
  const s = setup(t); complete(s); until(s, (v) => v.missions.every((m) => m.state === "COMPLETED")); const v = state(s);
  assert.equal(v.orders[0].state, "RECEIVED"); assert.equal(v.metrics.storeCases, 6);
  assert.equal(v.metrics.warehouseCases, 354); assert.equal(v.metrics.inTransitCases, 0);
  assert.equal(v.hus.reduce((n, h) => n + h.cases, 0) + v.storeStock.reduce((n, r) => n + r.cases, 0), 360);
  assert.ok(v.missions.every((m) => m.state === "COMPLETED"));
  assert.ok(v.events.some((e) => e.type === "LOAD_PICKED")); assert.ok(v.events.some((e) => e.type === "STORE_RECEIVED"));
});
test("cajas en camión no aparecen como recibidas en tienda", (t) => {
  const s = setup(t); s.command("order.release", { id: "PED-00001" }, OPS); until(s, (v) => v.orders[0].state === "READY");
  s.command("order.dispatch", { id: "PED-00001" }, OPS); assert.equal(state(s).storeStock.length, 0); assert.equal(state(s).metrics.inTransitCases, 0); assert.equal(state(s).orders[0].state, "LOADING");
  until(s, v => v.orders[0].state === "DISPATCHED"); assert.equal(state(s).metrics.inTransitCases, 6);
  assert.throws(() => s.command("order.receive", { id: "PED-00001" }, STORE), /debe llegar/);
  until(s, (v) => v.orders[0].state === "ARRIVED"); assert.equal(state(s).storeStock.length, 0);
});
test("recepción parcial conserva diferencias identificadas sin inventar disponibilidad", (t) => {
  const s = setup(t); complete(s, "PED-00001", [{ skuId: "SKU-ARROZ", receivedCases: 3 }, { skuId: "SKU-YOGUR", receivedCases: 2 }]);
  const v = state(s); assert.equal(v.orders[0].state, "RECEIVED_WITH_DIFFERENCE"); assert.equal(v.metrics.storeCases, 5);
  assert.equal(v.hus.filter((h) => h.state === "DISCREPANCY").reduce((n, h) => n + h.cases, 0), 1);
});
test("compra desde cero llega, acepta parcial, retiene y almacena mediante equipos", (t) => {
  const s = setup(t, { seed: false });
  const { id } = s.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 20 }] }, OPS);
  assert.throws(() => s.command("purchase.receive", { id }, OPS), /Espera la llegada/);
  s.advance(30); s.command("purchase.receive", { id, lines: [{ lineId: "LINE-1", acceptedCases: 12, quarantineCases: 3, lot: "FAB-A", expiry: "2027-01-01" }] }, OPS);
  assert.equal(state(s).purchases[0].state, "PARTIAL"); assert.equal(state(s).metrics.availableCases, 0);
  until(s, (v) => v.hus.some((h) => h.lot === "FAB-A" && h.state === "STORED"));
  let v = state(s); assert.equal(v.metrics.availableCases, 12); assert.equal(v.hus.find((h) => h.state === "QUARANTINE").cases, 3);
  s.command("purchase.receive", { id, lines: [{ lineId: "LINE-1", acceptedCases: 5, quarantineCases: 0, lot: "FAB-B", expiry: "2027-01-02" }] }, OPS);
  until(s, (v) => v.metrics.availableCases === 17); v = state(s); assert.equal(v.purchases[0].state, "RECEIVED"); assert.equal(v.ledger.receivedCases, 20);
  const quarantined = v.hus.find((h) => h.state === "QUARANTINE"); s.command("inventory.releaseQuarantine", { huId: quarantined.id }, OPS);
  until(s, (v) => v.metrics.availableCases === 20);
});
test("recepción rechaza caducidad, proveedor incompatible y exceso sin escrituras parciales", (t) => {
  const s = setup(t, { seed: false });
  assert.throws(() => s.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-YOGUR", cases: 2 }] }, OPS), /catálogo/);
  const { id } = s.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 4 }] }, OPS); s.advance(30);
  const before = state(s).revision;
  assert.throws(() => s.command("purchase.receive", { id, lines: [{ lineId: "LINE-1", acceptedCases: 5 }] }, OPS), /más cajas/);
  assert.throws(() => s.command("purchase.receive", { id, lines: [{ lineId: "LINE-1", acceptedCases: 4, expiry: "2026-02-31" }] }, OPS), /inválida/);
  assert.throws(() => s.command("purchase.receive", { id, lines: [{ lineId: "LINE-1", acceptedCases: 4, expiry: "2020-01-01" }] }, OPS), /caducada/);
  assert.equal(state(s).revision, before); assert.equal(state(s).hus.length, 0);
});
test("reservas concurrentes se excluyen y una línea faltante revierte todo el pedido", (t) => {
  const s = setup(t); const first = s.command("order.create", { branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 25 }] }, STORE);
  s.command("order.release", { id: first.id }, OPS);
  const second = s.command("order.create", { branchId: "TIENDA-2", lines: [{ skuId: "SKU-YOGUR", cases: 1 }, { skuId: "SKU-ARROZ", cases: 6 }] }, OTHER);
  assert.throws(() => s.command("order.release", { id: second.id }, OPS), /insuficientes/);
  const v = state(s); assert.equal(v.orders.find((o) => o.id === second.id).allocations.length, 0);
  assert.equal(v.hus.filter((h) => h.skuId === "SKU-YOGUR").reduce((n, h) => n + h.reservedCases, 0), 0);
});
test("cancelar antes de la recogida libera reservas; después no desaparece carga", (t) => {
  const s = setup(t); s.command("order.release", { id: "PED-00001" }, OPS); s.command("order.cancel", { id: "PED-00001", reason: "La tienda anuló su solicitud" }, OPS);
  assert.equal(state(s).metrics.availableCases, 360); assert.equal(state(s).orders[0].state, "CANCELLED");
  const next = s.command("order.create", { branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }, STORE);
  s.command("order.release", { id: next.id }, OPS); until(s, (v) => v.orders.find((o) => o.id === next.id).allocations.some((a) => a.picked));
  assert.throws(() => s.command("order.cancel", { id: next.id }, OPS), /ya fue recogida/);
  assert.equal(state(s).hus.reduce((n, h) => n + h.cases, 0), 360);
});
test("eventos de comando idempotentes sobreviven a reintentos", (t) => {
  const s = setup(t); const payload = { commandId: "create-once", branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] };
  const a = s.command("order.create", payload, STORE), b = s.command("order.create", payload, STORE);
  assert.deepEqual(a, b); assert.equal(state(s).orders.length, 2);
});
test("persistencia reinicia una misión averiada con carga sin duplicarla", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-v2-engine-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "scenario.sqlite"); let s = createSimulation({ filename });
  s.command("order.release", { id: "PED-00001" }, OPS); until(s, (v) => v.robots.some((r) => r.carryingHuId));
  const robot = state(s).robots.find((r) => r.carryingHuId); s.command("equipment.fault", { id: robot.id }, OPS);
  const saved = state(s).robots.find((r) => r.id === robot.id); s.close(); s = createSimulation({ filename });
  const { motionHistory: restoredHistory, ...restoredRobot } = state(s).robots.find((r) => r.id === robot.id);
  const { motionHistory: previousHistory, ...previousRobot } = saved;
  assert.deepEqual(restoredRobot, previousRobot); s.advance(20); // The bounded presentation history is intentionally ephemeral.
  assert.equal(state(s).robots.find((r) => r.id === robot.id).state, "FAULT");
  s.command("equipment.recover", { id: robot.id }, OPS); until(s, (v) => v.orders[0].state === "READY");
  assert.equal(state(s).hus.reduce((n, h) => n + h.cases, 0), 360); s.close();
});
test("pausa y velocidad se aplican en el motor, no desde animaciones de navegador", (t) => {
  const s = setup(t); s.command("simulation.pause", { paused: true }, OPS); s.advance(50); assert.equal(state(s).clock.elapsed, 0);
  s.command("simulation.speed", { speed: 20 }, OPS); s.command("simulation.pause", { paused: false }, OPS); s.advance(2); assert.equal(state(s).clock.elapsed, 40);
  assert.throws(() => s.command("simulation.speed", { speed: 999 }, OPS), /Velocidad/);
});
test("perfil administrador no sustituye operación; tiendas no ven ni mutan datos ajenos", (t) => {
  const s = setup(t);
  assert.throws(() => s.command("order.release", { id: "PED-00001" }, ADMIN), (e) => e.status === 403);
  assert.throws(() => s.command("order.create", { branchId: "TIENDA-2", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, STORE), (e) => e.status === 403);
  assert.throws(() => s.command("order.cancel", { id: "PED-00001" }, OTHER), (e) => e.status === 403);
  assert.throws(() => s.command("equipment.fault", { id: "AMR-1" }, STORE), (e) => e.status === 403);
  assert.equal(s.snapshot(OTHER).orders.length, 0); assert.equal(s.snapshot(STORE).orders.length, 1);
  assert.equal(s.snapshot(STORE).hus.length, 0); assert.equal(s.snapshot(STORE).purchases.length, 0);
});
test("ningún perfil puede reiniciar ni borrar la trazabilidad del escenario", (t) => {
  const s = setup(t);
  for (const actor of [ADMIN, OPS, STORE]) assert.throws(() => s.command("simulation.reset", { confirmation: "REINICIAR" }, actor), (e) => e.status === 403);
  assert.equal(state(s).orders.length, 1); assert.equal(state(s).metrics.warehouseCases, 360);
});
test("AMR no entra en congelados; transferencia fija y transelevadores hacen su trabajo específico", (t) => {
  const s = setup(t); const { id } = s.command("order.create", { branchId: "TIENDA-1", lines: [{ skuId: "SKU-HELADO", cases: 2 }] }, STORE);
  s.command("order.release", { id }, OPS); until(s, (v) => v.orders.find((o) => o.id === id).state === "READY"); const v = state(s);
  assert.ok(v.missions.some((m) => m.deviceType === "SHUTTLE" && m.requiredRobotId === "SHUTTLE-1"));
  for (const m of v.missions.filter((m) => m.deviceType === "AMR")) assert.ok(m.route.every((p) => !/^F-?\d/.test(p.nodeId || "")));
});
test("venta de tienda y devolución mantienen balance y trazabilidad a cuarentena", (t) => {
  const s = setup(t); complete(s); s.command("store.consume", { skuId: "SKU-ARROZ", cases: 1 }, STORE);
  assert.equal(state(s).metrics.storeCases, 5); assert.equal(state(s).ledger.consumedCases, 1);
  const { id } = s.command("return.create", { orderId: "PED-00001", skuId: "SKU-ARROZ", cases: 2, reason: "Envase dañado" }, STORE);
  let summary = s.snapshot(ADMIN).inventorySummary;
  assert.equal(summary.totals.returnCases, 2); assert.equal(summary.branches.find(branch => branch.branchId === STORE.branchId).returnCases, 2);
  assert.equal(summary.totals.warehouseCases + summary.totals.branchCases + summary.totals.inTransitCases + summary.totals.discrepancyCases + summary.totals.returnCases, 359);
  assert.equal(state(s).metrics.storeCases, 3); until(s, (v) => v.returns.find((r) => r.id === id).state === "QUARANTINED");
  summary = s.snapshot(ADMIN).inventorySummary; assert.equal(summary.totals.returnCases, 0); assert.equal(summary.totals.quarantineCases, 2);
  assert.equal(summary.totals.warehouseCases + summary.totals.branchCases + summary.totals.inTransitCases + summary.totals.discrepancyCases, 359);
  const v = state(s); assert.equal(v.returns.find((r) => r.id === id).state, "QUARANTINED"); assert.equal(v.hus.find((h) => h.returnId === id).state, "QUARANTINE");
  assert.throws(() => s.command("store.consume", { skuId: "SKU-ARROZ", cases: 10 }, STORE), /no dispone/);
  assert.throws(() => s.command("store.consume", { branchId: "TIENDA-2", skuId: "SKU-ARROZ", cases: 1 }, STORE), (e) => e.status === 403);
});
test("bloqueo excluye el stock y rechaza bloquear una plaza con misión reservada", (t) => {
  const s = setup(t); const h = state(s).hus.find((h) => h.skuId === "SKU-ARROZ");
  s.command("location.block", { id: h.locationId, blocked: true }, OPS); assert.equal(state(s).inventory.availability.find((r) => r.skuId === h.skuId).availableCases, 18);
  s.command("location.block", { id: h.locationId, blocked: false }, OPS); s.command("order.release", { id: "PED-00001" }, OPS);
  assert.throws(() => s.command("location.block", { id: h.locationId, blocked: true }, OPS), /traslado reservado/);
});
test("pedido mixto con 12 productos termina sin bloqueo circular ni extracción parcial en rack", (t) => {
  const s = setup(t); const { id } = s.command("order.create", { branchId: "TIENDA-2", lines: SKUS.map((sku) => ({ skuId: sku.id, cases: 2 })) }, OTHER);
  s.command("order.release", { id }, OPS);
  // Guided equipment now accelerates, brakes and turns before every transfer.
  // Keep the same completion/balance assertions with a physical time budget.
  for (let elapsed = 0; elapsed < 6000 && state(s).orders.find((o) => o.id === id).state !== "READY"; elapsed += 10) s.advance(10);
  const v = state(s);
  assert.equal(v.orders.find((o) => o.id === id).state, "READY");
  assert.ok(v.missions.every((m) => m.state === "COMPLETED"));
  assert.equal(v.events.filter((e) => e.type === "CASES_SEPARATED").length, 12);
  const pick = v.missions.find((m) => m.kind === "PICK"); assert.ok(pick.cases > pick.allocatedCases);
  assert.equal(v.hus.reduce((a, hu) => a + hu.cases, 0), 360);
});
test("batería baja reserva un cargador y recupera energía sin inventar una tarea", (t) => {
  const s = setup(t); assert.equal(state(s).robots.find((r) => r.id === "AMR-6").battery, 18);
  s.advance(1); assert.equal(state(s).robots.find((r) => r.id === "AMR-6").state, "TO_CHARGER");
  until(s, (v) => v.robots.find((r) => r.id === "AMR-6").battery >= 95);
  assert.equal(state(s).missions.length, 0);
});
test("plano de circulación no contiene tramos colineales superpuestos ni palés en el itinerario de otro", (t) => {
  const s = setup(t); const { nodes, edges, locations } = state(s).layout;
  const point = (id) => nodes.find((n) => n.id === id);
  for (let i = 0; i < edges.length; i++) for (let j = i + 1; j < edges.length; j++) {
    const a = point(edges[i].from), b = point(edges[i].to), c = point(edges[j].from), d = point(edges[j].to);
    if (a.x === b.x && c.x === d.x && a.x === c.x) assert.ok(Math.min(Math.max(a.z, b.z), Math.max(c.z, d.z)) - Math.max(Math.min(a.z, b.z), Math.min(c.z, d.z)) <= 0, `Tramo superpuesto: ${edges[i].id} / ${edges[j].id}`);
    if (a.z === b.z && c.z === d.z && a.z === c.z) assert.ok(Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= 0, `Tramo superpuesto: ${edges[i].id} / ${edges[j].id}`);
  }
  for (const l of locations.filter((l) => l.kind === "FLOOR")) assert.equal(edges.filter((e) => e.from === l.nodeId || e.to === l.nodeId).length, 1, `${l.code} debe ser terminal, nunca una vía de paso`);
});
test("JSON malformado y nombres reservados no causan escrituras ni privilegios", (t) => {
  const s = setup(t); const before = state(s).revision;
  const commands = [
    [null, {}], ["order.create", null], ["order.create", { commandId: { toString: {} } }],
    ["order.create", { branchId: "TIENDA-1", lines: [null] }],
    ["order.create", { branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: { toString: {} } }] }],
    ["order.create", { branchId: "TIENDA-1", notes: { toString: {} }, lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }],
    ["simulation.speed", { speed: { toString: {} } }], ["simulation.pause", { paused: "false" }],
  ];
  for (const [type, p] of commands) assert.throws(() => s.command(type, p, type === "order.create" ? STORE : OPS), (e) => e.status >= 400 && e.status < 500);
  assert.throws(() => s.snapshot({ id: "x", role: "__proto__" }), (e) => e.status === 401);
  assert.equal(state(s).revision, before);
});
test("la tienda no recibe métricas, proveedores ni identidades de cargas ajenas", (t) => {
  const s = setup(t); s.command("order.release", { id: "PED-00001" }, OPS);
  const v = s.snapshot(STORE); assert.equal(v.catalog.branches.length, 1); assert.equal(v.layout.branches.length, 1);
  assert.equal(v.catalog.suppliers.length, 0); assert.equal(v.orders[0].allocations.length, 0);
  assert.equal(v.metrics.availableCases, 0); assert.deepEqual(v.ledger, {}); assert.deepEqual(v.counters, {});
  assert.ok(v.catalog.skus.every((sku) => !Object.hasOwn(sku, "availableCases")));
});
test("cancelar no repara un robot averiado ni elimina su carga o bloqueo", (t) => {
  const s = setup(t); s.command("order.release", { id: "PED-00001" }, OPS); s.advance(1);
  const m = state(s).missions.find((m) => m.phase === "TO_SOURCE"); assert.ok(m);
  s.command("equipment.fault", { id: m.robotId }, OPS);
  assert.throws(() => s.command("order.cancel", { id: "PED-00001" }, OPS), /Recupera el equipo/);
  assert.equal(state(s).robots.find((r) => r.id === m.robotId).state, "FAULT");
  s.command("equipment.recover", { id: m.robotId }, OPS); s.command("order.cancel", { id: "PED-00001", reason: "La tienda confirmó la cancelación" }, OPS);
  assert.equal(state(s).metrics.availableCases, 360);
});
test("reinicio de proceso conserva idempotencia de compras y recepción", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-v2-receipts-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "scenario.sqlite"); let s = createSimulation({ filename, seed: false });
  const request = { commandId: "purchase-once", supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 4 }] };
  const original = s.command("purchase.create", request, OPS); s.close(); s = createSimulation({ filename, seed: false });
  assert.deepEqual(s.command("purchase.create", request, OPS), original); assert.equal(state(s).purchases.length, 1); s.advance(30);
  const receipt = { id: original.id, commandId: "receive-once" }; const received = s.command("purchase.receive", receipt, OPS); s.close(); s = createSimulation({ filename, seed: false });
  assert.deepEqual(s.command("purchase.receive", receipt, OPS), received); assert.equal(state(s).ledger.receivedCases, 4); assert.equal(state(s).hus.length, 1); s.close();
});
test("reservas geométricas mantienen separación entre AMR durante un pedido mixto", (t) => {
  const s = setup(t); const { id } = s.command("order.create", { branchId: "TIENDA-1", lines: SKUS.map((p) => ({ skuId: p.id, cases: 1 })) }, STORE);
  s.command("order.release", { id }, OPS); let finished = false;
  for (let step = 0; step < 6000; step++) {
    s.advance(1); const v = state(s), robots = v.robots.filter((r) => r.type === "AMR");
    for (let i = 0; i < robots.length; i++) for (let j = i + 1; j < robots.length; j++) assert.ok(Math.hypot(robots[i].x - robots[j].x, robots[i].z - robots[j].z) >= 1.8, `Dos AMR se superponen en segundo ${step}.`);
    if (v.orders.find((o) => o.id === id).state === "READY" && v.missions.every((m) => m.state === "COMPLETED")) { finished = true; break; }
  }
  assert.ok(finished);
});

function configure(s, type, data) {
  if (["config.brand.create", "config.category.create", "config.branch.create"].includes(type)) data = { imageUrl: "/images/catalog/sku-arroz.webp", ...data };
  if (type === "config.sku.create") {
    data = { ...data };
    let view = state(s);
    const brandName = data.brand || `Marca de prueba ${data.supplierId}`;
    let brand = view.catalog.brands.find(row => row.name === brandName && row.supplierIds.includes(data.supplierId));
    if (!brand) { const created = configure(s, "config.brand.create", { code: `TEST-M-${view.catalog.brands.length}`, name: brandName, supplierIds: [data.supplierId] }); brand = { id: created.id }; }
    view = state(s);
    const categoryName = data.category || "Categoría de pruebas";
    let category = view.catalog.categories.find(row => row.name === categoryName && row.zoneIds.includes(data.zoneId));
    if (!category) { const created = configure(s, "config.category.create", { code: `TEST-C-${view.catalog.categories.length}`, name: categoryName, zoneIds: [data.zoneId] }); category = { id: created.id }; }
    data.brandId ||= brand.id; data.categoryId ||= category.id;
  }
  return s.command(type, { ...data, expectedRevision: state(s).configuration.revision }, ADMIN);
}
test("administrador gobierna configuración pero no puede operar ni alterar el mapa", (t) => {
  const s = setup(t);
  for (const [type, payload] of [["simulation.pause", { paused: true }], ["simulation.speed", { speed: 60 }], ["equipment.fault", { id: "AMR-1" }], ["equipment.recover", { id: "AMR-1" }], ["location.block", { id: state(s).layout.locations[0].id, blocked: true }], ["order.priority", { id: "PED-00001", priority: "HIGH" }]]) assert.throws(() => s.command(type, payload, ADMIN), (e) => e.status === 403);
  assert.equal(state(s).clock.paused, false); assert.ok(state(s).robots.every((r) => r.state !== "FAULT"));
  assert.throws(() => s.command("config.settings.update", { expectedRevision: 1, settings: { maxOrderCases: 50 } }, OPS), (e) => e.status === 403);
});
test("la revisión de configuración no depende del reloj y evita sobrescrituras de otra pestaña", (t) => {
  const s = setup(t); const revision = state(s).configuration.revision; s.advance(2);
  s.command("config.settings.update", { expectedRevision: revision, settings: { maxOrderCases: 60 } }, ADMIN);
  assert.throws(() => s.command("config.settings.update", { expectedRevision: revision, settings: { maxOrderCases: 40 } }, ADMIN), (e) => e.status === 409);
  assert.equal(state(s).configuration.settings.maxOrderCases, 60);
  for (const settings of [{ maxOrderCases: 121 }, { maxOrderCases: 2.5 }, { minShelfLifeDays: -1 }, { minShelfLifeDays: 31 }, { maxOpenOrdersPerBranch: 0 }, { unsafeNoTraceability: true }]) assert.throws(() => configure(s, "config.settings.update", { settings }), (e) => e.status === 422);
});
test("catálogo configurable mantiene IDs y referencias, rechaza duplicados y conserva historia", (t) => {
  const s = setup(t);
  const supplier = configure(s, "config.supplier.create", { code: "TEST-01", name: "Distribuidora prueba", zones: ["DRY"] });
  const sku = configure(s, "config.sku.create", { code: "TEST-SKU", name: "Avena instantánea 1 kg", zoneId: "DRY", supplierId: supplier.id, unitsPerCase: 12, maxCasesPerHu: 24, expiryControlled: true });
  assert.ok(state(s).inventory.availability.some((a) => a.skuId === sku.id));
  assert.throws(() => configure(s, "config.supplier.create", { code: "test-01", name: "Otro proveedor", zones: ["DRY"] }), (e) => e.status === 409);
  assert.throws(() => configure(s, "config.supplier.deactivate", { id: supplier.id }), /productos activos/);
  configure(s, "config.sku.update", { id: sku.id, name: "Avena premium 1 kg" }); assert.equal(state(s).catalog.skus.find((p) => p.id === sku.id).name, "Avena premium 1 kg");
  const purchase = s.command("purchase.create", { supplierId: supplier.id, lines: [{ skuId: sku.id, cases: 1 }] }, OPS);
  assert.throws(() => configure(s, "config.sku.deactivate", { id: sku.id }), /documentos pendientes/);
  assert.throws(() => configure(s, "config.sku.update", { id: sku.id, unitsPerCase: 6 }), /inmutables/);
  assert.equal(state(s).purchases.find((p) => p.id === purchase.id).lines[0].skuId, sku.id);
});
test("desactivación es reversible sin borrar catálogos y no admite entradas nuevas", (t) => {
  const s = setup(t);
  const supplier = configure(s, "config.supplier.create", { code: "ARCHIVE", name: "Proveedor temporal", zones: ["DRY"] });
  const sku = configure(s, "config.sku.create", { code: "ARC-SKU", name: "Producto temporal", zoneId: "DRY", supplierId: supplier.id, unitsPerCase: 2, expiryControlled: false });
  configure(s, "config.sku.deactivate", { id: sku.id }); assert.equal(state(s).catalog.skus.find((p) => p.id === sku.id).active, false);
  assert.throws(() => s.command("order.create", { branchId: "TIENDA-1", lines: [{ skuId: sku.id, cases: 1 }] }, STORE), /desactivado/);
  configure(s, "config.supplier.deactivate", { id: supplier.id });
  assert.throws(() => configure(s, "config.sku.activate", { id: sku.id }), /activo/);
  configure(s, "config.supplier.activate", { id: supplier.id }); configure(s, "config.sku.activate", { id: sku.id });
  assert.equal(state(s).catalog.skus.find((p) => p.id === sku.id).active, true);
});
test("tiendas no se colocan dentro de la nave ni se mueven con una entrega pendiente", (t) => {
  const s = setup(t);
  assert.throws(() => configure(s, "config.branch.create", { code: "TEST-1", name: "Tienda invadiendo nave", x: 0, z: 0, travelSeconds: 30 }), /fuera del centro/);
  assert.throws(() => configure(s, "config.branch.create", { code: "TEST-2", name: "Tienda superpuesta", x: -75, z: 49, travelSeconds: 30 }), /superpone/);
  const branch = configure(s, "config.branch.create", { code: "DP-04", name: "DonPepe · Callao", x: 110, z: 90, travelSeconds: 80 });
  assert.ok(state(s).layout.branches.some((b) => b.id === branch.id));
  s.command("order.create", { branchId: branch.id, lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, { ...STORE, branchId: branch.id });
  assert.throws(() => configure(s, "config.branch.update", { id: branch.id, x: 140 }), /entregas pendientes/);
  assert.throws(() => configure(s, "config.branch.deactivate", { id: branch.id }), /pedidos/);
});
test("idempotencia detecta reutilización con datos diferentes y permiso revocado", (t) => {
  const s = setup(t), payload = { commandId: "same-key", branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] };
  s.command("order.create", payload, STORE);
  assert.throws(() => s.command("order.create", { ...payload, lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }, STORE), (e) => e.status === 409);
  assert.throws(() => s.command("order.create", payload, { ...STORE, permissions: [] }), (e) => e.status === 403);
  assert.equal(state(s).orders.length, 2);
});
test("caducidad sobrevenida bloquea despacho y hay recuperación física hacia cuarentena", (t) => {
  const s = setup(t); s.command("order.release", { id: "PED-00001" }, OPS); until(s, (v) => v.orders[0].state === "READY");
  configure(s, "config.settings.update", { settings: { minShelfLifeDays: 10 } });
  assert.throws(() => s.command("order.dispatch", { id: "PED-00001" }, OPS), /vida útil insuficiente/);
  assert.ok(state(s).incidents.some((i) => i.orderId === "PED-00001" && i.resolutions.includes("REJECT_PREPARED")));
  s.command("order.rejectPrepared", { id: "PED-00001", reason: "Vida útil insuficiente en control de salida" }, OPS);
  assert.equal(state(s).orders[0].state, "CANCELLED_AFTER_PREPARATION");
  until(s, (v) => v.hus.filter((h) => h.orderId === "PED-00001" && h.cases > 0).every((h) => h.state === "QUARANTINE"));
  assert.ok(state(s).missions.some((m) => m.kind === "RETURN_TO_QUARANTINE" && m.state === "COMPLETED"));
  assert.equal(state(s).hus.reduce((n, h) => n + h.cases, 0), 360);
});
test("baja de incidencias exige motivo y no duplica ni pierde el balance", (t) => {
  const s = setup(t); complete(s, "PED-00001", [{ skuId: "SKU-ARROZ", receivedCases: 3 }, { skuId: "SKU-YOGUR", receivedCases: 2 }]);
  const incident = state(s).incidents.find((i) => i.type === "DELIVERY_DIFFERENCE"); assert.ok(incident);
  assert.throws(() => s.command("incident.resolve", { id: incident.id, resolution: "WRITE_OFF", note: "x" }, OPS), /entre 8/);
  s.command("incident.resolve", { id: incident.id, resolution: "WRITE_OFF", note: "Pérdida confirmada tras revisar acta" }, OPS);
  assert.equal(state(s).ledger.writtenOffCases, 1); assert.equal(state(s).hus.reduce((n, h) => n + h.cases, 0) + state(s).metrics.storeCases, 359);
  assert.throws(() => s.command("incident.resolve", { id: incident.id, resolution: "WRITE_OFF", note: "Intento de duplicar la baja" }, OPS), (e) => e.status === 409);
});
test("devolución no toma existencias de otro pedido que compartía el mismo lote", (t) => {
  const s = setup(t); complete(s); s.command("store.consume", { skuId: "SKU-ARROZ", cases: 4 }, STORE);
  const next = s.command("order.create", { branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }, STORE); complete(s, next.id);
  assert.throws(() => s.command("return.create", { orderId: "PED-00001", skuId: "SKU-ARROZ", cases: 1, reason: "Quiero devolver mercancía agotada" }, STORE), /no dispone/);
  s.command("return.create", { orderId: next.id, skuId: "SKU-ARROZ", cases: 2, reason: "Daño de embalaje confirmado" }, STORE);
  assert.equal(state(s).storeStock.filter((r) => r.skuId === "SKU-ARROZ").reduce((n, r) => n + r.cases, 0), 0);
});
test("buffers físicos impiden recibir cargas superpuestas y revierten el documento completo", (t) => {
  const s = setup(t, { seed: false }); const purchase = s.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 313 }] }, OPS); s.advance(30);
  assert.throws(() => s.command("purchase.receive", { id: purchase.id }, OPS), /capacidad de espera/);
  assert.equal(state(s).hus.length, 0); assert.equal(state(s).ledger.receivedCases, 0); assert.equal(state(s).purchases[0].state, "ARRIVED");
  assert.throws(() => s.command("purchase.receive", { id: purchase.id, lines: [{ lineId: "LINE-1", acceptedCases: 0, quarantineCases: 97 }] }, OPS), /capacidad de espera/);
  s.command("purchase.receive", { id: purchase.id, lines: [{ lineId: "LINE-1", acceptedCases: 24, quarantineCases: 96 }] }, OPS);
  assert.equal(state(s).layout.stations.find((st) => st.id === "Q").occupiedHus, 4);
  assert.equal(state(s).hus.length, 5);
});
test("límites por tienda, prioridad y cantidades inválidas no dejan escrituras parciales", (t) => {
  const s = setup(t); configure(s, "config.settings.update", { settings: { maxOrderCases: 5, maxOpenOrdersPerBranch: 1 } });
  assert.throws(() => s.command("order.create", { branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, STORE), /límite/);
  assert.throws(() => s.command("order.create", { branchId: "TIENDA-2", lines: [{ skuId: "SKU-ARROZ", cases: 6 }] }, OTHER), /hasta 5/);
  for (const cases of [-1, 1.5, NaN, Infinity, "1e2", " 2", [], true]) assert.throws(() => s.command("order.create", { branchId: "TIENDA-2", lines: [{ skuId: "SKU-ARROZ", cases }] }, OTHER), (e) => e.status === 422);
  s.command("order.priority", { id: "PED-00001", priority: "HIGH" }, OPS); assert.equal(state(s).orders[0].priority, "HIGH");
  assert.throws(() => s.command("order.priority", { id: "PED-00001", priority: "HIGH" }, STORE), (e) => e.status === 403);
  assert.throws(() => s.advance({}), (e) => e.status === 422); assert.throws(() => s.advance(-1), (e) => e.status === 422);
  assert.equal(state(s).orders.length, 1);
});
test("configuración y procedencia de existencias sobreviven al reinicio sin recrear el escenario", (t) => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-config-persist-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "scenario.sqlite"); let s = createSimulation({ filename }); complete(s);
  configure(s, "config.settings.update", { settings: { maxOrderCases: 90 } }); const revision = state(s).configuration.revision;
  const stockIds = state(s).storeStock.map((r) => [r.id, r.orderId, r.cases]); s.close(); s = createSimulation({ filename });
  assert.equal(state(s).configuration.revision, revision); assert.equal(state(s).configuration.settings.maxOrderCases, 90);
  assert.deepEqual(state(s).storeStock.map((r) => [r.id, r.orderId, r.cases]), stockIds); assert.equal(state(s).orders[0].state, "RECEIVED"); s.close();
});
test("cambios de conservación/proveedor no invalidan la cadena física ni las compras abiertas", (t) => {
  const s = setup(t);
  assert.throws(() => configure(s, "config.supplier.update", { id: "PROV-2", zones: ["COLD"] }), /productos activos/);
  assert.throws(() => configure(s, "config.sku.create", { code: "COLD-NO-EXP", name: "Frío sin caducidad", zoneId: "COLD", supplierId: "PROV-2", unitsPerCase: 6, expiryControlled: false }), /controlar caducidad/);
  assert.throws(() => configure(s, "config.sku.update", { id: "SKU-ARROZ", zoneId: "COLD", supplierId: "PROV-2" }), /inmutables/);
  configure(s, "config.settings.update", { settings: { minShelfLifeDays: 10 } });
  const p = s.command("purchase.create", { supplierId: "PROV-2", lines: [{ skuId: "SKU-YOGUR", cases: 1 }] }, OPS); s.advance(30);
  assert.throws(() => s.command("purchase.receive", { id: p.id, lines: [{ lineId: "LINE-1", acceptedCases: 1, expiry: "2026-10-20" }] }, OPS), /vida útil insuficiente/);
  s.command("purchase.receive", { id: p.id, lines: [{ lineId: "LINE-1", acceptedCases: 0, quarantineCases: 1, expiry: "2026-10-20" }] }, OPS);
  const hu = state(s).hus.find((h) => h.purchaseId === p.id); assert.equal(hu.state, "QUARANTINE");
  assert.throws(() => s.command("inventory.releaseQuarantine", { huId: hu.id }, OPS), /vida útil mínima/);
});
