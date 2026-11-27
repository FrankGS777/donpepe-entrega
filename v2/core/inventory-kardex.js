"use strict";
const { can } = require("../security/policy");
const { describeLocation, compactLocationLabel } = require("./location-description");
const { timeFields } = require("./time");
const { explainMovement } = require("./movement-presentation");

const TYPE_LABELS = Object.freeze({ SUPPLIER_RETURN: "Devolución al proveedor", OPENING: "Saldo de apertura", RECEIPT: "Entrada de proveedor", TRANSFER: "Traslado interno", SPLIT: "Separación de cajas", STORE_RECEIPT: "Recepción en tienda", STORE_SALE: "Salida de tienda", RETURN: "Devolución", WRITE_OFF: "Baja documentada", DIFFERENCE: "Diferencia de recepción", QUALITY_HOLD: "Retención de calidad", QUALITY_RELEASE: "Liberación de calidad", DISPATCH: "Salida hacia tienda", STATUS: "Cambio de disponibilidad" });
function position(s, locationId, extra = {}) {
  if (typeof locationId !== "string" || !locationId) return { id:"UNRECORDED",label:"Ubicación no registrada",scope:"UNKNOWN",branchId:null,...extra };
  const branch = s.catalog.branches.find(row => row.id === locationId);
  const robot = s.robots.find(row => row.id === locationId), truck = s.trucks.find(row => row.id === locationId);
  const location = s.layout.locations.find(row => row.id === locationId), station = s.layout.stations.find(row => row.id === locationId);
  return { ...describeLocation(s, locationId), scope: branch ? "STORE" : truck ? "TRANSPORT" : robot ? "DEVICE" : locationId.startsWith("INCIDENT-") ? "DISCREPANCY" : "WAREHOUSE", branchId: branch?.id || null, ...extra };
}
function captureInventory(s) {
  const records = [];
  for (const hu of s.hus) if (hu.cases > 0) records.push({ key: `HU:${hu.id}`, skuId: hu.skuId, lot: hu.lot || "", expiry: hu.expiry || null, cases: hu.cases, state: hu.state, reservedCases: hu.reservedCases || 0, huId: hu.id, parentHuId: hu.parentId || null, purchaseId: hu.purchaseId || null, orderId: hu.orderId || null, returnId: hu.returnId || null, position: position(s, hu.locationId, { positionId: hu.truckSlotId || hu.stagingSlotId || null, branchId: s.trucks.find(t => t.id === hu.locationId)?.branchId || null }) });
  for (const stock of s.storeStock) if (stock.cases > 0) records.push({ key: `STOCK:${stock.id}`, skuId: stock.skuId, lot: stock.lot || "", expiry: stock.expiry || null, cases: stock.cases, state: "STORE_STOCK", huId: null, stockId: stock.id, orderId: stock.orderId || null, position: position(s, stock.branchId) });
  for (const ret of s.returns.filter(ret => ret.state !== "QUARANTINED")) for (const [index, load] of ret.loads.entries()) if (load.cases > 0) {
    const carried = ret.state === "RETURNING";
    records.push({ key: `RETURN:${ret.id}:${index}`, skuId: ret.skuId, lot: load.lot || "", expiry: load.expiry || null, cases: load.cases, state: ret.state, huId: null, returnId: ret.id, orderId: ret.orderId, position: { id: carried ? ret.truckId : `${ret.branchId}:RETURNS`, label: carried ? s.trucks.find(t => t.id === ret.truckId)?.name || ret.truckId : `${s.catalog.branches.find(b => b.id === ret.branchId)?.name || ret.branchId} · apartada para devolución`, scope: carried ? "TRANSPORT" : "STORE", branchId: ret.branchId } });
  }
  return records;
}
const batchKey = row => JSON.stringify([row.skuId, row.lot, row.expiry]);
const locationKey = row => `${row.position.id}:${row.position.positionId || ""}`;
function external(s, context, direction, row) {
  if (direction === "from") {
    const supplierId = s.purchases.find(p => p.id === row.purchaseId || p.id === context.documentId)?.supplierId;
    const supplier = s.catalog.suppliers.find(p => p.id === supplierId);
    return { id: supplierId ? `SUPPLIER:${supplierId}` : "EXTERNAL", label: supplier?.name || "Entrada externa", scope: "EXTERNAL", branchId: null };
  }
  if(context.type==='supplierClaim.handover') { const claim=s.supplierClaims.find(c=>c.id===context.documentId);return {id:`SUPPLIER:${claim?.supplierId||'UNKNOWN'}`,label:claim?.supplierName||'Proveedor',scope:'EXTERNAL',branchId:null}; }
  return { id: context.type === "store.consume" ? `SALE:${context.branchId || row.position.branchId}` : "WRITE_OFF", label: context.type === "store.consume" ? "Salida por venta en tienda" : "Baja documentada", scope: "EXTERNAL", branchId: row.position.branchId || null };
}
function movementType(from, to, context) {
  if (!from) return "RECEIPT";
  if (!to && context.type==='supplierClaim.handover') return 'SUPPLIER_RETURN';
  if (!to) return context.type === "store.consume" ? "STORE_SALE" : "WRITE_OFF";
  if (to.state === "DISCREPANCY") return "DIFFERENCE";
  if (context.type === "return.create" || from.returnId || to.returnId) return "RETURN";
  if (to.position.scope === "STORE" && from.position.scope !== "STORE") return "STORE_RECEIPT";
  if (to.parentHuId === from.huId && to.huId !== from.huId) return "SPLIT";
  return "TRANSFER";
}
function record(s, before, after, from, to, cases, context, type) {
  const row = to || from, sku = s.catalog.skus.find(sku => sku.id === row.skuId);
  const mission = s.missions.find(m => (m.huId === row.huId || m.shipmentHuId === row.huId) && (m.state === "ACTIVE" || m.completedAt === s.clock.now));
  const fromPosition = from?.position || external(s, context, "from", row), toPosition = to?.position || external(s, context, "to", row);
  const matches = item => batchKey(item) === batchKey(row);
  const sameLocation = item => matches(item) && item.position.id === (to?.position.id || from?.position.id);
  return { at: s.clock.now, type, typeLabel: TYPE_LABELS[type], skuId: row.skuId, skuCode: sku?.code || row.skuId, skuName: sku?.name || row.skuId, imageUrl: sku?.imageUrl || "", brandId: sku?.brandId || null, categoryId: sku?.categoryId || null, lot: row.lot, expiry: row.expiry, huId: to?.huId || from?.huId || null, sourceHuId: from?.huId || null, parentHuId: to?.parentHuId || null, from: fromPosition, to: toPosition, cases, beforeCases: before.filter(sameLocation).reduce((n,r) => n+r.cases,0), afterCases: after.filter(sameLocation).reduce((n,r) => n+r.cases,0), locationBalanceCases: after.filter(sameLocation).reduce((n,r) => n+r.cases,0), networkBalanceCases: after.filter(matches).reduce((n,r) => n+r.cases,0), balanceScope: "SKU_LOT_EXPIRY_AT_DESTINATION", balanceTiming: "AFTER_EVENT", documentId: context.documentId || row.returnId || row.orderId || mission?.orderId || mission?.referenceOrderId || row.purchaseId || null, missionId:mission?.id || null, correlationId:context.correlationId || null, actorId: context.actorId || "AUTOMATION", actorRole: context.actorRole || "automation", deviceId: [fromPosition,toPosition].find(p => ["DEVICE","TRANSPORT"].includes(p.scope))?.id || mission?.robotId || null, command: context.type || "automation", reason: context.reason || null, sourceState: from?.state || null, targetState: to?.state || null };
}
function openingMovements(s, inventory) {
  return inventory.map(row => ({ ...record(s, [], inventory, null, row, row.cases, { type: "kardex.opening", actorId: "SYSTEM", actorRole: "system" }, "OPENING"), from: { id: "OPENING", label: "Saldo comprobado al activar el kardex", scope: "OPENING", branchId: null }, reason: "Saldo existente al activar este registro. No reconstruye movimientos históricos sin evidencia." }));
}
function inventoryChanges(s, before, after, context = {}) {
  const previous = new Map(before.map(row => [row.key,row])), current = new Map(after.map(row => [row.key,row]));
  const decreases = [], increases = [], changes = [];
  for (const row of before) {
    const next = current.get(row.key), same = next && locationKey(next) === locationKey(row);
    const delta = same ? row.cases - next.cases : row.cases;
    if (delta > 0) decreases.push({ row, remaining: delta });
    if (same && next.cases === row.cases && next.state !== row.state) {
      const type = next.state === "QUARANTINE" ? "QUALITY_HOLD" : row.state === "QUARANTINE" && ["RECEIVED", "WAITING_PUTAWAY"].includes(next.state) ? "QUALITY_RELEASE" : next.state === "IN_TRANSIT" ? "DISPATCH" : ["WAITING_SUPPLIER_RETURN","SUPPLIER_RETURN_READY"].includes(next.state) ? "STATUS" : null;
      if (type) changes.push(record(s,before,after,row,next,next.cases,context,type));
    }
  }
  for (const row of after) {
    const prev = previous.get(row.key), same = prev && locationKey(prev) === locationKey(row);
    const delta = same ? row.cases - prev.cases : row.cases;
    if (delta > 0) increases.push({ row, remaining: delta });
  }
  // Pair identical loads first, then parent/child separation, then matching batch.
  // The result records actual inventory deltas, never reservations or camera poses.
  for (const priority of [0,1,2]) for (const minus of decreases) for (const plus of increases) {
    if (!minus.remaining || !plus.remaining || batchKey(minus.row) !== batchKey(plus.row)) continue;
    const matchPriority = minus.row.key === plus.row.key ? 0 : plus.row.parentHuId && plus.row.parentHuId === minus.row.huId ? 1 : 2;
    if (priority !== matchPriority) continue;
    const quantity = Math.min(minus.remaining, plus.remaining);
    changes.push(record(s,before,after,minus.row,plus.row,quantity,context,movementType(minus.row,plus.row,context)));
    minus.remaining -= quantity; plus.remaining -= quantity;
  }
  for (const item of decreases) if (item.remaining) changes.push(record(s,before,after,item.row,null,item.remaining,context,movementType(item.row,null,context)));
  for (const item of increases) if (item.remaining) changes.push(record(s,before,after,null,item.row,item.remaining,context,movementType(null,item.row,context)));
  changes.forEach(row => { row.externalReference = context.reference || null; Object.assign(row, timeFields(row.at)); });
  return changes;
}
function validateQuery(query) {
  const fail = message => { const error = new Error(message); error.status = 422; throw error; };
  const next = {};
  for (const key of ["query","skuId","lot","type"]) if (query[key] !== undefined && query[key] !== "") { if (typeof query[key] !== "string" || query[key].length > (key === "query" ? 160 : 100)) fail("El filtro del kardex no es válido."); next[key] = query[key].trim(); }
  if (next.type && !TYPE_LABELS[next.type]) fail("Selecciona un tipo de movimiento válido.");
  for (const key of ["fromDate","toDate"]) if (query[key]) { const date = typeof query[key] === "string" ? new Date(`${query[key]}T00:00:00Z`) : null; if (typeof query[key] !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(query[key]) || !date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== query[key]) fail("Usa una fecha válida para filtrar el kardex."); next[key] = query[key]; }
  if (next.fromDate && next.toDate && next.fromDate > next.toDate) fail("La fecha inicial no puede ser posterior a la final.");
  for (const [key,initial,max] of [["page",1,1000000],["pageSize",25,100]]) { const value = query[key] ?? initial; if (!/^\d+$/.test(String(value)) || Number(value)<1 || Number(value)>max) fail("La paginación del kardex no es válida."); next[key] = Number(value); }
  return next;
}
function readMovements(store, actor, query = {}) {
  if (!actor || !(actor.role === "admin" ? can(actor,"inventory.summary.read") : can(actor,"inventory.read"))) { const error = new Error("Tu perfil no tiene acceso al kardex de este ámbito."); error.status = 403; throw error; }
  if (actor.role === "store" && !actor.branchId) { const error = new Error("Tu cuenta no tiene una tienda asignada."); error.status = 403; throw error; }
  const filters = validateQuery(query), result = store.queryMovements({ ...filters, branchId: actor.role === "store" ? actor.branchId : null });
  const coverage = store.kardexMetadata();
  if (actor.role === "store") for (const item of result.items) { item.networkBalanceCases = null; if (item.from.branchId !== actor.branchId) item.from = { id: "CENTRAL", label: "Centro de distribución", scope: "WAREHOUSE", branchId: null }; if (item.to.branchId !== actor.branchId) { item.beforeCases = null; item.afterCases = null; item.locationBalanceCases = null; item.to = { id: "CENTRAL", label: item.to.scope === "EXTERNAL" ? item.to.label : "Centro de distribución", scope: item.to.scope, branchId: null }; } }
  const currentState = actor.role === "store" ? null : store.read();
  result.items.forEach(item => {
    Object.assign(item, timeFields(item.at));
    if (currentState) for (const key of ["from", "to"]) if (item[key]?.id && currentState.layout.locations.some(row => row.id === item[key].id)) {
      const description = describeLocation(currentState, item[key].id);
      item[key] = { ...item[key], code: description.code, label: description.label, components: description.components };
    }
    for (const key of ["from", "to"]) if (item[key]?.label) item[key].label = compactLocationLabel(item[key].label);
    // Derive the explanation after branch isolation and descriptive locations.
    // A store must never receive an internal address through a summary string.
    item.explanation = explainMovement(item);
  });
  return { ...result, timeZone: "America/Lima", sort: "newest", page: filters.page, pageSize: filters.pageSize, pages: Math.max(1,Math.ceil(result.total/filters.pageSize)), types: result.types.map(type => ({ id: type,label: TYPE_LABELS[type] })), coverage };
}
module.exports = { TYPE_LABELS, captureInventory, openingMovements, inventoryChanges, readMovements };
