"use strict";
const { Fields, problem } = require("./validation");
const { AUTONOMY_ASSET_SCHEMAS } = require("./autonomy-config");
const TASKS = { AMR: ["PUTAWAY", "PICK", "PICK_TO_PACK", "TO_STAGING", "RETURN_TO_QUARANTINE"], STACKER: ["PUTAWAY", "PICK"], SHUTTLE: ["PUTAWAY", "PICK"], FORKLIFT: ["TRUCK_LOAD", "TRUCK_UNLOAD"], TRUCK: ["DELIVERY", "RETURN_PICKUP"] };
const MANDATORY = { AMR: ["RETURN_TO_QUARANTINE"], FORKLIFT: ["TRUCK_UNLOAD"] };
const LABELS = { autoAssign: "Disponible para nuevas asignaciones", priority: "Preferencia de asignación", speedProfile: "Perfil de desplazamiento", allowedTasks: "Trabajos autorizados", chargeBelowPercent: "Solicitar recarga por debajo de (%)", resumeAtPercent: "Finalizar recarga al alcanzar (%)" };
const TASK_LABELS = { PUTAWAY: "Almacenamiento de entradas", PICK: "Extracción de reserva", PICK_TO_PACK: "Traslado a preparación", TO_STAGING: "Traslado al muelle", RETURN_TO_QUARANTINE: "Retorno seguro a cuarentena", TRUCK_LOAD: "Carga del camión", TRUCK_UNLOAD: "Descarga segura de incidencias", DELIVERY: "Reparto a tiendas", RETURN_PICKUP: "Recogida de devoluciones" };
function defaults(type) { if (AUTONOMY_ASSET_SCHEMAS[type]) return structuredClone(AUTONOMY_ASSET_SCHEMAS[type].defaults); return { autoAssign: true, ...(["AMR", "TRUCK", "CHARGER"].includes(type) ? { priority: 50 } : {}), ...(type !== "CHARGER" ? { speedProfile: "NORMAL", allowedTasks: [...(TASKS[type] || [])] } : {}), ...(type === "AMR" ? { chargeBelowPercent: 20, resumeAtPercent: 95 } : {}) }; }
const SCHEMAS = Object.fromEntries(["AMR", "STACKER", "SHUTTLE", "FORKLIFT", "TRUCK", "CHARGER"].map(type => {
  const value = defaults(type);
  const fields = Object.keys(value).map(key => ({ key, label: LABELS[key], type: key === "autoAssign" ? "boolean" : key === "speedProfile" ? "select" : key === "allowedTasks" ? "tasks" : "integer", ...(key === "priority" ? { min: 1, max: 100 } : key === "chargeBelowPercent" ? { min: 15, max: 40 } : key === "resumeAtPercent" ? { min: 70, max: 95 } : {}), ...(key === "speedProfile" ? { options: [{ value: "ECO", label: "Eco · 75 % del perfil normal" }, { value: "NORMAL", label: "Normal · velocidad nominal del escenario" }] } : key === "allowedTasks" ? { options: TASKS[type].map(value => ({ value, label: TASK_LABELS[value] })) } : {}) }));
  return [type, { fields, allowedTasks: TASKS[type] || [], mustKeepTasks: MANDATORY[type] || [], defaults: value }];
}));
const AUTOMATIC_LABELS = { autoAssign: LABELS.autoAssign, commissioned: "Puesta en servicio validada", cycleSeconds: "Ciclo de descarga (segundos)", readTimeoutSeconds: "Tiempo de lectura (segundos)", inspectionSeconds: "Inspección (segundos)", weightTolerancePercent: "Tolerancia de peso (%)", transferSeconds: "Mínimo de control de transferencia (segundos)", unloadSeconds: "Descarga en tienda (segundos)" };
for (const [type, source] of Object.entries(AUTONOMY_ASSET_SCHEMAS)) SCHEMAS[type] = { defaults: defaults(type), allowedTasks: [], mustKeepTasks: [], capabilities: [...source.capabilities], requiredInterlocks: [...source.requiredInterlocks], fields: Object.entries(source.defaults).map(([key, value]) => ({ key, label: AUTOMATIC_LABELS[key], type: typeof value === "boolean" ? "boolean" : "integer", ...(source.limits[key] || {}) })) };
const deviceFor = (s, asset) => [...s.robots, ...s.trucks, ...s.layout.stations, ...(s.autonomyDevices || [])].find(device => device.id === asset.deviceId);
function migrateDeviceSettings(s) {
  let changed = false;
  for (const asset of s.catalog.assets) {
    if (!asset.settings) { asset.settings = defaults(asset.type); asset.settingsRevision = 1; changed = true; }
    const device = deviceFor(s, asset); if (device && !device.runtimeSettings) { device.runtimeSettings = structuredClone(asset.settings); changed = true; }
  }
  return changed;
}
function applySettings(s, asset, pending, context) {
  const before = structuredClone(asset.settings); asset.settings = structuredClone(pending.settings); asset.settingsRevision = (asset.settingsRevision || 1) + 1; asset.settingsAppliedAt = s.clock.now; asset.settingsAppliedBy = pending.requestedBy; delete asset.pendingSettings;
  const device = deviceFor(s, asset); if (device) device.runtimeSettings = structuredClone(asset.settings);
  context.event(s, "DEVICE_SETTINGS_APPLIED", `${asset.name}: configuración aplicada sin carga ni misión activa.`, { assetId: asset.id, actorId: pending.requestedBy, before, after: structuredClone(asset.settings), correlationId: pending.correlationId || null });
}
function configureDevice(s, asset, p, actor, context) {
  if (!asset.active) problem("El equipo está desactivado. Actívalo antes de configurar su disponibilidad.", 409);
  if (asset.pendingSettings) problem("El equipo ya tiene una configuración esperando su retirada segura. Espera a que se aplique.", 409);
  if (!p.settings || typeof p.settings !== "object" || Array.isArray(p.settings)) problem("Indica una configuración válida.", 422);
  const schema = SCHEMAS[asset.type], fields = new Fields(), next = { ...asset.settings, ...p.settings };
  for (const key of Object.keys(p.settings)) if (!Object.hasOwn(schema.defaults, key)) fields.add(key, "Este parámetro no está disponible para esta clase de equipo.");
  next.autoAssign = fields.boolean(next.autoAssign, "autoAssign", LABELS.autoAssign);
  if (Object.hasOwn(schema.defaults, "priority")) next.priority = fields.number(next.priority, "priority", LABELS.priority, { min: 1, max: 100, integer: true });
  if (AUTONOMY_ASSET_SCHEMAS[asset.type]) {
    const source = AUTONOMY_ASSET_SCHEMAS[asset.type];
    next.commissioned = fields.boolean(next.commissioned, "commissioned", AUTOMATIC_LABELS.commissioned);
    for (const [key, limits] of Object.entries(source.limits)) next[key] = fields.number(next[key], key, AUTOMATIC_LABELS[key], { ...limits, integer: true });
  } else if (asset.type !== "CHARGER") {
    next.speedProfile = fields.enum(next.speedProfile, "speedProfile", LABELS.speedProfile, ["ECO", "NORMAL"]);
    next.allowedTasks = fields.refs(next.allowedTasks, "allowedTasks", LABELS.allowedTasks, schema.allowedTasks.map(id => ({ id, active: true })), { min: 1, max: schema.allowedTasks.length });
    if (next.allowedTasks && schema.mustKeepTasks.some(task => !next.allowedTasks.includes(task))) fields.add("allowedTasks", "Conserva los trabajos de retorno seguro y descarga de incidencias que necesita este equipo.");
  }
  if (asset.type === "AMR") {
    next.chargeBelowPercent = fields.number(next.chargeBelowPercent, "chargeBelowPercent", LABELS.chargeBelowPercent, { min: 15, max: 40, integer: true });
    next.resumeAtPercent = fields.number(next.resumeAtPercent, "resumeAtPercent", LABELS.resumeAtPercent, { min: 70, max: 95, integer: true });
    if (next.resumeAtPercent < next.chargeBelowPercent + 30) fields.add("resumeAtPercent", "El nivel de salida debe superar el de entrada a recarga en al menos 30 puntos.");
  }
  fields.assert();
  if (asset.type === "CHARGER" && !next.autoAssign && s.catalog.assets.some(row => row.type === "AMR" && row.active) && !s.catalog.assets.some(row => row.id !== asset.id && row.type === "CHARGER" && row.active && row.status === "AVAILABLE" && row.settings?.autoAssign !== false && row.pendingSettings?.settings.autoAssign !== false)) problem("Conserva al menos un cargador habilitado para la flota activa. Retira los equipos por mantenimiento de forma escalonada.", 409, { autoAssign: "La flota necesita una estación de recarga disponible." });
  if (JSON.stringify(next) === JSON.stringify(asset.settings)) problem("La configuración no contiene cambios.", 409);
  const pending = { settings: next, requestedAt: s.clock.now, requestedBy: actor.id, correlationId: p.commandId || null };
  if (!asset.deviceId || context.safeToService(s, asset)) { applySettings(s, asset, pending, context); return "APPLIED"; }
  asset.pendingSettings = pending;
  context.event(s, "DEVICE_SETTINGS_PENDING", `${asset.name}: la configuración espera que termine su trabajo y vuelva a una posición segura.`, { assetId: asset.id, actorId: actor.id, before: structuredClone(asset.settings), after: structuredClone(next), correlationId: p.commandId || null });
  return "WAITING_SAFE";
}
function tickDeviceSettings(s, context) { for (const asset of s.catalog.assets.filter(asset => asset.pendingSettings)) if (context.safeToService(s, asset)) { applySettings(s, asset, asset.pendingSettings, context); s.configuration.revision++; } }
const speedFactor = device => device?.runtimeSettings?.speedProfile === "ECO" ? 0.75 : 1;
const priorityOf = (s, id) => s.catalog.assets.find(asset => asset.deviceId === id)?.settings?.priority ?? 50;
const taskAllowed = (device, task) => !device.runtimeSettings?.allowedTasks || device.runtimeSettings.allowedTasks.includes(task === "SUPPLIER_RETURN" ? "RETURN_TO_QUARANTINE" : task);
module.exports = { DEVICE_SETTING_SCHEMAS: SCHEMAS, migrateDeviceSettings, configureDevice, tickDeviceSettings, speedFactor, priorityOf, taskAllowed };
