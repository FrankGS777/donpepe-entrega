"use strict";
const SENSITIVE = /^(?:password|passwordhash|currentpassword|newpassword|confirmation|passwordconfirmation|token|tokenhash|accesstoken|refreshtoken|sessiontoken|csrf|authorization|cookie|secret|smtppassword|smtppass|smtpuser|apikey|privatekey|dataurl|data|avatardata)$/i;
function redact(value, depth = 0) {
  if (depth > 7) return "[Información resumida]";
  if (value == null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 3000).replace(/(?:\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53})/g, "[Credencial protegida]").replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, "$1[Protegido]");
  if (Array.isArray(value)) return value.slice(0, 100).map(item => redact(item, depth + 1));
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => !["motionHistory", "route", "routes"].includes(key)).map(([key, item]) => [key, SENSITIVE.test(key.replace(/[^a-z0-9]/gi, "")) ? "[Protegido]" : redact(item, depth + 1)]));
  return String(value);
}
function changes(before, after, prefix = "", depth = 0) {
  const result = [];
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(after || {})])) {
    const a = before?.[key] ?? null, b = after?.[key] ?? null, field = prefix ? `${prefix}.${key}` : key;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (depth < 3 && a && b && !Array.isArray(a) && !Array.isArray(b) && typeof a === "object" && typeof b === "object") result.push(...changes(a, b, field, depth + 1));
    else result.push({ field, before: a, after: b });
  }
  return result.slice(0, 100);
}
function auditTarget(snapshot, type, payload, id) {
  const targetId = id || payload.id || payload.huId || payload.assetId;
  let record;
  if (type.startsWith("config.")) { const kind = type.split(".")[1], keys = { sku: "skus", category: "categories", brand: "brands", supplier: "suppliers", branch: "branches", asset: "assets" }; record = kind === "company" ? snapshot.configuration?.company : kind === "settings" ? snapshot.configuration?.settings : snapshot.catalog?.[keys[kind]]?.find(row => row.id === targetId); }
  else if (type.startsWith("supplierClaim.")) record = snapshot.supplierClaims?.claims?.find(row=>row.id===targetId || row.huId===targetId);
  else if (type.startsWith("finance.")) record = snapshot.finance?.bills?.find(row=>row.id===targetId || row.payments?.some(p=>p.id===targetId));
  else if (type.startsWith("maintenance.")) record = snapshot.maintenance?.find(row => row.id === targetId);
  else if (type.startsWith("purchase.")) record = snapshot.purchases?.find(row => row.id === targetId);
  else if (type.startsWith("order.")) record = snapshot.orders?.find(row => row.id === targetId);
  else if (type.startsWith("equipment.")) record = snapshot.catalog?.assets?.find(row => row.deviceId === targetId);
  else if (type.startsWith("inventory.")) record = snapshot.hus?.find(row => row.id === targetId);
  else if (type.startsWith("return.")) record = snapshot.returns?.find(row => row.id === targetId);
  else if (type === "store.consume") record = { branchId: payload.branchId, skuId: payload.skuId, stock: snapshot.storeStock?.filter(row => row.skuId === payload.skuId && (!payload.branchId || row.branchId === payload.branchId)) };
  else if (type === "location.block") record = snapshot.layout?.locations?.find(row => row.id === targetId);
  else if (type.startsWith("simulation.")) record = snapshot.clock;
  if (!record) return null;
  const ignored = new Set(["motionHistory", "availableCases", "hoursToService", "safeForMaintenance", "deviceState", "updatedAt", "serviceHours", "referenceUrl", "sourceApiUrl", "sourceImageUrl", "imageSha256", "importSource"]);
  return redact(Object.fromEntries(Object.entries(record).filter(([key]) => !ignored.has(key))));
}
module.exports = { redact, changes, auditTarget };
