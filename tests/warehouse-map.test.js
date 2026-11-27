const test = require("node:test");
const assert = require("node:assert/strict");
const WarehouseMap = require("../models/WarehouseMap");

test("el mapa esquemático conserva IDs, zona/pasillo/estante y ocupación reales", () => {
  const zones = [
    { id: 2, codigo_zona: "SEC", nombre: "Seco", proposito: "ALMACENAJE" },
    { id: 3, codigo_zona: "VEN", nombre: "Picking", proposito: "PICKING" },
  ];
  const locations = [
    {
      ubicacion_id: 10,
      zona_id: 2,
      codigo_loc: "SEC-A-01",
      pasillo: "A",
      estante: "01",
      tipo: "RESERVA",
      capacidad_unidades: 100,
      unidades_ocupadas: 35,
      capacidad_disponible: 65,
      porcentaje_ocupacion: 35,
      activo: 1,
    },
    {
      ubicacion_id: 11,
      zona_id: 2,
      codigo_loc: "SEC-B-01",
      pasillo: "B",
      estante: "01",
      tipo: "RESERVA",
      capacidad_unidades: 100,
      unidades_ocupadas: 0,
      capacidad_disponible: 100,
      porcentaje_ocupacion: 0,
      activo: 1,
    },
    {
      ubicacion_id: 12,
      zona_id: 3,
      codigo_loc: "VEN-C-01",
      pasillo: "C",
      estante: "01",
      tipo: "PICKING",
      capacidad_unidades: 80,
      unidades_ocupadas: 80,
      capacidad_disponible: 0,
      porcentaje_ocupacion: 100,
      activo: 1,
    },
    {
      ubicacion_id: 13,
      zona_id: 3,
      codigo_loc: "VEN-D-01",
      pasillo: "D",
      estante: "01",
      tipo: "PICKING",
      capacidad_unidades: 80,
      unidades_ocupadas: 0,
      capacidad_disponible: 80,
      porcentaje_ocupacion: 0,
      activo: 0,
    },
  ];
  const map = WarehouseMap.schematicLayout(zones, locations);
  assert.equal(map.kind, "ESQUEMATICO");
  assert.equal(map.physicalSurveyVerified, false);
  assert.deepEqual(
    map.locations.map((loc) => loc.id).sort((a, b) => a - b),
    [10, 11, 12, 13],
  );
  assert.equal(new Set(map.locations.map((loc) => loc.aisle)).size, 4);
  assert.equal(map.locations.find((loc) => loc.id === 10).occupied, 35);
  assert.equal(map.locations.find((loc) => loc.id === 13).active, false);
  assert.ok(
    map.locations.every(
      (loc) => Number.isFinite(loc.x) && Number.isFinite(loc.z),
    ),
  );
  assert.ok(map.locations.every((loc) => loc.visualRackLevels === 3));
});
