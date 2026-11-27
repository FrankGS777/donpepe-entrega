"use strict";
// Product, supplier, branch-request and role UX checks use disposable SQLite
// fixtures exclusively. Mail is stubbed and never leaves this process.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const outputDir = path.resolve(
  process.env.DONPEPE_CATALOG_QA_OUTPUT ||
    path.resolve(__dirname, "../../../DonPepe-Maestros-2026-10-17"),
);
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-catalog-qa-"));
const checks = [],
  screenshots = [],
  errors = [],
  layouts = [];
let runtime, server, browser, base, activePage;
const actor = { id: "catalog-qa-ops", role: "operations" };
const snap = () =>
  runtime.simulation.snapshot({ id: "catalog-qa-inspect", role: "admin" });
const record = (message) => {
  checks.push(message);
  process.stdout.write(message + "\n");
};
const gtin = (body) =>
  body +
  String(
    (10 -
      ([...body]
        .reverse()
        .reduce(
          (sum, digit, index) => sum + Number(digit) * (index % 2 ? 1 : 3),
          0,
        ) %
        10)) %
      10,
  );
async function login(role) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  const page = await context.newPage();
  activePage = page;
  page.on("pageerror", (error) =>
    errors.push({ role, message: error.message }),
  );
  await page.goto(`${base}/login`);
  await page
    .locator('[name="email"]')
    .fill(
      { admin: "admin", operations: "operaciones", store: "tienda" }[role] +
        "@donpepe.local",
    );
  await page.locator('[name="password"]').fill("DonPepe2026!");
  await page.locator('#login-form [type="submit"]').click();
  await page.waitForURL(`${base}/`);
  await page.waitForFunction(
    () =>
      document.body.dataset.role !== undefined &&
      document.querySelector("#main h1"),
  );
  return { context, page };
}
async function navigate(page, view, selector = "#main h1") {
  activePage = page;
  await page.bringToFront();
  await page.evaluate((view) => {
    location.hash = view;
  }, view);
  await page.waitForFunction(
    (view) => document.body.dataset.view === view,
    view,
  );
  await page.locator(selector).first().waitFor();
}
async function commandClick(page, selector, type, ok = true) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.type === type,
  );
  await page.locator(selector).first().click();
  const response = await pending,
    data = await response.json();
  assert.equal(
    response.ok(),
    ok,
    `${type}: ${response.status()} ${JSON.stringify(data)}`,
  );
  return data;
}
async function request(page, type, payload) {
  return page.evaluate(
    async ({ type, payload }) => {
      const me = await (await fetch("/api/me")).json();
      const response = await fetch("/api/commands", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf,
        },
        body: JSON.stringify({ type, payload }),
      });
      return { status: response.status, data: await response.json() };
    },
    { type, payload },
  );
}
async function capture(page, name) {
  activePage = page;
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    dialog: (() => {
      const node = document.querySelector("#dialog[open]");
      if (!node) return null;
      const b = node.getBoundingClientRect();
      return {
        x: b.x,
        right: b.right,
        y: b.y,
        bottom: b.bottom,
        height: innerHeight,
      };
    })(),
  }));
  layouts.push({ name, ...layout });
  assert(
    layout.document <= layout.viewport + 2 &&
      layout.body <= layout.viewport + 2,
    `${name}: desbordamiento ${JSON.stringify(layout)}`,
  );
  if (layout.dialog)
    assert(
      layout.dialog.x >= -1 &&
        layout.dialog.right <= layout.viewport + 1 &&
        layout.dialog.y >= -1 &&
        layout.dialog.bottom <= layout.dialog.height + 1,
      `${name}: diálogo fuera del viewport`,
    );
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  screenshots.push(file);
}
async function fillFields(page, values) {
  for (const [name, value] of Object.entries(values))
    await page.locator(`#govern-form [name="${name}"]`).fill(String(value));
}
async function closeDialog(page) {
  await page.locator("#dialog-close").click();
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
}
async function checkImageAssets(page, selector, count) {
  await page.waitForFunction(
    ({ selector, count }) => {
      const nodes = [...document.querySelectorAll(selector)];
      return (
        nodes.length === count &&
        nodes.every((node) => node.complete && node.naturalWidth > 0)
      );
    },
    { selector, count },
    { timeout: 15000 },
  );
}
async function uploadChecks(page, product) {
  const file = page.locator('.catalog-upload input[type="file"]'),
    upload = page.getByRole("button", { name: "Subir imagen", exact: true });
  const previous = await page.locator('[name="imageUrl"]').inputValue();
  await file.setInputFiles({
    name: "no-es-imagen.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("verificación local"),
  });
  await page.waitForFunction(() =>
    document
      .querySelector(".catalog-upload-error")
      ?.textContent.includes("JPG"),
  );
  assert.equal(await page.locator('[name="imageUrl"]').inputValue(), previous);
  const asset = await page.request.get(base + product.imageUrl);
  assert(asset.ok());
  await file.setInputFiles({
    name: path.basename(product.imageUrl),
    mimeType: asset.headers()["content-type"].split(";")[0],
    buffer: await asset.body(),
  });
  await upload.waitFor();
  await page.waitForFunction(
    () =>
      ![...document.querySelectorAll(".catalog-upload button")].find(
        (button) => button.textContent === "Subir imagen",
      )?.disabled,
  );
  assert.equal(
    await page.locator('[name="imageUrl"]').inputValue(),
    previous,
    "Elegir un archivo no cambia la imagen persistida",
  );
  await page
    .locator('#govern-form .dialog-actions button:not([type="button"])')
    .click();
  assert(
    (await page.locator(".catalog-upload-error").textContent()).includes(
      "Sube la imagen",
    ),
  );
  await page.route("**/api/catalog-media", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: "Fallo temporal controlado por verificación",
      }),
    }),
  );
  await upload.click();
  await page.waitForFunction(() =>
    document
      .querySelector(".catalog-upload-error")
      ?.textContent.includes("Fallo temporal"),
  );
  assert.equal(
    await page.locator('[name="imageUrl"]').inputValue(),
    previous,
    "El fallo de subida conserva la fotografía anterior",
  );
  await page.unroute("**/api/catalog-media");
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/catalog-media") &&
      response.request().method() === "POST",
  );
  await upload.click();
  const response = await pending;
  assert(response.ok());
  const payload = await response.json();
  await page.waitForFunction(
    (value) => document.querySelector('[name="imageUrl"]')?.value === value,
    payload.imageUrl,
  );
  assert.match(
    payload.imageUrl,
    /^\/images\/catalog\/uploads\/[a-f0-9]{64}\.png$/,
  );
  await page.waitForFunction(() => {
    const image = document.querySelector("#master-preview-image img");
    return (
      image?.complete &&
      image.naturalWidth === 768 &&
      image.naturalHeight === 768
    );
  });
  const stored = runtime.identity.db
    .prepare("SELECT width,height FROM catalog_media WHERE hash=?")
    .get(payload.imageUrl.split("/").at(-1).slice(0, -4));
  assert.equal(stored.width, 768);
  assert.equal(stored.height, 768);
  record(
    "Fotografías: archivo inválido rechazado, vista previa sin publicar, guardar pendiente bloqueado, error recuperable conserva foto y subida real validada en SQLite temporal",
  );
}
async function adminChecks(page) {
  await navigate(page, "summary", "#summary-rows tr");
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  assert(state.inventorySummary?.products.length >= 12);
  assert.equal(state.hus.length, 0);
  assert.equal(state.equipment.robots.length, 0);
  assert.equal(await page.locator("#map-host").count(), 0);
  assert.equal(
    await page
      .locator(
        '[data-action="new-order"], [data-action="dispatch-order"], [data-action="new-purchase"]',
      )
      .count(),
    0,
  );
  await page.locator("#summary-search").fill("Gloria");
  assert(
    (await page.locator("#summary-rows tr .master-table-product").count()) >= 1,
  );
  assert(
    (await page.locator("#summary-rows").textContent()).includes("Gloria"),
  );
  await page.locator("#summary-search").fill("");
  const cells = await page
    .locator(".master-stock-table td:first-child")
    .evaluateAll((nodes) =>
      nodes.map((cell) => {
        const right = cell.getBoundingClientRect().right;
        return [...cell.querySelectorAll("strong,small")].every(
          (node) => node.getBoundingClientRect().right <= right + 1,
        );
      }),
    );
  assert(
    cells.every(Boolean),
    "El texto de producto invade las columnas numéricas del inventario",
  );
  const download = page.waitForEvent("download");
  await page.locator('[data-govern="export-stock"]').click();
  assert((await download).suggestedFilename().endsWith(".csv"));
  record(
    "Administración: inventario agregado de consulta, búsqueda y exportación; sin mapa ni acciones logísticas",
  );
  await navigate(page, "catalog", "#catalog-results .master-record");
  const products = state.catalog.skus.filter((item) => item.active !== false);
  assert.equal(
    await page.locator("#catalog-results .master-record").count(),
    products.length,
  );
  await checkImageAssets(page, ".master-record-media>img", products.length);
  assert(
    products.every((p) => p.brand && p.category && p.presentation && p.barcode),
  );
  await page.locator("#catalog-search").fill("Gloria");
  assert((await page.locator("#catalog-results .master-record").count()) >= 1);
  await page.locator("#catalog-search").fill("sin-coincidencias-qa");
  await page.locator('[data-govern="reset-catalog"]').click();
  assert.equal(await page.locator("#catalog-search").inputValue(), "");
  record(
    "Productos: doce fotografías reales cargadas, marcas/categorías/presentaciones y filtro con recuperación del estado vacío",
  );
  await page.locator('[data-govern="catalog-tab"][data-id="supplier"]').click();
  await checkImageAssets(
    page,
    ".master-record-media>img",
    state.catalog.suppliers.filter((p) => p.active !== false).length,
  );
  await page.locator('[data-govern="new-catalog"]').click();
  await fillFields(page, {
    code: "QA-PROVEEDOR",
    name: "Proveedor temporal de verificación",
    contact: "Área comercial QA",
    email: "comercial@example.com",
    phone: "+51 999 888 777",
    site: "https://example.com",
    leadDays: 3,
    logoUrl: state.catalog.suppliers[0].logoUrl,
  });
  await page.locator('[name="zones"][value="DRY"]').check();
  const providerResult = await commandClick(
    page,
    '#govern-form .dialog-actions button:not([type="button"])',
    "config.supplier.create",
  );
  const providerId = providerResult.result.id;
  assert.equal(
    snap().catalog.suppliers.find((p) => p.id === providerId).contact,
    "Área comercial QA",
  );
  await page
    .locator(`[data-govern="edit-catalog"][data-id="${providerId}"]`)
    .click();
  await fillFields(page, { leadDays: 4 });
  await commandClick(
    page,
    '#govern-form .dialog-actions button:not([type="button"])',
    "config.supplier.update",
  );
  assert.equal(
    snap().catalog.suppliers.find((p) => p.id === providerId).leadDays,
    4,
  );
  record(
    "Proveedores: logotipos oficiales cargados y creación/edición de contacto, correo, teléfono, sitio y plazo en datos temporales",
  );
  await page.locator('[data-govern="catalog-tab"][data-id="sku"]').click();
  await page.locator('[data-govern="new-catalog"]').click();
  await fillFields(page, {
    code: "QA-FOTO",
    name: "Producto temporal de verificación",
    brand: "Marca QA",
    category: "Prueba de catálogo",
    presentation: "Caja de verificación",
    barcode: gtin("200000000001"),
    reorderPoint: -1,
    imageUrl: products[0].imageUrl,
  });
  await uploadChecks(page, products[1]);
  await page.locator('[name="supplierId"]').selectOption(providerId);
  await page
    .locator('#govern-form .dialog-actions button:not([type="button"])')
    .click();
  assert.equal(
    await page.locator('[name="reorderPoint"]').getAttribute("aria-invalid"),
    "true",
  );
  await page.locator('[name="reorderPoint"]').fill("20");
  const validBarcode = gtin("200000000001");
  await page
    .locator('[name="barcode"]')
    .fill(validBarcode.slice(0, -1) + ((Number(validBarcode.at(-1)) + 1) % 10));
  await commandClick(
    page,
    '#govern-form .dialog-actions button:not([type="button"])',
    "config.sku.create",
    false,
  );
  await page.waitForFunction(
    () =>
      document
        .querySelector('[name="barcode"]')
        ?.getAttribute("aria-invalid") === "true",
  );
  await page.waitForFunction(() =>
    document
      .querySelector("#govern-error")
      ?.textContent.includes("dígito de control"),
  );
  assert.equal(
    (await page.locator(".catalog-upload-error").textContent()).trim(),
    "",
    "Un error del código de barras aparece en la sección equivocada de subida de fotos",
  );
  assert.equal(
    await page
      .locator('[name="barcode"]')
      .evaluate(
        (field) =>
          field
            .closest("label")
            .querySelectorAll(".master-field-error,.field-problem").length,
      ),
    1,
    "El campo tiene mensajes de error duplicados",
  );
  const errorBounds = await page
    .locator('[name="barcode"]')
    .evaluate((field) => {
      const b = field.getBoundingClientRect(),
        header = document.querySelector(".dialog-head").getBoundingClientRect(),
        dialog = document.querySelector("#dialog").getBoundingClientRect();
      return {
        top: b.top,
        bottom: b.bottom,
        headerBottom: header.bottom,
        dialogBottom: dialog.bottom,
      };
    });
  assert(
    errorBounds.top >= errorBounds.headerBottom &&
      errorBounds.bottom <= errorBounds.dialogBottom,
    `El campo con error queda detrás de la cabecera fija: ${JSON.stringify(errorBounds)}`,
  );
  await capture(page, "admin-error-campo-catalogo-1440");
  await page.locator('[name="barcode"]').fill(validBarcode);
  const productResult = await commandClick(
    page,
    '#govern-form .dialog-actions button:not([type="button"])',
    "config.sku.create",
  );
  const productId = productResult.result.id;
  assert.equal(
    snap().catalog.skus.find((p) => p.id === productId).reorderPoint,
    20,
  );
  await page
    .locator(`[data-govern="edit-catalog"][data-id="${productId}"]`)
    .click();
  await fillFields(page, { reorderPoint: 22 });
  await commandClick(
    page,
    '#govern-form .dialog-actions button:not([type="button"])',
    "config.sku.update",
  );
  await page
    .locator(`[data-govern="deactivate-catalog"][data-id="${productId}"]`)
    .click();
  await commandClick(
    page,
    '#govern-form .dialog-actions button:not([type="button"])',
    "config.sku.deactivate",
  );
  await page.locator("#catalog-status").selectOption("inactive");
  assert(
    (await page.locator("#catalog-results").textContent()).includes(
      "Producto temporal",
    ),
  );
  await page.locator("#catalog-status").selectOption("active");
  record(
    "Maestros: validación visible de cantidad y GTIN incorrecto, guardar/editar/desactivar producto y consulta de desactivados",
  );
  return { state, providerId, productId };
}
async function storeChecks(page) {
  await navigate(page, "overview", ".store-welcome");
  assert.equal(await page.locator("#map-host").count(), 0);
  assert.equal(
    await page
      .locator('[data-action="new-purchase"], [data-govern="new-catalog"]')
      .count(),
    0,
  );
  const state = await page.evaluate(async () =>
    (await fetch("/api/state")).json(),
  );
  assert.equal(state.catalog.branches.length, 1);
  assert.equal(state.catalog.branches[0].id, "TIENDA-1");
  await page.locator('[data-action="new-order"]').first().click();
  assert.equal(await page.locator("#document-destination").isDisabled(), true);
  assert.equal(await page.locator("#document-destination option").count(), 1);
  await page.locator("#line-quantity").fill("0");
  await page.locator("#add-line").click();
  assert.equal(
    await page.locator("#line-quantity").getAttribute("aria-invalid"),
    "true",
  );
  await page.locator("#line-sku").selectOption("SKU-ARROZ");
  await page.locator("#line-quantity").fill("2");
  await page.locator("#add-line").click();
  await closeDialog(page);
  await page.locator('[data-action="new-order"]').first().click();
  assert(
    (await page.locator("#draft-status").textContent()).includes("recuperado"),
  );
  assert.equal(await page.locator("#draft-lines [data-remove]").count(), 1);
  const created = await commandClick(page, "#document-submit", "order.create"),
    order = snap().orders.find((o) => o.id === created.result.id);
  assert.equal(order.state, "PENDING");
  assert.equal(order.branchId, "TIENDA-1");
  assert.equal(order.simulated, false);
  assert.equal(order.allocations.length, 0);
  const denied = await request(page, "order.create", {
    branchId: "TIENDA-2",
    lines: [{ skuId: "SKU-ARROZ", cases: 1 }],
  });
  assert([403, 404].includes(denied.status));
  const deniedRead = await request(page, "order.receive", {
    id: "PEDIDO-OTRA-SUCURSAL",
    lines: [],
  });
  assert([403, 404].includes(deniedRead.status));
  record(
    "Tienda: portal propio, cantidad incorrecta resaltada, borrador restaurado y solicitud real PENDING; otra sucursal protegida",
  );
  return order;
}
async function operationsChecks(page, realOrder) {
  await navigate(page, "orders", "#orders-search");
  assert.equal(await page.locator('[data-action="new-order"]').count(), 0);
  await page.reload();
  await page.locator("#orders-search").waitFor();
  await page
    .locator(`[data-action="open-order"][data-id="${realOrder.id}"]`)
    .waitFor();
  assert.equal(await page.locator('[data-action="simulate-request"]').count(), 0);
  assert.equal((await request(page, "simulation.request", {})).status, 403);
  await page.locator("#orders-search").fill("no-existe-qa-3232");
  await page.locator("#orders-filter-empty").waitFor({ state: "visible" });
  await page.locator("#orders-search").fill("");
  await page.locator("#orders-status").selectOption("PENDING");
  assert((await page.locator("[data-order-state]:visible").count()) >= 1);
  await page.locator("#orders-status").selectOption("all");
  const forged = await request(page, "order.create", {
    branchId: "TIENDA-1",
    lines: [{ skuId: "SKU-ARROZ", cases: 1 }],
  });
  assert.equal(forged.status, 403);
  record(
    "Operaciones: recibe solicitudes reales de tienda; simulación retirada y creación directa de pedidos rechazada",
  );
  await navigate(page, "purchases");
  await page.locator('[data-action="new-purchase"]').first().click();
  const suppliers = snap().catalog.suppliers.filter(
    (supplier) => supplier.active,
  );
  for (const supplier of suppliers) {
    await page.locator("#document-destination").selectOption(supplier.id);
    const ids = await page
      .locator("#line-sku option")
      .evaluateAll((nodes) => nodes.map((node) => node.value));
    assert(
      ids.every((id) => {
        const p = snap().catalog.skus.find((p) => p.id === id);
        return (
          p.supplierId === supplier.id ||
          (p.supplierIds || []).includes(supplier.id)
        );
      }),
    );
  }
  await closeDialog(page);
  record(
    "Compras: el proveedor seleccionado ofrece exclusivamente sus productos compatibles",
  );
  await navigate(page, "overview", '#map-host[data-scene-ready="true"]');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator("#map-resources").isVisible(), false);
  assert.equal(await page.locator("#map-inspector").isVisible(), false);
  const diag = () =>
    page.evaluate(() =>
      document.querySelector("#map-host").getSceneDiagnostics(),
    );
  const before = await diag();
  await page.locator("#map-host canvas").focus();
  await page.keyboard.down("w");
  await page.waitForTimeout(500);
  await page.keyboard.up("w");
  await page.waitForTimeout(200);
  const after = await diag();
  assert(
    after.camera.target.some(
      (value, i) => Math.abs(value - before.camera.target[i]) > 0.2,
    ),
    "WASD no desplaza la cámara",
  );
  await page.locator("#map-find").focus();
  const typingBefore = await diag();
  await page.keyboard.type("wasd");
  await page.waitForTimeout(250);
  const typingAfter = await diag();
  assert(
    typingAfter.camera.target.every(
      (value, i) => Math.abs(value - typingBefore.camera.target[i]) < 0.01,
    ),
    "Escribir en buscador desplaza la cámara",
  );
  await page.locator("#map-find").fill("");
  await page.locator('[data-action="recenter-map"]').click();
  await page.waitForTimeout(1000);
  await page.locator('[data-action="toggle-resources"]').last().click();
  assert.equal(await page.locator("#map-resources").isVisible(), true);
  await page.locator(".resource-close").click();
  record(
    "Mapa: recursos e inspector recogidos al iniciar; WASD desplaza la vista y se detiene al escribir; recursos reversibles",
  );
}
async function responsiveChecks(role, page) {
  const views =
    role === "admin"
      ? ["summary", "catalog", "users"]
      : role === "store"
        ? ["overview", "orders", "inventory"]
        : ["overview", "orders", "purchases"];
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((theme) => window.DonPepeTheme.set(theme), theme);
      for (const view of views) {
        await navigate(page, view);
        if (view === "overview" && role === "operations")
          await page.locator('#map-host[data-scene-ready="true"]').waitFor();
        await capture(page, `${role}-${view}-${theme}-${width}`);
      }
    }
  }
  record(
    `${role}: temas claro/oscuro a 1440 y 390 px, módulos principales sin desbordamiento`,
  );
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({
    dataDir,
    startClock: false,
    mailEnv: {},
    mailTransport: {
      async sendMail() {
        throw new Error("El verificador no autoriza envíos");
      },
      close() {},
    },
  });
  runtime.simulation.command("simulation.pause", { paused: true }, actor);
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      "--enable-webgl",
      ...(process.env.DONPEPE_NATIVE_GPU === "1"
        ? []
        : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]),
      "--disable-dev-shm-usage",
    ],
  });
  const admin = await login("admin");
  await adminChecks(admin.page);
  if (process.env.DONPEPE_CATALOG_QA_SCOPE === "admin") {
    await navigate(admin.page, "summary", "#summary-rows tr");
    await capture(admin.page, "admin-summary-corrected-1440");
    assert.equal(errors.length, 0, JSON.stringify(errors));
    record(
      "Revisión dirigida: error de GTIN en su formulario, una sola nota por campo y ninguna alerta cruzada con la subida de fotos",
    );
    return;
  }
  const store = await login("store"),
    order = await storeChecks(store.page);
  const operations = await login("operations");
  await operationsChecks(operations.page, order);
  for (const [role, session] of [
    ["admin", admin],
    ["store", store],
    ["operations", operations],
  ])
    await responsiveChecks(role, session.page);
  assert.equal(errors.length, 0, JSON.stringify(errors));
  record(
    "Sin errores JavaScript durante la administración, solicitudes y navegación de los tres perfiles",
  );
}
(async () => {
  let failure;
  try {
    await main();
  } catch (error) {
    failure = error;
    process.stderr.write(error.stack + "\n");
    try {
      await activePage?.screenshot({
        path: path.join(outputDir, "catalog-error.png"),
        fullPage: true,
      });
    } catch {}
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "verificacion-catalogo.json"),
      JSON.stringify(
        {
          ok: !failure,
          checks,
          screenshots,
          layouts,
          errors,
          environment: {
            fixture: "SQLite temporal aislado",
            mail: "Bloqueado, sin envíos",
            browser: "Chrome headless",
            nativeGpu: process.env.DONPEPE_NATIVE_GPU === "1",
          },
          failure: failure?.message || null,
        },
        null,
        2,
      ),
    );
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.stdout.write(
      `Resultado: ${checks.length} comprobaciones; ${screenshots.length} capturas. ${outputDir}\n`,
    );
    if (failure) process.exitCode = 1;
  }
})();
