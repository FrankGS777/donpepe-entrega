// Auditoría local de lectura: no cambia cuentas, contraseñas, stock ni tareas.
// Las pantallas posteriores a un POST se renderizan con fixtures, sin ejecutar el POST.
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const output = process.env.VERIFY_OUTPUT || "/tmp/donpepe-visual-audit";
const base = "http://127.0.0.1:3014";

async function settled(page) {
  await page.waitForTimeout(80);
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
async function inspect(page) {
  return page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const cache = new Map();
    function rgba(color) {
      if (!cache.has(color)) {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 1, 1);
        cache.set(
          color,
          [...ctx.getImageData(0, 0, 1, 1).data].map((n, i) =>
            i === 3 ? n / 255 : n,
          ),
        );
      }
      return cache.get(color);
    }
    const blend = (a, b) =>
      a.slice(0, 3).map((n, i) => n * a[3] + b[i] * (1 - a[3]));
    const lum = (a) =>
      a
        .slice(0, 3)
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
    const failures = new Map();
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("svg,canvas,video,option,[hidden],.visually-hidden"))
        continue;
      const style = getComputedStyle(el),
        rect = el.getBoundingClientRect();
      if (
        !rect.width ||
        !rect.height ||
        style.visibility === "hidden" ||
        style.display === "none"
      )
        continue;
      const text = [...el.childNodes]
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent)
        .join("")
        .trim();
      if (!text) continue;
      let node = el,
        backgrounds = [],
        opacity = 1;
      while (node) {
        const s = getComputedStyle(node);
        opacity *= Number(s.opacity);
        const stops = s.backgroundImage.match(
          /(?:rgba?|oklch|color)\([^)]*\)|#[\da-f]{3,8}/gi,
        );
        backgrounds.unshift(
          stops && !s.backgroundImage.includes("url(")
            ? rgba(stops[Math.floor(stops.length / 2)])
            : rgba(s.backgroundColor),
        );
        node = node.parentElement;
      }
      if (opacity < 0.5) continue;
      let bg = [255, 255, 255];
      for (const layer of backgrounds) bg = blend(layer, bg);
      const fg = blend(rgba(style.color), bg);
      const ratio =
        (Math.max(lum(fg), lum(bg)) + 0.05) /
        (Math.min(lum(fg), lum(bg)) + 0.05);
      const large =
        parseFloat(style.fontSize) >= 24 ||
        (parseFloat(style.fontSize) >= 18.66 &&
          Number(style.fontWeight) >= 700);
      const min = large ? 3 : 4.5;
      if (ratio + 0.05 < min) {
        const selector =
          (el.parentElement.className
            ? "." +
              String(el.parentElement.className).trim().replaceAll(" ", ".") +
              " > "
            : "") +
          el.tagName.toLowerCase() +
          (el.className
            ? "." + String(el.className).trim().replaceAll(" ", ".")
            : "");
        const key = selector + "|" + style.color + "|" + bg;
        if (!failures.has(key))
          failures.set(key, {
            selector,
            text: text.slice(0, 65),
            ratio: +ratio.toFixed(2),
            min,
            color: style.color,
            background: bg.map(Math.round),
          });
      }
    }
    return {
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      failures: [...failures.values()],
    };
  });
}
async function main() {
  process.env.NODE_ENV = "test";
  const store = require.resolve("../config/MySQLSessionStore");
  require.cache[store] = {
    id: store,
    filename: store,
    loaded: true,
    exports: require("express-session").MemoryStore,
  };
  const User = require("../models/User");
  const find = User.findByEmail.bind(User);
  const password = require("node:crypto").randomBytes(24).toString("hex");
  const hash = await require("bcryptjs").hash(password, 4);
  User.findByEmail = async (email) => {
    const user = await find(email);
    return user ? { ...user, password: hash } : null;
  };
  const { pool } = require("../config/db");
  const app = require("../app");
  const coverage = new Set();
  // Insertar después de sesión/locals/CSRF y antes del router del producto.
  const renderProbe = (req, res, next) => {
    const render = res.render.bind(res);
    res.render = (view, ...args) => {
      coverage.add(view);
      return render(view, ...args);
    };
    next();
  };
  app.use(renderProbe);
  const probe = app.router.stack.pop();
  const routerIndex = app.router.stack.findIndex(
    (layer) => layer.name === "router",
  );
  app.router.stack.splice(routerIndex, 0, probe);
  const fixtures = {
    sent: {
      view: "auth/request-sent",
      data: { layout: "layouts/auth", kind: "reset" },
    },
    complete: {
      view: "auth/password-complete",
      data: { layout: "layouts/auth", kind: "reset" },
    },
    password: {
      view: "auth/set-password",
      data: {
        layout: "layouts/auth",
        request: { nombre: "Operador", correo: "usuario@donpepe.example" },
        token: "visual-fixture",
        errors: [],
      },
    },
    delivery: {
      view: "solicitudes/link",
      data: {
        request: { correo: "usuario@donpepe.example" },
        delivery: { sent: true, to: "usuario@donpepe.example" },
        activationUrl: "/cuenta/activar/visual-fixture",
        expiresIn: "1 hora",
      },
    },
    deliveryError: {
      view: "solicitudes/link",
      data: {
        request: { correo: "usuario@donpepe.example" },
        delivery: {
          sent: false,
          to: "usuario@donpepe.example",
          error: "El proveedor de correo no respondió. Reintenta la entrega.",
        },
        activationUrl: "/cuenta/activar/visual-fixture",
        expiresIn: "1 hora",
      },
    },
    error: {
      view: "errors/500",
      data: {
        status: 500,
        message: "No se pudo completar la solicitud. Intenta nuevamente.",
      },
    },
    execute: {
      view: "rf/execute",
      data: {
        layout: "layouts/rf",
        returnPath: "/rf/transfer",
        task: {
          id: 1,
          codigo_tarea: "TAR-000001",
          tipo: "REUBICACION",
          cantidad: 12,
          loc_origen: "CD1-SEC-B-A01-R01-N01-C01-D01",
          loc_destino: "CD1-SEC-B-A02-R01-N01-C01-D01",
          zona_origen: "Reserva B",
          zona_destino: "Reserva B",
          sku: "SKU-ABA-0004",
          producto: "Aceite vegetal Primor botella 900 ml",
          numero_lote: "L-000001",
          prioridad: "NORMAL",
          estado_inventario: "DISPONIBLE",
          asignado: "Operador RF",
          creador: "Jefe de operaciones",
          observaciones: "Revisar embalaje antes del traslado.",
        },
      },
    },
    verifyEmail: {
      view: "cuenta/verify-email",
      data: {
        token: "a".repeat(64),
        proposedEmail: "nuevo.personal@example.org",
        errors: [],
      },
    },
    profileError: {
      view: "cuenta/profile",
      data: {
        account: {
          nombre: "Colaborador",
          correo: "usuario@donpepe.example",
          correo_recuperacion: "personal@example.org",
        },
        errors: [
          {
            msg: "La contraseña actual no coincide. Tu correo anterior sigue vinculado.",
          },
        ],
      },
    },
  };
  // Estados de despacho sin escribir pedidos ni enviar mercancía/correos.
  for (const estado of ["PENDIENTE", "LISTO", "DESPACHADO"])
    fixtures["order" + estado] = {
      view: "distribution/show",
      data: {
        order: {
          id: 1,
          codigo: "PED-000001",
          sucursal: "Don Pepe Central",
          codigo_sucursal: "DP-01",
          direccion: "Av. Central 120, Lima",
          estado,
          creado_en: new Date(),
          despachado_en: estado === "DESPACHADO" ? new Date() : null,
          creador: "Jefe de operaciones",
          referencia_guia: "GUIA-001",
          placa_vehiculo: "ABC-123",
          lines: [
            {
              sku: "SKU-ABA-0004",
              producto: "Aceite vegetal Primor botella 900 ml",
              cantidad_solicitada: 12,
              preparada: estado === "PENDIENTE" ? 0 : 12,
              en_tarea: 0,
            },
          ],
          tasks: [
            {
              id: 1,
              codigo_tarea: "TAR-000001",
              sku: "SKU-ABA-0004",
              numero_lote: "L-000001",
              loc_origen: "CD1-VEN-A01-R01-N01-C01-D01",
              loc_destino: "CD1-DSP-A01-R01-N01-C01-D01",
              cantidad: 12,
              estado: estado === "PENDIENTE" ? "PENDIENTE" : "COMPLETADA",
              operador: "Operador RF",
              retornable: 12,
            },
          ],
          returns: [],
        },
      },
    };
  app.get("/__visual/:key", (req, res) => {
    const f = fixtures[req.params.key];
    if (!f) return res.sendStatus(404);
    const layout =
      req.session.user?.perfil === "operador_rf" && !f.view.startsWith("auth/")
        ? "layouts/rf"
        : undefined;
    res.render(f.view, {
      title: "Revisión visual",
      ...f.data,
      ...(layout ? { layout } : {}),
    });
  });
  app.router.stack.splice(routerIndex + 1, 0, app.router.stack.pop());
  const server = await new Promise((resolve) => {
    const s = app.listen(3014, "127.0.0.1", () => resolve(s));
  });
  const browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_EXECUTABLE ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const report = [],
    errors = [];
  fs.mkdirSync(output, { recursive: true });
  const paths = {
    admin: [
      "/dashboard",
      "/usuarios",
      "/usuarios/nuevo",
      "/roles",
      "/roles/nuevo",
      "/roles/1/editar",
      "/roles/2/editar",
      "/roles/3/editar",
      "/mi-cuenta",
      "/__visual/verifyEmail",
      "/__visual/profileError",
      "/solicitudes",
      "/productos",
      "/productos/nuevo",
      "/compras",
      "/compras/nueva",
      "/reportes",
      "/inventario/lotes",
      "/inventario/movimientos",
      "/inventario/salud",
      "/wms/posiciones",
      "/wms/posiciones?zone=FRI&aisle=01&rack=01",
      "/wms/mapa",
      "/wms/tareas",
      "/wms/etiquetas",
      "/wms/sucursales",
      "/auditorias",
      "/mi-clave",
      "/pagina-inexistente",
      "/__visual/delivery",
      "/__visual/deliveryError",
      "/__visual/error",
      "/__visual/orderPENDIENTE",
      "/__visual/orderLISTO",
      "/__visual/orderDESPACHADO",
    ],
    chief: [
      "/dashboard",
      "/mi-cuenta",
      "/__visual/verifyEmail",
      "/__visual/profileError",
      "/productos",
      "/wms/tareas",
      "/wms/tareas/nueva",
      "/wms/posiciones",
      "/wms/posiciones?zone=FRI&aisle=01&rack=01",
      "/wms/mapa",
      "/inventario/lotes",
      "/inventario/movimientos",
      "/inventario/salud",
      "/auditorias",
      "/auditorias/nueva",
      "/wms/sucursales",
      "/wms/sucursales/nuevo",
      "/mi-clave",
      "/usuarios",
      "/pagina-inexistente",
      "/__visual/error",
      "/__visual/orderPENDIENTE",
      "/__visual/orderLISTO",
      "/__visual/orderDESPACHADO",
    ],
    rf: [
      "/rf",
      "/mi-cuenta",
      "/__visual/verifyEmail",
      "/rf/scanner",
      "/rf/recepcion",
      "/rf/check-in",
      "/rf/picking",
      "/rf/transfer",
      "/rf/count",
      "/rf/returns",
      "/mi-clave",
      "/usuarios",
      "/pagina-inexistente",
      "/__visual/error",
      "/__visual/execute",
    ],
    guest: [
      "/login",
      "/cuenta/recuperar",
      "/__visual/sent",
      "/__visual/complete",
      "/__visual/password",
      "/cuenta/activar/token-invalido",
      "/pagina-inexistente",
    ],
  };
  const [products] = await pool.query(
    "SELECT id FROM productos ORDER BY id LIMIT 2",
  );
  const [users] = await pool.query("SELECT id FROM usuarios ORDER BY id");
  const [orders] = await pool.query(
    "SELECT id FROM ordenes_compra ORDER BY id LIMIT 3",
  );
  const [requests] = await pool.query(
    "SELECT id FROM pedidos_sucursal ORDER BY id LIMIT 2",
  );
  const [locs] = await pool.query(
    "SELECT id FROM ubicaciones_almacen WHERE modelo_plano='CD1' AND activo=1 LIMIT 1",
  );
  users.forEach((u) => paths.admin.push(`/usuarios/${u.id}/editar`));
  products.forEach((p) => {
    paths.admin.push(`/productos/${p.id}/editar`);
    paths.chief.push(`/productos/${p.id}/editar`);
  });
  orders.forEach((o) => paths.admin.push(`/compras/${o.id}`));
  for (const o of requests)
    for (const role of ["admin", "chief"])
      paths[role].push(`/wms/sucursales/${o.id}`);
  if (locs[0]) paths.rf.push(`/rf/count/${locs[0].id}`);
  for (const type of ["categorias", "marcas", "proveedores", "ubicaciones"]) {
    paths.admin.push(`/catalogos/${type}`);
    if (type !== "ubicaciones") paths.admin.push(`/catalogos/${type}/nuevo`);
    const table = type === "ubicaciones" ? "ubicaciones_almacen" : type;
    const [rows] = await pool.query(
      `SELECT id FROM ${table} ORDER BY id LIMIT 1`,
    );
    if (rows[0]) paths.admin.push(`/catalogos/${type}/${rows[0].id}/editar`);
  }
  try {
    for (const [role, urls] of Object.entries(paths)) {
      const context = await browser.newContext({
        viewport: {
          width: role === "rf" ? 390 : 1440,
          height: role === "rf" ? 844 : 1000,
        },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push({ role, error: e.message }));
      if (role !== "guest") {
        await page.goto(base + "/login");
        await page.locator("[name=correo]").fill(
          {
            admin: "frank@minimarket.com",
            chief: "carlos@minimarket.com",
            rf: "ana@minimarket.com",
          }[role],
        );
        await page.locator("[name=password]").fill(password);
        await page.locator("[type=submit]").click();
        await page.waitForURL((url) => url.pathname !== "/login");
      }
      if (role === "rf") {
        await page.goto(base + "/rf/recepcion");
        urls.push(
          ...(await page
            .locator('a[href^="/rf/recepcion/"]')
            .evaluateAll((es) => es.map((e) => e.getAttribute("href")))),
        );
        await page.goto(base + "/rf/transfer");
        urls.push(
          ...(await page
            .locator('a[href$="/ejecutar"]')
            .evaluateAll((es) => es.map((e) => e.getAttribute("href")))),
        );
      }
      for (const url of [...new Set(urls)].filter(
        (url) => !process.env.VERIFY_MAP_ONLY || url === "/wms/mapa",
      )) {
        const response = await page.goto(base + url, {
          waitUntil: "domcontentloaded",
        });
        await settled(page);
        if (url === "/wms/mapa")
          await page.waitForFunction(
            () => document.querySelector("#wmapLoading").hidden,
          );
        const record = {
          role,
          url,
          status: response.status(),
          ...(await inspect(page)),
        };
        report.push(record);
        const filename = role + "-" + url.replace(/[^a-z0-9]/gi, "_");
        await page.screenshot({ path: path.join(output, filename + ".png") });
        const interaction = async (name) => {
          await settled(page);
          report.push({
            role,
            url: url + "#" + name,
            status: 200,
            ...(await inspect(page)),
          });
          await page.screenshot({
            path: path.join(output, filename + "-" + name + ".png"),
          });
        };
        if (url === "/dashboard" && role !== "rf" && role !== "guest") {
          await page.locator(".shell-profile").click();
          await interaction("perfil-abierto");
          await page.keyboard.press("Escape");
          await page.evaluate(() => {
            void window.WmsUi.confirm(
              "¿Confirmar esta operación? No se guardará ningún dato durante la revisión visual.",
            );
          });
          await interaction("confirmacion");
          await page.locator("[data-cancel]").click();
          await settled(page);
          const scroll = await page.locator("#sidebar").evaluate((el) => {
            el.scrollTop = 230;
            return el.scrollTop;
          });
          await page.goto(base + "/inventario/lotes");
          await settled(page);
          const restored = await page
            .locator("#sidebar")
            .evaluate((el) => el.scrollTop);
          if (Math.abs(scroll - restored) > 2)
            throw new Error("El sidebar perdió su posición: " + role);
          await page.goto(base + url);
          await settled(page);
        }
        if (url === "/roles/nuevo") {
          await page
            .locator('[name=permisos][value="wms.tasks.create"]')
            .check();
          await interaction("permisos-dependencias");
          await page.locator("#roleProfile").selectOption("operador_rf");
          await page.locator('[name=permisos][value="rf.pick"]').check();
          await interaction("perfil-rf");
        }
        if (url === "/wms/tareas/nueva") {
          await page.evaluate(() => {
            document.querySelector('[name=tipo][value="REUBICACION"]').click();
            const choose = (id) => {
              const s = document.getElementById(id);
              s.value = [...s.options].find((o) => o.value)?.value || "";
              s.dispatchEvent(new Event("change", { bubbles: true }));
            };
            choose("originZone");
            choose("originLoc");
            choose("taskSource");
          });
          await interaction("origen-seleccionado");
          await page.evaluate(() => {
            const s = document.getElementById("taskDestination");
            s.value = [...s.options].find((o) => o.value)?.value || "";
            s.dispatchEvent(new Event("change", { bubbles: true }));
          });
          await interaction("ruta-seleccionada");
        }
        if (url === "/wms/mapa") {
          await page
            .locator("#wmapZone")
            .selectOption({ label: "SEC-B · Reserva seca B · rotación media" });
          await page.locator("#wmapPerspective").click();
          await page.waitForTimeout(850);
          await page.locator("#wmapInspectorClose").click();
          await page.screenshot({
            path: path.join(output, role + "-map-perspective.png"),
          });
          const occupied = await page.evaluate(async () => {
            const data = await (
              await fetch(
                document.getElementById("warehouseMap").dataset.endpoint,
              )
            ).json();
            return (
              data.layout.locations.find(
                (bin) => bin.zoneCode === "SEC-B" && bin.occupied,
              ) || data.layout.locations.find((bin) => bin.occupied)
            );
          });
          if (occupied) {
            await page
              .locator("#wmapZone")
              .selectOption(String(occupied.zoneId));
            await page
              .locator("#wmapAisle")
              .selectOption(occupied.zoneId + "|" + occupied.aisle);
            await page.locator("#wmapRack").selectOption(occupied.rackKey);
            await page.locator('[data-loc-id="' + occupied.id + '"]').click();
            await page.waitForTimeout(900);
            await page.locator("#wmapInspectorClose").click();
            await page.screenshot({
              path: path.join(output, role + "-map-lote-real.png"),
            });
          }
          const frames = await page.evaluate(
            () =>
              new Promise((resolve) => {
                const marks = [];
                const canvas = document.querySelector("#wmapCanvas canvas");
                const rect = canvas.getBoundingClientRect();
                function step(t) {
                  marks.push(t);
                  if (marks.length < 22)
                    canvas.dispatchEvent(
                      new WheelEvent("wheel", {
                        deltaY: -10,
                        clientX: rect.left + rect.width / 2,
                        clientY: rect.top + rect.height / 2,
                        bubbles: true,
                        cancelable: true,
                      }),
                    );
                  if (marks.length < 45) requestAnimationFrame(step);
                  else resolve(marks.slice(1).map((t, i) => t - marks[i]));
                }
                requestAnimationFrame(step);
              }),
          );
          record.zoomFrameMedian = frames.sort((a, b) => a - b)[
            Math.floor(frames.length / 2)
          ];
          record.gpu = await page.locator("#warehouseMap").evaluate((map) => ({
            drawCalls: map.dataset.drawCalls,
            textures: map.dataset.textures,
            geometries: map.dataset.geometries,
          }));
        }
        if (
          ["/inventario/lotes", "/dashboard", "/roles", "/mi-cuenta"].includes(
            url,
          ) &&
          role !== "rf" &&
          role !== "guest"
        ) {
          const isQr = url === "/inventario/lotes";
          const trigger = page
            .locator(isQr ? "[data-lot-qr]" : ".context-help-button")
            .first();
          if (await trigger.count()) {
            await trigger.click();
            await settled(page);
            report.push({
              role,
              url: url + (isQr ? "#qr" : "#ayuda"),
              status: 200,
              ...(await inspect(page)),
            });
            await page.screenshot({
              path: path.join(
                output,
                filename + (isQr ? "-qr.png" : "-ayuda.png"),
              ),
            });
            await page
              .locator(
                isQr
                  ? "#lotQrModal [data-ui-dismiss]"
                  : "#contextHelp [data-ui-drawer-close]",
              )
              .first()
              .click();
            await settled(page);
          }
        }
        if (url === "/productos/nuevo") {
          const scan = page.locator(".scan-input-btn").first();
          if (await scan.count()) {
            await scan.click();
            await settled(page);
            report.push({
              role,
              url: url + "#camara",
              status: 200,
              ...(await inspect(page)),
            });
            await page.screenshot({
              path: path.join(output, filename + "-camara.png"),
            });
            await page
              .locator("#quickScanModal [data-ui-dismiss]")
              .first()
              .click();
            await settled(page);
          }
        }
        if (
          ["/productos/nuevo", "/compras/nueva", "/wms/tareas/nueva"].includes(
            url,
          )
        ) {
          const trigger = page
            .locator(".select-modal-trigger:not([disabled])")
            .first();
          if (await trigger.count()) {
            await trigger.click();
            await settled(page);
            report.push({
              role,
              url: url + "#selector",
              status: 200,
              ...(await inspect(page)),
            });
            await page.screenshot({
              path: path.join(output, filename + "-selector.png"),
            });
          }
        }
        if (
          [
            "/dashboard",
            "/mi-clave",
            "/wms/tareas/nueva",
            "/productos/nuevo",
            "/roles/nuevo",
            "/mi-cuenta",
            "/wms/posiciones",
            "/wms/sucursales/nuevo",
          ].includes(url) &&
          role !== "rf"
        ) {
          await page.setViewportSize({ width: 390, height: 844 });
          await settled(page);
          report.push({
            role,
            url: url + "#mobile",
            status: response.status(),
            ...(await inspect(page)),
          });
          await page.screenshot({
            path: path.join(output, filename + "-mobile.png"),
          });
          await page.setViewportSize({ width: 1440, height: 1000 });
        }
      }
      await context.close();
    }
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(
        { report, errors, coverage: [...coverage].sort() },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify(
        {
          views: [...coverage].sort(),
          pages: report.length,
          errors,
          contrastIssues: report.reduce((n, r) => n + r.failures.length, 0),
          overflow: report
            .filter((r) => r.overflow)
            .map((r) => [r.role, r.url]),
          report: path.join(output, "report.json"),
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
    await pool.end();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
