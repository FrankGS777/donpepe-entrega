"use strict";
// All actions run against isolated SQLite fixtures, never the user's database.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const auditLayout = require("./ui-layout-audit.cjs");
const { limaDate, addLimaDays } = require("../core/time");
const output =
  process.env.DONPEPE_QA_OUTPUT ||
  path.resolve(__dirname, "../../../ui-audit-20261026");
const checks = [],
  errors = [],
  failures = [];
let runtime, server, browser;
const record = (label) => {
  checks.push(label);
  console.log(label);
};

async function run() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-store-ui-")),
    startClock: false,
    realtimeClock: true,
    mailEnv: {},
    mailTransport: { sendMail: async () => ({}) },
  });
  const qaOps = {
    id: "u-operations",
    name: "Daniela · Operaciones",
    role: "operations",
  };
  runtime.simulation.command(
    "purchase.create",
    { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 4 }] },
    qaOps,
  );
  runtime.simulation.command(
    "maintenance.request",
    {
      assetId: "ASSET-AMR-6",
      type: "PREVENTIVE",
      reason: "Verificación programada de ruedas y sensores del equipo",
    },
    qaOps,
  );
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    args: [
      "--enable-webgl",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--disable-dev-shm-usage",
    ],
  });
  async function profile(role) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "Europe/Paris",
      reducedMotion: "reduce",
    });
    const email = {
      store: "tienda",
      operations: "operaciones",
      admin: "admin",
    }[role];
    const login = await context.request.post(`${base}/api/login`, {
      data: { email: `${email}@donpepe.local`, password: "DonPepe2026!" },
    });
    assert.equal(login.status(), 200);
    const page = await context.newPage();
    page.on("pageerror", (error) =>
      errors.push({ role, message: error.message }),
    );
    await page.goto(base);
    await page.waitForFunction(
      (role) =>
        document.body.dataset.role === role &&
        document.querySelector("#main h1"),
      role,
    );
    await page.evaluate(() => document.fonts.ready);
    return { page, context };
  }
  async function view(page, role, id, width = 1440) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 1000 });
    await page.evaluate((target) => {
      location.hash = target;
    }, id);
    await page.waitForFunction(
      (target) =>
        document.body.dataset.view === target &&
        document.querySelector("#main h1"),
      id,
    );
    if (id === "kardex")
      await page.locator("#kardex-results[aria-busy=false]").waitFor();
    await page.waitForTimeout(
      role === "operations" && id === "overview" ? 600 : 140,
    );
    const sizes = await page.evaluate(() => ({
      width: innerWidth,
      page: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }));
    if (sizes.page > width + 2 || sizes.body > width + 2)
      failures.push({ role, id, width, reason: "horizontal-overflow", sizes });
    const unaligned = await page
      .locator(
        ".store-filter-bar,.record-filter-bar,.master-filter-row,.audit-filter-form,.kardex-filters",
      )
      .evaluateAll((bars) =>
        bars.flatMap((bar) => {
          const inputs = [
            ...bar.querySelectorAll(
              "input,select:not(.entity-original-select),.entity-picker-trigger",
            ),
          ]
            .filter(
              (el) =>
                getComputedStyle(el).visibility !== "hidden" &&
                el.getBoundingClientRect().height > 0,
            )
            .map((el) => ({ height: el.getBoundingClientRect().height }));
          return inputs.length > 1 &&
            Math.max(...inputs.map((x) => x.height)) -
              Math.min(...inputs.map((x) => x.height)) >
              2
            ? [inputs]
            : [];
        }),
      );
    if (unaligned.length)
      failures.push({
        role,
        id,
        width,
        reason: "filter-control-height",
        unaligned,
      });
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll("#main img")].map((img) => {
          img.loading = "eager";
          return img.decode().catch(() => {});
        }),
      );
    });
    const issues = await auditLayout(page);
    if (issues.length)
      failures.push({ role, id, width, reason: "component-alignment", issues });
    await page.screenshot({
      path: path.join(output, `${role}-${id}-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    record(`${role} / ${id} / ${width}px`);
  }
  const store = await profile("store"),
    page = store.page;
  assert.equal(await page.locator("#sidebar").isVisible(), false);
  assert(await page.locator("#store-navigation").isVisible());
  assert.match(await page.locator("#sim-time").textContent(), /PET/);
  const headerTime = await page.locator("#sim-time").getAttribute("datetime");
  assert.ok(Math.abs(Date.now() - Date.parse(headerTime)) < 5000);
  record("Reloj Lima independiente de la zona del navegador");
  await store.context.request.post(base + "/api/password-recovery", {
    data: { email: "operaciones@donpepe.local" },
  });
  for (const width of [1440, 390])
    for (const id of [
      "overview",
      "shop",
      "orders",
      "inventory",
      "stores",
      "kardex",
    ])
      await view(page, "store", id, width);
  await view(page, "store", "shop");
  await page.locator('[data-store-filter="q"]').fill("arroz");
  assert((await page.locator(".store-catalog-card").count()) > 0);
  assert(
    await page
      .locator(".store-catalog-card")
      .evaluateAll((cards) =>
        cards.every((card) => /arroz/i.test(card.textContent)),
      ),
  );
  await page.locator('[data-store-action="more"]').first().click();
  await page.locator('[data-store-action="more"]').first().click();
  assert.match(
    await page.locator(".store-basket-heading > strong").textContent(),
    /2/,
  );
  await page.reload();
  await page.locator(".store-basket-heading").waitFor();
  assert.match(
    await page.locator(".store-basket-heading > strong").textContent(),
    /2/,
  );
  record("Catálogo filtra y conserva cesta al recargar");
  await page.locator('[data-store-action="checkout"]').click();
  await page
    .locator('#store-checkout-form [name="notes"]')
    .fill("Reposición por demanda semanal de mi tienda");
  await page
    .locator('#store-checkout-form [name="requestedByDate"]')
    .fill(addLimaDays(new Date(), 1));
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST",
  );
  await page.locator('#store-checkout-form [type="submit"]').click();
  const response = await pending,
    result = await response.json();
  assert.equal(response.status(), 200, JSON.stringify(result));
  await page.waitForFunction(() => document.body.dataset.view === "orders");
  await page.locator(".store-order-card").first().waitFor();
  assert.equal(
    (
      await page
        .locator(".store-order-card .document-code")
        .first()
        .textContent()
    ).trim(),
    result.result.id,
  );
  record("Solicitud creada desde cesta; el pedido nuevo aparece primero");
  await page.locator('[data-store-filter="q"]').fill("producto-inexistente-qa");
  assert.equal(await page.locator(".store-order-card").count(), 0);
  await page.locator('[data-store-action="reset-filters"]').click();
  assert((await page.locator(".store-order-card").count()) > 0);
  await page.locator('[data-store-filter="from"]').fill("2026-11-30");
  await page.locator('[data-store-filter="to"]').fill("2026-10-01");
  assert(await page.locator(".store-portal .form-error").isVisible());
  await page.locator('[data-store-action="reset-filters"]').click();
  await page.locator('[data-action="open-order"]').first().click();
  assert(await page.locator("#dialog .operation-meta").isVisible());
  assert.match(
    await page.locator("#dialog .operation-meta").textContent(),
    /PET/,
  );
  await page.locator("#dialog-close").click();
  record(
    "Filtros vacíos, limpieza, intervalo inválido y detalle local verificados",
  );
  const ops = await profile("operations"),
    admin = await profile("admin");
  await view(ops.page, "operations", "orders");
  await ops.page
    .locator(`[data-action="open-order"][data-id="${result.result.id}"]`)
    .click();
  const release = ops.page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST",
  );
  await ops.page
    .locator(`[data-action="release-order"][data-id="${result.result.id}"]`)
    .click();
  assert.equal((await release).status(), 200);
  if (await ops.page.locator("#dialog-close").isVisible())
    await ops.page.locator("#dialog-close").click();
  let delivered = false;
  for (let elapsed = 0; elapsed < 1800; elapsed += 5) {
    runtime.simulation.advance(5);
    if (
      runtime.simulation
        .snapshot(qaOps)
        .orders.find((row) => row.id === result.result.id).state === "RECEIVED"
    ) {
      delivered = true;
      break;
    }
  }
  assert(delivered, "El pedido debe completar la recepción autónoma de tienda");
  await page.reload();
  await page.locator(".store-order-card").first().waitFor();
  await view(page, "store", "inventory");
  await page.locator('[data-action="consume"][data-sku="SKU-ARROZ"]').click();
  await page.locator('#consume-form [name="reference"]').fill("SALIDA-QA-001");
  await page
    .locator('#consume-form [name="reason"]')
    .fill("Salida registrada en la validación funcional de tienda");
  const sale = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST",
  );
  await page
    .locator(
      '#consume-form button[type="submit"], #consume-form .dialog-actions button:not([type="button"])',
    )
    .last()
    .click();
  assert.equal((await sale).status(), 200);
  await page.locator("#dialog").waitFor({ state: "hidden" });
  await view(page, "store", "inventory");
  record(
    "Autorización, entrega autónoma y salida de tienda completan el flujo real",
  );
  for (const width of [1440, 390]) {
    for (const id of [
      "overview",
      "orders",
      "purchases",
      "inventory",
      "kardex",
      "equipment",
      "stores",
      "incidents",
    ])
      await view(ops.page, "operations", id, width);
    for (const id of [
      "summary",
      "kardex",
      "users",
      "roles",
      "catalog",
      "categories",
      "brands",
      "assets",
      "maintenance",
      "settings",
      "recoveries",
      "audit",
    ])
      await view(admin.page, "admin", id, width);
  }
  async function modal(target, role, name, selector, width) {
    await target.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const control = target.locator(selector).first();
    if (!(await control.count())) {
      failures.push({ role, name, reason: "missing-dialog-control" });
      return;
    }
    await control.click();
    await target.locator("#dialog[open]").waitFor();
    await target.waitForTimeout(100);
    const size = await target.locator("#dialog").evaluate((dialog) => ({
      viewport: innerWidth,
      left: dialog.getBoundingClientRect().left,
      right: dialog.getBoundingClientRect().right,
      scroll: dialog.scrollWidth,
      client: dialog.clientWidth,
    }));
    if (
      size.left < -1 ||
      size.right > width + 1 ||
      size.scroll > size.client + 2
    )
      failures.push({ role, name, width, reason: "dialog-overflow", size });
    const issues = await auditLayout(target);
    if (issues.length)
      failures.push({
        role,
        name,
        width,
        reason: "dialog-component-alignment",
        issues,
      });
    await target.screenshot({
      path: path.join(output, `${role}-dialog-${name}-${width}.png`),
      animations: "disabled",
    });
    await target.locator("#dialog-close").click();
    record(`${role} / modal ${name} / ${width}px`);
  }
  for (const width of [1440, 390]) {
    for (const [id, name, selector] of [
      ["users", "edit-account", '[data-govern="edit-user"][data-id="u-store"]'],
      ["catalog", "product", '[data-govern="new-catalog"]'],
      ["categories", "category", '[data-admin-data="new"]'],
      ["brands", "brand", '[data-admin-data="new"]'],
      ["assets", "asset", '[data-admin-data="new"]'],
      ["assets", "device-settings", '[data-admin-data="configure"]'],
      ["maintenance", "maintenance", '[data-admin-data="request"]'],
      ["audit", "audit-detail", '[data-govern="audit-detail"]'],
    ]) {
      await view(admin.page, "admin", id, width);
      await modal(admin.page, "admin", name, selector, width);
    }
    await view(ops.page, "operations", "purchases", width);
    await modal(
      ops.page,
      "operations",
      "purchase",
      '[data-action="new-purchase"]',
      width,
    );
    await view(page, "store", "orders", width);
    await modal(page, "store", "order", '[data-action="open-order"]', width);
    await view(page, "store", "stores", width);
    await modal(page, "store", "return", '[data-action="new-return"]', width);
  }
  // The same store screen must work in both themes, rather than only in dark.
  for (const [target, role, views] of [
    [
      page,
      "store",
      ["overview", "shop", "orders", "inventory", "stores", "kardex"],
    ],
    [
      ops.page,
      "operations",
      [
        "overview",
        "orders",
        "purchases",
        "inventory",
        "kardex",
        "equipment",
        "stores",
        "incidents",
      ],
    ],
    [
      admin.page,
      "admin",
      [
        "summary",
        "kardex",
        "users",
        "roles",
        "catalog",
        "categories",
        "brands",
        "assets",
        "maintenance",
        "settings",
        "recoveries",
        "audit",
      ],
    ],
  ]) {
    await target.evaluate(() => window.DonPepeTheme.set("light"));
    for (const width of [1440, 390])
      for (const id of views) await view(target, `${role}-light`, id, width);
  }
  for (const width of [1440, 390])
    for (const appearance of ["dark", "light"]) {
      await admin.page.evaluate(
        (theme) => window.DonPepeTheme.set(theme),
        appearance,
      );
      for (const kind of ["supplier", "branch"]) {
        await view(admin.page, `admin-${appearance}`, "catalog", width);
        await admin.page
          .locator(`[data-govern="catalog-tab"][data-id="${kind}"]`)
          .click();
        const issues = await auditLayout(admin.page);
        if (issues.length)
          failures.push({ role: "admin", kind, width, appearance, issues });
        await admin.page.screenshot({
          path: path.join(output, `admin-${appearance}-${kind}-${width}.png`),
          fullPage: true,
          animations: "disabled",
        });
        await modal(
          admin.page,
          "admin",
          `new-${kind}`,
          '[data-govern="new-catalog"]',
          width,
        );
        await modal(
          admin.page,
          "admin",
          `edit-${kind}`,
          '[data-govern="edit-catalog"]',
          width,
        );
      }
      await view(admin.page, "admin", "users", width);
      await modal(
        admin.page,
        "admin",
        "new-user",
        '[data-govern="new-user"]',
        width,
      );
      await view(ops.page, "operations", "purchases", width);
      await modal(
        ops.page,
        "operations",
        "autonomy-evidence",
        '[data-action="view-autonomy-job"]',
        width,
      );
      for (const [target, role] of [
        [admin.page, "admin"],
        [ops.page, "operations"],
        [page, "store"],
      ]) {
        await target.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        await target.locator("#user-menu").click();
        await modal(target, role, "profile", '[data-action="profile"]', width);
      }
    }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  assert.equal(failures.length, 0, JSON.stringify(failures));
  record(
    "Recorrido de vistas finalizado sin errores JavaScript ni desbordamiento",
  );
}
run()
  .catch((error) => {
    failures.push({ message: error.message, stack: error.stack });
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          timeZone: "America/Lima",
          checks,
          errors,
          failures,
        },
        null,
        2,
      ),
    );
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
  });
