// Revisión visual aislada: plantillas y recursos locales, sin app/BD ni cuentas reales.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const ejs = require("ejs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const output = process.env.VERIFY_OUTPUT || "/tmp/donpepe-final-brand-verify";

async function render(file, locals) {
  return ejs.renderFile(path.join(root, "views", `${file}.ejs`), locals);
}

async function main() {
  const app = express();
  app.use(express.static(path.join(root, "public")));
  const baseLocals = {
    title: "DonPepe",
    storeName: "Don Pepe WMS",
    csrfToken: "fixture-only",
    error: null,
    errors: [],
    form: {},
    flash: null,
    pendingRequestCount: 0,
    pendingRequests: [],
    homePath: "/dashboard",
    can: () => true,
    date: () => "17 oct. 2026",
    shellContext: { page: "Inicio" },
  };
  app.get("/verify/:screen", async (req, res, next) => {
    try {
      const screen = req.params.screen;
      const auth = ["login", "recovery"].includes(screen);
      const role =
        screen === "operations" ? "jefe_operaciones" : "administrador_wms";
      const locals = {
        ...baseLocals,
        currentPath: auth ? "/login" : "/dashboard",
        currentUser: auth
          ? null
          : {
              id: 0,
              nombre: "Verificación visual",
              correo: "fixture@example.test",
              rol: screen === "rf" ? "operador_rf" : role,
              perfil: screen === "rf" ? "operador_rf" : role,
              rol_etiqueta:
                screen === "rf" ? "Operador RF" : role.replaceAll("_", " "),
            },
      };
      locals.body = auth
        ? await render(
            screen === "login" ? "auth/login" : "auth/forgot-password",
            locals,
          )
        : '<section class="panel"><h1>DonPepe</h1><p>Comprobación de la marca.</p></section>';
      res.send(
        await render(
          `layouts/${auth ? "auth" : screen === "rf" ? "rf" : "main"}`,
          locals,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
    });
    fs.mkdirSync(output, { recursive: true });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => {
      const url = route.request().url();
      return url.startsWith(base) || url.startsWith("data:")
        ? route.continue()
        : route.abort();
    });
    const report = [];
    for (const viewport of [
      { width: 1440, height: 1000 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      for (const screen of ["login", "recovery", "admin", "operations", "rf"]) {
        assert.equal(
          (await page.goto(`${base}/verify/${screen}`)).status(),
          200,
        );
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.querySelectorAll("[data-brand-logo]")].map((image) =>
              image.decode(),
            ),
          );
        });
        const state = await page.evaluate(() => {
          const images = [
            ...document.querySelectorAll("[data-brand-logo]"),
          ].filter((image) => {
            const rect = image.getBoundingClientRect();
            return (
              rect.width > 0 &&
              rect.height > 0 &&
              rect.right > 0 &&
              rect.left < innerWidth
            );
          });
          return {
            overflow: document.documentElement.scrollWidth > innerWidth + 1,
            images: images.map((image) => {
              const rect = image.getBoundingClientRect();
              const box = image
                .closest(".donpepe-logo")
                .getBoundingClientRect();
              return {
                src: image.getAttribute("src"),
                filter: getComputedStyle(image).filter,
                ratio: rect.width / rect.height,
                naturalRatio: image.naturalWidth / image.naturalHeight,
                width: rect.width,
                height: rect.height,
                sidebar: Boolean(image.closest(".sidebar")),
                support: getComputedStyle(image.closest(".donpepe-logo"))
                  .backgroundColor,
                clipped: rect.top < box.top - 1 || rect.bottom > box.bottom + 1,
              };
            }),
          };
        });
        await page.screenshot({
          path: path.join(output, `${screen}-${viewport.width}.png`),
          fullPage: true,
        });
        assert(!state.overflow, `${screen}: desborde horizontal`);
        assert(state.images.length > 0, `${screen}: falta marca visible`);
        for (const image of state.images) {
          assert(
            image.src.endsWith("donpepe-logo-final-gold.png"),
            `${screen}: arte anterior ${image.src}`,
          );
          assert.equal(image.filter, "none", `${screen}: filtro heredado`);
          assert(
            Math.abs(image.ratio - image.naturalRatio) < 0.02,
            `${screen}: logo deformado`,
          );
          if (image.sidebar && viewport.width >= 992)
            assert(
              image.width >= 240,
              `${screen}: marca del sidebar demasiado pequeña (${image.width}px)`,
            );
          if (["operations", "rf"].includes(screen))
            assert.equal(
              image.support,
              "rgb(36, 19, 50)",
              `${screen}: falta soporte de contraste`,
            );
          assert(
            !image.clipped,
            `${screen}: logo recortado por un estilo anterior`,
          );
        }
        report.push({ screen, viewport, ...state });
      }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify({ report, errors }, null, 2),
    );
    console.log(
      `Marca revisada en ${report.length} estados; sin desbordes, errores JS ni filtros heredados. ${output}`,
    );
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
