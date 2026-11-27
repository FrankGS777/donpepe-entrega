"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { createSimulation } = require("../core/engine");
const { createBlueprint, SKUS } = require("../core/blueprint");
const { createIdentityStore } = require("../security/identity");
const { DatabaseSync } = require("node:sqlite");
const { Fields } = require("../core/validation");
const { tickMaintenance } = require("../core/equipment-domain");
const { AUTONOMY_ASSET_SCHEMAS } = require("../core/autonomy-config");
const EXPANDED = require("../core/expanded-catalog.json");
const ADMIN = { id: "A", role: "admin" }, OPS = { id: "O", role: "operations" }, STORE = { id: "S", role: "store", branchId: "TIENDA-1" };
// Legacy mission actions remain a regression fixture, never a production option.
function fixture(t, options) { const sim = createSimulation({ academicLegacyFixture: true, ...options }); t.after(() => sim.close()); return sim; }
const view = sim => sim.snapshot(OPS);
const cfg = (sim, type, payload = {}) => sim.command(type, { expectedRevision: view(sim).configuration.revision, ...payload, ...(["config.brand.create", "config.category.create", "config.branch.create"].includes(type) ? { data: { imageUrl: "/images/catalog/sku-arroz.webp", ...payload.data } } : {}) }, ADMIN);
const service = (sim, action, payload = {}, actor = ADMIN) => sim.command(`maintenance.${action}`, { expectedRevision: view(sim).configuration.revision, ...payload }, actor);
const request = (sim, assetId = "ASSET-AMR-1", more = {}) => service(sim, "request", { assetId, type: "PREVENTIVE", reason: "Inspección preventiva programada de los sensores", ...more }, OPS);
const approve = (sim, id, more = {}) => service(sim, "approve", { id, technician: "Servicio técnico autorizado", ...more });
const record = (sim, id) => view(sim).maintenance.find(row => row.id === id);
function complete(sim, id, more = {}) { const item = record(sim, id); return service(sim, "complete", { id, technician: "Servicio técnico autorizado", performedDate: view(sim).clock.now.slice(0, 10), cost: 120.5, notes: "Inspección realizada y pruebas sin carga superadas.", checklist: item.checklist.map(row => ({ id: row.id, done: true })), ...more }); }
function until(sim, condition, max = 1600) { for (let i = 0; i < max; i++) { if (condition(view(sim))) return; sim.advance(1); } assert.fail("No se alcanzó el estado físico esperado."); }
function plannedAsset(sim, more = {}) { return cfg(sim, "config.asset.create", { data: { code: "AMR-PLAN-01", name: "AMR ampliación futura", type: "AMR", manufacturer: "Fabricante de prueba", model: "Modelo previsto", serialNumber: "PLAN-0001", commissionDate: "2026-10-17", serviceIntervalHours: 250, capacityCases: 24, capacityKg: 1500, temperatureClass: "AMBIENT", ...more } }); }

test("la migración añade 119 artículos y maestros sin fabricar una sola caja ni cambiar el plano", t => {
  const sim = fixture(t), state = view(sim), blueprint = createBlueprint();
  assert.equal(state.catalog.skus.length, SKUS.length + EXPANDED.products.length);
  assert.equal(state.metrics.warehouseCases, 360); assert.equal(state.hus.length, 24);
  assert.ok(state.catalog.skus.filter(sku => sku.importSource).every(sku => !state.hus.some(hu => hu.skuId === sku.id)));
  const originalAssets = state.catalog.assets.filter(asset => !AUTONOMY_ASSET_SCHEMAS[asset.type]), infrastructure = state.catalog.assets.filter(asset => AUTONOMY_ASSET_SCHEMAS[asset.type]);
  assert.equal(originalAssets.length, 25);
  assert.deepEqual(originalAssets.map(asset => asset.deviceId).sort(), [...state.robots.map(robot => robot.id), ...state.trucks.map(truck => truck.id), ...state.layout.stations.filter(station => station.type === "CHARGER").map(station => station.id)].sort());
  assert.deepEqual(infrastructure.map(asset => asset.id).sort(), ["ASSET-AUTO-UNLOADER-IN-1", "ASSET-AUTO-ID-IN-1", "ASSET-PIE-IN-1", "ASSET-INBOUND-CONVEYOR-1", "ASSET-CASE-PICKER-1", ...state.catalog.branches.map(branch => `ASSET-STORE-RECEIVING-${branch.id}`)].sort());
  assert.equal(new Set(state.catalog.assets.map(asset => asset.serialNumber)).size, state.catalog.assets.length);
  assert.deepEqual(state.layout.locations, blueprint.locations.map(location => ({ ...location, blocked: false, reservedFor: null, huId: state.hus.find(hu => hu.locationId === location.id)?.id || null, state: state.hus.some(hu => hu.locationId === location.id) ? "OCCUPIED" : "FREE" })));
  assert.ok(state.catalog.skus.every(sku => state.catalog.brands.some(brand => brand.id === sku.brandId) && state.catalog.categories.some(category => category.id === sku.categoryId)));
  assert.ok(state.catalog.branches.every(branch => branch.imageUrl.includes("/representations/branch-")));
});

