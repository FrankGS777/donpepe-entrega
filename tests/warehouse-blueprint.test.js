const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BUILDING,
  AREAS,
  allBins,
  binCode,
  lotCode,
} = require("../config/warehouseBlueprint");
const { plannedLayout } = require("../models/warehouseLayout");

test("CD1 genera direcciones únicas hasta profundidad y conserva los límites del edificio", () => {
  const bins = allBins();
  assert.equal(AREAS.length, 15);
  assert.equal(bins.length, 2412);
  assert.equal(new Set(bins.map((bin) => bin.code)).size, bins.length);
  assert.equal(
    binCode("SEC-B", 2, 4, 3, 2, 2),
    "CD1-SEC-B-A02-R04-N03-C02-D02",
  );
  assert.equal(lotCode(4582), "L-004582");
  for (const bin of bins) {
    const area = AREAS.find((area) => area.code === bin.zone);
    assert.ok(
      Math.abs(bin.x - area.x) < area.width / 2 - 1,
      `${bin.code}: fuera de zona en X`,
    );
    assert.ok(
      Math.abs(bin.z - area.z) < area.depth / 2 - 1,
      `${bin.code}: fuera de zona en Z`,
    );
    assert.ok(bin.x >= 0 && bin.x <= BUILDING.width, bin.code);
    assert.ok(bin.z >= 0 && bin.z <= BUILDING.depth, bin.code);
    assert.match(bin.code, /^CD1-[A-Z-]+-A\d{2}-R\d{2}-N\d{2}-C\d{2}-D\d{2}$/);
  }
});

test("las cámaras frías tienen posiciones reales de recepción, reserva, cuarentena y despacho", () => {
  const zones = Object.fromEntries(AREAS.map((area) => [area.code, area]));
  for (const code of [
    "REC-F",
    "REC-C",
    "FRI",
    "CON",
    "QUA-F",
    "QUA-C",
    "DSP-F",
    "DSP-C",
  ])
    assert.ok(zones[code].structure.startsWith("CAMARA_"), code);
  for (const code of ["SEC-A", "SEC-B", "SEC-C", "VEN"])
    assert.equal(zones[code].structure, "RACK");
  assert.ok(
    allBins().some((bin) => bin.zone === "SEC-B" && bin.depthSlot === 2),
  );
});

test("el plano vincula cada casillero generado al ID y ocupación de la base", () => {
  const area = AREAS.find((item) => item.code === "SEC-B");
  const bin = allBins().find(
    (item) => item.zone === area.code && item.depthSlot === 2,
  );
  const layout = plannedLayout(
    [
      {
        id: 9,
        codigo_zona: area.code,
        nombre: "Reserva B",
        proposito: "ALMACENAJE",
        condicion_almacenamiento: "AMBIENTE",
        plano_x: area.x,
        plano_z: area.z,
        ancho_m: area.width,
        fondo_m: area.depth,
      },
    ],
    [
      {
        ubicacion_id: 501,
        zona_id: 9,
        codigo_loc: bin.code,
        modelo_plano: "CD1",
        pasillo: bin.aisle,
        estante: bin.rack,
        nivel: bin.level,
        posicion: bin.cell,
        profundidad: bin.depthSlot,
        tipo: "RESERVA",
        capacidad_hu: 1,
        ocupacion_hu: 1,
        unidades_ocupadas: 36,
        capacidad_disponible: 0,
        porcentaje_ocupacion: 100,
        layout_x: bin.x,
        layout_z: bin.z,
        layout_verificado: 0,
        activo: 1,
      },
    ],
  );
  assert.equal(layout.locations[0].id, 501);
  assert.equal(layout.locations[0].depthSlot, 2);
  assert.equal(layout.locations[0].occupied, 1);
  assert.equal(layout.locations[0].units, 36);
  assert.equal(layout.physicalSurveyVerified, false);
});
