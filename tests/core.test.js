process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { can, permissions } = require("../config/permissions");
const { validationResult, matchedData } = require("express-validator");
const { productLogistics } = require("../validators/common");
const {
  purchaseCode,
  receiptCode,
  temporaryCode,
  warehouseTaskCode,
} = require("../utils/codes");
test("RBAC separa las capacidades de los tres roles", () => {
  assert.equal(can("administrador_wms", "users.update"), true);
  assert.equal(can("administrador_wms", "purchases.cancel"), true);
  assert.equal(can("administrador_wms", "wms.labels"), true);
  assert.equal(can("administrador_wms", "requests.manage"), true);
  assert.equal(can("jefe_operaciones", "products.update"), false);
  assert.equal(can("jefe_operaciones", "products.update_logistics"), true);
  assert.equal(can("jefe_operaciones", "products.create"), false);
  assert.equal(can("jefe_operaciones", "purchases.receive"), false);
  assert.equal(can("jefe_operaciones", "purchases.view"), false);
  assert.equal(can("jefe_operaciones", "purchases.create"), false);
  assert.equal(can("jefe_operaciones", "catalogs.update"), false);
  assert.equal(can("jefe_operaciones", "reports.business"), false);
  assert.equal(can("jefe_operaciones", "wms.tasks.assign"), true);
  assert.equal(can("jefe_operaciones", "wms.tasks.execute"), false);
  assert.equal(can("jefe_operaciones", "audits.approve"), false);
  assert.equal(can("administrador_wms", "wms.tasks.assign"), false);
  assert.equal(can("administrador_wms", "wms.tasks.create"), false);
  assert.equal(can("administrador_wms", "wms.tasks.execute"), false);
  assert.equal(can("administrador_wms", "distribution.dispatch"), false);
  assert.equal(can("administrador_wms", "audits.create"), false);
  assert.equal(can("jefe_operaciones", "users.view"), false);
  assert.equal(can("jefe_operaciones", "requests.manage"), false);
  assert.equal(can("operador_rf", "rf.access"), true);
  assert.equal(can("operador_rf", "rf.pick"), true);
  assert.equal(can("operador_rf", "wms.tasks.execute"), true);
  assert.equal(can("operador_rf", "wms.positions"), false);
  assert.equal(can("operador_rf", "audits.create"), false);
  assert.equal(can("operador_rf", "products.view"), false);
  assert.equal(can("operador_rf", "dashboard.admin"), false);
});
test("cada permiso usado por las rutas existe en la matriz RBAC", () => {
  const routeDir = path.join(__dirname, "..", "routes");
  const source = fs
    .readdirSync(routeDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => fs.readFileSync(path.join(routeDir, f), "utf8"))
    .join("\n");
  const used = [...source.matchAll(/permit\(([^)]*)\)/g)].flatMap((match) =>
    [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]),
  );
  const defined = new Set(Object.values(permissions).flat());
  for (const permission of used)
    assert.equal(
      defined.has(permission),
      true,
      `Permiso sin definir: ${permission}`,
    );
});
test("el jefe puede guardar WMS sin precio ni proveedor y no acepta esos campos", async () => {
  const req = {
    body: {
      unidad_medida: "UND",
      peso_kg: "1.2",
      volumen_m3: "0.003",
      stock_minimo: "5",
      ubicacion_picking_id: "2",
      stock_objetivo_pick: "10",
      clase_abc: "B",
      control_lote: "1",
      control_vencimiento: "1",
      precio_compra: "0",
      proveedor_id: "999",
    },
    params: {},
    query: {},
  };
  await Promise.all(productLogistics.map((rule) => rule.run(req)));
  assert.equal(validationResult(req).isEmpty(), true);
  const allowed = matchedData(req, { locations: ["body"] });
  assert.equal("precio_compra" in allowed, false);
  assert.equal("proveedor_id" in allowed, false);
});
test("genera códigos transaccionales estables y temporales únicos", () => {
  assert.equal(
    purchaseCode(42, new Date("2026-08-24T00:00:00Z")),
    "OC-2026-00042",
  );
  assert.equal(receiptCode(7), "B001-00000007");
  assert.equal(
    warehouseTaskCode(7, new Date("2026-08-24T00:00:00Z")),
    "TA-2026-000007",
  );
  const first = temporaryCode("V"),
    second = temporaryCode("V");
  assert.notEqual(first, second);
  assert.ok(first.length <= 20);
});
