"use strict";
// Exercises the real 3D observer and complete warehouse flow in isolated data.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const actor = { id: "QA", role: "operations" },
  output = path.resolve(__dirname, "../../../map-animation-20261027");
const errors = [],
  checks = [],
  samples = [];
let runtime, server, browser, page, timer;
const state = () => runtime.simulation.snapshot(actor);
function seek(predicate, description) {
  for (let i = 0; i < 4000; i++) {
    const s = state();
    if (predicate(s)) return s;
    runtime.simulation.advance(0.5);
  }
  throw Error(description + ": no se alcanzó la fase esperada");
}
function live(enabled) {
  clearInterval(timer);
  timer = null;
  if (enabled)
    timer = setInterval(() => {
      try {
        runtime.simulation.advance(0.1);
      } catch (error) {
        errors.push(error.message);
        live(false);
      }
    }, 100);
}
async function ready(truckId) {
  await page.reload();
  await page
    .locator('#map-host[data-scene-ready="true"]')
    .waitFor({ timeout: 30000 });
  await page.locator("#map-find").fill(truckId);
  await page
    .locator(`#map-results [data-inspect="truck"][data-id="${truckId}"]`)
    .click();
  await page.waitForTimeout(1200);
}
async function sample(name, id, milliseconds = 5500) {
  live(true);
  const frames = await page.evaluate(
    async ({ id, milliseconds }) => {
      const values = [],
        start = performance.now();
      await new Promise((resolve) => {
        const frame = () => {
          const d = document
              .querySelector("#map-host")
              ?.getSceneDiagnostics?.(),
            m = d?.movers?.find((row) => row.id === id);
          if (m)
            values.push({
              at: performance.now() - start,
              position: m.position,
              heading: m.rotation,
              doors: m.doorProgress,
              frame: d.renderer.frames,
            });
          if (performance.now() - start < milliseconds)
            requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      });
      return values;
    },
    { id, milliseconds },
  );
  live(false);
  let maxStep = 0,
    maxTurn = 0,
    backtracks = 0,
    previousDelta;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1],
      b = frames[i],
      delta = [b.position[0] - a.position[0], b.position[2] - a.position[2]],
      length = Math.hypot(...delta);
    maxStep = Math.max(maxStep, length);
    maxTurn = Math.max(
      maxTurn,
      Math.abs(
        Math.atan2(
          Math.sin(b.heading - a.heading),
          Math.cos(b.heading - a.heading),
        ),
      ),
    );
    if (
      previousDelta &&
      length > 0.001 &&
      previousDelta[0] * delta[0] + previousDelta[1] * delta[1] < -0.0001
    )
      backtracks++;
    if (length > 0.001) previousDelta = delta;
  }
  assert(frames.length > 20, `${name}: no hubo suficientes cuadros`);
  assert(maxStep < 1.5, `${name}: salto de ${maxStep} metros entre cuadros`);
  assert(maxTurn < 0.35, `${name}: giro brusco de ${maxTurn} radianes`);
  assert(backtracks === 0, `${name}: retrocesos erráticos`);
  const diagnostic = await page.evaluate(() =>
    document.querySelector("#map-host").getSceneDiagnostics(),
  );
  samples.push({
    name,
    frames: frames.length,
    maxStep,
    maxTurn,
    backtracks,
    diagnostic,
  });
  await page.screenshot({ path: path.join(output, name + ".png") });
  checks.push(name);
  console.log(
    name,
    JSON.stringify({ frames: frames.length, maxStep, maxTurn, backtracks }),
  );
}
async function run() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-truck-map-")),
    startClock: false,
  });
  runtime.simulation.command("order.release", { id: "PED-00001" }, actor);
  const approach = seek(
    (s) =>
      s.trucks.some(
        (t) =>
          t.state === "OUTBOUND" &&
          t.trip.guideIndex === t.trip.waypoints.length - 1 &&
          Math.hypot(t.x - t.trip.to.x, t.z - t.trip.to.z) < 2,
      ),
    "Aproximación a tienda",
  );
  const id = approach.trucks.find((t) => t.orderId === "PED-00001").id;
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--enable-webgl", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  assert.equal(
    (
      await context.request.post(base + "/api/login", {
        data: { email: "operaciones@donpepe.local", password: "DonPepe2026!" },
      })
    ).status(),
    200,
  );
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await ready(id);
  await sample("01-llegada-tienda", id, 6500);
  seek(
    (s) => s.autonomy.jobs[0].state === "DESTINATION_RECEIVING",
    "Descarga en tienda",
  );
  await ready(id);
  await sample("02-descarga-tienda", id, 6000);
  seek(
    (s) => s.trucks.some((t) => t.id === id && t.state === "RETURNING"),
    "Inicio del retorno",
  );
  await ready(id);
  await sample("03-retorno-salida", id);
  seek(
    (s) =>
      s.trucks.some((t) => {
        if (t.id !== id || t.state !== "RETURNING") return false;
        const target = t.trip.waypoints[t.trip.guideIndex ?? 1];
        if (!target) return false;
        const heading =
          target.heading ?? Math.atan2(target.x - t.x, target.z - t.z);
        return (
          Math.abs(
            Math.atan2(
              Math.sin(heading - t.heading),
              Math.cos(heading - t.heading),
            ),
          ) > 0.7
        );
      }),
    "Cruce del retorno",
  );
  await ready(id);
  await sample("04-retorno-cruce", id);
  const final = seek(
    (s) => s.autonomy.jobs[0].state === "COMPLETED",
    "Liberación del camión",
  );
  assert.equal(final.metrics.storeCases, 6);
  assert.equal(final.metrics.storeCases + final.metrics.warehouseCases, 360);
  runtime.simulation.command("simulation.pause", { paused: true }, actor);
  await ready(id);
  await page.waitForTimeout(1500);
  const first = await page.locator("#map-host canvas").screenshot();
  await page.waitForTimeout(400);
  const second = await page.locator("#map-host canvas").screenshot();
  assert(
    first.equals(second),
    "La escena en reposo debe permanecer estable, sin parpadeos",
  );
  checks.push("Escena estática estable y balance de existencias conservado");
  assert.deepEqual(errors, []);
}
run()
  .catch((error) => {
    errors.push(error.stack || error.message);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    live(false);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify({ checks, samples, errors }, null, 2),
    );
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
  });
