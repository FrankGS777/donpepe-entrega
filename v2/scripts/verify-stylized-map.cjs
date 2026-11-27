"use strict";

// Rendered acceptance checks for the stylized map. Both this test and the full
// journey subprocess use private in-memory databases and an ephemeral server.
// No live service, persisted warehouse, user session or outbound mail is used.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { spawn } = require("node:child_process");
const { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const { createSimulation } = require("../core/engine");
const output = process.env.DONPEPE_STYLIZED_MAP_QA_OUTPUT || path.resolve(__dirname, "../../../DonPepe-Mapa-Estilizado-2026-10-18");
const nativeGpu = process.env.DONPEPE_NATIVE_GPU !== "0";
const actor = { id: "QA-OPERATIONS", role: "operations" };
const checks = [], screenshots = [], metrics = [], errors = [];
const startedAt = new Date().toISOString();
const files = ["../public/app.js", "../frontend/scene.js", "../frontend/scene-materials.js", "../frontend/autonomy-view.js"];
const fingerprints = Object.fromEntries(files.map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, file))).digest("hex")]));
const legacyQualityKeys = ["donpepe-map-quality", "donpepe.map.quality", "donpepe-map-quality-v2", "donpepe-map-quality-v1"];
let runtime, server, browser, context, page, gpu, failure, base, flowReport;
const view = () => runtime.simulation.snapshot(actor);
const command = (type, payload) => runtime.simulation.command(type, payload, actor);
const record = message => { checks.push(message); process.stdout.write(message + "\n"); };
async function diagnostic() { return page.evaluate(() => document.querySelector("#map-host")?.getSceneDiagnostics?.()); }
async function ready() {
  await page.bringToFront();
  await page.locator('#map-host[data-scene-ready="true"]').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1100);
}
async function refresh() {
  await page.waitForResponse(response => response.url().endsWith("/api/state") && response.ok(), { timeout: 10000 });
  await ready();
}
async function capture(name) {
  await ready();
  const filename = path.join(output, `${name}.png`);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: filename, fullPage: true, animations: "disabled" });
  screenshots.push(filename);
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight,
    headers: [...document.querySelectorAll(".topbar")].map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }) }));
  assert.ok(layout.scrollWidth <= layout.width + 2, `${name}: desbordamiento horizontal`);
  const canvas = page.locator("#map-host canvas"), box = await canvas.boundingBox();
  assert.ok(box && box.width > 200 && box.height > 200, `${name}: mapa sin tamaño útil`);
  const image = PNG.sync.read(fs.readFileSync(filename)), colours = new Set();
  const pixelScale = image.width / layout.scrollWidth;
  for (let y = Math.max(0, Math.floor((box.y + box.height * .2) * pixelScale)); y < Math.min(image.height, (box.y + box.height * .9) * pixelScale); y += 5)
    for (let x = Math.max(0, Math.floor((box.x + box.width * .1) * pixelScale)); x < Math.min(image.width, (box.x + box.width * .9) * pixelScale); x += 5) {
      const i = (y * image.width + x) * 4;
      colours.add(`${image.data[i] >> 4},${image.data[i + 1] >> 4},${image.data[i + 2] >> 4}`);
    }
  assert.ok(colours.size > 12, `${name}: lienzo vacío o sin contraste`);
  const data = await diagnostic();
  assert.ok(data.renderer.calls > 0 && data.renderer.triangles > 0, `${name}: escena sin geometría renderizada`);
  metrics.push({ name, layout, canvas: box, colours: colours.size, diagnostic: data });
}
async function quality(description) {
  const data = await diagnostic();
  const settings = await page.locator("#map-host").evaluate(host => {
    const canvas = host.querySelector("canvas"), gl = canvas?.getContext("webgl2");
    return { quality: host.dataset.quality, effective: host.dataset.effectiveQuality,
      antialias: gl?.getContextAttributes()?.antialias, devicePixelRatio };
  });
  assert.equal(data.renderer.quality, "high", description);
  assert.equal(settings.quality, "high", description);
  assert.equal(settings.effective, "high", description);
  assert.equal(settings.antialias, true, `${description}: antialias activo`);
  if (data.renderer.shadowsEnabled !== undefined) assert.equal(data.renderer.shadowsEnabled, true);
  if (data.renderer.shadowMapSize !== undefined) {
    const size = Array.isArray(data.renderer.shadowMapSize) ? data.renderer.shadowMapSize[0] : data.renderer.shadowMapSize;
    assert.ok(size >= 2048, `${description}: sombras de alta definición`);
  }
  metrics.push({ name: description, settings, renderer: data.renderer });
}
async function controls() {
  const buttons = await page.locator(".map-camera-tools button").evaluateAll(elements => elements.map(element => ({
    camera: element.dataset.camera || null, action: element.dataset.action || null,
    label: element.getAttribute("aria-label") || element.title || element.textContent.trim(),
  })));
  assert.equal(buttons.length, 5, "Sólo cuatro perspectivas y el control de paneles en la columna derecha");
  assert.deepEqual(buttons.filter(row => row.camera).map(row => row.camera).sort(), ["aisle", "interior", "network", "overview"]);
  assert.equal(buttons.filter(row => row.action === "map-focus").length, 1);
  assert.equal(await page.locator("#map-quality, .map-zoom-tools, .map-pan-tools, .map-help-button").count(), 0,
    "No deben quedar selectores de calidad, flechas, zoom o ayuda del control anterior");
  const toggle = page.locator('[data-action="map-focus"]');
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator(".diorama-stage").evaluate(element => element.classList.contains("map-focus")), true);
  for (const selector of [".map-hud", ".shipment-tracking", ".map-resources"])
    assert.equal(await page.locator(selector).evaluate(element => getComputedStyle(element).display), "none");
  await capture("00-mapa-despejado");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  record("Controles del mapa limitados a cuatro perspectivas y mostrar/ocultar recuadros; paneles funcionales");
}
async function focus(type, id, name) {
  await page.locator("#map-find").fill(id);
  const result = page.locator(`#map-results [data-inspect="${type}"][data-id="${id}"]`);
  await result.waitFor(); await result.click();
  await capture(name);
  assert.ok((await diagnostic()).camera.position.every(Number.isFinite));
  const close = page.locator('[data-action="close-inspector"]');
  if (await close.count() && await close.isVisible()) await close.click();
  await page.locator("#map-find").fill("");
}
function seek(predicate, description, seconds = 3600) {
  for (let elapsed = 0; elapsed < seconds; elapsed += .25) {
    const state = view(); if (predicate(state)) return state;
    runtime.simulation.advance(.25);
  }
  throw Error(`${description}: tiempo simulado agotado`);
}
async function storeSigns() {
  const data = await diagnostic(), signs = data.geometry?.storeSigns || data.storeSigns;
  assert.ok(Array.isArray(signs) && signs.length >= view().catalog.branches.length, "Diagnóstico geométrico de rótulos requerido");
  for (const sign of signs) {
    assert.ok(Number.isFinite(sign.roofTop) && Number.isFinite(sign.signBottom) && Number.isFinite(sign.signTop),
      `Rótulo ${sign.branchId}: coordenadas finitas`);
    assert.equal(sign.mounting,'facade');
    assert.ok(sign.signBottom>sign.fasciaBottom && sign.signTop<sign.fasciaTop,`Rótulo ${sign.branchId}: letras apoyadas sobre la fachada`);
    assert.ok(sign.signTop > sign.signBottom, `Rótulo ${sign.branchId}: altura positiva`);
  }
  metrics.push({ name: "rotulos-tiendas-sobre-cubierta", signs });
  record("Los rótulos de todas las tiendas quedan completamente sobre la cubierta, sin penetración geométrica");
}
async function dossier() {
  const rice = view().catalog.skus.find(row => row.id === "SKU-ARROZ");
  const purchase = command("purchase.create", { supplierId: rice.supplierId, lines: [{ skuId: rice.id, cases: 12 }], commandId: crypto.randomUUID() });
  seek(state => state.autonomy.jobs.some(job => job.documentId === purchase.id && job.state === "COMPLETED"), "Recepción para expediente");
  const job = view().autonomy.jobs.find(row => row.documentId === purchase.id);
  await refresh();
  await page.goto(base + "/#autonomy");
  await page.locator("#autonomy-filter").waitFor();
  await page.locator("#autonomy-filter").selectOption("ALL");
  await page.locator(`[data-autonomy="detail"][data-id="${job.id}"]`).click();
  await page.locator("#dialog[open] .autonomy-dossier").waitFor();
  assert.equal(await page.locator("#dialog pre").count(), 0, "Expediente sin payload JSON");
  const text = await page.locator("#dialog-body").textContent();
  assert.ok(text.includes("Controles registrados") && text.includes("Proceso terminado"));
  assert.ok(text.includes("Vehículo inmovilizado") && text.includes("Cajas identificadas") && text.includes("Peso de la carga"),
    "El expediente traduce seguridad, identidad y medidas a lenguaje de operación");
  assert.ok(!/\"(?:huId|vehicleRestrained|weightKg|loadId|profile)\"\s*:/.test(text), "Sin claves de objeto expuestas");
  for (const detail of await page.locator("#dialog .autonomy-evidence-card").all())
    await detail.evaluate(element => { element.open = true; });
  const filename = path.join(output, "09-expediente-legible.png");
  await page.screenshot({ path: filename, fullPage: true, animations: "disabled" }); screenshots.push(filename);
  await page.locator("#dialog .autonomy-evidence-card").last().scrollIntoViewIfNeeded();
  const controlsFilename = path.join(output, "09b-controles-legibles.png");
  await page.screenshot({ path: controlsFilename, fullPage: true, animations: "disabled" }); screenshots.push(controlsFilename);
  metrics.push({ name: "expediente-legible", evidenceCards: await page.locator("#dialog .autonomy-evidence-card").count() });
  await page.locator("#dialog-close").click();
  await page.goto(base + "/#map"); await ready();
  record("Expediente de recepción con controles, resultados y medidas legibles; sin bloques JSON");
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({ identityFile: ":memory:", simulation: createSimulation({ filename: ":memory:" }), startClock: false, mailEnv: {},
    mailTransport: { sendMail: async () => { throw Error("La verificación no envía correo"); }, close() {} } });
  server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
    args: ["--enable-webgl", "--disable-dev-shm-usage", ...(nativeGpu ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])] });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, reducedMotion: "no-preference" });
  await context.addInitScript(keys => { for (const key of keys) localStorage.setItem(key, "low"); }, legacyQualityKeys);
  const login = await context.request.post(base + "/api/login", { data: { email: "operaciones@donpepe.local", password: "DonPepe2026!" } });
  assert.equal(login.status(), 200);
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/#map"); await ready();
  gpu = await page.locator("#map-host canvas").evaluate(canvas => {
    const gl = canvas.getContext("webgl2"), ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return gl ? { vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR), renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER) } : {};
  });
  if (nativeGpu) assert.ok(gpu.renderer && !/swiftshader|llvmpipe|software rasterizer/i.test(gpu.renderer), "GPU nativa requerida");
  await quality("calidad-alta-tras-preferencia-low");
  await controls();
  await page.locator('[data-action="map-focus"]').click();
  for (const [index, camera] of ["overview", "interior", "aisle", "network"].entries()) {
    await page.locator(`[data-camera="${camera}"]`).click();
    await capture(`0${index + 1}-${camera}`);
  }
  await page.locator('[data-action="map-focus"]').click();
  await storeSigns();
  const surfaces = (await diagnostic()).surfaces;
  assert.ok(surfaces.atlases.length >= 8 && surfaces.pixelBufferBytes <= 10 * 1024 * 1024, "Atlas estilizados compartidos y acotados");
  await focus("asset", "ASSET-AUTO-ID-IN-1", "05-detalle-identificacion");
  await focus("asset", "ASSET-CASE-PICKER-1", "06-detalle-celula");
  await focus("branch", view().catalog.branches[0].id, "07-detalle-tienda");
  const hu = view().hus.find(row => row.state === "STORED");
  if (hu) await focus("hu", hu.id, "08-detalle-rack-cajas");
  record("Cuatro perspectivas y detalles de equipo, tienda y carga renderizados con superficies estilizadas");
  await dossier();
  for (const theme of ["dark", "light"]) {
    await page.evaluate(value => window.DonPepeTheme.set(value), theme);
    await page.locator('[data-camera="overview"]').click();
    await capture(`10-tema-${theme}`);
    await quality(`calidad-alta-tema-${theme}`);
  }
  const storageState = await context.storageState();
  await context.close();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true, reducedMotion: "no-preference", storageState });
  await context.addInitScript(keys => { for (const key of keys) localStorage.setItem(key, "low"); }, legacyQualityKeys);
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(base + "/#map"); await ready();
  await quality("calidad-alta-movil-dpr2");
  await capture("11-movil-alta");
  assert.equal(metrics.find(row => row.name === "11-movil-alta").layout.headers.length, 1);
  await page.reload(); await ready(); await quality("calidad-alta-movil-tras-recarga");
  record("Calidad alta fija en escritorio, ambos temas, móvil DPR 2 y recarga con antiguas preferencias bajas");
  assert.deepEqual(errors, []);
}
async function fullJourney() {
  await browser?.close(); browser = null;
  await new Promise(resolve => server.close(resolve)); server = null; runtime.close(); runtime = null;
  process.stdout.write("Comienza recorrido autónomo completo y medición de fluidez en GPU nativa.\n");
  const flowOutput = path.join(output, "flujo");
  const child = spawn(process.execPath, [path.join(__dirname, "verify-autonomy-map.cjs")], {
    cwd: path.resolve(__dirname, "../.."), env: { ...process.env, DONPEPE_AUTONOMY_MAP_QA_OUTPUT: flowOutput }, stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  assert.equal(code, 0, "Recorrido completo de recepción, preparación, transporte y entrega");
  flowReport = JSON.parse(fs.readFileSync(path.join(flowOutput, "verificacion-mapa-autonomo.json"), "utf8"));
  assert.equal(flowReport.ok, true);
  record("Recorrido autónomo completo y métricas de animación aprobados con el mismo bundle");
}
(async () => {
  try {
    await main();
    if (process.env.DONPEPE_SKIP_AUTONOMY_FLOW !== "1") await fullJourney();
    else record("Recorrido dinámico pospuesto explícitamente; esta ejecución verifica sólo presentación e interacción");
  }
  catch (error) {
    failure = error; process.stderr.write(error.stack + "\n");
    try { await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); } catch {}
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve)); runtime?.close();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "verificacion-mapa-estilizado.json"), JSON.stringify({
      ok: !failure, startedAt, checks, screenshots, metrics, errors,
      flow: flowReport ? { ok: flowReport.ok, checks: flowReport.checks, samples: flowReport.samples.map(({ label, renderedFps, p95RafMs, uniqueLoadFrames, uniqueMoverFrames, uniqueAutomationFrames, stateResponses }) => ({ label, renderedFps, p95RafMs, uniqueLoadFrames, uniqueMoverFrames, uniqueAutomationFrames, stateResponses })) } : null,
      flowSkipped: process.env.DONPEPE_SKIP_AUTONOMY_FLOW === "1",
      environment: { gpu, requested: nativeGpu ? "Native GPU" : "SwiftShader diagnostic", data: "SQLite in memory only", email: "No outbound email", fingerprints, legacyQualityKeys },
      failure: failure?.message || null,
    }, null, 2));
    process.stdout.write(`${checks.length} comprobaciones; ${screenshots.length} capturas. ${output}\n`);
    if (failure) process.exitCode = 1;
  }
})();
