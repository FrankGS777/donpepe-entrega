"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  { once } = require("node:events");
const { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server"),
  { createSimulation } = require("../core/engine"),
  { createStore } = require("../core/store");
const out = process.env.DONPEPE_MAP_STARTUP_QA_OUTPUT || path.resolve(__dirname, "../../../mapa-carga-20261102/startup" + (process.env.QA_FORCE_WEBGL ? "-webgl2" : ""));
const checks = [],
  errors = [],
  measurements = [];
let runtime, server, browser, folder, page, liveTimer;
async function main() {
  fs.mkdirSync(out, { recursive: true });
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "dp-camera-"));
  const filename = path.join(folder, "simulation.sqlite"),
    sim = createSimulation({ filename });
  const db = createStore(filename),
    s = db.read(),
    location = s.layout.locations.find(
      (l) => l.zoneId === "DRY" && l.aisle === 5 && l.level === 3,
    );
  s.hus[0].locationId = location.id;
  db.write(s);
  db.close();
  runtime = createApp({
    identityFile: ":memory:",
    simulation: sim,
    startClock: false,
    mailEnv: {},
    mailTransport: {
      sendMail: async () => {
        throw Error("No mail in QA");
      },
      close() {},
    },
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    args: ["--enable-webgl", "--disable-dev-shm-usage"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: process.env.QA_CAMERA_TIMING ? "no-preference" : "reduce",
  });
  assert.equal(
    (
      await ctx.request.post(base + "/api/login", {
        data: { email: "operaciones@donpepe.local", password: "DonPepe2026!" },
      })
    ).status(),
    200,
  );
  page = await ctx.newPage();
  page.on("pageerror", (e) => {errors.push(e.message); console.error(e.message);});
  page.on("console", m=>{if(m.type()==="error"){errors.push(m.text());console.error("BROWSER:",m.text());}});
  const cdp = process.env.PROFILE_MAP ? await ctx.newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await page.goto(base + (process.env.QA_FORCE_WEBGL ? "/?renderer=webgl2#overview" : "/#overview"));
  let modelRequests = 0;
  page.on('request', request => {
    if (request.url().includes('/models/donpepe-industrial-v1.glb')) modelRequests++;
  });
  const openMap = page.getByRole("button", { name: "Abrir mapa 3D", exact: true });
  await openMap.waitFor();
  assert.equal(await page.locator("#map-host canvas").count(), 0);
  assert.equal(modelRequests, 0, 'La portada debe mostrarse sin descargar la malla 3D');
  await openMap.click();
  await page
    .locator('#map-host[data-scene-ready="true"]')
    .waitFor({ timeout: 60000 });
  const host = page.locator('#map-host');
  if (cdp) fs.writeFileSync(path.join(out,'profile.json'),JSON.stringify(await cdp.send('Profiler.stop')));
  const first = await host.evaluate(h => h.getSceneDiagnostics());
  const models = first.geometry.blenderParts;
  for (const name of ['DepotFront', 'DepotRoof', 'DeliveryCab', 'Forklift', 'AMR', 'Stacker',
    'RobotForearm', 'VisionSensor', 'RackBeam', 'ConveyorLeg', 'StoreCorner',
    'AmrLiftDeck', 'IndustrialWheel', 'BayGantry', 'ConveyorBearing', 'DistributorBase',
    'PickerGripper', 'RollerDrive', 'StackerLift'])
    assert(models.includes(name), 'Debe estar disponible el modelo Blender ' + name);
  assert.equal(modelRequests, 1);
  checks.push('Modelos Blender cargados al abrir el mapa 3D');
  const delivery = await new Promise((resolve, reject) => {
    require('node:http').get(base + '/app.js', {headers:{'Accept-Encoding':'gzip'}}, res => {
      let bytes=0; res.on('data',chunk=>bytes+=chunk.length);
      res.on('end',()=>resolve({encoding:res.headers['content-encoding'],bytes})); res.on('error',reject);
    }).on('error',reject);
  });
  assert.equal(delivery.encoding,'gzip');
  delivery.originalBytes=fs.statSync(path.join(__dirname,'../public/app.js')).size;
  assert(delivery.bytes < delivery.originalBytes*.5, 'Script delivery must be compressed');
  measurements.push({delivery});
  assert.equal(first.surfaces.variants,0, 'Repeated materials must share GPU images');
  assert.equal(first.surfaces.photographicSources,4);
  assert.deepEqual(first.surfaces.missingAssets,[]);
  assert.equal(first.renderer.quality,'high');
  assert.equal(first.renderer.shadowMapSize,4096);
  assert.equal(first.renderer.samples,4);
  assert.equal(first.renderer.ambientOcclusion,'GTAO-16-three-quarter');
  assert.equal(first.renderer.areaLights,6);
  assert.equal(first.renderer.frameCap,60);
  assert(first.exterior.buildings >= 50);
  assert(first.exterior.parkedVehicles >= 30);
  assert(first.exterior.streetlights >= 35);
  assert.equal(first.exterior.sceneryOnly, true);
  measurements.push({firstLoad:first.lifecycle, exterior:first.exterior, renderer:first.renderer});
  checks.push('Entorno con edificios, patios, aceras, cerros y cielo sin entidades logísticas ficticias');
  await page.screenshot({path:path.join(out,'01-exterior.png')});
  await host.evaluate(h => {window.qaMapHost=h;window.qaMapCanvas=h.querySelector('canvas');});
  const returns=[];
  let textureRequests=0;
  page.on('request',r=>{if(r.url().includes('/textures/'))textureRequests++;});
  for(const destination of ['orders','purchases','equipment','inventory']) {
    await page.evaluate(v=>{location.hash=v;},destination);
    await page.waitForFunction(v=>document.body.dataset.view===v,destination);
    await page.waitForTimeout(150);
    const asleep=await page.evaluate(()=>({connected:qaMapHost.isConnected,d:qaMapHost.getSceneDiagnostics()}));
    assert.equal(asleep.connected,false);
    assert.equal(asleep.d.lifecycle.active,false);
    const frameCount=asleep.d.renderer.frames;
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(()=>qaMapHost.getSceneDiagnostics().renderer.frames),frameCount,'La GPU debe descansar fuera del mapa');
    const started=Date.now();
    await page.evaluate(()=>{location.hash='overview';});
    await page.locator('#map-host[data-scene-ready="true"]').waitFor({timeout:10000});
    const returned=await host.evaluate(h=>({sameHost:h===window.qaMapHost,sameCanvas:h.querySelector('canvas')===window.qaMapCanvas,d:h.getSceneDiagnostics()}));
    assert(returned.sameHost && returned.sameCanvas,'Debe conservar el contexto y lienzo');
    assert.equal(returned.d.lifecycle.instanceId,first.lifecycle.instanceId);
    assert.equal(returned.d.lifecycle.buildCount,first.lifecycle.buildCount,'No reconstruir arquitectura al volver');
    assert(returned.d.lifecycle.active);
    assert.equal(returned.d.renderer.backend,process.env.QA_FORCE_WEBGL?'webgl2':'webgpu');
    returns.push({from:destination,ms:Date.now()-started});
  }
  assert.equal(modelRequests, 1, 'Volver al mapa debe reutilizar sus modelos');
  assert.equal(textureRequests,0,'Volver desde operaciones no debe descargar de nuevo texturas');
  measurements.push({returns,textureRequests});
  checks.push('Pedidos, recepción, equipos e inventario: mismo lienzo y motor, cero recompilación de arquitectura y cero nuevas descargas de texturas');
  checks.push('Renderizado detenido mientras se navega por otro módulo');
  if (process.env.QA_CAMERA_TIMING) {
    const switches = [];
    for (const next of ['interior', 'overview', 'interior', 'overview']) {
      const started = Date.now();
      await page.locator(`[data-camera="${next}"]`).click();
      await page.waitForFunction(view => {
        const host = document.querySelector('#map-host');
        const d = host.getSceneDiagnostics();
        const expectedHeight = view === 'interior' ? 8.2 : 64;
        return host.dataset.renderedView === view && Math.abs(d.camera.position[1] - expectedHeight) < .001;
      }, next);
      switches.push({view:next, ms:Date.now() - started});
    }
    measurements.push({switches});
    checks.push('Cambios de Exterior e Interior medidos con animaciones activadas');
    await page.waitForTimeout(650);
  }
  if (process.env.QA_CLOSEUPS) {
    const captures=[['robot','AMR-1'],['robot','FORKLIFT-1'],['robot','STACKER-1'],['asset','ASSET-PIE-IN-1'],['asset','ASSET-CASE-PICKER-1'],['robot','SHUTTLE-1'],['asset','ASSET-AUTO-ID-IN-1'],['asset','ASSET-AUTO-UNLOADER-IN-1'],['asset','ASSET-INBOUND-CONVEYOR-1'],['asset','ASSET-STORE-RECEIVING-TIENDA-1']];
    for (const [type,id] of captures) {
      await page.locator('#map-find').fill(id);
      const result=page.locator(`#map-results [data-inspect="${type}"][data-id="${id}"]`);
      if (!await result.count()) continue;
      await result.click();
      await page.waitForTimeout(450);
      const canvas=page.locator('#map-host canvas');
      const bounds=await canvas.boundingBox();
      await page.mouse.move(bounds.x+bounds.width*.50,bounds.y+bounds.height*.50);
      await page.mouse.wheel(0,-680);
      await page.waitForTimeout(500);
      await canvas.screenshot({path:path.join(out,`detalle-${id}.png`)});
    }
    await page.locator('#map-find').fill('');
    const close=page.locator('#map-inspector [data-action="close-inspector"]');
    if (await close.count()) await close.click();
    await page.locator('[data-camera="interior"]').click();
    await page.waitForTimeout(600);
    const frameStart=await host.evaluate(h=>h.getSceneDiagnostics().renderer.frames);
    await page.waitForTimeout(2000);
    const diagnostics=await host.evaluate(h=>h.getSceneDiagnostics());
    measurements.push({steadyRenderer:diagnostics.renderer,framesDuringTwoSeconds:diagnostics.renderer.frames-frameStart,physics:diagnostics.physics});
  }
  for (const view of ['interior','aisle','overview']) {
    await page.locator(`[data-camera="${view}"]`).click();
    await page.locator('#map-host[data-scene-ready="true"]').waitFor({timeout:15000});
    if (view !== 'overview') {
      const height = view === 'interior' ? 8.2 : 1.85;
      await page.waitForFunction(({ view, height }) => {
        const d = document.querySelector('#map-host').getSceneDiagnostics();
        return d.view === view && Math.abs(d.camera.position[1] - height) < .001;
      }, { view, height });
      const cameraBefore = await host.evaluate(h => h.getSceneDiagnostics().camera);
      const canvas = await page.locator('#map-host canvas').boundingBox();
      const x = canvas.x + canvas.width * .53, y = canvas.y + canvas.height * .43;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 106, y - 52, {steps: 6});
      await page.mouse.up();
      const cameraAfter = await host.evaluate(h => h.getSceneDiagnostics().camera);
      assert.deepEqual(cameraAfter.position, cameraBefore.position, `${view}: dragging must keep the camera at the same point`);
      assert(cameraAfter.target[1] > cameraBefore.target[1], `${view}: dragging up must look up`);
      assert(Math.hypot(...cameraAfter.target.map((v, i) => v - cameraBefore.target[i])) > .5);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 74, y, {steps: 4});
      await page.mouse.move(x, y, {steps: 4});
      await page.mouse.up();
      assert.equal(await host.evaluate(h => h.getSceneDiagnostics().inspection.selected), null, 'A drag returning to its start must never select an object');
      await page.locator(`[data-camera="${view}"]`).click();
      await page.waitForTimeout(150);
    }
    await page.screenshot({path:path.join(out,`view-${view}.png`)});
  }
  checks.push('Interior y Pasillo giran la mirada sin desplazar la cámara ni seleccionar durante el arrastre');
  const huId = s.hus[0].id;
  const rack = s.layout.racks.find(row => row.id === location.rackId);
  await page.locator('#map-find').fill(huId);
  await page.locator(`#map-results [data-inspect="hu"][data-id="${huId}"]`).click();
  await page.waitForFunction(({ x, z }) => {
    const { view, camera } = document.querySelector('#map-host').getSceneDiagnostics();
    return view === 'interior' && Math.abs(camera.target[0] - x) < .01 && Math.abs(camera.target[2] - z) < .01;
  }, location);
  const frontCamera = await host.evaluate(h => h.getSceneDiagnostics().camera);
  assert.equal(Math.sign(frontCamera.position[2] - location.z), Math.sign(rack.railZ - rack.z));
  assert(Math.abs(frontCamera.position[2] - location.z) <= Math.abs(rack.railZ - rack.z));
  await page.screenshot({path:path.join(out,'04-carga-desde-pasillo.png')});
  await page.locator('#map-inspector [data-action="close-inspector"]').click();
  const projectedHu = await host.evaluate((h, id) => h.getSceneProjection('hu', id), huId);
  assert(projectedHu.visible);
  await page.mouse.click(projectedHu.x, projectedHu.y);
  assert.equal(await host.evaluate(h => h.getSceneDiagnostics().inspection.selected), `hu:${huId}`);
  await page.locator('#map-inspector [data-action="close-inspector"]').click();
  const equipmentId = 'FORKLIFT-1';
  await page.locator('#map-find').fill(equipmentId);
  await page.locator(`#map-results [data-inspect="robot"][data-id="${equipmentId}"]`).click();
  await page.waitForFunction(id => {
    const d = document.querySelector('#map-host').getSceneDiagnostics();
    const mover = d.movers.find(row => row.id === id);
    return Math.hypot(d.camera.target[0] - mover.position[0], d.camera.target[2] - mover.position[2]) < .01;
  }, equipmentId);
  const { camera, movers } = await host.evaluate(h => h.getSceneDiagnostics());
  const { rotation } = movers.find(row => row.id === equipmentId);
  const dx = camera.position[0] - camera.target[0], dz = camera.position[2] - camera.target[2];
  assert(dx * Math.sin(rotation) + dz * Math.cos(rotation) > .99 * Math.hypot(dx, dz), 'The forklift must be framed from the forks');
  await page.locator('#map-inspector [data-action="close-inspector"]').click();
  await page.locator('#map-find').fill('');
  checks.push('La carga del rack se selecciona con clic o búsqueda y se enfoca desde su cara de acceso. El montacargas se encuadra desde sus horquillas');
  await page.locator('[data-camera="network"]').click();
  await page.waitForTimeout(500);
  await page.screenshot({path:path.join(out,'02-red-tiendas.png')});
  // Low-angle orbit exposes the coastal relief behind the urban blocks.
  await page.locator('[data-camera="overview"]').click();
  await page.waitForTimeout(500);
  const bounds=await page.locator('#map-host canvas').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+bounds.height*.45);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.45,bounds.y+bounds.height*.45+90,{steps:10});
  await page.mouse.up();await page.waitForTimeout(600);
  await page.screenshot({path:path.join(out,'03-horizonte.png')});
  if(process.env.QA_LIVE_FLOW) {
    const actor={id:'QA-OPS',role:'operations'};
    const before=runtime.simulation.snapshot(actor),sku=before.catalog.skus.find(row=>row.id==='SKU-ARROZ');
    const purchase=runtime.simulation.command('purchase.create',{supplierId:sku.supplierId,lines:[{skuId:sku.id,cases:4}]},actor);
    runtime.simulation.command('order.release',{id:'PED-00001'},actor);
    runtime.simulation.command('simulation.speed',{speed:5},actor);
    await page.locator('#map-find').fill('ASSET-PIE-IN-1');
    await page.locator('#map-results [data-inspect="asset"][data-id="ASSET-PIE-IN-1"]').click();
    liveTimer=setInterval(()=>runtime.simulation.advance(.1),100);
    const observed=new Set(),rates=[];let priorFrames,priorAt;
    for(let index=0;index<320;index++) {
      await page.waitForTimeout(250);
      const state=runtime.simulation.snapshot(actor);
      const job=state.autonomy.jobs.find(row=>row.documentId===purchase.id);
      const phase=job?.state || 'WAITING';
      const d=await host.evaluate(h=>h.getSceneDiagnostics());
      assert(d.loads.every(load=>load.position.every(Number.isFinite)),'Loads must retain finite supported coordinates');
      if(priorAt && index%8===0) {
        rates.push((d.renderer.frames-priorFrames)/((Date.now()-priorAt)/1000));
        priorFrames=d.renderer.frames;priorAt=Date.now();
      } else if(!priorAt) {priorFrames=d.renderer.frames;priorAt=Date.now();}
      if(!observed.has(phase)) {
        observed.add(phase);
        await page.screenshot({path:path.join(out,`flujo-${phase}.png`)});
      }
      if(state.autonomy.jobs.length>=2 && state.autonomy.jobs.every(row=>row.state==='COMPLETED'))break;
    }
    clearInterval(liveTimer);liveTimer=null;
    measurements.push({liveFlow:{purchase:purchase.id,phases:[...observed],renderedFramesPerSecond:rates}});
    checks.push('Recepción y despacho autónomos observados con los modelos nuevos y el reloj a 5×');
  }
  assert.deepEqual(errors,[]);
}
main()
  .catch(async (e) => {
    errors.push(e.stack || e.message);
    console.error(e);
    try {
      await page?.screenshot({ path: path.join(out, "failure.png") });
    } catch {}
    process.exitCode = 1;
  })
  .finally(async () => {
    clearInterval(liveTimer);
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify({ checks, measurements, errors }, null, 2),
    );
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    console.log(JSON.stringify({ checks, errors }));
  });