test("formularios maestros reúnen errores de todos los campos sin guardar datos parciales", t => {
  const sim = fixture(t), before = view(sim);
  assert.throws(() => cfg(sim, "config.brand.create", { data: { code: "?", name: "", imageUrl: "https://outside/image.jpg", supplierIds: ["NOPE", "NOPE"], description: "x".repeat(501), active: "sí" } }), error => {
    assert.equal(error.status, 422); for (const key of ["code", "name", "imageUrl", "supplierIds", "description", "active"]) assert.ok(error.fieldErrors[key], key); return true;
  });
  assert.equal(view(sim).configuration.revision, before.configuration.revision); assert.deepEqual(view(sim).catalog.brands, before.catalog.brands);
});

test("administración configura maestros y activos; operaciones solicita servicio y tienda no accede", t => {
  const sim = fixture(t);
  for (const actor of [OPS, STORE]) for (const type of ["config.brand.create", "config.category.create", "config.asset.create", "maintenance.approve", "maintenance.start", "maintenance.complete", "maintenance.cancel"]) assert.throws(() => sim.command(type, {}, actor), { status: 403 });
  assert.throws(() => sim.command("maintenance.request", { assetId: "ASSET-AMR-1", reason: "Inspección programada" }, STORE), { status: 403 });
  assert.deepEqual(sim.snapshot(STORE).catalog.assets, []); assert.deepEqual(sim.snapshot(STORE).maintenance, []);
  for (const type of ["order.release", "order.dispatch", "purchase.create", "equipment.fault"]) assert.throws(() => sim.command(type, {}, ADMIN), { status: 403 });
});

test("marca y categoría son referencias activas compatibles con proveedor y temperatura", t => {
  const sim = fixture(t), state = view(sim), rice = state.catalog.skus.find(sku => sku.id === "SKU-ARROZ"), brand = state.catalog.brands.find(brand => brand.name === "Costeño");
  assert.throws(() => cfg(sim, "config.sku.create", { data: { code: "NO-REFS", name: "Producto sin maestros", zoneId: "DRY", supplierId: "PROV-1", unitsPerCase: 12, expiryControlled: true } }), error => !!error.fieldErrors.brandId && !!error.fieldErrors.categoryId);
  const incompatible = cfg(sim, "config.category.create", { data: { code: "ONLY-COLD", name: "Categoría solo refrigerados", zoneIds: ["COLD"] } });
  assert.throws(() => cfg(sim, "config.sku.update", { id: rice.id, data: { categoryId: incompatible.id } }), error => !!error.fieldErrors.categoryId);
  assert.throws(() => cfg(sim, "config.brand.update", { id: brand.id, data: { supplierIds: ["PROV-2"] } }), error => error.status === 409);
  assert.throws(() => cfg(sim, "config.category.update", { id: rice.categoryId, data: { zoneIds: ["COLD"] } }), error => error.status === 409);
});

