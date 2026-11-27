"use strict";
// Run the real UI against isolated databases; never change the user's records.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const { createSimulation } = require("../core/engine");
const out = path.resolve(__dirname, "../../../official-traceability-20261027");
const checks = [],
  errors = [];
const ops = { id: "u-operations", role: "operations" };
const storeActor = { id: "u-store", role: "store", branchId: "TIENDA-1" };
let runtime, server, browser, folder;
function check(message) {
  checks.push(message);
  console.log(message);
}
async function main() {
  fs.mkdirSync(out, { recursive: true });
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "dp-official-trace-"));
  runtime = createApp({
    dataDir: folder,
    simulation: createSimulation({ controlledReceivingFixture: true }),
    startClock: false,
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  async function login(role, view) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    assert.equal(
      (
        await context.request.post(base + "/api/login", {
          data: { email: `${role}@donpepe.local`, password: "DonPepe2026!" },
        })
      ).status(),
      200,
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/#${view}`);
    await page.locator("#main h1").waitFor();
    return { context, page };
  }
  const { context: storeContext, page: storePage } = await login(
    "tienda",
    "shop",
  );
  const qty = storePage.locator('[data-store-quantity="SKU-ARROZ"]');
  await qty.fill("2");
  await storePage.locator('[data-store-action="checkout"]').click();
  const createResponse = storePage.waitForResponse(
    (r) =>
      r.url().endsWith("/api/commands") &&
      r.request().postDataJSON()?.type === "order.create",
  );
  await storePage.locator('#store-checkout-form button[type="submit"]').click();
  const created = await (await createResponse).json();
  assert(created.result.id);
  const official = runtime.simulation
    .snapshot(ops)
    .orders.find((o) => o.id === created.result.id);
  assert.equal(official.source, "STORE");
  assert.equal(official.branchId, "TIENDA-1");
  check("La tienda envía una solicitud oficial desde su catálogo");
  const { context: opsContext, page } = await login("operaciones", "orders");
  await page
    .locator(`[data-action="open-order"][data-id="${official.id}"]`)
    .waitFor();
  assert.equal(
    await page
      .locator('[data-action="simulate-request"],[data-action="new-order"]')
      .count(),
    0,
  );
  const me = await (await opsContext.request.get(base + "/api/me")).json();
  assert(!me.user.permissions.includes("simulation.request"));
  assert.equal(
    (
      await opsContext.request.post(base + "/api/commands", {
        headers: { "x-csrf-token": me.csrf },
        data: { type: "simulation.request", payload: {} },
      })
    ).status(),
    403,
  );
  check(
    "Operaciones recibe la solicitud y no puede crear ni simular pedidos, tampoco por API",
  );
  await page.goto(base + "/#inventory");
  await page.locator('[data-action="sku-detail"][data-id="SKU-ARROZ"]').click();
  assert.equal(
    await page.locator('[data-trace-tab="lots"]').getAttribute("aria-selected"),
    "true",
  );
  await page.locator(".trace-lot summary").first().click();
  assert.match(
    await page
      .locator(".trace-lot[open] .trace-packaging")
      .first()
      .textContent(),
    /12 cajas × 12 unidades = 144/,
  );
  for (const theme of ["dark", "light"])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate((theme) => window.DonPepeTheme.set(theme), theme);
      await page.evaluate(() => {
        document.querySelector("#dialog").scrollTop = 0;
      });
      const dimensions = await page
        .locator("#dialog-body")
        .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert(
        dimensions.scroll <= dimensions.width + 2,
        JSON.stringify(dimensions),
      );
      await page.screenshot({
        path: path.join(out, `lot-summary-${theme}-${width}.png`),
      });
    }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('[data-trace-tab="loads"]').click();
  await page.locator(".trace-load-search").fill("zz-sin-carga");
  await page.locator(".trace-load-empty:not([hidden])").waitFor();
  await page.locator(".trace-load-search").fill("HU-00001");
  assert.equal(
    await page.locator(".trace-loads .trace-load:visible").count(),
    1,
  );
  await page
    .locator(".trace-loads .trace-load:visible [data-trace-find]")
    .click();
  await page.locator(".trace-event").first().waitFor();
  assert.equal(
    await page.locator(".trace-history-search").inputValue(),
    "HU-00001",
  );
  await page.locator("#dialog-close").click();
  check(
    "Una carga de 12 cajas conserva su identificador agrupado y explica las 144 unidades; lotes, cargas y búsqueda cruzada verificados en ambos temas",
  );
  // Confirm a physical journey to obtain real timeline facts, not invented rows.
  const sim = runtime.simulation;
  const until = (predicate) => {
    for (let i = 0; i < 1500; i++) {
      if (predicate(sim.snapshot(ops))) return;
      sim.advance(1);
    }
    assert.fail("No terminó el recorrido físico de prueba");
  };
  sim.command("order.release", { id: "PED-00001" }, ops);
  until((s) => s.orders[0].state === "READY");
  sim.command("order.dispatch", { id: "PED-00001" }, ops);
  until((s) => s.orders[0].state === "ARRIVED");
  sim.command("order.receive", { id: "PED-00001" }, storeActor);
  for (let i = 0; i < 3; i++)
    sim.command(
      "store.consume",
      { skuId: "SKU-ARROZ", cases: 1, reference: `SALIDA-QA-${i}` },
      storeActor,
    );
  await page.goto(base + "/#inventory");
  await page.locator('[data-action="sku-detail"][data-id="SKU-ARROZ"]').click();
  await page.locator('[data-trace-tab="history"]').click();
  await page.locator(".trace-event").first().waitFor();
  assert.match(
    await page.locator(".trace-current").textContent(),
    /Existencias actuales/,
  );
  assert.match(
    await page.locator(".trace-events").textContent(),
    /Salida registrada de tienda/,
  );
  assert.match(
    await page.locator(".trace-event-lot").first().textContent(),
    /Lote/,
  );
  await page.locator(".trace-history-search").fill("zzzz-sin-historial");
  await page.locator(".trace-empty").waitFor();
  await page.locator(".trace-history-search").fill("");
  await page.locator('[data-trace-tab="history"]').click();
  await page.locator(".trace-event").first().waitFor();
  if (!(await page.locator('[data-trace-page="1"]').isDisabled())) {
    await page.locator('[data-trace-page="1"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector(".trace-pagination > span")
        .textContent.startsWith("2 /"),
    );
    await page.locator('[data-trace-page="-1"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector(".trace-pagination > span")
        .textContent.startsWith("1 /"),
    );
  }
  check(
    "Trazabilidad muestra el recorrido confirmado, lotes, ubicaciones y saldos actuales separados; búsqueda y paginación inmediatas",
  );
  for (const theme of ["dark", "light"])
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate((theme) => window.DonPepeTheme.set(theme), theme);
      await page.evaluate(async () => {
        document.querySelector("#dialog").scrollTop = 0;
        await document.fonts.ready;
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      const geometry = await page
        .locator("#dialog-body")
        .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      assert(geometry.scroll <= geometry.width + 2, JSON.stringify(geometry));
      await page.screenshot({
        path: path.join(out, `trace-${theme}-${width}.png`),
      });
    }
  await page.locator("[data-trace-event]").first().click();
  await page.locator(".movement-story").waitFor();
  assert.match(
    await page.locator(".movement-balance-note").textContent(),
    /no es el stock actual/,
  );
  assert.match(
    await page.locator(".movement-story").textContent(),
    /Salida de existencias/,
  );
  await page.locator(".trace-product-link").click();
  await page.locator('[data-trace-tab="history"]').click();
  await page.locator(".trace-event").first().waitFor();
  check(
    "Cada hecho explica su efecto, origen, destino y saldo histórico; permite volver al recorrido completo",
  );
  await page.locator("#dialog-close").click();
  await page.goto(base + "/#kardex");
  await page.locator("#kardex-results tbody tr").first().waitFor();
  assert.equal(
    await page.locator("h1").textContent(),
    "Movimientos de inventario",
  );
  assert.match(
    await page.locator("#kardex-results").textContent(),
    /Salida registrada de tienda/,
  );
  await page.screenshot({ path: path.join(out, "movements-mobile.png") });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(out, "movements-desktop.png") });
  await page.locator("[data-kardex-id]").first().click();
  await page.locator(".movement-story").waitFor();
  await page.screenshot({ path: path.join(out, "movement-detail.png") });
  await page.locator("#dialog-close").click();
  await page.route("**/api/inventory/movements?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "No se pudo consultar el recorrido. Reintenta.",
      }),
    }),
  );
  await page.goto(base + "/#inventory");
  await page.locator('[data-action="sku-detail"][data-id="SKU-ARROZ"]').click();
  await page.locator('[data-trace-tab="history"]').click();
  await page.locator(".trace-error:not([hidden])").waitFor();
  assert.match(await page.locator(".trace-error").textContent(), /Reintenta/);
  await page.unroute("**/api/inventory/movements?*");
  check("Los fallos de consulta se muestran visibles en la ficha");
  await storePage.goto(base + "/#inventory");
  await storePage
    .locator('[data-action="sku-detail"][data-id="SKU-ARROZ"]')
    .click();
  await storePage.locator('[data-trace-tab="history"]').click();
  await storePage.locator(".trace-event").first().waitFor();
  assert.match(
    await storePage.locator(".trace-balances").textContent(),
    /1.*En mi tienda/,
  );
  assert(
    !/AMR-|Rack|Pasillo/.test(
      await storePage.locator(".trace-events").textContent(),
    ),
  );
  const history = await (
    await storeContext.request.get(
      base + "/api/inventory/movements?skuId=SKU-ARROZ",
    )
  ).json();
  assert(
    history.items.every(
      (row) =>
        row.from.branchId === "TIENDA-1" || row.to.branchId === "TIENDA-1",
    ),
  );
  check(
    "La tienda consulta su propia trazabilidad sin ubicaciones internas ni existencias de otras sucursales",
  );
  assert.deepEqual(errors, []);
}
main()
  .catch((error) => {
    errors.push(error.stack);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(
      path.join(out, "report.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
  });
