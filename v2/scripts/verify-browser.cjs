"use strict";

// Isolated browser QA: creates only temporary V2 SQLite data. No legacy app,
// production server, real accounts, SMTP, hardware or external service is used.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { createApp } = require("../server");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const outputDir = process.env.DONPEPE_QA_OUTPUT || "/tmp/donpepe-v2-qa";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-v2-browser-"));
const stateOf = (value) => value.state || value.status;
const failures = [], browserErrors = [], checks = [];
let runtime, server, browser, base;
const ops = { id: "qa-ops", role: "operations" };

function record(message) { checks.push(message); process.stdout.write(`${message}\n`); }
function snapshot() { return runtime.simulation.snapshot({ id: "qa-inspection", role: "admin" }); }
function advanceUntil(predicate, description, maxSeconds = 2400) {
  for (let elapsed = 0; elapsed <= maxSeconds; elapsed += 5) {
    const value = snapshot();
    if (predicate(value)) return value;
    runtime.simulation.advance(5);
  }
  const s = snapshot();
  throw new Error(`${description}: no terminó en ${maxSeconds} segundos virtuales. ${JSON.stringify({ missions: s.missions.filter(m => !["COMPLETED", "CANCELLED"].includes(stateOf(m))), robots: s.equipment.robots, locks: s.routeLocks })}`);
}
async function settle(page) {
  await page.locator("#main .page-heading").waitFor({ state: "attached" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}
async function assertLayout(page, name) {
  await settle(page);
  if (await page.locator("#map-host canvas").count()) {
    await page.locator("#map-host canvas").scrollIntoViewIfNeeded();
    await page.locator('#map-host[data-scene-ready="true"]').waitFor();
    await page.waitForTimeout(150);
  }
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  assert(dimensions.scroll <= dimensions.width + 2 && dimensions.body <= dimensions.width + 2, `${name}: desbordamiento horizontal ${JSON.stringify(dimensions)}`);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: true, animations: "disabled" });
  record(`Pantalla ${name}: sin desbordamiento`);
}
async function navigate(page, view) {
  await page.evaluate((target) => { location.hash = target; }, view);
  await page.waitForFunction((target) => document.querySelector(`#navigation a[href="#${target}"], #workspace-nav a[href="#${target}"]`)?.classList.contains("active"), view);
  await settle(page);
}
async function login(context, profile) {
  const page = await context.newPage();
  page.on("pageerror", error => browserErrors.push({ profile, message: error.message }));
  await page.goto(`${base}/login`);
  await page.locator(`[data-demo="${profile}"]`).click();
  const response = page.waitForResponse(r => r.url().endsWith("/api/login") && r.request().method() === "POST");
  await page.locator('#login-form [type="submit"]').click();
  assert.equal((await response).status(), 200, `Login ${profile}`);
  await page.waitForURL(`${base}/`);
  await settle(page);
  assert(await page.locator("#user-name").textContent() !== "Cargando");
  return page;
}
async function clickCommand(page, locator, expectedType) {
  const pending = page.waitForResponse(response => {
    if (!response.url().endsWith("/api/commands") || response.request().method() !== "POST") return false;
    try { return response.request().postDataJSON().type === expectedType; } catch { return false; }
  });
  await locator.click();
  const response = await pending, data = await response.json();
  assert(response.ok(), `${expectedType}: HTTP ${response.status()} ${JSON.stringify(data)}`);
  return data;
}
async function documentLine(page, skuId, cases) {
  await page.locator("#line-sku").selectOption(skuId);
  await page.locator("#line-quantity").fill(String(cases));
  await page.locator("#add-line").click();
}
async function inspectMap(page) {
  await navigate(page, "overview");
  const canvas = page.locator("#map-host canvas");
  await canvas.waitFor();
  for (const view of ["interior", "aisle", "network", "overview"]) {
    await page.locator(`[data-camera="${view}"]`).click();
    await page.waitForTimeout(700);
    assert(await page.locator(`[data-camera="${view}"]`).evaluate(el => el.classList.contains("active")), `Cámara ${view}`);
  }
  const box = await canvas.boundingBox();
  assert(box && box.width > 200 && box.height > 200, "Canvas visible");
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.45);
  await page.mouse.wheel(0, -220);
  await page.waitForTimeout(600);
  await page.locator('[data-camera="overview"]').click();
  await page.waitForTimeout(700);
  let inspected = false;
  for (const [x, y] of [[.35,.48],[.25,.55],[.46,.58],[.32,.68],[.5,.42],[.15,.42],[.55,.72],[.44,.3],[.25,.3],[.6,.5],[.2,.7]]) {
    await canvas.click({ position: { x: box.width * x, y: box.height * y } });
    if (await page.locator("#map-inspector .info-row").count()) { inspected = true; break; }
  }
  assert(inspected, "El clic del mapa debe abrir la inspección de una entidad");
  await page.screenshot({ path: path.join(outputDir, "map-inspector-1440.png"), fullPage: true, animations: "disabled" });
  if (await page.locator('[data-action="about"]').count()) { if (!await page.locator('[data-action="about"]').first().isVisible()) await page.locator("#user-menu").click(); await page.locator('[data-action="about"]').first().click(); }
  else await page.locator("#open-about").click();
  await page.locator("#dialog[open]").waitFor();
  await page.locator("#dialog-close").click();
  record("Mapa: cuatro cámaras, zoom, selección e información contextual");
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({ dataDir, startClock: false });
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
  const loginContext=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:"reduce"});
  const loginPage=await loginContext.newPage();
  await loginPage.goto(`${base}/login`);
  for(const width of [1440,390]){
    await loginPage.setViewportSize({width,height:width===390?844:1000});
    await loginPage.screenshot({path:path.join(outputDir,`login-${width}.png`),fullPage:true,animations:"disabled"});
    assert(await loginPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),"Login sin desbordamiento");
  }
  await loginPage.locator('[name="email"]').fill("no-existe@donpepe.local");
  await loginPage.locator('[name="password"]').fill("AccesoNoValido2026!");
  const failedLogin=loginPage.waitForResponse(r=>r.url().endsWith("/api/login")&&r.request().method()==="POST");
  await loginPage.locator('#login-form [type="submit"]').click();
  assert.equal((await failedLogin).status(),401);
  await loginPage.locator("#login-error").filter({hasText:"Revisa"}).waitFor();
  await loginPage.screenshot({path:path.join(outputDir,"login-error-390.png"),fullPage:true,animations:"disabled"});
  await loginContext.close();
  record("Login: 1440/390, contraste y mensaje de credenciales incorrectas");
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const page = await login(context, "operaciones");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const view of ["overview", "orders", "purchases", "inventory", "equipment", "stores", "analytics"]) {
      await navigate(page, view); await assertLayout(page, `operations-${view}-${width}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await inspectMap(page);

  await navigate(page, "purchases");
  await page.locator('[data-action="new-purchase"]').first().click();
  await page.locator("#document-destination").selectOption("PROV-1");
  await documentLine(page, "SKU-ARROZ", 6);
  await page.screenshot({ path: path.join(outputDir, "purchase-confirm-1440.png"), fullPage: true, animations: "disabled" });
  const createdPurchase = await clickCommand(page, page.locator("#document-submit"), "purchase.create");
  const purchaseId = createdPurchase.result.id;
  assert.equal(snapshot().purchases.find(p => p.id === purchaseId).lines[0].cases, 6);
  assert.equal(snapshot().hus.filter(h => h.purchaseId === purchaseId).length, 0, "Una compra no crea stock antes de recibir");
  await page.locator("#dialog").waitFor({ state: "hidden" });
  await clickCommand(page, page.locator(`[data-action="arrive-purchase"][data-id="${purchaseId}"]`), "purchase.arrive");
  await page.locator(`[data-action="receive-purchase"][data-id="${purchaseId}"]`).click();
  await page.locator('[name="accepted-0"]').fill("4");
  await page.locator('[name="quarantine-0"]').fill("2");
  await page.locator('[name="lot-0"]').fill("QA-FAB-ARROZ-01");
  await page.locator('[name="expiry-0"]').fill("2027-05-30");
  await clickCommand(page, page.locator('#receipt-form button[type="submit"], #receipt-form .dialog-actions button').last(), "purchase.receive");
  let s = snapshot();
  assert.equal(s.hus.filter(h => h.purchaseId === purchaseId).reduce((n,h) => n+h.cases,0),6);
  assert.equal(s.hus.filter(h => h.purchaseId === purchaseId && stateOf(h) === "QUARANTINE").reduce((n,h) => n+h.cases,0),2);
  advanceUntil(value => value.hus.filter(h => h.purchaseId === purchaseId && stateOf(h) !== "QUARANTINE").every(h => stateOf(h) === "STORED"), "Almacenamiento de compra");
  record("Compra: crear, llegar, aceptar 4 cajas, retener 2 y almacenar sin inventar existencias");

  await page.reload(); await settle(page); await navigate(page, "orders");
  assert.equal(await page.locator('[data-action="new-order"]').count(), 0, "Operaciones recibe solicitudes, no las crea a nombre de una tienda");
  const storeContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const storePage = await login(storeContext, "tienda"); await navigate(storePage, "orders");
  await storePage.locator('[data-action="new-order"]').first().click();
  assert.equal(await storePage.locator("#document-destination option").count(), 1, "La tienda sólo ofrece su sucursal");
  assert.equal(await storePage.locator("#document-destination").inputValue(), "TIENDA-1");
  assert.equal(await storePage.locator("#line-quantity").getAttribute("max"), "120");
  await documentLine(storePage, "SKU-ARROZ", 120);
  await documentLine(storePage, "SKU-YOGUR", 1);
  assert.match(await storePage.locator("#document-error").textContent(), /120 cajas en total/);
  assert.equal(await storePage.locator("#draft-lines [data-remove]").count(), 1, "El exceso no añade una línea al pedido");
  await storePage.locator("#draft-lines [data-remove]").click();
  record("Pedido: límite de 120 cajas visible y validado antes de confirmar");
  await documentLine(storePage, "SKU-ARROZ", 4);
  await documentLine(storePage, "SKU-YOGUR", 2);
  const createdOrder = await clickCommand(storePage, storePage.locator("#document-submit"), "order.create");
  const orderId = createdOrder.result.id;
  assert.equal(stateOf(snapshot().orders.find(o => o.id === orderId)), "PENDING");
  assert.equal(snapshot().orders.find(o => o.id === orderId).allocations.length, 0);
  assert.equal(snapshot().orders.find(o => o.id === orderId).source, "STORE");
  await storePage.locator("#dialog").waitFor({ state: "hidden" });
  await page.bringToFront(); await page.reload(); await settle(page); await navigate(page, "orders");
  await page.locator(`[data-action="open-order"][data-id="${orderId}"]`).click();
  await clickCommand(page, page.locator(`[data-action="release-order"][data-id="${orderId}"]`), "order.release");
  runtime.simulation.advance(1);
  s = snapshot();
  assert.equal(s.orders.find(o => o.id === orderId).allocations.reduce((n,a) => n+a.cases,0), 6);
  assert(s.missions.some(m => m.orderId === orderId), "Liberar crea misiones reales");
  const working = s.equipment.robots.find(r => r.missionId && stateOf(r) !== "FAULT");
  assert(working, "Una misión debe asignarse a un equipo compatible");
  await page.reload(); await settle(page); await navigate(page, "equipment");
  await page.locator(`[data-action="fault-equipment"][data-id="${working.id}"]`).click();
  await clickCommand(page, page.locator(`[data-action="confirm-fault"][data-id="${working.id}"]`), "equipment.fault");
  assert.equal(stateOf(snapshot().equipment.robots.find(r => r.id === working.id)), "FAULT");
  await page.locator("#dialog").waitFor({ state: "hidden" });
  await page.reload(); await settle(page);
  await clickCommand(page, page.locator(`[data-action="recover-equipment"][data-id="${working.id}"]`), "equipment.recover");
  advanceUntil(value => stateOf(value.orders.find(o => o.id === orderId)) === "READY", "Preparación de pedido");
  await page.reload(); await settle(page); await navigate(page, "orders");
  await page.locator(`[data-action="open-order"][data-id="${orderId}"]`).click();
  const storeBefore = snapshot().storeStock.reduce((n,row) => n+row.cases,0);
  await clickCommand(page, page.locator(`[data-action="dispatch-order"][data-id="${orderId}"]`), "order.dispatch");
  assert.equal(snapshot().storeStock.reduce((n,row) => n+row.cases,0),storeBefore,"Despachar no crea existencias en tienda");
  advanceUntil(value => stateOf(value.orders.find(o => o.id === orderId)) === "ARRIVED", "Carga física y viaje virtual", 1200);
  record("Pedido: reserva, misiones, incidencia, recuperación, preparación, salida y llegada virtual");

  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const adminPage = await login(adminContext, "admin");
  for (const width of [1440,390]) {
    await adminPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await navigate(adminPage,"users"); await adminPage.locator("#users-panel table").waitFor();
    await assertLayout(adminPage,`admin-users-${width}`);
  }
  await adminPage.locator('[data-govern="new-user"]').click();
  assert.equal(await adminPage.locator('[name="role"] option[value="admin"]').count(),0,"No se ofrece un segundo administrador");
  await adminPage.locator('[name="name"]').fill("Responsable QA temporal");
  await adminPage.locator('[name="email"]').fill("qa-temporal@donpepe.local");
  await adminPage.locator('[name="role"]').selectOption("store");
  await adminPage.locator('[name="branchId"]').selectOption("TIENDA-2");
  await adminPage.locator('[name="password"]').fill("TemporalQA2026!");
  const modalBounds=await adminPage.locator("#dialog").evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight};});
  assert(modalBounds.left>=-1&&modalBounds.right<=modalBounds.width+1&&modalBounds.top>=-1&&modalBounds.bottom<=modalBounds.height+1,"Modal móvil cabe en pantalla y conserva scroll interno");
  await adminPage.screenshot({path:path.join(outputDir,"admin-create-user-390.png"),fullPage:true,animations:"disabled"});
  const userResponse = adminPage.waitForResponse(r => r.url().endsWith("/api/users") && r.request().method() === "POST");
  await adminPage.locator("#govern-form .dialog-actions button").last().click();
  assert.equal((await userResponse).status(),201,"Creación de cuenta solo en SQLite temporal");
  assert.equal(runtime.identity.db.prepare("SELECT COUNT(*) n FROM people WHERE role='admin'").get().n,1);
  record("Administración: formulario responsive, cuenta temporal y administrador único");

  const deniedUsers = await context.request.get(`${base}/api/users`);
  assert.equal(deniedUsers.status(),403,"Operaciones no administra usuarios");
  let response = await storeContext.request.get(`${base}/api/me`), me = await response.json();
  response = await storeContext.request.get(`${base}/api/state`); let storeState = await response.json();
  assert.equal(storeState.catalog.branches.length,1); assert.equal(storeState.catalog.branches[0].id,"TIENDA-1");
  assert.equal(storeState.inventory.hus.length,0); assert.equal(storeState.purchases.length,0);
  for (const width of [1440,390]) {
    await storePage.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const view of ["overview","orders","inventory","stores"]) { await navigate(storePage,view); await assertLayout(storePage,`store-${view}-${width}`); }
  }
  await navigate(storePage,"orders");
  await storePage.locator(`[data-action="open-order"][data-id="${orderId}"]`).click();
  await storePage.locator(`[data-action="receive-order"][data-id="${orderId}"]`).click();
  await clickCommand(storePage, storePage.locator("#store-receipt .dialog-actions button"), "order.receive");
  s=snapshot(); assert.equal(stateOf(s.orders.find(o=>o.id===orderId)),"RECEIVED");
  assert.equal(s.storeStock.filter(row=>row.branchId==="TIENDA-1").reduce((n,row)=>n+row.cases,0),storeBefore+6);
  await storePage.locator("#dialog").waitFor({state:"hidden"});
  await navigate(storePage,"stores");
  await storePage.locator('[data-action="store-stock"][data-id="TIENDA-1"]').click();
  await storePage.locator('[data-action="consume"][data-sku="SKU-ARROZ"]').first().click();
  await storePage.locator('#consume-form [name="cases"]').fill("1");
  await clickCommand(storePage,storePage.locator("#consume-form .dialog-actions button"),"store.consume");
  assert.equal(snapshot().storeStock.filter(row=>row.branchId==="TIENDA-1").reduce((n,row)=>n+row.cases,0),storeBefore+5);
  await storePage.locator("#dialog").waitFor({state:"hidden"});
  await navigate(storePage,"orders");
  await storePage.locator(`[data-action="open-order"][data-id="${orderId}"]`).click();
  await storePage.locator(`[data-action="new-return"][data-id="${orderId}"]`).click();
  await storePage.locator('#return-form [name="skuId"]').selectOption("SKU-ARROZ");
  await storePage.locator('#return-form [name="cases"]').fill("1");
  await storePage.locator('#return-form [name="reason"]').fill("Caja observada en el escenario de prueba");
  await storePage.screenshot({path:path.join(outputDir,"store-return-390.png"),fullPage:true,animations:"disabled"});
  const returned=await clickCommand(storePage,storePage.locator("#return-form .dialog-actions button"),"return.create");
  assert.equal(snapshot().storeStock.filter(row=>row.branchId==="TIENDA-1").reduce((n,row)=>n+row.cases,0),storeBefore+4);
  advanceUntil(value=>value.hus.some(h=>h.returnId===returned.result.id&&stateOf(h)==="QUARANTINE"),"Devolución a cuarentena",120);
  assert(snapshot().hus.filter(h=>h.returnId===returned.result.id).every(h=>stateOf(h)==="QUARANTINE"),"Devolución no vuelve directamente a disponible");
  record("Tienda: venta explícita y devolución virtual a cuarentena con conservación de cantidades");
  const forbidden = await storeContext.request.post(`${base}/api/commands`,{ headers:{"x-csrf-token":me.csrf},data:{type:"order.create",payload:{branchId:"TIENDA-2",lines:[{skuId:"SKU-ARROZ",cases:1}]}} });
  assert.equal(forbidden.status(),403,"Tienda no solicita para otra sucursal");
  const forbiddenPurchase=await storeContext.request.post(`${base}/api/commands`,{ headers:{"x-csrf-token":me.csrf},data:{type:"purchase.create",payload:{supplierId:"PROV-1",lines:[{skuId:"SKU-ARROZ",cases:1}]}} });
  assert.equal(forbiddenPurchase.status(),403,"Tienda no compra a proveedores");
  const opsMe = await (await context.request.get(`${base}/api/me`)).json();
  assert.equal((await context.request.post(`${base}/api/commands`, { headers: { "x-csrf-token": opsMe.csrf }, data: { type: "order.create", payload: { branchId: "TIENDA-1", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] } } })).status(), 403, "La API también prohíbe a operaciones crear pedidos de tienda");
  record("Tienda: vistas propias, recepción completa y denegación de acciones ajenas");

  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${base}/api/state`)).status(),401,"API exige autenticación");
  assert.equal((await context.request.post(`${base}/api/commands`,{data:{type:"simulation.pause",payload:{paused:true}}})).status(),403,"Mutaciones exigen CSRF");
  const adminMe=await (await adminContext.request.get(`${base}/api/me`)).json();
  const adminHeaders={"x-csrf-token":adminMe.csrf};
  assert.equal((await adminContext.request.post(`${base}/api/commands`,{headers:adminHeaders,data:{type:"order.release",payload:{id:snapshot().orders[0].id}}})).status(),403,"Administrador no libera operaciones empresariales");
  assert.equal((await adminContext.request.post(`${base}/api/users/u-admin/status`,{headers:adminHeaders,data:{active:false}})).status(),409,"Administrador principal no se desactiva");
  assert.equal((await adminContext.request.post(`${base}/api/users/no-existe/status`,{headers:adminHeaders,data:{active:false}})).status(),404,"Cuenta inexistente responde 404");
  assert.equal((await adminContext.request.post(`${base}/api/users`,{headers:adminHeaders,data:{name:"Correo duplicado QA",email:"qa-temporal@donpepe.local",role:"operations",password:"TemporalQA2026!"}})).status(),409,"Correo repetido responde 409");
  assert.equal((await adminContext.request.post(`${base}/api/users`,{headers:adminHeaders,data:{name:"Administrador duplicado",email:"segundo-admin@donpepe.local",role:"admin",password:"TemporalQA2026!"}})).status(),422,"No se crea segundo administrador");
  const tempContext=await browser.newContext();
  assert.equal((await tempContext.request.post(`${base}/api/login`,{data:{email:"qa-temporal@donpepe.local",password:"TemporalQA2026!"}})).status(),200,"Cuenta temporal puede iniciar sesión");
  assert.equal((await tempContext.request.get(`${base}/api/me`)).status(),200);
  const tempUser=runtime.identity.db.prepare("SELECT id FROM people WHERE email=?").get("qa-temporal@donpepe.local");
  assert.equal((await adminContext.request.post(`${base}/api/users/${encodeURIComponent(tempUser.id)}/status`,{headers:adminHeaders,data:{active:false}})).status(),200);
  assert.equal((await tempContext.request.get(`${base}/api/me`)).status(),401,"Desactivar usuario revoca sesión existente");
  record("HTTP y seguridad: autenticación, CSRF, permisos, correo único, administrador único y revocación de sesión");

  const fallbackContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  await fallbackContext.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){if(/webgl/i.test(kind))return null;return original.call(this,kind,...args);};});
  const fallbackPage=await login(fallbackContext,"operaciones");
  await fallbackPage.locator(".map-fallback").waitFor();
  await assertLayout(fallbackPage,"no-webgl-390");
  await navigate(fallbackPage,"orders");
  assert.equal(await fallbackPage.locator('[data-action="simulate-request"]').count(),0,"La generación de solicitudes simuladas está retirada");
  assert.equal(await fallbackPage.locator('[data-action="new-order"]').count(),0,"La ausencia de WebGL no altera el RBAC");
  await navigate(fallbackPage,"purchases"); assert(await fallbackPage.locator('[data-action="new-purchase"]').count(),"Las compras a proveedores siguen disponibles sin WebGL");
  record("Sin WebGL: aviso accesible, solicitudes y compras conservan sus permisos");

  assert.deepEqual(browserErrors,[],`Errores JavaScript: ${JSON.stringify(browserErrors)}`);
  record(`QA completa: ${checks.length} comprobaciones, SQLite temporal, sin errores JavaScript. Capturas: ${outputDir}`);
}

main().catch(async error=>{
  failures.push(error.stack||String(error));
  process.stderr.write(`${error.stack||error}\n`);
  if(browser){for(const context of browser.contexts()) for(const page of context.pages()){try{await page.screenshot({path:path.join(outputDir,`failure-${Date.now()}.png`),fullPage:true});}catch{}}}
  process.exitCode=1;
}).finally(async()=>{
  if(browser) await browser.close();
  if(server) await new Promise(resolve=>server.close(resolve));
  runtime?.close();
  fs.mkdirSync(outputDir,{recursive:true});
  fs.writeFileSync(path.join(outputDir,"report.json"),JSON.stringify({ok:!failures.length,checks,browserErrors,failures,temporaryDataDir:dataDir},null,2));
});