test("marca se renombra coherentemente pero no se desactiva mientras tenga artículos activos", t => {
  const sim = fixture(t), rice = view(sim).catalog.skus.find(sku => sku.id === "SKU-ARROZ"), hus = view(sim).hus;
  assert.throws(() => cfg(sim, "config.brand.deactivate", { id: rice.brandId }), /productos activos/);
  assert.throws(() => cfg(sim, "config.category.deactivate", { id: rice.categoryId }), /productos activos/);
  cfg(sim, "config.brand.update", { id: rice.brandId, data: { name: "Costeño registro actualizado" } });
  assert.equal(view(sim).catalog.skus.find(sku => sku.id === rice.id).brand, "Costeño registro actualizado"); assert.deepEqual(view(sim).hus, hus);
});

test("duplicados normalizados, referencias desactivadas y revisión antigua se rechazan", t => {
  const sim = fixture(t), revision = view(sim).configuration.revision;
  const category = cfg(sim, "config.category.create", { data: { code: "NUEVA-CAT", name: "Categoría temporal", zoneIds: ["DRY"] } });
  assert.throws(() => sim.command("config.category.create", { expectedRevision: revision, data: { code: "OTRA", name: "Otra categoría", zoneIds: ["DRY"] } }, ADMIN), { status: 409 });
  assert.throws(() => cfg(sim, "config.category.create", { data: { code: "OTRA", name: "  CATEGORÍA TEMPORAL  ", zoneIds: ["DRY"] } }), error => !!error.fieldErrors.name);
  cfg(sim, "config.category.deactivate", { id: category.id });
  const rice = view(sim).catalog.skus.find(row => row.id === "SKU-ARROZ"); assert.throws(() => cfg(sim, "config.sku.update", { id: rice.id, data: { categoryId: category.id } }), error => !!error.fieldErrors.categoryId);
  cfg(sim, "config.category.activate", { id: category.id }); assert.equal(view(sim).catalog.categories.find(row => row.id === category.id).active, true);
});

test("GTIN UPC y su representación de 14 dígitos no crean dos artículos", t => {
  const sim = fixture(t), source = view(sim).catalog.skus.find(sku => sku.barcode?.length === 12);
  assert.ok(source);
  assert.throws(() => cfg(sim, "config.sku.create", { data: { ...source, code: "DUPLICATE-UPC", name: "Artículo duplicado por GTIN", barcode: source.barcode.padStart(14, "0") } }), error => error.status === 409 && !!error.fieldErrors.barcode);
});

test("alta de equipo es una ficha planificada y no genera maquinaria ni rutas ficticias", t => {
  const sim = fixture(t), before = view(sim), result = plannedAsset(sim), after = view(sim), asset = after.catalog.assets.find(row => row.id === result.id);
  assert.equal(asset.status, "PLANNED"); assert.equal(asset.deviceId, null); assert.deepEqual(after.robots, before.robots); assert.deepEqual(after.trucks, before.trucks); assert.deepEqual(after.layout, before.layout);
  assert.throws(() => plannedAsset(sim, { code: "PLAN-2", name: "Segundo equipo", serialNumber: "plan-0001" }), error => !!error.fieldErrors.serialNumber);
  assert.throws(() => plannedAsset(sim, { code: "PLAN-2", name: "Segundo equipo", serialNumber: "PLAN-2", deviceId: "AMR-1" }), error => !!error.fieldErrors.deviceId);
});

test("ficha de equipo muestra errores simultáneos de fechas, capacidad, número de serie e imagen", t => {
  const sim = fixture(t);
  assert.throws(() => plannedAsset(sim, { commissionDate: "2026-02-30", warrantyUntil: "ayer", capacityKg: -1, capacityCases: 1.5, serviceIntervalHours: 0, serialNumber: "", imageUrl: "javascript:x" }), error => {
    for (const key of ["commissionDate", "warrantyUntil", "capacityKg", "capacityCases", "serviceIntervalHours", "serialNumber", "imageUrl"]) assert.ok(error.fieldErrors[key], key); return true;
  });
});

