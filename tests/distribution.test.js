const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { locationCode } = require("../utils/locationCode");
const { parseLines } = require("../services/distributionService");
const { can } = require("../config/permissions");
const WarehouseMap = require("../models/WarehouseMap");
const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("la dirección LOC distingue pasillo, módulo, nivel y casillero", () => {
  assert.equal(locationCode("SEC-A", 2, 4, 3, 1), "CD1-SEC-A-A02-R04-N03-C01-D01");
  assert.throws(() => locationCode("SEC-A", 0, 4, 3, 1), /Pasillo/);
  const map = WarehouseMap.schematicLayout(
    [
      {
        id: 8,
        codigo_zona: "SEC-A",
        nombre: "Reserva A",
        proposito: "ALMACENAJE",
      },
    ],
    [1, 2, 3].map((level) => ({
      ubicacion_id: level,
      zona_id: 8,
      codigo_loc: `SEC-A-P02-M04-N0${level}-C01`,
      pasillo: "02",
      estante: "04",
      nivel: level,
      posicion: 1,
      capacidad_unidades: 100,
      unidades_ocupadas: level * 10,
      activo: 1,
    })),
  );
  assert.equal(new Set(map.locations.map((loc) => loc.rackKey)).size, 1);
  assert.deepEqual(
    map.locations.map((loc) => loc.level),
    [1, 2, 3],
  );
  assert.equal(map.physicalSurveyVerified, false);
});

test("el pedido de sucursal consolida líneas y rechaza cantidades inválidas", () => {
  assert.deepEqual(
    parseLines(
      JSON.stringify([
        { producto_id: 4, cantidad: 2 },
        { producto_id: 4, cantidad: 3 },
      ]),
    ),
    [{ productId: 4, quantity: 5 }],
  );
  assert.throws(
    () => parseLines('[{"producto_id":1,"cantidad":-1}]'),
    /cantidad positiva/,
  );
  assert.throws(() => parseLines("no-json"), /JSON válido/);
});

test("compras sigue siendo solo del administrador; distribución corresponde a operaciones", () => {
  assert.equal(can("jefe_operaciones", "purchases.view"), false);
  assert.equal(can("jefe_operaciones", "distribution.plan"), true);
  assert.equal(can("jefe_operaciones", "distribution.return"), true);
  assert.equal(can("operador_rf", "distribution.dispatch"), false);
  assert.equal(can("administrador_wms", "distribution.branches.manage"), true);
});

test("la cadena de frío comienza en recepción y el retorno conserva la expedición", () => {
  const receiving = read("services/purchaseService.js");
  const distribution = read("services/distributionService.js");
  assert.match(
    receiving,
    /location\.condicion_almacenamiento !== product\.condicion_requerida/,
  );
  assert.match(
    distribution,
    /Solo se acepta una devolución de un pedido ya despachado/,
  );
  assert.match(distribution, /qty\s*>\s*remaining/);
  assert.match(distribution, /estado_inventario\)[\s\S]*CUARENTENA/);
  assert.match(distribution, /DEVOLUCION_SUCURSAL/);
});

test("la OC admite entregas parciales sin inventar unidades ni cerrar faltantes", () => {
  const schema = read("database/init.sql");
  const service = read("services/purchaseService.js");
  const form = read("views/compras/recibir.ejs");
  const stock = read("services/stockService.js");
  assert.match(schema, /'PENDIENTE','PARCIAL','RECIBIDA','CANCELADA'/);
  assert.match(schema, /cantidad_recibida INT NOT NULL DEFAULT 0/);
  assert.match(service, /quantity\s*>\s*remaining/);
  assert.match(
    service,
    /UPDATE ordenes_compra_detalle SET cantidad_recibida=cantidad_recibida\+\?/,
  );
  assert.match(
    service,
    /nextState\s*=\s*Number\(pending\.unidades\)\s*>\s*0\s*\?\s*"PARCIAL"\s*:\s*"RECIBIDA"/,
  );
  assert.match(form, /class="form-control received-qty"/);
  assert.match(stock, /SELECT id,DATE_FORMAT\(fecha_ingreso/);
});

test("el picking nuevo se vincula al pedido y el despacho consume staging", () => {
  const task = read("services/wmsService.js");
  const distribution = read("services/distributionService.js");
  assert.match(
    task,
    /El picking debe pertenecer a un pedido de sucursal planificado/,
  );
  assert.match(task, /lote_destino_id=\?/);
  assert.match(distribution, /estado_inventario='DISPONIBLE'/);
  assert.match(
    distribution,
    /ORDER BY l.fecha_vencimiento,l.fecha_ingreso,l.id/,
  );
  assert.match(distribution, /DESPACHO_SUCURSAL/);
  assert.match(distribution, /estado='DESPACHADO'/);
});
