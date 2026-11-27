const {migrateCommercialCatalog,issueSupplierInvoice,cancelSupplierInvoice}=require("./supplier-invoices");
"use strict";
const { financeCommand, financeReadModel } = require("./finance-domain");
const { migrateSupplierClaims, supplierClaimCommand, supplierClaimsReadModel } = require("./supplier-claims");
const { createStore } = require("./store");
const { createHash, randomUUID: cryptoRandomId } = require("node:crypto");
const { createBlueprint, createLoadingDocks, SKUS, BRANCHES, SUPPLIERS } = require("./blueprint");
const { assertCommandAllowed, effectivePermissions } = require("../security/policy");
const { Fields, VALIDATION_CATALOG } = require("./validation");
const { COLLECTIONS, changeCatalogStatus, migrateCatalogLifecycle } = require("./catalog-lifecycle");
const { limaDate, addLimaDays, timeFields } = require("./time");
const { describeLocation } = require("./location-description");
const EVENT_CONTEXT = new WeakMap();
const { migrateCatalog, masterCommand, productReferences, eligibleSupplierIds } = require("./catalog-domain");
const { migrateEquipment, assetCommand, maintenanceCommand, deviceAvailable, tickMaintenance, assetReadModel, safeToService } = require("./equipment-domain");
const { DEVICE_SETTING_SCHEMAS, migrateDeviceSettings, tickDeviceSettings, speedFactor, priorityOf, taskAllowed } = require("./device-settings");
const { migrateReception, inspectPurchase, inspectionForReceipt, receiptReadModels } = require("./reception-domain");
const { captureInventory, openingMovements, inventoryChanges, readMovements } = require("./inventory-kardex");
const { migrateAutonomyConfiguration, autonomyConfigurationCommand, autonomyConfigurationReadModel, automaticEquipmentStatus } = require("./autonomy-config");
const { migrateAutonomy, authorizeAutonomy, cancelInboundProcess, autonomyCommand, tickAutonomy, autonomyReadModel } = require("./autonomy-domain");
const { migrateAutomationBlueprint } = require("./automation-blueprint");
const { autonomyMapFrame } = require("./autonomy-map");
const { advanceGuided } = require("./physical-guidance");
const { stationTransferSeconds } = require("./mechanical-timing");
const { defectLabel, damagedCaseCount } = require("./packaging-quality");
const { motionGuide, TRUCK_GUIDE_VERSION } = require("./motion-guide");
const { migrateWarehouseExpansion } = require("./warehouse-expansion");
const { tickExpiry, expiryReadModel, expired } = require("./expiry-domain");

