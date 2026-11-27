"use strict";

// A complete rendered journey in disposable in-memory databases. This verifier
// never connects to the live DonPepe service, touches v2/data, or sends mail.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const crypto = require("node:crypto");
const { once } = require("node:events");
const { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const { createSimulation } = require("../core/engine");
const output = process.env.DONPEPE_AUTONOMY_MAP_QA_OUTPUT || path.resolve(__dirname, "../../../DonPepe-Mapa-Autonomo-2026-10-18");
const nativeGpu = process.env.DONPEPE_NATIVE_GPU !== "0";
const OPS = { id: "QA-OPERATIONS", role: "operations" };
const STORE = { id: "QA-STORE", role: "store", branchId: "TIENDA-1" };
const checks = [], screenshots = [], errors = [], samples = [], metrics = [], stages = [];
const startedAt = new Date().toISOString();
const fingerprints = Object.fromEntries(["../public/app.js", "../core/engine.js", "../core/autonomy-domain.js", "../core/autonomy-map.js", "../core/automation-blueprint.js"].map(file => [file, crypto.createHash("sha256").update(fs.readFileSync(path.resolve(__dirname, file))).digest("hex")]));
let runtime, server, browser, context, page, failure, base, timer, responses = 0, gpu;
const view = () => runtime.simulation.snapshot(OPS);
const command = (type, payload = {}) => runtime.simulation.command(type, payload, OPS);
const record = text => { checks.push(text); process.stdout.write(text + "\n"); };
const closed = state => ["COMPLETED", "CANCELLED"].includes(state);
const vector = value => Array.isArray(value) ? value.slice(0, 3) : [value?.x || 0, value?.y || 0, value?.z || 0];
const unique = rows => new Set(rows.filter(Boolean).map(row => JSON.stringify(row, (_, v) => typeof v === "number" ? Math.round(v * 10000) / 10000 : v))).size;
function percentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))].toFixed(2)) : null;
}
function seek(predicate, description, maximum = 3600, step = .25) {
  for (let elapsed = 0; elapsed <= maximum; elapsed += step) {
    const state = view(); if (predicate(state)) return state;
    runtime.simulation.advance(step);
  }
  const state = view();
  throw Error(`${description}: agotado el tiempo simulado; ${JSON.stringify({ jobs: state.autonomy.jobs.map(({ id, state, stage }) => ({ id, state, stage })),
    devices: state.autonomy.map.devices.map(({ deviceId, state, stage, carryingHuId, blocked, reason }) => ({ deviceId, state, stage, carryingHuId, blocked, reason })),
    orders: state.orders.map(({ id, state, status }) => ({ id, state, status })) })}`);
}
async function diagnostic() { return page.evaluate(() => document.querySelector("#map-host")?.getSceneDiagnostics?.()); }
async function ready() { await page.bringToFront(); await page.locator('#map-host[data-scene-ready="true"]').waitFor({ timeout: 30000 }); }
async function refresh() {
  await page.waitForResponse(response => response.url().endsWith("/api/state") && response.ok(), { timeout: 8000 });
  await page.waitForTimeout(900); await ready();
}
async function closeInspector() {
  const close = page.locator('[data-action="close-inspector"], #map-inspector .inspector-close');
  if (await close.count() && await close.first().isVisible()) await close.first().click();
}
async function focus(type, id) {
  await page.locator("#map-find").fill(id);
  const result = page.locator(`#map-results [data-inspect="${type}"][data-id="${id}"]`);
  await result.waitFor(); await result.click();
  await page.waitForTimeout(1100); await ready();
  const d = await diagnostic(); assert.ok(d.camera.position.every(Number.isFinite));
}
async function capture(name) {
  await ready(); const filename = path.join(output, `${name}.png`);
  await page.screenshot({ path: filename, fullPage: true, animations: "disabled" }); screenshots.push(filename);
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scroll: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight, scrollY,
    headers: [...document.querySelectorAll('.topbar')].map(header => {
      const r = header.getBoundingClientRect(), css = getComputedStyle(header);
      return { x: r.x, y: r.y, width: r.width, height: r.height, position: css.position, display: css.display };
    }) }));
  assert.ok(layout.scroll <= layout.width + 2, `${name}: desbordamiento horizontal`);
  const box = await page.locator("#map-host canvas").boundingBox();
  const image = PNG.sync.read(fs.readFileSync(filename)), colors = new Set();
  for (let y = Math.max(0, Math.floor(box.y + box.height * .25)); y < Math.min(image.height, box.y + box.height * .8); y += 5)
    for (let x = Math.max(0, Math.floor(box.x + box.width * .15)); x < Math.min(image.width, box.x + box.width * .82); x += 5) {
      const index = (y * image.width + x) * 4;
      colors.add(`${image.data[index] >> 4},${image.data[index + 1] >> 4},${image.data[index + 2] >> 4}`);
    }
  assert.ok(colors.size > 12, `${name}: lienzo vacío o sin contraste`);
  const d = await diagnostic();
  assert.ok(d.renderer.calls > 0 && d.renderer.triangles > 0);
  metrics.push({ name, colors: colors.size, box, layout, diagnostic: d });
}
function movingSignature(d) {
  const automation = d?.automation || {};
  return { devices: automation.devices || automation.stations || [], loads: automation.loads || automation.incoming || [],
    mechanisms: automation.mechanisms || [], caseOffsets: automation.caseOffsets || [], supplier: automation.supplierDock || automation.supplier || null };
}
async function sample(label, duration = 2000, advance = true, warmupMs = 0, captureName = null) {
  let last = performance.now(), clockError;
  let beforeResponses = responses;
  if (advance) timer = setInterval(() => {
    try { const time = performance.now(); runtime.simulation.advance(Math.min(.3, (time - last) / 1000)); last = time; }
    catch (error) { clockError = error; clearInterval(timer); }
  }, 100);
  let rows;
  try {
    if (warmupMs) { await page.waitForTimeout(warmupMs); beforeResponses = responses; }
    if (captureName) { await capture(captureName); beforeResponses = responses; }
    rows = await page.evaluate(async duration => {
      const start = performance.now(), rows = [];
      await new Promise(resolve => {
        function frame() {
          const host = document.querySelector("#map-host");
          rows.push({ at: performance.now(), frames: Number(host?.dataset.renderedFrames || 0), diagnostic: host?.getSceneDiagnostics?.() });
          if (performance.now() - start >= duration) resolve(); else requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
      });
      return rows;
    }, duration);
  } finally { clearInterval(timer); timer = null; }
  if (clockError) throw clockError;
  const intervals = rows.slice(1).map((row, i) => row.at - rows[i].at);
  const renderedFrames = rows.at(-1).frames - rows[0].frames;
  const result = { label, warmupMs, stateResponses: responses - beforeResponses, durationMs: rows.at(-1).at - rows[0].at,
    renderedFrames, renderedFps: Number((renderedFrames / ((rows.at(-1).at - rows[0].at) / 1000)).toFixed(2)),
    medianRafMs: percentile(intervals, .5), p95RafMs: percentile(intervals, .95),
    uniqueAutomationFrames: unique(rows.map(row => movingSignature(row.diagnostic))),
    uniqueMoverFrames: unique(rows.map(row => row.diagnostic?.movers)),
    uniqueLoadFrames: unique(rows.map(row => row.diagnostic?.loads)), rows };
  samples.push(result); return result;
}
function activeLoadPosition(d, loadId) {
  const load = (d?.automation?.loads || d?.automation?.incoming || []).find(row => row.id === loadId);
  return load && (load.position || load.pose) ? vector(load.position || load.pose) : null;
}
function assertContinuousLoad(sampled, locate, description) {
  let previous, observed = 0, largestStepM = 0;
  for (const row of sampled.rows) {
    const position = locate(row.diagnostic);
    if (!position) continue;
    observed++;
    if (previous) {
      const step = Math.hypot(...position.map((value, index) => value - previous.position[index]));
      largestStepM = Math.max(largestStepM, step);
      // Allow a generous 12 m/s envelope and a sub-pallet correction, rather
      // than assuming every test frame has exactly the same duration.
      assert.ok(step <= 12 * (row.at - previous.at) / 1000 + .45,
        `${description}: salto físico de ${step.toFixed(2)} m en ${(row.at - previous.at).toFixed(1)} ms`);
    }
    previous = { at: row.at, position };
  }
  assert.ok(observed > 10, `${description}: faltan posiciones observables`);
  sampled.continuity = { observed, largestStepM: Number(largestStepM.toFixed(4)) };
}
function assertMechanicalSupport(sampled, id, description) {
  let supported = 0;
  const phases = new Set();
  for (const row of sampled.rows) {
    const support = row.diagnostic?.automation?.mechanicalSupports?.find(item => item.id === id);
    if (!support) continue;
    supported++; phases.add(support.phase);
    assert.ok(Math.abs(support.gap) < .03, `${description}: separación entre palé y apoyo`);
    const load = row.diagnostic.loads?.find(item => item.id === id) || row.diagnostic.automation.incoming?.find(item => item.id === id);
    if (load) assert.ok(Math.abs(vector(load.position)[1] - support.cargoBottomY) < .04, `${description}: carga dibujada fuera de su apoyo`);
    if (support.carrying) {
      const machine = row.diagnostic.automation.mechanisms?.find(item => item.id === support.mechanismId);
      assert.ok(machine?.supportPoint, `${description}: falta mecanismo físico debajo del palé`);
      const actual = machine.supportPoint, cargo = vector(load?.position);
      if (load) assert.ok(Math.hypot(actual[0] - cargo[0], actual[1] - cargo[1], actual[2] - cargo[2]) < .045,
        `${description}: el extremo físico del mecanismo no coincide con la carga`);
    }
  }
  assert.ok(supported > 10, `${description}: faltan apoyos observados`);
  sampled.mechanicalSupport = { supported, phases: [...phases] };
}
async function inspectAllNewEquipment() {
  const stations = view().layout.automation.stations;
  assert.equal(stations.length, 8);
  for (const station of stations) {
    await focus("asset", station.assetId);
    const d = await diagnostic();
    const machines = d.automation?.devices || d.automation?.stations || [];
    assert.ok(machines.some(row => row.assetId === station.assetId || row.id === station.assetId || row.id === station.deviceId), `Falta modelo físico de ${station.assetId}`);
    const inspector = await page.locator("#map-inspector").textContent();
    assert.ok(inspector.includes(station.name) || inspector.includes(station.deviceId) || inspector.includes(station.assetId), `${station.assetId}: la selección no identifica el equipo`);
  }
  record("Ocho equipos autónomos tienen modelo seleccionable, enfoque y ficha vinculada a su activo real");
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({ identityFile: ":memory:", simulation: createSimulation({ filename: ":memory:", seed: false }), startClock: false, mailEnv: {},
    mailTransport: { sendMail: async () => { throw Error("Este diagnóstico no envía correo"); }, close() {} } });
  server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true,
    args: ["--enable-webgl", "--disable-dev-shm-usage", ...(nativeGpu ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"])] });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" });
  const login = await context.request.post(base + "/api/login", { data: { email: "operaciones@donpepe.local", password: "DonPepe2026!" } });
  assert.equal(login.status(), 200);
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  page.on("console",message=>{if(message.type()==="error")errors.push(message.text());});
  page.on("response", response => { if (response.url().endsWith("/api/state")) responses++; });
  await page.goto(base + (process.env.QA_FORCE_WEBGL ? "/?renderer=webgl2#map" : "/#map")); await ready();
  gpu = (await diagnostic()).renderer;
  assert.equal(view().metrics.warehouseCases, 0);
  for (const mode of ["overview", "interior", "aisle", "network"]) {
    await page.locator(`[data-camera="${mode}"]`).click(); await page.waitForTimeout(1100); await capture(`01-${mode}`);
  }
  const materialDiagnostics = (await diagnostic()).surfaces;
  assert.ok(materialDiagnostics?.atlases?.some(row => row.kind === "concrete"));
  assert.ok(materialDiagnostics.atlases.some(row => row.kind === "roof"));
  assert.ok(materialDiagnostics.pixelBufferBytes < 320 * 1024 * 1024);
  assert.equal(materialDiagnostics.photographicSources,4);
  assert.deepEqual(materialDiagnostics.missingAssets,[]);
  record("Anexo, interior, pasillo y red renderizados; superficies PBR fotográficas 2K y entorno HDR cargados");
  await inspectAllNewEquipment();

  const rice = view().catalog.skus.find(row => row.id === "SKU-ARROZ");
  const purchase = command("purchase.create", { supplierId: rice.supplierId, lines: [{ skuId: rice.id, cases: 12 }], commandId: crypto.randomUUID() });
  let recognition, inboundId;
  for (const [index, stage, assetId] of [
    [2, "UNLOADING", "ASSET-AUTO-UNLOADER-IN-1"], [3, "IDENTIFYING", "ASSET-AUTO-ID-IN-1"],
    [4, "INSPECTING", "ASSET-PIE-IN-1"], [5, "RECEIVING", "ASSET-INBOUND-CONVEYOR-1"],
  ]) {
    const state = seek(s => s.autonomy.map.jobs.some(job => job.documentId === purchase.id && job.state === stage && job.moving), stage);
    const frame = state.autonomy.map, load = frame.loads.find(row => row.documentId === purchase.id && row.visible);
    assert.ok(load, `${stage}: debe existir carga física antes del alta de inventario`);
    assert.equal(load.inventoryRecognized, false);
    assert.equal(state.metrics.warehouseCases, 0);
    stages.push({ stage, elapsed: state.clock.elapsed, loadId: load.id, from: load.from, to: load.to });
    await refresh(); await focus("asset", assetId);
    const motion = await sample(`recepcion-${stage.toLowerCase()}`, stage === "RECEIVING" ? 6000 : 2800);
    if (stage === "RECEIVING") inboundId = load.id;
    const positions = motion.rows.map(row => activeLoadPosition(row.diagnostic, load.id));
    assert.ok(unique(positions) > motion.stateResponses + 2, `${stage}: desplazamiento visual sin suficientes posiciones intermedias (${unique(positions)} frente a ${motion.stateResponses} respuestas)`);
    assert.ok(positions.filter(Boolean).every(position => position.every(Number.isFinite)));
    await capture(`0${index}-${stage.toLowerCase()}`);
    if (stage === "INSPECTING") {
      command("simulation.pause", { paused: true }); await refresh(); await page.waitForTimeout(1100);
      const pausedElapsed = view().clock.elapsed, paused = await sample("inspeccion-pausada", 1200, true);
      assert.equal(view().clock.elapsed, pausedElapsed);
      assert.equal(unique(paused.rows.map(row => activeLoadPosition(row.diagnostic, load.id))), 1, "Pausa debe congelar también la carga renderizada");
      record("Pausar inspección congela reloj, carga y proceso sin aceptar inventario");
      command("simulation.pause", { paused: false }); await refresh();
    }
  }
  // New receipt cycles include travel, alignment and a visible distributor.
  // Observe the final supported handoff separately instead of assuming that a
  // physically complete receiving line can finish in the first six seconds.
  seek(s => s.autonomy.map.jobs.some(job => job.documentId === purchase.id && job.state === "RECEIVING" &&
    job.phaseElapsed >= Math.max(0, job.phaseDuration - 4)), "Asiento final en recepción");
  await refresh();
  recognition = await sample("recepcion-asiento-inventario", 6000);
  assertMechanicalSupport(recognition, inboundId, "Distribuidor a buffer recibido");
  record("Descarga, Auto-ID, inspección y transferencia: carga previa al inventario, movimiento continuo superior a la frecuencia de datos");
  const receivedHuId = view().receipts.find(receipt => receipt.purchaseId === purchase.id)?.lines[0]?.huIds[0];
  assert.ok(receivedHuId, "La transición debe terminar en una HU recibida, no en una carga decorativa");
  assert.ok(recognition.rows.some(row => activeLoadPosition(row.diagnostic, inboundId)), "Debe verse la carga antes de su recepción");
  assert.ok(recognition.rows.some(row => row.diagnostic.loads.some(load => load.id === receivedHuId)), "Debe verse la HU reconocida después de la recepción");
  assert.equal(recognition.rows.filter(row => activeLoadPosition(row.diagnostic, inboundId) && row.diagnostic.loads.some(load => load.id === receivedHuId)).length, 0,
    "El reloj visual no puede duplicar la misma carga como ASN y como inventario a la vez");
  assertContinuousLoad(recognition, d => activeLoadPosition(d, inboundId) || d.loads.find(load => load.id === receivedHuId)?.position,
    "Transportador a HU de recepción");
  seek(s => s.autonomy.map.bufferTransfers.some(transfer => transfer.huId === receivedHuId && transfer.visible), "Entrega de buffer al AMR", 180, .05);
  await refresh();
  const robotHandoff = await sample("entrega-buffer-amr-continua", 3000);
  assertContinuousLoad(robotHandoff, d => d.loads.find(load => load.id === receivedHuId)?.position, "Buffer a robot autónomo");
  assertMechanicalSupport(robotHandoff, receivedHuId, "Recogida con carro de recepción");
  seek(s => s.autonomy.map.bufferTransfers.some(transfer => transfer.huId === receivedHuId && transfer.visible &&
    transfer.phaseElapsed >= transfer.phaseDuration * .74), "Elevación externa de la transferencia AMR", 180, .05);
  await refresh(); await focus("asset", "ASSET-INBOUND-CONVEYOR-1");
  const mechanicalHandoff = await sample("elevador-horquillas-asiento-retraccion", 6800, true, 150, "12-elevador-horquillas");
  assertMechanicalSupport(mechanicalHandoff, receivedHuId, "Elevador y horquillas hacia AMR");
  for (const phase of ["LIFT", "EXTEND", "SEATED", "RETRACT"])
    assert.ok(mechanicalHandoff.mechanicalSupport.phases.includes(phase), `Debe observarse fase mecánica ${phase}`);
  record("La carga mantiene continuidad física al reconocerse como inventario y al subir al robot autónomo");
  seek(s => s.autonomy.jobs.some(job => job.documentId === purchase.id && job.state === "COMPLETED"), "Almacenaje final");
  assert.equal(view().metrics.warehouseCases, 12);
  assert.equal(view().receipts.length, 1);
  assert.ok(view().hus.every(hu => hu.state === "STORED"));
  await refresh(); await focus("hu", view().hus[0].id); await capture("06-carga-almacenada");

  const order = runtime.simulation.command("order.create", { lines: [{ skuId: rice.id, cases: 6 }], commandId: crypto.randomUUID() }, STORE);
  command("order.release", { id: order.id, commandId: crypto.randomUUID() });
  const cellState = seek(s => s.autonomy.map.devices.some(device => device.type === "CASE_PICKING_CELL" && device.stage === "CASE_PICKING" && device.carryingHuId), "Célula de picking");
  const cell = cellState.autonomy.map.devices.find(device => device.type === "CASE_PICKING_CELL");
  assert.ok(cell.carryingHuId); await refresh(); await focus("asset", cell.assetId);
  const picking = await sample("celula-picking-continua", 5200, true, 1500, "07-celula-picking");
  assert.ok(picking.uniqueAutomationFrames > picking.stateResponses + 2, "La célula no debe saltar entre respuestas del servidor");
  assert.ok(unique(picking.rows.map(row => row.diagnostic.automation.caseOffsets).filter(rows => rows?.length)) > 3,
    "Las cajas reales deben acompañar al brazo, no sólo cambiar el indicador de progreso");
  const loadingState = seek(s => s.orders.find(row => row.id === order.id)?.state === "LOADING" && s.robots.some(robot => robot.type === "FORKLIFT" && robot.carryingHuId), "Carga automática de salida");
  const truck = loadingState.trucks.find(row => row.orderId === order.id);
  await refresh(); await focus("truck", truck.id); await capture("08-carga-camion");
  const loading = await sample("carga-camion-continua", 3200);
  const forklift = loadingState.robots.find(robot => robot.type === "FORKLIFT" && robot.carryingHuId);
  const forkliftMotion = loading.rows.map(row => {
    const mover = row.diagnostic.movers.find(item => item.id === forklift.id);
    return mover && { position: mover.position, liftHeight: mover.liftHeight, rotation: mover.rotation };
  });
  assert.ok(unique(forkliftMotion) > loading.stateResponses + 2, "El montacargas debe interpolar desplazamiento y elevación entre respuestas");
  const destination = seek(s => s.autonomy.jobs.some(job => job.documentId === order.id && job.state === "DESTINATION_RECEIVING"), "Recepción autónoma en tienda");
  assert.equal(destination.metrics.storeCases, 0);
  await refresh(); await focus("asset", "ASSET-STORE-RECEIVING-TIENDA-1");
  const storeMotion = await sample("recepcion-tienda-continua", 4200, true, 1200, "09-recepcion-tienda");
  assert.ok(storeMotion.uniqueAutomationFrames > storeMotion.stateResponses + 2);
  const deliveredHuId = destination.orders.find(row => row.id === order.id).allocations[0].huId;
  const storeLoadPositions = storeMotion.rows.map(row => row.diagnostic.loads.find(load => load.id === deliveredHuId)?.position);
  assert.ok(unique(storeLoadPositions) > storeMotion.stateResponses + 2,
    "La HU de la tienda debe salir físicamente del remolque hacia la recepción, no sólo animar el portal");
  const done = seek(s => s.autonomy.jobs.every(job => closed(job.state)) && s.trucks.every(row => row.state === "AVAILABLE") && s.missions.every(row => closed(row.state)), "Regreso y liberación");
  assert.equal(done.metrics.warehouseCases, 6); assert.equal(done.metrics.storeCases, 6);
  assert.equal(done.autonomy.exceptions.length, 0); assert.equal(done.receipts.length, 1);
  assert.ok(done.autonomyDevices.every(device => !device.carryingHuId && !device.processId));
  record("Compra a tienda completa: 12 cajas recibidas, 6 entregadas, 6 almacenadas; sin duplicados y todos los equipos liberados");
  command("simulation.pause", { paused: true }); await refresh();
  await closeInspector(); await page.locator("#map-find").fill("");
  await page.locator('[data-camera="overview"]').click(); await page.waitForTimeout(1100);
  for (const theme of ["dark", "light"]) { await page.evaluate(value => window.DonPepeTheme.set(value), theme); await capture(`10-exterior-${theme}`); }
  await page.setViewportSize({ width: 390, height: 844 }); await ready(); await page.waitForTimeout(1200); await capture("11-mapa-movil");
  assert.equal(metrics.at(-1).layout.headers.length, 1, "La navegación móvil debe tener un único encabezado");
  assert.deepEqual(errors, []); record("Tema claro/oscuro y móvil sin desbordamiento; cero errores JavaScript");
}
(async () => {
  try { await main(); }
  catch (error) {
    failure = error; process.stderr.write(error.stack + "\n");
    try { await page?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }); } catch {}
  } finally {
    clearInterval(timer); await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve)); runtime?.close();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "verificacion-mapa-autonomo.json"), JSON.stringify({ ok: !failure, startedAt, checks, errors, screenshots, metrics, samples, stages,
      environment: { gpu, requested: nativeGpu ? "Native GPU" : "SwiftShader diagnostic", data: "SQLite in memory only", email: "No outbound email", fingerprints }, failure: failure?.message || null }, null, 2));
    process.stdout.write(`${checks.length} comprobaciones; ${screenshots.length} capturas. ${output}\n`);
    if (failure) process.exitCode = 1;
  }
})();
