"use strict";
const { Fields, problem } = require("./validation");
const { can } = require("../security/policy");
const { limaDate } = require("./time");
const {
  autonomyAssetMedia,
  migrateSeededAutonomyMedia,
} = require("./autonomy-media");

// Business orchestration only. These are simulated commissioning parameters,
// never a PLC connection, a safety certification or a way to bypass interlocks.
const AUTONOMY_DEFAULTS = Object.freeze({
  version: 1,
  mode: "SIMULATED",
  enabled: true,
  inboundEnabled: true,
  outboundEnabled: true,
  storeReceivingEnabled: true,
  arrivalSeconds: 12,
  unloadSeconds: 6,
  identifySeconds: 3,
  inspectionSeconds: 4,
  conveyorSeconds: 3,
  storeUnloadSeconds: 6,
  storeIdentifySeconds: 3,
  eventTimeoutSeconds: 120,
  maxAutoRetries: 2,
  weightTolerancePercent: 5,
});
const CONFIG_FIELDS = Object.freeze([
  ...[
    ["enabled", "Orquestación autónoma"],
    ["inboundEnabled", "Recepción autónoma del centro"],
    ["outboundEnabled", "Expedición autónoma"],
    ["storeReceivingEnabled", "Recepción autónoma en tiendas"],
  ].map(([key, label]) => ({ key, label, type: "boolean" })),
  ...[
    ["arrivalSeconds", "Tiempo de llegada (s)", 2, 600],
    ["unloadSeconds", "Ciclo mínimo de descarga en el centro (s)", 2, 180],
    ["identifySeconds", "Identificación Auto-ID (s)", 1, 60],
    ["inspectionSeconds", "Ciclo mínimo de inspección (s)", 2, 120],
    ["conveyorSeconds", "Ciclo mínimo de transferencia (s)", 1, 120],
    ["storeUnloadSeconds", "Ciclo mínimo de descarga en tienda (s)", 2, 180],
    ["storeIdentifySeconds", "Identificación en tienda (s)", 1, 60],
    ["eventTimeoutSeconds", "Vigencia máxima de evidencia (s)", 30, 900],
    ["maxAutoRetries", "Reevaluaciones máximas autorizadas", 0, 3],
    ["weightTolerancePercent", "Tolerancia de peso (%)", 1, 10],
  ].map(([key, label, min, max]) => ({
    key,
    label,
    type: "integer",
    min,
    max,
  })),
]);
const AUTONOMY_ASSET_SCHEMAS = Object.freeze({
  AUTO_UNLOADER: {
    name: "Descargador automático de muelle",
    capabilities: ["COMPATIBLE_TRAILER_UNLOAD", "DOCK_INTERLOCKS"],
    defaults: { autoAssign: true, commissioned: true, cycleSeconds: 6 },
    limits: { cycleSeconds: { min: 2, max: 180 } },
    requiredInterlocks: [
      "VEHICLE_RESTRAINED",
      "DOCK_LEVELER_READY",
      "TRANSFER_AREA_CLEAR",
      "LOAD_SUPPORTED",
    ],
  },
  AUTO_ID_GATE: {
    name: "Portal de identificación automática",
    capabilities: ["SSCC_BARCODE", "GTIN_LOT_EXPIRY", "ASN_RECONCILIATION"],
    defaults: { autoAssign: true, commissioned: true, readTimeoutSeconds: 15 },
    limits: { readTimeoutSeconds: { min: 3, max: 60 } },
    requiredInterlocks: ["SINGLE_LOAD_IN_READER", "IDENTITY_RECONCILED"],
  },
  PIE_STATION: {
    name: "Puesto de inspección de entrada",
    capabilities: [
      "WEIGHT",
      "DIMENSIONS",
      "PALLET_PROFILE",
      "PACKAGING_VISION",
      "TEMPERATURE_EVIDENCE",
    ],
    defaults: {
      autoAssign: true,
      commissioned: true,
      inspectionSeconds: 4,
      weightTolerancePercent: 5,
    },
    limits: {
      inspectionSeconds: { min: 2, max: 120 },
      weightTolerancePercent: { min: 1, max: 10 },
    },
    requiredInterlocks: [
      "SCALE_CALIBRATION_VALID",
      "VISION_ONLINE",
      "TEMPERATURE_EVIDENCE_VALID",
    ],
  },
  INBOUND_CONVEYOR: {
    name: "Transportador de recepción",
    capabilities: [
      "LOAD_TRANSFER",
      "ZERO_PRESSURE_ACCUMULATION",
      "ZONE_SEGREGATION",
    ],
    defaults: { autoAssign: true, commissioned: true, transferSeconds: 3 },
    limits: { transferSeconds: { min: 1, max: 120 } },
    requiredInterlocks: [
      "DESTINATION_RESERVED",
      "TRANSFER_AREA_CLEAR",
      "NO_JAM",
    ],
  },
  CASE_PICKING_CELL: {
    name: "Célula robótica de cajas cerradas",
    capabilities: [
      "CLOSED_CASE_SELECTION",
      "LOAD_SPLIT",
      "OUTBOUND_LABEL_APPLY",
    ],
    defaults: { autoAssign: true, commissioned: true, caseCycleSeconds: 5 },
    limits: { caseCycleSeconds: { min: 2, max: 120 } },
    requiredInterlocks: [
      "LOAD_SUPPORTED",
      "GUARDED_CELL_CLEAR",
      "CASE_COUNT_RECONCILED",
      "OUTBOUND_LABEL_VERIFIED",
    ],
  },
  STORE_RECEIVING_STATION: {
    name: "Estación autónoma de recepción de tienda",
    capabilities: [
      "COMPATIBLE_TRAILER_UNLOAD",
      "SSCC_BARCODE",
      "DELIVERY_RECONCILIATION",
      "TEMPERATURE_EVIDENCE",
      "SECURE_HANDOVER",
    ],
    defaults: {
      autoAssign: true,
      commissioned: true,
      unloadSeconds: 6,
      readTimeoutSeconds: 15,
    },
    limits: {
      unloadSeconds: { min: 2, max: 180 },
      readTimeoutSeconds: { min: 3, max: 60 },
    },
    requiredInterlocks: [
      "VEHICLE_RESTRAINED",
      "DOCK_LEVELER_READY",
      "TRANSFER_AREA_CLEAR",
      "LOAD_SUPPORTED",
      "SECURE_STORE_BUFFER",
    ],
  },
});
const assetDefinitions = (s) => [
  [
    "AUTO-UNLOADER-IN-1",
    "Descargador automático · recepción CD",
    "AUTO_UNLOADER",
    null,
  ],
  [
    "AUTO-ID-IN-1",
    "Portal Auto-ID · recepción CD",
    "AUTO_ID_GATE",
    null,
  ],
  [
    "PIE-IN-1",
    "Control de peso, volumen, visión y temperatura",
    "PIE_STATION",
    null,
  ],
  [
    "INBOUND-CONVEYOR-1",
    "Transportador segregado · recepción CD",
    "INBOUND_CONVEYOR",
    null,
  ],
  [
    "CASE-PICKER-1",
    "Célula robótica · preparación de cajas cerradas",
    "CASE_PICKING_CELL",
    null,
  ],
  ...s.catalog.branches.map((branch) => [
    `STORE-RECEIVING-${branch.id}`,
    `Recepción autónoma · ${branch.name}`,
    "STORE_RECEIVING_STATION",
    branch.id,
  ]),
];
function migrateAutonomyConfiguration(s) {
  let changed = false;
  s.configuration ||= { revision: 1, settings: {} };
  if (!s.configuration.autonomy) {
    s.configuration.autonomy = structuredClone(AUTONOMY_DEFAULTS);
    changed = true;
  }
  for (const [key, value] of Object.entries(AUTONOMY_DEFAULTS))
    if (s.configuration.autonomy[key] === undefined) {
      s.configuration.autonomy[key] = value;
      changed = true;
    }
  if (!s.autonomyDevices) {
    s.autonomyDevices = [];
    changed = true;
  }
  s.catalog.assets ||= [];
  for (const [id, name, type, branchId] of assetDefinitions(s)) {
    const schema = AUTONOMY_ASSET_SCHEMAS[type];
    const existing = s.catalog.assets.find(
      (asset) => asset.deviceId === id || asset.id === `ASSET-${id}`,
    );
    if (existing) {
      if (migrateSeededAutonomyMedia(existing, type)) changed = true;
    } else {
      s.catalog.assets.push({
        id: `ASSET-${id}`,
        code: id,
        name,
        type,
        deviceId: id,
        branchId,
        manufacturer: "Integración DonPepe",
        model: schema.name,
        serialNumber: `DP-I40-${id}`,
        ...autonomyAssetMedia(type),
        commissionDate: limaDate(s.clock.now),
        warrantyUntil: "",
        serviceIntervalHours: 250,
        serviceHours: 0,
        lastServiceHours: 0,
        capacityCases: 24,
        capacityKg: 1500,
        temperatureClass: "MULTI",
        active: true,
        status: "AVAILABLE",
        settings: structuredClone(schema.defaults),
        settingsRevision: 1,
        capabilities: [...schema.capabilities],
        safetyInterlocks: [...schema.requiredInterlocks],
        integrationMode: "SIMULATED",
        notes:
          "Modelo lógico simulado de infraestructura autónoma. No certifica una instalación ni conecta hardware real.",
      });
      changed = true;
    }
    if (!s.autonomyDevices.some((device) => device.id === id)) {
      s.autonomyDevices.push({
        id,
        type,
        branchId,
        state: "IDLE",
        online: true,
        safetyState: "VERIFIED",
        processId: null,
        carryingHuId: null,
        heartbeatAt: s.clock.now,
        source: "SIMULATOR",
      });
      changed = true;
    }
  }
  return changed;
}
function automaticEquipmentStatus(s, assetId, { processId = null } = {}) {
  const asset = s.catalog.assets?.find(
    (row) => row.id === assetId || row.deviceId === assetId,
  );
  const device = s.autonomyDevices?.find((row) => row.id === asset?.deviceId);
  // The current owner may finish a safe transfer while a configuration change
  // or maintenance withdrawal waits. It never bypasses a fault, offline device,
  // unverified interlock or actual maintenance state. New owners remain blocked.
  const owned = !!processId && device?.processId === processId;
  const heartbeatAge =
      Date.parse(s.clock.now) - Date.parse(device?.heartbeatAt),
    heartbeatLimit =
      (s.configuration.autonomy?.eventTimeoutSeconds || 120) * 1000;
  const reason = !asset
    ? "El equipo no está registrado."
    : !asset.active ||
        !["AVAILABLE", ...(owned ? ["WAITING_SAFE"] : [])].includes(
          asset.status,
        )
      ? "El equipo está desactivado, retirado o en mantenimiento."
      : asset.pendingSettings && !owned
        ? "La configuración espera una retirada segura."
        : asset.settings?.autoAssign === false
          ? "El equipo no admite nuevas asignaciones."
          : asset.settings?.commissioned !== true
            ? "La puesta en servicio no está validada."
            : !device || device.online !== true
              ? "El equipo no está comunicado con el simulador."
              : !Number.isFinite(heartbeatAge) ||
                  heartbeatAge < 0 ||
                  heartbeatAge > heartbeatLimit
                ? "La señal de actividad del equipo está ausente o caducada."
                : device.safetyState !== "VERIFIED"
                  ? "Los enclavamientos de seguridad no están verificados."
                  : device.processId && !owned
                    ? "La estación está ejecutando otra unidad de carga."
                    : device.faultReason ||
                        !["IDLE", "READY", "RESERVED"].includes(device.state)
                      ? "El equipo está ocupado o presenta una incidencia."
                      : null;
  return {
    assetId: asset?.id || assetId,
    deviceId: asset?.deviceId || null,
    ready: !reason,
    reason,
  };
}
const automaticEquipmentReady = (s, assetId) =>
  automaticEquipmentStatus(s, assetId).ready;
