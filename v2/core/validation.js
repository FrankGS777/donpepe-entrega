"use strict";

// One validation vocabulary is shared by configuration forms and domain commands.
// Errors are collected before throwing so a form can explain every invalid field.
const normalized = value => String(value ?? "").normalize("NFKC").trim().toLocaleLowerCase("es");
function problem(message, status = 422, fieldErrors) {
  const error = new Error(message); error.status = status; error.expose = true;
  if (fieldErrors) error.fieldErrors = fieldErrors;
  throw error;
}
class Fields {
  constructor() { this.errors = {}; }
  add(field, message) { this.errors[field] ||= message; return undefined; }
  string(value, field, label, { min = 0, max = 300, required = false, multiline = false } = {}) {
    if (value == null) value = "";
    if (typeof value !== "string") return this.add(field, `${label}: introduce un texto válido.`);
    const result = (multiline ? value.replace(/\r\n/g, "\n") : value).trim();
    const controls = multiline ? /[\u0000-\u0008\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;
    if ((required && !result) || result.length < min || result.length > max || controls.test(result)) return this.add(field, `${label}: usa entre ${required ? Math.max(1, min) : min} y ${max} caracteres.`);
    return result;
  }
  code(value, field = "code", label = "Código") {
    const result = this.string(value, field, label, { min: 2, max: 32, required: true })?.toUpperCase();
    if (result && !/^[A-Z0-9][A-Z0-9_-]+$/.test(result)) return this.add(field, `${label}: usa letras, números y guiones.`);
    return result;
  }
  number(value, field, label, { min = 0, max = 1000000, integer = false } = {}) {
    if (typeof value === "string" && /^-?(?:\d+(?:\.\d+)?)$/.test(value)) value = Number(value);
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) return this.add(field, `${label}: introduce ${integer ? "un entero" : "un número"} entre ${min} y ${max}.`);
    return value;
  }
  boolean(value, field, label) { if (typeof value !== "boolean") return this.add(field, `${label}: selecciona un estado válido.`); return value; }
  enum(value, field, label, options) { if (!options.includes(value)) return this.add(field, `${label}: selecciona una opción válida.`); return value; }
  refs(value, field, label, records, { min = 1, max = 50 } = {}) {
    if (!Array.isArray(value) || value.length < min || value.length > max || value.some(id => typeof id !== "string") || new Set(value).size !== value.length) return this.add(field, `${label}: selecciona entre ${min} y ${max} opciones diferentes.`);
    if (value.some(id => !records.some(record => record.id === id && record.active !== false))) return this.add(field, `${label}: hay una referencia inexistente o archivada.`);
    return [...value];
  }
  image(value, field = "imageUrl", label = "Imagen") {
    const result = this.string(value ?? "", field, label, { max: 180 });
    if (result && !/^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif|svg)$/.test(result)) return this.add(field, `${label}: selecciona una imagen de la biblioteca local.`);
    return result;
  }
  date(value, field, label, { required = false, min, max } = {}) {
    const result = this.string(value ?? "", field, label, { max: 10, required });
    if (!result) return result;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(result) && Number.isFinite(Date.parse(`${result}T00:00:00Z`)) && new Date(`${result}T00:00:00Z`).toISOString().slice(0, 10) === result;
    if (!valid || (min && result < min) || (max && result > max)) return this.add(field, `${label}: indica una fecha real${min ? ` desde ${min}` : ""}${max ? ` hasta ${max}` : ""}.`);
    return result;
  }
  unique(records, value, field, label, exceptId) { if (value && records.some(row => row.id !== exceptId && normalized(row[field]) === normalized(value))) this.add(field, `Ya existe ${label} con ese valor.`); }
  assert() { if (Object.keys(this.errors).length) problem("Revisa los campos marcados antes de continuar.", 422, this.errors); }
}

const VALIDATION_CATALOG = Object.freeze({
  version: 1,
  configuration: { optimisticRevision: true, immutableTraceableFields: ["code", "zoneId", "unitsPerCase", "maxCasesPerHu", "expiryControlled", "brandId", "barcode", "presentation"], lifecycleChecks: ["activeReferences", "physicalStock", "openDocuments", "activeUsers", "activeMaintenance", "inactiveBeforeDelete", "irreversibleDeletion", "protectedPhysicalEquipment"] },
  masters: { name: { min: 2, max: 100, normalizedUnique: true }, code: { min: 2, max: 32, pattern: "A-Z, 0-9, guion y guion bajo", unique: true }, imageUrl: { localOnly: true }, description: { max: 500 }, categoryZones: { min: 1, max: 4, unique: true }, brandSuppliers: { min: 1, max: 50, activeOnly: true } },
  products: { gtinLengths: [8, 12, 13, 14], gtinChecksum: true, unitsPerCase: { min: 1, max: 240, integer: true }, maxCasesPerHu: { min: 1, max: 24, integer: true }, reorderPoint: { min: 0, max: 10000, integer: true }, supplierMustMatchBrand: true, zoneMustMatchCategory: true, coldExpiryRequired: true },
  assets: { serialUnique: true, serviceIntervalHours: { min: 1, max: 10000 }, capacityCases: { min: 1, max: 1000, integer: true }, capacityKg: { min: 1, max: 100000 }, liveGeometryMutable: false, liveCapacityMutable: false, dateOrder: "commissionDate <= warrantyUntil", plannedAssetsDoNotCreateMapObjects: true },
  maintenance: { uniqueOpenRecordPerAsset: true, startRequiresNoCargo: true, safeIdleBeforeService: true, releaseRequiresAllChecklist: true, cost: { min: 0, max: 1000000 }, operatorRequestOnly: true, actualServiceRequiresTechnician: true, stateTransitions: { REQUESTED: ["APPROVED", "REJECTED", "CANCELLED"], APPROVED: ["WAITING_SAFE", "IN_PROGRESS", "CANCELLED"], WAITING_SAFE: ["IN_PROGRESS", "CANCELLED"], IN_PROGRESS: ["COMPLETED"], COMPLETED: [], REJECTED: [], CANCELLED: [] } },
  requests: { lines: { min: 1, max: 12, uniqueSku: true }, quantity: { min: 1, max: 1000, integer: true }, editPendingOnly: true, ownBranchOnly: true, cancellationRequiresReason: true, supplierPurchaseCancelBeforeArrivalOnly: true, FEFOReservationAtomic: true },
  security: { singleAdministrator: true, administratorCannotExecuteWarehouse: true, storeIsolation: true, passwordHistory: 5, recoveryApprovalRequired: true, csrfRequired: true, idempotentCommands: true, transactionRollback: true },
});
module.exports = { Fields, problem, normalized, VALIDATION_CATALOG };
