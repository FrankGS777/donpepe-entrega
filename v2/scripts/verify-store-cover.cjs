"use strict";
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { once } = require("node:events");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { createApp } = require("../server");
const output = path.resolve(__dirname, "../../../store-cover-20261027");
const checks = [],
  errors = [];
let runtime, server, browser;
async function run() {
  fs.mkdirSync(output, { recursive: true });
  runtime = createApp({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "donpepe-cover-")),
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
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  assert.equal(
    (
      await context.request.post(base + "/api/login", {
        data: { email: "tienda@donpepe.local", password: "DonPepe2026!" },
      })
    ).status(),
    200,
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator(".store-hero h1").waitFor();
  for (const theme of ["dark", "light"])
    for (const width of [1440, 768, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.evaluate((theme) => window.DonPepeTheme.set(theme), theme);
      await page.evaluate(async () => {
        await document.fonts.ready;
        await document.querySelector(".store-hero-photo").decode();
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        );
      });
      const geometry = await page.evaluate(() => {
        const box = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { top: r.top, right: r.right, bottom: r.bottom, left: r.left };
        };
        return {
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          header: box(".topbar"),
          hero: box(".store-hero"),
          title: box(".store-hero h1"),
          actions: box(".store-hero-actions"),
          headerPosition: getComputedStyle(document.querySelector(".topbar"))
            .position,
          font: document.fonts.check('500 80px "DonPepe Editorial"'),
          photo: document.querySelector(".store-hero-photo").naturalWidth,
        };
      });
      assert(geometry.scroll <= width + 2, JSON.stringify(geometry));
      assert.equal(geometry.headerPosition, "absolute");
      assert.equal(geometry.hero.top, 0);
      assert(geometry.title.top > geometry.header.bottom);
      assert(geometry.actions.bottom <= geometry.hero.bottom);
      assert(geometry.title.right <= width);
      assert(geometry.font && geometry.photo > 100);
      assert.equal(
        (await page.locator(".store-hero h1").textContent()).trim(),
        "San Miguel",
      );
      await page.screenshot({
        path: path.join(output, `${theme}-${width}.png`),
        fullPage: width === 390,
      });
      checks.push({ theme, width, geometry });
    }
  await page.locator("#user-menu").click();
  assert(await page.locator("#account-menu").isVisible());
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: /Preparar reposición/ }).click();
  await page.locator("[data-store-quantity]").first().waitFor();
  assert.equal(
    await page
      .locator(".topbar")
      .evaluate((el) => getComputedStyle(el).position),
    "relative",
  );
  await page.locator("[data-store-quantity]").first().fill("4");
  assert.match(
    await page.locator(".store-basket-heading > strong").textContent(),
    /^4\s/,
  );
  await page.locator('#store-navigation a[href="#overview"]').click();
  await page.locator(".store-hero h1").waitFor();
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
