"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server");

// This fixture deliberately uses the production constructor. No manual-step or
// legacy-receiving compatibility switch is passed through the public API.
async function fixture(t) {
  const runtime = createApp({ identityFile: ":memory:", simulationFile: ":memory:", startClock: false, mailTransport: { sendMail: async () => ({}) } });
  const server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => { await new Promise(resolve => server.close(resolve)); runtime.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, { session, method = "GET", data, csrf = true } = {}) {
    const response = await fetch(base + path, { method, headers: { ...(data ? { "content-type": "application/json" } : {}), ...(session ? { cookie: session.cookie, ...(csrf ? { "x-csrf-token": session.csrf } : {}) } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  }
  async function login(email) {
    const response = await request("/api/login", { method: "POST", data: { email, password: "DonPepe2026!" } }); assert.equal(response.status, 200);
    const session = { cookie: response.cookie }, me = await request("/api/me", { session }); return { ...session, csrf: me.body.csrf, user: me.body.user };
  }
  const command = (session, type, payload) => request("/api/commands", { session, method: "POST", data: { type, payload } });
  return { runtime, request, login, command };
}

test("API de autonomía conserva sesión, CSRF y la separación administración/operaciones/tienda", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/state")).status, 401);
  const admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local"), store = await f.login("tienda@donpepe.local");
  const a = (await f.request("/api/state", { session: admin })).body;
  assert.ok(a.autonomy); assert.equal(a.autonomy.mode, "SIMULATED"); assert.equal(a.orders.length, 0); assert.equal(a.layout.locations.length, 0);
  const revision = a.configuration.revision;
  assert.equal((await f.command(ops, "config.autonomy.update", { expectedRevision: revision, settings: { unloadSeconds: 9 } })).status, 403);
  assert.equal((await f.command(store, "autonomy.authorize", { kind: "ORDER", id: "PED-00001" })).status, 403);
  assert.equal((await f.command(admin, "autonomy.authorize", { kind: "ORDER", id: "PED-00001" })).status, 403);
  assert.equal((await f.request("/api/commands", { session: ops, csrf: false, method: "POST", data: { type: "autonomy.authorize", payload: { kind: "ORDER", id: "PED-00001" } } })).status, 403);
  assert.equal((await f.command(admin, "config.autonomy.update", { expectedRevision: revision, settings: { unloadSeconds: 9, safetyDisabled: true } })).status, 422);
  const after = (await f.request("/api/state", { session: admin })).body;
  assert.equal(after.configuration.revision, revision);
  assert.equal((await f.request("/api/automation/events", { session: ops, method: "POST", data: { type: "QUALITY", decision: "PASS" } })).status, 404);
});

test("API de producción recibe por evidencia autónoma sin permitir forzar los antiguos pasos manuales", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local");
  const before = (await f.request("/api/state", { session: ops })).body, sku = before.catalog.skus.find(row => row.id === "SKU-ARROZ");
  const created = await f.command(ops, "purchase.create", { commandId: "autonomy-api-purchase", supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 3 }] });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const id = created.body.result.id, initial = created.body.state;
  assert.equal(initial.metrics.warehouseCases, before.metrics.warehouseCases);
  assert.equal(initial.autonomy.jobs.filter(row => row.kind === "PURCHASE" && row.documentId === id).length, 1);
  for (const [type, payload] of [
    ["purchase.arrive", { id }],
    ["purchase.inspect", { id, mode: "MANUAL", documentNumber: "NO-SENSOR" }],
    ["purchase.receive", { id, inspectionId: "NONEXISTENT", expectedPurchaseRevision: 1 }],
  ]) {
    const denied = await f.command(ops, type, payload); assert.equal(denied.status, 409, `${type}: ${JSON.stringify(denied.body)}`);
  }
  let state;
  for (let i = 0; i < 1200; i++) {
    f.runtime.simulation.advance(1);
    state = f.runtime.simulation.snapshot({ id: ops.user.id, role: "operations" });
    const job = state.autonomy.jobs.find(row => row.documentId === id && row.kind === "PURCHASE");
    if (job?.state === "COMPLETED") break;
  }
  const job = state.autonomy.jobs.find(row => row.documentId === id && row.kind === "PURCHASE");
  assert.equal(job.state, "COMPLETED", JSON.stringify(job));
  assert.equal(state.purchases.find(row => row.id === id).state, "RECEIVED");
  assert.equal(state.metrics.warehouseCases, before.metrics.warehouseCases + 3);
  const receipt = state.receipts.find(row => row.purchaseId === id); assert.ok(receipt); assert.ok(receipt.inspectionId);
  const evidence = state.autonomy.evidence.filter(row => row.jobId === job.id);
  assert.ok(evidence.some(row => row.type === "IDENTIFICATION")); assert.ok(evidence.some(row => row.type === "QUALITY"));
  assert.ok(evidence.every(row => row.source === "SIMULATED_DEVICE" && row.deviceId && row.observedAt));
  const ledger = await f.request("/api/inventory/movements?type=RECEIPT", { session: ops }); assert.equal(ledger.status, 200);
  const rows = ledger.body.items.filter(row => row.documentId === id); assert.equal(rows.reduce((sum, row) => sum + row.cases, 0), 3);
  const repeated = await f.command(ops, "purchase.create", { commandId: "autonomy-api-purchase", supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 3 }] });
  assert.equal(repeated.status, 200); assert.equal(repeated.body.result.id, id);
  assert.equal(repeated.body.state.autonomy.jobs.filter(row => row.documentId === id && row.kind === "PURCHASE").length, 1);
  assert.equal(repeated.body.state.metrics.warehouseCases, before.metrics.warehouseCases + 3);
});

test("políticas de admisión deshabilitadas bloquean procesos nuevos sin reservar ni crear documentos", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local");
  const initialAdmin = (await f.request("/api/state", { session: admin })).body;
  const disabled = await f.command(admin, "config.autonomy.update", { expectedRevision: initialAdmin.configuration.revision, settings: { enabled: false } });
  assert.equal(disabled.status, 200, JSON.stringify(disabled.body));
  const before = (await f.request("/api/state", { session: ops })).body, sku = before.catalog.skus.find(row => row.id === "SKU-ARROZ");
  assert.equal((await f.command(ops, "purchase.create", { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 3 }] })).status, 409);
  assert.equal((await f.command(ops, "order.release", { id: "PED-00001" })).status, 409);
  const after = (await f.request("/api/state", { session: ops })).body;
  assert.deepEqual(after.hus, before.hus); assert.deepEqual(after.orders, before.orders); assert.deepEqual(after.purchases, before.purchases); assert.deepEqual(after.missions, before.missions); assert.deepEqual(after.autonomy.jobs, before.autonomy.jobs);
  assert.equal((await f.command(admin, "config.autonomy.update", { expectedRevision: initialAdmin.configuration.revision, settings: { enabled: true } })).status, 409);
  const currentAdmin = (await f.request("/api/state", { session: admin })).body;
  const enabled = await f.command(admin, "config.autonomy.update", { expectedRevision: currentAdmin.configuration.revision, settings: { enabled: true, inboundEnabled: false, outboundEnabled: false } });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  assert.equal((await f.command(ops, "purchase.create", { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 3 }] })).status, 409);
  assert.equal((await f.command(ops, "order.release", { id: "PED-00001" })).status, 409);
});
