"use strict";
const assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path"), os = require("node:os"), { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright"), { createApp } = require("../server"), { createSimulation } = require("../core/engine");
const output = process.env.DONPEPE_AUTONOMY_QA_OUTPUT || path.resolve(__dirname, "../../../DonPepe-Autonomia-2026-10-18");
const checks = [], screenshots = [], layouts = [], errors = [], messages = [];
let runtime, server, browser, page, failure, temp;
const OPS = { id: "qa-operations", role: "operations" };
const check = name => { checks.push(name); process.stdout.write(name + "\n"); };
async function capture(name) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, dialogWidth: document.querySelector("dialog[open]")?.clientWidth || 0, dialogScrollWidth: document.querySelector("dialog[open]")?.scrollWidth || 0, overflowElements: [...document.querySelectorAll("body *")].filter(element => { const r = element.getBoundingClientRect(); const style = getComputedStyle(element); return r.width > 0 && r.right > innerWidth + 2 && style.position !== "fixed" && !element.closest(".sidebar,.table-scroll,.autonomy-evidence-list pre"); }).slice(0, 8).map(element => ({ tag: element.tagName, cls: element.className })) }));
  layouts.push({ name, ...layout }); assert(layout.scrollWidth <= layout.width + 1, `${name}: ${JSON.stringify(layout)}`);
  if (layout.dialogWidth) assert(layout.dialogScrollWidth <= layout.dialogWidth + 2, `${name}: diálogo desbordado`);
  const filename = path.join(output, name + ".png"); await page.screenshot({ path: filename, fullPage: true, animations: "disabled" }); screenshots.push(filename);
}
(async () => {
  try {
    fs.mkdirSync(output, { recursive: true }); temp = fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-autonomy-qa-"));
    const simulationFile = path.join(temp, "simulation.sqlite");
    // Prepare one historical arrived document with the strictly controlled
    // receiving fixture. The browser runtime below reopens it in production mode.
    const legacy = createSimulation({ filename: simulationFile, controlledReceivingFixture: true });
    const sku = legacy.snapshot(OPS).catalog.skus.find(row => row.id === "SKU-ARROZ");
    const oldPurchaseId = legacy.command("purchase.create", { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 2 }] }, OPS).id;
    legacy.command("purchase.arrive", { id: oldPurchaseId }, OPS); legacy.close();
    runtime = createApp({ identityFile: ":memory:", simulationFile, startClock: false, mailEnv: {}, mailTransport: { sendMail: async message => { messages.push(message); return {}; } } });
    server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening"); const base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true, args: ["--disable-gpu"] });
    const sessions = {};
    for (const [role, email] of [["admin", "admin@donpepe.local"], ["operations", "operaciones@donpepe.local"], ["store", "tienda@donpepe.local"]]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
      const response = await context.request.post(base + "/api/login", { data: { email, password: "DonPepe2026!" } }); assert.equal(response.status(), 200);
      const me = await (await context.request.get(base + "/api/me")).json(); sessions[role] = { context, csrf: me.csrf };
    }
    const api = async (role, type, payload) => {
      const response = await sessions[role].context.request.post(base + "/api/commands", { headers: { "x-csrf-token": sessions[role].csrf }, data: { type, payload } });
      const body = await response.json(); assert.equal(response.status(), 200, JSON.stringify(body)); return body;
    };
    const newPurchase = await api("operations", "purchase.create", { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 3 }] }); const newPurchaseId = newPurchase.result.id;
    for (const role of ["admin", "operations", "store"]) {
      page = await sessions[role].context.newPage(); page.on("pageerror", error => errors.push({ role, message: error.message }));
      await page.goto(base + "/#autonomy"); await page.getByRole("heading", { name: "Centro de autonomía" }).waitFor();
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        for (const theme of ["dark", "light"]) {
          await page.evaluate(value => window.DonPepeTheme.set(value), theme); await capture(`${role}-${theme}-${width}`);
        }
      }
      assert.equal(await page.locator('[data-autonomy="configure"]').count(), role === "admin" ? 1 : 0);
      assert.equal(await page.locator('[data-autonomy="authorize"]').count(), role === "operations" ? 1 : 0);
      if (role === "admin") {
        await page.locator('[data-autonomy="configure"]').click(); await page.locator("#autonomy-settings-form").waitFor();
        assert.equal(await page.locator('#autonomy-settings-form input[name="safetyDisabled"]').count(), 0);
        assert.equal(await page.locator("#autonomy-settings-form input").count(), 14);
        await capture("admin-politica-light-390");
        await page.locator('#autonomy-settings-form input[name="unloadSeconds"]').fill("0");
        assert.equal(await page.locator("#autonomy-settings-form").evaluate(form => form.checkValidity()), false);
        await page.locator('#autonomy-settings-form input[name="unloadSeconds"]').fill("9");
        await page.locator("#autonomy-settings-form button[type=submit],#autonomy-settings-form button:not([type])").click();
        await page.locator("#autonomy-settings-form").waitFor({ state: "hidden" });
        assert.equal(runtime.simulation.snapshot(OPS).configuration.autonomy.unloadSeconds, 9);
        check("Administración configura límites válidos; no existe control editable para omitir seguridad; cambios persistidos sólo en la base temporal");
      }
      if (role === "operations") {
        const first = page.locator(".autonomy-job").filter({ hasText: newPurchaseId }); await first.locator('[data-autonomy="detail"]').click();
        await page.getByText("EXPEDIENTE DE AUTONOMÍA", { exact: true }).waitFor(); await capture("operations-expediente-pendiente-390");
        await page.locator("dialog[open]").evaluate(dialog => dialog.close());
        await page.locator(`[data-autonomy="authorize"][data-id="${oldPurchaseId}"]`).click();
        await page.locator("#autonomy-decision-form").waitFor(); await capture("operations-adopcion-390");
        await page.locator('#autonomy-decision-form textarea[name="reason"]').fill("Se autoriza verificar las cargas pendientes del proveedor");
        await page.getByRole("button", { name: "Autorizar e iniciar", exact: true }).click();
        await page.locator("#autonomy-decision-form").waitFor({ state: "hidden" });
        assert.equal(runtime.simulation.snapshot(OPS).autonomy.jobs.filter(job => job.documentId === oldPurchaseId).length, 1);
        check("Operaciones consulta expedientes y adopta un documento heredado con autorización explícita, sin edición manual de mercancía");
      }
      if (role === "store") {
        assert.equal(await page.locator(".autonomy-job").count(), 0); assert.equal(await page.locator(".autonomy-legacy-list").count(), 0);
        assert.match(await page.locator("main").innerText(), /tu sucursal/); check("Tienda sólo recibe su ámbito; no configura equipos ni adopta documentos de proveedores");
      }
      await page.close();
    }
    for (let i = 0; i < 1600; i++) { runtime.simulation.advance(1); if (runtime.simulation.snapshot(OPS).autonomy.jobs.every(job => job.state === "COMPLETED")) break; }
    const completed = runtime.simulation.snapshot(OPS); assert.equal(completed.autonomy.jobs.filter(job => job.state === "COMPLETED").length, 2);
    page = await sessions.operations.context.newPage(); page.on("pageerror", error => errors.push({ role: "operations-completed", message: error.message }));
    await page.goto(base + "/#autonomy"); await page.getByRole("heading", { name: "Centro de autonomía" }).waitFor();
    await page.locator("#autonomy-filter").selectOption("COMPLETED"); assert.equal(await page.locator(".autonomy-job").count(), 2);
    await page.locator(".autonomy-job").filter({ hasText: newPurchaseId }).locator('[data-autonomy="detail"]').click();
    await page.locator(".autonomy-evidence-list details").first().locator("summary").click();
    assert.ok(await page.locator(".autonomy-evidence-list details").count() >= 3); assert.match(await page.locator(".autonomy-evidence-list").innerText(), /SIMULATED_DEVICE/);
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 900 }); for (const theme of ["dark", "light"]) { await page.evaluate(value => window.DonPepeTheme.set(value), theme); await capture(`expediente-completo-${theme}-${width}`); } }
    check("Recepciones autónomas nuevas y heredadas completadas; expediente muestra identidad, seguridad y calidad con evidencias tipadas y sin desbordamiento");
    assert.equal(messages.length, 0); assert.equal(errors.length, 0, JSON.stringify(errors));
    check("Tres perfiles, dos temas y dos tamaños; sin errores JavaScript, sin correo real y sin cargar el mapa 3D");
  } catch (error) { failure = error; process.stderr.write(error.stack + "\n"); if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); }
  finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); runtime?.close();
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
    fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, "verificacion-autonomia.json"), JSON.stringify({ ok: !failure, checks, screenshots, layouts, errors, ...(failure ? { failure: failure.message } : {}), isolation: "SQLite temporal y cuentas de prueba; correo interceptado; sin cambios en datos reales, sin GPU y sin animar el mapa." }, null, 2));
    process.stdout.write(`${checks.length} recorridos; ${screenshots.length} capturas. ${output}\n`); if (failure) process.exitCode = 1;
  }
})();
