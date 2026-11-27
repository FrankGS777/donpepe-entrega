"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const { AUTONOMY_MEDIA_TYPES, autonomyAssetMedia } = require("../core/autonomy-media");

const output = process.env.DONPEPE_EQUIPMENT_MEDIA_QA_OUTPUT || path.resolve(__dirname, "../../../DonPepe-Equipos-Media-2026-10-18");
const checks = [], screenshots = [], errors = [];
let runtime, server, browser, page, failure;
const check = text => { checks.push(text); process.stdout.write(text + "\n"); };
async function imageReady(locator, expected) {
  await locator.waitFor({ state: "attached" });
  const result = await locator.evaluate(async (image) => {
    image.loading = "eager";
    await image.decode().catch(() => {});
    return {
      src: image.getAttribute("src"), width: image.naturalWidth,
      height: image.naturalHeight, fit: getComputedStyle(image).objectFit,
    };
  });
  assert.equal(result.src, expected, JSON.stringify(result));
  assert.ok(result.width >= 1000 && result.height >= 500, JSON.stringify(result));
  assert.equal(result.fit, "contain", JSON.stringify(result));
}
async function closeDialog() {
  await page.locator("#dialog").evaluate(dialog => dialog.close());
}
async function capture(name) {
  await page.evaluate(async () => { await document.fonts.ready; });
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(layout.scrollWidth <= layout.width + 2, `${name}: ${JSON.stringify(layout)}`);
  const file = path.join(output, name + ".png");
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  screenshots.push(file);
}
(async () => {
  try {
    fs.mkdirSync(output, { recursive: true });
    for (const type of AUTONOMY_MEDIA_TYPES) {
      const filename = path.resolve(__dirname, "../public" + autonomyAssetMedia(type).imageUrl);
      assert.ok(fs.existsSync(filename), `Falta recurso final: ${filename}`);
    }
    runtime = createApp({ identityFile: ":memory:", simulationFile: ":memory:", startClock: false, mailEnv: {}, mailTransport: { sendMail: async () => { throw Error("Esta prueba no envía correo"); } } });
    server = runtime.app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-gpu"] });
    const sessions = {};
    for (const [role, email] of [["admin", "admin@donpepe.local"], ["operations", "operaciones@donpepe.local"], ["store", "tienda@donpepe.local"]]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      const response = await context.request.post(base + "/api/login", { data: { email, password: "DonPepe2026!" } });
      assert.equal(response.status(), 200);
      sessions[role] = context;
    }
    const snapshot = runtime.simulation.snapshot({ id: "A", role: "admin" });
    const newAssets = snapshot.catalog.assets.filter(asset => AUTONOMY_MEDIA_TYPES.includes(asset.type));
    assert.equal(newAssets.length, 8);
    page = await sessions.admin.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/#assets");
    await page.locator("#admin-data-type").waitFor();
    for (const type of AUTONOMY_MEDIA_TYPES) {
      const asset = newAssets.find(row => row.type === type);
      await page.locator("#admin-data-type").selectOption(type);
      await imageReady(page.locator(".admin-asset-card img").first(), asset.imageUrl);
      for (const [action, selector] of [["detail", ".admin-asset-detail img"], ["configure", ".admin-device-config-hero img"], ["edit", "#master-preview-image img"]]) {
        await page.locator(`[data-admin-data="${action}"][data-id="${asset.id}"]`).click();
        await imageReady(page.locator(selector).first(), asset.imageUrl);
        await closeDialog();
      }
      check(`${type}: ficha, edición, configuración y listado administrativo muestran recurso completo`);
    }
    await page.locator("#admin-data-type").selectOption("");
    await page.locator("#admin-data-search").fill("autom");
    await capture("admin-activos-dark-1440");
    await page.goto(base + "/#maintenance");
    await page.locator('[data-admin-data="request"]').click();
    await page.locator('#admin-maintenance-form .entity-picker-trigger').click();
    for (const type of AUTONOMY_MEDIA_TYPES) {
      const asset = newAssets.find(row => row.type === type);
      await page.locator("#entity-picker-query").fill(asset.name);
      await imageReady(page.locator(`.entity-picker-card[data-picker-value="${asset.id}"] img`), asset.imageUrl);
    }
    await capture("admin-selector-equipo-dark-1440");
    await page.locator(".entity-picker-dialog").evaluate(dialog => dialog.close());
    await closeDialog();
    check("Selector visual de mantenimiento encuentra las seis clases nuevas con su fotografía correcta");
    await page.close();

    page = await sessions.operations.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + "/#equipment");
    await page.locator("[data-readonly-asset]").first().waitFor();
    for (const asset of newAssets) {
      const card = page.locator(`[data-readonly-asset="${asset.id}"]`);
      await imageReady(card.locator(".equipment-photo"), asset.imageUrl);
      await card.locator('[data-action="equipment-rules"]').click();
      await imageReady(page.locator(".equipment-rules-photo"), asset.imageUrl);
      await closeDialog();
      await card.locator('[data-action="request-maintenance"]').click();
      await imageReady(page.locator("#maintenance-request-form .equipment-photo"), asset.imageUrl);
      await closeDialog();
    }
    check("Operaciones: ocho equipos nuevos, reglas y solicitud técnica con imagen y sin facultades de configuración");
    await capture("operations-equipos-dark-1440");
    await page.close();

    for (const role of ["admin", "operations", "store"]) {
      page = await sessions[role].newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base + "/#autonomy");
      await page.locator(".autonomy-infrastructure").waitFor();
      const expected = role === "store" ? newAssets.filter(asset => asset.branchId === "TIENDA-1") : newAssets;
      assert.equal(await page.locator("[data-autonomy-asset]").count(), expected.length);
      for (const asset of expected) await imageReady(page.locator(`[data-autonomy-asset="${asset.id}"] img`), asset.imageUrl);
      for (const theme of ["dark", "light"]) {
        await page.evaluate(theme => window.DonPepeTheme.set(theme), theme);
        await page.setViewportSize({ width: 390, height: 844 });
        await capture(`${role}-autonomia-${theme}-390`);
      }
      check(`${role}: infraestructura fotográfica con ámbito autorizado, dos temas y móvil sin desbordamientos`);
      await page.close();
    }
    assert.deepEqual(errors, []);
  } catch (error) {
    failure = error;
    process.stderr.write(error.stack + "\n");
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    runtime?.close();
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "verificacion-equipos-media.json"), JSON.stringify({
      ok: !failure, checks, screenshots, errors,
      ...(failure ? { failure: failure.message } : {}),
      isolation: "SQLite exclusivamente en memoria, sin reloj, sin correo real, sin cargar mapa ni modificar existencias o cuentas reales.",
    }, null, 2));
    process.stdout.write(`${checks.length} comprobaciones; ${screenshots.length} capturas. ${output}\n`);
    if (failure) process.exitCode = 1;
  }
})();