test("un activo vinculado conserva capacidad, clase y vínculo físico", t => {
  const sim = fixture(t), before = view(sim);
  assert.throws(() => cfg(sim, "config.asset.update", { id: "ASSET-AMR-1", data: { type: "TRUCK", deviceId: "TRUCK-1", capacityCases: 300, capacityKg: 50000, temperatureClass: "FROZEN", serviceHours: 0 } }), error => {
    for (const key of ["type", "deviceId", "capacityCases", "capacityKg", "temperatureClass"]) assert.ok(error.fieldErrors[key], key); return true;
  });
  assert.deepEqual(view(sim).robots, before.robots);
});

test("mantenimiento exige motivo real, fecha válida y un único expediente abierto", t => {
  const sim = fixture(t);
  assert.throws(() => request(sim, "ASSET-AMR-1", { reason: "", type: "MAGIA", scheduledDate: "2026-02-30" }), error => ["reason", "type", "scheduledDate"].every(key => !!error.fieldErrors[key]));
  const result = request(sim); assert.equal(record(sim, result.id).state, "REQUESTED");
  assert.throws(() => request(sim), { status: 409 });
  assert.throws(() => cfg(sim, "config.asset.deactivate", { id: "ASSET-AMR-1" }), /mantenimiento abierto/);
});

test("solicitud idempotente y permisos revocados no duplican mantenimiento", t => {
  const sim = fixture(t), payload = { assetId: "ASSET-AMR-1", reason: "Inspección preventiva por ruido anormal", commandId: "maintenance-once" };
  const first = sim.command("maintenance.request", payload, OPS), retry = sim.command("maintenance.request", payload, OPS);
  assert.deepEqual(retry, first); assert.equal(view(sim).maintenance.length, 1);
  assert.throws(() => sim.command("maintenance.request", { ...payload, reason: "Otro informe diferente" }, OPS), { status: 409 });
  assert.throws(() => sim.command("maintenance.request", payload, { ...OPS, permissions: [] }), { status: 403 });
});

test("servicio completo retira el equipo ocioso y exige técnico, informe y checklist", t => {
  const sim = fixture(t), result = request(sim); approve(sim, result.id); service(sim, "start", { id: result.id });
  assert.equal(record(sim, result.id).state, "IN_PROGRESS"); assert.equal(view(sim).robots.find(robot => robot.id === "AMR-1").state, "MAINTENANCE");
  assert.throws(() => complete(sim, result.id, { technician: "", cost: -1, performedDate: "2026-10-18", notes: "", checklist: [] }), error => ["technician", "cost", "performedDate", "notes", "checklist"].every(key => !!error.fieldErrors[key]));
  assert.throws(() => service(sim, "cancel", { id: result.id, reason: "Cancelar sin realizar el servicio" }), { status: 409 });
  complete(sim, result.id); assert.equal(record(sim, result.id).state, "COMPLETED"); assert.equal(view(sim).robots.find(robot => robot.id === "AMR-1").state, "IDLE");
  assert.equal(view(sim).catalog.assets.find(asset => asset.id === "ASSET-AMR-1").status, "AVAILABLE");
  assert.throws(() => complete(sim, result.id), { status: 409 });
});

test("un servicio futuro, checklist repetido y cierre prematuro no avanzan la máquina de estados", t => {
  const sim = fixture(t), result = request(sim, "ASSET-AMR-1", { scheduledDate: "2026-10-19" });
  assert.throws(() => complete(sim, result.id), { status: 409 });
  assert.throws(() => approve(sim, result.id, { checklist: [{ label: "Revisión duplicada" }, { label: "Revisión duplicada" }] }), error => !!error.fieldErrors.checklist);
  approve(sim, result.id); assert.throws(() => service(sim, "start", { id: result.id }), /fecha posterior/);
  service(sim, "cancel", { id: result.id, reason: "El proveedor reprogramó su visita técnica" }); assert.equal(record(sim, result.id).state, "CANCELLED");
});

