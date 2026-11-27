"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events"),
  { PNG } = require("pngjs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const outputDir =
  process.env.DONPEPE_REFINEMENT_ADMIN_QA_OUTPUT ||
  path.resolve(__dirname, "../../../DonPepe-Refinamiento-Admin-2026-10-18");
const dataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "donpepe-admin-refinement-"),
);
const checks = [],
  screenshots = [],
  errors = [],
  layouts = [];
let runtime, server, browser, page, base;
const admin = { id: "qa-admin-reader", role: "admin" };
const snapshot = () => runtime.simulation.snapshot(admin);
const record = (value) => {
  checks.push(value);
  process.stdout.write(value + "\n");
};
async function navigate(view) {
  await page.evaluate((value) => {
    location.hash = value;
  }, view);
  await page.waitForFunction(
    (value) =>
      document.body.dataset.view === value &&
      !document.querySelector("#main .loading-screen"),
    view,
  );
  await page.locator("#main h1").waitFor();
}
async function close() {
  if (await page.locator("#dialog[open]").count())
    await page.locator("#dialog-close").click();
}
async function responseClick(locator, url, predicate) {
  const pending = page.waitForResponse(
    (response) =>
      response.url().endsWith(url) &&
      response.request().method() !== "GET" &&
      (!predicate || predicate(response.request().postDataJSON())),
  );
  await locator.click();
  const response = await pending;
  return { status: response.status(), body: await response.json() };
}
async function fill(name, value, form = "#asset-settings-form") {
  const field = page.locator(`${form} [name="${name}"]`);
  if (await field.evaluate((el) => el.tagName === "SELECT"))
    await field.selectOption(String(value));
  else await field.fill(String(value));
}
async function capture(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const images = [
      ...document.querySelectorAll("#main img,#dialog[open] img"),
    ];
    for (const image of images) image.loading = "eager";
    await Promise.all(images.map((image) => image.decode().catch(() => {})));
    document
      .querySelectorAll("#toasts .toast button")
      .forEach((button) => button.click());
  });
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    dialog: (() => {
      const dialog = document.querySelector("#dialog[open]");
      if (!dialog) return null;
      const rect = dialog.getBoundingClientRect();
      return {
        x: rect.x,
        right: rect.right,
        y: rect.y,
        bottom: rect.bottom,
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
      `${name}: modal fuera del viewport`,
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
  const response = await context.request.fetch(`${base}${url}`, {
    method,
    ...(body === undefined ? {} : { data: body }),
    headers: csrf ? { "X-CSRF-Token": csrf } : {},
  });
  return { status: response.status(), body: await response.json() };
}
function photo() {
  const size = 256,
    data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      data[offset] = 80 + x / 3;
      data[offset + 1] = 90 + y / 3;
      data[offset + 2] = 135;
      data[offset + 3] = 255;
    }
  return PNG.sync.write({ width: size, height: size, data });
}
async function pendingConfiguration(context) {
  runtime.simulation.command(
    "simulation.pause",
    { paused: false },
    { id: "qa-ops", role: "operations" },
  );
  const order = runtime.simulation.command(
    "order.create",
    {
      lines: [{ skuId: "SKU-ARROZ", cases: 1 }],
      notes: "Revisión de aplicación segura de reglas.",
    },
    { id: "qa-store", role: "store", branchId: "TIENDA-1" },
  );
  runtime.simulation.command(
    "order.release",
    { id: order.id },
    { id: "qa-ops", role: "operations" },
  );
  let busy;
  for (let i = 0; i < 300; i++) {
    runtime.simulation.advance(2);
    busy = snapshot().catalog.assets.find(
      (asset) =>
        asset.type === "AMR" &&
        !asset.safeForMaintenance &&
        asset.deviceState !== "FAULT",
    );
    if (busy) break;
  }
  assert(busy, "Un robot realiza una misión antes del cambio de reglas");
  await navigate("assets");
  await page.reload();
  await page
    .locator(`[data-admin-data="configure"][data-id="${busy.id}"]`)
    .waitFor();
  await page
    .locator(`[data-admin-data="configure"][data-id="${busy.id}"]`)
    .click();
  const priority =
    busy.settings.priority === 100 ? 99 : busy.settings.priority + 1;
  await fill("priority", priority);
  const result = await responseClick(
    page.locator("#asset-settings-form .dialog-actions button").last(),
    "/api/commands",
    (body) => body.type === "config.asset.configure",
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  let current = snapshot().catalog.assets.find((asset) => asset.id === busy.id);
  assert.equal(current.settings.priority, busy.settings.priority);
  assert.equal(current.pendingSettings.settings.priority, priority);
  await page
    .locator(`[data-admin-data="configure"][data-id="${busy.id}"]`)
    .click();
  assert(
    await page
      .locator("#asset-settings-form .dialog-actions .primary")
      .isDisabled(),
  );
  assert(
    (await page.locator("#asset-settings-form .notice").textContent()).includes(
      "pendiente",
    ),
  );
  await capture("reglas-pendientes-parada-segura");
  await close();
  for (let i = 0; i < 800; i++) {
    runtime.simulation.advance(2);
    current = snapshot().catalog.assets.find((asset) => asset.id === busy.id);
    if (!current.pendingSettings) break;
  }
  assert(
    !current.pendingSettings,
    "Las reglas se aplican cuando el robot queda seguro",
  );
  assert.equal(current.settings.priority, priority);
  record(
    "Configuración durante una misión: valores efectivos conservados, aviso pendiente de sólo lectura y aplicación al quedar seguro",
  );
}
async function readonlyOperationsRules() {
  const operations = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  assert.equal(
    (
      await request(operations, "/api/login", {
        email: "operaciones@donpepe.local",
        password: "DonPepe2026!",
      })
    ).status,
    200,
  );
  page = await operations.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  const commands = [];
  page.on("request", (req) => {
    if (req.url().endsWith("/api/commands") && req.method() === "POST")
      commands.push(req.postDataJSON()?.type);
  });
  await page.goto(`${base}/#equipment`);
  await page.locator('[data-action="equipment-rules"]').first().waitFor();
  assert.equal(await page.locator("#map-host canvas").count(), 0);
  const chargers = snapshot().catalog.assets.filter(
    (asset) => asset.type === "CHARGER",
  );
  for (const charger of chargers) {
    const card = page.locator(`[data-readonly-asset="${charger.id}"]`);
    await card.waitFor();
    assert.equal(
      await card
        .locator(
          '[data-action="fault-equipment"],[data-action="recover-equipment"],[data-action="request-maintenance"]',
        )
        .count(),
      0,
    );
    await card.locator('[data-action="equipment-rules"]').click();
    await page.locator("[data-equipment-rule-view]").waitFor();
    assert.equal(
      await page.locator('[data-rule-key="speedProfile"]').count(),
      0,
    );
    assert.equal(await page.locator('[data-rule-key="autoAssign"]').count(), 1);
    await close();
  }
  record(
    "Activos auxiliares: cargadores visibles con foto y consulta compatible, sin botones de incidencia o recuperación no admitidos",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => window.DonPepeTheme.set(value), theme);
      await capture(`operaciones-equipos-${theme}-${width}`);
      await page.locator('[data-action="equipment-rules"]').first().click();
      await page.locator("[data-equipment-rule-view]").waitFor();
      assert.equal(
        await page
          .locator(
            "[data-equipment-rule-view] input,[data-equipment-rule-view] select,[data-equipment-rule-view] textarea",
          )
          .count(),
        0,
      );
      await capture(`operaciones-reglas-consulta-${theme}-${width}`);
      await close();
      const photo = page.locator(".equipment-card .equipment-photo").first();
      const style = await photo.evaluate((image) => ({
        fit: getComputedStyle(image).objectFit,
        height: image.getBoundingClientRect().height,
      }));
      assert(
        style.fit === "contain" && style.height >= 200,
        JSON.stringify(style),
      );
    }
  }
  assert.equal(commands.length, 0);
  record(
    "Operaciones: consulta de reglas efectiva y límites sin formularios ni comandos de configuración, fotos completas y temas1440/390px",
  );
  runtime.simulation.command(
    "simulation.pause",
    { paused: false },
    { id: "qa-ops", role: "operations" },
  );
  const order = runtime.simulation.command(
    "order.create",
    { lines: [{ skuId: "SKU-ARROZ", cases: 1 }] },
    { id: "qa-store", role: "store", branchId: "TIENDA-1" },
  );
  runtime.simulation.command(
    "order.release",
    { id: order.id },
    { id: "qa-ops", role: "operations" },
  );
  let asset;
  for (let i = 0; i < 300; i++) {
    runtime.simulation.advance(2);
    asset = snapshot().catalog.assets.find(
      (row) => row.type === "AMR" && !row.safeForMaintenance,
    );
    if (asset) break;
  }
  assert(asset);
  const nextPriority =
    asset.settings.priority === 100 ? 99 : asset.settings.priority + 1;
  runtime.simulation.command(
    "config.asset.configure",
    {
      id: asset.id,
      expectedRevision: snapshot().configuration.revision,
      settings: { priority: nextPriority },
    },
    admin,
  );
  await page.reload();
  await page
    .locator(`[data-action="equipment-rules"][data-id="${asset.id}"]`)
    .click();
  await page.locator("[data-equipment-rule-view]").waitFor();
  assert.equal(
    await page
      .locator('[data-rule-key="priority"] .equipment-rule-pending dd')
      .textContent(),
    String(nextPriority),
  );
  assert.equal(
    await page
      .locator('[data-rule-key="priority"] dl > div:first-child dd')
      .textContent(),
    String(asset.settings.priority),
  );
  await capture("operaciones-reglas-pendientes-consulta");
  await close();
  assert.equal(commands.length, 0);
  record(
    "Operaciones: valores activos y pendientes diferenciados durante una misión, sin aplicar ni alterar reglas",
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  await operations.close();
}
async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  runtime = createApp({
    dataDir,
    startClock: false,
    mailEnv: {},
    mailTransport: {
      async sendMail() {
        throw Error("Correo bloqueado en esta verificación");
      },
      close() {},
    },
  });
  runtime.simulation.command(
    "simulation.pause",
    { paused: true },
    { id: "qa-clock", role: "operations" },
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
  assert.equal(await page.locator("#map-host canvas").count(), 0);
  if (process.env.DONPEPE_REFINEMENT_ADMIN_QA_SCOPE === "pending") {
    await pendingConfiguration(context);
    return;
  }
  if (process.env.DONPEPE_REFINEMENT_ADMIN_QA_SCOPE === "readonly") {
    await readonlyOperationsRules();
    return;
  }
  const users = (await request(context, "/api/users")).body.users,
    ops = users.find((user) => user.role === "operations");
  assert(ops);
  await navigate("users");
  await page.locator(`[data-govern="edit-user"][data-id="${ops.id}"]`).click();
  await page.locator("#admin-avatar-form").waitFor();
  await page.locator("#admin-user-photo").setInputFiles({
    name: "no-es-foto.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("formato inválido"),
  });
  await page
    .locator("#admin-avatar-error")
    .filter({ hasText: "JPG" })
    .waitFor();
  assert(await page.locator('#admin-user-photo[aria-invalid="true"]').count());
  await page.locator("#admin-user-photo").setInputFiles({
    name: "foto-qa.png",
    mimeType: "image/png",
    buffer: photo(),
  });
  await page.waitForFunction(
    () =>
      !document.querySelector('#admin-avatar-form [type="submit"]').disabled,
  );
  const uploaded = await responseClick(
    page.locator('#admin-avatar-form [type="submit"]'),
    `/api/users/${ops.id}/avatar`,
  );
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body));
  assert(uploaded.body.user.avatarUrl);
  await page.waitForFunction(() =>
    document
      .querySelector(".admin-photo-preview img")
      ?.src.includes("/api/avatars/"),
  );
  await capture("usuario-foto-guardada-1440");
  await page
    .locator('#govern-form [name="name"]')
    .fill("Operaciones · revisión de auditoría");
  const edited = await responseClick(
    page.locator("#govern-form .dialog-actions button").last(),
    `/api/users/${ops.id}`,
  );
  assert.equal(edited.status, 200);
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  assert(await page.locator(".admin-directory-avatar img").count());
  await page.locator(`[data-govern="edit-user"][data-id="${ops.id}"]`).click();
  await page.locator(".admin-photo-preview img").waitFor();
  await close();
  record(
    "Usuarios: rechazo visible de archivo inválido, foto guardada desde administración, persistencia tras editar y en el directorio",
  );

  await navigate("assets");
  const assets = snapshot().catalog.assets,
    schemas = snapshot().deviceSettingSchemas;
  assert(schemas.AMR && schemas.CHARGER);
  const amr = assets.find(
    (asset) => asset.type === "AMR" && asset.safeForMaintenance,
  );
  await page
    .locator(`[data-admin-data="configure"][data-id="${amr.id}"]`)
    .click();
  await fill("priority", 101);
  await page
    .locator("#asset-settings-form .dialog-actions button")
    .last()
    .click();
  await page.locator('[name="priority"][aria-invalid="true"]').waitFor();
  await fill("priority", 80);
  await fill("speedProfile", "ECO");
  const configured = await responseClick(
    page.locator("#asset-settings-form .dialog-actions button").last(),
    "/api/commands",
    (body) => body.type === "config.asset.configure",
  );
  assert.equal(configured.status, 200, JSON.stringify(configured.body));
  await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  const updated = snapshot().catalog.assets.find(
    (asset) => asset.id === amr.id,
  );
  assert.equal(updated.settings.priority, 80);
  assert.equal(updated.settings.speedProfile, "ECO");
  record(
    "Configuración de activos: límite de prioridad visible y reglas Eco/prioridad persistidas en el dispositivo compatible",
  );

  for (const type of [
    "AMR",
    "STACKER",
    "SHUTTLE",
    "FORKLIFT",
    "TRUCK",
    "CHARGER",
  ]) {
    const asset = assets.find((row) => row.type === type);
    await page
      .locator(`[data-admin-data="configure"][data-id="${asset.id}"]`)
      .click();
    const controls = await page
      .locator("#asset-settings-form [name]")
      .evaluateAll((nodes) =>
        [...new Set(nodes.map((node) => node.name))].sort(),
      );
    assert.deepEqual(
      controls,
      schemas[type].fields.map((field) => field.key).sort(),
      type,
    );
    if (type === "CHARGER")
      assert.equal(await page.locator('[name="speedProfile"]').count(), 0);
    for (const task of schemas[type].mustKeepTasks)
      assert(
        await page
          .locator(`[name="allowedTasks"][value="${task}"]`)
          .isDisabled(),
      );
    await capture(`configuracion-${type.toLowerCase()}-1440`);
    await close();
  }
  record(
    "Seis clases de maquinaria: formularios específicos, tareas de retorno obligatorias y cargador sin parámetros incompatibles",
  );

  await navigate("audit");
  await page.locator("#audit-filter-form").waitFor();
  assert((await page.locator("#audit-rows tr").count()) > 0);
  await fill("from", "2026-10-20", "#audit-filter-form");
  await fill("to", "2026-10-01", "#audit-filter-form");
  await page
    .locator("#audit-filter-form button")
    .filter({ hasText: "Aplicar filtros" })
    .click();
  await page.locator('[name="to"][aria-invalid="true"]').waitFor();
  await page.locator('[data-govern="audit-reset"]').click();
  await page.locator("#audit-rows tr").first().waitFor();
  await page
    .locator('#audit-filter-form [name="q"]')
    .fill("config.asset.configure");
  await page
    .locator("#audit-filter-form button")
    .filter({ hasText: "Aplicar filtros" })
    .click();
  await page.waitForFunction(() =>
    document.querySelector("#audit-count")?.textContent.includes("eventos"),
  );
  const auditResult = await request(
    context,
    "/api/audit?q=config.asset.configure&limit=50",
  );
  assert.equal(auditResult.status, 200);
  assert(
    auditResult.body.total > 0,
    "Auditoría de la configuración disponible",
  );
  await page.locator('[data-govern="audit-detail"]').first().click();
  await page.locator(".audit-inspection").waitFor();
  await capture("auditoria-detalle-configuracion-1440");
  assert(
    !(await page.locator(".audit-inspection").textContent()).includes(
      "DonPepe2026!",
    ),
  );
  await close();
  const downloaded = page.waitForEvent("download");
  await page.locator('[data-govern="audit-export"]').click();
  const file = await downloaded;
  assert.equal(file.suggestedFilename(), "DonPepe-auditoria.csv");
  record(
    "Auditoría: fechas incoherentes marcadas, búsqueda filtrada, detalle de cambios redactado y exportación CSV",
  );

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    for (const theme of ["dark", "light"]) {
      await page.evaluate((value) => window.DonPepeTheme.set(value), theme);
      for (const view of [
        "catalog",
        "categories",
        "brands",
        "assets",
        "audit",
      ]) {
        await navigate(view);
        await capture(`${view}-${theme}-${width}`);
        if (view !== "audit") {
          const images = await page
            .locator(
              "#main .master-record-media > img,#main .admin-entity-photo > img",
            )
            .evaluateAll((images) =>
              images.map((image) => ({
                fit: getComputedStyle(image).objectFit,
                loaded: image.complete && image.naturalWidth > 0,
              })),
            );
          assert(
            images.every((image) => image.fit === "contain" && image.loaded),
            `${view}: imágenes completas y visibles`,
          );
        }
      }
      await navigate("assets");
      await page
        .locator(`[data-admin-data="configure"][data-id="${amr.id}"]`)
        .click();
      await capture(`configuracion-amr-${theme}-${width}`);
      const short = page.locator(
        '#asset-settings-form select[name="speedProfile"]',
      );
      const sizing = await short.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        font: parseFloat(getComputedStyle(element).fontSize),
      }));
      assert(sizing.height >= 44 && sizing.font >= 12, JSON.stringify(sizing));
      await close();
      await navigate("users");
      await page
        .locator(`[data-govern="edit-user"][data-id="${ops.id}"]`)
        .click();
      await capture(`usuario-foto-modal-${theme}-${width}`);
      await close();
      await navigate("audit");
      await page.locator('[data-govern="audit-detail"]').first().click();
      await capture(`auditoria-modal-${theme}-${width}`);
      await close();
    }
  }
  record(
    "Vistas y modales: ambos temas a1440/390px, imágenes sin recortes y selectores con altura/tipografía legibles",
  );

  await navigate("users");
  await page.locator(`[data-govern="edit-user"][data-id="${ops.id}"]`).click();
  const removed = await responseClick(
    page.locator("#admin-remove-photo"),
    `/api/users/${ops.id}/avatar`,
  );
  assert.equal(removed.status, 200);
  assert(!removed.body.user.avatarUrl);
  await close();
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
      (
        await request(
          other,
          `/api/users/${ops.id}/avatar`,
          { dataUrl: `data:image/png;base64,${photo().toString("base64")}` },
          "PUT",
        )
      ).status,
      403,
    );
    assert.equal((await request(other, "/api/audit")).status, 403);
    assert.equal(
      (
        await request(other, "/api/commands", {
          type: "config.asset.configure",
          payload: {
            id: amr.id,
            expectedRevision: snapshot().configuration.revision,
            settings: { priority: 90 },
          },
        })
      ).status,
      403,
    );
    await other.close();
  }
  record(
    "RBAC: operación/tienda no cambian fotos ajenas, no consultan auditoría ni configuran equipos; retirada de foto administrativa funcional",
  );
  assert.equal(errors.length, 0, JSON.stringify(errors));
  record("Sin errores JavaScript durante los recorridos administrativos");
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
        path: path.join(outputDir, "admin-refinement-error.png"),
        fullPage: true,
      });
    } catch {}
  } finally {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(outputDir, "verificacion-refinamiento-admin.json"),
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
            map: "No se instancia el mapa operativo",
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
