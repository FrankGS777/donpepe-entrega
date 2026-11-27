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
const out = path.resolve(__dirname, "../../../mapa-entorno-sesion-20261029" + (process.env.QA_FORCE_WEBGL ? "-webgl2" : ""));
const checks = [],
  errors = [],
  measurements = [];
let runtime, server, browser, folder, page;
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
    reducedMotion: "reduce",
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
  await page.goto(base + (process.env.QA_FORCE_WEBGL ? "/?renderer=webgl2#map" : "/#map"));
  await page
    .locator('#map-host[data-scene-ready="true"]')
    .waitFor({ timeout: 60000 });
  const host = page.locator('#map-host');
  const first = await host.evaluate(h => h.getSceneDiagnostics());
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
  assert.equal(textureRequests,0,'Volver desde operaciones no debe descargar de nuevo texturas');
  measurements.push({returns,textureRequests});
  checks.push('Pedidos, recepción, equipos e inventario: mismo lienzo y motor, cero recompilación de arquitectura y cero nuevas descargas de texturas');
  checks.push('Renderizado detenido mientras se navega por otro módulo');
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