test("el mantenimiento espera que el transelevador entregue su carga y no roba la misión", t => {
  const sim = fixture(t); sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, state => state.robots.find(robot => robot.id === "STACKER-1").carryingHuId);
  const busy = view(sim).robots.find(robot => robot.id === "STACKER-1"), huId = busy.carryingHuId, missionId = busy.missionId, result = request(sim, "ASSET-STACKER-1"); approve(sim, result.id); service(sim, "start", { id: result.id });
  assert.equal(record(sim, result.id).state, "WAITING_SAFE"); assert.equal(view(sim).robots.find(robot => robot.id === busy.id).carryingHuId, huId);
  until(sim, state => state.maintenance.find(row => row.id === result.id).state === "IN_PROGRESS", 300);
  assert.equal(view(sim).missions.find(mission => mission.id === missionId).state, "COMPLETED"); assert.equal(view(sim).robots.find(robot => robot.id === busy.id).carryingHuId, null);
  assert.equal(view(sim).metrics.warehouseCases, 360); complete(sim, result.id);
});

test("avería con carga y mantenimiento pendiente conserva el recorrido al recuperar el equipo", t => {
  const sim = fixture(t); sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, state => state.robots.find(robot => robot.id === "STACKER-1").carryingHuId);
  sim.command("equipment.fault", { id: "STACKER-1", reason: "Sensor de elevación pendiente de inspección" }, OPS);
  const result = request(sim, "ASSET-STACKER-1", { type: "CORRECTIVE" }); approve(sim, result.id); service(sim, "start", { id: result.id });
  assert.equal(record(sim, result.id).state, "WAITING_SAFE");
  const cargo = view(sim).robots.find(robot => robot.id === "STACKER-1").carryingHuId;
  sim.command("equipment.recover", { id: "STACKER-1" }, OPS); assert.equal(view(sim).robots.find(robot => robot.id === "STACKER-1").carryingHuId, cargo);
  until(sim, state => state.maintenance.find(row => row.id === result.id).state === "IN_PROGRESS", 300); complete(sim, result.id);
});

test("cargador retirado deja de admitir equipos y no corta una carga eléctrica en curso", t => {
  const sim = fixture(t); until(sim, state => state.robots.find(robot => robot.id === "AMR-6").state === "CHARGING", 100);
  const robot = view(sim).robots.find(robot => robot.id === "AMR-6"), result = request(sim, `ASSET-${robot.chargerId}`); approve(sim, result.id); service(sim, "start", { id: result.id });
  assert.equal(record(sim, result.id).state, "WAITING_SAFE");
  until(sim, state => state.maintenance.find(row => row.id === result.id).state === "IN_PROGRESS", 120);
  assert.ok(view(sim).robots.find(row => row.id === "AMR-6").battery >= 95); complete(sim, result.id);
});

test("camión en servicio queda excluido de despacho y devolución sin cambiar sus coordenadas", t => {
  const sim = fixture(t), result = request(sim, "ASSET-TRUCK-1"); approve(sim, result.id); service(sim, "start", { id: result.id });
  const before = view(sim).trucks.find(truck => truck.id === "TRUCK-1");
  sim.command("order.release", { id: "PED-00001" }, OPS); until(sim, state => state.orders[0].state === "READY");
  assert.throws(() => sim.command("order.dispatch", { id: "PED-00001", truckId: "TRUCK-1" }, OPS), { status: 409 });
  assert.equal(view(sim).orders[0].state, "READY"); sim.command("order.dispatch", { id: "PED-00001" }, OPS);
  assert.notEqual(view(sim).orders[0].truckId, "TRUCK-1"); assert.equal(view(sim).trucks.find(truck => truck.id === "TRUCK-1").x, before.x); complete(sim, result.id);
});

test("desactivación de equipo ocupado falla y retirada segura excluye trabajo sin borrar el modelo", t => {
  const sim = fixture(t); sim.command("order.release", { id: "PED-00001" }, OPS); sim.advance(1);
  assert.throws(() => cfg(sim, "config.asset.deactivate", { id: "ASSET-STACKER-1" }), /recorrido|carga/);
  cfg(sim, "config.asset.deactivate", { id: "ASSET-AMR-1" });
  assert.ok(view(sim).robots.some(robot => robot.id === "AMR-1")); assert.equal(view(sim).catalog.assets.find(asset => asset.id === "ASSET-AMR-1").status, "INACTIVE");
  cfg(sim, "config.asset.activate", { id: "ASSET-AMR-1" }); assert.equal(view(sim).catalog.assets.find(asset => asset.id === "ASSET-AMR-1").status, "AVAILABLE");
});

