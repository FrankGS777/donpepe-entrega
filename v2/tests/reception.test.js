"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createSimulation } = require("../core/engine");
const OPS = { id: "O", role: "operations" }, ADMIN = { id: "A", role: "admin" }, STORE = { id: "S", role: "store", branchId: "TIENDA-1" };
// Fixture de regresión: conserva las verificaciones estrictas de recepción,
// pero permite ejecutar cada paso manualmente sin que avance el coordinador autónomo.
function setup(t) { const sim = createSimulation({ controlledReceivingFixture: true }); t.after(() => sim.close()); return sim; }
const view = sim => sim.snapshot(OPS);
function purchase(sim, skuId = "SKU-ARROZ", cases = 5) { const sku = view(sim).catalog.skus.find(sku => sku.id === skuId), result = sim.command("purchase.create", { supplierId: sku.supplierId, lines: [{ skuId, cases }] }, OPS); sim.command("purchase.arrive", { id: result.id }, OPS); return result.id; }
function payload(sim, id, more = {}, lineMore = {}) { const order = view(sim).purchases.find(row => row.id === id), sku = view(sim).catalog.skus.find(sku => sku.id === order.lines[0].skuId); return { id, expectedPurchaseRevision: order.revision, mode: "MANUAL", documentNumber: "GUIA-001-2026", checkpoint: "RECEIVE", lines: [{ lineId: "LINE-1", barcode: sku.barcode, lot: "FABRICANTE-ORIGINAL-2026", expiry: "2027-03-01", acceptedCases: 3, quarantineCases: 0, packaging: "OK", label: "OK", qualityDecision: "ACCEPT", ...(sku.zoneId === "COLD" ? { temperatureC: 4 } : sku.zoneId === "FROZEN" ? { temperatureC: -20 } : {}), ...lineMore }], ...more }; }
const inspect = (sim, id, more = {}, lineMore = {}) => sim.command("purchase.inspect", payload(sim, id, more, lineMore), OPS);
function receive(sim, id, inspection) { return sim.command("purchase.receive", { id, inspectionId: inspection.inspectionId, expectedPurchaseRevision: inspection.purchaseRevision }, OPS); }

