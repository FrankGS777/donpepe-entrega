// Verificación de lectura/navegación: no modifica usuarios, stock ni tareas.
// PLAYWRIGHT_MODULE y CHROME_EXECUTABLE permiten usar un navegador ya instalado.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = process.env.VERIFY_URL || "http://localhost:3000";
const output = process.env.VERIFY_OUTPUT || "/tmp/donpepe-ui-verify";
async function login(page, email, password) {
  await page.goto(`${base}/login`);
  await page.locator("[name=correo]").fill(email);
  await page.locator("[name=password]").fill(password);
  await page.locator("[type=submit]").click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"));
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_EXECUTABLE
      ? { executablePath: process.env.CHROME_EXECUTABLE }
      : {}),
  });
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`${base}/login`);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${output}/login.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/cuenta/recuperar`);
    await page.waitForTimeout(650);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      "Recuperación desborda el móvil",
    );
    await page.screenshot({ path: `${output}/recuperar-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await login(
      page,
      process.env.VERIFY_ADMIN_EMAIL || "frank@minimarket.com",
      process.env.VERIFY_ADMIN_PASSWORD || "admin123",
    );
    assert.equal((await page.goto(`${base}/usuarios`)).status(), 200);
    const links = await page
      .locator('a[href^="/usuarios/"][href$="/editar"]')
      .evaluateAll((es) => es.map((e) => e.getAttribute("href")));
    assert(links.length > 0);
    for (const link of links)
      assert.equal((await page.goto(base + link)).status(), 200, link);
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${output}/editar-usuario.png` });
    assert.equal(
      (await page.goto(`${base}/usuarios/99999999/editar`)).status(),
      404,
    );
    assert.equal(
      (await page.goto(`${base}/usuarios/no-id/editar`)).status(),
      422,
    );
    await page.goto(`${base}/wms/mapa`);
    await page.waitForFunction(
      () => document.querySelector("#wmapLoading").hidden,
    );
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${output}/mapa.png` });
    const code = await page.locator("[data-loc-id]").first().innerText();
    await page
      .locator("#wmapZone")
      .selectOption({ label: "SEC-B · Reserva seca B · rotación media" });
    await page.locator("#wmapPerspective").click();
    await page.waitForTimeout(850);
    await page.locator("#wmapInspectorClose").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${output}/pasillo.png` });
    const canvas = page.locator("#wmapCanvas canvas");
    await canvas.hover();
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -35);
    await page.waitForTimeout(500);
    const decoding = await page.evaluate(async () => {
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      const qr = document.createElement("canvas");
      const payload = "SKU=SKU-ABA-0004|LOT=L-000012";
      await QRCode.toCanvas(qr, payload, { width: 300, margin: 4 });
      const qrResult = reader.decodeFromCanvas(qr).getText();
      // EAN-13 válido: paridades y patrones estándar, independiente del generador QR.
      const ean = "4006381333931",
        L = [
          "0001101",
          "0011001",
          "0010011",
          "0111101",
          "0100011",
          "0110001",
          "0101111",
          "0111011",
          "0110111",
          "0001011",
        ];
      const G = [
        "0100111",
        "0110011",
        "0011011",
        "0100001",
        "0011101",
        "0111001",
        "0000101",
        "0010001",
        "0001001",
        "0010111",
      ];
      const parity = "LGLLGG";
      let bits = "101";
      for (let i = 1; i <= 6; i++)
        bits += (parity[i - 1] === "L" ? L : G)[Number(ean[i])];
      bits += "01010";
      for (let i = 7; i < 13; i++)
        bits += L[Number(ean[i])].replace(/[01]/g, (b) =>
          b === "0" ? "1" : "0",
        );
      bits += "101";
      const bar = document.createElement("canvas");
      bar.width = (bits.length + 24) * 3;
      bar.height = 180;
      const ctx = bar.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, bar.width, bar.height);
      ctx.fillStyle = "#000";
      [...bits].forEach((bit, i) => {
        if (bit === "1") ctx.fillRect((i + 12) * 3, 10, 3, 150);
      });
      return { qr: qrResult, ean: reader.decodeFromCanvas(bar).getText() };
    });
    assert.equal(decoding.qr, "SKU=SKU-ABA-0004|LOT=L-000012");
    assert.equal(decoding.ean, "4006381333931");
    const loc = code.split("\n")[0];
    const api = await page.request.get(
      `${base}/wms/api/scan?code=${encodeURIComponent(loc)}`,
    );
    assert.equal(api.status(), 200);
    assert.equal((await api.json()).tipo, "LOC");
    await page.goto(`${base}/productos/nuevo`);
    const input = page.locator("input[name=sku]");
    const known = await (
      await page.request.get(`${base}/wms/api/scan?code=SKU-ABA-0004`)
    ).json();
    assert.equal(known.tipo, "SKU");
    await input.locator("..").locator(".scan-input-btn").click();
    await page.locator(".scanner-options summary").click();
    await page
      .locator("[data-quick-manual]")
      .fill(known.codigo_barras || known.codigo);
    await page.locator("[data-quick-use]").click();
    await page.waitForFunction(
      () => !document.querySelector(".scan-confirm-preview").hidden,
    );
    assert.equal(
      await input.inputValue(),
      "",
      "No debe rellenar antes de confirmar",
    );
    await page.locator("[data-read-confirm]").click();
    assert.equal(await input.inputValue(), "SKU-ABA-0004");
    await page.waitForTimeout(250);
    assert.deepEqual(errors, []);
    const rf = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await login(
      rf,
      process.env.VERIFY_RF_EMAIL || "ana@minimarket.com",
      process.env.VERIFY_RF_PASSWORD || "rf123456",
    );
    assert.equal((await rf.goto(`${base}/rf/scanner`)).status(), 200);
    assert.equal(await rf.locator("#sidebar").count(), 0);
    await rf.locator("[data-scan-manual]").fill(loc);
    await rf.locator("[data-scan-lookup]").click();
    await rf.locator(".scan-review-modal").waitFor({ state: "visible" });
    assert.equal(
      await rf.locator("[data-scan-result] strong").innerText(),
      "Esperando lectura",
    );
    await rf.locator("[data-accept]").click();
    await rf.waitForFunction(
      () =>
        document.querySelector("[data-scan-live]").textContent === "CONFIRMADO",
    );
    assert.equal(
      await rf.locator("[data-scan-result] strong").innerText(),
      loc,
    );
    assert(
      await rf.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await rf.screenshot({ path: `${output}/scanner-rf.png` });
    await rf.close();
    await page.close();
    console.log(
      "OK: login móvil, todos los usuarios, 404/422, mapa, QR real, EAN-13 y confirmación antes de rellenar.",
    );
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