test("tienda edita su solicitud pendiente con revisión y nunca modifica la de otra sucursal", t => {
  const sim = fixture(t), created = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, STORE), payload = { id: created.id, expectedOrderRevision: 1, lines: [{ skuId: "SKU-ARROZ", cases: 3 }], notes: "Necesitamos reponer para el siguiente turno", requestedByDate: "2026-10-20" };
  sim.command("order.edit", payload, STORE); assert.equal(view(sim).orders.find(order => order.id === created.id).lines[0].cases, 3);
  assert.throws(() => sim.command("order.edit", payload, STORE), { status: 409 });
  assert.throws(() => sim.command("order.edit", { ...payload, expectedOrderRevision: 2 }, { ...STORE, branchId: "TIENDA-2" }), { status: 403 });
  assert.throws(() => sim.command("order.edit", { ...payload, expectedOrderRevision: 2 }, OPS), { status: 403 });
  sim.command("order.release", { id: created.id }, OPS); assert.throws(() => sim.command("order.edit", { ...payload, expectedOrderRevision: 3 }, STORE), { status: 409 });
});

test("solicitudes validan fechas reales, límite de 90 días, duplicados y cantidades sin escrituras parciales", t => {
  const sim = fixture(t), before = view(sim);
  for (const requestedByDate of ["2026-02-30", "2026-10-16", "2028-01-01", "hoy"]) assert.throws(() => sim.command("order.create", { requestedByDate, lines: [{ skuId: "SKU-ARROZ", cases: 1 }] }, STORE), error => !!error.fieldErrors.requestedByDate);
  assert.throws(() => sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }, { skuId: "SKU-ARROZ", cases: 2 }] }, STORE), /No repitas/);
  assert.throws(() => sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: -2 }] }, STORE), /entero/);
  assert.deepEqual(view(sim).orders, before.orders); assert.deepEqual(view(sim).hus, before.hus);
});

test("previsualización FEFO muestra faltantes y etapas sin reservar ni filtrar lotes a la tienda", t => {
  const sim = fixture(t), before = view(sim), model = before.orderReadModels.find(row => row.orderId === "PED-00001");
  assert.equal(model.canRelease, true); assert.equal(model.availability[0].fefo[0].cases, 4); assert.equal(model.milestones[0].state, "CURRENT");
  assert.deepEqual(view(sim).hus, before.hus);
  const zero = before.catalog.skus.find(sku => sku.importSource), order = sim.command("order.create", { lines: [{ skuId: zero.id, cases: 2 }] }, STORE), shortage = view(sim).orderReadModels.find(row => row.orderId === order.id);
  assert.equal(shortage.canRelease, false); assert.equal(shortage.availability[0].shortfallCases, 2); assert.equal(sim.snapshot(STORE).orderReadModels.find(row => row.orderId === order.id).availability, undefined);
  sim.command("order.release", { id: "PED-00001" }, OPS); assert.equal(view(sim).orderReadModels.find(row => row.orderId === "PED-00001").milestones[1].state, "CURRENT");
});

test("cancelar compra antes de llegada requiere motivo y conserva balance; tras llegada se bloquea", t => {
  const sim = fixture(t), purchase = sim.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }, OPS), before = view(sim);
  assert.throws(() => sim.command("purchase.cancel", { id: purchase.id, reason: "" }, OPS), { status: 422 });
  assert.throws(() => sim.command("purchase.cancel", { id: purchase.id, reason: "Pedido duplicado al proveedor" }, ADMIN), { status: 403 });
  sim.command("purchase.cancel", { id: purchase.id, reason: "Pedido duplicado al proveedor", commandId: "cancel-once" }, OPS); sim.advance(35);
  assert.equal(view(sim).purchases.find(row => row.id === purchase.id).state, "CANCELLED"); assert.equal(view(sim).metrics.warehouseCases, before.metrics.warehouseCases);
  const arrived = sim.command("purchase.create", { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }, OPS); sim.command("purchase.arrive", { id: arrived.id }, OPS);
  assert.throws(() => sim.command("purchase.cancel", { id: arrived.id, reason: "Intento de cancelar al proveedor" }, OPS), { status: 409 });
});

