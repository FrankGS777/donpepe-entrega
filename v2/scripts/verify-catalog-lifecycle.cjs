"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const out = path.resolve(__dirname, "../../../catalog-lifecycle-20261027");
const checks = [],
  errors = [];
let runtime, server, browser, folder;
async function main() {
  fs.mkdirSync(out, { recursive: true });
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "dp-lifecycle-ui-"));
  runtime = createApp({ dataDir: folder, startClock: false });
  const actor = { id: "QA", role: "admin" },
    sim = runtime.simulation;
  const cfg = (kind, action, data) =>
    sim.command(
      `config.${kind}.${action}`,
      { expectedRevision: sim.snapshot(actor).configuration.revision, ...data },
      actor,
    );
  const imageUrl = "/images/catalog/sku-arroz.webp";
  const supplier = cfg("supplier", "create", {
    data: {
      code: "LIFECYCLE-SUP",
      name: "Proveedor LifecycleQA",
      zones: ["DRY"],
    },
  });
  const brand = cfg("brand", "create", {
    data: {
      code: "LIFECYCLE-BRAND",
      name: "Marca LifecycleQA",
      imageUrl,
      supplierIds: [supplier.id],
    },
  });
  const category = cfg("category", "create", {
    data: {
      code: "LIFECYCLE-CAT",
      name: "Categoría LifecycleQA",
      imageUrl,
      zoneIds: ["DRY"],
    },
  });
  const sku = cfg("sku", "create", {
    data: {
      code: "LIFECYCLE-SKU",
      name: "Producto LifecycleQA",
      supplierId: supplier.id,
      brandId: brand.id,
      categoryId: category.id,
      zoneId: "DRY",
      unitsPerCase: 12,
      expiryControlled: true,
      imageUrl,
    },
  });
  const asset = cfg("asset", "create", {
    data: {
      code: "LIFECYCLE-EQ",
      name: "Equipo LifecycleQA",
      manufacturer: "DonPepe",
      model: "Equipo planificado",
      type: "AMR",
      serialNumber: "LIFECYCLE-SN-001",
      commissionDate: "2026-10-17",
      imageUrl,
    },
  });
  const branch = cfg("branch", "create", {
    data: {
      code: "LIFECYCLE-BR",
      name: "Sucursal LifecycleQA",
      imageUrl,
      x: 110,
      z: 90,
      travelSeconds: 80,
    },
  });
  const receiver = sim
    .snapshot(actor)
    .catalog.assets.find((row) => row.branchId === branch.id);
  cfg("asset", "deactivate", { id: receiver.id });
  server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  assert.equal(
    (
      await context.request.post(base + "/api/login", {
        data: { email: "admin@donpepe.local", password: "DonPepe2026!" },
      })
    ).status(),
    200,
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const entities = { sku, brand, category, asset, branch, supplier };
  const views = {
    sku: "catalog",
    supplier: "catalog",
    branch: "catalog",
    brand: "brands",
    category: "categories",
    asset: "assets",
  };
  async function open(kind) {
    await page.goto(`${base}/#${views[kind]}`);
    await page.locator("#main h1").waitFor();
    if (views[kind] === "catalog")
      await page
        .locator(`[data-govern="catalog-tab"][data-id="${kind}"]`)
        .click();
    await page
      .locator(
        views[kind] === "catalog" ? "#catalog-search" : "#admin-data-search",
      )
      .fill("LifecycleQA");
  }
  function control(kind, action) {
    return page.locator(
      `[${views[kind] === "catalog" ? "data-govern" : "data-admin-data"}="${action}${views[kind] === "catalog" ? "-catalog" : ""}"][data-id="${entities[kind].id}"]`,
    );
  }
  const filter = (kind) =>
    page.locator(
      views[kind] === "catalog" ? "#catalog-status" : "#admin-data-status",
    );
  async function act(kind, action) {
    await control(kind, action).click();
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/commands") &&
        r.request().postDataJSON()?.type === `config.${kind}.${action}`,
    );
    const form =
      views[kind] === "catalog" ? "#govern-form" : "#admin-data-confirm";
    await page
      .locator(`${form} [name="reason"]`)
      .fill("Cambio comprobado desde la interfaz");
    await page.locator(`${form} .dialog-actions button`).last().click();
    const response = await pending;
    assert.equal(response.status(), 200, JSON.stringify(await response.json()));
    await page.locator("#dialog[open]").waitFor({ state: "hidden" });
  }
  for (const kind of Object.keys(entities)) {
    await open(kind);
    await filter(kind).selectOption("active");
    await control(kind, "deactivate").waitFor();
    assert(await control(kind, "delete").isDisabled());
    assert.equal(
      await page.getByRole("button", { name: /Archivar|Restaurar/ }).count(),
      0,
    );
    await act(kind, "deactivate");
    await filter(kind).selectOption("inactive");
    await control(kind, "activate").waitFor();
    await act(kind, "activate");
    await filter(kind).selectOption("active");
    await control(kind, "deactivate").waitFor();
    await act(kind, "deactivate");
    await filter(kind).selectOption("inactive");
    if (kind === "asset")
      for (const width of [1440, 390]) {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 1000,
        });
        assert(
          (await page.evaluate(() => document.documentElement.scrollWidth)) <=
            width + 2,
        );
        await page.screenshot({
          path: path.join(out, `inactive-equipment-${width}.png`),
          fullPage: true,
        });
      }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await act(kind, "delete");
    await filter(kind).selectOption("all");
    assert.equal(await control(kind, "activate").count(), 0);
    assert.equal(await control(kind, "delete").count(), 0);
    checks.push(
      `${kind}: desactivar, activar, eliminar y exclusión de Todos comprobados`,
    );
    console.log(checks.at(-1));
  }
  await open("sku");
  await page.locator("#catalog-search").fill("Arroz superior Costeño");
  await filter("sku").selectOption("active");
  await page
    .locator('[data-govern="deactivate-catalog"][data-id="SKU-ARROZ"]')
    .click();
  const blocked = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/commands") &&
      r.request().postDataJSON()?.type === "config.sku.deactivate",
  );
  await page.locator("#govern-form .dialog-actions button").last().click();
  assert.equal((await blocked).status(), 409);
  await page.locator("#govern-error:not(:empty)").waitFor();
  await page.screenshot({ path: path.join(out, "stock-protected.png") });
  checks.push(
    "Las existencias impiden la retirada y el formulario muestra la causa",
  );
  await page.locator("#dialog-close").click();
  await page.goto(base + "/#assets");
  await page.locator("#admin-data-status").waitFor();
  await page.evaluate(() => sessionStorage.setItem("donpepe:admin:assets", JSON.stringify({ version: 2, status: "archived", query: "LifecycleQA" })));
  await page.reload();
  assert.equal(await page.locator("#admin-data-status").inputValue(), "inactive");
  await page.locator('[data-admin-data="activate"]').first().waitFor();
  checks.push("Los filtros guardados de la versión anterior se convierten a Desactivados");
  assert.deepEqual(errors, []);
}
main()
  .catch((e) => {
    errors.push(e.stack);
    console.error(e);
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
