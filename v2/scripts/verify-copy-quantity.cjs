"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const output =
  process.env.DONPEPE_QA_OUTPUT ||
  path.resolve(__dirname, "../../../ui-copy-quantity-20261026");
const checks = [],
  errors = [];
let runtime, server, browser, storePage;
const check = (text) => {
  checks.push(text);
  console.log(text);
};

async function run() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-copy-")),
    realtimeClock: true,
    startClock: false,
  });
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
    ],
  });
  async function login(role) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    const email = {
      store: "tienda",
      admin: "admin",
      operations: "operaciones",
    }[role];
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
    await page.goto(base);
    await page.locator("#main h1").waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator("#connection").isVisible(), false);
    assert.equal(await page.locator(".breadcrumbs").isVisible(), false);
    return page;
  }
  const page = await login("store");
  storePage = page;
  assert.equal(
    (await page.locator(".store-hero h1").textContent()).trim(),
    "San Miguel",
  );
  assert.equal(
    await page
      .locator(".store-hero-copy")
      .evaluate((el) =>
        /Inventario y entregas|Sucursal vinculada|TU SUCURSAL|Siempre abastecida|ESPACIO TIENDA/.test(
          el.textContent,
        ),
      ),
    false,
  );
  assert.equal(
    await page
      .locator(".store-photo-card,.store-hero-foot,.store-dock-label")
      .count(),
    0,
  );
  await page.evaluate(async () => {
    await Promise.all(
      [...document.querySelectorAll("#main img")].map((img) => {
        img.loading = "eager";
        return img.decode().catch(() => {});
      }),
    );
  });
  await page.screenshot({
    path: path.join(output, "store-home-1440.png"),
    fullPage: true,
  });
  check(
    "Portada: sede una sola vez, sin rótulos decorativos ni estado de conexión normal",
  );
  await page.evaluate(() => {
    location.hash = "shop";
  });
  await page.locator("[data-store-quantity]").first().waitFor();
  assert.equal(await page.locator('input[type="search"] + .character-counter').count(), 0);
  const first = page.locator("[data-store-quantity]").nth(0),
    second = page.locator("[data-store-quantity]").nth(1);
  const total = () =>
    page.locator(".store-basket-heading > strong").textContent();
  await first.fill("8");
  assert.match(await total(), /^8\s/);
  assert.equal(await first.inputValue(), "8");
  assert(await first.evaluate((el) => el === document.activeElement));
  await first.fill("-1");
  assert.equal(await first.getAttribute("aria-invalid"), "true");
  assert.match(await total(), /^8\s/);
  await first.fill("1.5");
  assert.equal(await first.getAttribute("aria-invalid"), "true");
  assert(await page.locator(".store-quantity-error:not([hidden])").isVisible());
  await first.fill("121");
  assert.equal(await first.getAttribute("aria-invalid"), "true");
  await page.locator('[data-store-action="checkout"]').click();
  assert.equal(await page.locator("#dialog").isVisible(), false);
  check(
    "Edición directa actualiza la cesta sin perder foco y bloquea negativos, decimales y excesos",
  );
  await first.fill("80");
  await second.fill("41");
  assert.equal(await second.getAttribute("aria-invalid"), "true");
  assert.match(await total(), /^80\s/);
  await second.fill("40");
  assert.match(await total(), /^120\s/);
  assert.equal(await second.getAttribute("aria-invalid"), null);
  await first.fill("");
  await first.blur();
  assert.match(await total(), /^40\s/);
  assert.equal(await first.inputValue(), "0");
  await first.fill("7");
  await page.reload();
  await page.locator("[data-store-quantity]").first().waitFor();
  assert.equal(await first.inputValue(), "7");
  assert.match(await total(), /^47\s/);
  await page.locator('[data-store-action="more"]').first().click();
  assert.equal(await first.inputValue(), "8");
  await page.locator('[data-store-action="less"]').first().click();
  assert.equal(await first.inputValue(), "7");
  check(
    "Límite compartido, cero, borrado, persistencia y botones +/− funcionan con el mismo valor",
  );
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll("#main img")].map((img) => {
          img.loading = "eager";
          return img.decode().catch(() => {});
        }),
      );
    });
    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width && (r.right > innerWidth + 2 || r.left < -2);
        })
        .slice(0, 20)
        .map((el) => ({
          tag: el.tagName,
          class: el.className,
          right: el.getBoundingClientRect().right,
          width: el.getBoundingClientRect().width,
        })),
    }));
    assert(overflow.scroll <= width + 2, JSON.stringify(overflow));
    const geometry = await first.evaluate((el) => ({
      input: el.getBoundingClientRect().width,
      group: el.closest(".store-stepper").getBoundingClientRect().width,
      card: el.closest(".store-catalog-card").getBoundingClientRect().width,
    }));
    assert(geometry.input >= 30 && geometry.group <= geometry.card);
    await page.screenshot({
      path: path.join(output, `store-quantity-${width}.png`),
      fullPage: true,
    });
  }
  check("Cantidades y controles sin desbordamiento en escritorio y móvil");
  for (const role of ["admin", "operations"]) {
    const profile = await login(role);
    if (role === "operations") {
      await profile.evaluate(() => {
        location.hash = "orders";
      });
      await profile.waitForFunction(
        () => document.body.dataset.view === "orders",
      );
    }
    assert.equal(
      await profile.locator("#main .page-heading > div > .eyebrow").count(),
      0,
    );
    assert.equal(
      await profile.locator("#main .page-heading > div > p").count(),
      0,
    );
    check(
      `${role}: encabezados con título y acciones, sin párrafos repetitivos`,
    );
  }
  assert.deepEqual(errors, []);
  check("Sin errores JavaScript");
}
run()
  .catch(async (error) => {
    errors.push(error.message);
    console.error(error);
    if (storePage && !storePage.isClosed()) {
      console.log(
        JSON.stringify(
          await storePage
            .locator("[data-store-quantity]")
            .first()
            .evaluate((input) => {
              const chain = [];
              for (let node = input; node; node = node.parentElement)
                chain.push({
                  tag: node.tagName,
                  class: node.className,
                  hidden: node.hidden,
                  display: getComputedStyle(node).display,
                  visibility: getComputedStyle(node).visibility,
                  rect: [
                    node.getBoundingClientRect().width,
                    node.getBoundingClientRect().height,
                  ],
                });
              return {
                chain,
                dialogs: [...document.querySelectorAll("dialog[open]")].map(
                  (row) => row.textContent.slice(0, 500),
                ),
              };
            }),
        ),
      );
      await storePage.screenshot({
        path: path.join(output, "failure.png"),
        fullPage: true,
      });
    }
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
