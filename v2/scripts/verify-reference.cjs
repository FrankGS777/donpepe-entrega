"use strict";
// Visual-interaction QA against the attached warehouse video. All application
// data lives in a disposable fixture; this never opens a user's database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");

const outputDir = path.resolve(process.env.DONPEPE_REFERENCE_QA_OUTPUT || path.resolve(__dirname, "../../../DonPepe-Referencia-2026-10-17"));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-reference-qa-"));
const actor = { id: "reference-qa", role: "operations" };
const startedAt = new Date().toISOString();
const checks = [], screenshots = [], layouts = [], cameraSamples = [], errors = [];
const fingerprints = Object.fromEntries(["../public/app.js", "../public/control-room.css", "../public/scene-annotations.css"].filter(file => fs.existsSync(path.resolve(__dirname, file))).map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, file))).digest("hex")]));
let runtime, server, browser, context, page, base, gpuInfo;
function record(text) { checks.push(text); process.stdout.write(`${text}\n`); }
async function ready() {
  await page.bringToFront();
  await page.locator('#map-host[data-scene-ready="true"]').waitFor({ timeout: 20000 });
}
async function diagnostics() { return page.evaluate(() => document.querySelector("#map-host")?.getSceneDiagnostics?.()); }
function elevation(camera) {
  const delta = camera.position.map((value, i) => value - camera.target[i]);
  return Math.atan2(delta[1], Math.hypot(delta[0], delta[2])) * 180 / Math.PI;
}
function between(value, a, b, tolerance = .015) { return value >= Math.min(a, b) - tolerance && value <= Math.max(a, b) + tolerance; }
async function capture(name, settle = true) {
  if (settle) await ready();
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  screenshots.push(file);
  const layout = await page.evaluate(() => {
    const bounds = selector => {
      const node = document.querySelector(selector); if (!node) return null;
      const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      bodyWidth: document.body.scrollWidth, header: bounds(".topbar"), canvas: bounds("#map-host canvas"),
      stage: bounds(".diorama-stage"), search: bounds("#map-find"), navigation: bounds("#workspace-nav"),
      menuOpen: Boolean(document.querySelector("#workspace-nav[data-console-open]")), diagnostics: document.querySelector("#map-host")?.getSceneDiagnostics?.() };
  });
  layouts.push({ name, ...layout });
  assert(layout.documentWidth <= layout.viewport.width + 2 && layout.bodyWidth <= layout.viewport.width + 2,
    `${name}: desbordamiento horizontal ${JSON.stringify(layout)}`);
  assert(layout.canvas?.width > 250 && layout.canvas?.height > 350, `${name}: mapa sin espacio útil`);
  assert(layout.diagnostics?.renderer?.triangles > 0 && layout.diagnostics?.renderer?.calls > 0, `${name}: escena no renderizada`);
  return layout;
}
async function menuChecks(suffix) {
  const toggle = page.locator("#console-navigation-toggle"), nav = page.locator("#workspace-nav");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await nav.getAttribute("data-console-open"), null);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  const links = await nav.locator("a").evaluateAll(nodes => nodes.map(node => ({ href: node.getAttribute("href"), text: node.textContent.trim() })));
  for (const href of ["#overview", "#orders", "#purchases", "#inventory", "#equipment", "#stores", "#analytics", "#incidents"])
    assert(links.some(link => link.href === href), `Falta la navegación ${href}`);
  const box = await nav.boundingBox(), viewport = page.viewportSize();
  assert(box && box.x >= -2 && box.y >= 0 && box.x + box.width <= viewport.width + 2 && box.y + box.height <= viewport.height + 2,
    `Herramientas fuera de pantalla: ${JSON.stringify(box)}`);
  if (viewport.width <= 600) {
    const search = await page.locator("#map-find").boundingBox();
    assert(box.y >= search.y + search.height, "El menú móvil cubre el buscador de la cabecera");
  }
  await capture(`herramientas-${suffix}`);
  await page.keyboard.press("Escape");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "console-navigation-toggle");
  await toggle.click();
  // Test the outside-click behavior using an exposed non-navigation corner.
  await page.mouse.click(2, 2);
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  record(`${suffix}: herramientas con ocho destinos, límites de pantalla y cierre por Escape/exterior`);
}
async function inspectTruck(truck) {
  const truckId = truck.id, truckName = truck.name || truckId;
  await page.locator("#map-find").fill(truckId);
  const result = page.locator(`#map-results [data-inspect="truck"][data-id="${truckId}"]`);
  await result.waitFor();
  await capture("seleccion-camion-antes");
  // The single browser timeline records actual rendered camera transforms. It
  // does not equate requestAnimationFrame callbacks with rendered scene frames.
  const sampling = page.evaluate(async id => {
    const host = document.querySelector("#map-host"), rows = [];
    const read = at => rows.push({ at, frames: Number(host.dataset.renderedFrames || 0), camera: host.getSceneDiagnostics().camera });
    const start = performance.now(); read(0);
    document.querySelector(`#map-results [data-inspect="truck"][data-id="${id}"]`).click();
    await new Promise(resolve => {
      function sample() { const elapsed = performance.now() - start; read(elapsed); if (elapsed >= 1250) resolve(); else requestAnimationFrame(sample); }
      requestAnimationFrame(sample);
    }); return rows;
  }, truckId);
  await page.waitForTimeout(250);
  await capture("seleccion-camion-250ms", false);
  await page.waitForTimeout(650);
  await capture("seleccion-camion-900ms", false);
  const rows = await sampling; cameraSamples.push({ name: "truck-focus", rows });
  const first = rows[0].camera, final = rows.at(-1).camera;
  assert(Math.abs(final.zoom - first.zoom) > .15, "La selección no cambió el encuadre de cámara");
  const mid = rows.filter(row => row.at > 150 && row.at < 700);
  assert(mid.some(row => Math.abs(row.camera.zoom - first.zoom) > .02 && Math.abs(row.camera.zoom - final.zoom) > .02),
    "El zoom de selección no pasó por valores intermedios");
  assert(mid.every(row => between(row.camera.zoom, first.zoom, final.zoom)), "El zoom sobrepasa su destino");
  assert(new Set(rows.map(row => row.camera.zoom.toFixed(4))).size >= 8, "La transición tiene muy pocas posiciones de zoom");
  assert(rows.at(-1).frames > rows[0].frames + 8, "La transición no produjo frames renderizados suficientes");
  assert(rows.every(row => [...row.camera.position, ...row.camera.target, row.camera.zoom].every(Number.isFinite)), "Pose de cámara inválida");
  assert(elevation(final) >= 20 && elevation(final) <= 48, `Enfoque demasiado cenital: ${elevation(final).toFixed(1)}°`);
  await page.locator("#map-inspector").waitFor({ state: "visible" });
  assert((await page.locator("#map-inspector").textContent()).includes(truckName), "Inspector distinto del camión seleccionado");
  const label = page.locator(".scene-marker--vehicle.is-selected:visible");
  assert.equal(await label.count(), 1, "Falta la etiqueta flotante del vehículo seleccionado");
  assert((await label.getAttribute("aria-label")).includes(truckName), "La etiqueta no identifica al camión real");
  await capture("camion-inspector-y-etiqueta");
  await page.locator('[data-action="close-inspector"]').click();
  await page.locator("#map-inspector").waitFor({ state: "hidden" });
  await page.locator(".scene-marker--vehicle.is-selected:visible").waitFor({ state: "hidden", timeout: 3000 });
  assert.equal(await page.locator(".scene-marker--vehicle.is-selected:visible").count(), 0, "La selección no se limpió al cerrar");
  record("Selección: cámara oblicua, zoom continuo medido, etiqueta e inspector del mismo camión y cierre");
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({ dataDir, startClock: false, mailEnv: {}, mailTransport: { async sendMail() { return { accepted: [] }; }, close() {} } });
  runtime.simulation.command("simulation.pause", { paused: true }, actor);
  server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--enable-webgl", ...(process.env.DONPEPE_NATIVE_GPU === "1" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]), "--disable-dev-shm-usage"] });
  context = await browser.newContext({ viewport: { width: 1250, height: 720 }, reducedMotion: "no-preference" });
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/login`); await page.locator('[name="email"]').fill("operaciones@donpepe.local");
  await page.locator('[name="password"]').fill("DonPepe2026!"); await page.locator('#login-form [type="submit"]').click();
  await page.waitForURL(`${base}/`); await ready(); await page.evaluate(() => window.DonPepeTheme.set("light"));
  await ready(); await page.waitForTimeout(1100);
  gpuInfo = await page.locator("#map-host canvas").evaluate(canvas => {
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl"), ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return { renderer: gl?.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER), vendor: gl?.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR) };
  });
  const initial = await capture("exterior-referencia-1250x720");
  assert(initial.canvas.y < 120 && initial.canvas.height >= 580, "La cabecera resta demasiado espacio al mapa");
  assert(elevation(initial.diagnostics.camera) >= 20 && elevation(initial.diagnostics.camera) <= 48, "Vista exterior fuera de la inclinación de referencia");
  assert(await page.locator(".scene-marker--dock:visible").count() >= 1, "No hay etiquetas de muelles visibles");
  assert.equal(await page.locator("#map-inspector").isVisible(), false, "El inspector debe abrirse solo al elegir una entidad");
  assert.equal(await page.locator("#map-resources").isVisible(), false, "Los recursos deben comenzar recogidos");
  await page.locator('.console-site[data-inspect="warehouse"]').click();
  await page.locator("#map-inspector").waitFor({ state: "visible" });
  assert((await page.locator("#map-inspector").textContent()).includes("Centro de distribución"), "La inspección del centro debe corresponder a la entidad elegida");
  await page.locator('[data-action="close-inspector"]').click();
  await page.locator("#map-inspector").waitFor({ state: "hidden" });
  record("Mapa despejado: inspector por selección explícita y recursos recogidos al entrar");
  const trackingTitle = await page.locator(".shipment-head strong").evaluate(node => {
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    let background = [255, 255, 255], parent = node;
    while (parent) { const value = rgb(getComputedStyle(parent).backgroundColor); if (value.length >= 3 && (value.length < 4 || value[3] > .9)) { background = value; break; } parent = parent.parentElement; }
    const luminance = value => value.slice(0, 3).map(n => { const c = n / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
    const foreground = luminance(rgb(style.color)), bg = luminance(background);
    return { text: node.textContent.trim(), width: rect.width, height: rect.height, opacity: Number(style.opacity), contrast: (Math.max(foreground, bg) + .05) / (Math.min(foreground, bg) + .05), uncovered: Boolean(hit && (hit === node || node.contains(hit))) };
  });
  assert(trackingTitle.text.length > 5 && trackingTitle.width > 30 && trackingTitle.height > 5 && trackingTitle.opacity > .5 && trackingTitle.contrast >= 4.5 && trackingTitle.uncovered,
    `Título de seguimiento oculto o sin contraste: ${JSON.stringify(trackingTitle)}`);
  record("Seguimiento: título legible, contraste suficiente y sin quedar tapado por la acción del pedido");
  record("1250×720: mapa protagonista, cámara oblicua, muelles identificables y ausencia de desbordamiento");
  await menuChecks("1250x720");
  await page.locator("#console-navigation-toggle").click();
  await page.locator('#workspace-nav a[href="#inventory"]').click();
  await page.waitForURL(`${base}/#inventory`); await page.locator("#map-host").waitFor({ state: "detached" });
  await page.locator('#workspace-nav a[href="#overview"]').click(); await ready(); await page.waitForTimeout(1100);
  assert.equal(await page.locator("#map-find").count(), 1, "Se duplicó el buscador al volver al mapa");
  assert.equal(await page.locator("#console-navigation-toggle").count(), 1, "Se duplicó el menú al volver al mapa");
  record("La navegación Inventario → Mapa conserva destinos y remonta una sola cabecera");
  await page.locator(".resource-toggle").click(); await page.locator("#map-resources").waitFor({ state: "visible" });
  for (const tab of ["docks", "robots", "trucks"]) {
    await page.locator(`[data-resource-tab="${tab}"]`).click();
    assert.equal(await page.locator(`[data-resource-tab="${tab}"]`).getAttribute("aria-selected"), "true");
    assert((await page.locator("#resource-list").textContent()).trim().length > 0);
  }
  await page.locator(".resource-close").click(); await page.locator("#map-resources").waitFor({ state: "hidden" });
  record("Recursos: muelles, equipos y camiones conservan contenido y selección accesible");
  await inspectTruck(runtime.simulation.snapshot(actor).trucks[0]);
  for (const view of ["overview", "interior", "aisle", "network"]) {
    await page.locator(`[data-camera="${view}"]`).click(); await page.waitForTimeout(1100); await ready();
    const d = await diagnostics(); assert.equal(d.view, view);
    assert.equal(await page.locator(`[data-camera="${view}"]`).getAttribute("aria-pressed"), "true");
    await capture(`${view}-1250x720`);
  }
  record("Las cuatro vistas cambian de cámara y mantienen el botón activo correcto");
  await page.locator('[data-camera="overview"]').click(); await page.waitForTimeout(1100);
  const beforeZoom = (await diagnostics()).camera.zoom;
  await page.locator('[data-action="zoom-map-in"]').click(); await page.waitForTimeout(800);
  assert((await diagnostics()).camera.zoom > beforeZoom, "El botón Acercar no funciona");
  await page.locator('[data-action="recenter-map"]').click(); await page.waitForTimeout(1100);
  assert(Math.abs((await diagnostics()).camera.zoom - beforeZoom) < .02);
  record("Controles: acercamiento y centrado conservan la cámara estable");
  await page.waitForTimeout(1800);
  const idleBefore = (await diagnostics()).renderer.frames;
  await page.waitForTimeout(1700);
  assert.equal((await diagnostics()).renderer.frames, idleBefore, "Las anotaciones dejan un render permanente en reposo");
  record("Reposo: no existe bucle infinito de renderizado por etiquetas o selección");
  await page.setViewportSize({ width: 1440, height: 1000 }); await ready(); await page.waitForTimeout(400);
  await capture("exterior-claro-1440x1000");
  await page.evaluate(() => window.DonPepeTheme.set("dark")); await ready(); await capture("exterior-oscuro-1440x1000");
  await page.setViewportSize({ width: 390, height: 844 }); await ready(); await page.waitForTimeout(400);
  await capture("exterior-oscuro-390x844"); await menuChecks("390x844");
  await page.evaluate(() => window.DonPepeTheme.set("light")); await ready(); await capture("exterior-claro-390x844");
  const resourcePanel = page.locator("#map-resources");
  if (!await resourcePanel.isVisible()) await page.locator(".resource-toggle").click();
  await resourcePanel.waitFor({ state: "visible" });
  await page.locator('[data-resource-tab="trucks"]').click(); await capture("recursos-movil-390x844");
  await page.locator(".resource-close").click(); await resourcePanel.waitFor({ state: "hidden" });
  record("1440×1000 y 390×844: temas, búsqueda, menú y recursos sin desbordamiento");
  assert.equal(errors.length, 0, JSON.stringify(errors)); record("Sin errores JavaScript durante todas las interacciones");
}
(async () => {
  let failure;
  try { await main(); }
  catch (error) { failure = error; process.stderr.write(`${error.stack}\n`); try { await page?.screenshot({ path: path.join(outputDir, "reference-error.png"), fullPage: true }); } catch {} }
  finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "verificacion-referencia.json"), JSON.stringify({ ok: !failure, checks, screenshots, layouts, cameraSamples, errors,
      environment: { startedAt, fingerprints, gpuInfo, browser: "Chrome headless", fixture: "SQLite temporal aislado", mail: "Simulado, sin envíos" }, failure: failure?.message || null }, null, 2));
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.stdout.write(`Resultado: ${checks.length} comprobaciones; ${screenshots.length} capturas. ${outputDir}\n`);
    if (failure) process.exitCode = 1;
  }
})();