const START = "2026-10-17T13:00:00.000Z";
const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
const PATH_CACHE = new Map();
const CAPABILITIES = {
  admin: ["view", "configuration"],
  operations: ["view", "purchases", "receive", "orders", "release", "dispatch", "equipment", "simulation", "inventory"],
  store: ["view", "orders", "storeReceive", "returns", "consume"],
};
const FIELD_LABELS = { Nombre: "name", Código: "code", Marca: "brand", Categoría: "category", Presentación: "presentation", "Código de barras": "barcode", "Punto de reposición": "reorderPoint", "Foto del producto": "imageUrl", "Logo del proveedor": "logoUrl", Contacto: "contact", Correo: "email", Teléfono: "phone", "Sitio web": "site", "Plazo de entrega": "leadDays", "Unidades por caja": "unitsPerCase", "Cajas por unidad de carga": "maxCasesPerHu", Notas: "notes", "Cajas máximas por pedido": "maxOrderCases", "Vida útil mínima": "minShelfLifeDays", "Pedidos abiertos por tienda": "maxOpenOrdersPerBranch", "Duración didáctica del viaje": "travelSeconds" };
FIELD_LABELS.Motivo = "reason";
const fail = (message, status = 422, field) => { const e = new Error(message); e.status = status; const target = field || FIELD_LABELS[message.split(":")[0]]; if (target) e.fieldErrors = { [target]: message }; throw e; };
const num = (value, label = "Cantidad", max = 1000, allowZero = false) => {
  if (!["string", "number"].includes(typeof value) || (typeof value === "string" && !/^\d+$/.test(value))) fail(`${label}: introduce un número entero válido.`);
  const n = Number(value); if (!Number.isInteger(n) || n < (allowZero ? 0 : 1) || n > max) fail(`${label}: usa un número entero entre ${allowZero ? 0 : 1} y ${max}.`); return n;
};
const text = (value, label, max = 300) => { if (value == null) return ""; if (typeof value !== "string") fail(`${label}: introduce un texto válido.`); return value.trim().slice(0, max); };
const distance = (a, b) => Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), a.z - b.z);
const clone = (x) => structuredClone(x);
const ZONES = ["DRY", "COLD", "FROZEN", "CLEANING"];
const DEFAULT_SETTINGS = { packagingDamagePercent: 12, maxOrderCases: 120, minShelfLifeDays: 0, maxOpenOrdersPerBranch: 25 };
const isOpenOrder = (o) => !["RECEIVED", "RECEIVED_WITH_DIFFERENCE", "CANCELLED", "CANCELLED_AFTER_PREPARATION"].includes(o.state);
const isOpenPurchase = (p) => !["RECEIVED", "CANCELLED"].includes(p.state);
function canCancelPurchase(s, purchase, job) {
  if (purchase.lines.some(line => line.receivedCases)) return false;
  if (purchase.state === "ORDERED") return true;
  return purchase.state === "ARRIVED" && s.configuration.autonomy.mode === "SIMULATED" &&
    job?.state === "EXCEPTION" && !job.receiptIds?.length &&
    !s.hus.some(hu => hu.purchaseId === purchase.id) && !s.receipts.some(receipt => receipt.purchaseId === purchase.id);
}
const dateLimit = (s) => addLimaDays(s.clock.now, s.configuration.settings.minShelfLifeDays);
const isFresh = (s, hu) => !hu.expiry || hu.expiry >= dateLimit(s);
function fingerprint(type, payload) {
  const normalize = (value) => {
    if (value === null || ["string", "boolean"].includes(typeof value)) return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map(normalize);
    if (value && typeof value === "object" && [Object.prototype, null].includes(Object.getPrototypeOf(value))) return Object.fromEntries(Object.keys(value).sort().filter((k) => k !== "commandId").map((k) => [k, normalize(value[k])]));
    fail("La acción contiene valores no válidos.");
  };
  let serialized; try { serialized = JSON.stringify([type, normalize(payload)]); } catch (error) { if (error.status) throw error; fail("La estructura de la acción no es válida."); }
  if (serialized.length > 64000) fail("La acción supera el tamaño permitido.");
  return createHash("sha256").update(serialized).digest("hex");
}
function strictText(value, label, max = 100, min = 2, { multiline = false } = {}) { const result = typeof value === "string" ? (multiline ? value.replace(/\r\n/g, "\n") : value).trim() : ""; const controls = multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/; if (typeof value !== "string" || result.length < min || result.length > max || controls.test(result)) fail(`${label}: usa entre ${min} y ${max} caracteres.`); return result; }
function code(value, label = "Código") { const result = strictText(value, label, 32).toUpperCase(); if (!/^[A-Z0-9][A-Z0-9_-]+$/.test(result)) fail(`${label}: usa letras, números, guiones o guion bajo.`); return result; }
function unique(list, value, field, exceptId) { const normalize = value => field === "barcode" ? String(value || "").padStart(14, "0") : String(value || "").normalize("NFKC").trim().toLocaleLowerCase("es"); if (list.some((r) => r.id !== exceptId && normalize(r[field]) === normalize(value))) fail(`Ya existe un registro con ese ${field === "code" ? "código" : field === "barcode" ? "código de barras" : "nombre"}.`, 409, field); }
function optionalText(value, label, max = 100, options) { return value == null || value === "" ? "" : strictText(value, label, max, 1, options); }
function localImage(value, label) {
  const result = optionalText(value, label, 180);
  if (result && !/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif|svg)$/.test(result)) fail(`${label}: selecciona una imagen local válida de la biblioteca.`, 422, label === "Logo del proveedor" ? "logoUrl" : "imageUrl");
  return result;
}
function gtin(value) {
  const result = optionalText(value, "Código de barras", 14);
  if (!result) return result;
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(result)) fail("Código de barras: usa un GTIN de 8, 12, 13 o 14 dígitos.");
  const sum = [...result.slice(0, -1)].reverse().reduce((total, digit, i) => total + Number(digit) * (i % 2 ? 1 : 3), 0);
  if ((10 - sum % 10) % 10 !== Number(result.at(-1))) fail("Código de barras: el dígito de control no es válido.");
  return result;
}
function supplierContact(next, data, existing) {
  next.contact = optionalText(data.contact ?? existing?.contact, "Contacto", 100);
  next.email = optionalText(data.email ?? existing?.email, "Correo", 120).toLowerCase();
  if (next.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.email)) fail("Correo: introduce una dirección válida.");
  next.phone = optionalText(data.phone ?? existing?.phone, "Teléfono", 30);
  if (next.phone && !/^\+?[\d ()-]{6,30}$/.test(next.phone)) fail("Teléfono: usa dígitos, espacios, paréntesis y guiones.");
  next.site = optionalText(data.site ?? existing?.site, "Sitio web", 220);
  if (next.site) { let url; try { url = new URL(next.site); } catch { fail("Sitio web: introduce una dirección HTTPS válida."); } if (url.protocol !== "https:" || url.username || url.password || !url.hostname.includes(".")) fail("Sitio web: introduce una dirección HTTPS válida."); next.site = url.href; }
  next.leadDays = num(data.leadDays ?? existing?.leadDays ?? 2, "Plazo de entrega", 90, true);
  next.logoUrl = localImage(data.logoUrl ?? existing?.logoUrl, "Logo del proveedor");
}
function migrate(s) {
  let changed = false;
  if (migrateSupplierClaims(s)) changed = true;
  if (migrateWarehouseExpansion(s)) changed = true;
  if (!s.configuration) { s.configuration = { revision: 1, settings: clone(DEFAULT_SETTINGS) }; changed = true; }
  if (!s.ledger.writtenOffCases) s.ledger.writtenOffCases = 0;
  for (const [kind, records] of Object.entries(s.catalog)) for (let i = 0; i < records.length; i++) {
    const r = records[i]; if (r.active === undefined) { r.active = true; changed = true; }
    if (!r.code) { r.code = kind === "suppliers" ? `PROV-${String(i + 1).padStart(3, "0")}` : r.id; changed = true; }
  }
  if (s.catalogMetadataVersion !== 1) {
    const oldNames = ["Arroz extra 1 kg", "Aceite vegetal 900 ml", "Fideos 500 g", "Azúcar rubia 1 kg", "Atún en conserva 170 g", "Leche UHT 1 litro", "Yogur natural 1 litro", "Queso fresco 500 g", "Jugo refrigerado 1 litro", "Helado 1 litro", "Pollo congelado 1 kg", "Detergente 1 kg"];
    for (const [i, seed] of SKUS.entries()) {
      const record = s.catalog.skus.find(sku => sku.id === seed.id);
      if (!record || record.updatedAt || record.code !== seed.code || record.name !== oldNames[i] || record.zoneId !== seed.zoneId || record.unitsPerCase !== seed.unitsPerCase || record.supplierId !== seed.supplierId || ["brand", "category", "presentation", "barcode", "imageUrl"].some(key => record[key] !== undefined)) continue;
      record.name = seed.name;
      for (const key of ["brand", "category", "presentation", "barcode", "reorderPoint", "imageUrl", "referenceUrl"]) if (record[key] === undefined) record[key] = seed[key];
    }
    const supplierNames = ["Proveedor de abarrotes · escenario", "Proveedor de cadena fría · escenario", "Proveedor de limpieza · escenario"];
    for (const [i, seed] of SUPPLIERS.entries()) {
      const record = s.catalog.suppliers.find(supplier => supplier.id === seed.id);
      if (!record || record.updatedAt || record.name !== supplierNames[i] || JSON.stringify(record.zones) !== JSON.stringify(seed.zones)) continue;
      record.name = seed.name;
      for (const key of ["contact", "email", "phone", "site", "leadDays", "logoUrl", "sourcingNote", "referenceUrl"]) if (record[key] === undefined) record[key] = seed[key];
    }
    s.catalogMetadataVersion = 1; changed = true;
  }
  for (const order of s.orders) if (!order.source) { order.source = order.createdBy === "SCENARIO" ? "SCENARIO" : "LEGACY"; order.simulated = order.source === "SCENARIO"; changed = true; }
  // Old receipts did not carry per-order ownership of store lots. Preserve the
  // balance, but conservatively assign provenance only when it is unambiguous.
  for (const stock of s.storeStock) if (!Object.hasOwn(stock, "orderId")) {
    const delivered = s.orders.filter((o) => o.branchId === stock.branchId && ["RECEIVED", "RECEIVED_WITH_DIFFERENCE"].includes(o.state) && o.allocations.some((a) => { const h = s.hus.find((h) => h.id === a.huId); return h?.skuId === stock.skuId && h?.lot === stock.lot && h?.expiry === stock.expiry; }));
    stock.orderId = delivered.length === 1 ? delivered[0].id : null; changed = true;
  }
  if (!s.layout.loadingDocks) { s.layout.loadingDocks = createLoadingDocks(s.layout.stations); changed = true; }
  if (s.physicalLoadingVersion !== 1) {
    const dispatch = s.layout.zones.find(zone => zone.id === "DISPATCH"); if (dispatch) Object.assign(dispatch, { x: 36, z: 20, width: 28, depth: 27 });
    s.layout.roads = [{ id: "YARD", points: [{ x: -55, z: 60 }, { x: 65, z: 60 }], width: 7 }];
    s.layout.truckParking = [1, 2, 3].map(index => ({ id: `PARK-TRUCK-${index}`, x: 20 + index * 9, z: 75, heading: 0, width: 3.8, length: 19 }));
    s.physicalLoadingVersion = 1; changed = true;
  }
  if (!s.dockReservations) { s.dockReservations = {}; changed = true; }
  for (const dock of s.layout.loadingDocks) if (!s.robots.some(robot => robot.id === dock.forkliftId)) {
    s.robots.push({ id: dock.forkliftId, name: `Montacargas automático · ${dock.name}`, type: "FORKLIFT", dockId: dock.id, zoneId: "DISPATCH", nodeId: `${dock.id}-HOME`, ...dock.forkliftHome, state: "IDLE", battery: 100, capacityCases: 24, capacityKg: 1500, carryingHuId: null, missionId: null, orderId: null, loadingPhase: "IDLE", liftHeight: 0.18, cargoOffsetZ: 1.35, route: [], routeIndex: 0, capabilities: ["DOCK_LOADING_ONLY"], model: "Montacargas de muelle simulado · no conectado" }); changed = true;
  }
  for (const robot of s.robots.filter(robot => robot.type === "AMR")) if (robot.cargoHeight === undefined) { robot.cargoHeight = 0.95; changed = true; }
  for (const [index, truck] of s.trucks.entries()) {
    if (!truck.loadPositions) { truck.loadPositions = emptyLoadPositions(); truck.doorProgress = 0; truck.loadingState = null; truck.dockId = null; truck.heading ??= 0; truck.parkPose = { x: 29 + index * 9, y: 0, z: 75, heading: 0 }; if (truck.state === "AVAILABLE") { truck.x = truck.parkPose.x; truck.z = truck.parkPose.z; } changed = true; }
    const oldLoads = s.hus.filter(hu => hu.cases && hu.locationId === truck.id && !hu.truckSlotId);
    for (const [i, hu] of oldLoads.entries()) {
      let slot = truck.loadPositions.find(slot => !slot.huId);
      if (!slot) { slot = { id: `LEGACY-${i + 1}`, x: 0, y: 1.2, z: 0, width: 1.16, depth: 0.94, legacyOverflow: true }; truck.loadPositions.push(slot); truck.legacyLoadOverflow = true; }
      slot.huId = hu.id; slot.zoneId = skuFor(s, hu.skuId).zoneId; hu.truckSlotId = slot.id; changed = true;
    }
  }
  for (const hu of s.hus.filter(hu => hu.cases && /^DOCK-[12]$/.test(hu.locationId))) if (!hu.stagingSlotId) { assignStagingSlot(s, hu, hu.locationId); changed = true; }
  if (migrateCatalog(s)) changed = true;
  if (migrateCommercialCatalog(s)) changed = true;
  if (migrateEquipment(s)) changed = true;
  if (migrateCatalogLifecycle(s)) changed = true;
  if (migrateAutonomyConfiguration(s)) changed = true;
  if (migrateDeviceSettings(s)) changed = true;
  if (migrateReception(s)) changed = true;
  if (migrateAutonomy(s)) changed = true;
  if (migrateAutomationBlueprint(s)) changed = true;
  if (!s.controlledReceivingVersion) { s.controlledReceivingVersion = 1; s.configuration.revision++; changed = true; }
  if (!s.catalogGovernanceVersion) { s.catalogGovernanceVersion = 1; s.configuration.revision++; changed = true; }
  for (const order of s.orders) if (!order.revision) { order.revision = 1; changed = true; }
  return changed;
}
const quarantineId = (sku) => sku.zoneId === "COLD" ? "Q-COLD" : sku.zoneId === "FROZEN" ? "Q-FROZEN" : sku.zoneId === "CLEANING" ? "Q-CLEANING" : "Q";
const BUFFER_CAPACITY = { RECEIVE: 12, Q: 4, "Q-COLD": 4, "Q-FROZEN": 4, "Q-CLEANING":4, PACK: 4, "DOCK-1": 24, "DOCK-2": 24 };
function buffered(s, stationId) { return s.hus.filter((h) => h.cases > 0 && (h.locationId === stationId || (h.loadingOriginDockId === stationId && h.loadingOrderId && s.orders.some(order => order.id === h.loadingOrderId && order.state === "LOADING")))).length; }
function reservedReturns(s, stationId) { return s.returns.filter((r) => r.state !== "QUARANTINED" && quarantineId(skuFor(s, r.skuId)) === stationId).reduce((n, r) => n + r.loads.length, 0); }
function inboundBuffers(s, stationId) { return s.missions.filter((m) => m.state === "ACTIVE" && m.destinationId === stationId).length; }
function checkIncomingBuffers(s, additions) { for (const [stationId, quantity] of Object.entries(additions)) if (buffered(s, stationId) + reservedReturns(s, stationId) + inboundBuffers(s, stationId) + quantity > BUFFER_CAPACITY[stationId]) fail(`${stationId}: capacidad de espera agotada (${BUFFER_CAPACITY[stationId]} unidades de carga). Recibe menos cajas o resuelve primero la retención/almacenamiento.`, 409); }
function bufferDemand(s, mission) {
  const capacity = BUFFER_CAPACITY[mission.destinationId]; if (!capacity) return true;
  const weight = (m) => m.destinationId === "PACK" && m.shipmentHuId && m.cases > m.allocatedCases ? 2 : 1;
  const inbound = s.missions.filter((m) => m.state === "ACTIVE" && m.destinationId === mission.destinationId && m.id !== mission.id).reduce((n, m) => n + weight(m), 0);
  const extraSplit = mission.destinationId === "PACK" ? s.hus.filter((h) => h.locationId === "PACK" && h.state === "PACKING" && h.cases > h.packContext?.cases).length : 0;
  return buffered(s, mission.destinationId) + reservedReturns(s, mission.destinationId) + inbound + extraSplit + weight(mission) <= capacity;
}
function truckTrip(s, from, to, duration, device) {
  // A full trailer needs a turning pocket before the shop frontage. Fourteen
  // metres cleared its centre line but swept the front corner into the shop.
  const approachX = to.approachAlongX ? to.x - 24 : to.x;
  const parkingArrival = !to.approachAlongX && to.z === 75;
  const fromApron = from.z >= 35 && from.z < 60 || from.z === 75;
  const fromStore = s.layout.branches.find(branch => Math.abs(branch.x - from.x) < .1 && Math.abs(branch.z + 12 - from.z) < .1);
  const atMainRoad = Math.abs(from.z - 60) < .1;
  const northReturn = fromStore && from.x > 50 && atMainRoad && parkingArrival;
  // The road-entry turn shares the clear west pocket with returning trucks.
  // A dock-relative x-18 turn can put the front mirrors against a parked
  // trailer even when its centreline appears outside the parking bay.
  let roadEntry = fromApron ? [{ x: from.x, z: 54, heading: device?.heading || 0 }, { x: 10, z: 54 }, { x: 10, z: 60 }] : [{ x: from.x, z: 60 }];
  if (fromStore) {
    // Withdraw straight backwards from the receiving bay before changing the
    // trailer's heading. A turn beside the facade sweeps through the building.
    const pocketX = from.x - (from.x > 50 ? 20 : 24);
    roadEntry = [{ x: pocketX, z: from.z, heading: Math.PI / 2 },
      ...(from.x > 50 && atMainRoad ? [{ x: pocketX, z: 56 }, { x: 10, z: 56 }, ...(northReturn ? [] : [{ x: 10, z: 60 }])] : [{ x: pocketX, z: 60 }])];
    // This shop is already parallel to the main road, facing the depot. There
    // is no turning envelope to clear: reversing 24 m and driving forward over
    // that same stretch looked like a failed route correction.
    if (atMainRoad && from.x < 10 && parkingArrival) roadEntry = [];
  }
  const parkingApproach = parkingArrival ? [...(northReturn ? [] : [{ x: 10, z: 60 }]), { x: 10, z: 54 }, { x: to.x, z: 54 }] : [{ x: approachX, z: 60 }, ...(to.approachAlongX ? [{ x: approachX, z: to.z }] : [])];
  const waypoints = [{ x: from.x, z: from.z }, ...roadEntry, ...parkingApproach, { x: to.x, z: to.z }];
  return { physicalGuideVersion: TRUCK_GUIDE_VERSION, startedAt: s.clock.elapsed, duration: duration / speedFactor(device), from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z }, waypoints, length: waypoints.slice(1).reduce((a, p, i) => a + distance(waypoints[i], p), 0) };
}
function moveTruck(s, truck, seconds) {
  const trip = truck.trip;
  if ((trip.physicalGuideVersion || 0) < TRUCK_GUIDE_VERSION) {
    // Rebuild only the remaining guide of an old saved trip. Identity, load,
    // current pose and original start time survive; a safer route may take
    // longer, but cannot finish sooner than its former remaining travel time.
    const completedFraction = Math.max(0, Math.min(.999999, truck.progress || 0)), startedAt = trip.startedAt;
    const destination = { ...trip.to, approachAlongX: s.layout.branches.some(branch => Math.abs(branch.x - trip.to.x) < .01 && Math.abs(branch.z + 12 - trip.to.z) < .01) };
    const nominalSpeed = trip.length / Math.max(.001, trip.duration), remainingDuration = trip.duration * (1 - completedFraction);
    const previousWaypoints = clone(trip.waypoints);
    const rebuilt = truckTrip(s, truck, destination, trip.duration * speedFactor(truck), truck);
    rebuilt.duration = Math.max(remainingDuration, rebuilt.length / Math.max(.1, nominalSpeed));
    Object.assign(trip, rebuilt, { startedAt, guideIndex: 1, completedFraction, replannedAt: s.clock.now, previousWaypoints });
    truck.physicalSpeed = 0;
  }
  if (!Number.isInteger(trip.guideIndex)) {
    let remaining = trip.length * (truck.progress || 0); trip.guideIndex = 1;
    while (trip.guideIndex < trip.waypoints.length - 1 && remaining > distance(trip.waypoints[trip.guideIndex - 1], trip.waypoints[trip.guideIndex])) { remaining -= distance(trip.waypoints[trip.guideIndex - 1], trip.waypoints[trip.guideIndex]); trip.guideIndex++; }
    truck.physicalSpeed = 0;
  }
  const complete = advanceGuided(s, truck, seconds, { type: "TRUCK", speed: trip.length / trip.duration, route: trip.waypoints, holder: trip, indexField: "guideIndex" });
  let travelled = 0;
  for (let index = 1; index < Math.min(trip.guideIndex, trip.waypoints.length); index++) travelled += distance(trip.waypoints[index - 1], trip.waypoints[index]);
  if (trip.guideIndex < trip.waypoints.length) travelled += distance(trip.waypoints[trip.guideIndex - 1], truck);
  const base = trip.completedFraction || 0;
  truck.progress = complete ? 1 : Math.min(.999999, base + (1 - base) * travelled / Math.max(.001, trip.length));
  return complete;
}
function fresh(seed, now = START) {
  const layout = createBlueprint();
  const state = { version: 2, revision: 1, counters: {}, clock: { elapsed: 0, now, paused: false, speed: 1 },
    layout, catalog: { skus: clone(SKUS), branches: clone(BRANCHES), suppliers: clone(SUPPLIERS) },
    hus: [], storeStock: [], purchases: [], orders: [], missions: [], returns: [], events: [],
    locationStatus: {}, routeLocks: {}, robots: [], trucks: [], configuration: { revision: 1, settings: clone(DEFAULT_SETTINGS) }, ledger: { initialCases: 0, receivedCases: 0, consumedCases: 0, writtenOffCases: 0 } };
  migrate(state);
  for (let i = 1; i <= 6; i++) state.robots.push({ id: `AMR-${i}`, name: `AMR ${i}`, type: "AMR", zoneId: null,
    nodeId: `PARK-${i}`, parkingId: `PARK-${i}`, x: layout.nodes.find((n) => n.id === `PARK-${i}`).x, y: 0, z: 3,
    state: "IDLE", battery: i === 6 ? 18 : 75 + i * 3, capacityCases: 24, capacityKg: 1500, carryingHuId: null, missionId: null, route: [],
    capabilities: ["AMBIENT_CORRIDOR", "CLOSED_CASE_UNIT"], model: "Equipo educativo genérico · no conectado" });
  state.robots.push({ id: "STACKER-1", name: "Transelevador seco", type: "STACKER", zoneId: "DRY", nodeId: "DRY-IN", x: -44, y: 0.8, z: -12, state: "IDLE", battery: null, capacityCases: 24, carryingHuId: null, missionId: null, route: [], capabilities: ["DRY_RACK"], model: "Transelevador eléctrico simulado" },
    { id: "STACKER-2", name: "Transelevador refrigerado", type: "STACKER", zoneId: "COLD", nodeId: "COLD-IN", x: 0, y: 0.8, z: -16, state: "IDLE", battery: null, capacityCases: 24, carryingHuId: null, missionId: null, route: [], capabilities: ["CHILLED_RACK"], model: "Transelevador apto para cámara · simulado" },
    { id: "SHUTTLE-1", name: "Transferencia interna de congelados", type: "SHUTTLE", zoneId: "FROZEN", nodeId: "FROZEN-IN", x: 38, y: 0, z: -2, state: "IDLE", battery: null, capacityCases: 24, carryingHuId: null, missionId: null, route: [], capabilities: ["FROZEN_FLOOR"], model: "Mecanismo fijo parametrizado · no representa un modelo comercial" });
  for (let i = 1; i <= 3; i++) state.trucks.push({ id: `TRUCK-${i}`, name: `Unidad ${i}`, state: "AVAILABLE", x: 20 + i * 9, z: 75,
    capacityCases: 120, temperatureControlled: true, multiTemperature: true, segregatedCleaning: true,
    configuration: "Compartimentos segregados ambiente/frío/congelado y jaula de limpieza · escenario", orderId: null, progress: 0, trip: null, battery: null });
  if (seed) {
    const used = new Set();
    for (const sku of SKUS) for (let lot = 1; lot <= 2; lot++) {
      const location = layout.locations.find((p) => p.zoneId === sku.zoneId && !used.has(p.id));
      if (!location) continue; used.add(location.id);
      const expiry = sku.expiryControlled ? addLimaDays(now, lot === 1 ? (sku.zoneId === "COLD" ? 8 : 45) : 90) : null;
      state.hus.push({ id: id(state, "HU"), skuId: sku.id, lot: `FAB-${sku.code}-${lot}`, expiry, cases: lot === 1 ? 12 : 18,
        reservedCases: 0, locationId: location.id, state: "STORED", createdAt: now, purchaseId: null, orderId: null, parentId: null });
    }
    state.orders.push({ id: id(state, "PED"), branchId: BRANCHES[0].id, state: "PENDING", priority: "NORMAL", createdAt: now,
      createdBy: "SCENARIO", lines: [{ id: "LINE-1", skuId: "SKU-ARROZ", cases: 4 }, { id: "LINE-2", skuId: "SKU-YOGUR", cases: 2 }], allocations: [], truckId: null, notes: "Pedido inicial del escenario educativo." });
    event(state, "SCENARIO", "Centro de distribución listo. Inventario inicial ficticio y trazable.");
  }
  state.ledger.initialCases = state.hus.reduce((a, hu) => a + hu.cases, 0);
  migrate(state);
  return state;
}
function id(state, prefix) { state.counters[prefix] = (state.counters[prefix] || 0) + 1; return `${prefix}-${String(state.counters[prefix]).padStart(5, "0")}`; }
function event(s, type, message, refs = {}) {
  const context = EVENT_CONTEXT.get(s) || { actorId: "AUTOMATION", actorRole: "automation", actorName: "Orquestador automático" };
  const returned = s.returns.find(row => row.id === refs.returnId);
  const hu = s.hus.find(row => row.id === refs.huId), mission = s.missions.find(row => row.id === refs.missionId);
  const order = s.orders.find(row => row.id === (refs.orderId || mission?.orderId || hu?.orderId || returned?.orderId));
  const sku = s.catalog.skus.find(row => row.id === (refs.skuId || hu?.skuId || mission?.skuId || returned?.skuId));
  s.events.push({ id: id(s, "EV"), at: s.clock.now, ...timeFields(s.clock.now), type, message, ...context,
    ...(order ? { orderId: order.id, branchId: order.branchId } : {}),
    ...(sku ? { skuId: sku.id, skuName: sku.name, skuCode: sku.code } : {}),
    ...(returned ? { cases: returned.cases, reason: returned.reason, returnId: returned.id } : {}),
    ...(hu ? { lot: hu.lot, expiry: hu.expiry, cases: hu.cases, locationId: hu.locationId, locationLabel: describeLocation(s, hu.locationId).label } : {}), ...refs });
  if (s.events.length > 1500) s.events.splice(0, s.events.length - 1500);
}
function find(list, itemId, label) { const value = list.find((r) => r.id === itemId); if (!value) fail(`${label} no encontrado.`, 404); return value; }
const skuFor = (s, skuId) => find(s.catalog.skus, skuId, "Producto");
const posFor = (s, locationId) => s.layout.locations.find((l) => l.id === locationId);
const branchStop = branch => ({ x: branch.x, z: branch.z + 12, approachAlongX: true });
function emptyLoadPositions() {
  return Array.from({ length: 24 }, (_, i) => ({ id: `SLOT-${String(i + 1).padStart(2, "0")}`, row: Math.floor(i / 2), column: i % 2, x: i % 2 ? 0.62 : -0.62, y: 1.2, z: 5.5 - Math.floor(i / 2) * 1.02, width: 1.16, depth: 0.94, height: 1.9, zoneId: null, huId: null, reservedHuId: null }));
}
const loadingDock = (s, dockId) => find(s.layout.loadingDocks, dockId, "Muelle de carga");
const stagingPoint = (s, hu) => s.layout.loadingDocks.flatMap(dock => dock.stagingSlots).find(slot => slot.id === hu.stagingSlotId);
function assignStagingSlot(s, hu, dockId) {
  const dock = loadingDock(s, dockId);
  if (dock.stagingSlots.some(slot => slot.id === hu.stagingSlotId)) return stagingPoint(s, hu);
  const occupied = new Set(s.hus.filter(other => other.id !== hu.id && other.cases && other.stagingSlotId && (other.locationId === dockId || other.loadingOrderId || other.stagingReserved)).map(other => other.stagingSlotId));
  const slot = dock.stagingSlots.find(slot => !occupied.has(slot.id));
  if (!slot) fail("El muelle no tiene una plaza física de espera libre. Despacha o resuelve primero su carga.", 409);
  hu.stagingSlotId = slot.id;
  return slot;
}
function loadGroups(s, loads) { return ["FROZEN", "COLD", "DRY", "CLEANING"].map(zoneId => ({ zoneId, loads: loads.filter(hu => skuFor(s, hu.skuId).zoneId === zoneId) })).filter(group => group.loads.length); }
function truckCompatible(s, truck, loads) {
  const total = loads.reduce((n, hu) => n + hu.cases, 0), groups = loadGroups(s, loads), food = groups.some(group => group.zoneId !== "CLEANING"), chilled = groups.some(group => ["COLD", "FROZEN"].includes(group.zoneId));
  if (total > truck.capacityCases) return "El pedido supera la capacidad de cajas del camión.";
  if (groups.reduce((rows, group) => rows + Math.ceil(group.loads.length / 2), 0) > 12) return "El pedido supera las 24 plazas de carga o sus compartimentos segregados. Divide la solicitud.";
  if (chilled && !truck.temperatureControlled) return "El camión no mantiene la cadena fría requerida.";
  if (new Set(groups.filter(group => group.zoneId !== "CLEANING").map(group => group.zoneId)).size > 1 && !truck.multiTemperature) return "El pedido requiere compartimentos de distinta temperatura.";
  if (food && groups.some(group => group.zoneId === "CLEANING") && !truck.segregatedCleaning) return "El camión no separa productos de limpieza y alimentos.";
  return null;
}
function reserveTruckSlots(s, truck, loads) {
  truck.loadPositions = emptyLoadPositions(); truck.compartments = [];
  let row = 0;
  for (const group of loadGroups(s, loads)) {
    const firstRow = row;
    group.loads.sort((a, b) => (stagingPoint(s, b)?.z || 0) - (stagingPoint(s, a)?.z || 0) || a.id.localeCompare(b.id));
    group.loads.forEach((hu, i) => { const slot = truck.loadPositions[(row + Math.floor(i / 2)) * 2 + i % 2]; slot.reservedHuId = hu.id; slot.zoneId = group.zoneId; hu.reservedTruckSlotId = slot.id; });
    row += Math.ceil(group.loads.length / 2);
    for (const slot of truck.loadPositions.filter(slot => slot.row >= firstRow && slot.row < row)) slot.zoneId = group.zoneId;
    truck.compartments.push({ zoneId: group.zoneId, firstRow, lastRow: row - 1, temperature: group.zoneId === "COLD" ? "CHILLED" : group.zoneId === "FROZEN" ? "FROZEN" : "AMBIENT", isolated: true });
  }
}
function routeLoadingDevice(device, points) {
  device.route = [{ x: device.x, y: device.y || 0, z: device.z, heading: device.heading || 0 }, ...points]; device.routeIndex = 1; device.physicalRouteVersion = 1; device.physicalSpeed = 0;
}
function moveLoadingDevice(s, device, seconds, speed = 1.5) {
  if (!device.type && !device.physicalRouteVersion && device.dockId) {
    const dock = s.layout.loadingDocks.find(dock => dock.id === device.dockId);
    if (dock && device.loadingState === "DOCKING") routeLoadingDevice(device,
      Math.abs(device.x - dock.x) < .2 && device.z <= 56 ? [dock.truckPose] : [{ x: device.x, y: 0, z: 56, heading: device.heading || 0 }, { x: dock.x, y: 0, z: 56, heading: dock.x < device.x ? -Math.PI / 2 : Math.PI / 2 }, dock.truckPose]);
    else if (dock && device.loadingState === "UNDOCKING") routeLoadingDevice(device, [{ x: dock.x, y: 0, z: 54, heading: 0 }]);
    else device.physicalRouteVersion = 1;
  }
  return advanceGuided(s, device, seconds, { speed: speed * speedFactor(device) });
}
function setLoadingPhase(s, truck, phase) {
  truck.loadingState = phase; truck.state = phase; truck.loading.phaseElapsed = 0;
  const order = find(s.orders, truck.orderId, "Pedido en carga"); order.loading.phase = phase;
}
function startPhysicalDispatch(s, order, payload) {
  if (order.state === "LOADING") fail("Este pedido ya está en proceso de carga. No repitas el despacho.", 409);
  if (order.state !== "READY") fail("Completa la preparación de todas las cargas antes de despachar.");
  const loads = order.allocations.map(a => {
    const hu = find(s.hus, a.huId, "Carga preparada");
    if (!isFresh(s, hu)) fail(`${hu.id}: caducidad o vida útil insuficiente. Retén el pedido preparado y devuelve las cargas a cuarentena antes de crear una nueva solicitud.`);
    if (hu.state !== "STAGED" || hu.cases !== a.cases || hu.locationId !== order.dockId || hu.loadingOrderId) fail("La carga preparada no coincide con la reserva y el muelle; despacho bloqueado.", 409);
    assignStagingSlot(s, hu, order.dockId); return hu;
  });
  const dock = loadingDock(s, order.dockId), forklift = find(s.robots, dock.forkliftId, "Montacargas del muelle");
  if (s.dockReservations[dock.id]) fail("El muelle está ocupado por otra carga. Espera su salida antes de despachar este pedido.", 409);
  if (!deviceAvailable(s, forklift.id) || forklift.state === "FAULT" || forklift.missionId || forklift.carryingHuId || forklift.orderId) fail("El montacargas del muelle no está disponible. Revisa su mantenimiento o finaliza su operación.", 409);
  if (forklift.battery < 20) fail("El montacargas está recargando en su base de muelle. Espera a que alcance el 20 % antes de iniciar otra carga.", 409);
  const available = s.trucks.filter(truck => truck.state === "AVAILABLE" && deviceAvailable(s, truck.id) && taskAllowed(truck, "DELIVERY")).sort((a, b) => priorityOf(s, b.id) - priorityOf(s, a.id));
  const truck = payload.truckId ? find(s.trucks, payload.truckId, "Camión") : available.find(truck => !truckCompatible(s, truck, loads));
  if (!truck || truck.state !== "AVAILABLE" || !deviceAvailable(s, truck.id) || !taskAllowed(truck, "DELIVERY")) fail(available.length ? truckCompatible(s, available[0], loads) || "No hay un camión compatible disponible." : "No hay un camión disponible.", 409);
  if (!taskAllowed(forklift, "TRUCK_LOAD")) fail("El montacargas del muelle no tiene habilitada la carga de camiones.", 409);
  const incompatible = truckCompatible(s, truck, loads); if (incompatible) fail(incompatible, 409);
  reserveTruckSlots(s, truck, loads);
  order.state = "LOADING"; order.truckId = truck.id; order.dispatchRequestedAt = s.clock.now;
  order.loading = { dockId: dock.id, truckId: truck.id, totalLoads: loads.length, loadedLoads: 0, phase: "DOCKING", startedAt: s.clock.now };
  truck.orderId = order.id; truck.branchId = order.branchId; truck.dockId = dock.id; truck.doorProgress = 0; truck.progress = 0; truck.trip = null;
  truck.loading = { phaseElapsed: 0, currentMissionId: null, requestedAt: s.clock.now };
  s.dockReservations[dock.id] = { orderId: order.id, truckId: truck.id, forkliftId: forklift.id, reservedAt: s.clock.now };
  forklift.orderId = order.id; forklift.loadingPhase = "WAITING_TRUCK";
  // Reverse clear of the neighbouring parking bays before turning a full
  // trailer across the apron. A diagonal departure swept through parked units.
  routeLoadingDevice(truck, [{ x: truck.x, y: 0, z: 56, heading: 0 },
    { x: dock.x, y: 0, z: 56, heading: dock.x < truck.x ? -Math.PI / 2 : Math.PI / 2 }, dock.truckPose]);
  for (const slot of truck.loadPositions.filter(slot => slot.reservedHuId)) {
    const hu = find(s.hus, slot.reservedHuId, "Carga reservada"); hu.loadingOrderId = order.id; hu.loadingOriginDockId = dock.id; hu.state = "RESERVED_LOADING";
    newMission(s, { kind: "TRUCK_LOAD", deviceType: "FORKLIFT", requiredRobotId: forklift.id, huId: hu.id, cases: hu.cases, sourceId: hu.stagingSlotId, destinationId: `${truck.id}:${slot.id}`, truckId: truck.id, truckSlotId: slot.id, dockId: dock.id, orderId: order.id });
  }
  setLoadingPhase(s, truck, "DOCKING");
  event(s, "DISPATCH_LOADING_REQUESTED", `${order.id}: muelle y camión reservados; comienza el acoplamiento y la carga física.`, { orderId: order.id, truckId: truck.id, dockId: dock.id });
  return { id: order.id, truckId: truck.id, dockId: dock.id, state: order.state };
}
function point(s, ref) {
  const p = posFor(s, ref) || s.layout.nodes.find((n) => n.id === ref) || s.layout.stations.find((n) => n.id === ref);
  if (!p) fail(`Punto logístico inválido: ${ref}.`); return { x: p.x, y: p.y || 0, z: p.z, nodeId: p.nodeId || p.id };
}
function freeLocation(s, skuId) {
  const sku = skuFor(s, skuId);
  return s.layout.locations.find((l) => l.zoneId === sku.zoneId && !s.locationStatus[l.id]?.blocked && !s.locationStatus[l.id]?.reservedFor && !s.hus.some((h) => h.cases > 0 && h.locationId === l.id));
}
function graphPath(s, start, end, device) {
  if (start === end) return [point(s, start)];
  const cacheKey = `${s.layout.id}:${s.layout.rearExpansionVersion || 0}:${device.type}:${start}:${end}`;
  if (PATH_CACHE.has(cacheKey)) return clone(PATH_CACHE.get(cacheKey));
  const allowed = (e) => device.type !== "AMR" || !e.temperature;
  const dist = new Map([[start, 0]]), previous = new Map(), pending = new Set(s.layout.nodes.map((n) => n.id));
  while (pending.size) {
    const here = [...pending].sort((a, b) => (dist.get(a) ?? Infinity) - (dist.get(b) ?? Infinity))[0];
    if (!Number.isFinite(dist.get(here))) break; pending.delete(here); if (here === end) break;
    for (const e of s.layout.edges.filter((e) => allowed(e) && (e.from === here || e.to === here))) {
      const next = e.from === here ? e.to : e.from; if (!pending.has(next)) continue;
      const cost = dist.get(here) + distance(point(s, here), point(s, next));
      if (cost < (dist.get(next) ?? Infinity)) { dist.set(next, cost); previous.set(next, here); }
    }
  }
  if (!dist.has(end)) return null;
  const path = [end]; while (path[0] !== start) { const prev = previous.get(path[0]); if (!prev) return null; path.unshift(prev); }
  const result = path.map((ref) => point(s, ref)); PATH_CACHE.set(cacheKey, result); return clone(result);
}
function stackerPath(s, robot, from, to) {
  const a = point(s, from), b = point(s, to);
  if (robot.type === "SHUTTLE") return graphPath(s, a.nodeId, b.nodeId, robot);
  const railZ = robot.railZ ?? (robot.zoneId === "DRY" ? -12 : -16);
  return [a, { x: a.x, y: a.y, z: railZ }, { x: b.x, y: a.y, z: railZ }, { x: b.x, y: b.y, z: railZ }, b];
}
function newMission(s, data) {
  const m = { id: id(s, "MIS"), state: "QUEUED", phase: "WAITING", robotId: null, createdAt: s.clock.now, startedAt: null,
    completedAt: null, timer: 0, priority: "NORMAL", route: [], progress: 0, ...data };
  s.missions.push(m); return m;
}
function destinationFor(s, hu) {
  const location = freeLocation(s, hu.skuId); if (!location) return null;
  s.locationStatus[location.id] = { ...(s.locationStatus[location.id] || {}), reservedFor: hu.id };
  return location;
}
function putaway(s, hu) {
  if (s.missions.some((m) => m.huId === hu.id && !CLOSED.has(m.state))) return;
  const target = destinationFor(s, hu); if (!target) { hu.state = "WAITING_SPACE"; return; }
  hu.state = "WAITING_PUTAWAY";
  newMission(s, { kind: "PUTAWAY", huId: hu.id, cases: hu.cases, sourceId: hu.locationId,
    destinationId: target.stackerId ? target.handoffId : target.id, finalLocationId: target.id, deviceType: "AMR", zoneId: target.zoneId });
}
function validateLines(s, lines, supplierId) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 12) fail("Añade entre 1 y 12 productos.");
  const seen = new Set();
  return lines.map((l, i) => { if (!l || typeof l !== "object" || Array.isArray(l)) fail("Cada línea debe indicar un producto y sus cajas."); const sku = skuFor(s, l.skuId); if (!sku.active) fail("Ese producto está desactivado; no admite documentos nuevos."); if (seen.has(sku.id)) fail("No repitas el producto en dos líneas."); seen.add(sku.id);
    if (supplierId && !eligibleSupplierIds(s,sku).includes(supplierId)) fail("El producto no pertenece al catálogo activo de ese proveedor o no es compatible con su conservación.",422,`lines.${i}.skuId`);
    return { id: `LINE-${i + 1}`, skuId: sku.id, cases: num(l.cases), receivedCases: 0 }; });
}
function createStoreRequest(s, p, actor) {
  const branchId = actor.branchId;
  if (p.branchId && p.branchId !== branchId) fail("Solo puedes solicitar para tu tienda.", 403, "branchId");
  const branch = find(s.catalog.branches, branchId, "Tienda");
  if (!branch.active) fail("La tienda está desactivada; no admite solicitudes nuevas.", 409, "branchId");
  const lines = validateLines(s, p.lines);
  if (lines.reduce((a, line) => a + line.cases, 0) > s.configuration.settings.maxOrderCases) fail(`Un pedido admite hasta ${s.configuration.settings.maxOrderCases} cajas. Divide la solicitud en dos pedidos.`, 422, "lines");
  if (s.orders.filter(order => order.branchId === branchId && isOpenOrder(order)).length >= s.configuration.settings.maxOpenOrdersPerBranch) fail("La tienda alcanzó el límite de pedidos abiertos. Completa o cancela los pendientes.", 409);
  const priority = p.priority ?? "NORMAL";
  if (priority !== "NORMAL") fail("La priorización logística corresponde al jefe de operaciones.", 403, "priority");
  const requestedByDate = requestedDate(s, p.requestedByDate);
  const order = { id: id(s, "PED"), revision: 1, branchId, state: "PENDING", priority, createdAt: s.clock.now, createdBy: actor.id, requestedByRole: "store", source: "STORE", simulated: false, lines, allocations: [], truckId: null, notes: optionalText(p.notes, "Notas", 300, { multiline: true }), requestedByDate };
  s.orders.push(order);
  event(s, "ORDER_CREATED", `${order.id}: solicitud de ${branch.name} recibida, todavía sin reservar ni mover mercancía.`, { orderId: order.id, branchId, actorId: actor.id, source: order.source, simulated: order.simulated });
  return { id: order.id, branchId, source: order.source, simulated: order.simulated };
}
function requestedDate(s, value) {
  const fields = new Fields(), result = fields.date(value ?? "", "requestedByDate", "Fecha solicitada", { min: limaDate(s.clock.now), max: addLimaDays(s.clock.now, 90) }); fields.assert(); return result || null;
}
function requireActor(actor) { if (!actor || typeof actor.role !== "string" || !Object.hasOwn(CAPABILITIES, actor.role) || typeof actor.id !== "string" || !actor.id) fail("Inicia sesión con un perfil válido.", 401); }
function permit(actor, roles) { requireActor(actor); if (!roles.includes(actor.role)) fail("Tu perfil no puede realizar esta acción.", 403); }
function ownsOrder(s, actor, orderId) { const order = find(s.orders, orderId, "Pedido"); if (actor.role === "store" && order.branchId !== actor.branchId) fail("Ese pedido pertenece a otra tienda.", 403); return order; }
function available(s, skuId) { return s.hus.filter((h) => h.skuId === skuId && h.state === "STORED" && !s.locationStatus[h.locationId]?.blocked && isFresh(s, h)).reduce((a, h) => a + h.cases - h.reservedCases, 0); }
function cancelOrder(s, order) {
  if (order.state === "CANCELLED") return;
  if (!["PENDING", "PREPARING"].includes(order.state) || order.allocations.some((a) => a.picked)) fail("La carga ya fue recogida. Finaliza el recorrido y tramita una devolución; no puede desaparecer por una cancelación.");
  if (s.missions.some((m) => m.orderId === order.id && !CLOSED.has(m.state) && s.robots.find((r) => r.id === m.robotId)?.state === "FAULT")) fail("Recupera el equipo detenido antes de cancelar su misión.");
  for (const a of order.allocations) { const h = find(s.hus, a.sourceHuId, "Unidad de carga"); h.reservedCases -= a.cases; }
  for (const m of s.missions.filter((m) => m.orderId === order.id && !CLOSED.has(m.state))) {
    if (m.phase !== "WAITING" && m.phase !== "TO_SOURCE") fail("Una recogida está comenzando; espera y vuelve a intentarlo.");
    m.state = "CANCELLED"; const robot = s.robots.find((r) => r.id === m.robotId);
    if (robot) {
      const lastSafePoint = point(s, robot.nodeId);
      const nextPoint = robot.route[robot.routeIndex];
      const currentEdge = nextPoint?.nodeId ? [robot.nodeId, nextPoint.nodeId].sort().join("~") : null;
      releaseRobot(s, robot);
      if (robot.type === "AMR" && distance(robot, lastSafePoint) > 0.01) {
        robot.route = [{ x: robot.x, y: robot.y || 0, z: robot.z }, lastSafePoint]; robot.routeIndex = 1; robot.state = "PARKING";
        if (currentEdge) s.routeLocks[currentEdge] = `park:${robot.id}`;
        s.routeLocks[`node:${lastSafePoint.nodeId}`] = `park:${robot.id}`;
      }
    }
    releaseLocks(s, m.id);
  }
  order.state = "CANCELLED"; order.revision = (order.revision || 1) + 1; event(s, "ORDER_CANCELLED", `${order.id}: reservas liberadas sin alterar existencias físicas.`, { orderId: order.id });
}
function configCommand(s, type, p, actor) {
  permit(actor, ["admin"]);
  if (!Number.isInteger(p.expectedRevision) || p.expectedRevision !== s.configuration.revision) fail("La configuración cambió en otra sesión. Recarga los datos antes de guardar.", 409);
  const [, kind, action] = type.split(".");
  if(kind === "company" && action === "update") {
    const data=p.data || p;
    const company={...s.configuration.company,legalName:strictText(data.legalName,"Razón social",200),address:strictText(data.address,"Dirección de facturación",200)};
    company.email=optionalText(data.email,"Correo de compras",120);if(company.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(company.email))fail("Correo de compras inválido.",422,"email");
    company.taxId=optionalText(data.taxId,"RUC",11);if(company.taxId&&!/^\d{11}$/.test(company.taxId))fail("RUC: utiliza once dígitos o deja el campo vacío.",422,"taxId");
    s.configuration.company=company;s.configuration.revision++;event(s,"CONFIGURATION_CHANGED","Datos de facturación de DonPepe guardados.",{actorId:actor.id});return {configurationRevision:s.configuration.revision};
  }
  if (kind === "autonomy" && action === "update") return autonomyConfigurationCommand(s, p, actor, { id, event });
  if (COLLECTIONS[kind] && ["deactivate", "activate", "delete"].includes(action)) {
    p = { ...p, id: changeCatalogStatus(s, kind, action, p, { safeToService }) };
  } else if (["brand", "category", "asset"].includes(kind)) {
    const nextId = kind === "asset" ? assetCommand(s, action, p, { id, event, actor }) : masterCommand(s, kind, action, p, { id, event });
    p = { ...p, id: nextId };
  } else if (kind === "settings") {
    if (action !== "update") fail("Acción de configuración desconocida.", 404);
    const settings = p.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) fail("Indica los parámetros de configuración.");
    if (Object.keys(settings).some((k) => !Object.hasOwn(DEFAULT_SETTINGS, k))) fail("Parámetro de configuración no permitido.");
    const next = { ...s.configuration.settings, ...settings };
    next.maxOrderCases = num(next.maxOrderCases, "Cajas máximas por pedido", 120);
    next.minShelfLifeDays = num(next.minShelfLifeDays, "Vida útil mínima", 30, true);
    next.maxOpenOrdersPerBranch = num(next.maxOpenOrdersPerBranch, "Pedidos abiertos por tienda", 50);
    if (next.packagingDamagePercent !== undefined && (typeof next.packagingDamagePercent !== "number" || !Number.isFinite(next.packagingDamagePercent) || next.packagingDamagePercent < 0 || next.packagingDamagePercent > 100)) fail("La frecuencia de embalajes dañados debe estar entre 0 y 100 %.",422);
    s.configuration.settings = next;
  } else {
    const list = kind === "sku" ? s.catalog.skus : kind === "supplier" ? s.catalog.suppliers : kind === "branch" ? s.catalog.branches : null;
    if (!list || !["create", "update"].includes(action)) fail("Acción de configuración desconocida.", 404);
    const existing = action === "create" ? null : find(list, p.id, "Registro de configuración");
    if (existing?.deletedAt) fail("El registro fue eliminado y no puede modificarse.", 404);
    {
      const data = p.data && typeof p.data === "object" && !Array.isArray(p.data) ? p.data : p;
      const next = { ...(existing || {}), code: code(data.code ?? existing?.code), name: strictText(data.name ?? existing?.name, "Nombre", 100) };
      unique(list, next.code, "code", existing?.id); unique(list, next.name, "name", existing?.id);
      if (data.active !== undefined && typeof data.active !== "boolean") fail("Estado activo inválido.");
      if (data.active !== undefined && data.active !== (existing?.active ?? true)) fail("Utiliza Activar o Desactivar para cambiar el estado con sus validaciones.");
      next.active = data.active ?? existing?.active ?? true;
      if (kind === "sku") {
        next.zoneId = data.zoneId ?? existing?.zoneId; if (!ZONES.includes(next.zoneId)) fail("Selecciona una zona de almacenamiento válida.", 422, "zoneId");
        next.supplierId = data.supplierId ?? existing?.supplierId;
        const supplier = find(s.catalog.suppliers, next.supplierId, "Proveedor"); if (!supplier.active || !supplier.zones.includes(next.zoneId)) fail("El proveedor debe estar activo y suministrar la zona del producto.", 422, "supplierId");
        const price=data.purchaseUnitPrice ?? (existing?.purchaseUnitNetCents != null ? existing.purchaseUnitNetCents/100 : undefined);
        if(price !== undefined){if(typeof price !== "number"||!Number.isFinite(price)||price<=0||price>100000||Math.abs(price*100-Math.round(price*100))>1e-6)fail("Costo de compra unitario: importe positivo con hasta dos decimales.",422,"purchaseUnitPrice");next.purchaseUnitNetCents=Math.round(price*100);next.purchasePriceSource="CONFIGURED_TARIFF";}
        if(data.purchaseTaxPercent !== undefined){if(typeof data.purchaseTaxPercent!=="number"||!Number.isFinite(data.purchaseTaxPercent)||data.purchaseTaxPercent<0||data.purchaseTaxPercent>100||Math.abs(data.purchaseTaxPercent*100-Math.round(data.purchaseTaxPercent*100))>1e-6)fail("Impuesto: porcentaje entre 0 y 100.",422,"purchaseTaxPercent");next.purchaseTaxRateBps=Math.round(data.purchaseTaxPercent*100);}
        next.unitsPerCase = num(data.unitsPerCase ?? existing?.unitsPerCase, "Unidades por caja", 240);
        next.maxCasesPerHu = num(data.maxCasesPerHu ?? existing?.maxCasesPerHu ?? 24, "Cajas por unidad de carga", 24);
        next.expiryControlled = data.expiryControlled ?? existing?.expiryControlled;
        next.brand = optionalText(data.brand ?? existing?.brand, "Marca", 80);
        next.category = optionalText(data.category ?? existing?.category, "Categoría", 80);
        next.presentation = optionalText(data.presentation ?? existing?.presentation, "Presentación", 100);
        next.barcode = gtin(data.barcode ?? existing?.barcode);
        if (next.barcode) unique(list, next.barcode, "barcode", existing?.id);
        next.reorderPoint = num(data.reorderPoint ?? existing?.reorderPoint ?? 12, "Punto de reposición", 10000, true);
        next.imageUrl = localImage(data.imageUrl ?? existing?.imageUrl, "Foto del producto");
        if (typeof next.expiryControlled !== "boolean") fail("Indica si el producto controla caducidad.", 422, "expiryControlled");
        if (["COLD", "FROZEN"].includes(next.zoneId) && !next.expiryControlled) fail("Los productos de cadena fría deben controlar caducidad.", 422, "expiryControlled");
        const tracked = existing && (s.hus.some((h) => h.skuId === existing.id) || s.storeStock.some(row => row.skuId === existing.id) || s.returns.some(row => row.skuId === existing.id) || s.orders.some((o) => o.lines.some((l) => l.skuId === existing.id)) || s.purchases.some((o) => o.lines.some((l) => l.skuId === existing.id)));
        if (tracked && ["code", "zoneId", "unitsPerCase", "maxCasesPerHu", "expiryControlled"].some((key) => next[key] !== existing[key])) fail("El producto tiene trazabilidad. Código, conservación y unidades físicas son inmutables; crea otro SKU.", 409);
        for (const key of ["brand", "presentation", "barcode"]) if (tracked && existing[key] && next[key] !== existing[key]) fail("Este producto tiene trazabilidad. No sustituyas su marca, presentación o código de barras: crea otro SKU para el nuevo artículo.", 409, key);
        productReferences(s, data, next, existing, tracked);
        if (existing && next.supplierId !== existing.supplierId && s.purchases.some((o) => isOpenPurchase(o) && o.lines.some((l) => l.skuId === existing.id))) fail("Finaliza sus compras pendientes antes de cambiar el proveedor.", 409);
        next.caseLabel = `Caja × ${next.unitsPerCase}`; next.temperature = next.zoneId === "COLD" ? "CHILLED" : next.zoneId === "FROZEN" ? "FROZEN" : "AMBIENT";
      } else if (kind === "supplier") {
        const zones = data.zones ?? existing?.zones; if (!Array.isArray(zones) || !zones.length || zones.length > 4 || new Set(zones).size !== zones.length || zones.some((z) => !ZONES.includes(z))) fail("Selecciona una o varias zonas diferentes.", 422, "zones");
        next.zones = [...zones];
        supplierContact(next, data, existing);
        for(const key of ["legalName","billingAddress"]) if(data[key] !== undefined) next[key]=strictText(data[key],key==="legalName"?"Razón social":"Dirección de facturación",200);
        if(data.taxId !== undefined){next.taxId=String(data.taxId).trim();if(next.taxId&&!/^\d{11}$/.test(next.taxId))fail("RUC: debe tener 11 dígitos o quedar vacío.",422,"taxId");}
        if(data.paymentTermDays !== undefined) next.paymentTermDays=num(data.paymentTermDays,"Plazo de pago",180,true);
        if(data.invoiceSeries !== undefined){next.invoiceSeries=String(data.invoiceSeries).trim().toUpperCase();if(!/^F[A-Z0-9]{3}$/.test(next.invoiceSeries))fail("Serie: utiliza F seguida de tres letras o números.",422,"invoiceSeries");}
        next.imageUrl = localImage(data.imageUrl ?? existing?.imageUrl, "Imagen del proveedor");
        if (existing && s.catalog.skus.some((sku) => sku.active && sku.supplierId === existing.id && !zones.includes(sku.zoneId))) fail("No puedes quitar una zona que suministra productos activos.", 409);
      } else {
        next.district = optionalText(data.district ?? existing?.district, "Distrito", 80);
        next.address = optionalText(data.address ?? existing?.address, "Dirección", 200);
        next.manager = optionalText(data.manager ?? existing?.manager, "Responsable", 100);
        next.phone = optionalText(data.phone ?? existing?.phone, "Teléfono", 30);
        if (next.phone && !/^\+?[\d ()-]{6,30}$/.test(next.phone)) fail("Teléfono: usa dígitos, espacios, paréntesis y guiones.", 422, "phone");
        next.imageUrl = localImage(data.imageUrl ?? existing?.imageUrl, "Imagen de la sucursal");
        if (!next.imageUrl) fail("Imagen de la sucursal: añade una fotografía o representación del local.", 422, "imageUrl");
        for (const coordinate of ["x", "z"]) {
          const n = data[coordinate] ?? existing?.[coordinate];
          if (typeof n !== "number" || !Number.isFinite(n) || n < -160 || n > 160) fail("Las coordenadas de tienda deben ser números entre −160 y 160."); next[coordinate] = n;
        }
        if (Math.abs(next.x) < 65 && next.z < 65) fail("La tienda debe situarse fuera del centro de distribución y sus vías.");
        if (s.layout.automation) {
          const protectedAreas = [s.layout.automation.annex.bounds, s.layout.automation.supplierDock.safetyBounds];
          if (protectedAreas.some(bounds => next.x + 10 > bounds.minX && next.x - 10 < bounds.maxX && next.z + 10 > bounds.minZ && next.z - 10 < bounds.maxZ))
            fail("La tienda se superpone con el anexo de recepción o con la maniobra segura del proveedor.", 422, "x");
        }
        if (list.some((b) => b.id !== existing?.id && Math.hypot(next.x - b.x, next.z - b.z) < 20)) fail("La tienda se superpone con otra sucursal. Separa sus posiciones al menos 20 metros.");
        next.travelSeconds = num(data.travelSeconds ?? existing?.travelSeconds ?? 60, "Duración didáctica del viaje", 600); if (next.travelSeconds < 15) fail("El viaje debe durar al menos 15 segundos de simulación.");
        if (existing && (next.x !== existing.x || next.z !== existing.z || next.travelSeconds !== existing.travelSeconds) && s.orders.some((o) => o.branchId === existing.id && isOpenOrder(o))) fail("No cambies la posición o ruta de una tienda con entregas pendientes.", 409);
      }
      next.id = existing?.id || id(s, kind === "sku" ? "SKU-CFG" : kind === "supplier" ? "PROV-CFG" : "TIENDA-CFG"); next.updatedAt = s.clock.now;
      if (existing) Object.assign(existing, next); else list.push(next);
      p = { ...p, id: next.id };
    }
  }
  if (kind === "branch") { s.layout.branches = clone(s.catalog.branches); migrateAutonomyConfiguration(s); migrateDeviceSettings(s); migrateAutomationBlueprint(s); }
  s.configuration.revision++; event(s, "CONFIGURATION_CHANGED", `${actor.id}: ${type}; revisión ${s.configuration.revision}.`, { actorId: actor.id, configurationRevision: s.configuration.revision });
  return { id: p.id, configurationRevision: s.configuration.revision };
}
function receivePurchase(s, purchase, inspection, explicitLines, actorId) {
      const receiptId = id(s, "REC"), receiptLines = [];
      const lines = inspection?.lines || explicitLines || purchase.lines.map((l) => ({ lineId: l.id, acceptedCases: l.cases - l.receivedCases, quarantineCases: 0 }));
      if (!Array.isArray(lines) || !lines.length) fail("Indica la mercancía recibida."); const seen = new Set(); const buffersBefore = Object.fromEntries(Object.keys(BUFFER_CAPACITY).map((key) => [key, buffered(s, key)])); let total = 0;
      for (const input of lines) {
        if (!input || typeof input !== "object" || Array.isArray(input)) fail("La línea de recepción no es válida.");
        const line = find(purchase.lines, input.lineId, "Línea de compra"); if (seen.has(line.id)) fail("Línea de recepción duplicada."); seen.add(line.id);
        const accepted = num(input.acceptedCases ?? 0, "Aceptadas", 1000, true), held = num(input.quarantineCases ?? 0, "Cuarentena", 1000, true);
        if (accepted + held > line.cases - line.receivedCases) fail("No puedes recibir más cajas que las pendientes.");
        if (input.expiry != null && typeof input.expiry !== "string") fail("La fecha debe tener formato año-mes-día.");
        const sku = skuFor(s, line.skuId); const expiry = input.expiry || (sku.expiryControlled ? addLimaDays(s.clock.now, sku.zoneId === "COLD" ? 14 : 180) : null);
        if (expiry && (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || !Number.isFinite(Date.parse(expiry)) || new Date(`${expiry}T00:00:00Z`).toISOString().slice(0, 10) !== expiry)) fail("Fecha de caducidad inválida.");
        if (accepted && sku.expiryControlled && (!expiry || expiry < dateLimit(s))) fail("La mercancía caducada o con vida útil insuficiente no puede aceptarse como disponible. Regístrala en cuarentena.");
        const lot = text(input.lot ?? `${purchase.id}-${sku.code}`, "Lote", 80); if (!lot) fail("Identifica el lote del fabricante.");
        const huIds = [];
        for (const [quantity, quarantine] of [[accepted, false], [held, true]]) {
          let remaining = quantity;
          while (remaining) { const cases = Math.min(remaining, sku.maxCasesPerHu); remaining -= cases;
            const hu = { id: id(s, "HU"), skuId: sku.id, lot, expiry, cases, reservedCases: 0, locationId: quarantine ? quarantineId(sku) : "RECEIVE",
              state: quarantine ? "QUARANTINE" : "RECEIVED", temperature: sku.temperature, createdAt: s.clock.now, purchaseId: purchase.id, receiptId, inspectionId: inspection?.id || null, supplierLot: lot, orderId: null, parentId: null };
            s.hus.push(hu); huIds.push(hu.id); if (!quarantine) putaway(s, hu);
          }
        }
        line.receivedCases += accepted + held; total += accepted + held;
        receiptLines.push({ lineId: line.id, skuId: sku.id, supplierLot: lot, expiry, acceptedCases: accepted, quarantineCases: held, huIds, qualityDecision: input.qualityDecision || (held ? accepted ? "PARTIAL_HOLD" : "HOLD" : "ACCEPT"), temperatureC: input.temperatureC ?? null });
      }
      if (!total) fail("Registra al menos una caja recibida.");
      for (const stationId of ["RECEIVE", "Q", "Q-COLD", "Q-FROZEN"]) if (buffered(s, stationId) + reservedReturns(s, stationId) + inboundBuffers(s, stationId) > BUFFER_CAPACITY[stationId] && buffered(s, stationId) > buffersBefore[stationId]) fail(`${stationId}: capacidad de espera agotada (${BUFFER_CAPACITY[stationId]} unidades de carga). Registra una recepción parcial más pequeña.`, 409);
      s.ledger.receivedCases += total;
      purchase.state = purchase.lines.every((l) => l.receivedCases === l.cases) ? "RECEIVED" : "PARTIAL";
      purchase.revision = (purchase.revision || 1) + 1;
      if (inspection) { inspection.state = "CONSUMED"; inspection.consumedAt = s.clock.now; inspection.receiptId = receiptId; }
      s.receipts.push({ id: receiptId, purchaseId: purchase.id, supplierId: purchase.supplierId, inspectionId: inspection?.id || null, mode: inspection?.mode || "LEGACY_SIMULATED", simulated: inspection?.simulated ?? true, documentNumber: inspection?.documentNumber || "Recepción heredada del escenario", checkpoint: inspection?.checkpoint || "RECEIVE", receivedBy: actorId, receivedAt: s.clock.now, lines: receiptLines, totalCases: total });
      event(s, "PURCHASE_RECEIVED", `${purchase.id}: ${total} cajas registradas; el almacenamiento se ejecuta mediante misiones.`, { purchaseId: purchase.id, receiptId, inspectionId: inspection?.id || null, actorId: actorId, simulated: inspection?.simulated ?? true }); return { id: purchase.id, receiptId, purchaseRevision: purchase.revision };
}
function receiveStoreOrder(s, order, p, actorId) {
      const inputs = p.lines || order.lines.map((l) => ({ skuId: l.skuId, receivedCases: l.cases })); if (!Array.isArray(inputs) || inputs.length !== order.lines.length) fail("Confirma todas las líneas de la entrega.");
      const seen = new Set(); let missing = 0;
      for (const input of inputs) {
        if (!input || typeof input !== "object" || Array.isArray(input)) fail("La línea de entrega no es válida.");
        const line = order.lines.find((l) => l.skuId === input.skuId); if (!line || seen.has(input.skuId)) fail("Línea de entrega inválida o duplicada."); seen.add(input.skuId);
        const received = num(input.receivedCases, "Recibidas", line.cases, true); line.receivedCases = received; line.missingCases = line.cases - received; missing += line.missingCases;
        let rest = received;
        for (const a of order.allocations.filter((a) => a.skuId === line.skuId)) {
          const hu = find(s.hus, a.huId, "Carga entregada"); const receivedHere = Math.min(rest, hu.cases); rest -= receivedHere;
          if (receivedHere) { const stock = s.storeStock.find((r) => r.branchId === order.branchId && r.orderId === order.id && r.skuId === hu.skuId && r.lot === hu.lot && r.expiry === hu.expiry);
            if (stock && stock.orderId === order.id) stock.cases += receivedHere; else s.storeStock.push({ id: id(s, "STOCK"), branchId: order.branchId, orderId: order.id, skuId: hu.skuId, lot: hu.lot, expiry: hu.expiry, cases: receivedHere, receivedAt: s.clock.now }); }
          const discrepancy = hu.cases - receivedHere; hu.cases = 0; hu.state = "DELIVERED"; hu.locationId = order.branchId; a.state = "DELIVERED"; delete hu.truckSlotId;
          if (discrepancy) { s.hus.push({ ...hu, id: id(s, "HU"), cases: discrepancy, reservedCases: 0, state: "DISCREPANCY", locationId: `INCIDENT-${order.id}`, parentId: hu.id }); }
        }
      }
      order.state = missing ? "RECEIVED_WITH_DIFFERENCE" : "RECEIVED"; order.receivedAt = s.clock.now;
      const truck = find(s.trucks, order.truckId, "Camión"); truck.state = "RETURNING"; truck.branchId = null; truck.progress = 0; truck.loadPositions = emptyLoadPositions(); truck.trip = truckTrip(s,
        { x: truck.x, z: truck.z }, truck.parkPose, find(s.catalog.branches, order.branchId, "Tienda").travelSeconds, truck);
      event(s, "STORE_RECEIVED", `${order.id}: recepción confirmada${missing ? ` con ${missing} cajas en incidencia, no disponibles en tienda` : " sin diferencias"}.`, { orderId: order.id }); return { id: order.id };
}
function commandOn(s, type, p, actor, { academicLegacyFixture = false, controlledReceivingFixture = false } = {}) {
  requireActor(actor);
  const manualFixture = academicLegacyFixture || controlledReceivingFixture;
  if(type.startsWith("supplierClaim.")) return supplierClaimCommand(s,type,p,actor,{id,event,newMission,buffered});
  if(type.startsWith("finance.")) return financeCommand(s,type,p,actor,{id,event});
  if (type.startsWith("autonomy.")) return autonomyCommand(s, type, p, actor, { id, event });
  if (!manualFixture && ["purchase.arrive", "purchase.inspect", "purchase.receive", "order.dispatch", "order.receive"].includes(type)) fail("Este paso lo ejecuta el proceso autónomo con evidencia de sus equipos. Autoriza la incorporación de expedientes anteriores desde Autonomía; no se permite confirmar mercancía manualmente.", 409);
  if (type.startsWith("config.")) return configCommand(s, type, p, actor);
  if (type.startsWith("maintenance.")) {
    const action = type.split(".")[1]; permit(actor, action === "request" ? ["operations", "admin"] : ["admin"]);
    if (action !== "request" && (!Number.isInteger(p.expectedRevision) || p.expectedRevision !== s.configuration.revision)) fail("La configuración o el mantenimiento cambió en otra sesión. Recarga antes de continuar.", 409);
    return maintenanceCommand(s, action, p, actor, { id, event });
  }
  switch (type) {
    case "purchase.create": {
      permit(actor, ["operations"]); const supplier = find(s.catalog.suppliers, p.supplierId, "Proveedor"); if (!supplier.active) fail("El proveedor está desactivado.");
      const purchase = { id: id(s, "OC"), revision: 1, supplierId: supplier.id, state: "ORDERED", createdAt: s.clock.now, expectedAt: s.clock.elapsed + 30,
        lines: validateLines(s, p.lines, supplier.id), createdBy: actor.id };
      s.purchases.push(purchase);
      issueSupplierInvoice(s,purchase,{id,event});
      if (!manualFixture) { purchase.expectedAt = s.clock.elapsed + s.configuration.autonomy.arrivalSeconds; authorizeAutonomy(s, "PURCHASE", purchase, actor, { id, event }); }
      event(s, "PURCHASE_CREATED", `${purchase.id}: suministro solicitado y llegada programada.`, { purchaseId: purchase.id }); return { id: purchase.id };
    }
    case "purchase.cancel": {
      permit(actor, ["operations"]); const purchase = find(s.purchases, p.id, "Compra");
      const job = s.autonomy.jobs.find(row => row.kind === "PURCHASE" && row.documentId === purchase.id && !CLOSED.has(row.state));
      if (p.expectedRevision != null && p.expectedRevision !== (purchase.revision || 1)) fail("La compra cambió. Recarga antes de cancelar.", 409);
      if (!canCancelPurchase(s, purchase, job)) fail("Se puede cancelar antes de la llegada o al cerrar una llegada simulada retenida sin mercancía registrada.", 409);
      const arrived = purchase.state === "ARRIVED";
      const reason = strictText(p.reason, "Motivo", 500, 10, { multiline: true }); purchase.state = "CANCELLED"; purchase.revision = (purchase.revision || 1) + 1; purchase.cancelReason = reason; purchase.cancelledAt = s.clock.now; purchase.cancelledBy = actor.id;
      cancelSupplierInvoice(s,purchase,{id,event});
      if (job) cancelInboundProcess(s, job, actor, reason);
      event(s, "PURCHASE_CANCELLED", `${purchase.id}: ${arrived ? "llegada simulada retenida cerrada y muelle liberado" : "compra cancelada antes de su llegada"}; sin alteración de existencias.`, { purchaseId: purchase.id, actorId: actor.id }); return { id: purchase.id };
    }
    case "purchase.arrive": {
      permit(actor, ["operations"]); const purchase = find(s.purchases, p.id, "Compra");
      if (purchase.state !== "ORDERED") fail("La compra ya llegó o está cerrada."); arrival(s, purchase); return { id: purchase.id };
    }
    case "purchase.inspect": permit(actor, ["operations"]); return inspectPurchase(s, p, actor, { id, event, dateLimit });
    case "purchase.receive": {
      permit(actor, ["operations"]); const purchase = find(s.purchases, p.id, "Compra");
      if (!["ARRIVED", "PARTIAL"].includes(purchase.state)) fail("Espera la llegada antes de recibir.");
      if (!p.inspectionId && !academicLegacyFixture) fail("Registra una inspección vigente antes de recibir las existencias.", 422, "inspectionId");
      const inspection = p.inspectionId ? inspectionForReceipt(s, purchase, p) : null;
      return receivePurchase(s, purchase, inspection, p.lines, actor.id);
    }
    case "inventory.releaseQuarantine": {
      permit(actor, ["operations"]); const hu = find(s.hus, p.huId, "Unidad de carga"); if (hu.state !== "QUARANTINE") fail("La unidad no está retenida.");
      if (hu.packagingDefect) fail("El embalaje tiene un daño visual confirmado. Mantén la retención y documenta su baja; no puede liberarse como mercancía conforme.",409);
      if (hu.expiry && hu.expiry < limaDate(s.clock.now)) fail("La mercancía caducada no puede liberarse.");
      if (!isFresh(s, hu)) fail("La unidad no cumple la vida útil mínima configurada; conserva la retención.");
      hu.qualityHistory = [...(hu.qualityHistory || []), { action: "RELEASED", at: s.clock.now, actorId: actor.id, note: text(p.note ?? "Control de calidad aprobado", "Observación", 300) }];
      hu.state = "RECEIVED"; putaway(s, hu); event(s, "QUARANTINE_RELEASED", `${hu.id}: control aprobado; pendiente de almacenamiento.`, { huId: hu.id, actorId: actor.id }); return { id: hu.id };
    }
    case "order.create": {
      permit(actor, ["store"]); return createStoreRequest(s, p, actor);
    }
    case "order.edit": {
      permit(actor, ["store"]); const order = ownsOrder(s, actor, p.id);
      if (order.state !== "PENDING" || order.allocations.length) fail("Solo puedes modificar una solicitud pendiente, antes de la reserva y preparación.", 409);
      if (!Number.isInteger(p.expectedOrderRevision) || p.expectedOrderRevision !== (order.revision || 1)) fail("La solicitud cambió en otra sesión. Recárgala antes de editarla.", 409);
      if (!find(s.catalog.branches, actor.branchId, "Tienda").active) fail("La tienda está desactivada.", 409);
      const lines = validateLines(s, p.lines); if (lines.reduce((total, line) => total + line.cases, 0) > s.configuration.settings.maxOrderCases) fail(`Un pedido admite hasta ${s.configuration.settings.maxOrderCases} cajas.`, 422, "lines");
      if (p.priority !== undefined && p.priority !== "NORMAL") fail("La priorización logística corresponde al jefe de operaciones.", 403, "priority");
      order.lines = lines; order.notes = optionalText(p.notes ?? order.notes, "Notas", 300, { multiline: true }); order.requestedByDate = requestedDate(s, Object.hasOwn(p, "requestedByDate") ? p.requestedByDate : order.requestedByDate); order.updatedAt = s.clock.now; order.revision = (order.revision || 1) + 1;
      event(s, "ORDER_EDITED", `${order.id}: solicitud de tienda actualizada antes de reservar mercancía.`, { orderId: order.id, branchId: order.branchId, actorId: actor.id }); return { id: order.id, orderRevision: order.revision };
    }
    case "order.release": {
      permit(actor, ["operations"]); const order = ownsOrder(s, actor, p.id); if (order.state !== "PENDING") fail("Solo se liberan pedidos pendientes.");
      for (const line of order.lines) if (available(s, line.skuId) < line.cases) fail(`Existencias insuficientes para ${skuFor(s, line.skuId).name}. No se ha reservado ninguna línea.`);
      for (const line of order.lines) {
        let remaining = line.cases;
        const eligible = s.hus.filter((h) => h.skuId === line.skuId && h.state === "STORED" && !s.locationStatus[h.locationId]?.blocked && isFresh(s, h))
          .sort((a, b) => String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")) || a.createdAt.localeCompare(b.createdAt));
        for (const source of eligible) {
          const cases = Math.min(remaining, source.cases - source.reservedCases); if (!cases) continue;
          const allocation = { id: id(s, "AL"), skuId: line.skuId, sourceHuId: source.id, huId: id(s, "HU"), cases, picked: false, state: "RESERVED" };
          source.reservedCases += cases; order.allocations.push(allocation);
          const location = posFor(s, source.locationId);
          newMission(s, { kind: "PICK", orderId: order.id, allocationId: allocation.id, huId: source.id, shipmentHuId: allocation.huId,
            sourceHuId: source.id, allocatedCases: cases, cases: source.cases, sourceId: source.locationId, originLocationId: source.locationId, destinationId: location.stackerId ? location.handoffId : "PACK",
            deviceType: location.stackerId ? (location.zoneId === "FROZEN" ? "SHUTTLE" : "STACKER") : "AMR", requiredRobotId: location.stackerId || null,
            zoneId: location.zoneId, priority: order.priority });
          remaining -= cases; if (!remaining) break;
        }
      }
      if (order.allocations.length > 24 || loadGroups(s, order.allocations).reduce((rows, group) => rows + Math.ceil(group.loads.length / 2), 0) > 12) fail("El pedido necesita más de 24 plazas o excede sus compartimentos segregados. Divide la solicitud para preparar cada expedición de forma segura.");
      order.state = "PREPARING"; order.releasedAt = s.clock.now; order.revision = (order.revision || 1) + 1;
      if (!manualFixture) authorizeAutonomy(s, "ORDER", order, actor, { id, event });
      event(s, "ORDER_RELEASED", `${order.id}: reservas FEFO y misiones creadas; los equipos se asignan automáticamente.`, { orderId: order.id }); return { id: order.id };
    }
    case "order.cancel": {
      permit(actor, ["operations", "store"]); const order = ownsOrder(s, actor, p.id); if (actor.role === "store" && order.state !== "PENDING") fail("La tienda solo puede cancelar solicitudes aún pendientes.", 403);
      if (order.state === "CANCELLED") fail("La solicitud ya está cancelada.", 409);
      cancelOrder(s, order);
      order.cancelReason = strictText(p.reason, "Motivo", 300, 8, { multiline: true }); order.cancelledBy = actor.id; order.cancelledAt = s.clock.now;
      return { id: order.id };
    }
    case "order.priority": {
      permit(actor, ["operations"]); const order = ownsOrder(s, actor, p.id);
      if (!["PENDING", "PREPARING"].includes(order.state)) fail("Solo se priorizan solicitudes pendientes o en preparación.");
      if (!["LOW", "NORMAL", "HIGH"].includes(p.priority)) fail("Prioridad no válida."); order.priority = p.priority;
      order.revision = (order.revision || 1) + 1;
      for (const m of s.missions.filter((m) => m.orderId === order.id && m.state === "QUEUED")) m.priority = p.priority;
      event(s, "ORDER_PRIORITIZED", `${order.id}: prioridad ${p.priority}; no se interrumpen equipos con carga.`, { orderId: order.id, actorId: actor.id }); return { id: order.id };
    }
    case "order.rejectPrepared": {
      permit(actor, ["operations"]); const order = ownsOrder(s, actor, p.id);
      const reason = strictText(p.reason, "Motivo de retención", 300, 8);
      if (order.state === "LOADING" && order.loading?.phase === "QUALITY_HOLD") {
        const truck = find(s.trucks, order.truckId, "Camión retenido"), dock = loadingDock(s, truck.dockId), robot = find(s.robots, dock.forkliftId, "Montacargas");
        if (robot.missionId || robot.carryingHuId || robot.state === "FAULT") fail("Recupera el montacargas y espera a que quede libre antes de descargar.", 409);
        order.rejectionReason = reason; order.loading.rejecting = true; truck.loading.rejecting = true; truck.loading.openingFrom = truck.doorProgress;
        const slots = truck.loadPositions.filter(slot => slot.huId).sort((a, b) => b.row - a.row || a.column - b.column);
        if (slots.length !== order.allocations.length) fail("La carga debe estar completa e inmovilizada para descargar de forma segura.", 409);
        for (const slot of slots) {
          const hu = find(s.hus, slot.huId, "Carga retenida");
          hu.qualityHistory = [...(hu.qualityHistory || []), { action: "HOLD", at: s.clock.now, actorId: actor.id, note: reason }];
          newMission(s, { kind: "TRUCK_UNLOAD", deviceType: "FORKLIFT", requiredRobotId: robot.id, huId: hu.id, cases: hu.cases, sourceId: `${truck.id}:${slot.id}`, destinationId: hu.stagingSlotId, truckId: truck.id, truckSlotId: slot.id, dockId: dock.id, orderId: order.id });
        }
        setLoadingPhase(s, truck, "OPENING_REJECTION");
        event(s, "TRUCK_LOAD_REJECTED", `${order.id}: descarga física solicitada antes del retorno a cuarentena.`, { orderId: order.id, truckId: truck.id, actorId: actor.id }); return { id: order.id };
      }
      if (order.state !== "READY") fail("Solo puede retenerse un pedido preparado o una carga inmovilizada por calidad, antes de salir.");
      for (const a of order.allocations) {
        const hu = find(s.hus, a.huId, "Carga preparada"); if (hu.state !== "STAGED") fail("La carga no está inmovilizada en expedición.", 409);
        hu.state = "WAITING_QUARANTINE"; hu.qualityHistory = [...(hu.qualityHistory || []), { action: "HOLD", at: s.clock.now, actorId: actor.id, note: reason }]; a.state = "QUALITY_HOLD";
        newMission(s, { kind: "RETURN_TO_QUARANTINE", huId: hu.id, cases: hu.cases, sourceId: hu.locationId, destinationId: quarantineId(skuFor(s, hu.skuId)), deviceType: "AMR", zoneId: skuFor(s, hu.skuId).zoneId, referenceOrderId: order.id, priority: "HIGH" });
      }
      order.state = "CANCELLED_AFTER_PREPARATION"; order.rejectionReason = reason; order.cancelledAt = s.clock.now;
      event(s, "ORDER_QUALITY_HOLD", `${order.id}: salida anulada; las cargas viajan a cuarentena mediante misiones.`, { orderId: order.id, actorId: actor.id }); return { id: order.id };
    }
    case "order.dispatch": {
      permit(actor, ["operations"]); return startPhysicalDispatch(s, ownsOrder(s, actor, p.id), p);
    }
    case "order.receive": {
      permit(actor, ["operations", "store"]); const order = ownsOrder(s, actor, p.id); if (order.state !== "ARRIVED") fail("El camión debe llegar antes de confirmar la recepción.");
      return receiveStoreOrder(s, order, p, actor.id);
    }
    case "return.create": {
      permit(actor, ["operations", "store"]); const order = ownsOrder(s, actor, p.orderId); if (!["RECEIVED", "RECEIVED_WITH_DIFFERENCE"].includes(order.state)) fail("Solo se devuelve mercancía recibida.");
      const line = order.lines.find((l) => l.skuId === p.skuId); if (!line) fail("Ese producto no forma parte del pedido."); const cases = num(p.cases);
      const returnedBefore = s.returns.filter((r) => r.orderId === order.id && r.skuId === p.skuId).reduce((a, r) => a + r.cases, 0);
      if (cases + returnedBefore > line.receivedCases) fail("No puedes devolver más de lo recibido en ese pedido.");
      const stocks = s.storeStock.filter((r) => r.branchId === order.branchId && r.skuId === p.skuId && r.orderId === order.id);
      if (stocks.reduce((a, r) => a + r.cases, 0) < cases) fail("La tienda no dispone de esas cajas para devolver.");
      const reason = text(p.reason, "Motivo"); if (reason.length < 4) fail("Indica un motivo de devolución.");
      const ret = { id: id(s, "DEV"), orderId: order.id, branchId: order.branchId, skuId: p.skuId, cases, reason: reason.slice(0, 300), state: "WAITING_PICKUP", createdAt: s.clock.now, createdBy: actor.id, truckId: null, loads: [] };
      let left = cases; for (const stock of stocks) { const n = Math.min(left, stock.cases); if (!n) continue; stock.cases -= n;
        let loadLeft = n; while (loadLeft) { const loadCases = Math.min(loadLeft, skuFor(s, p.skuId).maxCasesPerHu); ret.loads.push({ lot: stock.lot, expiry: stock.expiry, cases: loadCases }); loadLeft -= loadCases; }
        left -= n; if (!left) break;
      }
      checkIncomingBuffers(s, { [quarantineId(skuFor(s, p.skuId))]: ret.loads.length });
      s.returns.push(ret); event(s, "RETURN_CREATED", `${ret.id}: cajas apartadas en tienda; esperando un camión para el transporte inverso.`, { returnId: ret.id, branchId: order.branchId }); return { id: ret.id };
    }
    case "store.consume": {
      permit(actor, ["store"]);
      if (p.branchId && p.branchId !== actor.branchId) fail("Solo puedes registrar ventas en tu tienda.", 403);
      const sku = skuFor(s, p.skuId), cases = num(p.cases);
      const reason = optionalText(p.reason, "Motivo de salida", 300, { multiline: true });
      const reference = optionalText(p.reference, "Referencia de salida", 60);
      const stocks = s.storeStock.filter((r) => r.branchId === actor.branchId && r.skuId === sku.id && r.cases > 0 && (!r.expiry || r.expiry >= limaDate(s.clock.now))).sort((a, b) => String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")));
      if (stocks.reduce((a, r) => a + r.cases, 0) < cases) fail("La tienda no dispone de esas cajas vigentes para simular la venta.");
      let rest = cases; for (const stock of stocks) { const quantity = Math.min(rest, stock.cases); stock.cases -= quantity; rest -= quantity; if (!rest) break; }
      s.ledger.consumedCases += cases; event(s, "STORE_SALE", `${sku.name}: salida de ${cases} cajas en ${s.catalog.branches.find(row => row.id === actor.branchId)?.name || actor.branchId}.`, { branchId: actor.branchId, skuId: sku.id, cases, reason, reference }); return { skuId: sku.id, cases };
    }
    case "equipment.fault": {
      permit(actor, ["operations"]); const robot = find(s.robots, p.id, "Equipo"); if (robot.state === "FAULT") fail("El equipo ya tiene una incidencia.");
      if (s.catalog.assets.some(asset => asset.deviceId === robot.id && !asset.active)) fail("El equipo está desactivado y no admite nuevas acciones operativas.", 409);
      if (robot.state === "MAINTENANCE") fail("El equipo ya está retirado para mantenimiento; registra la incidencia en su expediente.", 409);
      robot.previousState = robot.state; robot.state = "FAULT"; robot.faultReason = text(p.reason ?? "Incidencia de demostración", "Motivo", 150);
      event(s, "EQUIPMENT_FAULT", `${robot.name}: detenido; la carga y las reservas permanecen trazadas.`, { robotId: robot.id }); return { id: robot.id };
    }
    case "equipment.recover": {
      permit(actor, ["operations"]); const robot = find(s.robots, p.id, "Equipo"); if (robot.state !== "FAULT") fail("El equipo no tiene una incidencia activa.");
      const registry = s.catalog.assets.find(asset => asset.deviceId === robot.id);
      if (registry && (!registry.active || registry.status === "MAINTENANCE")) fail("El equipo está retirado para servicio. Administración debe completar su inspección antes de liberarlo.", 409);
      robot.state = robot.previousState || "IDLE"; delete robot.previousState; delete robot.faultReason; event(s, "EQUIPMENT_RECOVERED", `${robot.name}: recuperado en su posición y misión conservadas.`, { robotId: robot.id }); return { id: robot.id };
    }
    case "location.block": {
      permit(actor, ["operations"]); const location = find(s.layout.locations, p.id, "Ubicación"); if (typeof p.blocked !== "boolean") fail("Selecciona un estado de bloqueo válido."); const blocked = p.blocked;
      if (blocked && (s.locationStatus[location.id]?.reservedFor || s.missions.some((m) => !CLOSED.has(m.state) && [m.sourceId, m.destinationId, m.finalLocationId].includes(location.id)))) fail("La plaza tiene un traslado reservado. Resuelve la misión antes de bloquearla.");
      s.locationStatus[location.id] = { ...(s.locationStatus[location.id] || {}), blocked }; event(s, "LOCATION_CHANGED", `${location.code}: ${blocked ? "bloqueada para nuevas operaciones" : "habilitada"}.`, { locationId: location.id }); return { id: location.id };
    }
    case "incident.resolve": {
      permit(actor, ["operations"]); if (typeof p.id !== "string") fail("Incidencia inválida.");
      const incident = incidentsOf(s).find((i) => i.id === p.id); if (!incident || !incident.resolutions.includes("WRITE_OFF")) fail("Esta incidencia no admite una baja: utiliza su acción operativa indicada.", 409);
      if (p.resolution !== "WRITE_OFF") fail("Selecciona una resolución válida."); const note = strictText(p.note, "Motivo de la baja", 300, 8);
      const hu = find(s.hus, incident.huId, "Carga retenida"); if (!["QUARANTINE", "DISCREPANCY"].includes(hu.state) || hu.reservedCases) fail("La carga tiene actividad pendiente; la baja no es segura.", 409);
      if(s.robots.some(r=>r.carryingHuId===hu.id) || s.missions.some(m=>m.huId===hu.id && !CLOSED.has(m.state))) fail("El retiro físico aún está en curso. Espera a que la carga quede inmovilizada en cuarentena.",409);
      if (hu.packagingDefect && hu.purchaseId) fail("Estas cajas requieren una reclamación al proveedor. Abre Cajas observadas en Recepción.",409);
      const quantity = hu.cases; hu.cases = 0; hu.state = "WRITTEN_OFF"; hu.writtenOffAt = s.clock.now; hu.writeOffReason = note;
      const withdrawal=s.expiryWithdrawals?.find(r=>r.huId===hu.id); if(withdrawal)Object.assign(withdrawal,{state:"WRITTEN_OFF",completedAt:s.clock.now,approvedBy:actor.id,reason:note});
      s.ledger.writtenOffCases += quantity; event(s, "STOCK_WRITTEN_OFF", `${hu.id}: baja de ${quantity} cajas. ${note}`, { huId: hu.id, cases:quantity, actorId: actor.id, incidentId: incident.id }); return { id: incident.id, cases: quantity };
    }
    case "simulation.pause": permit(actor, ["operations"]); if (typeof p.paused !== "boolean") fail("Indica si la simulación debe pausarse."); s.clock.paused = p.paused; return { paused: s.clock.paused };
    case "simulation.speed": permit(actor, ["operations"]); { const speed = num(p.speed, "Velocidad", 60); if (![1, 5, 20, 60].includes(speed)) fail("Velocidad permitida: 1, 5, 20 o 60."); s.clock.speed = speed; return { speed: s.clock.speed }; }
    default: fail("Acción desconocida.", 404);
  }
}

function arrival(s, p) { p.state = "ARRIVED"; p.revision = (p.revision || 1) + 1; p.arrivedAt = s.clock.now; event(s, "PURCHASE_ARRIVED", `${p.id}: proveedor en recepción; falta controlar y aceptar las cajas.`, { purchaseId: p.id }); }
function releaseLocks(s, missionId) { for (const [key, owner] of Object.entries(s.routeLocks)) if (owner === missionId) delete s.routeLocks[key]; }
function routeKeys(path) { return path.slice(1).map((p, i) => [path[i].nodeId, p.nodeId].sort().join("~")).filter((key) => !key.includes("undefined")); }
function setRoute(s, robot, mission, from, to, reserveThrough = null) {
  const path = robot.type === "AMR" ? graphPath(s, point(s, from).nodeId, point(s, to).nodeId, robot) : stackerPath(s, robot, from, to);
  if (!path) return false;
  // Acquire the pickup AND loaded leg atomically. Otherwise two devices can
  // collect loads at opposite ends of a narrow route and deadlock each other.
  const onward = reserveThrough && robot.type === "AMR" ? graphPath(s, point(s, to).nodeId, point(s, reserveThrough).nodeId, robot) : [];
  if (onward === null) return false;
  const reservedPath = [...path, ...onward];
  const keys = robot.type === "AMR" ? [...routeKeys(path), ...routeKeys(onward), ...reservedPath.map((p) => `node:${p.nodeId}`)] : [];
  if (keys.some((key) => s.routeLocks[key] && s.routeLocks[key] !== mission.id)) return false;
  if (robot.type === "AMR" && reservedPath.slice(1).some((point) => s.robots.some((other) => other.id !== robot.id && other.type === "AMR" && other.nodeId === point.nodeId && distance(other, point) < 1.8))) return false;
  releaseLocks(s, mission.id); keys.forEach((key) => { s.routeLocks[key] = mission.id; });
  robot.route = path; robot.routeIndex = 1; robot.segmentProgress = 0; mission.route = path; mission.progress = 0; return true;
}
function requestRobotCharge(s, robot) {
  for (const station of s.layout.stations.filter(node => node.type === "CHARGER").sort((a, b) => priorityOf(s, b.id) - priorityOf(s, a.id) || distance(robot, a) - distance(robot, b))) {
    if (!deviceAvailable(s, station.id) || s.routeLocks[`charger:${station.id}`]) continue;
    const charge = { id: `charge:${robot.id}` }; if (!setRoute(s, robot, charge, robot.nodeId, station.id)) continue;
    s.routeLocks[`charger:${station.id}`] = robot.id; robot.chargerId = station.id; robot.state = "TO_CHARGER"; return true;
  }
  return false;
}
function releaseRobot(s, robot) { if (robot.missionId) releaseLocks(s, robot.missionId); robot.state = "IDLE"; robot.missionId = null; robot.route = []; robot.carryingHuId = null; }
function load(s, m, robot) {
  let hu = s.hus.find((h) => h.id === m.huId);
  if (m.sourceHuId) {
    const source = find(s.hus, m.sourceHuId, "Carga origen"); if (source.cases < m.allocatedCases || source.reservedCases < m.allocatedCases || source.state !== "STORED") fail("Invariante de reserva incumplida.", 500);
    // A fork/stacker removes the entire unit; it cannot pick loose cases in a high rack.
    // The fixed consolidation station separates closed cases and sends the remainder back.
    m.cases = source.cases; hu = source;
    s.locationStatus[m.originLocationId] = { ...(s.locationStatus[m.originLocationId] || {}), reservedFor: source.id };
    hu.locationId = robot.id; hu.state = "MOVING";
    const order = find(s.orders, m.orderId, "Pedido"); const a = find(order.allocations, m.allocationId, "Reserva"); a.picked = true; a.state = "MOVING";
  } else { hu = find(s.hus, m.huId, "Carga"); hu.state = "MOVING"; hu.locationId = robot.id; }
  robot.carryingHuId = hu.id; event(s, "LOAD_PICKED", `${robot.name} recogió ${hu.id} · ${m.cases} cajas.`, { missionId: m.id, huId: hu.id, orderId: m.orderId });
}
function finish(s, m, robot) {
  const hu = find(s.hus, m.huId, "Carga"); hu.locationId = m.destinationId; hu.state = "AT_TRANSFER";
  m.state = "COMPLETED"; m.phase = "COMPLETE"; m.completedAt = s.clock.now; m.progress = 1;
  releaseRobot(s, robot);
  if(m.expiryWithdrawalId){
    if(m.destinationId!==m.expiryDestinationId){
      hu.state="WAITING_QUARANTINE";newMission(s,{kind:"RETURN_TO_QUARANTINE",huId:hu.id,cases:hu.cases,sourceId:m.destinationId,destinationId:m.expiryDestinationId,deviceType:"AMR",zoneId:m.zoneId,priority:"HIGH",expiryWithdrawalId:m.expiryWithdrawalId,expiryDestinationId:m.expiryDestinationId});
    }else{hu.state="QUARANTINE";const record=s.expiryWithdrawals.find(r=>r.id===m.expiryWithdrawalId);Object.assign(record,{state:"AWAITING_DISPOSAL",arrivedAt:s.clock.now});event(s,"EXPIRY_QUARANTINED",`${hu.id}: retiro por vencimiento completado en cuarentena; pendiente de baja documentada.`,{huId:hu.id,withdrawalId:m.expiryWithdrawalId});}
  }else if (m.kind === "PUTAWAY") {
    const target = posFor(s, m.finalLocationId);
    if (m.destinationId !== m.finalLocationId) newMission(s, { kind: "PUTAWAY", huId: hu.id, cases: hu.cases, sourceId: m.destinationId, destinationId: target.id,
      finalLocationId: target.id, deviceType: target.zoneId === "FROZEN" ? "SHUTTLE" : "STACKER", requiredRobotId: target.stackerId, zoneId: target.zoneId });
    else { hu.state = "STORED"; if (s.locationStatus[target.id]?.reservedFor === hu.id) delete s.locationStatus[target.id].reservedFor; event(s, "PUTAWAY_COMPLETED", `${hu.id}: almacenada en ${target.code}.`, { huId: hu.id }); }
  } else if (m.kind === "PICK") {
    if (m.destinationId !== "PACK") newMission(s, { kind: "PICK_TO_PACK", huId: hu.id, shipmentHuId: m.shipmentHuId, allocatedCases: m.allocatedCases,
      originLocationId: m.originLocationId, cases: hu.cases, sourceId: m.destinationId, destinationId: "PACK", deviceType: "AMR", zoneId: m.zoneId, orderId: m.orderId, allocationId: m.allocationId, priority: m.priority });
    else startPacking(s, hu, m);
  } else if (m.kind === "PICK_TO_PACK") startPacking(s, hu, m);
  else if (m.kind === "RETURN_TO_QUARANTINE") {
    hu.state = "QUARANTINE"; event(s, "QUALITY_HOLD_ARRIVED", `${hu.id}: carga depositada en cuarentena; no disponible para venta.`, { huId: hu.id, orderId: m.referenceOrderId });
  } else if (m.kind === "SUPPLIER_RETURN") {
    hu.state = "SUPPLIER_RETURN_READY";
    const claim=s.supplierClaims.find(c=>c.id===m.supplierClaimId);
    claim.returnReadyAt=s.clock.now; claim.updatedAt=s.clock.now; claim.revision++;
    claim.history.push({at:s.clock.now,actorId:"AUTOMATION",action:"RETURN_READY",detail:"Carga segregada depositada en recepción para recogida del proveedor."});
    event(s,"SUPPLIER_RETURN_READY",`${claim.id}: devolución depositada y bloqueada para venta.`,{claimId:claim.id,huId:hu.id});
  } else if (m.kind === "TO_STAGING") {
    hu.state = "STAGED"; assignStagingSlot(s, hu, m.destinationId); const order = find(s.orders, m.orderId, "Pedido"); const a = find(order.allocations, m.allocationId, "Reserva"); a.state = "STAGED";
    if (order.allocations.every((a) => a.state === "STAGED")) { order.state = "READY"; order.readyAt = s.clock.now; event(s, "ORDER_READY", `${order.id}: cajas completas en expedición; falta autorizar la salida.`, { orderId: order.id }); }
  }
}
function startPacking(s, hu, m) {
  hu.state = "PACKING"; hu.locationId = "PACK"; hu.packReadyAt = s.clock.elapsed + 5;
  hu.packContext = { orderId: m.orderId, allocationId: m.allocationId, shipmentHuId: m.shipmentHuId, cases: m.allocatedCases, originLocationId: m.originLocationId, priority: m.priority };
  const order = find(s.orders, m.orderId, "Pedido"); find(order.allocations, m.allocationId, "Reserva").state = "PACKING";
}
function beginStagingManeuver(s, mission, robot) {
  const hu = find(s.hus, mission.huId, "Carga para expedición"), dock = loadingDock(s, mission.destinationId);
  const slot = assignStagingSlot(s, hu, dock.id); hu.stagingReserved = true;
  mission.phase = "STAGING_APPROACH"; robot.state = "STAGING_APPROACH"; robot.cargoHeight = 0.95;
  // Keep the mission's existing graph/node locks until this device has deposited
  // the load and returned to the dock node. No second AMR enters this bay.
  const aisleZ = slot.z + 2.6;
  routeLoadingDevice(robot, [{ x: dock.x, y: 0, z: aisleZ, heading: aisleZ > robot.z ? 0 : Math.PI }, { x: slot.x, y: 0, z: aisleZ, heading: slot.x > dock.x ? Math.PI / 2 : -Math.PI / 2 }, { x: slot.x, y: 0, z: slot.z, heading: Math.PI }]);
  mission.route = clone(robot.route);
}
function move(s, robot, seconds) {
  const path = robot.route; if (!path.length || robot.routeIndex >= path.length) return true;
  if (robot.type === "AMR") {
    const complete = advanceGuided(s, robot, seconds, { speed: 1.5 * speedFactor(robot) });
    if (robot.battery !== null) robot.battery = Math.max(0, robot.battery - seconds * .01);
    return complete;
  }
  let timeLeft = seconds;
  while (timeLeft > 0 && robot.routeIndex < path.length) {
    const target = path[robot.routeIndex], remaining = distance(robot, target);
    if (Math.hypot(target.x - robot.x, target.z - robot.z) > 0.0001) robot.heading = Math.atan2(target.x - robot.x, target.z - robot.z);
    // Generic scenario parameters in m/s, not specifications of a branded machine.
    const speed = (robot.type === "AMR" ? 1.5 : robot.type === "STACKER" ? (Math.abs((target.y || 0) - (robot.y || 0)) > 0.01 ? 0.8 : 2.5) : 1.2) * speedFactor(robot);
    const needed = remaining / speed;
    if (needed <= timeLeft) { robot.x = target.x; robot.y = target.y || 0; robot.z = target.z; robot.nodeId = target.nodeId; timeLeft -= needed; robot.routeIndex++; }
    else { const ratio = timeLeft * speed / remaining; robot.x += (target.x - robot.x) * ratio; robot.z += (target.z - robot.z) * ratio; robot.y += ((target.y || 0) - (robot.y || 0)) * ratio; timeLeft = 0; }
  }
  if (robot.battery !== null) robot.battery = Math.max(0, robot.battery - seconds * 0.01);
  return robot.routeIndex >= path.length;
}
function beginForkliftLoad(s, truck, robot, mission, dock) {
  const hu = find(s.hus, mission.huId, "Carga en espera"), source = stagingPoint(s, hu);
  const unloading = mission.kind === "TRUCK_UNLOAD", slot = find(truck.loadPositions, mission.truckSlotId, "Plaza de remolque");
  if (!source || (unloading ? hu.locationId !== truck.id || slot.huId !== hu.id || hu.state !== "ON_TRUCK" : hu.locationId !== dock.id || hu.state !== "RESERVED_LOADING")) fail("La carga no está en su plaza física reservada.", 500);
  mission.state = "ACTIVE"; mission.robotId = robot.id; mission.phase = "TO_SOURCE"; mission.startedAt = s.clock.now;
  robot.missionId = mission.id; robot.loadingPhase = "TO_SOURCE"; robot.state = "TO_SOURCE"; robot.liftHeight = unloading ? 0 : 0.18;
  truck.loading.currentMissionId = mission.id;
  if (unloading) {
    const targetX = truck.x + slot.x;
    routeLoadingDevice(robot, [{ x: targetX, y: 0, z: 28.5, heading: Math.PI / 2 }, { x: targetX, y: 0, z: dock.ramp.start.z, heading: 0 }, { x: targetX, y: 1.2, z: dock.ramp.end.z, heading: 0 }, { x: targetX, y: 1.2, z: truck.z + slot.z - robot.cargoOffsetZ, heading: 0 }]);
    mission.route = clone(robot.route); return;
  }
  const aisleZ = source.z + 2.6;
  routeLoadingDevice(robot, [{ x: dock.x - 6, y: 0, z: aisleZ, heading: Math.PI }, { x: source.x, y: 0, z: aisleZ, heading: Math.PI / 2 }, { x: source.x, y: 0, z: source.z + robot.cargoOffsetZ, heading: Math.PI }]);
  mission.route = clone(robot.route);
}
function forkliftToTrailer(robot, source, slot, dock, truck) {
  const targetX = truck.x + slot.x;
  routeLoadingDevice(robot, [{ x: source.x, y: 0, z: source.z + 2.6, heading: Math.PI }, { x: dock.x - 6, y: 0, z: source.z + 2.6, heading: -Math.PI / 2 }, { x: dock.x - 6, y: 0, z: 28.5, heading: 0 }, { x: targetX, y: 0, z: 28.5, heading: Math.PI / 2 }, { x: targetX, y: 0, z: dock.ramp.start.z, heading: 0 }, { x: targetX, y: dock.ramp.end.y, z: dock.ramp.end.z, heading: 0 }, { x: targetX, y: 1.2, z: truck.z + slot.z - robot.cargoOffsetZ, heading: 0 }]);
}
function returnForkliftHome(robot, dock) {
  routeLoadingDevice(robot, [{ x: robot.x, y: 1.2, z: dock.ramp.end.z, heading: 0 }, { x: robot.x, y: 0, z: dock.ramp.start.z, heading: 0 }, { x: dock.forkliftHome.x, y: 0, z: 28.5, heading: -Math.PI / 2 }, dock.forkliftHome]);
}
function forkliftToStaging(robot, source, dock) {
  routeLoadingDevice(robot, [{ x: robot.x, y: 1.2, z: dock.ramp.end.z, heading: 0 }, { x: robot.x, y: 0, z: dock.ramp.start.z, heading: 0 }, { x: dock.x - 6, y: 0, z: 28.5, heading: -Math.PI / 2 }, { x: dock.x - 6, y: 0, z: source.z + 2.6, heading: Math.PI }, { x: source.x, y: 0, z: source.z + 2.6, heading: Math.PI / 2 }, { x: source.x, y: 0, z: source.z + robot.cargoOffsetZ, heading: Math.PI }]);
}
function holdPhysicalLoading(s, truck, order, dock, hu) {
  order.loading.blockedReason = `${hu.id}: ya no cumple vida útil. Retén la preparación para descargarla de forma segura.`;
  if (Math.abs(truck.z - dock.truckPose.z) > 0.01 || Math.abs(truck.x - dock.truckPose.x) > 0.01) {
    setLoadingPhase(s, truck, "REDOCKING_HOLD"); routeLoadingDevice(truck, [dock.truckPose]);
  } else setLoadingPhase(s, truck, "QUALITY_HOLD");
}
function tickPhysicalLoading(s, seconds) {
  for (const truck of s.trucks.filter(truck => truck.loading && truck.dockId && s.dockReservations[truck.dockId]?.truckId === truck.id)) {
    const dock = loadingDock(s, truck.dockId), robot = find(s.robots, dock.forkliftId, "Montacargas"), order = find(s.orders, truck.orderId, "Pedido en carga");
    if (robot.state === "FAULT") { order.loading.blockedReason = "Montacargas detenido por incidencia; conserva carga, plaza y camión."; continue; }
    delete order.loading.blockedReason;
    truck.loading.phaseElapsed += seconds;
    if (!truck.loading.rejecting && ["CLOSING", "UNDOCKING"].includes(truck.loadingState)) {
      const bad = order.allocations.map(a => find(s.hus, a.huId, "Carga verificada")).find(hu => !isFresh(s, hu));
      if (bad) { holdPhysicalLoading(s, truck, order, dock, bad); continue; }
    }
    if (truck.loadingState === "DOCKING") {
      if (s.robots.some(other => other.type === "AMR" && Math.abs(other.x - dock.x) < 6 && other.z > 8 && other.z < 30)) { order.loading.blockedReason = "Esperando que los AMR despejen el área del muelle antes del acoplamiento."; continue; }
      if (moveLoadingDevice(s, truck, seconds, 1.8)) { truck.heading = 0; setLoadingPhase(s, truck, "OPENING"); event(s, "TRUCK_DOCKED", `${truck.name}: acoplado y muelle reservado.`, { orderId: order.id, truckId: truck.id, dockId: dock.id }); }
    } else if (truck.loadingState === "REDOCKING_HOLD") {
      order.loading.blockedReason = "El camión vuelve a inmovilizarse en el muelle por un cambio de calidad de la carga.";
      if (moveLoadingDevice(s, truck, seconds, 1.8)) setLoadingPhase(s, truck, "QUALITY_HOLD");
    } else if (["OPENING", "OPENING_REJECTION"].includes(truck.loadingState)) {
      truck.doorProgress = Math.min(1, (truck.loading.openingFrom || 0) + truck.loading.phaseElapsed / 4);
      if (truck.doorProgress === 1) { setLoadingPhase(s, truck, truck.loading.rejecting ? "UNLOADING_REJECTION" : "LOADING"); robot.loadingPhase = "READY"; }
    } else if (["LOADING", "UNLOADING_REJECTION"].includes(truck.loadingState)) {
      const mission = robot.missionId ? find(s.missions, robot.missionId, "Misión de carga") : null;
      if (!mission) {
        const queued = s.missions.find(mission => mission.kind === (truck.loading.rejecting ? "TRUCK_UNLOAD" : "TRUCK_LOAD") && mission.orderId === order.id && mission.state === "QUEUED");
        if (queued) beginForkliftLoad(s, truck, robot, queued, dock);
        else { setLoadingPhase(s, truck, truck.loading.rejecting ? "CLOSING" : "VERIFYING"); robot.loadingPhase = "VERIFYING"; }
        continue;
      }
      const hu = find(s.hus, mission.huId, "Carga de expedición"), slot = find(truck.loadPositions, mission.truckSlotId, "Plaza de remolque"), unloading = mission.kind === "TRUCK_UNLOAD";
      if (mission.phase === "TO_SOURCE") {
        if (moveLoadingDevice(s, robot, seconds)) {
          mission.phase = "PICKING"; mission.timer = 0; robot.state = "LOADING"; robot.loadingPhase = "PICKING"; hu.locationId = robot.id; hu.state = "LOADING"; robot.carryingHuId = hu.id;
          if (unloading) { slot.huId = null; slot.reservedHuId = hu.id; delete hu.truckSlotId; }
        }
      } else if (mission.phase === "PICKING") {
        mission.timer += seconds; robot.liftHeight = (unloading ? 0 : 0.18) + Math.min(1, mission.timer / 2) * (unloading ? 0.3 : 0.12);
        if (mission.timer >= 2) {
          robot.state = "MOVING"; robot.loadingPhase = unloading ? "TO_STAGING" : "TO_TRUCK"; mission.phase = robot.loadingPhase;
          if (unloading) forkliftToStaging(robot, stagingPoint(s, hu), dock); else forkliftToTrailer(robot, stagingPoint(s, hu), slot, dock, truck);
          mission.route = clone(robot.route);
          event(s, "DOCK_LOAD_PICKED", `${robot.name}: recogió ${hu.id} de su plaza de expedición.`, { huId: hu.id, missionId: mission.id, robotId: robot.id, orderId: order.id, truckId: truck.id });
        }
      } else if (["TO_TRUCK", "TO_STAGING"].includes(mission.phase)) {
        if (moveLoadingDevice(s, robot, seconds)) { mission.phase = "DEPOSITING"; mission.timer = 0; robot.loadingPhase = "DEPOSITING"; robot.state = "UNLOADING"; }
      } else if (mission.phase === "DEPOSITING") {
        mission.timer += seconds; robot.liftHeight = 0.3 - Math.min(1, mission.timer / 2) * (unloading ? 0.12 : 0.3);
        if (mission.timer >= 2) {
          const allocation = order.allocations.find(a => a.huId === hu.id); if (!allocation) fail("Reserva de salida no encontrada.", 500);
          if (unloading) {
            hu.locationId = dock.id; hu.state = "WAITING_QUARANTINE"; allocation.state = "QUALITY_HOLD";
            slot.huId = null; slot.reservedHuId = null; delete hu.truckSlotId; delete hu.reservedTruckSlotId;
            newMission(s, { kind: "RETURN_TO_QUARANTINE", huId: hu.id, cases: hu.cases, sourceId: dock.id, destinationId: quarantineId(skuFor(s, hu.skuId)), deviceType: "AMR", zoneId: skuFor(s, hu.skuId).zoneId, referenceOrderId: order.id, priority: "HIGH" });
          } else { hu.locationId = truck.id; hu.state = "ON_TRUCK"; hu.truckSlotId = slot.id; slot.huId = hu.id; slot.reservedHuId = null; allocation.state = "ON_TRUCK"; }
          robot.carryingHuId = null; robot.state = "RETURNING"; robot.loadingPhase = "RETURNING"; mission.phase = "RETURNING";
          order.loading.loadedLoads = truck.loadPositions.filter(slot => slot.huId).length;
          if (unloading) {
            const source = stagingPoint(s, hu);
            routeLoadingDevice(robot, [{ x: source.x, y: 0, z: source.z + 2.6, heading: Math.PI }, { x: dock.x - 6, y: 0, z: source.z + 2.6, heading: -Math.PI / 2 }, dock.forkliftHome]);
          } else returnForkliftHome(robot, dock);
          mission.route = clone(robot.route);
          event(s, unloading ? "TRAILER_LOAD_REMOVED" : "TRAILER_LOAD_PLACED", unloading ? `${hu.id}: descargada en su plaza de expedición, pendiente de traslado a cuarentena.` : `${hu.id}: depositada en ${truck.id}/${slot.id}; todavía no ha salido del centro.`, { huId: hu.id, missionId: mission.id, truckId: truck.id, orderId: order.id });
        }
      } else if (mission.phase === "RETURNING") {
        if (moveLoadingDevice(s, robot, seconds)) {
          mission.state = "COMPLETED"; mission.phase = "COMPLETE"; mission.completedAt = s.clock.now; mission.progress = 1;
          robot.state = "IDLE"; robot.missionId = null; robot.route = []; robot.loadingPhase = "READY"; robot.liftHeight = 0.18; truck.loading.currentMissionId = null;
        }
      }
      if (mission.state !== "COMPLETED") mission.progress = ({ TO_SOURCE: 0.1, PICKING: 0.25, TO_TRUCK: 0.45, TO_STAGING: 0.45, DEPOSITING: 0.75, RETURNING: 0.9 })[mission.phase] || 0;
      robot.battery = Math.max(0, robot.battery - seconds * 0.005);
    } else if (truck.loadingState === "VERIFYING" || truck.loadingState === "QUALITY_HOLD") {
      const loads = order.allocations.map(a => find(s.hus, a.huId, "Carga verificada"));
      const bad = loads.find(hu => !isFresh(s, hu));
      if (bad) { holdPhysicalLoading(s, truck, order, dock, bad); continue; }
      if (truck.loading.phaseElapsed >= 3) {
        if (loads.some(hu => hu.locationId !== truck.id || hu.state !== "ON_TRUCK" || !truck.loadPositions.some(slot => slot.huId === hu.id && slot.id === hu.truckSlotId)) || loads.length !== order.loading.loadedLoads) fail("Verificación de carga incompleta: salida protegida.", 500);
        setLoadingPhase(s, truck, "CLOSING"); event(s, "TRAILER_LOAD_VERIFIED", `${order.id}: todas las cargas físicas verificadas; cierre del acceso.`, { orderId: order.id, truckId: truck.id });
      }
    } else if (truck.loadingState === "CLOSING") {
      truck.doorProgress = Math.max(0, 1 - truck.loading.phaseElapsed / 4);
      if (truck.doorProgress === 0) { setLoadingPhase(s, truck, "UNDOCKING"); routeLoadingDevice(truck, [{ x: dock.x, y: 0, z: 54, heading: 0 }]); }
    } else if (truck.loadingState === "UNDOCKING") {
      if (moveLoadingDevice(s, truck, seconds, 1.8)) {
        if (truck.loading.rejecting) {
          order.state = "CANCELLED_AFTER_PREPARATION"; order.cancelledAt = s.clock.now; order.loading.phase = "REJECTED"; order.loading.completedAt = s.clock.now;
          for (const a of order.allocations) { const hu = find(s.hus, a.huId, "Carga retenida"); delete hu.loadingOrderId; delete hu.loadingOriginDockId; delete hu.reservedTruckSlotId; }
          truck.state = "RETURNING"; truck.loadingState = "REJECTED"; truck.progress = 0; truck.trip = truckTrip(s, truck, truck.parkPose, 20, truck);
          delete s.dockReservations[dock.id]; truck.dockId = null; truck.loading = null; truck.route = []; robot.orderId = null; robot.loadingPhase = "IDLE";
          event(s, "ORDER_QUALITY_HOLD", `${order.id}: carga descargada; camión vacío liberado y traslados a cuarentena habilitados.`, { orderId: order.id, truckId: truck.id }); continue;
        }
        const branch = find(s.catalog.branches, order.branchId, "Tienda");
        truck.state = "OUTBOUND"; truck.loadingState = "COMPLETED"; truck.progress = 0; truck.trip = truckTrip(s, truck, branchStop(branch), branch.travelSeconds, truck);
        order.state = "DISPATCHED"; order.dispatchedAt = s.clock.now; order.loading.phase = "COMPLETED"; order.loading.completedAt = s.clock.now;
        for (const a of order.allocations) { const hu = find(s.hus, a.huId, "Carga en remolque"); hu.state = "IN_TRANSIT"; a.state = "IN_TRANSIT"; delete hu.loadingOrderId; delete hu.loadingOriginDockId; delete hu.stagingSlotId; delete hu.reservedTruckSlotId; }
        delete s.dockReservations[dock.id]; truck.dockId = null; truck.loading = null; truck.route = []; robot.orderId = null; robot.loadingPhase = "IDLE";
        event(s, "ORDER_DISPATCHED", `${order.id}: vehículo desacoplado; cargas verificadas en tránsito hacia la tienda.`, { orderId: order.id, truckId: truck.id });
      }
    }
  }
  for (const robot of s.robots.filter(robot => robot.type === "FORKLIFT" && robot.state === "IDLE" && !robot.orderId)) robot.battery = Math.min(100, robot.battery + seconds * 0.05);
}
function autonomyContext() {
  return { id, event,
    canReceive(s, job, slots = 1) {
      const reserved = s.autonomy.notices.reduce((total, notice) => total + notice.loads.filter(load =>
        load.bufferReservation && !load.bufferReservation.releasedAt && load.bufferReservation.jobId !== job?.id).length, 0);
      return buffered(s, "RECEIVE") + reservedReturns(s, "RECEIVE") + inboundBuffers(s, "RECEIVE") + reserved + slots <= BUFFER_CAPACITY.RECEIVE;
    },
    canReceiveQuality(s,load) {
      const target=quarantineId(skuFor(s,load.skuId));
      return buffered(s,target)+reservedReturns(s,target)+s.missions.filter(m=>!CLOSED.has(m.state)&&m.destinationId===target).length < BUFFER_CAPACITY[target];
    },
    receivePurchase(s, purchase, notice, load, reading, job) {
      const quarantineCases = load.qualityHeld ? damagedCaseCount(load) : 0;
      const acceptedCases = load.cases - quarantineCases;
      const split = acceptedCases > 0 && quarantineCases > 0;
      const destinationId = quarantineId(skuFor(s, load.skuId));
      if (quarantineCases) checkIncomingBuffers(s, { [destinationId]: 1 });
      // Only the autonomous adapter can admit good cartons from a visibly damaged pallet.
      const recorded = inspectPurchase(s, {
        id: purchase.id, expectedPurchaseRevision: purchase.revision, mode: "SIMULATED",
        documentNumber: notice.documentNumber, checkpoint: "RECEIVE",
        notes: `Proceso ${job.id}; evidencias ${job.evidenceIds.join(", ")}`.slice(0, 1000),
        lines: [{
          lineId: load.lineId, acceptedCases, quarantineCases, barcode: load.barcode,
          lot: load.lot, expiry: load.expiry, packaging: reading.payload.packaging, label: reading.payload.label,
          qualityDecision: split ? "PARTIAL_HOLD" : quarantineCases ? "HOLD" : "ACCEPT",
          reason: quarantineCases ? `Inspección visual: ${defectLabel(load.packagingDefect)}` : undefined,
          temperatureC: reading.payload.temperatureC,
        }],
      }, { id: "AUTONOMY-ORCHESTRATOR" }, { id, event, dateLimit, verifiedDamageSplit: split });
      const inspection = s.inspections.find(row => row.id === recorded.inspectionId);
      inspection.autonomyJobId = job.id;
      inspection.evidenceIds = [...job.evidenceIds];
      inspection.source = "SIMULATED_DEVICE";
      const result = receivePurchase(s, purchase, inspection, null, "AUTONOMY-ORCHESTRATOR");
      if (quarantineCases) {
        for (const hu of s.hus.filter(row => row.receiptId === result.receiptId && row.state === "QUARANTINE")) {
          hu.locationId = "RECEIVE";
          hu.state = "WAITING_QUARANTINE";
          hu.packagingDefect = load.packagingDefect;
          newMission(s, { kind: "RETURN_TO_QUARANTINE", huId: hu.id, cases: hu.cases, sourceId: "RECEIVE", destinationId,
            deviceType: "AMR", zoneId: skuFor(s, hu.skuId).zoneId, priority: "HIGH" });
        }
        event(s, "PACKAGING_REJECTED", `${purchase.id}: ${quarantineCases} cajas a cuarentena · ${defectLabel(load.packagingDefect)}.`,
          { purchaseId: purchase.id, defect: load.packagingDefect, cases: quarantineCases });
      }
      const receipt = s.receipts.find(row => row.id === result.receiptId);
      receipt.autonomyJobId = job.id;
      receipt.evidenceIds = [...job.evidenceIds];
      receipt.source = "SIMULATED_DEVICE";
      return result;
    },
    dispatchReadiness(s, order) { return orderReadModels(s, { id: "AUTONOMY-ORCHESTRATOR", role: "operations" }).find(row => row.orderId === order.id || row.id === order.id)?.dispatch?.blockedReason || null; },
    dispatch: (s, order) => startPhysicalDispatch(s, order, {}),
    receiveStore: (s, order) => receiveStoreOrder(s, order, {}, "AUTONOMY-ORCHESTRATOR"),
  };
}
function tick(s, seconds, onTick, realtimeClock = false) {
  s.clock.elapsed += seconds;
  if (realtimeClock) s.clock.timeBasis = "WALL_CLOCK";
  else delete s.clock.timeBasis;
  s.clock.now = realtimeClock
    ? new Date().toISOString()
    : new Date(Date.parse(START) + s.clock.elapsed * 1000).toISOString();
  tickMaintenance(s, seconds, { event });
  tickDeviceSettings(s, { event, safeToService });
  tickExpiry(s,{id,event,newMission,quarantineId,cancelOrder,buffered,reservedReturns,inboundBuffers,capacity:BUFFER_CAPACITY,
    rejectPrepared:(state,order)=>commandOn(state,"order.rejectPrepared",{id:order.id,reason:"Retiro automático por vencimiento de un lote preparado"},{id:"AUTOMATION",role:"operations"})});
  for (const p of s.purchases) if (p.state === "ORDERED" && p.expectedAt <= s.clock.elapsed) arrival(s, p);
  for (const hu of s.hus.filter((h) => h.state === "WAITING_SPACE" && !expired(s,h))) putaway(s, hu);
  // One physical consolidation station works one load at a time (closed cases, not each-item picking).
  const packingOwner = s.autonomyDevices.find(device => device.id === "CASE-PICKER-1")?.carryingHuId;
  const packing = s.hus.filter((h) => h.state === "PACKING").sort((a, b) => Number(b.id === packingOwner) - Number(a.id === packingOwner) || a.packReadyAt - b.packReadyAt);
  const huPacked = packing[0];
  const packingJob = huPacked && s.autonomy.jobs.find(job => job.kind === "ORDER" && job.documentId === huPacked.packContext?.orderId && !["COMPLETED", "CANCELLED"].includes(job.state));
  const packingDevice = s.autonomyDevices.find(device => device.id === "CASE-PICKER-1");
  let packingAllowed = true;
  if (huPacked && packingJob) {
    if (packingJob.state === "EXCEPTION") packingAllowed = false;
    else if (packingDevice?.carryingHuId && packingDevice.carryingHuId !== huPacked.id) packingAllowed = false;
    else {
      const readiness = automaticEquipmentStatus(s, "ASSET-CASE-PICKER-1", { processId: packingJob.id });
      if (!readiness.ready) { huPacked.packingBlockedReason = readiness.reason; packingAllowed = false; }
      else {
        delete huPacked.packingBlockedReason;
        if (!huPacked.casePickingStartedAt) {
          const cell = s.catalog.assets.find(asset => asset.id === "ASSET-CASE-PICKER-1");
          huPacked.casePickingStartedAt = s.clock.now;
          huPacked.casePickingStartedElapsed = s.clock.elapsed;
          // Each reserved closed case receives one mechanical pick-and-label
          // cycle. Freeze the total when custody starts; configuration changes
          // and deployment never retime a movement already in progress.
          huPacked.casePickingDuration = cell.settings.caseCycleSeconds * huPacked.packContext.cases;
          huPacked.packReadyAt = s.clock.elapsed + huPacked.casePickingDuration;
          event(s, "AUTONOMY_CASE_PICKING_STARTED", `${huPacked.id}: selección y etiquetado de cajas cerradas iniciados en célula protegida.`, { jobId: packingJob.id, orderId: packingJob.documentId, assetId: cell.id, actorId: "AUTONOMY-ORCHESTRATOR" });
        }
        Object.assign(packingDevice, { state: "RESERVED", processId: packingJob.id, reservationId: packingJob.id, carryingHuId: huPacked.id });
      }
    }
  }
  if (huPacked?.casePickingStartedAt) {
    // Safety holds preserve the remaining cell cycle. Wall-clock time while a
    // fault is unresolved must not finish a picking movement in the background.
    huPacked.casePickingStartedElapsed ??= s.clock.elapsed - Math.max(0, (Date.parse(s.clock.now) - Date.parse(huPacked.casePickingStartedAt)) / 1000);
    huPacked.casePickingDuration ??= Math.max(0, huPacked.packReadyAt - huPacked.casePickingStartedElapsed);
    if (!packingAllowed) huPacked.casePickingHeldAt ??= s.clock.elapsed;
    else if (huPacked.casePickingHeldAt != null) {
      const heldFor = Math.max(0, s.clock.elapsed - huPacked.casePickingHeldAt);
      huPacked.packReadyAt += heldFor;
      if (huPacked.casePickingStartedElapsed != null) huPacked.casePickingStartedElapsed += heldFor;
      delete huPacked.casePickingHeldAt;
    }
  }
  if (huPacked && packingAllowed && huPacked.packReadyAt <= s.clock.elapsed) {
    const context = huPacked.packContext; const order = find(s.orders, context.orderId, "Pedido");
    if (context.cases > huPacked.cases || context.cases > huPacked.reservedCases) fail("La estación no puede separar más de lo reservado.", 500);
    huPacked.cases -= context.cases; huPacked.reservedCases -= context.cases;
    const outbound = { id: context.shipmentHuId, skuId: huPacked.skuId, lot: huPacked.lot, expiry: huPacked.expiry, cases: context.cases, reservedCases: 0,
      orderId: order.id, parentId: huPacked.id, purchaseId: huPacked.purchaseId, locationId: "PACK", state: "WAITING_STAGING", createdAt: s.clock.now };
    if (packingJob) outbound.traceLabel = { code: outbound.id, source: "SIMULATED_LABEL_APPLICATOR", deviceId: packingDevice.id, appliedAt: s.clock.now, jobId: packingJob.id };
    s.hus.push(outbound); delete huPacked.packReadyAt; delete huPacked.packContext; delete huPacked.casePickingStartedAt; delete huPacked.packingBlockedReason;
    delete huPacked.casePickingStartedElapsed; delete huPacked.casePickingDuration; delete huPacked.casePickingHeldAt;
    if (packingJob) Object.assign(packingDevice, { state: "IDLE", processId: null, reservationId: null, carryingHuId: null });
    if (huPacked.cases) {
      const target = posFor(s, context.originLocationId); huPacked.state = "WAITING_PUTAWAY";
      newMission(s, { kind: "PUTAWAY", huId: huPacked.id, cases: huPacked.cases, sourceId: "PACK", destinationId: target.stackerId ? target.handoffId : target.id,
        finalLocationId: target.id, deviceType: "AMR", zoneId: target.zoneId, referenceOrderId: order.id });
    } else { huPacked.state = "EMPTY"; if (s.locationStatus[context.originLocationId]?.reservedFor === huPacked.id) delete s.locationStatus[context.originLocationId].reservedFor; }
    const dock = order.dockId || (s.orders.filter((o) => o.dockId === "DOCK-1" && ["PREPARING", "READY"].includes(o.state)).length <= s.orders.filter((o) => o.dockId === "DOCK-2" && ["PREPARING", "READY"].includes(o.state)).length ? "DOCK-1" : "DOCK-2"); order.dockId = dock;
    newMission(s, { kind: "TO_STAGING", huId: outbound.id, cases: outbound.cases, sourceId: "PACK", destinationId: dock, deviceType: "AMR", orderId: order.id, allocationId: context.allocationId, priority: order.priority });
    event(s, "CASES_SEPARATED", `${outbound.id}: ${outbound.cases} cajas cerradas separadas en estación; ${huPacked.cases} regresan a reserva.`, { orderId: order.id, huId: outbound.id });
    if (packing[1]) packing[1].packReadyAt = Math.max(packing[1].packReadyAt, s.clock.elapsed + 5);
  }
  for (const robot of [...s.robots].sort((a, b) => priorityOf(s, b.id) - priorityOf(s, a.id))) {
    if (robot.type === "FORKLIFT") continue;
    if (["FAULT", "MAINTENANCE"].includes(robot.state)) continue;
    if (robot.state === "CHARGING") { robot.battery = Math.min(100, robot.battery + seconds * 1.5); if (robot.battery >= (robot.runtimeSettings?.resumeAtPercent || 95)) { delete s.routeLocks[`charger:${robot.chargerId}`]; robot.chargerId = null; robot.state = "IDLE"; } continue; }
    if (robot.state === "TO_CHARGER") { if (move(s, robot, seconds)) { releaseLocks(s, `charge:${robot.id}`); robot.route = []; robot.state = "CHARGING"; } continue; }
    if (robot.state === "PARKING") { if (move(s, robot, seconds)) { releaseLocks(s, `park:${robot.id}`); robot.route = []; robot.state = "IDLE"; } continue; }
    if (!robot.missionId) {
      if (!deviceAvailable(s, robot.id)) {
        const asset = s.catalog.assets.find(asset => asset.deviceId === robot.id);
        // A service request blocks new transport work, while the empty robot
        // still returns under traffic reservations to its off-corridor bay.
        if ((asset?.status === "WAITING_SAFE" || asset?.pendingSettings || (asset?.active && asset?.status === "AVAILABLE" && asset?.settings?.autoAssign === false)) && robot.type === "AMR" && robot.state === "IDLE" && robot.nodeId !== robot.parkingId) {
          const parking = { id: `park:${robot.id}` }; if (setRoute(s, robot, parking, robot.nodeId, robot.parkingId)) robot.state = "PARKING";
        }
        if (asset?.active && asset.status === "AVAILABLE" && !asset.pendingSettings && robot.type === "AMR" && robot.state === "IDLE" && robot.nodeId === robot.parkingId && robot.battery < (robot.runtimeSettings?.chargeBelowPercent || 20)) requestRobotCharge(s, robot);
        continue;
      }
      if (robot.type === "AMR" && robot.battery < (robot.runtimeSettings?.chargeBelowPercent || 20)) {
        requestRobotCharge(s, robot);
        continue;
      }
      const queued = s.missions.filter((m) => m.state === "QUEUED" && m.deviceType === robot.type && (!m.requiredRobotId || m.requiredRobotId === robot.id) && taskAllowed(robot, m.kind))
        .sort((a, b) => (a.sourceId === "PACK" ? 0 : 1) - (b.sourceId === "PACK" ? 0 : 1) || ({ HIGH: 0, NORMAL: 1, LOW: 2 }[a.priority] ?? 1) - ({ HIGH: 0, NORMAL: 1, LOW: 2 }[b.priority] ?? 1) || a.createdAt.localeCompare(b.createdAt));
      for (const m of queued) {
        if ([m.sourceId, m.destinationId].some(id => s.dockReservations[id])) continue;
        if (s.locationStatus[m.sourceId]?.blocked || s.locationStatus[m.destinationId]?.blocked) continue;
        if (!bufferDemand(s, m)) continue;
        if (m.sourceHuId && s.hus.find((h) => h.id === m.sourceHuId)?.state !== "STORED") continue;
        if (!setRoute(s, robot, m, robot.nodeId, m.sourceId, m.destinationId)) continue;
        m.state = "ACTIVE"; m.phase = "TO_SOURCE"; m.robotId = robot.id; m.startedAt = s.clock.now; robot.missionId = m.id; robot.state = "TO_SOURCE"; break;
      }
      if (!robot.missionId && robot.type === "AMR" && robot.nodeId !== robot.parkingId) {
        const parking = { id: `park:${robot.id}` }; if (setRoute(s, robot, parking, robot.nodeId, robot.parkingId)) robot.state = "PARKING";
      }
      continue;
    }
    const m = find(s.missions, robot.missionId, "Misión");
    if (m.phase === "TO_SOURCE") {
      if (move(s, robot, seconds)) {
        m.phase = "LOADING";
        // Reserve enough witnessed time for the physical station distributor:
        // travel, lift outside the AMR footprint, fork extension and withdrawal.
        // A persisted phase already in progress retains its original timer.
        m.transferDuration = stationTransferSeconds(m.sourceId);
        m.timer = m.transferDuration; robot.state = "LOADING";
      }
    } else if (m.phase === "LOADING") {
      m.timer -= seconds;
      if (m.timer <= 0) { load(s, m, robot); m.phase = "WAITING_ROUTE"; robot.state = "WAITING_ROUTE"; }
    } else if (m.phase === "WAITING_ROUTE") {
      if (s.locationStatus[m.destinationId]?.blocked) continue;
      if (setRoute(s, robot, m, m.sourceId, m.destinationId)) { m.phase = "TO_DESTINATION"; robot.state = "MOVING"; }
    } else if (m.phase === "TO_DESTINATION") {
      if (move(s, robot, seconds)) {
        if (m.kind === "TO_STAGING") beginStagingManeuver(s, m, robot);
        else {
          releaseLocks(s, m.id); m.phase = "UNLOADING";
          m.transferDuration = stationTransferSeconds(m.destinationId);
          m.timer = m.transferDuration; robot.state = "UNLOADING";
        }
      }
    } else if (m.phase === "STAGING_APPROACH") {
      if (moveLoadingDevice(s, robot, seconds)) { m.phase = "STAGING_DEPOSIT"; m.timer = 0; robot.state = "STAGING_DEPOSIT"; }
    } else if (m.phase === "STAGING_DEPOSIT") {
      m.timer += seconds; robot.cargoHeight = 0.95 - Math.min(1, m.timer / 2) * 0.77;
      if (m.timer >= 2) {
        const hu = find(s.hus, m.huId, "Carga para expedición"), dock = loadingDock(s, m.destinationId), slot = stagingPoint(s, hu);
        hu.locationId = dock.id; hu.state = "STAGED"; delete hu.stagingReserved; robot.carryingHuId = null; robot.cargoHeight = 0.18;
        m.phase = "STAGING_EXIT"; robot.state = "STAGING_EXIT";
        routeLoadingDevice(robot, [{ x: slot.x, y: 0, z: slot.z + 2.6, heading: Math.PI }, { x: dock.x, y: 0, z: slot.z + 2.6, heading: dock.x > slot.x ? Math.PI / 2 : -Math.PI / 2 }, { x: dock.x, y: 0, z: dock.z, heading: dock.z > slot.z + 2.6 ? 0 : Math.PI }]);
        m.route = clone(robot.route); event(s, "STAGING_LOAD_PLACED", `${hu.id}: depositada en ${slot.id}; el AGV se retira bajo el palé.`, { huId: hu.id, missionId: m.id, robotId: robot.id, orderId: m.orderId });
      }
    } else if (m.phase === "STAGING_EXIT") {
      if (moveLoadingDevice(s, robot, seconds)) { robot.nodeId = m.destinationId; robot.cargoHeight = 0.95; finish(s, m, robot); }
    } else if (m.phase === "UNLOADING") { m.timer -= seconds; if (m.timer <= 0 && (!BUFFER_CAPACITY[m.destinationId] || buffered(s, m.destinationId) < BUFFER_CAPACITY[m.destinationId])) finish(s, m, robot); }
    if (m.phase.startsWith("STAGING_") && robot.battery !== null) robot.battery = Math.max(0, robot.battery - seconds * 0.01);
    m.progress = robot.route.length > 1 ? Math.min(0.99, robot.routeIndex / robot.route.length) : 0;
  }
  tickPhysicalLoading(s, seconds);
  for (const ret of s.returns.filter((r) => r.state === "WAITING_PICKUP")) {
    const truck = s.trucks.filter(t => t.state === "AVAILABLE" && deviceAvailable(s, t.id) && taskAllowed(t, "RETURN_PICKUP") && t.capacityCases >= ret.cases).sort((a, b) => priorityOf(s, b.id) - priorityOf(s, a.id))[0]; if (!truck) break;
    const branch = find(s.catalog.branches, ret.branchId, "Tienda"); ret.truckId = truck.id; ret.state = "PICKUP_EN_ROUTE"; truck.returnId = ret.id;
    truck.state = "RETURN_PICKUP"; truck.branchId = branch.id; truck.progress = 0; truck.trip = truckTrip(s, { x: truck.x, z: truck.z }, branchStop(branch), branch.travelSeconds, truck);
    event(s, "RETURN_PICKUP_STARTED", `${truck.name}: va a recoger ${ret.id}.`, { returnId: ret.id, truckId: truck.id, branchId: ret.branchId });
  }
  for (const truck of s.trucks) if (["OUTBOUND", "RETURNING", "RETURN_PICKUP", "RETURN_CARGO"].includes(truck.state)) {
    moveTruck(s, truck, seconds);
    if (truck.progress >= 1) {
      if (truck.state === "OUTBOUND") { truck.state = "AT_STORE"; const order = find(s.orders, truck.orderId, "Pedido"); order.state = "ARRIVED"; order.arrivedAt = s.clock.now; event(s, "TRUCK_ARRIVED", `${order.id}: camión en tienda; falta confirmar las cajas recibidas.`, { orderId: order.id, truckId: truck.id }); }
      else if (truck.state === "RETURN_PICKUP") {
        const ret = find(s.returns, truck.returnId, "Devolución"); ret.state = "RETURNING"; truck.state = "RETURN_CARGO"; truck.branchId = null; truck.progress = 0;
        truck.trip = truckTrip(s, { x: truck.x, z: truck.z }, truck.parkPose, find(s.catalog.branches, ret.branchId, "Tienda").travelSeconds, truck);
        event(s, "RETURN_COLLECTED", `${ret.id}: ${ret.cases} cajas recogidas para cuarentena.`, { returnId: ret.id, truckId: truck.id, branchId: ret.branchId });
      } else {
        if (truck.state === "RETURN_CARGO") {
          const ret = find(s.returns, truck.returnId, "Devolución");
          for (const load of ret.loads) s.hus.push({ id: id(s, "HU"), skuId: ret.skuId, lot: load.lot, expiry: load.expiry, cases: load.cases, reservedCases: 0, state: "QUARANTINE", locationId: quarantineId(skuFor(s, ret.skuId)), returnId: ret.id, orderId: null, createdAt: s.clock.now });
          ret.state = "QUARANTINED"; event(s, "RETURN_ARRIVED", `${ret.id}: cajas en cuarentena, no disponibles hasta revisión.`, { returnId: ret.id, branchId: ret.branchId });
        }
        truck.state = "AVAILABLE"; truck.orderId = null; truck.returnId = null; truck.branchId = null; truck.trip = null; truck.progress = 0; truck.loadingState = null; truck.doorProgress = 0; truck.heading = truck.parkPose.heading; truck.loadPositions = emptyLoadPositions();
      }
    }
  }
  tickAutonomy(s, seconds, autonomyContext());
  onTick?.(s);
}
function assertState(s) {
  for (const hu of s.hus) if (!Number.isInteger(hu.cases) || hu.cases < 0 || !Number.isInteger(hu.reservedCases) || hu.reservedCases < 0 || hu.reservedCases > hu.cases) fail(`Inventario inconsistente en ${hu.id}.`, 500);
  const occupied = new Set(); for (const hu of s.hus) if (hu.cases && posFor(s, hu.locationId)) { if (occupied.has(hu.locationId)) fail(`Dos cargas ocupan ${hu.locationId}.`, 500); occupied.add(hu.locationId); }
  for (const stock of s.storeStock) if (!Number.isInteger(stock.cases) || stock.cases < 0) fail("Inventario de tienda inconsistente.", 500);
  const physical = s.hus.reduce((a, hu) => a + hu.cases, 0) + s.storeStock.reduce((a, r) => a + r.cases, 0) + s.returns.filter((r) => r.state !== "QUARANTINED").reduce((a, r) => a + r.cases, 0);
  if (physical !== s.ledger.initialCases + s.ledger.receivedCases - s.ledger.consumedCases - s.ledger.writtenOffCases - (s.ledger.supplierReturnedCases || 0)) fail("Balance físico inconsistente: operación anulada para evitar pérdida o duplicación.", 500);
  const staged = new Set(), carried = new Set(), loaded = new Set();
  for (const robot of s.robots.filter(robot => robot.carryingHuId)) {
    if (carried.has(robot.carryingHuId)) fail("Dos equipos llevan la misma unidad de carga.", 500); carried.add(robot.carryingHuId);
    const hu = find(s.hus, robot.carryingHuId, "Carga transportada"); if (!hu.cases || hu.locationId !== robot.id) fail("La carga física no coincide con su portador.", 500);
  }
  for (const hu of s.hus.filter(hu => hu.cases && /^DOCK-[12]$/.test(hu.locationId))) { if (!stagingPoint(s, hu) || staged.has(hu.stagingSlotId)) fail("Dos cargas comparten una plaza de expedición o su posición no existe.", 500); staged.add(hu.stagingSlotId); }
  for (const truck of s.trucks) for (const slot of truck.loadPositions || []) if (slot.huId) {
    const hu = find(s.hus, slot.huId, "Carga de camión"); if (loaded.has(hu.id) || carried.has(hu.id) || hu.locationId !== truck.id || hu.truckSlotId !== slot.id || !hu.cases) fail("Una carga del remolque está duplicada o no coincide con su plaza.", 500); loaded.add(hu.id);
  }
  for (const [dockId, reservation] of Object.entries(s.dockReservations)) {
    const truck = find(s.trucks, reservation.truckId, "Camión reservado"); if (truck.dockId !== dockId || truck.orderId !== reservation.orderId || !truck.loading) fail("Reserva de muelle inconsistente.", 500);
  }
}
function incidentsOf(s) {
  const incidents = [];
  for (const hu of s.hus.filter((h) => h.cases > 0)) {
    if (hu.state === "DISCREPANCY") incidents.push({ id: `DIFFERENCE:${hu.id}`, type: "DELIVERY_DIFFERENCE", severity: "HIGH", huId: hu.id, orderId: hu.orderId, cases: hu.cases, message: "Cajas no confirmadas en recepción. No están disponibles en tienda; documenta su baja tras investigar.", resolutions: ["WRITE_OFF"] });
    else if (hu.expiry && !isFresh(s, hu)) incidents.push({ id: `EXPIRY:${hu.id}`, type: "SHELF_LIFE", severity: "HIGH", huId: hu.id, orderId: hu.orderId, cases: hu.cases, message: hu.state === "STAGED" ? "La carga preparada ya no cumple vida útil. Retén el pedido para moverla a cuarentena." : "Vida útil vencida o insuficiente. No se permite nueva reserva, liberación de calidad ni despacho.", resolutions: hu.packagingDefect && hu.purchaseId ? ["SUPPLIER_CLAIM"] : hu.state === "QUARANTINE" && !hu.reservedCases ? ["WRITE_OFF"] : hu.state === "STAGED" ? ["REJECT_PREPARED"] : [] });
    else if (hu.state === "WAITING_SPACE") incidents.push({ id: `SPACE:${hu.id}`, type: "NO_COMPATIBLE_SPACE", severity: "MEDIUM", huId: hu.id, cases: hu.cases, message: "Sin plaza compatible libre. La carga permanece trazada y se reintenta cuando haya espacio.", resolutions: [] });
    else if (hu.state === "QUARANTINE") incidents.push({ id: `HOLD:${hu.id}`, type: "QUALITY_HOLD", severity: "MEDIUM", huId: hu.id, orderId: hu.orderId, cases: hu.cases, message: "Mercancía retenida: revisa el lote antes de liberar o documentar su baja.", resolutions: hu.packagingDefect && hu.purchaseId ? ["SUPPLIER_CLAIM"] : hu.packagingDefect ? ["WRITE_OFF"] : ["RELEASE_QUARANTINE", "WRITE_OFF"] });
  }
  for (const robot of s.robots.filter((r) => r.state === "FAULT")) incidents.push({ id: `EQUIPMENT:${robot.id}`, type: "EQUIPMENT_FAULT", severity: "HIGH", robotId: robot.id, message: robot.faultReason || "Equipo detenido; conserva carga y misión hasta inspección.", resolutions: ["RECOVER_EQUIPMENT"] });
  for (const mission of s.missions.filter((m) => m.state === "ACTIVE" && m.phase === "UNLOADING" && BUFFER_CAPACITY[m.destinationId] && buffered(s, m.destinationId) >= BUFFER_CAPACITY[m.destinationId])) incidents.push({ id: `BUFFER:${mission.id}`, type: "BUFFER_FULL", severity: "MEDIUM", missionId: mission.id, robotId: mission.robotId, message: `${mission.destinationId}: buffer lleno. El equipo conserva su carga; libera retenciones o despacha pedidos antes de descargar.`, resolutions: [] });
  return incidents;
}
function inventorySummary(s) {
  const openOrders = new Set(s.orders.filter(isOpenOrder).map(order => order.id));
  const limit = addLimaDays(s.clock.now, 7);
  const products = s.catalog.skus.filter(sku => !sku.deletedAt).map(sku => {
    const loads = s.hus.filter(hu => hu.skuId === sku.id && hu.cases > 0);
    const warehouse = loads.filter(hu => !["IN_TRANSIT", "DELIVERED", "DISCREPANCY"].includes(hu.state));
    const sum = list => list.reduce((total, row) => total + row.cases, 0);
    const availableCases = available(s, sku.id), reorderPoint = sku.reorderPoint ?? 12;
    return { skuId: sku.id, warehouseCases: sum(warehouse), availableCases,
      reservedCases: warehouse.reduce((total, hu) => total + (hu.orderId && openOrders.has(hu.orderId) ? hu.cases : hu.reservedCases || 0), 0),
      quarantineCases: sum(warehouse.filter(hu => hu.state === "QUARANTINE")),
      retainedCases: sum(warehouse.filter(hu => (hu.state === "QUARANTINE" || hu.packagingDefect && hu.purchaseId) || !isFresh(s, hu) || s.locationStatus[hu.locationId]?.blocked)),
      inTransitCases: sum(loads.filter(hu => hu.state === "IN_TRANSIT")),
      discrepancyCases: sum(loads.filter(hu => hu.state === "DISCREPANCY")),
      returnCases: s.returns.filter(ret => ret.skuId === sku.id && ret.state !== "QUARANTINED").reduce((total, ret) => total + ret.cases, 0),
      branchCases: sum(s.storeStock.filter(row => row.skuId === sku.id)),
      incomingCases: s.purchases.filter(isOpenPurchase).reduce((total, purchase) => total + purchase.lines.filter(line => line.skuId === sku.id).reduce((n, line) => n + line.cases - line.receivedCases, 0), 0),
      expiringCases: sum(warehouse.filter(hu => hu.expiry && hu.expiry <= limit && isFresh(s, hu))),
      nextExpiry: warehouse.map(hu => hu.expiry).filter(Boolean).sort()[0] || null,
      reorderPoint, lowStock: sku.active && availableCases < reorderPoint };
  });
  const totals = Object.fromEntries(["warehouseCases", "availableCases", "reservedCases", "quarantineCases", "retainedCases", "inTransitCases", "discrepancyCases", "returnCases", "branchCases", "incomingCases", "expiringCases"].map(key => [key, products.reduce((total, row) => total + row[key], 0)]));
  totals.activeProducts = s.catalog.skus.filter(sku => sku.active).length; totals.lowStockProducts = products.filter(row => row.lowStock).length;
  const branches = s.catalog.branches.filter(branch => !branch.deletedAt).map(branch => ({ branchId: branch.id, branchCases: s.storeStock.filter(row => row.branchId === branch.id).reduce((n, row) => n + row.cases, 0),
    productCount: new Set(s.storeStock.filter(row => row.branchId === branch.id && row.cases > 0).map(row => row.skuId)).size,
    returnCases: s.returns.filter(ret => ret.branchId === branch.id && ret.state !== "QUARANTINED").reduce((total, ret) => total + ret.cases, 0),
    pendingRequests: s.orders.filter(order => order.branchId === branch.id && order.state === "PENDING").length,
    inTransitCases: s.orders.filter(order => order.branchId === branch.id && ["DISPATCHED", "ARRIVED"].includes(order.state)).reduce((n, order) => n + s.hus.filter(hu => hu.orderId === order.id && hu.state === "IN_TRANSIT").reduce((a, hu) => a + hu.cases, 0), 0),
    awaitingReceipt: s.orders.filter(order => order.branchId === branch.id && order.state === "ARRIVED").length }));
  return { asOf: s.clock.now, unit: "CASES", products, totals, branches };
}
function orderReadModels(s, actor) {
  return s.orders.filter(order => actor.role !== "store" || order.branchId === actor.branchId).map(order => {
    const keys = [
      ["REQUESTED", "Solicitud recibida", order.createdAt],
      ["PREPARING", "Preparación automática", order.releasedAt],
      ["READY", "Cargas preparadas", order.readyAt],
      ["LOADING", "Carga del camión", order.dispatchRequestedAt],
      ["DISPATCHED", "En ruta a la tienda", order.dispatchedAt],
      ["ARRIVED", "Entrega en tienda", order.arrivedAt],
      ["RECEIVED", "Recepción confirmada", order.receivedAt],
    ];
    const last = keys.reduce((index, entry, i) => entry[2] ? i : index, 0), cancelled = order.state.startsWith("CANCELLED");
    const milestones = keys.map(([key, label, at], i) => ({ key, label, at: at || null, state: cancelled && i > last ? "CANCELLED" : at && i < last ? "DONE" : i === last ? (order.receivedAt ? "DONE" : cancelled ? "CANCELLED" : "CURRENT") : "PENDING" }));
    const result = { orderId: order.id, orderRevision: order.revision || 1, milestones, requestedByDate: order.requestedByDate || null, overdue: !!order.requestedByDate && order.requestedByDate < limaDate(s.clock.now) && isOpenOrder(order) };
    if (actor.role === "store") return result;
    const fleet = fleetReadModels(s, actor), loads = order.allocations.map(a => s.hus.find(hu => hu.id === a.huId)).filter(Boolean);
    const compatible = fleet.filter(row => row.available && !truckCompatible(s,s.trucks.find(t => t.id === row.truckId),loads));
    let dispatchReason = order.state !== "READY" ? "Completa la preparación antes de despachar." : null;
    const dock = s.layout.loadingDocks.find(dock => dock.id === order.dockId), forklift = dock && s.robots.find(r => r.id === dock.forkliftId);
    if (!dispatchReason && loads.some(hu => !isFresh(s,hu))) dispatchReason = "Una carga no cumple la vida útil: retén la preparación y revisa el lote.";
    if (!dispatchReason && dock && s.dockReservations[dock.id]) dispatchReason = "El muelle está reservado por otra carga.";
    if (!dispatchReason && (!forklift || !deviceAvailable(s,forklift.id) || forklift.state === "FAULT" || forklift.missionId || forklift.carryingHuId || forklift.orderId || forklift.battery < 20 || !taskAllowed(forklift,"TRUCK_LOAD"))) dispatchReason = "El montacargas del muelle no está disponible para cargar.";
    if (!dispatchReason && !compatible.length) dispatchReason = fleet.some(row => row.state === "AT_STORE") ? "Los camiones están en tienda esperando que se confirme la recepción. Después regresan al centro." : "No hay un camión compatible disponible. Revisa su estado y configuración.";
    result.dispatch = { canDispatch: !dispatchReason, blockedReason: dispatchReason, compatibleTruckIds: compatible.map(row => row.truckId), awaitingStoreReceipt: fleet.filter(row => row.state === "AT_STORE").map(row => ({ truckId: row.truckId,orderId: row.orderId,branchId: row.branchId })) };
    let estimatedLoads = 0; const groupLoads = {};
    result.availability = order.lines.map(line => {
      let remaining = line.cases; const fefo = [];
      const sku = skuFor(s, line.skuId);
      for (const hu of s.hus.filter(hu => hu.skuId === line.skuId && hu.state === "STORED" && !s.locationStatus[hu.locationId]?.blocked && isFresh(s, hu)).sort((a, b) => String(a.expiry || "9999").localeCompare(String(b.expiry || "9999")) || a.createdAt.localeCompare(b.createdAt))) {
        const cases = Math.min(remaining, hu.cases - hu.reservedCases); if (cases <= 0) continue;
        fefo.push({ huId: hu.id, lot: hu.lot, expiry: hu.expiry, cases }); remaining -= cases; estimatedLoads++; groupLoads[sku.zoneId] = (groupLoads[sku.zoneId] || 0) + 1; if (!remaining) break;
      }
      return { skuId: line.skuId, requestedCases: line.cases, availableCases: available(s, line.skuId), shortfallCases: Math.max(0, remaining), fefo };
    });
    result.canRelease = order.state === "PENDING" && result.availability.every(line => !line.shortfallCases) && estimatedLoads <= 24 && Object.values(groupLoads).reduce((rows, loads) => rows + Math.ceil(loads / 2), 0) <= 12;
    result.estimatedLoads = estimatedLoads; result.blockedReason = order.state !== "PENDING" ? "La solicitud ya avanzó a otra etapa." : result.availability.some(line => line.shortfallCases) ? "Faltan cajas vigentes y disponibles; solicita suministro al proveedor." : !result.canRelease ? "La expedición supera las plazas o la segregación térmica del vehículo. Divide la solicitud." : null;
    return result;
  });
}
function fleetReadModels(s,actor,manualFixture = false) {
  const names = { AVAILABLE: "Disponible", AT_STORE: "Esperando recepción en tienda", OUTBOUND: "En ruta a tienda", RETURNING: "Regresando al centro", RETURN_PICKUP: "Recogiendo devolución", RETURN_CARGO: "Regresando con devolución", DOCKING: "Acoplándose al muelle", OPENING: "Abriendo remolque", LOADING: "Cargando", VERIFYING: "Verificando carga", QUALITY_HOLD: "Retenido por calidad", CLOSING: "Cerrando remolque", UNDOCKING: "Saliendo del muelle" };
  return s.trucks.filter(t => actor.role !== "store" || s.orders.some(o => o.id === t.orderId && o.branchId === actor.branchId) || s.returns.some(r => r.id === t.returnId && r.branchId === actor.branchId)).map(t => {
    const asset = s.catalog.assets.find(a => a.deviceId === t.id), order = s.orders.find(o => o.id === t.orderId), available = t.state === "AVAILABLE" && deviceAvailable(s,t.id) && taskAllowed(t,"DELIVERY");
    const canConfirmReceipt = manualFixture && actor.role === "store" && actor.branchId === order?.branchId && effectivePermissions(actor.role,actor.permissions).includes("order.receive") && order?.state === "ARRIVED";
    const automatic = s.autonomy.jobs.find(job => job.kind === "ORDER" && job.documentId === order?.id);
    const reason = t.state === "AT_STORE" ? manualFixture ? "La entrega llegó, pero la tienda aún no confirmó las cajas recibidas. El camión conserva la carga y no admite otro viaje." : automatic ? automatic.state === "EXCEPTION" ? automatic.waitingReason : "La estación de tienda ejecuta descarga, identificación y conciliación autónoma antes de liberar el camión." : "Expediente anterior: Operaciones debe autorizar su incorporación al proceso autónomo. No se confirma ni se vacía el vehículo al actualizar el sistema." : ["RETURNING","RETURN_CARGO"].includes(t.state) ? "El camión vuelve al centro. Quedará disponible al terminar el trayecto." : t.state !== "AVAILABLE" ? "El vehículo está ejecutando un viaje o una carga; no puede asignarse a dos operaciones." : !asset?.active ? "El equipo está desactivado." : asset.status !== "AVAILABLE" || asset.pendingSettings ? "El equipo espera mantenimiento o la aplicación segura de su configuración." : !taskAllowed(t,"DELIVERY") || asset.settings?.autoAssign === false ? "La asignación de reparto está deshabilitada en la configuración del equipo." : "Listo para recibir una expedición compatible.";
    return { truckId:t.id,name:t.name,state:t.state,stateLabel:t.state === "AT_STORE" && !manualFixture ? "Recepción autónoma en destino" : names[t.state] || "Operación en curso",orderId:t.orderId || null,branchId:t.branchId || order?.branchId || null,available,reason,nextAction:t.state === "AT_STORE" ? manualFixture ? "CONFIRM_STORE_RECEIPT" : automatic ? automatic.state === "EXCEPTION" ? "REVIEW_AUTONOMY_EXCEPTION" : "WAIT_AUTONOMOUS_RECEIPT" : "AUTHORIZE_AUTONOMY" : t.state === "AVAILABLE" && !available ? "REVIEW_CONFIGURATION" : available ? "DISPATCH_ORDER" : "WAIT_OPERATION",canConfirmReceipt,returnSecondsRemaining:["RETURNING","RETURN_CARGO"].includes(t.state) && t.trip ? Math.max(0,Math.ceil(t.trip.duration-(s.clock.elapsed-t.trip.startedAt))) : null };
  });
}
function snapshotOf(s, actor, { manualFixture = false } = {}) {
  requireActor(actor); const view = clone(s); const storeOnly = actor.role === "store";
  delete view.supplierClaims;
  view.supplierClaims = supplierClaimsReadModel(s, actor);
  view.finance = financeReadModel(s, actor);
  view.capabilities = CAPABILITIES[actor.role]; view.permissions = effectivePermissions(actor.role, actor.permissions); view.incidents = incidentsOf(s); view.meta = { version: 2, scenario: "Centro automatizado · escenario universitario", simulated: true, physicalConnection: false, telemetry: false, timeZone: "America/Lima", revision: s.revision };
  view.inventory = { hus: view.hus, storeStock: view.storeStock, availability: s.catalog.skus.filter(sku => !sku.deletedAt).map((sku) => ({ skuId: sku.id, availableCases: available(s, sku.id) })) };
  view.equipment = { robots: view.robots, trucks: view.trucks };
  view.expiry=view.permissions.some(p=>["inventory.read","inventory.summary.read"].includes(p)) ? expiryReadModel(s,actor) : null;
  delete view.expiryWithdrawals;
  view.catalog.assets = assetReadModel(s); view.deviceSettingSchemas = DEVICE_SETTING_SCHEMAS; view.validationCatalog = VALIDATION_CATALOG; view.orderReadModels = orderReadModels(s, actor);
  view.purchaseReadModels = receiptReadModels(s);
  const inboundJobs = new Map(s.autonomy.jobs.filter(job => job.kind === "PURCHASE" && !CLOSED.has(job.state)).map(job => [job.documentId, job]));
  for (const purchase of view.purchases) {
    purchase.canCancel = view.permissions.includes("purchase.cancel") && canCancelPurchase(s, purchase, inboundJobs.get(purchase.id));
  }
  if (!manualFixture) for (const purchase of view.purchaseReadModels) { purchase.canInspect = false; purchase.autonomous = true; purchase.autonomyJobId = s.purchases.find(row => row.id === purchase.purchaseId)?.autonomyJobId || null; }
  view.fleetReadModels = fleetReadModels(s,actor,manualFixture);
  view.autonomy = autonomyReadModel(s, actor);
  if (!view.permissions.includes("map.view")) delete view.physicalTraffic;
  view.autonomyConfiguration = autonomyConfigurationReadModel(s, actor);
  if (!view.permissions.includes("autonomy.read") && !view.permissions.includes("config.autonomy.manage")) view.autonomyDevices = [];
  if (actor.role === "admin" && view.permissions.includes("inventory.summary.read")) view.inventorySummary = inventorySummary(s);
  view.catalog.skus.forEach((sku) => { sku.availableCases = available(s, sku.id); sku.eligibleSupplierIds = eligibleSupplierIds(s,sku); });
  view.layout.locations.forEach((l) => { const hu = view.hus.find((h) => h.cases && h.locationId === l.id); l.blocked = Boolean(s.locationStatus[l.id]?.blocked); l.reservedFor = s.locationStatus[l.id]?.reservedFor || null; l.huId = hu?.id || null; l.state = l.blocked ? "BLOCKED" : hu ? "OCCUPIED" : l.reservedFor ? "RESERVED" : "FREE"; });
  view.layout.stations.forEach((station) => { if (BUFFER_CAPACITY[station.id]) { station.capacityHus = BUFFER_CAPACITY[station.id]; station.occupiedHus = buffered(s, station.id); station.reservedReturnHus = reservedReturns(s, station.id); } });
  view.metrics = { warehouseCases: s.hus.filter((h) => h.cases && !["IN_TRANSIT", "DELIVERED", "DISCREPANCY"].includes(h.state)).reduce((a, h) => a + h.cases, 0),
    availableCases: s.catalog.skus.reduce((a, sku) => a + available(s, sku.id), 0), activeMissions: s.missions.filter((m) => !CLOSED.has(m.state)).length,
    readyOrders: s.orders.filter((o) => o.state === "READY").length, pendingOrders: s.orders.filter((o) => o.state === "PENDING").length,
    activeRobots: s.robots.filter((r) => !["IDLE", "FAULT", "CHARGING"].includes(r.state)).length,
    faultedRobots: s.robots.filter((r) => r.state === "FAULT").length, freeLocations: view.layout.locations.filter((l) => l.state === "FREE").length,
    inTransitCases: s.hus.filter((h) => h.state === "IN_TRANSIT").reduce((a, h) => a + h.cases, 0),
    storeCases: s.storeStock.filter((r) => !storeOnly || r.branchId === actor.branchId).reduce((a, r) => a + r.cases, 0) };
  if (storeOnly) {
    view.storePolicy = { maxOrderCases: s.configuration.settings.maxOrderCases, maxLines: 12, maxOpenOrders: s.configuration.settings.maxOpenOrdersPerBranch };
    view.autonomyDevices = view.autonomyDevices.filter(row => row.branchId === actor.branchId);
    view.inspections = []; view.receipts = []; view.purchaseReadModels = []; delete view.deviceSettingSchemas;
    view.catalog.assets = []; view.maintenance = []; delete view.catalogSources;
    view.orders = view.orders.filter((o) => o.branchId === actor.branchId); const ownIds = new Set(view.orders.map((o) => o.id));
    view.purchases = []; view.missions = []; view.events = view.events.filter((e) => (e.orderId && ownIds.has(e.orderId)) || e.branchId === actor.branchId); view.returns = view.returns.filter((r) => r.branchId === actor.branchId);
    view.storeStock = view.storeStock.filter((r) => r.branchId === actor.branchId); view.hus = []; view.inventory.hus = [];
    view.inventory.storeStock = view.storeStock; view.catalog.branches = view.catalog.branches.filter((b) => b.id === actor.branchId);
    view.catalog.suppliers = []; view.catalog.skus.forEach((sku) => { delete sku.availableCases; delete sku.eligibleSupplierIds; delete sku.purchaseUnitNetCents; delete sku.purchaseTaxRateBps; delete sku.purchasePriceSource; }); view.inventory.availability = [];
    view.layout.branches = view.layout.branches.filter((b) => b.id === actor.branchId);
    // Physical configuration remains administrator/operations data. A branch
    // receives only its own endpoint, never another store's devices or annex.
    view.layout.automation = view.layout.automation ? { version: view.layout.automation.version,
      stations: view.layout.automation.stations.filter(station => station.branchId === actor.branchId) } : null;
    view.orders.forEach((o) => { o.allocations = []; });
    const ownReturnIds = new Set(view.returns.map((r) => r.id));
    view.equipment = { robots: [], trucks: view.trucks.filter((t) => ownIds.has(t.orderId) || ownReturnIds.has(t.returnId)) }; view.robots = []; view.trucks = view.equipment.trucks;
    view.layout.locations = []; view.locationStatus = {}; view.routeLocks = {}; view.metrics.pendingOrders = view.orders.filter((o) => o.state === "PENDING").length;
    view.metrics.readyOrders = view.orders.filter((o) => o.state === "READY").length;
    view.counters = {}; view.ledger = {}; view.configuration = {}; view.dockReservations = {}; view.layout.loadingDocks = []; view.incidents = view.storeStock.filter((r) => r.cases && r.expiry && r.expiry < limaDate(s.clock.now)).map((r) => ({ id: `STORE_EXPIRY:${r.id}`, type: "STORE_EXPIRY", severity: "HIGH", orderId: r.orderId, skuId: r.skuId, cases: r.cases, message: "Este lote está bloqueado para venta. El retiro automático espera capacidad de cuarentena y una recogida segura.", resolutions: [] }));
    for (const key of ["warehouseCases", "availableCases", "activeMissions", "activeRobots", "faultedRobots", "freeLocations"]) view.metrics[key] = 0;
    view.metrics.inTransitCases = view.orders.filter((o) => ["DISPATCHED", "ARRIVED"].includes(o.state)).reduce((a, o) => a + o.lines.reduce((b, l) => b + l.cases, 0), 0);
  }
  return view;
}
function createSimulation({ filename = ":memory:", seed = true, academicLegacyFixture = false, controlledReceivingFixture = false, realtimeClock = false } = {}) {
  const db = createStore(filename); const persisted = db.read();
  if (!persisted) { const initial = fresh(seed, realtimeClock ? new Date().toISOString() : START);
    if (academicLegacyFixture || controlledReceivingFixture) initial.configuration.settings.packagingDamagePercent = 0;
    db.write(initial); }
  else {
    const migrated = migrate(persisted);
    if (realtimeClock) persisted.clock.now = new Date().toISOString();
    if (migrated || realtimeClock) db.write(persisted);
  }
  if (!db.kardexMetadata()) db.transaction(() => { const state = db.read(), inventory = captureInventory(state); db.initializeKardex({ startedAt:state.clock.now,activatedAt:new Date().toISOString(),kind:"OBSERVED_FROM_ACTIVATION",note:"Los saldos de apertura corresponden al inventario existente al activar el kardex; los movimientos anteriores no se reconstruyen sin evidencia." }); db.appendMovements(openingMovements(state,inventory)); });
  // Presentation history is authoritative but ephemeral. Persist only current
  // logistics state: copying hundreds of poses to SQLite at every clock tick
  // would increase I/O without improving recovery of the actual operation.
  let histories = new Map(), lastKeys = new Map(), routeKeys = new Map();
  function recordFrames(state, nextHistories, nextKeys, nextRoutes) {
    for (const device of [...state.robots, ...state.trucks]) {
      const guide = motionGuide(device), routeKey = JSON.stringify(guide.route);
      const key = `device:${device.id}`, signature = JSON.stringify([device.x, device.y || 0, device.z, device.heading || 0, device.liftHeight, device.cargoHeight, device.doorProgress, device.carryingHuId, device.state, device.loadingPhase, device.loadingState, guide.index, routeKey, device.orderId || null]);
      if (nextKeys.get(key) === signature) continue;
      const frame = { elapsed: state.clock.elapsed, x: device.x, y: device.y || 0, z: device.z, heading: device.heading || 0, state: device.state, carryingHuId: device.carryingHuId || null, orderId:device.orderId || null, routeIndex: guide.index };
      for (const field of ["liftHeight", "cargoHeight", "doorProgress", "loadingPhase", "loadingState"]) if (device[field] !== undefined) frame[field] = device[field];
      const observedRoute = guide.route;
      frame.routeId = createHash("sha1").update(routeKey).digest("hex").slice(0, 12);
      if (nextRoutes.get(key) !== routeKey) { frame.route = clone(observedRoute); nextRoutes.set(key, routeKey); }
      const frames = (nextHistories.get(key) || []).slice(); frames.push(frame);
      while (frames.length > 150 || (frames.length > 2 && frames[1].elapsed < state.clock.elapsed - 20)) {
        const removed = frames.shift();
        if (removed.route && frames[0]?.routeId === removed.routeId && !frames[0].route) frames[0] = { ...frames[0], route: removed.route };
      }
      nextHistories.set(key, frames); nextKeys.set(key, signature);
    }
    const map = autonomyMapFrame(state);
    for (const [kind, records] of [["autonomy-load", map.loads], ["autonomy-device", map.devices], ["autonomy-buffer", map.bufferTransfers]]) for (const record of records) {
      const recordId = kind === "autonomy-device" ? record.deviceId : record.id;
      const key = `${kind}:${recordId}`;
      // Keep bounded witnessed phase history in memory only. This lets a 60 Hz
      // renderer interpolate across sparse HTTP snapshots without inventing
      // successful sensor readings or writing presentation frames to SQLite.
      const signature = JSON.stringify([record.stage, record.phaseElapsed, record.phaseDuration, record.moving, record.blocked, record.visible, record.processId, record.carryingHuId, record.status, record.missionPhase]);
      if (nextKeys.get(key) === signature) continue;
      const frame = { elapsed: state.clock.elapsed };
      for (const field of ["assetId", "stage", "state", "phaseStartedElapsed", "phaseElapsed", "phaseDuration", "phasePath", "from", "to", "position", "progress", "moving", "blocked", "paused", "visible", "status", "carryingHuId", "processId", "loadIds", "truckId", "huIds", "transferPath", "cases", "missionId", "missionPhase", "huId", "robotId", "fromStationId", "toStationId", "fromRobotId", "toRobotId"])
        if (record[field] !== undefined) frame[field] = clone(record[field]);
      const frames = (nextHistories.get(key) || []).slice(); frames.push(frame);
      while (frames.length > 180 || (frames.length > 2 && frames[1].elapsed < state.clock.elapsed - 120)) frames.shift();
      nextHistories.set(key, frames); nextKeys.set(key, signature);
    }
    for (const hu of state.hus) {
      const key = `hu:${hu.id}`, signature = JSON.stringify([hu.locationId, hu.state, hu.truckSlotId, hu.stagingSlotId, hu.cases, hu.packContext || null]);
      if (nextKeys.get(key) === signature) continue;
      const frame = { elapsed: state.clock.elapsed, locationId: hu.locationId, state: hu.state, cases: hu.cases, truckSlotId: hu.truckSlotId || null, stagingSlotId: hu.stagingSlotId || null, packContext: hu.packContext ? clone(hu.packContext) : null };
      const frames = (nextHistories.get(key) || []).slice(); frames.push(frame);
      while (frames.length > 40 || (frames.length > 2 && frames[1].elapsed < state.clock.elapsed - 60)) frames.shift();
      nextHistories.set(key, frames); nextKeys.set(key, signature);
    }
  }
  recordFrames(db.read(), histories, lastKeys, routeKeys);
  return {
    snapshot(actor = { id: "system", role: "admin" }) {
      const view = snapshotOf(db.read(), actor, { manualFixture: academicLegacyFixture || controlledReceivingFixture });
      if (realtimeClock) view.clock.now = new Date().toISOString();
      if (effectivePermissions(actor.role, actor.permissions).includes("map.view")) {
        for (const device of [...view.robots, ...view.trucks]) device.motionHistory = clone(histories.get(`device:${device.id}`) || []);
        for (const hu of view.hus) hu.motionHistory = clone(histories.get(`hu:${hu.id}`) || []);
        if (view.autonomy.map) {
          for (const load of view.autonomy.map.loads) load.motionHistory = clone(histories.get(`autonomy-load:${load.id}`) || []);
          for (const device of view.autonomy.map.devices) device.motionHistory = clone(histories.get(`autonomy-device:${device.deviceId}`) || []);
          for (const transfer of view.autonomy.map.bufferTransfers) transfer.motionHistory = clone(histories.get(`autonomy-buffer:${transfer.id}`) || []);
        }
      }
      return view;
    },
    movements(actor,query={}) { return readMovements(db,actor,query); },
    command(type, payload = {}, actor) {
      requireActor(actor);
      if (typeof type !== "string" || !type || type.length > 80) fail("El nombre de la acción no es válido.");
      assertCommandAllowed(actor, type);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("Los datos de la acción no son válidos.");
      if (payload.commandId !== undefined && (typeof payload.commandId !== "string" || !payload.commandId || payload.commandId.length > 100)) fail("Identificador de operación inválido.");
      return db.transaction(() => {
        const key = payload.commandId ? `${actor.id}:${type}:${String(payload.commandId).slice(0, 100)}` : null;
        const requestHash = key ? fingerprint(type, payload) : null;
        const existing = db.receipt(key); if (existing) {
          if (existing.requestHash && existing.requestHash !== requestHash) fail("Este identificador ya se utilizó para otra acción. No se ha repetido la operación.", 409);
          return existing.result || existing;
        }
        let s = db.read();
        if (realtimeClock) s.clock.now = new Date().toISOString();
        EVENT_CONTEXT.set(s, { actorId: actor.id, actorRole: actor.role, actorName: actor.name || ({ admin: "Administrador", operations: "Jefe de operaciones", store: "Usuario de tienda" }[actor.role]), command: type, correlationId: payload.commandId || null });
        const beforeInventory = captureInventory(s); let result;
        result = commandOn(s, type, payload, actor, { academicLegacyFixture, controlledReceivingFixture });
        const collection = type.startsWith("order.") ? s.orders : type.startsWith("purchase.") ? s.purchases : type.startsWith("return.") ? s.returns : null;
        const document = collection?.find(row => row.id === (result.id || payload.id || payload.orderId));
        if (document) { document.updatedAt = s.clock.now; document.updatedBy = actor.id; if (type.endsWith(".create")) document.createdBy = actor.id; }
        assertState(s);
        db.appendMovements(inventoryChanges(s,beforeInventory,captureInventory(s),{type,actorId:actor.id,actorRole:actor.role,branchId:actor.branchId,documentId:result.id || payload.id || payload.orderId || null,correlationId:payload.commandId || null,reason:payload.reason || payload.note || null,reference:payload.reference || null}));
        s.revision++; db.write(s); const reply = { ok: true, ...result, revision: s.revision }; db.remember(key, { requestHash, result: reply }); return reply;
      });
    },
    advance(seconds = 1) {
      const n = seconds; if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 3600) fail("Avance de simulación inválido.");
      const pendingHistories = new Map(histories), pendingKeys = new Map(lastKeys), pendingRoutes = new Map(routeKeys);
      const result = db.transaction(() => { const s = db.read(); if (s.clock.paused || !n) return { revision: s.revision, advanced: 0 };
        const priorEventNumber = s.counters.EV || 0;
        const movementRecords = [];
        let remaining = n * s.clock.speed; while (remaining > 0) { const step = Math.min(1, remaining), beforeInventory = captureInventory(s); tick(s, step, state => recordFrames(state, pendingHistories, pendingKeys, pendingRoutes), realtimeClock); movementRecords.push(...inventoryChanges(s,beforeInventory,captureInventory(s),{type:"automation"})); remaining -= step; }
        assertState(s); db.appendMovements(movementRecords); s.revision++; db.write(s); return { revision: s.revision, advanced: n * s.clock.speed, auditEvents: s.events.filter(event => (event.type === "DEVICE_SETTINGS_APPLIED" || event.type.startsWith("AUTONOMY_")) && Number(event.id.slice(3)) > priorEventNumber).map(clone) }; });
      histories = pendingHistories; lastKeys = pendingKeys; routeKeys = pendingRoutes;
      return result;
    },
    claimNotificationNext() {
      return db.transaction(()=>{const s=db.read(),claim=s.supplierClaims.find(c=>c.notification.status==='QUEUED');if(!claim)return null;
        Object.assign(claim.notification,{status:'SENDING',attempts:claim.notification.attempts+1,attemptId:cryptoRandomId(),startedAt:new Date().toISOString()});
        claim.revision++;s.revision++;db.write(s);return clone(claim);});
    },
    claimNotificationFinish(claimId,attemptId,status,error=null) {
      return db.transaction(()=>{const s=db.read(),claim=s.supplierClaims.find(c=>c.id===claimId);
        if(!claim||claim.notification.attemptId!==attemptId||claim.notification.status!=='SENDING') return false;
        if(!['SENT','FAILED','SIMULATED','UNKNOWN'].includes(status))fail('Resultado de notificación inválido.');
        Object.assign(claim.notification,{status,error:error?String(error).slice(0,250):null,finishedAt:new Date().toISOString()});
        claim.revision++;claim.updatedAt=s.clock.now;
        claim.history.push({at:s.clock.now,actorId:'SYSTEM',action:'NOTIFICATION_'+status,detail:status==='SENT'?'Servidor de correo aceptó el mensaje al destinatario.':status==='SIMULATED'?'Canal de demostración: no se envió un correo real.':status==='UNKNOWN'?'Verifica la entrega antes de reenviar.':'No se pudo enviar; la reclamación permanece registrada.'});
        event(s,'SUPPLIER_NOTIFICATION_'+status,`${claim.id}: notificación ${status}.`,{claimId:claim.id});s.revision++;db.write(s);return true;});
    },
    close() { db.close(); },
  };
}
module.exports = { createSimulation, CAPABILITIES };
