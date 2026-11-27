"use strict";
// Real browser and isolated databases: no changes to the user's accounts.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const output = path.resolve(__dirname, "../../../ui-live-filters-20261027");
const checks = [],
  errors = [];
let runtime, server, browser;
const record = (message) => {
  checks.push(message);
  console.log(message);
};
async function run() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-live-")),
    startClock: false,
    realtimeClock: true,
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
  async function login(email, view) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    assert.equal(
      (
        await context.request.post(base + "/api/login", {
          data: { email: `${email}@donpepe.local`, password: "DonPepe2026!" },
        })
      ).status(),
      200,
    );
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/#${view}`);
    await page.locator("#main h1").waitFor();
    return page;
  }
  async function view(page, name) {
    await page.evaluate((name) => {
      location.hash = name;
    }, name);
    await page.waitForFunction(
      (name) =>
        document.body.dataset.view === name &&
        document.querySelector("#main h1"),
      name,
    );
  }
  async function request(page, url, data, method = "POST") {
    return page.evaluate(
      async ({ url, data, method }) => {
        const me = await (await fetch("/api/me")).json();
        const response = await fetch(url, {
          method,
          headers: {
            "content-type": "application/json",
            "x-csrf-token": me.csrf,
          },
          body: JSON.stringify(data),
        });
        return { status: response.status, body: await response.json() };
      },
      { url, data, method },
    );
  }
  const admin = await login("admin", "summary");
  const header = await admin.locator(".topbar-right").boundingBox();
  assert(header.x > 720 && header.x + header.width > 1380);
  assert.equal(
    await admin
      .locator('nav a[href="#autonomy"],nav a[href="#analytics"]')
      .count(),
    0,
  );
  await admin.screenshot({ path: path.join(output, "admin-header.png") });
  await admin.evaluate(() => {
    location.hash = "autonomy";
  });
  await admin.waitForFunction(() => document.body.dataset.view === "assets");
  record(
    "Header de administración alineado a la derecha; módulos retirados y enlaces anteriores redirigidos",
  );

  await view(admin, "audit");
  await admin.locator("#audit-rows tr").first().waitFor();
  assert.equal(
    await admin.getByRole("button", { name: /Aplicar filtros/ }).count(),
    0,
  );
  const search = admin.locator('#audit-filter-form [name="q"]');
  await search.fill("zzzz-sin-coincidencias");
  await admin.locator("#audit-rows .master-empty").waitFor();
  assert(await search.evaluate((el) => el === document.activeElement));
  await search.fill("");
  await admin
    .locator('#audit-filter-form [name="action"]')
    .selectOption("LOGIN_SUCCEEDED");
  await admin.waitForFunction(() =>
    document
      .querySelector("#audit-rows")
      .textContent.includes("Ingreso correcto"),
  );
  assert.equal(
    await admin.locator('#audit-filter-form [name="q"]').inputValue(),
    "",
  );
  await admin.locator('#audit-filter-form [name="from"]').fill("2026-12-31");
  await admin.locator('#audit-filter-form [name="to"]').fill("2026-01-01");
  assert.match(
    await admin.locator("#audit-filter-error").textContent(),
    /fecha/,
  );
  await admin.locator('[data-govern="audit-reset"]').click();
  await admin.locator('#audit-filter-form [name="q"]').waitFor();
  record(
    "Auditoría filtra al escribir y seleccionar, conserva el foco y valida el intervalo sin botón Aplicar",
  );

  await view(admin, "users");
  await admin.locator(".admin-person").first().waitFor();
  assert(
    await admin
      .locator(".admin-person")
      .first()
      .evaluate((el) => {
        const name = el.querySelector("strong").getBoundingClientRect(),
          email = el.querySelector("small").getBoundingClientRect();
        return email.top >= name.bottom;
      }),
  );
  await admin.screenshot({ path: path.join(output, "admin-users.png") });
  const created = await request(admin, "/api/users", {
    name: "Gestor de prueba",
    email: "qa-gestor@donpepe.local",
    role: "store",
    branchId: "TIENDA-1",
    password: "NuevaClave2026!",
    confirmation: "NuevaClave2026!",
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.roleName, "Gestor de tienda");
  await admin.reload();
  const row = admin
    .locator("#users-panel tr")
    .filter({ hasText: "qa-gestor@donpepe.local" });
  await row.waitFor();
  assert(
    await row
      .getByRole("button", { name: "Eliminar", exact: true })
      .isDisabled(),
  );
  await row.getByRole("button", { name: "Desactivar", exact: true }).click();
  await admin
    .locator('#govern-form [name="reason"]')
    .fill("Baja de acceso por cambio de responsable");
  await admin
    .locator("#govern-form button")
    .filter({ hasText: "Confirmar" })
    .click();
  await row.getByRole("button", { name: "Activar", exact: true }).waitFor();
  await row.getByRole("button", { name: "Eliminar", exact: true }).click();
  await admin
    .locator('#govern-form [name="reason"]')
    .fill("Eliminación autorizada de cuenta de prueba");
  await admin
    .locator("#govern-form button")
    .filter({ hasText: "Confirmar" })
    .click();
  await row.waitFor({ state: "detached" });
  assert.equal(
    await admin.getByRole("button", { name: /Suspender|Archivar/ }).count(),
    0,
  );
  assert.equal(
    runtime.identity.db
      .prepare(
        "SELECT json_extract(details,'$.reason') reason FROM security_audit WHERE action='USER_DELETED' ORDER BY id DESC LIMIT 1",
      )
      .get().reason,
    "Eliminación autorizada de cuenta de prueba",
  );
  record(
    "Gestor de tienda: desactivar, activar y eliminar con confirmación, auditoría e identidad histórica protegida",
  );

  const ops = await login("operaciones", "kardex");
  await ops.locator("#kardex-results[aria-busy=false]").waitFor();
  assert.equal(
    await ops
      .locator('nav a[href="#autonomy"],nav a[href="#analytics"]')
      .count(),
    0,
  );
  const rail = await ops.locator("#workspace-nav").boundingBox(),
    account = await ops.locator(".topbar-right").boundingBox();
  assert(rail.x + rail.width <= account.x + 1);
  assert.equal(
    await ops.getByRole("button", { name: /Aplicar filtros/ }).count(),
    0,
  );
  const query = ops.locator('#kardex-filters [name="query"]');
  await ops.route("**/api/inventory/movements?*", async (route) => {
    if (new URL(route.request().url()).searchParams.get("query") === "arroz")
      await new Promise((resolve) => setTimeout(resolve, 500));
    await route.continue();
  });
  await query.fill("arroz");
  await ops.waitForTimeout(170);
  await query.fill("zzzz-no-existe");
  await ops.locator("#kardex-results .empty-state").waitFor();
  await ops.waitForTimeout(650);
  assert(await ops.locator("#kardex-results .empty-state").isVisible());
  assert(await query.evaluate((el) => el === document.activeElement));
  await ops.locator("#kardex-clear").click();
  await ops.locator("#kardex-results[aria-busy=false]").waitFor();
  await ops.locator('#kardex-filters [name="type"]').selectOption({ index: 1 });
  await ops.locator("#kardex-results[aria-busy=false]").waitFor();
  const badRoutes = await ops
    .locator(".kardex-route strong")
    .evaluateAll(
      (items) =>
        items.filter(
          (el) =>
            el.getBoundingClientRect().right >
            el.closest("td").getBoundingClientRect().right + 1,
        ).length,
    );
  assert.equal(badRoutes, 0);
  assert(
    await ops
      .locator(".document-code")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 13),
  );
  await ops.screenshot({ path: path.join(output, "operations-kardex.png") });
  record(
    "Kardex en vivo: consulta rápida sin resultados atrasados, códigos legibles y ubicaciones largas dentro de su columna",
  );
  const store = await login("tienda", "shop");
  await store.locator('[data-store-filter="q"]').fill("zzzz-no-existe");
  assert.equal(await store.locator(".store-catalog-card").count(), 0);
  await store.locator('[data-store-action="reset-filters"]').click();
  assert((await store.locator(".store-catalog-card").count()) > 0);
  record(
    "Reposición de tienda mantiene filtros inmediatos y limpieza de la consulta",
  );
  assert.deepEqual(errors, []);
}
run()
  .catch((error) => {
    errors.push(error.stack || error.message);
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify({ checks, errors }, null, 2),
    );
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
  });
