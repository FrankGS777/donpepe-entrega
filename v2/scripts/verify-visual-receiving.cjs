"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events"),
  { randomUUID } = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const dataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "donpepe-visual-receiving-"),
);
const outputDir =
  process.env.DONPEPE_VISUAL_RECEIVING_QA_OUTPUT ||
  path.resolve(__dirname, "../../../DonPepe-Recepcion-Visual-2026-10-18");
const checks = [],
  screenshots = [],
  layouts = [],
  errors = [];
let runtime, server, browser, page, base;
const actor = { id: "qa-ops", role: "operations" },
  snap = () => runtime.simulation.snapshot({ id: "qa-reader", role: "admin" });
const physical = () => snap().hus.reduce((total, hu) => total + hu.cases, 0);
const record = (text) => {
  checks.push(text);
  process.stdout.write(text + "\n");
};
async function request(
  context,
  url,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  let csrf;
  if (method !== "GET" && url !== "/api/login")
    csrf = (await (await context.request.get(`${base}/api/me`)).json()).csrf;
  const response = await context.request.fetch(`${base}${url}`, {
    method,
    ...(body === undefined ? {} : { data: body }),
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  return { status: response.status(), body: await response.json() };
}
async function session(role, view) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  assert.equal(
    (
      await request(context, "/api/login", {
        email: `${role}@donpepe.local`,
        password: "DonPepe2026!",
      })
    ).status,
    200,
  );
  const p = await context.newPage();
  p.on("pageerror", (error) => errors.push({ role, message: error.message }));
  await p.goto(`${base}/#${view}`);
  await p.locator("#main h1").waitFor();
  return { page: p, context };
}
async function capture(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [
      ...document.querySelectorAll(
        "#main img,#dialog[open] img,.entity-picker-dialog[open] img",
      ),
    ];
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    document
      .querySelectorAll("#toasts .toast button")
      .forEach((button) => button.click());
    // Geometry must be read after the modal's first layout. A disabled
    // screenshot animation otherwise settles later than this measurement.
    for (const animation of document.getAnimations()) {
      if (animation.effect?.getComputedTiming().iterations !== Infinity)
        try { animation.finish(); } catch {}
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    dialogs: [...document.querySelectorAll("dialog[open]")].map((dialog) => {
      const r = dialog.getBoundingClientRect();
      return {
        cls: dialog.className,
        x: r.x,
        right: r.right,
        y: r.y,
        bottom: r.bottom,
        height: innerHeight,
      };
    }),
  }));
  layouts.push({ name, ...layout });
  assert(
    layout.document <= layout.viewport + 2 &&
      layout.body <= layout.viewport + 2,
    `${name}: desbordamiento ${JSON.stringify(layout)}`,
  );
  for (const dialog of layout.dialogs)
    assert(
      dialog.x >= -1 &&
        dialog.right <= layout.viewport + 1 &&
        dialog.y >= -1 &&
        dialog.bottom <= dialog.height + 1,
      `${name}: diálogo fuera del viewport ${JSON.stringify(dialog)}`,
    );
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({
    path: file,
    fullPage: !layout.dialogs.length,
    animations: "disabled",
  });
  screenshots.push(file);
}
async function close() {
  if (await page.locator(".entity-picker-dialog[open]").count()) {
    await page.locator(".entity-picker-dialog [data-picker-close]").click();
  }
  if (await page.locator("#dialog[open]").count())
    await page.locator("#dialog-close").click();
}
async function pick(selector, id, query = "") {
  const select = page.locator(selector);
  if (
    await select.evaluate((el) =>
      el.classList.contains("entity-original-select"),
    )
  ) {
    await select.locator("..").locator(".entity-picker-trigger").click();
    await page.locator(".entity-picker-dialog[open]").waitFor();
    if (query) await page.locator("#entity-picker-query").fill(query);
    await page.locator(`[data-picker-value="${id}"]`).click();
    await page
      .locator(".entity-picker-dialog[open]")
      .waitFor({ state: "hidden" });
  } else await select.selectOption(id);
  assert.equal(await select.inputValue(), id);
}
async function commandClick(locator, type, ok = true) {
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/commands") &&
      r.request().method() === "POST" &&
      r.request().postDataJSON()?.type === type,
  );
  await locator.click();
  const result = await response,
    body = await result.json();
  assert.equal(
    result.ok(),
    ok,
    `${type}: ${result.status()} ${JSON.stringify(body)}`,
  );
  return {
    status: result.status(),
    body,
    request: result.request().postDataJSON(),
  };
}
async function refreshPurchases() {
  await page.goto(`${base}/#purchases`);
  await page.locator("#main h1").waitFor();
}
async function openReceipt(id) {
  await page
    .locator(`[data-action="receive-purchase"][data-id="${id}"]`)
    .click();
  await page.locator("#receipt-form").waitFor();
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({
    dataDir,
    startClock: false,
    mailEnv: {},
    mailTransport: {
      async sendMail() {
        throw Error("Sin autorización para enviar correos en QA");
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
    args: ["--disable-dev-shm-usage"],
  });
  const operations = await session("operaciones", "purchases");
  page = operations.page;
  assert.equal(await page.locator("#map-host canvas").count(), 0);
  const suppliers = snap()
      .catalog.suppliers.filter((row) => row.active !== false)
      .map((row) => ({
        ...row,
        products: snap().catalog.skus.filter(
          (sku) => sku.active !== false && sku.supplierId === row.id,
        ),
      })),
    long = suppliers.find((row) => row.products.length >= 8),
    short = suppliers.find(
      (row) => row.products.length > 0 && row.products.length < 8,
    );
  assert(long && short);
  await page.locator('[data-action="new-purchase"]').first().click();
  await pick("#document-destination", long.id, long.name);
  await page.waitForFunction(() =>
    document
      .querySelector("#line-sku")
      ?.classList.contains("entity-original-select"),
  );
  const chosen = long.products[Math.min(20, long.products.length - 1)];
  await page.locator("#line-sku").evaluate((select) => {
    select.dataset.qaChanges = "0";
    select.addEventListener(
      "change",
      () =>
        (select.dataset.qaChanges = String(
          Number(select.dataset.qaChanges) + 1,
        )),
    );
  });
  await page
    .locator("#line-sku")
    .locator("..")
    .locator(".entity-picker-trigger")
    .click();
  await page
    .locator("#entity-picker-query")
    .fill(chosen.barcode || chosen.name);
  await capture("selector-producto-busqueda-1440");
  await page.keyboard.press("Escape");
  await page
    .locator(".entity-picker-dialog[open]")
    .waitFor({ state: "hidden" });
  assert(await page.locator("#dialog[open]").count());
  assert.equal(
    await page.locator("#line-sku").getAttribute("data-qa-changes"),
    "0",
  );
  await pick("#line-sku", chosen.id, chosen.barcode || chosen.name);
  assert.equal(
    await page.locator("#line-sku").getAttribute("data-qa-changes"),
    "1",
  );
  assert(
    (await page.locator("#product-preview").textContent()).includes(
      chosen.name,
    ),
  );
  record(
    "Selector largo: búsqueda visual, selección preserva change/vista previa y Escape sólo cierra el selector anidado",
  );
  await pick("#document-destination", short.id, short.name);
  await page.waitForFunction(
    (id) =>
      [...document.querySelector("#line-sku").options].some(
        (option) => option.value === id,
      ),
    short.products[0].id,
  );
  await pick("#line-sku", short.products[0].id, short.products[0].name);
  assert(
    !(await page
      .locator("#line-sku")
      .locator("..")
      .locator(".entity-picker-trigger")
      .isDisabled()),
  );
  await page
    .locator("#document-product-search")
    .fill("sin coincidencias qa 2026");
  await page.waitForFunction(
    () => document.querySelector("#add-line").disabled &&
      document.querySelector("#line-sku")?.parentElement.querySelector(".entity-picker-trigger")?.disabled,
  );
  assert(
    await page
      .locator("#line-sku")
      .locator("..")
      .locator(".entity-picker-trigger")
      .isDisabled(),
  );
  await page.locator("#document-product-search").fill("");
  await page.waitForFunction(
    () => !document.querySelector("#add-line").disabled,
  );
  await pick("#line-sku", short.products[0].id, short.products[0].name);
  record(
    "Cambio de proveedor: lista larga pasa a corta, admite selección y se recupera de búsqueda vacía sin bloqueo",
  );
  await close();

  const admin = await session("admin", "catalog");
  page = admin.page;
  await page.locator('[data-govern="catalog-tab"][data-id="sku"]').click();
  const product = snap().catalog.skus.find(
    (sku) => sku.supplierId === long.id && sku.zoneId === "DRY",
  );
  await page.locator("#catalog-search").fill(product.name);
  await page
    .locator(`[data-govern="edit-catalog"][data-id="${product.id}"]`)
    .click();
  for (const [name, id, key] of [
    ["brandId", product.brandId, "brands"],
    ["categoryId", product.categoryId, "categories"],
  ]) {
    const target = snap().catalog[key].find((row) => row.id === id);
    await page.waitForFunction(
      (name) =>
        document
          .querySelector(`[name="${name}"]`)
          ?.classList.contains("entity-original-select"),
      name,
    );
    await pick(`[name="${name}"]`, id, target.name);
  }
  await capture("administracion-marcas-categorias-selector-1440");
  await close();
  record(
    "Administración: marcas y categorías del producto usan selectores visuales y conservan sus referencias",
  );

  page = operations.page;
  await refreshPurchases();
  const sku = snap().catalog.skus.find((row) => row.id === "SKU-ARROZ");
  const purchase = runtime.simulation.command(
    "purchase.create",
    { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 5 }] },
    actor,
  );
  runtime.simulation.command("purchase.arrive", { id: purchase.id }, actor);
  await page.reload();
  await page
    .locator(`[data-action="receive-purchase"][data-id="${purchase.id}"]`)
    .waitFor();
  const before = physical(),
    beforeCount = snap().hus.length;
  const direct = await request(operations.context, "/api/commands", {
    type: "purchase.receive",
    payload: { id: purchase.id, commandId: randomUUID() },
  });
  assert.equal(direct.status, 422);
  assert.equal(physical(), before);
  await openReceipt(purchase.id);
  await page.locator("#receipt-simulate").click();
  await page.locator('[name="confirmed"]').check();
  await page.locator('[name="barcode-0"]').fill("0000000000000");
  await commandClick(
    page.locator("#receipt-form .dialog-actions button").last(),
    "purchase.inspect",
    false,
  );
  await page.locator('[name="barcode-0"][aria-invalid="true"]').waitFor();
  assert.equal(physical(), before);
  await capture("recepcion-gtin-equivocado-1440");
  record(
    "Recepción: API directa sin inspección rechazada y código equivocado marcado en su campo, sin crear existencias",
  );
  await page.locator("#receipt-simulate").click();
  await page.locator('[name="packaging-0"]').selectOption('DAMAGED');
  await commandClick(page.locator("#receipt-form .dialog-actions button").last(),"purchase.inspect",false);
  await page.locator('#receipt-form [role="alert"]').filter({hasText:'Con embalaje dañado'}).waitFor();
  assert.equal(physical(),before);
  await capture("recepcion-dano-detalle-calidad-1440");
  record("Calidad: daño de embalaje con cajas aceptadas muestra el detalle de la regla cruzada y no crea stock");
  await page.locator("#receipt-simulate").click();
  await page.locator('[name="accepted-0"]').fill("2");
  await page.locator('[name="quarantine-0"]').fill("1");
  await page
    .locator('[name="reason-0"]')
    .fill("Una caja se retiene para verificación adicional de calidad.");
  const inspected = await commandClick(
    page.locator("#receipt-form .dialog-actions button").last(),
    "purchase.inspect",
  );
  await page.locator("#receipt-commit").waitFor();
  assert.equal(physical(), before);
  assert.equal(snap().hus.length, beforeCount);
  const inspection = snap().inspections.find(
    (row) => row.id === inspected.body.result.inspectionId,
  );
  assert(inspection.simulated);
  await capture("recepcion-inspeccion-sin-stock-1440");
  await page.locator("#receipt-back").click();
  await page.locator("#receipt-form").waitFor();
  const restored={documentNumber:inspection.documentNumber,mode:inspection.mode,notes:inspection.notes,"barcode-0":inspection.lines[0].barcode,"lot-0":inspection.lines[0].supplierLot,"expiry-0":inspection.lines[0].expiry,"temperatureC-0":inspection.lines[0].temperatureC??'',"accepted-0":2,"quarantine-0":1,"packaging-0":inspection.lines[0].packaging,"label-0":inspection.lines[0].label,"reason-0":inspection.lines[0].reason};
  for(const [field,value]of Object.entries(restored))
    assert.equal(await page.locator(`[name="${field}"]`).inputValue(),String(value));
  assert.equal(await page.locator('[name="confirmed"]').isChecked(),false);
  assert.equal(physical(),before);
  await capture("recepcion-modificar-conserva-datos-1440");
  await page.locator('[name="confirmed"]').check();
  const reinspected=await commandClick(page.locator("#receipt-form .dialog-actions button").last(),"purchase.inspect");
  await page.locator("#receipt-commit").waitFor();
  assert.notEqual(reinspected.body.result.inspectionId,inspection.id);
  assert.equal(snap().inspections.find(row=>row.id===inspection.id).state,"SUPERSEDED");
  assert.equal(physical(),before);
  record("Modificar inspección conserva documento, modo, lote, cantidades y comprobaciones; exige nueva declaración y sustituye la inspección previa sin crear stock");
  const committed = await commandClick(
    page.locator("#receipt-commit"),
    "purchase.receive",
  );
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  assert.equal(physical(), before + 3);
  assert.equal(
    snap().purchases.find((row) => row.id === purchase.id).state,
    "PARTIAL",
  );
  const newHus = snap().hus.filter((row) => row.purchaseId === purchase.id);
  assert.equal(
    newHus
      .filter((row) => row.state === "QUARANTINE")
      .reduce((sum, row) => sum + row.cases, 0),
    1,
  );
  assert(newHus.every((row) => row.lot === inspection.lines[0].supplierLot));
  const repeated = await request(
    operations.context,
    "/api/commands",
    committed.request,
  );
  assert.equal(repeated.status, 200);
  assert.equal(physical(), before + 3);
  const replay = await request(operations.context, "/api/commands", {
    ...committed.request,
    payload: { ...committed.request.payload, commandId: randomUUID() },
  });
  assert.equal(replay.status, 409);
  assert.equal(physical(), before + 3);
  record(
    "Inspección y recepción parcial: inspeccionar no crea stock; confirmar crea2 aceptadas+1 retenida; lote preservado, reintento idempotente y segunda utilización bloqueada",
  );
  await openReceipt(purchase.id);
  assert.equal(await page.locator('[name="accepted-0"]').inputValue(), "2");
  await page.locator("#receipt-simulate").click();
  await page.locator('[name="confirmed"]').check();
  await commandClick(
    page.locator("#receipt-form .dialog-actions button").last(),
    "purchase.inspect",
  );
  await commandClick(page.locator("#receipt-commit"), "purchase.receive");
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  assert.equal(
    snap().purchases.find((row) => row.id === purchase.id).state,
    "RECEIVED",
  );
  assert.equal(physical(), before + 5);
  record(
    "Entrega parcial posterior: sólo quedan2 cajas, se inspeccionan y confirman sin exceder lo solicitado",
  );

  const other = runtime.simulation.command(
    "purchase.create",
    { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 2 }] },
    actor,
  );
  runtime.simulation.command("purchase.arrive", { id: other.id }, actor);
  await page.reload();
  await page
    .locator(`[data-action="receive-purchase"][data-id="${other.id}"]`)
    .waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => window.DonPepeTheme.set(value), theme);
      await page.locator('[data-action="new-purchase"]').first().click();
      await pick("#document-destination", long.id, long.name);
      await page.waitForFunction(() =>
        document
          .querySelector("#line-sku")
          ?.classList.contains("entity-original-select"),
      );
      await page
        .locator("#line-sku")
        .locator("..")
        .locator(".entity-picker-trigger")
        .click();
      await capture(`selector-anidado-${theme}-${width}`);
      await page.keyboard.press("Escape");
      assert(await page.locator("#dialog[open]").count());
      await close();
      await openReceipt(other.id);
      await capture(`recepcion-formulario-${theme}-${width}`);
      const select = page.locator('[name="mode"]');
      const css = await select.evaluate((el) => ({
        height: el.getBoundingClientRect().height,
        font: parseFloat(getComputedStyle(el).fontSize),
      }));
      assert(css.height >= 44 && css.font >= 12, JSON.stringify(css));
      await close();
    }
  }
  record(
    "Selector anidado y recepción: claro/oscuro1440/390px sin desbordamientos, selección y controles cortos legibles",
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  record("Sin errores JavaScript y sin mapa operativo durante la verificación");
}
(async () => {
  let failure;
  try {
    await main();
  } catch (error) {
    failure = error;
    process.stderr.write(error.stack + "\n");
    try {
      await page?.screenshot({
        path: path.join(outputDir, "visual-receiving-error.png"),
        fullPage: true,
      });
    } catch {}
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "verificacion-recepcion-visual.json"),
      JSON.stringify(
        {
          ok: !failure,
          checks,
          screenshots,
          layouts,
          errors,
          failure: failure?.message || null,
          environment: {
            fixture: "SQLite temporal aislado",
            mail: "Sin envíos",
            gpu: "No se instancia el mapa",
          },
        },
        null,
        2,
      ),
    );
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.stdout.write(
      `Resultado: ${checks.length} recorridos; ${screenshots.length} capturas. ${outputDir}\n`,
    );
    if (failure) process.exitCode = 1;
  }
})();