test("nuevos permisos se añaden por parentesco sin reabrir un privilegio previamente restringido", t => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-governance-grants-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "identity.sqlite"), first = createIdentityStore(filename); first.close();
  const db = new DatabaseSync(filename); db.prepare("DELETE FROM security_meta WHERE key='catalog_asset_governance_v3'").run();
  db.prepare("DELETE FROM role_grants WHERE role='operations' AND permission IN ('equipment.fault','maintenance.read','maintenance.request')").run();
  db.prepare("DELETE FROM role_grants WHERE role='store' AND permission IN ('order.create','order.edit')").run(); db.close();
  const reopened = createIdentityStore(filename); t.after(() => reopened.close());
  assert.ok(!reopened.grants("operations").includes("maintenance.request")); assert.ok(!reopened.grants("store").includes("order.edit"));
  assert.ok(reopened.grants("admin").includes("maintenance.manage")); assert.ok(!reopened.grants("admin").includes("map.view"));
});

test("fechas imposibles y números no finitos producen errores de campo utilizables", () => {
  const fields = new Fields(); fields.date("2026-02-30", "date", "Fecha"); fields.number(Infinity, "cost", "Coste"); fields.number("1e6", "hours", "Horas"); fields.image("/images/../private.png", "photo", "Foto");
  assert.throws(() => fields.assert(), error => ["date", "cost", "hours", "photo"].every(key => !!error.fieldErrors[key]));
});

test("el contador de uso incluye el trabajo que termina antes de entrar en mantenimiento", t => {
  const sim = fixture(t), state = view(sim), asset = state.catalog.assets.find(row => row.deviceId === "AMR-1"), robot = state.robots.find(row => row.id === "AMR-1");
  asset.status = "WAITING_SAFE"; robot.state = "MOVING"; robot.missionId = "BUSY-MISSION";
  tickMaintenance(state, 3600, { event() {} }); assert.equal(asset.serviceHours, 1);
  asset.status = "MAINTENANCE"; robot.state = "MAINTENANCE"; tickMaintenance(state, 3600, { event() {} }); assert.equal(asset.serviceHours, 1);
});

test("reiniciar conserva el equipo retirado y su informe pendiente hasta inspección completa", t => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-service-restart-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "simulation.sqlite"), first = createSimulation({ filename, academicLegacyFixture: true }), result = request(first); approve(first, result.id); service(first, "start", { id: result.id }); first.close();
  const restarted = fixture(t, { filename }); assert.equal(record(restarted, result.id).state, "IN_PROGRESS"); assert.equal(view(restarted).robots.find(robot => robot.id === "AMR-1").state, "MAINTENANCE");
  assert.equal(view(restarted).maintenance.filter(row => row.assetId === "ASSET-AMR-1").length, 1); complete(restarted, result.id); assert.equal(view(restarted).metrics.warehouseCases, 360);
});

test("un AMR vuelve vacío a su plaza antes del servicio y no inmoviliza la estación PACK", t => {
  const sim = fixture(t); sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, state => state.robots.some(robot => robot.type === "AMR" && robot.carryingHuId));
  const busy = view(sim).robots.find(robot => robot.type === "AMR" && robot.carryingHuId), result = request(sim, `ASSET-${busy.id}`); approve(sim, result.id); service(sim, "start", { id: result.id });
  until(sim, state => state.maintenance.find(row => row.id === result.id).state === "IN_PROGRESS", 400);
  const parked = view(sim).robots.find(robot => robot.id === busy.id), bay = view(sim).layout.nodes.find(node => node.id === parked.parkingId);
  assert.equal(parked.nodeId, parked.parkingId); assert.ok(Math.hypot(parked.x - bay.x, parked.z - bay.z) < 0.02); assert.equal(parked.carryingHuId, null);
  assert.ok(!Object.values(view(sim).routeLocks).includes(`park:${parked.id}`)); assert.equal(view(sim).metrics.warehouseCases, 360); complete(sim, result.id);
});

