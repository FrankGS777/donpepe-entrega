"use strict";
const { Fields, problem } = require("./validation");
const { configureDevice, migrateDeviceSettings } = require("./device-settings");
const { AUTONOMY_ASSET_SCHEMAS, automaticEquipmentStatus } = require("./autonomy-config");
const { autonomyAssetMedia } = require("./autonomy-media");
const { limaDate } = require("./time");
const TYPES = ["AMR", "STACKER", "SHUTTLE", "FORKLIFT", "TRUCK", "CHARGER", ...Object.keys(AUTONOMY_ASSET_SCHEMAS)];
const OPEN = new Set(["REQUESTED", "APPROVED", "WAITING_SAFE", "IN_PROGRESS"]);
const CLASSES = ["AMBIENT", "CHILLED", "FROZEN", "MULTI"];
const DEFAULT_CHECKS = {
  AMR: ["Parada de emergencia y enclavamientos", "Escáneres de seguridad y detección", "Ruedas, frenos y plataforma elevadora", "Batería, conectores y prueba sin carga"],
  STACKER: ["Enclavamientos y parada de emergencia", "Mástil, guías y cadenas de elevación", "Sensores de posición y finales de carrera", "Frenos, horquillas y prueba sin carga"],
  SHUTTLE: ["Carril, topes y elementos de retención", "Sensores y parada de emergencia", "Ruedas y mecanismo de transferencia", "Conexión eléctrica y prueba sin carga"],
  FORKLIFT: ["Horquillas, mástil y cadenas", "Frenos, ruedas y dirección", "Sensores y parada de emergencia", "Sistema de elevación y prueba sin carga"],
  TRUCK: ["Frenos, neumáticos e iluminación", "Puertas, cierres y muelle de carga", "Registro de temperatura y compartimentos", "Limpieza, segregación y documentación"],
  CHARGER: ["Aislamiento y protección eléctrica", "Conectores, cables y toma de tierra", "Ventilación y protección térmica", "Interbloqueos y prueba de carga controlada"],
};
for (const [type, schema] of Object.entries(AUTONOMY_ASSET_SCHEMAS)) DEFAULT_CHECKS[type] = ["Enclavamientos, área de transferencia y parada segura", ...schema.requiredInterlocks.map(label => `Prueba funcional documentada: ${label}`), "Calibración de instrumentos y prueba sin carga"];
const deviceFor = (s, asset) => [...s.robots, ...s.trucks, ...s.layout.stations.filter(row => row.type === "CHARGER"), ...(s.autonomyDevices || [])].find(row => row.id === asset.deviceId);
const assetFor = (s, id) => s.catalog.assets.find(asset => asset.id === id);
function safeToService(s, asset) {
  const device = deviceFor(s, asset); if (!device) return !asset.deviceId;
  if (AUTONOMY_ASSET_SCHEMAS[asset.type]) return ["IDLE", "READY", "FAULT", "MAINTENANCE"].includes(device.state) && !device.processId && !device.reservationId && !device.carryingHuId && !device.reservedHuId;
  if (asset.type === "CHARGER") return !s.routeLocks[`charger:${device.id}`] && !s.robots.some(robot => robot.chargerId === device.id);
  if (asset.type === "TRUCK") return device.state === "AVAILABLE" && !device.orderId && !device.returnId && !device.trip && !device.loading && !device.loadPositions?.some(slot => slot.huId || slot.reservedHuId) && !Object.values(s.dockReservations).some(res => res.truckId === device.id);
  if (asset.type === "AMR") {
    const bay = s.layout.nodes.find(node => node.id === device.parkingId);
    if (!bay || device.nodeId !== bay.id || Math.hypot(device.x - bay.x, device.z - bay.z) > 0.02) return false;
  }
  return ["IDLE", "FAULT", "MAINTENANCE"].includes(device.state) && !(device.state === "FAULT" && device.previousState && device.previousState !== "IDLE") && !device.carryingHuId && !device.missionId && !device.orderId && !device.chargerId && !Object.values(s.routeLocks).some(owner => owner === device.id || owner === `park:${device.id}` || owner === `charge:${device.id}`) && !Object.values(s.dockReservations).some(res => res.forkliftId === device.id) && !s.missions.some(m => m.robotId === device.id && m.state === "ACTIVE");
}
function deviceAvailable(s, deviceId) {
  const asset = s.catalog.assets?.find(asset => asset.deviceId === deviceId);
  return !asset || (asset.active && asset.status === "AVAILABLE" && !asset.pendingSettings && asset.settings?.autoAssign !== false);
}
function migrateEquipment(s) {
  let changed = false;
  if (!s.catalog.assets) { s.catalog.assets = []; changed = true; }
  if (!s.maintenance) { s.maintenance = []; changed = true; }
  for (const device of [...s.robots, ...s.trucks, ...s.layout.stations.filter(row => row.type === "CHARGER")]) {
    if (s.catalog.assets.some(asset => asset.deviceId === device.id)) continue;
    const type = device.type || "TRUCK", className = device.zoneId === "COLD" ? "CHILLED" : device.zoneId === "FROZEN" ? "FROZEN" : type === "TRUCK" ? "MULTI" : "AMBIENT";
    s.catalog.assets.push({ id: `ASSET-${device.id}`, code: device.id, name: device.name, type, manufacturer: "Equipo genérico del escenario", model: device.model || (type === "TRUCK" ? "Transporte multitemperatura de 24 plazas" : "Estación de carga automática"), serialNumber: `DP-CD1-${device.id}`, imageUrl: `/images/representations/equipment-${type.toLowerCase()}.webp`, imageKind: "GENERATED_REPRESENTATION", deviceId: device.id, commissionDate: limaDate(s.clock.now), warrantyUntil: "", serviceIntervalHours: type === "TRUCK" ? 500 : 250, serviceHours: 0, lastServiceHours: 0, capacityCases: device.capacityCases || 1, capacityKg: device.capacityKg || (type === "TRUCK" ? 24000 : 1500), temperatureClass: className, active: true, status: "AVAILABLE", notes: "Representación académica. No conectado a un equipo físico ni a telemetría real." });
    changed = true;
  }
  return changed;
}
function assetCommand(s, action, p, context) {
  const existing = action === "create" ? null : assetFor(s, p.id);
  if (!["create", "update", "deactivate", "activate", "delete", "configure"].includes(action)) problem("Acción de equipo desconocida.", 404);
  if (action !== "create" && !existing) problem("El equipo no existe.", 404);
  if (existing?.deletedAt) problem("El equipo fue eliminado y no puede modificarse.", 404);
  if (["deactivate", "activate", "delete"].includes(action)) return require("./catalog-lifecycle").changeCatalogStatus(s, "asset", action, p, { safeToService });
  if (action === "configure") { configureDevice(s, existing, p, context.actor, { ...context, safeToService }); return existing.id; }
  const data = p.data || p, fields = new Fields(), next = { ...existing };
  next.code = fields.code(data.code ?? existing?.code); next.name = fields.string(data.name ?? existing?.name, "name", "Nombre", { min: 2, max: 100, required: true });
  next.type = fields.enum(data.type ?? existing?.type, "type", "Clase de equipo", TYPES);
  next.manufacturer = fields.string(data.manufacturer ?? existing?.manufacturer, "manufacturer", "Fabricante", { min: 2, max: 100, required: true });
  next.model = fields.string(data.model ?? existing?.model, "model", "Modelo", { min: 2, max: 120, required: true });
  next.serialNumber = fields.string(data.serialNumber ?? existing?.serialNumber, "serialNumber", "Número de serie", { min: 3, max: 80, required: true });
  const generatedMedia = autonomyAssetMedia(next.type);
  const imageValue = data.imageUrl === "" || data.imageUrl == null ? existing?.imageUrl || generatedMedia?.imageUrl || (next.type ? `/images/representations/equipment-${next.type.toLowerCase()}.webp` : "") : data.imageUrl;
  next.imageUrl = fields.image(imageValue);
  if (generatedMedia && next.imageUrl === generatedMedia.imageUrl) Object.assign(next, generatedMedia);
  else if (next.imageUrl !== existing?.imageUrl) {
    next.imageKind = "USER_IMAGE";
    next.imageScope = "ASSET_RECORD_MEDIA";
    next.imageProvenance = null;
  }
  next.commissionDate = fields.date(data.commissionDate ?? existing?.commissionDate, "commissionDate", "Fecha de alta", { required: true, min: "2000-01-01", max: "2100-12-31" });
  next.warrantyUntil = fields.date(data.warrantyUntil ?? existing?.warrantyUntil ?? "", "warrantyUntil", "Fin de garantía", { min: next.commissionDate, max: "2100-12-31" });
  next.serviceIntervalHours = fields.number(data.serviceIntervalHours ?? existing?.serviceIntervalHours ?? 250, "serviceIntervalHours", "Intervalo de servicio en horas", { min: 1, max: 10000 });
  next.capacityCases = fields.number(data.capacityCases ?? existing?.capacityCases ?? 24, "capacityCases", "Capacidad de cajas", { min: 1, max: 1000, integer: true });
  next.capacityKg = fields.number(data.capacityKg ?? existing?.capacityKg ?? 1500, "capacityKg", "Capacidad en kg", { min: 1, max: 100000 });
  next.temperatureClass = fields.enum(data.temperatureClass ?? existing?.temperatureClass ?? "AMBIENT", "temperatureClass", "Condición de trabajo", CLASSES);
  next.notes = fields.string(data.notes ?? existing?.notes ?? "", "notes", "Observaciones", { max: 500, multiline: true });
  next.active = fields.boolean(data.active ?? existing?.active ?? true, "active", "Estado");
  if (next.active !== (existing?.active ?? true)) fields.add("active", "Utiliza Activar o Desactivar para cambiar el estado del equipo de forma segura.");
  for (const field of ["code", "name", "serialNumber"]) fields.unique(s.catalog.assets, next[field], field, "un equipo", existing?.id);
  if (!existing && data.deviceId) fields.add("deviceId", "El alta administrativa registra un equipo planificado. Su integración física requiere un modelo y recorrido compatibles.");
  if (existing && data.deviceId !== undefined && data.deviceId !== existing.deviceId) fields.add("deviceId", "La conexión con el equipo físico no puede reasignarse desde el formulario.");
  if (existing?.deviceId) for (const key of ["type", "capacityCases", "capacityKg", "temperatureClass"]) if (next[key] !== existing[key]) fields.add(key, "Este equipo está integrado al circuito. Su capacidad y clase física no se alteran durante la operación.");
  if (data.serviceHours !== undefined && data.serviceHours !== existing?.serviceHours) fields.add("serviceHours", "Las horas de uso se calculan desde el funcionamiento del escenario.");
  fields.assert();
  next.id = existing?.id || context.id(s, "EQUIPO"); next.deviceId = existing?.deviceId || null; next.status = existing?.status || "PLANNED"; next.serviceHours = existing?.serviceHours || 0; next.lastServiceHours = existing?.lastServiceHours || 0; next.updatedAt = s.clock.now;
  if (existing && !existing.active && next.active) next.status = existing.deviceId ? "AVAILABLE" : "PLANNED";
  if (existing) Object.assign(existing, next); else s.catalog.assets.push(next);
  const physical = deviceFor(s, next); if (physical) physical.name = next.name;
  migrateDeviceSettings(s);
  return next.id;
}
function maintenanceCommand(s, action, p, actor, context) {
  const fields = new Fields();
  let record;
  if (action === "request") {
    const asset = assetFor(s, p.assetId);
    if (!asset?.active) problem("Selecciona un equipo activo.", 422, { assetId: "El equipo no está disponible para una solicitud." });
    if (s.maintenance.some(row => row.assetId === asset.id && OPEN.has(row.state))) problem("Este equipo ya tiene una solicitud o servicio abierto. Consulta su seguimiento.", 409, { assetId: "Existe un mantenimiento abierto." });
    const type = fields.enum(p.type ?? "INSPECTION", "type", "Tipo de mantenimiento", ["PREVENTIVE", "CORRECTIVE", "INSPECTION"]);
    const reason = fields.string(p.reason, "reason", "Motivo", { min: 10, max: 500, required: true, multiline: true });
    const notes = fields.string(p.notes ?? "", "notes", "Observaciones", { max: 500, multiline: true });
    const scheduledDate = fields.date(p.scheduledDate ?? "", "scheduledDate", "Fecha prevista", { min: limaDate(s.clock.now), max: "2100-12-31" }); fields.assert();
    record = { id: context.id(s, "MANT"), assetId: asset.id, type, reason, notes, state: "REQUESTED", requestedBy: actor.id, requestedByRole: actor.role, requestedAt: s.clock.now, scheduledDate, technician: "", checklist: [], revision: 1 };
    s.maintenance.push(record);
  } else {
    record = s.maintenance.find(row => row.id === p.id); if (!record) problem("El mantenimiento no existe.", 404);
    const asset = assetFor(s, record.assetId);
    if (action === "approve") {
      if (record.state !== "REQUESTED") problem("Solo se aprueban solicitudes pendientes.", 409);
      const technician = fields.string(p.technician, "technician", "Técnico o empresa responsable", { min: 3, max: 120, required: true });
      const scheduledDate = fields.date(p.scheduledDate ?? record.scheduledDate ?? "", "scheduledDate", "Fecha prevista", { min: limaDate(s.clock.now), max: "2100-12-31" });
      const rawChecks = p.checklist ?? DEFAULT_CHECKS[asset.type].map((label, i) => ({ id: `CHECK-${i + 1}`, label }));
      if (!Array.isArray(rawChecks) || rawChecks.length < 2 || rawChecks.length > 20) fields.add("checklist", "Define entre 2 y 20 comprobaciones de seguridad y servicio.");
      const checklist = Array.isArray(rawChecks) ? rawChecks.slice(0, 20).map((check, i) => ({ id: `CHECK-${i + 1}`, label: fields.string(check?.label, `checklist.${i}.label`, "Comprobación", { min: 5, max: 180, required: true }), done: false })) : [];
      if (new Set(checklist.map(row => row.label?.toLowerCase())).size !== checklist.length) fields.add("checklist", "No repitas la misma comprobación.");
      fields.assert(); Object.assign(record, { state: "APPROVED", technician, scheduledDate, checklist, approvedAt: s.clock.now, approvedBy: actor.id });
    } else if (action === "start") {
      if (record.state !== "APPROVED") problem("Aprueba primero la solicitud y sus comprobaciones.", 409);
      if (record.scheduledDate && record.scheduledDate > limaDate(s.clock.now)) problem("El servicio está programado para una fecha posterior.", 409);
      asset.status = "WAITING_SAFE"; record.state = "WAITING_SAFE"; record.startRequestedAt = s.clock.now; record.startedBy = actor.id;
      beginSafeMaintenance(s, record, context);
    } else if (action === "complete") {
      if (record.state !== "IN_PROGRESS") problem("El equipo debe estar retirado y en servicio antes de cerrar el mantenimiento.", 409);
      if (!safeToService(s, asset)) problem("Se detectó una carga o reserva incompatible con el cierre del servicio.", 409);
      const technician = fields.string(p.technician ?? record.technician, "technician", "Técnico responsable", { min: 3, max: 120, required: true });
      const performedDate = fields.date(p.performedDate, "performedDate", "Fecha del servicio realizado", { required: true, min: limaDate(record.startedAt), max: limaDate(s.clock.now) });
      const cost = fields.number(p.cost, "cost", "Coste del servicio (S/)", { min: 0, max: 1000000 });
      if (Number.isFinite(cost) && Math.abs(cost * 100 - Math.round(cost * 100)) > 0.000001) fields.add("cost", "El coste admite como máximo dos decimales.");
      const notes = fields.string(p.notes, "notes", "Informe del servicio", { min: 10, max: 1000, required: true, multiline: true });
      const nextDueDate = fields.date(p.nextDueDate ?? "", "nextDueDate", "Próximo servicio", { min: performedDate, max: "2100-12-31" });
      const done = p.checklist;
      if (!Array.isArray(done) || done.length !== record.checklist.length || new Set(done.map(row => row?.id)).size !== record.checklist.length || record.checklist.some(check => !done.some(row => row?.id === check.id && row.done === true))) fields.add("checklist", "Confirma todas las comprobaciones del plan antes de liberar el equipo.");
      fields.assert(); Object.assign(record, { state: "COMPLETED", technician, performedDate, cost, notes, nextDueDate, completedAt: s.clock.now, completedBy: actor.id, checklist: record.checklist.map(row => ({ ...row, done: true })) });
      asset.lastServiceHours = asset.serviceHours; asset.lastServiceAt = performedDate; asset.nextDueDate = nextDueDate; asset.status = asset.deviceId ? "AVAILABLE" : "PLANNED";
      const device = deviceFor(s, asset); if (device && !["CHARGER", "TRUCK"].includes(asset.type)) { device.state = "IDLE"; delete device.previousState; delete device.faultReason; delete device.maintenanceId; }
    } else if (action === "reject" || action === "cancel") {
      if (action === "reject" && record.state !== "REQUESTED") problem("Solo se rechazan solicitudes pendientes.", 409);
      if (action === "cancel" && !["REQUESTED", "APPROVED", "WAITING_SAFE"].includes(record.state)) problem("Un servicio ya iniciado debe completarse mediante su informe técnico.", 409);
      const reason = fields.string(p.reason, "reason", "Motivo de la decisión", { min: 10, max: 500, required: true, multiline: true }); fields.assert();
      if (record.state === "WAITING_SAFE") asset.status = asset.deviceId ? "AVAILABLE" : "PLANNED";
      record.state = action === "reject" ? "REJECTED" : "CANCELLED"; record.decisionReason = reason; record.decidedAt = s.clock.now; record.decidedBy = actor.id;
    } else problem("Acción de mantenimiento desconocida.", 404);
    record.revision++;
  }
  s.configuration.revision++;
  context.event(s, `MAINTENANCE_${action.toUpperCase()}`, `${s.catalog.assets.find(asset => asset.id === record.assetId).name}: ${record.state}.`, { actorId: actor.id, maintenanceId: record.id, assetId: record.assetId });
  return { id: record.id, state: record.state, configurationRevision: s.configuration.revision };
}
function beginSafeMaintenance(s, record, context) {
  const asset = assetFor(s, record.assetId); if (!safeToService(s, asset)) return false;
  const device = deviceFor(s, asset);
  asset.status = "MAINTENANCE"; record.state = "IN_PROGRESS"; record.startedAt = s.clock.now;
  if (device && !["CHARGER", "TRUCK"].includes(asset.type)) { device.previousState = device.state; device.state = "MAINTENANCE"; device.maintenanceId = record.id; }
  context.event(s, "MAINTENANCE_STARTED_SAFE", `${asset.name}: retirado sin carga, misión ni reserva; pendiente del servicio y la inspección técnica.`, { maintenanceId: record.id, assetId: asset.id });
  return true;
}
function tickMaintenance(s, seconds, context) {
  for (const asset of s.catalog.assets) {
    const device = deviceFor(s, asset);
    if (asset.active && ["AVAILABLE", "WAITING_SAFE"].includes(asset.status) && device && (asset.type === "CHARGER" ? s.robots.some(robot => robot.chargerId === device.id && robot.state === "CHARGING") : !["IDLE", "AVAILABLE", "FAULT", "MAINTENANCE"].includes(device.state))) asset.serviceHours += seconds / 3600;
  }
  for (const record of s.maintenance.filter(row => row.state === "WAITING_SAFE")) if (beginSafeMaintenance(s, record, context)) { record.revision++; s.configuration.revision++; }
}
function assetReadModel(s) {
  return s.catalog.assets.map(asset => { const device = deviceFor(s, asset), overdueHours = Math.max(0, asset.serviceHours - asset.lastServiceHours - asset.serviceIntervalHours), dueByDate = !!asset.nextDueDate && asset.nextDueDate <= limaDate(s.clock.now); return { ...asset, ...(AUTONOMY_ASSET_SCHEMAS[asset.type] ? { autonomyReadiness: automaticEquipmentStatus(s, asset.id), integrationMode: "SIMULATED", processId: device?.processId || null, safetyState: device?.safetyState || "UNVERIFIED" } : {}), serviceHours: Math.round(asset.serviceHours * 100) / 100, deviceState: device?.state || (asset.type === "CHARGER" ? "IDLE" : "UNCONNECTED"), maintenanceDue: overdueHours > 0 || dueByDate, hoursToService: Math.max(0, asset.serviceIntervalHours - (asset.serviceHours - asset.lastServiceHours)), safeForMaintenance: safeToService(s, asset), openMaintenanceId: s.maintenance.find(row => row.assetId === asset.id && OPEN.has(row.state))?.id || null }; });
}
module.exports = { TYPES, migrateEquipment, assetCommand, maintenanceCommand, deviceAvailable, tickMaintenance, assetReadModel, safeToService };
