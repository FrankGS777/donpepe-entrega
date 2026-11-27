// Prueba aislada de RF: datos y lecturas simuladas, sin cargar app ni base de datos.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const ejs = require("ejs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(__dirname, "..");
const output = process.env.VERIFY_OUTPUT || "/tmp/donpepe-rf-experience";
const source = (code) => ({
  tipo: "LOC",
  codigo: code,
  titulo: "Reserva seca",
  detalle: "Posición de almacenaje",
});
const origin = "CD1-RES-A02-R04-N03-C02-D01",
  destination = "CD1-PIC-A01-R02-N01-C01-D01";
const modules = [
  {
    key: "recepcion",
    title: "Recibir mercancía",
    icon: "i-truck",
    path: "/rf/recepcion",
  },
  {
    key: "checkin",
    title: "Ubicar mercancía",
    icon: "i-pin",
    path: "/rf/check-in",
    taskTypes: ["PUTAWAY"],
  },
  {
    key: "picking",
    title: "Preparar pedidos",
    icon: "i-package",
    path: "/rf/picking",
    taskTypes: ["PICKING"],
  },
  {
    key: "transfer",
    title: "Mover mercancía",
    icon: "i-arrows",
    path: "/rf/transfer",
    taskTypes: ["REABASTECIMIENTO"],
  },
  { key: "count", title: "Contar", icon: "i-clipboard", path: "/rf/count" },
  {
    key: "returns",
    title: "Devoluciones",
    icon: "i-alert",
    path: "/rf/returns",
    taskTypes: ["DEVOLUCION_RUTA"],
  },
];
const task = {
  id: 101,
  codigo_tarea: "T-000101",
  producto: "Leche UHT Gloria entera 1 L",
  sku: "SKU-LAC-0012",
  numero_lote: "FAB-171026",
  lote_fabricante_id: 4582,
  codigo_lote_wms: "L-004582",
  codigo_hu: "HU-000812",
  control_lote: 1,
  cantidad: 24,
  loc_origen: origin,
  loc_destino: destination,
  zona_origen: "Reserva seca A",
  zona_destino: "Preparación de pedidos",
  tipo: "REABASTECIMIENTO",
  estado: "EN_PROCESO",
  estado_inventario: "DISPONIBLE",
  prioridad: "ALTA",
  asignado_a: 7,
  asignado: "Lucía Operadora",
  creador: "Carlos Jefe",
  observaciones: "",
};
async function main() {
  const app = express();
  app.use(express.static(path.join(root, "public")));
  app.get("/rf/api/scan", (req, res) => {
    const code = req.query.code;
    const data =
      code === origin || code === destination
        ? source(code)
        : code === "OTRA-LOC"
          ? source("CD1-RES-A99-R01-N01-C01-D01")
          : code === "HU-000812"
            ? {
                tipo: "HU",
                codigo: code,
                sku: task.sku,
                numero_lote: task.numero_lote,
                titulo: task.producto,
                detalle: "Palé asignado · 24 unidades",
              }
            : code === "SKU-LAC-0012"
              ? {
                  tipo: "SKU",
                  codigo: code,
                  sku: code,
                  titulo: task.producto,
                  detalle: "Producto sin identificación de lote",
                }
              : {
                  tipo: "NO_ENCONTRADO",
                  codigo: code,
                  titulo: "Sin coincidencia",
                  detalle: "No encontrado",
                };
    res.json(data);
  });
  app.get("/verify/:screen", async (req, res, next) => {
    try {
      const screen = req.params.screen;
      const user = {
        id: 7,
        nombre: "Lucía Operadora",
        rol: "operador_rf",
        perfil: "operador_rf",
        rol_etiqueta: "Operador RF",
      };
      const locals = {
        title: "RF",
        storeName: "Don Pepe WMS",
        csrfToken: "fixture-only",
        flash: null,
        errors: [],
        date: () => "17 oct. 2026",
        currentPath: "/rf",
        currentUser: user,
        can: () => true,
        modules,
        summary: {
          tasks: {
            en_proceso: 1,
            putaway: 3,
            picking: 4,
            transferencias: 2,
            devoluciones: 0,
          },
          purchases: { pendientes: 2 },
          counts: { pendientes: 1 },
          zones: [],
        },
        task,
        tasks: [
          task,
          { ...task, id: 102, estado: "PENDIENTE", codigo_tarea: "T-000102" },
        ],
        module: modules[3],
        filters: {},
        returnPath: "/rf/transfer",
        orders: [
          {
            id: 1,
            codigo_orden: "OC-000101",
            proveedor: "Leche Gloria S.A.",
            estado: "PENDIENTE",
            lineas: 3,
            unidades: 96,
            fecha_emision: "2026-10-17",
          },
        ],
        locations: [
          {
            ubicacion_id: 1,
            codigo_loc: origin,
            zona: "Reserva seca A",
            tipo: "RESERVA",
          },
        ],
        location: { id: 1, codigo_loc: origin, zona: "Reserva seca A" },
        form: {},
      };
      if (screen === "receiving-form") {
        locals.currentPath = "/rf/recepcion/1";
        locals.actionUrl = "/rf/recepcion/1";
        locals.order = {
          id: 1,
          codigo_orden: "OC-000101",
          items: [
            {
              id: 100,
              sku: task.sku,
              codigo_barras: "7750000000011",
              producto: task.producto,
              categoria: "Lácteos",
              vida_util_dias: 90,
              control_vencimiento: 1,
              control_lote: 1,
              cantidad_solicitada: 48,
              cantidad_recibida: 0,
              condicion_requerida: "AMBIENTE",
            },
          ],
        };
        locals.locations = [
          {
            id: 1,
            codigo_loc: origin,
            zona: "Recepción ambiente",
            condicion_almacenamiento: "AMBIENTE",
          },
        ];
      }
      locals.summary.nextTask = task;
      locals.body = await ejs.renderFile(
        path.join(
          root,
          "views/" +
            (screen === "receiving-form" ? "compras/recibir" : "rf/" + screen) +
            ".ejs",
        ),
        locals,
      );
      res.send(
        await ejs.renderFile(path.join(root, "views/layouts/rf.ejs"), locals),
      );
    } catch (error) {
      next(error);
    }
  });
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  const base = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_EXECUTABLE
        ? { executablePath: process.env.CHROME_EXECUTABLE }
        : {}),
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) =>
      route.request().url().startsWith(base) ||
      route.request().url().startsWith("data:")
        ? route.continue()
        : route.abort(),
    );
    fs.mkdirSync(output, { recursive: true });
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 1024, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const screen of [
        "home",
        "tasks",
        "execute",
        "scanner",
        "receiving",
        "receiving-form",
        "count",
        "count-form",
      ]) {
        assert.equal(
          (await page.goto(base + "/verify/" + screen)).status(),
          200,
          screen,
        );
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: path.join(output, screen + "-" + viewport.width + ".png"),
          fullPage: true,
        });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 1,
          ),
          false,
          screen + " tiene desborde",
        );
        assert.equal(await page.locator("input[data-scan-manual]").count(), 0);
        const unlocked = await page
          .locator("[data-rf-scan-only]")
          .evaluateAll(
            (fields) =>
              fields.filter(
                (field) => !field.readOnly || field.inputMode !== "none",
              ).length,
          );
        assert.equal(unlocked, 0, screen + " permite escritura manual");
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base + "/verify/execute");
    await page.evaluate(() => {
      window.WmsScanner.cameraSession = (options) => {
        window.__rfRead = options.onRead;
        options.onReady?.();
        return { stop() {} };
      };
      window.WmsScanner.cameras = async () => [];
    });
    assert.equal(await page.locator("[data-rf-complete]").isDisabled(), true);
    assert.equal(
      await page.locator('[data-rf-scan-for="rfCargo"]').isDisabled(),
      true,
    );
    async function scan(field, code, accept = true) {
      await page.locator('[data-rf-scan-for="' + field + '"]').click();
      await page.locator("[data-rf-camera-start]").click();
      await page.evaluate((value) => {
        window.__rfRead(value);
      }, code);
      if (accept) {
        await page.locator(".scan-review-modal [data-accept]").click();
        await page.waitForTimeout(230);
      }
    }
    await scan("rfOrigin", "OTRA-LOC", false);
    await page.waitForTimeout(100);
    assert.match(
      await page.locator("[data-rf-camera-status]").innerText(),
      /otra posición/,
    );
    assert.equal(await page.locator("#rfOrigin").inputValue(), "");
    await page.locator(".rf-camera-modal [data-ui-dismiss]").first().click();
    await page.waitForTimeout(230);
    await scan("rfOrigin", origin);
    assert.equal(await page.locator("#rfOrigin").inputValue(), origin);
    assert.equal(
      await page.locator('[data-rf-scan-for="rfCargo"]').isDisabled(),
      false,
    );
    await scan("rfCargo", "SKU-LAC-0012", false);
    await page.waitForFunction(() =>
      document
        .querySelector("[data-rf-camera-status]")
        .textContent.includes("no identifica su lote"),
    );
    assert.match(
      await page.locator("[data-rf-camera-status]").innerText(),
      /no identifica su lote/,
    );
    assert.equal(await page.locator("#rfCargo").inputValue(), "");
    await page.locator(".rf-camera-modal [data-ui-dismiss]").first().click();
    await page.waitForTimeout(230);
    await scan("rfCargo", "HU-000812");
    assert.equal(await page.locator("#rfCargo").inputValue(), "HU-000812");
    await scan("rfDestination", destination);
    assert.equal(await page.locator("[data-rf-complete]").isDisabled(), false);
    assert.equal(
      await page.locator("[data-rf-progress]").getAttribute("aria-valuenow"),
      "3",
    );
    assert.deepEqual(
      await page
        .locator(".rf-confirm-form")
        .evaluate((form) => Object.fromEntries(new FormData(form))),
      {
        _csrf: "fixture-only",
        codigo_origen: origin,
        codigo_producto: "HU-000812",
        codigo_destino: destination,
      },
    );
    await page.screenshot({
      path: path.join(output, "execute-confirmed-390.png"),
      fullPage: true,
    });
    await page.goto(base + "/verify/scanner");
    await page.evaluate(() => {
      window.WmsScanner.cameraSession = (options) => {
        options.onError(
          Object.assign(new Error("Permission denied"), {
            name: "NotAllowedError",
          }),
        );
        return { stop() {} };
      };
    });
    await page.locator("[data-scan-start]").click();
    assert.match(
      await page.locator("[data-scan-status]").innerText(),
      /no tiene permiso/,
    );
    assert.equal(await page.locator("[data-scan-start]").isDisabled(), false);
    assert.deepEqual(errors, []);
    console.log(
      "RF verificado: 16 estados visuales incluyendo recepción compartida, secuencia de tres lecturas, rechazo de ubicación errónea y SKU sin lote, datos finales de formulario y fallo de permisos. Cámara simulada; sin escrituras en BD. " +
        output,
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