test("cancelación de solicitud exige motivo documentado y revierte reservas si falta", t => {
  const sim = fixture(t); sim.command("order.release", { id: "PED-00001" }, OPS); const before = view(sim);
  assert.throws(() => sim.command("order.cancel", { id: "PED-00001", reason: "" }, OPS), error => !!error.fieldErrors.reason);
  assert.deepEqual(view(sim).hus, before.hus); assert.deepEqual(view(sim).missions, before.missions); assert.equal(view(sim).orders[0].state, "PREPARING");
  sim.command("order.cancel", { id: "PED-00001", reason: "La tienda comunicó un pedido duplicado" }, OPS);
  const cancelled = view(sim).orders[0]; assert.equal(cancelled.cancelledBy, OPS.id); assert.equal(cancelled.cancelReason, "La tienda comunicó un pedido duplicado"); assert.ok(cancelled.cancelledAt);
});

test("los maestros nuevos requieren imagen y un equipo planificado recibe la imagen de su clase", t => {
  const sim = fixture(t), revision = view(sim).configuration.revision;
  for (const [type, data] of [["config.brand.create", { code: "IMG-BRAND", name: "Marca sin imagen", supplierIds: ["PROV-1"] }], ["config.category.create", { code: "IMG-CAT", name: "Categoría sin imagen", zoneIds: ["DRY"] }], ["config.branch.create", { code: "IMG-BRANCH", name: "Tienda sin imagen", x: 110, z: 100, travelSeconds: 60 }]]) assert.throws(() => sim.command(type, { expectedRevision: revision, data }, ADMIN), error => !!error.fieldErrors.imageUrl);
  const created = plannedAsset(sim, { imageUrl: "" }); assert.equal(view(sim).catalog.assets.find(asset => asset.id === created.id).imageUrl, "/images/representations/equipment-amr.webp");
});

test("descripciones e informes admiten párrafos y tabulaciones; nombres y códigos rechazan controles", t => {
  const sim = fixture(t), category = cfg(sim, "config.category.create", { data: { code: "MULTILINE", name: "Categoría con descripción", zoneIds: ["DRY"], description: "Primera línea\n\tSegunda línea" } });
  assert.equal(view(sim).catalog.categories.find(row => row.id === category.id).description, "Primera línea\n\tSegunda línea");
  const created = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }], notes: "Reposición semanal\nConfirmar recepción de las cajas." }, STORE); assert.ok(view(sim).orders.find(order => order.id === created.id).notes.includes("\n"));
  assert.throws(() => cfg(sim, "config.category.update", { id: category.id, data: { name: "Nombre\nincorrecto" } }), error => !!error.fieldErrors.name);
  assert.throws(() => request(sim, "ASSET-AMR-1", { reason: "Texto con control\u0001 no permitido" }), error => !!error.fieldErrors.reason);
});

test("editar una solicitud permite quitar la fecha deseada sin confundir ausencia y valor vacío", t => {
  const sim = fixture(t), created = sim.command("order.create", { lines: [{ skuId: "SKU-ARROZ", cases: 1 }], requestedByDate: "2026-10-20" }, STORE);
  sim.command("order.edit", { id: created.id, expectedOrderRevision: 1, lines: [{ skuId: "SKU-ARROZ", cases: 1 }], requestedByDate: null }, STORE);
  assert.equal(view(sim).orders.find(order => order.id === created.id).requestedByDate, null);
  sim.command("order.edit", { id: created.id, expectedOrderRevision: 2, lines: [{ skuId: "SKU-ARROZ", cases: 1 }], requestedByDate: "2026-10-22" }, STORE);
  sim.command("order.edit", { id: created.id, expectedOrderRevision: 3, lines: [{ skuId: "SKU-ARROZ", cases: 2 }] }, STORE);
  assert.equal(view(sim).orders.find(order => order.id === created.id).requestedByDate, "2026-10-22");
});
