"use strict";
// Administrative journeys use a fresh disposable SQLite database and a mail
// transport that refuses delivery. The operational renderer is not instantiated.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const outputDir =
  process.env.DONPEPE_EXPANSION_QA_OUTPUT ||
  path.resolve(__dirname, "../../../DonPepe-Ampliacion-2026-10-17");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-expansion-qa-"));
const checks = [],
  screenshots = [],
  errors = [],
  layouts = [];
let runtime, browser, server, page, base;
const actor = { id: "expansion-qa", role: "admin" };
const snapshot = () => runtime.simulation.snapshot(actor);
const record = (text) => {
  checks.push(text);
  process.stdout.write(text + "\n");
};
async function navigate(view) {
  await page.evaluate((target) => {
    location.hash = target;
  }, view);
  await page.waitForFunction(
    (target) =>
      document.body.dataset.view === target &&
      !document.querySelector("#main .loading-screen"),
    view,
  );
  await page.locator("#main h1").waitFor();
}
async function fill(values, form = "#admin-data-form") {
  for (const [name, value] of Object.entries(values)) {
    const field = page.locator(`${form} [name="${name}"]`);
    if (await field.evaluate((el) => el.tagName === "SELECT"))
      await field.selectOption(String(value));
    else await field.fill(String(value));
  }
}
async function commandClick(control, type, ok = true) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/commands") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.type === type,
  );
  await control.click();
  const response = await pending,
    body = await response.json();
  assert.equal(
    response.ok(),
    ok,
    `${type}: ${response.status()} ${JSON.stringify(body)}`,
  );
  if (ok) await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  return body;
}
const submit = (form) => page.locator(`${form} .dialog-actions button`).last();
async function close() {
  if (await page.locator("#dialog[open]").count())
    await page.locator("#dialog-close").click();
}
async function capture(name) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    const images = [
      ...document.querySelectorAll("#main img,#dialog[open] img"),
    ];
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    document
      .querySelectorAll("#toasts .toast button")
      .forEach((button) => button.click());
  });
  const sizes = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    dialog: (() => {
      const d = document.querySelector("#dialog[open]");
      if (!d) return null;
      const r = d.getBoundingClientRect();
      return {
        x: r.x,
        right: r.right,
        y: r.y,
        bottom: r.bottom,
        height: innerHeight,
      };
    })(),
  }));
  layouts.push({ name, ...sizes });
  assert(
    sizes.document <= sizes.viewport + 2 && sizes.body <= sizes.viewport + 2,
    `${name}: desbordamiento ${JSON.stringify(sizes)}`,
  );
  if (sizes.dialog)
    assert(
      sizes.dialog.x >= -1 &&
        sizes.dialog.right <= sizes.viewport + 1 &&
        sizes.dialog.y >= -1 &&
        sizes.dialog.bottom <= sizes.dialog.height + 1,
      `${name}: modal fuera del área visible`,
    );
  const file = path.join(outputDir, `${name}.png`);
  await page.screenshot({
    path: file,
    fullPage: !(await page.locator("#dialog[open]").count()),
    animations: "disabled",
  });
  screenshots.push(file);
}
async function request(
  context,
  url,
  body,
  method = body === undefined ? "GET" : "POST",
) {
  let csrf;
  if (method !== "GET" && url !== "/api/login")
    csrf = (await (await context.request.get(`${base}/api/me`)).json()).csrf;
  const result = await context.request.fetch(`${base}${url}`, {
    method,
    ...(body ? { data: body } : {}),
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  return { status: result.status(), body: await result.json() };
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({
    dataDir,
    startClock: false,
    mailEnv: {},
    mailTransport: {
      async sendMail() {
        throw Error("Verificación sin envío autorizado");
      },
      close() {},
    },
  });
  runtime.simulation.command(
    "simulation.pause",
    { paused: true },
    { id: "qa-ops", role: "operations" },
  );
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
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/login`);
  await page.locator('[name="email"]').fill("admin@donpepe.local");
  await page.locator('[name="password"]').fill("DonPepe2026!");
  await page.locator('#login-form [type="submit"]').click();
  await page.waitForURL(`${base}/`);
  await page.locator("#main h1").waitFor();
  assert(snapshot().catalog.skus.length >= 112, "Catálogo ampliado presente");
  assert.equal(await page.locator("#map-host canvas").count(), 0);
  record(
    "Administración: catálogo ampliado presente y sin renderizador operativo",
  );

  await navigate("categories");
  await page.locator('[data-admin-data="new"]').click();
  await submit("#admin-data-form").click();
  await page
    .locator('#admin-data-form [name="name"][aria-invalid="true"]')
    .waitFor();
  assert(
    (await page.locator("#admin-data-error").textContent()).includes("Corrige"),
  );
  await capture("categoria-validacion-visible-1440");
  await fill({
    code: "QA-CAT",
    name: "Categoría de control QA",
    description: "Categoría temporal para verificar compatibilidad y gestión.",
    imageUrl: snapshot().catalog.skus[0].imageUrl,
  });
  await page.locator('[name="zoneIds"][value="DRY"]').check();
  const category = (
    await commandClick(submit("#admin-data-form"), "config.category.create")
  ).result;
  assert(snapshot().catalog.categories.some((row) => row.id === category.id));
  await page.locator('[data-admin-data="new"]').click();
  await fill({ code: "QA-CAT", name: "Duplicado QA" });
  await fill({ imageUrl: snapshot().catalog.skus[0].imageUrl });
  await page.locator('[name="zoneIds"][value="DRY"]').check();
  await commandClick(
    submit("#admin-data-form"),
    "config.category.create",
    false,
  );
  await page.locator('[name="code"][aria-invalid="true"]').waitFor();
  await close();
  record(
    "Categorías: error visible por campos vacíos, creación y duplicado rechazado en su campo",
  );

  await navigate("brands");
  await page.locator('[data-admin-data="new"]').click();
  await fill({
    code: "QA-MARCA",
    name: "Marca de control QA",
    description: "Marca temporal para verificar proveedores vinculados.",
    imageUrl: snapshot().catalog.skus[0].imageUrl,
  });
  await page.locator('[name="supplierIds"]').first().check();
  const brand = (
    await commandClick(submit("#admin-data-form"), "config.brand.create")
  ).result;
  await page.locator("#admin-data-search").fill("Marca de control QA");
  await page.locator(`[data-admin-data="edit"][data-id="${brand.id}"]`).click();
  await fill({
    description: "Descripción actualizada desde la interfaz administrativa.",
  });
  await commandClick(submit("#admin-data-form"), "config.brand.update");
  await page
    .locator(`[data-admin-data="deactivate"][data-id="${brand.id}"]`)
    .click();
  await commandClick(submit("#admin-data-confirm"), "config.brand.deactivate");
  await page.locator("#admin-data-status").selectOption("inactive");
  await page
    .locator(`[data-admin-data="activate"][data-id="${brand.id}"]`)
    .click();
  await commandClick(submit("#admin-data-confirm"), "config.brand.activate");
  assert.equal(
    snapshot().catalog.brands.find((row) => row.id === brand.id).active,
    true,
  );
  record(
    "Marcas: creación, edición, desactivación y activación con proveedor vinculado",
  );

  await navigate("catalog");
  await page.locator('[data-govern="catalog-tab"][data-id="sku"]').click();
  assert.equal(
    await page.locator("#catalog-results .master-record").count(),
    24,
  );
  await page.locator('[data-govern="catalog-page"]').last().click();
  assert.equal(
    await page.locator("#catalog-results .master-record").count(),
    24,
  );
  await page.locator('[data-govern="new-catalog"]').click();
  assert(await page.locator('[name="brandId"]').count());
  assert(await page.locator('[name="categoryId"]').count());
  await capture("producto-relaciones-maestras-1440");
  await close();
  record(
    "Productos: paginación de 24 y selectores de marca/categoría compatibles",
  );

  await navigate("assets");
  await page.locator('[data-admin-data="new"]').click();
  await fill({
    code: "QA-ACTIVO",
    name: "Robot planificado QA",
    type: "AMR",
    manufacturer: "Fabricante de prueba",
    model: "Modelo académico QA",
    serialNumber: "QA-SERIE-UNICA",
    commissionDate: snapshot().clock.now.slice(0, 10),
    serviceIntervalHours: 250,
    capacityCases: 24,
    capacityKg: 1500,
    temperatureClass: "AMBIENT",
    notes: "Activo temporal no integrado al circuito.",
  });
  const asset = (
    await commandClick(submit("#admin-data-form"), "config.asset.create")
  ).result;
  const planned = snapshot().catalog.assets.find((row) => row.id === asset.id);
  assert.equal(planned.status, "PLANNED");
  assert.equal(planned.deviceId, null);
  record(
    "Activos: alta como planificado, sin generar robots ni rutas ficticias",
  );

  const liveAsset = snapshot().catalog.assets.find(
    (row) => row.deviceId && row.safeForMaintenance && row.type === "AMR",
  );
  assert(liveAsset, "Equipo en reposo disponible para servicio");
  await navigate("maintenance");
  await page.locator('[data-admin-data="request"]').first().click();
  await fill(
    {
      assetId: liveAsset.id,
      type: "PREVENTIVE",
      reason: "Inspección programada de seguridad del robot.",
    },
    "#admin-maintenance-form",
  );
  const job = (
    await commandClick(submit("#admin-maintenance-form"), "maintenance.request")
  ).result;
  await page
    .locator(`[data-admin-data="approve"][data-id="${job.id}"]`)
    .click();
  await fill(
    { technician: "Técnico de verificación QA" },
    "#admin-maintenance-form",
  );
  await commandClick(submit("#admin-maintenance-form"), "maintenance.approve");
  await page.locator(`[data-admin-data="start"][data-id="${job.id}"]`).click();
  await commandClick(submit("#admin-maintenance-form"), "maintenance.start");
  assert.equal(
    snapshot().maintenance.find((row) => row.id === job.id).state,
    "IN_PROGRESS",
  );
  await page
    .locator(`[data-admin-data="complete"][data-id="${job.id}"]`)
    .click();
  await submit("#admin-maintenance-form").click();
  await page
    .locator('#admin-maintenance-form [aria-invalid="true"]')
    .first()
    .waitFor();
  await capture("mantenimiento-cierre-validacion-1440");
  await fill(
    {
      cost: 75.5,
      notes:
        "Sensores, alimentación y ruedas verificados. Prueba sin carga completada satisfactoriamente.",
    },
    "#admin-maintenance-form",
  );
  for (const control of await page.locator('[name="completed"]').all())
    await control.check();
  await commandClick(submit("#admin-maintenance-form"), "maintenance.complete");
  assert.equal(
    snapshot().maintenance.find((row) => row.id === job.id).state,
    "COMPLETED",
  );
  assert.equal(
    snapshot().catalog.assets.find((row) => row.id === liveAsset.id).status,
    "AVAILABLE",
  );
  record(
    "Mantenimiento: solicitud, autorización, parada segura y cierre con todas las verificaciones; cierre incompleto rechazado",
  );

  const image = PNG.sync.write({
      width: 64,
      height: 64,
      data: Buffer.alloc(64 * 64 * 4, 255),
    }),
    imageBody = {
      kind: "category",
      dataUrl: `data:image/png;base64,${image.toString("base64")}`,
    };
  assert.equal(
    (await request(context, "/api/catalog-media", imageBody)).status,
    201,
  );
  for (const role of ["operaciones", "tienda"]) {
    const other = await browser.newContext();
    assert.equal(
      (
        await request(other, "/api/login", {
          email: `${role}@donpepe.local`,
          password: "DonPepe2026!",
        })
      ).status,
      200,
    );
    assert.equal(
      (await request(other, "/api/catalog-media", imageBody)).status,
      403,
    );
    assert.equal(
      (
        await request(other, "/api/commands", {
          type: "config.category.create",
          payload: {
            expectedRevision: snapshot().configuration.revision,
            data: {
              code: "FORBIDDEN",
              name: "Acción no permitida",
              zoneIds: ["DRY"],
            },
          },
        })
      ).status,
      403,
    );
    await other.close();
  }
  assert.equal(
    (
      await request(context, "/api/commands", {
        type: "simulation.request",
        payload: { commandId: "admin-denied" },
      })
    ).status,
    403,
  );
  record(
    "RBAC: sólo administración sube imágenes/edita maestros; administración no ejecuta solicitudes operativas",
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => window.DonPepeTheme.set(value), theme);
      for (const view of [
        "summary",
        "users",
        "roles",
        "catalog",
        "settings",
        "recoveries",
        "audit",
      ]) {
        await navigate(view);
        await capture(`admin-${view}-${theme}-${width}`);
      }
      await navigate("users");
      await page.locator('[data-govern="new-user"]').click();
      await capture(`usuario-modal-${theme}-${width}`);
      await close();
      await page.locator("#user-menu").click();
      await page.locator('[data-action="profile"]').first().click();
      await page.locator("#profile-name-form").waitFor();
      await capture(`perfil-modal-${theme}-${width}`);
      await close();
    }
  }
  record(
    "Administración completa: resumen, usuarios, permisos, catálogo, reglas, recuperaciones, auditoría y perfil revisados en ambos temas y anchos",
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => window.DonPepeTheme.set(value), theme);
      for (const view of ["categories", "brands", "assets", "maintenance"]) {
        await navigate(view);
        await capture(`${view}-${theme}-${width}`);
      }
      await navigate("assets");
      await page.locator('[data-admin-data="new"]').click();
      await capture(`activo-modal-${theme}-${width}`);
      await close();
    }
  }
  record(
    "Vistas y formularios nuevos: temas claro/oscuro en escritorio y móvil sin desbordamiento",
  );

  const adminPage = page;
  const publicContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  page = await publicContext.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.goto(`${base}/login`);
      await page.evaluate((value) => window.DonPepeTheme.set(value), theme);
      await capture(`login-${theme}-${width}`);
      await page.goto(`${base}/forgot-password`);
      await capture(`recuperacion-${theme}-${width}`);
      await page
        .locator(
          '#login-form button[type="submit"],#login-form button:not([type])',
        )
        .first()
        .click();
      assert(await page.locator('#login-form [aria-invalid="true"]').count());
    }
  }
  await publicContext.close();
  page = adminPage;
  record(
    "Acceso y recuperación: ambos temas, escritorio/móvil y validación visible del correo vacío",
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  record("Ningún error JavaScript durante los recorridos de administración");
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
        path: path.join(outputDir, "expansion-error.png"),
        fullPage: true,
      });
    } catch {}
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "verificacion-ampliacion.json"),
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
            mail: "Bloqueado, sin envíos",
            browser: "Chrome headless",
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