function autonomyConfigurationCommand(s, p, actor, context) {
  if (!can(actor, "config.autonomy.manage"))
    problem("Solo administración configura la infraestructura autónoma.", 403);
  const raw = p.settings || p.autonomy;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    problem("Indica una configuración de autonomía válida.", 422);
  const fields = new Fields(),
    current = s.configuration.autonomy,
    next = { ...current, ...raw };
  for (const key of Object.keys(raw))
    if (!CONFIG_FIELDS.some((field) => field.key === key))
      fields.add(
        key,
        "Este parámetro está protegido o no forma parte de la orquestación.",
      );
  for (const field of CONFIG_FIELDS)
    next[field.key] =
      field.type === "boolean"
        ? fields.boolean(next[field.key], field.key, field.label)
        : fields.number(next[field.key], field.key, field.label, {
            min: field.min,
            max: field.max,
            integer: true,
          });
  if (
    next.eventTimeoutSeconds <
    Math.max(
      next.unloadSeconds,
      next.identifySeconds,
      next.inspectionSeconds,
      next.conveyorSeconds,
      next.storeUnloadSeconds,
      next.storeIdentifySeconds,
    ) +
      5
  )
    fields.add(
      "eventTimeoutSeconds",
      "La espera de evidencia debe superar la fase más larga en al menos cinco segundos.",
    );
  fields.assert();
  if (JSON.stringify(next) === JSON.stringify(current))
    problem("La configuración no contiene cambios.", 409);
  // Disabling only stops admission. Active processes always retain custody and
  // complete or hold safely; their authorization/settings snapshots are immutable.
  s.configuration.autonomy = next;
  s.configuration.revision++;
  context.event(
    s,
    "AUTONOMY_CONFIGURATION_UPDATED",
    "Política de orquestación actualizada; las cargas en curso conservan su custodia.",
    {
      actorId: actor.id,
      before: structuredClone(current),
      after: structuredClone(next),
    },
  );
  return { configurationRevision: s.configuration.revision, mode: next.mode };
}
function autonomyConfigurationReadModel(s, actor) {
  const canConfigure = can(actor, "config.autonomy.manage"),
    permitted = can(actor, "autonomy.read") || canConfigure;
  if (!permitted) return null;
  const assets = s.catalog.assets
    .filter(
      (asset) =>
        AUTONOMY_ASSET_SCHEMAS[asset.type] &&
        (actor.role !== "store" || asset.branchId === actor.branchId),
    )
    .map((asset) => ({
      id: asset.id,
      deviceId: asset.deviceId,
      name: asset.name,
      type: asset.type,
      branchId: asset.branchId || null,
      imageUrl: asset.imageUrl,
      imageKind: asset.imageKind,
      imageScope: asset.imageScope,
      imageProvenance: structuredClone(asset.imageProvenance || null),
      capabilities: asset.capabilities,
      readiness: automaticEquipmentStatus(s, asset.id),
    }));
  return {
    settings: structuredClone(s.configuration.autonomy),
    configuration: structuredClone(s.configuration.autonomy),
    fields: canConfigure ? structuredClone(CONFIG_FIELDS) : [],
    configurationSchema: canConfigure ? structuredClone(CONFIG_FIELDS) : [],
    configurationRevision: s.configuration.revision,
    canConfigure,
    mode: "SIMULATED",
    assets,
    interlocksEditable: false,
  };
}
module.exports = {
  AUTONOMY_DEFAULTS,
  AUTONOMY_POLICY_FIELDS: CONFIG_FIELDS,
  AUTONOMY_ASSET_SCHEMAS,
  migrateAutonomyConfiguration,
  autonomyConfigurationCommand,
  autonomyConfigurationReadModel,
  automaticEquipmentReady,
  automaticEquipmentStatus,
};
