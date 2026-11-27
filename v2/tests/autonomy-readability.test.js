"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const source = fs.readFileSync(path.join(__dirname, "../frontend/autonomy-view.js"), "utf8")
  .replace('import { photo } from "./experience.js";', 'const photo = () => "<img>";')
  .replace('from "./time.js";', `from ${JSON.stringify(pathToFileURL(path.join(__dirname, "../frontend/time.js")).href)};`)
  .replace('from "../core/packaging-quality.js";', `from ${JSON.stringify(pathToFileURL(path.join(__dirname, "../core/packaging-quality.js")).href)};`);
const library = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const base = () => ({
  catalog: { skus: [{ id: "SKU-1", name: "Yogurt de fresa" }], assets: [{ id: "PIE-1", deviceId: "DEV-1", name: "Estación de inspección" }], branches: [{ id: "B-1", name: "DonPepe · San Miguel" }] },
  hus: [{ id: "HU-1", skuId: "SKU-1" }], trucks: [{ id: "T-1", name: "Unidad frigorífica 1" }],
  purchases: [], orders: [],
  autonomy: { jobs: [{ id: "AUTO-1", documentId: "OC-1", partnerName: "Proveedor", kind: "PURCHASE", state: "INSPECTING", authorizedBy: "OPS-1", createdAt: "2026-10-18T14:00:00Z", updatedAt: "2026-10-18T14:10:00Z", loadIds: ["LOAD-1"], noticeId: "ASN-1" }], notices: [{ id: "ASN-1", loads: [{ id: "LOAD-1", skuId: "SKU-1", cases: 12, lot: "FAB-01", expiry: "2026-11-18", sscc: "000000100000000019" }] }], evidence: [], exceptions: [] },
});
async function render(snapshot, permissions = []) {
  const { createAutonomyView } = await library;
  let content;
  const view = createAutonomyView({
    getState: () => snapshot, getUser: () => ({ id: "OPS-1", name: "Ana" }),
    can: (permission) => permissions.includes(permission), esc,
    showDialog: (title, html) => { content = html; }, dialog: { querySelectorAll: () => [] },
  });
  view.detail("AUTO-1");
  return content;
}

test("inspection readings retain actual units, temperatures and missing values", async () => {
  const { describeAutonomyEvidence } = await library;
  const row = { checkpoint: "PIE", assetId: "PIE-1", payload: { skuId: "SKU-1", profile: { weightKg: 148.5, widthM: 1.2, depthM: 1, heightM: 1.45 }, packaging: "OK", pallet: "DAMAGED", temperatureC: 4 }, checks: ["VISIBLE_QUALITY_HOLD"] };
  const view = describeAutonomyEvidence(row, base());
  assert.equal(view.asset.name, "Estación de inspección");
  assert.equal(view.sku.name, "Yogurt de fresa");
  assert.deepEqual(view.facts.map((fact) => fact.value), ["148.5 kg", "1.2 m", "1 m", "1.45 m", "4 °C", "Sin observaciones", "Con observaciones", "Sin lectura"]);
  assert.equal(view.checks[0].title, "Observación en embalaje o etiqueta");
  assert.match(view.checks[0].detail, /Revisa/);
  const missing = describeAutonomyEvidence({ checkpoint: "UNLOAD", payload: { vehicleRestrained: false } });
  assert.deepEqual(missing.facts.map((fact) => fact.value), ["No confirmado", "Sin lectura", "Sin lectura", "Sin lectura"]);
});

test("store receipt resolves names and totals only witnessed loads", async () => {
  const { describeAutonomyEvidence } = await library;
  const row = { checkpoint: "BRANCH_RECEIPT", payload: { branchId: "B-1", truckId: "T-1", secureBuffer: true, vehicleRestrained: true, acquisitionSeconds: 2.5, loads: [{ huId: "HU-1", cases: 6, lot: "FAB-01", expiry: "2026-11-18", temperatureC: 4 }] } };
  const view = describeAutonomyEvidence(row, base());
  assert.equal(view.products[0].name, "Yogurt de fresa");
  assert.equal(view.products[0].expiry, "18/11/2026");
  assert.equal(view.facts.find((fact) => fact.label === "Cajas comprobadas").value, "6 cajas");
  assert.equal(view.facts.find((fact) => fact.label === "Tienda").value, "DonPepe · San Miguel");
  assert.equal(view.facts.find((fact) => fact.label === "Vehículo").value, "Unidad frigorífica 1");
  row.payload.loads[0].cases = undefined;
  assert.equal(describeAutonomyEvidence(row, base()).facts.some((fact) => fact.label === "Cajas comprobadas"), false);
});

