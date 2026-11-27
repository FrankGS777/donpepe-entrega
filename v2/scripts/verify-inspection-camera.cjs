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
const out = path.resolve(__dirname, (process.env.QA_FORCE_WEBGL ? "../../../mapa-webgpu-20261029-webgl2" : "../../../mapa-webgpu-20261029"));
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
  const verifyCanvas = async () => {
    const png=PNG.sync.read(await page.locator("#map-host canvas").screenshot());
    let black=0,total=0; const colors=new Set();
    for(let y=0;y<png.height;y+=8)for(let x=0;x<png.width;x+=8){const i=(y*png.width+x)*4,r=png.data[i],g=png.data[i+1],b=png.data[i+2];black+=r+g+b<12;total++;colors.add(`${r>>4},${g>>4},${b>>4}`);}
    assert(black/total<.25,"El mapa no debe producir una imagen negra");
    assert(colors.size>20,"La escena debe tener geometría y materiales visibles");
  };
  const diagnostic = () =>
    page.locator("#map-host").evaluate((host) => host.getSceneDiagnostics());
  for (const mode of ["overview","interior","aisle","network"]) {
    await page.locator(`[data-camera="${mode}"]`).click();
    await page.waitForTimeout(650);
    await verifyCanvas();
    await page.screenshot({path:path.join(out,`00-${mode}.png`)});
  }
  await page.locator("#map-find").fill("HU-00001");
  await page
    .locator('#map-results [data-inspect="hu"][data-id="HU-00001"]')
    .click();
  await page.waitForTimeout(600);
  await verifyCanvas();
  const data = await diagnostic();
  assert.equal(data.inspection.selected, "hu:HU-00001");
  assert.equal(data.inspection.enabled, false);
  assert.equal(data.inspection.hiddenPieces, 0);
  assert.equal(data.surfaces.photographicSources,4);
  assert.deepEqual(data.surfaces.missingAssets,[]);
  assert.equal(data.renderer.environment,"HDRI");
  measurements.push({renderer:data.renderer,surfaces:data.surfaces});
  assert.equal(data.camera.projection, "perspective");
  const pose = data.loads.find((h) => h.id === "HU-00001").position;
  assert(Math.abs(data.camera.position[0] - pose[0]) < 0.05);
  assert(Math.abs(data.camera.target[2] - pose[2]) < 0.05);
  assert(Math.abs(data.camera.position[1] - data.camera.target[1]) < 0.2);
  assert.equal(await page.locator("#dialog[open]").count(), 0);
  checks.push(
    "Frente del palé en el último pasillo y nivel alto, sin modal ni encuadre detrás del rack",
  );
  await page.screenshot({ path: path.join(out, "01-frente-del-pale.png") });
  await page.locator('[data-action="close-inspector"]').click();
  await page.locator("#map-find").fill("");
  const projection = await page
    .locator("#map-host")
    .evaluate((host) => host.getSceneProjection("hu", "HU-00001"));
  assert(projection.visible);
  await page.mouse.click(projection.x, projection.y);
  await page.waitForTimeout(450);
  assert.equal(await page.locator("#dialog[open]").count(), 0);
  assert.match(await page.locator("#map-inspector").textContent(), /HU-00001/);
  checks.push(
    "Clic directo selecciona la carga y enfoca, sin selector emergente",
  );
  await page.locator('[data-action="close-inspector"]').click();
  // Select again for inspection, then rotate freely while the cutaway follows.
  await page.locator("#map-find").fill("HU-00001");
  await page
    .locator('#map-results [data-inspect="hu"][data-id="HU-00001"]')
    .click();
  await page.locator("#map-find").fill("");
  await page.waitForTimeout(400);
  const canvas = await page.locator("#map-host canvas").boundingBox();
  let complete = true;
  for (let turn = 0; turn < 5; turn++) {
    const x = canvas.x + canvas.width * 0.43,
      y = canvas.y + canvas.height * 0.45;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 170, y - 50, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const info = await diagnostic();
    measurements.push(info.inspection);
    assert.equal(info.inspection.hiddenPieces, 0);
    assert.equal(info.inspection.enabled, false);
    complete &&= info.renderer.calls > 0;
  }
  assert(complete, "El modelo debe seguir renderizándose completo al girar");
  await page.screenshot({path:path.join(out,"02-giro-sin-ocultacion.png")});
  assert.equal(await page.locator("#dialog[open]").count(), 0);
  checks.push(
    "Seleccionar y girar conserva todos los objetos sin cortes ni ocultación",
  );
  await page.locator('[data-camera="interior"]').click();
  await page.waitForTimeout(400);
  const restored = await diagnostic();
  assert.equal(restored.inspection.hiddenPieces, 0);
  assert.equal(restored.inspection.enabled, false);
  checks.push("Cambiar perspectiva restaura el almacén completo");
  for (const theme of ["dark", "light"]) {
    await page.evaluate((theme) => window.DonPepeTheme.set(theme), theme);
    await page.locator("#map-find").fill("HU-00001");
    await page
      .locator('#map-results [data-inspect="hu"][data-id="HU-00001"]')
      .click();
    await page.waitForTimeout(400);
    await verifyCanvas();
    await page.screenshot({ path: path.join(out, `03-frontal-${theme}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#map-find").fill("HU-00001");
  await page
    .locator('#map-results [data-inspect="hu"][data-id="HU-00001"]')
    .click();
  await page.waitForTimeout(400);
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 2,
    ),
  );
  const mobile = await page.locator("#map-host").evaluate((host) => {
    const p = host.getSceneProjection("hu", "HU-00001"),
      r = document.querySelector("#map-inspector").getBoundingClientRect();
    return { p, top: r.top, bottom: r.bottom };
  });
  assert(
    mobile.p.y < mobile.top || mobile.p.y > mobile.bottom,
    "La ficha móvil no debe cubrir la carga seleccionada",
  );
  await page.screenshot({ path: path.join(out, "04-frontal-movil.png") });
  await page.locator('[data-action="toggle-inspection-details"]').click();
  assert.equal(
    await page.locator("#map-inspector").getAttribute("data-expanded"),
    "true",
  );
  await page.locator('[data-action="toggle-inspection-details"]').click();
  checks.push(
    "La ficha móvil se resume para dejar visible el palé y permite desplegar sus detalles",
  );
  assert.deepEqual(errors, []);
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