test("inspección registra evidencia y no crea existencias hasta confirmar la recepción", t => {
  const sim = setup(t), id = purchase(sim), before = view(sim), inspection = inspect(sim, id);
  assert.equal(view(sim).metrics.warehouseCases, before.metrics.warehouseCases); assert.deepEqual(view(sim).hus, before.hus);
  const result = receive(sim, id, inspection), after = view(sim), receipt = after.receipts.find(row => row.id === result.receiptId), hu = after.hus.find(hu => hu.receiptId === receipt.id);
  assert.equal(receipt.simulated, false); assert.equal(receipt.documentNumber, "GUIA-001-2026"); assert.equal(hu.lot, "FABRICANTE-ORIGINAL-2026"); assert.equal(hu.supplierLot, hu.lot); assert.notEqual(hu.id, hu.lot); assert.equal(hu.inspectionId, inspection.inspectionId); assert.equal(after.metrics.warehouseCases, 363);
  assert.equal(after.inspections.find(row => row.id === inspection.inspectionId).state, "CONSUMED"); assert.equal(after.purchases.find(row => row.id === id).state, "PARTIAL");
});
test("inspección simulada se identifica expresamente y conserva la identidad del responsable", t => {
  const sim = setup(t), id = purchase(sim), result = inspect(sim, id, { mode: "SIMULATED" }); receive(sim, id, result);
  assert.equal(view(sim).inspections[0].simulated, true); assert.equal(view(sim).receipts[0].mode, "SIMULATED"); assert.equal(view(sim).receipts[0].receivedBy, OPS.id);
});
test("cada campo de entrada inválido queda identificado y se revierte el expediente completo", t => {
  const sim = setup(t), id = purchase(sim), before = view(sim);
  assert.throws(() => inspect(sim, id, { documentNumber: "", mode: "ROBOT_QUALITY" }, { barcode: "OTRO", lot: "", expiry: "2026-02-30", acceptedCases: 100, packaging: "INVALID", label: "INVALID" }), error => ["documentNumber", "mode", "lines.0.barcode", "lines.0.lot", "lines.0.expiry", "lines.0.acceptedCases", "lines.0.packaging", "lines.0.label"].every(key => error.fieldErrors[key]));
  assert.deepEqual(view(sim).inspections, before.inspections); assert.deepEqual(view(sim).hus, before.hus);
});
test("cadena fría fuera de rango, daño de embalaje y falta de etiqueta obligan a retener", t => {
  for (const [skuId, bad] of [["SKU-YOGUR", { temperatureC: 12 }], ["SKU-HELADO", { temperatureC: -10 }], ["SKU-ARROZ", { packaging: "DAMAGED" }], ["SKU-ARROZ", { label: "MISSING" }]]) {
    const sim = setup(t), id = purchase(sim, skuId);
    assert.throws(() => inspect(sim, id, {}, bad), { status: 422 });
    const held = inspect(sim, id, {}, { ...bad, acceptedCases: 0, quarantineCases: 3, qualityDecision: "HOLD", reason: "Mercancía retenida para evaluación de calidad" }); receive(sim, id, held);
    assert.ok(view(sim).hus.filter(hu => hu.purchaseId === id).every(hu => hu.state === "QUARANTINE")); assert.equal(view(sim).metrics.availableCases, 360);
  }
});
test("retención parcial necesita motivo y decisión coherente sin rechazar cajas conformes", t => {
  const sim = setup(t), id = purchase(sim);
  assert.throws(() => inspect(sim, id, {}, { quarantineCases: 1 }), error => !!error.fieldErrors["lines.0.reason"] && !!error.fieldErrors["lines.0.qualityDecision"]);
  const result = inspect(sim, id, {}, { acceptedCases: 3, quarantineCases: 1, qualityDecision: "PARTIAL_HOLD", reason: "Una caja se retiene por daño de transporte" }); receive(sim, id, result);
  const loads = view(sim).hus.filter(hu => hu.purchaseId === id); assert.equal(loads.reduce((sum, hu) => sum + hu.cases, 0), 4); assert.equal(loads.find(hu => hu.state === "QUARANTINE").cases, 1);
});
test("caducidad del fabricante y lectura del producto no pueden sustituirse por datos implícitos", t => {
  const sim = setup(t), id = purchase(sim);
  assert.throws(() => inspect(sim, id, {}, { expiry: "", lot: "", barcode: "" }), error => ["lines.0.expiry", "lines.0.lot", "lines.0.barcode"].every(key => error.fieldErrors[key]));
  assert.throws(() => inspect(sim, id, {}, { expiry: "2026-01-01" }), error => !!error.fieldErrors["lines.0.expiry"]);
  const result = inspect(sim, id, {}, { expiry: "2026-01-01", acceptedCases: 0, quarantineCases: 3, qualityDecision: "HOLD", reason: "El fabricante declara un lote caducado" }); receive(sim, id, result); assert.equal(view(sim).hus.find(hu => hu.purchaseId === id).state, "QUARANTINE");
});
test("inspecciones se invalidan por revisión, sustitución y consumo; una confirmación no duplica cajas", t => {
  const sim = setup(t), id = purchase(sim), old = inspect(sim, id), current = inspect(sim, id);
  assert.throws(() => receive(sim, id, old), { status: 409 });
  assert.throws(() => sim.command("purchase.receive", { id, inspectionId: current.inspectionId, expectedPurchaseRevision: current.purchaseRevision, lines: [] }, OPS), { status: 422 });
  receive(sim, id, current); const before = view(sim).metrics.warehouseCases; assert.throws(() => receive(sim, id, current), { status: 409 }); assert.equal(view(sim).metrics.warehouseCases, before);
  const rest = inspect(sim, id, {}, { acceptedCases: 2 }); receive(sim, id, rest); assert.equal(view(sim).purchases.find(row => row.id === id).state, "RECEIVED");
});
test("solo operaciones inspecciona y tienda no recibe expedientes, proveedores ni datos térmicos ajenos", t => {
  const sim = setup(t), id = purchase(sim);
  for (const actor of [ADMIN, STORE]) assert.throws(() => sim.command("purchase.inspect", payload(sim, id), actor), { status: 403 });
  inspect(sim, id); const state = sim.snapshot(STORE); assert.deepEqual(state.inspections, []); assert.deepEqual(state.receipts, []); assert.deepEqual(state.purchaseReadModels, []);
});
test("la recepción controlada estricta no admite entrada implícita sin expediente de inspección", t => {
  const sim = setup(t), id = purchase(sim);
  assert.throws(() => sim.command("purchase.receive", { id, lines: [{ lineId: "LINE-1", acceptedCases: 2 }] }, OPS), error => error.status === 422 && !!error.fieldErrors.inspectionId);
  assert.equal(view(sim).metrics.warehouseCases, 360);
});
