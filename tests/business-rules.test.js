process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";
const test = require("node:test");
const assert = require("node:assert/strict");
const { validItems } = require("../services/purchaseService");
const { roundMoney } = require("../utils/numbers");
const fs = require("node:fs");
const path = require("node:path");
test("una compra agrupa productos repetidos con el mismo costo", () => {
  assert.deepEqual(
    validItems([
      { producto_id: 2, cantidad: 3, precio: 1.2 },
      { producto_id: 2, cantidad: 4, precio: 1.2 },
    ]),
    [{ product: 2, quantity: 7, price: 1.2 }],
  );
});
test("una compra rechaza costos contradictorios para el mismo producto", () => {
  assert.throws(
    () =>
      validItems([
        { producto_id: 2, cantidad: 1, precio: 1 },
        { producto_id: 2, cantidad: 1, precio: 2 },
      ]),
    /dos costos distintos/,
  );
});
test("las tareas WMS cubren RF sin módulo de ventas", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "services", "wmsService.js"),
    "utf8",
  );
  assert.match(source, /"PICKING"/);
  assert.match(source, /"DEVOLUCION_RUTA"/);
  assert.doesNotMatch(source, /VENTA/);
});
test("los importes se redondean a dos decimales", () =>
  assert.equal(roundMoney(0.1 + 0.2), 0.3));
