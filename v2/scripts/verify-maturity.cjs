"use strict";
// Disposable integration environment: no personal SQLite database and no SMTP.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const outputDir = process.env.DONPEPE_MATURITY_QA_OUTPUT || "/tmp/donpepe-maturity-qa";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-maturity-fixture-"));
const checks = [], errors = [], mail = [], screenshots = [], layoutFailures = [];
let runtime, server, browser, base;
function record(message) { checks.push(message); process.stdout.write(`${message}\n`); }
const snapshot = () => runtime.simulation.snapshot({ id: "qa-reader", role: "admin" });
function advanceUntil(predicate, max = 2400) { for (let i = 0; i <= max; i += 5) { if (predicate(snapshot())) return; runtime.simulation.advance(5); } throw Error("La operación no terminó dentro del tiempo de escenario."); }
async function api(context, url, body, method = body === undefined ? "GET" : "POST") {
  const me = !["GET", "HEAD"].includes(method) && !["/api/login", "/api/password-recovery", "/api/password-reset"].includes(url) ? await context.request.get(`${base}/api/me`) : null;
  const csrf = me?.ok() ? (await me.json()).csrf : undefined;
  const result = await context.request.fetch(`${base}${url}`, { method, ...(body === undefined ? {} : { data: body }), headers: csrf ? { "x-csrf-token": csrf } : {} });
  return { status: result.status(), body: await result.json() };
}
async function settled(page) {
  await page.locator("#main .page-heading").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(120);
}
async function navigate(page, view) {
  await page.bringToFront();
  if (new URL(page.url()).hash === `#${view}`) await page.reload();
  else await page.evaluate(target => { location.hash = target; }, view);
  await page.waitForFunction(target => document.body.dataset.view === target, view);
  await page.waitForFunction(() => !document.querySelector("#main .loading-screen"));
  await settled(page);
}
async function layout(page, name) {
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  if (await page.locator("#map-host canvas").count()) await page.locator('#map-host[data-scene-ready="true"]').waitFor();
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  if (!(sizes.document <= sizes.viewport + 2 && sizes.body <= sizes.viewport + 2)) {
    const elements = await page.evaluate(() => [...document.querySelectorAll("#main *")].map(el => ({ tag: el.tagName, cls: el.className, width: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right) })).filter(el => el.right > innerWidth + 5).slice(0, 12));
    layoutFailures.push({ name, sizes, elements }); process.stdout.write(`DESBORDAMIENTO ${name}: ${JSON.stringify({ sizes, elements })}\n`);
  }
  const filename = path.join(outputDir, `${name}.png`); await page.screenshot({ path: filename, fullPage: true, animations: "disabled" }); screenshots.push(filename);
  record(`${name}: vista comprobada`);
}
async function login(context, profile, password = "DonPepe2026!") {
  const page = await context.newPage();
  page.on("pageerror", error => errors.push({ profile, message: error.message }));
  await page.goto(`${base}/login`); await page.locator('[name="email"]').fill(profile.includes("@") ? profile : `${profile}@donpepe.local`); await page.locator('[name="password"]').fill(password);
  const pending = page.waitForResponse(r => r.url().endsWith("/api/login") && r.request().method() === "POST"); await page.locator('#login-form [type="submit"]').click();
  assert.equal((await pending).status(), 200); await page.waitForURL(`${base}/`); await settled(page); return page;
}
async function responseClick(page, locator, endpoint, predicate) {
  const pending = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() !== "GET" && (!predicate || predicate(r.request().postDataJSON())));
  await locator.click(); const response = await pending; return { status: response.status(), body: await response.json() };
}
async function commandClick(page, locator, type) {
  const response = await responseClick(page, locator, "/api/commands", body => body.type === type);
  assert.equal(response.status, 200, `${type}: ${JSON.stringify(response.body)}`); return response.body.result;
}
async function closeDialog(page) { if (await page.locator("#dialog[open]").count()) await page.locator("#dialog-close").click(); }
async function documentLine(page, skuId, cases) { await page.locator("#line-sku").selectOption(skuId); await page.locator("#line-quantity").fill(String(cases)); await page.locator("#add-line").click(); }
async function formFill(page, values, form = "#govern-form") { for (const [name, value] of Object.entries(values)) { const field = page.locator(`${form} [name="${name}"]`); if (await field.evaluate(el => el.tagName === "SELECT")) await field.selectOption(String(value)); else await field.fill(String(value)); } }
async function rolesAndCatalog(page, context) {
  await navigate(page, "roles");
  const roleBefore = await api(context, "/api/roles"); assert.equal(roleBefore.status, 200);
  const toggle = page.locator('[data-role-permission="operations"][value="simulation.speed"]'); await toggle.uncheck();
  const updated = await responseClick(page, page.locator('[data-govern="save-role"][data-id="operations"]'), "/api/roles/operations"); assert.equal(updated.status, 200);
  assert(!(await api(context, "/api/roles")).body.roles.find(r => r.id === "operations").permissions.includes("simulation.speed"));
  await toggle.check(); assert.equal((await responseClick(page, page.locator('[data-govern="save-role"][data-id="operations"]'), "/api/roles/operations")).status, 200);
  const stale = await api(context, "/api/roles/operations", { permissions: roleBefore.body.roles.find(r => r.id === "operations").permissions, expectedRevision: roleBefore.body.revision }, "PUT"); assert.equal(stale.status, 409);
  record("Permisos: edición UI persiste, restauración y revisión obsoleta rechazada");
  await navigate(page, "catalog"); await page.locator('[data-govern="new-catalog"]').click();
  await formFill(page, { code: "QA-MATURE", name: "Avena QA 500 g", brand: "Marca QA", category: "Abarrotes", presentation: "Bolsa de 500 g", zoneId: "DRY", supplierId: "PROV-1", unitsPerCase: 12, maxCasesPerHu: 24 });
  const result = await commandClick(page, page.locator('#govern-form button[type="submit"], #govern-form .dialog-actions button').last(), "config.sku.create");
  assert(snapshot().catalog.skus.some(s => s.id === result.id && s.code === "QA-MATURE")); await page.locator("#dialog").waitFor({ state: "hidden" });
  await page.locator('[data-govern="deactivate-catalog"][data-id="SKU-ARROZ"]').click();
  const denied = await responseClick(page, page.locator('#govern-form .dialog-actions button').last(), "/api/commands", b => b.type === "config.sku.deactivate"); assert.equal(denied.status, 409); await page.locator("#govern-error").filter({ hasText: "existencias" }).waitFor(); await closeDialog(page);
  record("Catálogo: SKU creado desde formulario y desactivación con referencias rechazada");
  await navigate(page, "settings"); const old = (await api(context, "/api/settings")).body;
  await page.locator('#settings-form [name="maxOrderCases"]').fill("110");
  await commandClick(page, page.locator("#settings-form button"), "config.settings.update"); assert.equal(snapshot().configuration.settings.maxOrderCases, 110);
  const staleSettings = await api(context, "/api/settings", { expectedRevision: old.revision, settings: { maxOrderCases: 100 } }, "PATCH"); assert.equal(staleSettings.status, 409);
  await navigate(page, "settings"); await page.locator('#settings-form [name="maxOrderCases"]').fill("120"); await commandClick(page, page.locator("#settings-form button"), "config.settings.update");
  record("Reglas: guardado UI, capacidad física y concurrencia protegida");
}
async function userCrud(page, context) {
  await navigate(page, "users"); await page.locator('[data-govern="new-user"]').click();
  await formFill(page, { name: "Persona QA temporal", email: "madurez@donpepe.local", role: "store", branchId: "TIENDA-2", password: "Madurez2026!Seguro" });
  const response = await responseClick(page, page.locator("#govern-form .dialog-actions button").last(), "/api/users"); assert.equal(response.status, 201); const id = response.body.user.id;
  await page.locator("#dialog").waitFor({ state: "hidden" }); await page.locator(`[data-govern="edit-user"][data-id="${id}"]`).click();
  await page.locator('#govern-form [name="name"]').fill("Persona QA actualizada"); assert.equal((await responseClick(page, page.locator("#govern-form .dialog-actions button").last(), `/api/users/${id}`)).status, 200);
  await page.locator("#dialog").waitFor({ state: "hidden" }); await page.locator(`[data-govern="user-status"][data-id="${id}"]`).click(); assert.equal((await responseClick(page, page.locator("#govern-form .dialog-actions button").last(), `/api/users/${id}/status`)).status, 200);
  await page.locator("#dialog").waitFor({ state: "hidden" }); await page.locator(`[data-govern="delete-user"][data-id="${id}"]`).click(); assert.equal((await responseClick(page, page.locator("#govern-form .dialog-actions button").last(), `/api/users/${id}`)).status, 200);
  assert(!(await api(context, "/api/users")).body.users.some(u => u.id === id)); await page.locator("#dialog").waitFor({ state: "hidden" });
  record("Cuentas: crear, editar, desactivar y eliminar desde UI sin borrar historial");
}
function mailUrl(kind) { const item = [...mail].reverse().find(m => kind === "verification" ? m.subject.includes("Confirma") : m.subject.includes("Recupera")); assert(item, `Correo capturado ${kind}`); return item.text.match(/https?:\/\/[^\s]+/)[0]; }
async function recoveryFlow(opsPage, adminPage, adminContext) {
  await opsPage.locator("#user-menu").click(); await opsPage.locator('[data-action="profile"]').click();
  await opsPage.locator("#profile-mail-form").waitFor(); await opsPage.waitForTimeout(150);
  await opsPage.locator('#profile-mail-form [name="email"]').fill("qa.personal.propietario@gmail.com"); await opsPage.locator('#profile-mail-form [name="currentPassword"]').fill("DonPepe2026!");
  assert.equal((await responseClick(opsPage, opsPage.locator("#profile-mail-form button"), "/api/profile/recovery-email")).status, 200);
  assert.equal(mail.at(-1).to, "qa.personal.propietario@gmail.com"); await closeDialog(opsPage);
  const verificationContext = await browser.newContext({ viewport: { width: 390, height: 844 } }); const verifyPage = await verificationContext.newPage(); verifyPage.on("pageerror", e => errors.push({ profile: "verification", message: e.message }));
  const verification = mailUrl("verification"); await verifyPage.goto(verification); await verifyPage.locator("h1").filter({ hasText: "Confirma tu Gmail" }).waitFor(); await layout(verifyPage, "gmail-verification-390");
  assert.equal((await responseClick(verifyPage, verifyPage.locator("#login-form button"), "/api/recovery-email/verify")).status, 200); await verifyPage.locator("h1").filter({ hasText: "Gmail verificado" }).waitFor();
  record("Mi cuenta: Gmail propio verificado mediante enlace capturado, sin envío real");
  await verifyPage.goto(`${base}/forgot-password`); await verifyPage.locator('#login-form [name="email"]').fill("operaciones@donpepe.local");
  const requested = await responseClick(verifyPage, verifyPage.locator("#login-form button"), "/api/password-recovery"); assert.equal(requested.status, 200); await verifyPage.locator("h1").filter({ hasText: "Solicitud recibida" }).waitFor(); await layout(verifyPage, "recovery-requested-390");
  const unknown = await api(verificationContext, "/api/password-recovery", { email: "no-existe@donpepe.local" }); assert.equal(unknown.body.message, requested.body.message);
  await navigate(adminPage, "recoveries"); const requests = (await api(adminContext, "/api/recoveries")).body.requests; const pending = requests.find(r => r.email === "operaciones@donpepe.local" && r.status === "PENDING"); assert(pending);
  await adminPage.locator(`[data-govern="approve-recovery"][data-id="${pending.id}"]`).click(); assert.equal((await responseClick(adminPage, adminPage.locator("#govern-form .dialog-actions button").last(), `/api/recoveries/${pending.id}/approve`)).status, 200);
  const reset = mailUrl("reset"); assert.equal(mail.at(-1).to, "qa.personal.propietario@gmail.com"); assert(!(await api(adminContext, "/api/recoveries")).body.requests.some(r => Object.keys(r).some(k => /token|url/i.test(k))));
  await verifyPage.goto(reset); await verifyPage.locator('h1').filter({ hasText: "Crea una nueva contraseña" }).waitFor(); await layout(verifyPage, "password-reset-390");
  await verifyPage.locator('[name="password"]').fill("DonPepe2026!"); await verifyPage.locator('[name="confirmation"]').fill("DonPepe2026!"); assert.equal((await responseClick(verifyPage, verifyPage.locator("#login-form button"), "/api/password-reset")).status, 422);
  await verifyPage.locator('[name="password"]').fill("NuevaMadurez2026!"); await verifyPage.locator('[name="confirmation"]').fill("NuevaMadurez2026!"); assert.equal((await responseClick(verifyPage, verifyPage.locator("#login-form button"), "/api/password-reset")).status, 200);
  await verifyPage.goto(reset); await verifyPage.locator("h1").filter({ hasText: "Este enlace no está disponible" }).waitFor(); await layout(verifyPage, "password-reset-reused-390");
  const revoked = await api(opsPage.context(), "/api/me"); assert.equal(revoked.status, 401);
  await verificationContext.close(); record("Recuperación: solicitud genérica, aprobación admin, correo personal, contraseña anterior rechazada, enlace de un uso y sesiones revocadas");
}
async function operationsFlow(page, storePage) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await navigate(page, "purchases"); await page.locator('[data-action="new-purchase"]').first().click(); await page.locator("#document-destination").selectOption("PROV-1"); await documentLine(page, "SKU-ARROZ", 6);
  const purchase = await commandClick(page, page.locator("#document-submit"), "purchase.create"); await page.locator("#dialog").waitFor({ state: "hidden" });
  await commandClick(page, page.locator(`[data-action="arrive-purchase"][data-id="${purchase.id}"]`), "purchase.arrive"); await page.locator(`[data-action="receive-purchase"][data-id="${purchase.id}"]`).click();
  await page.locator('[name="accepted-0"]').fill("4"); await page.locator('[name="quarantine-0"]').fill("2"); await page.locator('[name="lot-0"]').fill("QA-MADUREZ-LOTE"); await page.locator('[name="expiry-0"]').fill("2027-06-01");
  await commandClick(page, page.locator("#receipt-form .dialog-actions button").last(), "purchase.receive"); advanceUntil(s => s.hus.filter(h => h.purchaseId === purchase.id && h.state !== "QUARANTINE").every(h => h.state === "STORED"));
  await page.reload(); await settled(page); await navigate(page, "incidents"); const held = snapshot().hus.find(h => h.purchaseId === purchase.id && h.state === "QUARANTINE");
  await page.locator(`[data-action="release-quarantine"][data-id="${held.id}"]`).click(); await page.locator('#quality-form [name="note"]').fill("Inspección física y vida útil conformes"); await commandClick(page, page.locator("#quality-form button"), "inventory.releaseQuarantine"); advanceUntil(s => s.hus.find(h => h.id === held.id).state === "STORED");
  await page.reload(); await settled(page); await navigate(page, "orders"); assert.equal(await page.locator('[data-action="new-order"]').count(), 0, "Operaciones atiende solicitudes y no crea pedidos de tienda");
  await storePage.reload(); await settled(storePage); await navigate(storePage, "orders"); await storePage.locator('[data-action="new-order"]').first().click();
  assert.equal(await storePage.locator("#document-destination option").count(), 1); assert.equal(await storePage.locator("#document-destination").inputValue(), "TIENDA-1");
  await documentLine(storePage, "SKU-ARROZ", 4); await documentLine(storePage, "SKU-YOGUR", 2);
  const order = await commandClick(storePage, storePage.locator("#document-submit"), "order.create"); await storePage.locator("#dialog").waitFor({ state: "hidden" });
  assert.equal(snapshot().orders.find(item => item.id === order.id).source, "STORE");
  await page.reload(); await settled(page); await navigate(page, "orders"); await page.locator(`[data-action="open-order"][data-id="${order.id}"]`).click(); await commandClick(page, page.locator(`[data-action="release-order"][data-id="${order.id}"]`), "order.release");
  advanceUntil(s => s.orders.find(o => o.id === order.id).state === "READY"); await page.reload(); await settled(page); await navigate(page, "orders"); await page.locator(`[data-action="open-order"][data-id="${order.id}"]`).click();
  const storeBeforeDispatch = snapshot().storeStock.reduce((n,r) => n+r.cases,0);
  await commandClick(page, page.locator(`[data-action="dispatch-order"][data-id="${order.id}"]`), "order.dispatch");
  const afterDispatch = snapshot(), loadingOrder = afterDispatch.orders.find(o => o.id === order.id), shipmentIds = new Set(loadingOrder.allocations.map(a => a.huId));
  assert(!["DISPATCHED","ARRIVED","RECEIVED"].includes(loadingOrder.state),"Autorizar no teletransporta cargas al camión ni inicia el viaje antes de cargar");
  assert(afterDispatch.hus.some(h => shipmentIds.has(h.id) && h.locationId !== loadingOrder.truckId),"Las cargas esperan su transferencia física desde expedición");
  assert.equal(afterDispatch.storeStock.reduce((n,r) => n+r.cases,0),storeBeforeDispatch,"La autorización y carga no crean stock en tienda");
  advanceUntil(s => s.orders.find(o => o.id === order.id).state === "ARRIVED", 1200);
  record("Despacho secuencial: autorización separada de posicionamiento, carga física y viaje");
  await storePage.reload(); await settled(storePage); await navigate(storePage, "orders"); await storePage.locator(`[data-action="open-order"][data-id="${order.id}"]`).click(); await storePage.locator(`[data-action="receive-order"][data-id="${order.id}"]`).click(); await commandClick(storePage, storePage.locator("#store-receipt .dialog-actions button"), "order.receive");
  assert.equal(snapshot().orders.find(o => o.id === order.id).state, "RECEIVED"); assert.equal(snapshot().storeStock.filter(s => s.orderId === order.id).reduce((n, s) => n + s.cases, 0), 6);
  record("Flujo completo UI: compra, recepción parcial, liberación de calidad, preparación automática, despacho y recepción propia en tienda");
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({ dataDir, startClock: false, mailEnv: {}, mailTransport: { async sendMail(message) { mail.push(message); return { accepted: [message.to] }; }, close() {} } });
  server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
  const contexts = await Promise.all(["admin", "operations", "store"].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })));
  const [adminContext, opsContext, storeContext] = contexts;
  const [adminPage, opsPage, storePage] = await Promise.all([login(adminContext, "admin"), login(opsContext, "operaciones"), login(storeContext, "tienda")]);
  for (const [page, role, views] of [[adminPage, "admin", ["summary", "users", "roles", "catalog", "settings", "recoveries", "audit"]], [opsPage, "operations", ["overview", "orders", "purchases", "inventory", "equipment", "stores", "analytics", "incidents"]], [storePage, "store", ["overview", "orders", "inventory", "stores"]]]) {
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); for (const view of views) { await navigate(page, view); await layout(page, `${role}-${view}-${width}`); assert.equal(await page.locator("#map-host").count(), role === "operations" && view === "overview" ? 1 : 0, `${role}/${view}: mapa reservado a operaciones`); } }
  }
  await opsPage.setViewportSize({ width: 1440, height: 1000 }); await navigate(opsPage, "overview");
  assert.equal(await opsPage.locator("#sidebar").evaluate(el => getComputedStyle(el).display), "none"); const mapBox = await opsPage.locator("#map-host").boundingBox(); assert(mapBox.width / 1440 > .9);
  for (const view of ["interior", "aisle", "network", "overview"]) { await opsPage.locator(`[data-camera="${view}"]`).click(); await opsPage.waitForTimeout(350); assert(await opsPage.locator(`[data-camera="${view}"]`).evaluate(el => el.classList.contains("active"))); }
  await opsPage.locator("#map-find").fill("AMR 1"); await opsPage.locator('#map-results [data-inspect="robot"]').first().click(); await opsPage.locator("#map-inspector:not([hidden]) h2").waitFor(); await layout(opsPage, "map-inspector-1440");
  record("Operaciones: sin sidebar, mapa superior al 90% del ancho, cuatro perspectivas y búsqueda sincronizada con inspector");
  await adminPage.setViewportSize({ width: 1440, height: 1000 }); await rolesAndCatalog(adminPage, adminContext); await userCrud(adminPage, adminContext);
  await operationsFlow(opsPage, storePage);
  await recoveryFlow(opsPage, adminPage, adminContext);
  assert.equal(errors.length, 0, `Errores de ejecución: ${JSON.stringify(errors)}`); record("Cero errores JavaScript de nivel superior");
  assert.equal(layoutFailures.length, 0, `Desbordamientos: ${layoutFailures.map(f => f.name).join(", ")}`);
  await Promise.all(contexts.map(context => context.close()));
}
(async () => {
  let failure;
  try { await main(); } catch (error) {
    failure = error; process.stderr.write(`${error.stack}\n`);
    for (const [i, page] of (browser?.contexts().flatMap(c => c.pages()) || []).entries()) {
      try { await page.screenshot({ path: path.join(outputDir, `failure-${i}.png`), fullPage: true, animations: "disabled", timeout: 10000 }); } catch {}
    }
  }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (runtime) runtime.close();
    const report = { ok: !failure && !layoutFailures.length, checks, errors, layoutFailures, screenshots, mail: { simulated: true, captured: mail.length }, failure: failure?.message || null };
    fs.mkdirSync(outputDir, { recursive: true }); fs.writeFileSync(path.join(outputDir, "report.json"), JSON.stringify(report, null, 2));
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.stdout.write(`Resultado: ${checks.length} comprobaciones; ${screenshots.length} capturas; ${errors.length} errores JS. ${path.join(outputDir, "report.json")}\n`);
    if (failure) process.exitCode = 1;
  }
})();
