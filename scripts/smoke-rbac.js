// Navegación y acciones denegadas únicamente: no crea usuarios ni modifica stock.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const isolated = process.argv.includes("--isolated");
const base =
  process.env.VERIFY_URL ||
  (isolated ? "http://127.0.0.1:3013" : "http://localhost:3000");
const output = process.env.VERIFY_OUTPUT || "/tmp/donpepe-rbac-verify";
async function settled(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
    await Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(a.effect.getComputedTiming().endTime))
        .map((a) => a.finished.catch(() => {})),
    );
  });
}
async function login(page, role, email, password) {
  await page.goto(base + "/login", { waitUntil: "domcontentloaded" });
  await page
    .locator("[name=correo]")
    .fill(process.env[`VERIFY_${role}_EMAIL`] || email);
  await page
    .locator("[name=password]")
    .fill(process.env[`VERIFY_${role}_PASSWORD`] || password);
  await page.locator("[type=submit]").click();
  await page.waitForURL((url) => url.pathname !== "/login", {
    waitUntil: "domcontentloaded",
  });
  await settled(page);
}
async function visit(page, path, expected = 200) {
  assert.equal(
    (await page.goto(base + path, { waitUntil: "domcontentloaded" })).status(),
    expected,
    path,
  );
  await settled(page);
}
async function deniedPost(page, path) {
  const csrf = await page.locator("[name=_csrf]").first().inputValue();
  const response = await page.request.post(base + path, {
    form: { _csrf: csrf },
    maxRedirects: 0,
  });
  assert.equal(response.status(), 403, path);
}
async function contrast(page, selector) {
  const ratio = await page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const lum = (a) =>
        a
          .slice(0, 3)
          .map((n) => {
            n /= 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          })
          .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
      const color = rgb(getComputedStyle(el).color);
      let node = el,
        background;
      while (node) {
        const c = rgb(getComputedStyle(node).backgroundColor);
        if (c.length === 3 || c[3] === 1) {
          background = c;
          break;
        }
        node = node.parentElement;
      }
      if (!background) background = [255, 255, 255];
      const [a, b] = [lum(color), lum(background)].sort((a, b) => b - a);
      return (a + 0.05) / (b + 0.05);
    });
  assert(ratio >= 4.5, `${selector}: contraste ${ratio.toFixed(2)}`);
}
async function main() {
  let server, fixturePassword;
  if (isolated) {
    // Solo en este proceso local: sesiones en memoria y credencial efímera del
    // jefe existente. No cambia su contraseña ni crea cuentas en MySQL.
    process.env.NODE_ENV = "test";
    const Store = require.resolve("../config/MySQLSessionStore");
    require.cache[Store] = {
      id: Store,
      filename: Store,
      loaded: true,
      exports: require("express-session").MemoryStore,
    };
    const User = require("../models/User");
    const find = User.findByEmail.bind(User);
    fixturePassword = require("node:crypto").randomBytes(24).toString("hex");
    const hash = await require("bcryptjs").hash(fixturePassword, 4);
    User.findByEmail = async (email) => {
      const user = await find(email);
      return user?.rol === "jefe_operaciones"
        ? { ...user, password: hash }
        : user;
    };
    const app = require("../app");
    server = await new Promise((resolve) => {
      const s = app.listen(3013, "127.0.0.1", () => resolve(s));
    });
  }
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const contexts = await Promise.all(
      [0, 1, 2].map(() =>
        browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      ),
    );
    const [admin, chief, rf] = await Promise.all(
      contexts.map((c) => c.newPage()),
    );
    const errors = [];
    for (const p of [admin, chief, rf])
      p.on("pageerror", (e) => errors.push(e.message));
    await login(admin, "ADMIN", "frank@minimarket.com", "admin123");
    await login(
      chief,
      "CHIEF",
      "carlos@minimarket.com",
      fixturePassword || "operaciones123",
    );
    await login(rf, "RF", "ana@minimarket.com", "rf123456");
    await deniedPost(admin, "/wms/tareas");
    await deniedPost(admin, "/wms/tareas/1/asignar");
    await deniedPost(admin, "/wms/sucursales/1/planificar");
    await visit(admin, "/wms/tareas/nueva", 403);
    await visit(admin, "/rf", 403);
    await visit(admin, "/dashboard");
    assert.equal(await admin.locator('a[href="/wms/tareas/nueva"]').count(), 0);
    await admin.screenshot({ path: output + "/admin.png" });
    await visit(admin, "/solicitudes");
    await contrast(admin, ".request-kpis strong");
    if (await admin.locator(".request-kpis .delivery-error").count())
      await contrast(admin, ".request-kpis .delivery-error strong");
    await contrast(admin, ".light-filter-bar label");
    if (await admin.locator(".request-title-row strong").count())
      await contrast(admin, ".request-title-row strong");
    await admin.screenshot({ path: output + "/recuperaciones.png" });
    await visit(admin, "/inventario/lotes");
    await admin.locator("[data-lot-qr]").first().click();
    await admin.locator("#lotQrModal").waitFor({ state: "visible" });
    await settled(admin);
    await contrast(admin, "#lotQrModal .modal-title");
    await contrast(admin, "#lotQrModal [data-lot-code]");
    await admin.screenshot({ path: output + "/etiqueta.png" });
    await deniedPost(chief, "/usuarios");
    await deniedPost(chief, "/compras");
    await deniedPost(chief, "/auditorias/1/aprobar");
    for (const path of [
      "/usuarios",
      "/solicitudes",
      "/compras",
      "/catalogos/categorias",
      "/reportes",
      "/rf",
    ])
      await visit(chief, path, 403);
    await visit(chief, "/dashboard");
    assert.equal(await chief.locator('.sidebar a[href="/compras"]').count(), 0);
    for (const selector of [
      ".warehouse-hero h1",
      ".task-summary strong",
      ".task-summary small",
      ".zone-card strong",
      ".zone-card b",
      ".zone-card small",
      ".sidebar .nav-link",
    ])
      await contrast(chief, selector);
    await chief.screenshot({ path: output + "/jefe.png" });
    const code = await chief
      .locator(".zone-card header span")
      .first()
      .innerText();
    await chief.locator(".zone-card").first().click();
    assert.equal(new URL(chief.url()).searchParams.get("zone"), code);
    for (const path of [
      "/productos",
      "/inventario/lotes",
      "/wms/tareas",
      "/wms/tareas/nueva",
      "/wms/sucursales",
      "/auditorias",
    ])
      await visit(chief, path);
    await visit(chief, "/wms/tareas");
    assert((await chief.locator(".task-assignment").count()) > 0);
    await chief.screenshot({ path: output + "/delegacion.png" });
    await chief.setViewportSize({ width: 390, height: 844 });
    await visit(chief, "/dashboard");
    assert(
      await chief.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Dashboard móvil desborda",
    );
    await chief.screenshot({ path: output + "/jefe-mobile.png" });
    await deniedPost(rf, "/wms/tareas/1/asignar");
    for (const path of [
      "/usuarios",
      "/dashboard",
      "/compras",
      "/wms/posiciones",
      "/wms/api/scan?code=X",
    ])
      await visit(rf, path, 403);
    await rf.setViewportSize({ width: 390, height: 844 });
    for (const path of [
      "/rf",
      "/rf/check-in",
      "/rf/picking",
      "/rf/recepcion",
      "/rf/count",
    ]) {
      await visit(rf, path);
      assert.equal(await rf.locator(".sidebar").count(), 0);
    }
    await visit(rf, "/rf");
    await rf.screenshot({ path: output + "/rf-mobile.png" });
    assert.deepEqual(errors, []);
    console.log(
      "RBAC HTTP, contraste, QR, tres roles y móvil: OK. Capturas: " + output,
    );
  } finally {
    await browser.close();
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      await require("../config/db").pool.end();
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
