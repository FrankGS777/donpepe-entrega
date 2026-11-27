"use strict";
const { Fields, problem } = require("./validation");
const limits = sku => sku.zoneId === "COLD" ? { min: 2, max: 6 } : sku.zoneId === "FROZEN" ? { min: -35, max: -18 } : null;
function migrateReception(s) {
  let changed = false;
  for (const key of ["inspections", "receipts"]) if (!s[key]) { s[key] = []; changed = true; }
  for (const purchase of s.purchases) if (!purchase.revision) { purchase.revision = 1; changed = true; }
  return changed;
}
function inspectPurchase(s, p, actor, context) {
  const purchase = s.purchases.find(row => row.id === p.id); if (!purchase) problem("La compra no existe.", 404);
  if (!["ARRIVED", "PARTIAL"].includes(purchase.state)) problem("La inspección se registra después de la llegada y antes de completar la recepción.", 409);
  if (!Number.isInteger(p.expectedPurchaseRevision) || p.expectedPurchaseRevision !== (purchase.revision || 1)) problem("La recepción cambió en otra sesión. Actualiza los pendientes antes de inspeccionar.", 409);
  const fields = new Fields(), mode = fields.enum(p.mode ?? "MANUAL", "mode", "Origen de la inspección", ["MANUAL", "SIMULATED"]);
  const documentNumber = fields.string(p.documentNumber, "documentNumber", "Guía o documento de entrega", { min: 3, max: 80, required: true });
  const checkpoint = fields.enum(p.checkpoint ?? "RECEIVE", "checkpoint", "Punto de control", ["RECEIVE"]);
  const notes = fields.string(p.notes ?? "", "notes", "Observaciones de recepción", { max: 1000, multiline: true });
  if (!Array.isArray(p.lines) || !p.lines.length || p.lines.length > 12) fields.add("lines", "Inspecciona entre una y doce líneas pendientes.");
  const seen = new Set();
  const lines = Array.isArray(p.lines) ? p.lines.slice(0, 12).map((input, i) => {
    const base = `lines.${i}`, line = purchase.lines.find(line => line.id === input?.lineId), sku = line && s.catalog.skus.find(sku => sku.id === line.skuId);
    if (!line || seen.has(line.id)) { fields.add(`${base}.lineId`, "La línea no pertenece a esta compra o está repetida."); return {}; } seen.add(line.id);
    const acceptedCases = fields.number(input.acceptedCases ?? 0, `${base}.acceptedCases`, "Cajas aceptadas", { min: 0, max: 1000, integer: true });
    const quarantineCases = fields.number(input.quarantineCases ?? 0, `${base}.quarantineCases`, "Cajas retenidas", { min: 0, max: 1000, integer: true });
    if (!acceptedCases && !quarantineCases) fields.add(`${base}.acceptedCases`, "Registra al menos una caja inspeccionada.");
    if (acceptedCases + quarantineCases > line.cases - line.receivedCases) fields.add(`${base}.acceptedCases`, "La cantidad supera las cajas pendientes de esta compra.");
    const barcode = fields.string(input.barcode, `${base}.barcode`, "Código leído o contrastado", { min: 2, max: 40, required: true });
    if (barcode && (sku.barcode ? barcode.padStart(14, "0") !== sku.barcode.padStart(14, "0") : barcode !== sku.code)) fields.add(`${base}.barcode`, "El código no identifica el producto esperado en esta compra.");
    const lot = fields.string(input.lot, `${base}.lot`, "Lote del fabricante", { min: 1, max: 80, required: true });
    const expiry = fields.date(input.expiry ?? "", `${base}.expiry`, "Caducidad del fabricante", { required: sku.expiryControlled });
    if (acceptedCases && sku.expiryControlled && expiry && expiry < context.dateLimit(s)) fields.add(`${base}.expiry`, "El lote no cumple la vida útil mínima; registra esas cajas en cuarentena.");
    const packaging = fields.enum(input.packaging, `${base}.packaging`, "Estado del embalaje", ["OK", "DAMAGED"]);
    const label = fields.enum(input.label, `${base}.label`, "Identificación del lote", ["OK", "MISSING"]);
    const qualityDecision = fields.enum(input.qualityDecision ?? (acceptedCases && quarantineCases ? "PARTIAL_HOLD" : acceptedCases ? "ACCEPT" : "HOLD"), `${base}.qualityDecision`, "Decisión de recepción", ["ACCEPT", "HOLD", "PARTIAL_HOLD"]);
    const reason = fields.string(input.reason ?? "", `${base}.reason`, "Motivo de retención", { min: quarantineCases ? 10 : 0, max: 500, multiline: true });
    const temperatureRange = limits(sku);
    const temperatureC = temperatureRange ? fields.number(input.temperatureC, `${base}.temperatureC`, "Temperatura observada (°C)", { min: -60, max: 60 }) : input.temperatureC == null || input.temperatureC === "" ? null : fields.number(input.temperatureC, `${base}.temperatureC`, "Temperatura observada (°C)", { min: -60, max: 60 });
    const verifiedSplit = mode === "SIMULATED" && context.verifiedDamageSplit === true &&
      packaging === "DAMAGED" && qualityDecision === "PARTIAL_HOLD" && quarantineCases > 0;
    if (acceptedCases && ((!verifiedSplit && packaging !== "OK") || label !== "OK" || qualityDecision === "HOLD")) fields.add(`${base}.qualityDecision`, "Con embalaje dañado, identificación incompleta o decisión de retención no se admite stock disponible.");
    if (acceptedCases && temperatureRange && (temperatureC < temperatureRange.min || temperatureC > temperatureRange.max)) fields.add(`${base}.temperatureC`, "La temperatura no cumple la conservación configurada; retén la mercancía para su evaluación.");
    if (qualityDecision === "ACCEPT" && quarantineCases || qualityDecision === "PARTIAL_HOLD" && (!acceptedCases || !quarantineCases)) fields.add(`${base}.qualityDecision`, "La decisión debe coincidir con las cantidades aceptadas y retenidas.");
    return { lineId: line.id, skuId: sku.id, acceptedCases, quarantineCases, barcode, lot, supplierLot: lot, expiry: expiry || null, packaging, label, qualityDecision, reason, temperatureC, temperatureRange };
  }) : [];
  fields.assert();
  for (const old of s.inspections.filter(item => item.purchaseId === purchase.id && item.state === "RECORDED")) { old.state = "SUPERSEDED"; old.supersededAt = s.clock.now; }
  purchase.revision = (purchase.revision || 1) + 1;
  const inspection = { id: context.id(s, "INS"), purchaseId: purchase.id, purchaseRevision: purchase.revision, supplierId: purchase.supplierId, mode, simulated: mode === "SIMULATED", documentNumber, checkpoint, notes, lines, state: "RECORDED", inspectedBy: actor.id, inspectedAt: s.clock.now };
  s.inspections.push(inspection); purchase.inspectionId = inspection.id;
  context.event(s, "RECEIVING_INSPECTION_RECORDED", `${purchase.id}: ${mode === "SIMULATED" ? "inspección de escenario simulada" : "verificaciones declaradas por el responsable de recepción"}; todavía no se registran existencias.`, { purchaseId: purchase.id, inspectionId: inspection.id, actorId: actor.id, simulated: inspection.simulated });
  return { id: purchase.id, inspectionId: inspection.id, purchaseRevision: purchase.revision };
}
function inspectionForReceipt(s, purchase, p) {
  const inspection = s.inspections.find(row => row.id === p.inspectionId && row.purchaseId === purchase.id);
  if (!inspection || inspection.state !== "RECORDED") problem("La inspección no existe, fue sustituida o ya se utilizó.", 409);
  if (p.expectedPurchaseRevision !== (purchase.revision || 1) || inspection.purchaseRevision !== purchase.revision) problem("Los pendientes cambiaron después de la inspección. Revisa e inspecciona de nuevo.", 409);
  if (p.lines !== undefined) problem("La recepción utiliza las cantidades de la inspección aprobada; no envíes otras líneas.", 422);
  return inspection;
}
function receiptReadModels(s) { return s.purchases.map(purchase => ({ purchaseId: purchase.id, revision: purchase.revision || 1, canInspect: ["ARRIVED", "PARTIAL"].includes(purchase.state), checkpoint: "RECEIVE", inspectionId: purchase.inspectionId || null, pendingLines: purchase.lines.filter(line => line.cases > line.receivedCases).map(line => { const sku = s.catalog.skus.find(sku => sku.id === line.skuId), range = limits(sku); return { lineId: line.id, skuId: sku.id, pendingCases: line.cases - line.receivedCases, expectedBarcode: sku.barcode || sku.code, expiryControlled: sku.expiryControlled, temperatureMin: range?.min ?? null, temperatureMax: range?.max ?? null }; }), receipts: s.receipts.filter(receipt => receipt.purchaseId === purchase.id).map(receipt => receipt.id) })); }
module.exports = { migrateReception, inspectPurchase, inspectionForReceipt, receiptReadModels };
