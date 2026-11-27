"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const { newToken, hashToken } = require("../security/identity");
const output = process.env.DONPEPE_AUTH_QA_OUTPUT || path.resolve(__dirname, "../../../DonPepe-Acceso-Premium-2026-10-18");
const screenshots = [], checks = [], errors = [], layouts = [], mail = [];
let runtime, server, browser, page, base;
function check(name) { checks.push(name); process.stdout.write(name + "\n"); }
async function capture(name) {
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
  const layout = await page.evaluate(async () => {
    const image = document.querySelector(".auth-atmosphere img");
    const brand = document.querySelector(".login-panel .login-logo");
    const title = document.querySelector("#auth-title");
    const bounds = element => { const { x, y, width, height, bottom } = element.getBoundingClientRect(); return { x, y, width, height, bottom }; };
    const bitmap = await createImageBitmap(await (await fetch(image.currentSrc)).blob());
    const imagePixels = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, image: { loaded: imagePixels.width, height: imagePixels.height, intrinsicWidth: image.naturalWidth, source: image.currentSrc, fit: getComputedStyle(image).objectFit }, brand: brand ? bounds(brand) : null, title: bounds(title) };
  });
  assert(layout.scrollWidth <= layout.width + 1, JSON.stringify(layout));
  if (/^login-(dark|light)-(1440|390)$/.test(name)) assert(layout.scrollHeight <= layout.height + 1, `${name}: acceso inicial requiere desplazamiento vertical`);
  assert(layout.image.loaded > 1000);
  assert(layout.image.source.includes("donpepe-lima-exterior-v2"), "La imagen debe usar el nuevo recurso responsive");
  assert(layout.brand, "El logo debe estar dentro del panel de credenciales");
  assert(layout.brand.bottom < layout.title.y, "El logo debe quedar encima del título y las credenciales");
  assert(layout.brand.width >= Math.min(260, layout.width - 56), "El logo debe mantener presencia sin recortarse");
  assert.equal(await page.locator(".login-visual .login-logo,.auth-location").count(), 0);
  assert.equal(await page.getByText("Lima, Perú", { exact: true }).count(), 0);
  layouts.push({ name, ...layout });
  const file = path.join(output, name + ".png");
  await page.screenshot({ path: file, fullPage: true, animations: "disabled" });
  screenshots.push(file);
}
async function theme(value) { await page.evaluate(value => window.DonPepeTheme.set(value), value); }
async function post(context, url, data) {
  return context.request.post(base + url, { data });
}
(async () => {
  let failure;
  try {
    fs.mkdirSync(output, { recursive: true });
    runtime = createApp({ identityFile: ":memory:", simulationFile: ":memory:", startClock: false, mailEnv: {}, mailTransport: { sendMail: async message => { mail.push(message); return {}; } } });
    server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const appearance of ["dark", "light"]) {
        await page.goto(base + "/login"); await theme(appearance);
        await capture(`login-${appearance}-${width}`);
        assert.equal(await page.locator("[data-demo],.demo-access").count(), 0);
        assert.equal(await page.locator(".login-panel button[type=submit]").isVisible(), true);
        await page.locator(".recovery-link").click();
        await page.waitForURL("**/forgot-password");
        await page.locator("#login-form input[name=email]").waitFor();
        await capture(`recuperacion-${appearance}-${width}`);
        await page.goto(base + "/reset-password?token=invalid");
        await page.getByRole("heading", { name: "Este enlace no está disponible" }).waitFor();
        await capture(`enlace-vencido-${appearance}-${width}`);
      }
    }
    check("Acceso, recuperación y enlace inválido en ambos temas, 1440 y 390 px; imagen local cargada, sin desbordamiento ni accesos de demostración");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(base + "/login"); await theme("dark");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.locator("#auth-email-error").waitFor();
    assert.equal(await page.locator("[aria-invalid=true]").count(), 2);
    await page.locator("input[name=email]").fill("correo-invalido");
    await page.locator("input[name=password]").fill("WrongPassword2026!");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.locator("#auth-email-error").waitFor();
    await capture("login-validacion-campos");
    await page.locator("input[name=email]").fill("nadie@donpepe.local");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.locator("#login-error").filter({ hasText: "Revisa el correo" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Ingresar", exact: true }).isDisabled(), false);
    await page.getByRole("button", { name: "Mostrar contraseña" }).click();
    assert.equal(await page.locator("input[name=password]").getAttribute("type"), "text");
    await page.getByRole("button", { name: "Ocultar contraseña" }).click();
    assert.equal(await page.locator("input[name=password]").getAttribute("type"), "password");
    check("Validaciones de campos, correo inválido y credenciales rechazadas con recuperación del botón; alternancia de contraseña accesible");
    await page.goto(base + "/forgot-password");
    await page.locator("input[name=email]").fill("nadie@donpepe.local");
    await page.getByRole("button", { name: "Solicitar recuperación" }).click();
    await page.getByRole("heading", { name: "Solicitud recibida" }).waitFor();
    assert.equal(mail.length, 0);
    await capture("recuperacion-confirmada-sin-enumerar-cuentas");
    check("Recuperación sin revelar la existencia de una cuenta y sin envío de correo real");
    const token = newToken();
    runtime.identity.db.prepare("UPDATE people SET pending_recovery_email=? WHERE id='u-store'").run("qa-donpepe@gmail.com");
    runtime.identity.db.prepare("INSERT INTO security_tokens(hash,user_id,purpose,email,expires,created_at) VALUES(?,'u-store','RECOVERY_EMAIL',?,?,?)").run(hashToken(token), "qa-donpepe@gmail.com", Date.now() + 1800000, Date.now());
    await page.goto(base + "/verify-recovery-email?token=" + token);
    await page.getByRole("heading", { name: "Confirma tu Gmail" }).waitFor();
    assert.equal(await page.evaluate(() => location.search), "");
    await capture("gmail-confirmar-1440");
    await page.getByRole("button", { name: "Confirmar mi correo" }).click();
    await page.getByRole("heading", { name: "Gmail verificado" }).waitFor();
    assert.equal(runtime.identity.db.prepare("SELECT recovery_verified FROM people WHERE id='u-store'").get().recovery_verified, 1);
    await capture("gmail-verificado-1440");
    check("Vinculación de Gmail por enlace de un uso; token retirado de la barra de dirección y confirmación persistida sólo en la base aislada");
    // A separate isolated runtime keeps the visual permutations from exhausting
    // the real public recovery limiter before the functional password checks.
    await new Promise(resolve => server.close(resolve)); runtime.close();
    runtime = createApp({ identityFile: ":memory:", simulationFile: ":memory:", startClock: false, mailEnv: {}, mailTransport: { sendMail: async message => { mail.push(message); return {}; } } });
    server = runtime.app.listen(0, "127.0.0.1"); await once(server, "listening");
    base = `http://127.0.0.1:${server.address().port}`;
    runtime.identity.db.prepare("UPDATE people SET recovery_email='qa-admin@gmail.com',recovery_verified=1 WHERE id='u-admin'").run();
    const response = await post(context, "/api/password-recovery", { email: "admin@donpepe.local" }); assert.equal(response.status(), 200);
    assert.equal(mail.length, 1);
    const resetUrl = new URL(mail[0].text.match(/https?:\/\/\S+/)[0]);
    const resetPath = resetUrl.pathname + resetUrl.search;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const appearance of ["dark", "light"]) {
        await page.goto(base + resetPath);
        await page.getByRole("heading", { name: "Crea una nueva contraseña" }).waitFor(); await theme(appearance);
        await capture(`nueva-contrasena-${appearance}-${width}`);
      }
    }
    await page.locator("input[name=password]").fill("DonPepe2026!");
    await page.locator("input[name=confirmation]").fill("DonPepeNuevo2026!");
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
    await page.locator("#auth-confirmation-error").waitFor();
    await page.locator("input[name=confirmation]").fill("DonPepe2026!");
    const reused = page.waitForResponse(response => response.url().endsWith("/api/password-reset") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
    const reusedResponse = await reused;
    assert.equal(reusedResponse.status(), 422, JSON.stringify(await reusedResponse.json()));
    await page.locator("#login-error").filter({ hasText: /actual|anterior|repetir/ }).waitFor();
    await capture("nueva-contrasena-reutilizacion-rechazada");
    await page.locator("input[name=password]").fill("DonPepeNuevo2026!");
    await page.locator("input[name=confirmation]").fill("DonPepeNuevo2026!");
    await page.getByRole("button", { name: "Guardar nueva contraseña" }).click();
    await page.getByRole("heading", { name: "Contraseña actualizada" }).waitFor();
    await capture("nueva-contrasena-confirmada");
    await page.goto(base + resetPath);
    await page.getByRole("heading", { name: "Este enlace no está disponible" }).waitFor();
    check("Formulario de nueva contraseña en 4 variantes visuales; confirmación diferente y reutilización rechazadas; cambio válido y rechazo del enlace ya usado");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(base + "/login");
    assert.equal(await page.locator(".auth-atmosphere img").evaluate(image => getComputedStyle(image).animationName), "none");
    await page.locator("input[name=email]").fill("admin@donpepe.local");
    await page.locator("input[name=password]").fill("DonPepeNuevo2026!");
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await page.waitForURL(base + "/");
    assert.equal((await context.request.get(base + "/api/me")).status(), 200);
    check("Movimiento reducido respetado y acceso correcto con la nueva contraseña sin modificar permisos ni sesiones ajenas");
    const highDpiContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, colorScheme: "dark" });
    const highDpiPage = await highDpiContext.newPage();
    highDpiPage.on("pageerror", error => errors.push(error.message));
    await highDpiPage.goto(base + "/login");
    await highDpiPage.evaluate(async () => { window.DonPepeTheme.set("dark"); await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode().catch(() => {}))); });
    const highDpiImage = await highDpiPage.evaluate(async () => {
      const image = document.querySelector(".auth-atmosphere img");
      const bitmap = await createImageBitmap(await (await fetch(image.currentSrc)).blob());
      const dimensions = { source: image.currentSrc, width: bitmap.width, height: bitmap.height, devicePixelRatio };
      bitmap.close();
      return dimensions;
    });
    assert.equal(highDpiImage.width, 3840, "La pantalla de alta densidad debe recibir el archivo de 3840 px");
    assert.equal(highDpiImage.height, 2160);
    assert(highDpiImage.source.endsWith("donpepe-lima-exterior-v2-3840.webp"));
    layouts.push({ name: "login-dark-4k-display", width: 1920, height: 1080, image: highDpiImage });
    const highDpiFile = path.join(output, "login-dark-4k-display.png");
    await highDpiPage.screenshot({ path: highDpiFile, animations: "disabled" });
    screenshots.push(highDpiFile);
    await highDpiContext.close();
    check("Pantalla de alta densidad: selección responsive del recurso 3840×2160, sin atribuir resolución nativa a la fotografía de origen");
    assert.equal(errors.length, 0, errors.join("\n"));
  } catch (error) { failure = error; process.stderr.write(error.stack + "\n"); if (page) { process.stderr.write((await page.locator("#login-form").innerText().catch(() => "")) + "\n"); await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {}); } }
  finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    runtime?.close();
    const report = { ok: !failure, checks, screenshots, layouts, errors, ...(failure ? { failure: failure.message } : {}), isolation: "Bases en memoria y transporte de correo falso; sin correos ni cambios en datos de usuario." };
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "verificacion-acceso-premium.json"), JSON.stringify(report, null, 2));
    process.stdout.write(`${checks.length} recorridos; ${screenshots.length} capturas. ${output}\n`);
    if (failure) process.exitCode = 1;
  }
})();