test("dossier shows only registered controls and never raw payload objects", async () => {
  const snapshot = base();
  snapshot.autonomy.evidence = [
    { id: "READ-2", jobId: "AUTO-1", checkpoint: "AUTO_ID", observedAt: "2026-10-18T14:03:00Z", decision: "PASS", checks: ["IDENTITY_AND_POLICY_VERIFIED"], payload: { skuId: "SKU-1", lot: "FAB-01", cases: 12, expiry: "2026-11-18", acquisitionSeconds: 2 } },
    { id: "READ-1", jobId: "AUTO-1", checkpoint: "UNLOAD", observedAt: "2026-10-18T14:01:00Z", decision: "PASS", payload: { vehicleRestrained: true, levelerReady: true, transferAreaClear: true, supportedLoad: true } },
  ];
  const html = await render(snapshot);
  assert.equal((html.match(/class="autonomy-evidence-card /g) || []).length, 2);
  assert.ok(html.indexOf("Descarga segura") < html.indexOf("Identificación de la carga"));
  assert.doesNotMatch(html, /<pre|vehicleRestrained|acquisitionSeconds|"skuId"|\[object Object\]/);
  assert.doesNotMatch(html, /Inspección de entrada|Recepción en tienda/);
  assert.match(html, /12 cajas/);
  assert.match(html, /Referencias del registro/);
});

test("retention has a human cause and a permission-bound reevaluation action", async () => {
  const snapshot = base();
  Object.assign(snapshot.autonomy.jobs[0], { state: "EXCEPTION", exceptionId: "EX-1", waitingReason: "Proceso retenido: TEMPERATURE_HOLD. No se han aceptado existencias de esta carga." });
  snapshot.autonomy.exceptions = [{ id: "EX-1", code: "TEMPERATURE_HOLD", message: "Proceso retenido: TEMPERATURE_HOLD." }];
  let html = await render(snapshot);
  assert.match(html, /Temperatura fuera de rango/);
  assert.match(html, /Revisa la conservación/);
  assert.doesNotMatch(html, /data-autonomy="retry"/);
  assert.match(html, /Operaciones debe revisar la causa/);
  html = await render(snapshot, ["autonomy.exception.resolve"]);
  assert.match(html, /data-autonomy="retry"/);
  assert.doesNotMatch(html, /Proceso retenido: TEMPERATURE_HOLD/);
});

test("evidence text is escaped and incomplete historical dates cannot break a dossier", async () => {
  const snapshot = base();
  snapshot.autonomy.jobs[0].createdAt = "bad-date";
  snapshot.autonomy.jobs[0].retryHistory = [{ at: null, reason: '<script>alert("bad")</script>' }];
  snapshot.autonomy.notices[0].loads[0].lot = '<img src=x onerror="bad">';
  snapshot.autonomy.evidence = [{ id: "READ-1", jobId: "AUTO-1", checkpoint: "AUTO_ID", observedAt: "bad-date", decision: "PENDING", payload: { lot: '<img src=x onerror="bad">' } }];
  const html = await render(snapshot);
  assert.doesNotMatch(html, /<script>|<img src=x/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /Pendiente de validar/);
  assert.match(html, /Sin lectura/);
});

test("dossier distinguishes the few damaged cartons from the rest of the supplier pallet", async () => {
  const { describeAutonomyEvidence } = await library;
  const evidence = { checkpoint: "PIE", payload: { visualDefect: "TORN_BAG", damagedCases: 2, cases: 12 } };
  const facts = describeAutonomyEvidence(evidence, base()).facts;
  assert.equal(facts.find(fact => fact.label === "Defecto detectado por cámaras").value, "Bolsa o envoltura rasgada");
  assert.equal(facts.find(fact => fact.label === "Cajas con daño").value, "2 de 12");
  assert.equal(facts.find(fact => fact.label === "Separación").value, "10 a almacenamiento · 2 a cuarentena");
});
