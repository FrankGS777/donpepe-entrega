"use strict";
// Local visual integration QA. Temporary accounts, no personal data, no SMTP.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const outputDir = process.env.DONPEPE_PREMIUM_QA_OUTPUT || "/tmp/donpepe-premium-qa";
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-premium-fixture-"));
const checks = [], errors = [], screenshots = [], problems = [], contrasts = [];
let runtime, server, browser, base;
function record(text) { checks.push(text); process.stdout.write(`${text}\n`); }
async function settle(page) { await page.locator("#main .page-heading").waitFor({ state: "attached" }); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(100); }
async function navigate(page, view) {
  await page.bringToFront();
  if (new URL(page.url()).hash === `#${view}`) await page.reload();
  else await page.evaluate(value => { location.hash = value; }, view);
  await page.waitForFunction(value => document.body.dataset.view === value && !document.querySelector("#main .loading-screen"), view); await settle(page);
}
async function screenshot(page, name) {
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  if (sizes.document > sizes.viewport + 2 || sizes.body > sizes.viewport + 2) problems.push({ name, type: "overflow", sizes });
  if (await page.locator("#map-host canvas").count()) await page.locator('#map-host[data-scene-ready="true"]').waitFor();
  const filename = path.join(outputDir, `${name}.png`); await page.screenshot({ path: filename, fullPage: true, animations: "disabled" }); screenshots.push(filename); record(`${name}: comprobado`);
  if (await page.locator("#map-host canvas").count()) {
    const bounds = await page.locator("#map-host canvas").boundingBox(), pixels = PNG.sync.read(fs.readFileSync(filename)), colors = new Set();
    if (bounds) for (let y=Math.max(0,Math.floor(bounds.y+bounds.height*.35));y<Math.min(pixels.height,bounds.y+bounds.height*.75);y+=5) for(let x=Math.max(0,Math.floor(bounds.x+bounds.width*.15));x<Math.min(pixels.width,bounds.x+bounds.width*.85);x+=5) { const i=(y*pixels.width+x)*4;colors.add(`${pixels.data[i]>>4},${pixels.data[i+1]>>4},${pixels.data[i+2]>>4}`); }
    if(colors.size<12){problems.push({name,type:"map-empty",colors:colors.size});process.stdout.write(`MAPA VACÍO ${name}: ${colors.size} colores centrales\n`);}
  }
}
async function theme(page, value) {
  await page.evaluate(t => window.DonPepeTheme.set(t), value); await page.waitForFunction(t => document.documentElement.dataset.theme === t, value);
  if (await page.locator("#map-host canvas").count()) await page.waitForFunction(t => document.querySelector("#map-host")?.dataset.theme === t, value);
  assert.equal(await page.locator("[data-theme-toggle]").getAttribute("aria-pressed"), value === "dark" ? "true" : "false");
}
async function login(context, name) {
  const page = await context.newPage(); page.on("pageerror", error => errors.push({ name, message: error.message }));
  await page.goto(`${base}/login`); await page.locator('[name="email"]').fill(`${name}@donpepe.local`); await page.locator('[name="password"]').fill("DonPepe2026!");
  const wait = page.waitForResponse(r => r.url().endsWith("/api/login") && r.request().method() === "POST"); await page.locator('#login-form button[type="submit"]').click(); assert.equal((await wait).status(), 200); await page.waitForURL(`${base}/`); await settle(page); return page;
}
async function responseClick(page, locator, endpoint) {
  const pending = page.waitForResponse(r => r.url().endsWith(endpoint) && r.request().method() !== "GET"); await locator.click(); const r = await pending; return { status: r.status(), body: await r.json() };
}
async function closeDialog(page) { if (await page.locator("#dialog[open]").count()) await page.locator("#dialog-close").click(); }
async function contrast(page, label, selector = "#dialog h2, #dialog h3, #dialog label, #dialog p, #dialog .btn, #dialog input:not([type=checkbox])") {
  const result = await page.evaluate(selector => {
    const parse = value => { const m = value.match(/^rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[, /]+/).map(Number); return [p[0], p[1], p[2], p[3] ?? 1]; };
    const over = (a, b) => [a[0] * a[3] + b[0] * (1-a[3]), a[1] * a[3] + b[1] * (1-a[3]), a[2] * a[3] + b[2] * (1-a[3]), 1];
    const lum = c => c.slice(0,3).map(v => { v /= 255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4; }).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0);
    const rows = [];
    for (const element of document.querySelectorAll(selector)) {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      if (rect.width <= 1 || rect.height <= 1 || style.display === "none" || style.opacity === "0" || element.disabled || !element.textContent.trim() && !["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) continue;
      let chain = [], parent = element; while (parent) { const computed = getComputedStyle(parent); let bg = parse(computed.backgroundColor); const gradient = computed.backgroundImage.startsWith("linear-gradient") ? computed.backgroundImage.match(/rgba?\([^)]+\)/)?.[0] : null; if (gradient) bg = parse(gradient) || bg; if (bg) chain.unshift(bg); parent = parent.parentElement; }
      let bg = chain.reduce((acc,c) => over(c,acc), [255,255,255,1]); const fg = parse(style.color); if (!fg) continue;
      const a = lum(over(fg,bg)), b = lum(bg), ratio = (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      const size = parseFloat(style.fontSize), weight = Number(style.fontWeight) || 400, minimum = size >= 24 || size >= 18.66 && weight >= 600 ? 3 : 4.5;
      rows.push({ tag: element.tagName, cls: element.className, text: element.textContent.trim().slice(0,60), ratio: Math.round(ratio*100)/100, minimum });
    }
    return rows;
  }, selector);
  contrasts.push({ label, rows: result });
  const failed = result.filter(r => r.ratio + .05 < r.minimum);
  if (failed.length) { problems.push({ name: label, type: "contrast", failed }); process.stdout.write(`CONTRASTE ${label}: ${JSON.stringify(failed)}\n`); }
}
async function publicThemes() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.on("pageerror", e => errors.push({ name: "login", message: e.message }));
  await page.goto(`${base}/login`); assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  const placement = await page.evaluate(() => { const nodes = [...document.head.children]; return { theme: nodes.findIndex(n => n.tagName === "SCRIPT" && n.src.endsWith("/theme.js")), css: nodes.findIndex(n => n.tagName === "LINK" && n.rel === "stylesheet") }; }); assert(placement.theme >= 0 && placement.theme < placement.css);
  for (const value of ["dark", "light"]) {
    await theme(page, value);
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await screenshot(page, `login-${value}-${width}`); await contrast(page, `login-${value}-${width}`, ".login-panel h1,.login-panel label,.login-panel input,.login-panel .btn"); }
  }
  await page.reload(); assert.equal(await page.evaluate(() => window.DonPepeTheme.get()), "light"); assert.equal(await page.evaluate(() => localStorage.getItem("donpepe.theme")), "light");
  const tab = await context.newPage(); await tab.goto(`${base}/forgot-password`); assert.equal(await tab.evaluate(() => document.documentElement.dataset.theme), "light");
  await page.locator("[data-theme-toggle]").click(); await tab.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  assert.equal(await page.locator("[data-theme-toggle]").getAttribute("aria-pressed"), "true");
  for (const value of ["dark", "light"]) { await theme(tab, value); await screenshot(tab, `forgot-password-${value}-1440`); await contrast(tab, `forgot-password-${value}`, ".login-panel h1,.login-panel label,.login-panel input,.login-panel .btn"); }
  await context.close(); record("Tema: dark inicial antes del CSS, persistencia, controles accesibles y sincronización entre pestañas");
}
function fixturePhoto(color) {
  const image = new PNG({ width: 240, height: 320 });
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) { const i = (y*image.width+x)*4; image.data[i] = Math.min(255,color[0]+Math.round(x/8)); image.data[i+1] = Math.min(255,color[1]+Math.round(y/9)); image.data[i+2] = color[2]; image.data[i+3] = 255; }
  return PNG.sync.write(image);
}
async function profile(page) { await closeDialog(page); await page.locator("#user-menu").click(); await page.locator('[data-action="profile"]').click(); await page.locator("#profile-avatar-form").waitFor(); }
async function avatarFlow(page) {
  await page.setViewportSize({ width: 1440, height: 1000 }); await profile(page);
  await page.locator("#profile-photo").setInputFiles({ name: "no-permitido.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>') });
  await page.locator("#profile-avatar-error").filter({ hasText: /JPEG|PNG|WebP|formato|JPG/i }).waitFor(); assert(await page.locator('#profile-avatar-form [type="submit"]').isDisabled());
  await page.locator("#profile-photo").setInputFiles({ name: "foto-qa.png", mimeType: "image/png", buffer: fixturePhoto([95, 60, 15]) });
  await page.locator('#profile-avatar-form [type="submit"]').waitFor({ state: "visible" }); await page.waitForFunction(() => !document.querySelector('#profile-avatar-form [type="submit"]').disabled);
  const first = await responseClick(page, page.locator('#profile-avatar-form [type="submit"]'), "/api/profile/avatar"); assert.equal(first.status, 200);
  await page.locator("#user-avatar img").waitFor(); const firstSrc = await page.locator("#user-avatar img").getAttribute("src");
  const box = await page.locator("#user-avatar").boundingBox(), imgBox = await page.locator("#user-avatar img").boundingBox(); assert(Math.abs(box.x-imgBox.x) <= 2 && Math.abs(box.y-imgBox.y) <= 2 && Math.abs(box.height-imgBox.height) <= 3, "La foto cubre el avatar, no queda debajo de la inicial");
  for (const value of ["dark", "light"]) {
    await theme(page, value);
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await screenshot(page, `profile-avatar-${value}-${width}`); await contrast(page, `profile-avatar-${value}-${width}`); }
  }
  await closeDialog(page); await page.reload(); await settle(page); await page.locator("#user-avatar img").waitFor(); assert.equal(await page.locator("#user-avatar img").getAttribute("src"), firstSrc);
  await profile(page); await page.locator("#profile-photo").setInputFiles({ name: "reemplazo-qa.png", mimeType: "image/png", buffer: fixturePhoto([20, 80, 125]) }); await page.waitForFunction(() => !document.querySelector('#profile-avatar-form [type="submit"]').disabled);
  assert.equal((await responseClick(page, page.locator('#profile-avatar-form [type="submit"]'), "/api/profile/avatar")).status, 200); await page.waitForFunction(old => document.querySelector("#user-avatar img")?.getAttribute("src") !== old, firstSrc);
  assert.equal((await responseClick(page, page.locator("#remove-avatar"), "/api/profile/avatar")).status, 200); await page.waitForFunction(() => !document.querySelector("#user-avatar img"));
  await closeDialog(page); record("Foto de perfil: formato inválido rechazado, recorte, alta, persistencia, sustitución, baja e inicial legible");
}
async function dialogs(adminPage, opsPage, storePage) {
  await navigate(opsPage, "orders"); assert.equal(await opsPage.locator('[data-action="new-order"]').count(), 0, "Operaciones recibe solicitudes y no suplanta a las tiendas");
  for (const value of ["dark", "light"]) {
    await theme(adminPage, value); await navigate(adminPage, "users"); await adminPage.locator('[data-govern="new-user"]').click();
    for (const width of [1440,390]) { await adminPage.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await screenshot(adminPage, `new-user-${value}-${width}`); await contrast(adminPage, `new-user-${value}-${width}`); } await closeDialog(adminPage);
    await theme(storePage, value); await navigate(storePage, "orders"); await storePage.locator('[data-action="new-order"]').first().click();
    for (const width of [1440,390]) { await storePage.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await screenshot(storePage, `new-order-${value}-${width}`); await contrast(storePage, `new-order-${value}-${width}`); } await closeDialog(storePage);
  }
  record("Modales: formularios de cuenta y pedido comprobados en ambos temas y tamaños");
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true }); runtime = createApp({ dataDir, startClock: false, mailEnv: {}, mailTransport: { async sendMail() { return { accepted: [] }; }, close() {} } }); server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage"] });
  await publicThemes();
  if (process.env.DONPEPE_PREMIUM_QA_ONLY === "public") { assert.equal(errors.length,0); assert.equal(problems.length,0,JSON.stringify(problems)); record("Acceso público: ambos temas, móvil, persistencia y contraste aprobados"); return; }
  const contexts = await Promise.all([1,2,3].map(() => browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })));
  const [adminPage, opsPage, storePage] = await Promise.all([login(contexts[0], "admin"),login(contexts[1], "operaciones"),login(contexts[2], "tienda")]);
  for (const [page, role, views] of [[adminPage,"admin",["summary","users","roles","catalog","settings","recoveries","audit"]],[opsPage,"operations",["overview","orders","purchases","inventory","equipment","stores","analytics","incidents"]],[storePage,"store",["overview","orders","inventory","stores"]]]) {
    for (const value of ["dark","light"]) { await theme(page,value); for (const width of [1440,390]) { await page.setViewportSize({ width,height:width===390?844:1000 }); for (const view of views) { await navigate(page,view); await screenshot(page,`${role}-${view}-${value}-${width}`); } } }
  }
  await opsPage.setViewportSize({ width:1440,height:1000 }); await navigate(opsPage,"overview"); await theme(opsPage,"dark");
  await opsPage.locator('#map-host[data-scene-ready="true"]').waitFor();
  await screenshot(opsPage,"map-first-load-dark-1440");
  const idleFrames = Number(await opsPage.locator("#map-host").getAttribute("data-rendered-frames"));
  await opsPage.waitForTimeout(5100);
  assert.equal(Number(await opsPage.locator("#map-host").getAttribute("data-rendered-frames")),idleFrames,"El mapa en reposo no mantiene un bucle innecesario de renderizado");
  await screenshot(opsPage,"map-idle-dark-1440");
  for(let i=0;i<3;i++){await opsPage.locator("#map-quality").selectOption("auto");await opsPage.locator('#map-host[data-scene-ready="true"]').waitFor();await screenshot(opsPage,`map-repeat-quality-${i}-dark-1440`);}
  assert.equal(await opsPage.locator("#map-find").evaluate(el=>getComputedStyle(el).borderWidth),"0px","El buscador conserva una sola superficie");
  record("Regresión de mapa: primer frame visible, cinco segundos sin renderizar en reposo y calidad automática repetida tres veces sin borrar el lienzo");
  await opsPage.evaluate(() => { window.__premiumThemeEvents=[]; window.addEventListener("donpepe:themechange",event => window.__premiumThemeEvents.push(event.detail.theme)); });
  await opsPage.locator("[data-theme-toggle]").click(); await opsPage.waitForFunction(() => document.querySelector("#map-host").dataset.theme==="light"); assert.deepEqual(await opsPage.evaluate(() => window.__premiumThemeEvents),["light"]);
  for (const value of ["dark","light"]) { await theme(opsPage,value); for (const camera of ["overview","interior","aisle","network"]) { await opsPage.locator(`[data-camera="${camera}"]`).click(); await opsPage.waitForTimeout(350); await screenshot(opsPage,`map-${camera}-${value}-1440`); } }
  record("Mapa: evento del tema actualiza materiales sin recargar, cuatro cámaras en ambos temas");
  await dialogs(adminPage,opsPage,storePage); await avatarFlow(opsPage);
  assert.equal(errors.length,0,JSON.stringify(errors)); assert.equal(problems.length,0,JSON.stringify(problems)); record("Cero errores JavaScript, desbordamientos o fallos de contraste en formularios críticos");
  await Promise.all(contexts.map(context => context.close()));
}
(async () => {
  let failure;
  try { await main(); } catch (error) { failure=error; process.stderr.write(`${error.stack}\n`); for (const [i,page] of (browser?.contexts().flatMap(c=>c.pages())||[]).entries()) { try { await page.screenshot({ path:path.join(outputDir,`failure-${i}.png`),fullPage:true,animations:"disabled",timeout:10000 }); } catch {} } }
  finally { if(browser)await browser.close(); if(server)await new Promise(resolve=>server.close(resolve)); runtime?.close(); fs.mkdirSync(outputDir,{recursive:true}); fs.writeFileSync(path.join(outputDir,"report.json"),JSON.stringify({ok:!failure&&!problems.length&&!errors.length,checks,errors,problems,contrasts,screenshots,mail:{simulated:true},failure:failure?.message||null},null,2)); fs.rmSync(dataDir,{recursive:true,force:true}); process.stdout.write(`Resultado: ${checks.length} comprobaciones, ${screenshots.length} capturas, ${errors.length} errores JS, ${problems.length} incidencias visuales.\n`); if(failure)process.exitCode=1; }
})();
