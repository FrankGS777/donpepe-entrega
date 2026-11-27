"use strict";
// User journeys run in temporary SQLite files, with mail blocked and no 3D.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const output =
  process.env.DONPEPE_SUPPLY_KARDEX_QA_OUTPUT ||
  path.resolve(__dirname, "../../../DonPepe-Catalogo-Kardex-2026-10-18");
const dataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "donpepe-supply-kardex-"),
);
const checks = [],
  screenshots = [],
  layouts = [],
  errors = [];
let runtime, server, browser, base, page;
const ops = { id: "qa-ops", role: "operations" },
  reader = { id: "qa-reader", role: "admin" };
const snapshot = () => runtime.simulation.snapshot(reader);
const record = (text) => {
  checks.push(text);
  process.stdout.write(text + "\n");
};
async function login(role, view) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const result = await context.request.post(`${base}/api/login`, {
    data: { email: `${role}@donpepe.local`, password: "DonPepe2026!" },
  });
  assert.equal(result.status(), 200);
  const target = await context.newPage();
  target.on("pageerror", (error) =>
    errors.push({ role, message: error.message }),
  );
  await target.goto(`${base}/#${view}`);
  await target.locator("#main h1").waitFor();
  return target;
}
async function navigate(view) {
  await page.goto(`${base}/#${view}`);
  await page.locator("#main h1").waitFor();
}
async function capture(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [
      ...document.querySelectorAll(
        "#main img,#dialog[open] img,.entity-picker-dialog[open] img,.assortment-dialog[open] img",
      ),
    ];
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    for (const animation of document.getAnimations())
      if (animation.effect?.getComputedTiming().iterations !== Infinity)
        try {
          animation.finish();
        } catch {}
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    document
      .querySelectorAll("#toasts .toast button")
      .forEach((button) => button.click());
  });
  const sizes = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll("dialog[open]")].map((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        right: rect.right,
        bottom: rect.bottom,
        height: innerHeight,
      };
    }),
  }));
  layouts.push({ name, ...sizes });
  assert(
    sizes.document <= sizes.viewport + 2,
    `${name}: horizontal overflow ${JSON.stringify(sizes)}`,
  );
  for (const dialog of sizes.dialogs)
    assert(
      dialog.x >= -1 &&
        dialog.y >= -1 &&
        dialog.right <= sizes.viewport + 1 &&
        dialog.bottom <= dialog.height + 1,
      `${name}: dialog overflow ${JSON.stringify(dialog)}`,
    );
  const clippedCards = await page
    .locator(".assortment-product")
    .evaluateAll(
      (cards) =>
        cards.filter(
          (card) =>
            card.querySelector(".assortment-quantity").getBoundingClientRect()
              .bottom >
            card.getBoundingClientRect().bottom + 1,
        ).length,
    );
  assert.equal(
    clippedCards,
    0,
    `${name}: quantity controls clipped inside cards`,
  );
  const file = path.join(output, `${name}.png`);
  await page.screenshot({
    path: file,
    fullPage: !sizes.dialogs.length,
    animations: "disabled",
  });
  screenshots.push(file);
}
async function pickSupplier(id, name) {
  await page.waitForFunction(() =>
    document
      .querySelector("#document-destination")
      ?.classList.contains("entity-original-select"),
  );
  await page
    .locator("#document-destination")
    .locator("..")
    .locator(".entity-picker-trigger")
    .click();
  await page.locator("#entity-picker-query").fill(name);
  await page.locator(`[data-picker-value="${id}"]`).click();
  await page
    .locator(".entity-picker-dialog[open]")
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator("#document-destination").inputValue(), id);
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({
    dataDir,
    startClock: false,
    mailEnv: {},
    mailTransport: {
      async sendMail() {
        throw Error("No mail in QA");
      },
      close() {},
    },
  });
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: ["--disable-dev-shm-usage"],
  });
  page = await login("operaciones", "purchases");
  const catalog = snapshot().catalog;
  const eligible = (supplierId) =>
    catalog.skus.filter(
      (item) =>
        item.active !== false &&
        (
          item.eligibleSupplierIds || [
            item.supplierId,
            ...(item.supplierIds || []),
          ]
        ).includes(supplierId),
    );
  const providers = catalog.suppliers
    .filter((item) => item.active !== false && eligible(item.id).length)
    .sort((a, b) => eligible(b.id).length - eligible(a.id).length);
  const provider = providers[0],
    product = eligible(provider.id)[0],
    second = providers.find((item) => item.id !== provider.id);
  assert(provider && product && second);
  await page.locator('[data-action="new-purchase"]').first().click();
  await pickSupplier(provider.id, provider.name);
  assert.equal(await page.locator("#line-sku").count(), 0);
  await capture("01-proveedor-catalogo");
  await page.locator("#open-supplier-catalog").click();
  await page.locator(".assortment-dialog[open]").waitFor();
  assert.equal((await page.locator(".assortment-brand").count()) > 1, true);
  assert.equal(
    await page.locator(".assortment-product").count(),
    Math.min(12, eligible(provider.id).length),
  );
  const broken = await page
    .locator(".assortment-brand-logo")
    .evaluateAll(
      (images) =>
        images.filter(
          (image) =>
            image.getAttribute("src") === "/images/resource-fallback.svg",
        ).length,
    );
  assert.equal(broken, 0);
  await capture("02-catalogo-proveedor-marcas");
  const chosenBrand = await page
    .locator("[data-assortment-brand]")
    .nth(1)
    .getAttribute("data-assortment-brand");
  await page.locator(`[data-assortment-brand="${chosenBrand}"]`).click();
  const expectedBrand = eligible(provider.id).filter(
    (item) => (item.brandId || item.brand || "") === chosenBrand,
  );
  assert.equal(
    await page.locator(".assortment-product").count(),
    Math.min(12, expectedBrand.length),
  );
  await page.locator('[data-assortment-brand=""]').click();
  await page
    .locator("#assortment-search")
    .fill(product.barcode || product.name);
  const casesInput = page.locator(`[data-assortment-cases="${product.id}"]`);
  await casesInput.fill("501");
  await page.locator("#assortment-apply").click();
  assert.equal(await page.locator("#assortment-error").isVisible(), true);
  assert.equal(await page.locator(".assortment-dialog[open]").count(), 1);
  await casesInput.fill("3");
  await page.locator("#assortment-apply").click();
  await page.locator(".assortment-dialog[open]").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator("#draft-lines [data-line-count]").inputValue(),
    "3",
  );
  record(
    "Proveedor: catálogo completo por marca, imágenes correctas, búsqueda opcional, cantidad inválida visible y selección múltiple aplicada al borrador",
  );
  await page.locator("#open-supplier-catalog").click();
  await page
    .locator("#assortment-search")
    .fill(product.barcode || product.name);
  await page.locator(`[data-assortment-cases="${product.id}"]`).fill("9");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#dialog[open]").count(), 1);
  assert.equal(
    await page.locator("#draft-lines [data-line-count]").inputValue(),
    "3",
  );
  await pickSupplier(second.id, second.name);
  assert.equal(await page.locator("#draft-lines [data-line-count]").count(), 0);
  await pickSupplier(provider.id, provider.name);
  assert.equal(
    await page.locator("#draft-lines [data-line-count]").inputValue(),
    "3",
  );
  record(
    "Borrador: Escape descarta cambios del catálogo sin cerrar el formulario; cambiar de proveedor conserva su selección separada",
  );
  await page.locator("#open-supplier-catalog").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("03-catalogo-movil-oscuro");
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await capture("04-catalogo-movil-claro");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 1000 });
  const response = page.waitForResponse(
    (result) =>
      result.url().endsWith("/api/commands") &&
      result.request().postDataJSON()?.type === "purchase.create",
  );
  await page.locator("#document-submit").click();
  const created = await response;
  assert.equal(created.status(), 200, JSON.stringify(await created.json()));
  const purchase = snapshot().purchases.at(-1);
  assert.equal(purchase.supplierId, provider.id);
  assert.deepEqual(
    purchase.lines.map((line) => ({ skuId: line.skuId, cases: line.cases })),
    [{ skuId: product.id, cases: 3 }],
  );
  record(
    "Compra: proveedor compatible y cajas se registran sin crear existencias ni duplicar productos",
  );
  // A real physical journey produces ledger rows and an occupied truck.
  runtime.simulation.command("order.release", { id: "PED-00001" }, ops);
  for (
    let i = 0;
    i < 2000 &&
    snapshot().orders.find((item) => item.id === "PED-00001").state !== "READY";
    i++
  )
    runtime.simulation.advance(1);
  assert.equal(
    snapshot().orders.find((item) => item.id === "PED-00001").state,
    "READY",
  );
  runtime.simulation.command("order.dispatch", { id: "PED-00001" }, ops);
  for (
    let i = 0;
    i < 2000 &&
    snapshot().orders.find((item) => item.id === "PED-00001").state !==
      "ARRIVED";
    i++
  )
    runtime.simulation.advance(1);
  assert.equal(
    snapshot().orders.find((item) => item.id === "PED-00001").state,
    "ARRIVED",
  );
  await navigate("orders");
  assert.equal(await page.locator(".flow-strip").count(), 0);
  await page.locator('[data-action="fleet-status"]').click();
  assert(
    (await page.locator(".fleet-status-list").textContent()).includes(
      "recepción",
    ),
  );
  assert.equal(await page.locator('[data-action="receive-order"]').count(), 0);
  await capture("05-flota-ocupada-razon");
  await page.locator("#dialog-close").click();
  record(
    "Flota: la ocupación muestra el pedido y la recepción pendiente; Operaciones no puede confirmar por la tienda ni liberar vehículos a la fuerza",
  );
  await navigate("kardex");
  await page.locator(".kardex-table tbody tr").first().waitFor();
  await capture("06-kardex-operaciones");
  await page.locator("[data-kardex-id]").first().click();
  await capture("07-kardex-detalle");
  assert.equal(await page.locator(".kardex-detail-route article").count(), 2);
  await page.locator("#dialog-close").click();
  await page.locator('[name="query"]').fill(product.name);
  const filteredResponse = page.waitForResponse(
    (result) =>
      result.url().includes("/api/inventory/movements?") &&
      result.status() === 200,
  );
  await page.locator('#kardex-filters button[type="submit"]').click();
  await filteredResponse;
  const csvDownload = page.waitForEvent("download");
  await page.locator("#kardex-export").click();
  const csv = await csvDownload;
  assert(csv.suggestedFilename().endsWith(".csv"));
  await page.locator("#kardex-clear").click();
  await page.locator(".kardex-table tbody tr").first().waitFor();
  await page.locator(".kardex-advanced summary").click();
  await page.locator('[name="fromDate"]').fill("2026-10-20");
  await page.locator('[name="toDate"]').fill("2026-10-01");
  await page.locator('#kardex-filters button[type="submit"]').click();
  assert.equal(await page.locator("#kardex-error").isVisible(), true);
  record(
    "Kardex: movimientos reales paginados, detalle de custodia y saldos, filtros, validación de fechas y exportación CSV",
  );
  await page.locator("#kardex-clear").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await capture("08-kardex-movil-claro");
  page = await login("tienda", "orders");
  await page.locator('[data-action="open-order"][data-id="PED-00001"]').click();
  assert.equal(await page.locator('[data-action="receive-order"]').count(), 1);
  await capture("09-tienda-recibe-entrega");
  await page.locator("#dialog-close").click();
  await navigate("kardex");
  await page.locator('#kardex-results[aria-busy="false"]').waitFor();
  assert.equal(
    await page.locator("#main h1").textContent(),
    "Kardex de movimientos",
  );
  const own = await (
    await page.request.get(`${base}/api/inventory/movements?pageSize=100`)
  ).json();
  const ownOrders = snapshot()
    .orders.filter((order) => order.branchId === "TIENDA-1")
    .map((order) => order.id);
  assert(
    own.items.every(
      (row) =>
        row.networkBalanceCases === null &&
        (ownOrders.includes(row.documentId) ||
          row.from?.branchId === "TIENDA-1" ||
          row.to?.branchId === "TIENDA-1"),
    ),
  );
  record(
    "Tienda: confirma únicamente su entrega y consulta el kardex de su ámbito, sin saldo físico global",
  );
  page = await login("admin", "kardex");
  await page.locator(".kardex-table tbody tr").first().waitFor();
  assert.equal(await page.locator('[data-action="new-purchase"]').count(), 0);
  await capture("10-kardex-administracion");
  assert.deepEqual(errors, []);
  record(
    "Administración: consulta Kardex desde Supervisión sin ejecutar compras, movimientos ni despachos; no hubo errores JavaScript",
  );
}
(async () => {
  let failure;
  try {
    await main();
  } catch (error) {
    failure = error;
    process.stderr.write(error.stack + "\n");
    if (page)
      try {
        await capture("FALLO");
      } catch {}
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "verificacion-catalogo-kardex.json"),
      JSON.stringify(
        {
          ok: !failure,
          checks,
          screenshots,
          layouts,
          errors,
          failure: failure?.message || null,
          data: "SQLite temporal, sin correos, sin datos de la instancia de trabajo",
        },
        null,
        2,
      ),
    );
    fs.rmSync(dataDir, { recursive: true, force: true });
    if (failure) process.exitCode = 1;
  }
})();
