// Plano lógico CD1: metros de diseño, no un levantamiento topográfico.
// Los muelles de recepción están al sur (z=0); la expedición sale al norte (z=132).
// Los corredores de 4 m separan recepción, reserva, picking y despacho.
const BUILDING = Object.freeze({
  code: "CD1",
  width: 184,
  depth: 132,
  aisleWidth: 3.4,
});

const AREAS = Object.freeze([
  {
    code: "REC",
    x: 16,
    z: 14,
    width: 24,
    depth: 20,
    aisles: 2,
    racks: 6,
    levels: 1,
    cells: 2,
    depthSlots: 1,
    profile: "RECEPCION",
    structure: "MUELLE",
  },
  {
    code: "REC-F",
    x: 42,
    z: 14,
    width: 14,
    depth: 20,
    aisles: 1,
    racks: 4,
    levels: 1,
    cells: 2,
    depthSlots: 1,
    profile: "RECEPCION",
    structure: "CAMARA_FRIA",
  },
  {
    code: "REC-C",
    x: 58,
    z: 14,
    width: 14,
    depth: 20,
    aisles: 1,
    racks: 4,
    levels: 1,
    cells: 2,
    depthSlots: 1,
    profile: "RECEPCION",
    structure: "CAMARA_CONGELADA",
  },
  {
    code: "QUA",
    x: 77,
    z: 14,
    width: 18,
    depth: 20,
    aisles: 1,
    racks: 6,
    levels: 2,
    cells: 2,
    depthSlots: 1,
    profile: "CUARENTENA",
    structure: "JAULA_CONTROL",
  },
  {
    code: "QUA-F",
    x: 96,
    z: 14,
    width: 14,
    depth: 20,
    aisles: 1,
    racks: 3,
    levels: 2,
    cells: 2,
    depthSlots: 1,
    profile: "CUARENTENA",
    structure: "CAMARA_FRIA",
  },
  {
    code: "QUA-C",
    x: 112,
    z: 14,
    width: 14,
    depth: 20,
    aisles: 1,
    racks: 3,
    levels: 2,
    cells: 2,
    depthSlots: 1,
    profile: "CUARENTENA",
    structure: "CAMARA_CONGELADA",
  },
  {
    code: "SEC-C",
    x: 22,
    z: 58,
    width: 36,
    depth: 60,
    aisles: 4,
    racks: 8,
    levels: 4,
    cells: 2,
    depthSlots: 2,
    profile: "RESERVA",
    structure: "RACK",
  },
  {
    code: "SEC-B",
    x: 68,
    z: 58,
    width: 44,
    depth: 60,
    aisles: 6,
    racks: 10,
    levels: 4,
    cells: 2,
    depthSlots: 2,
    profile: "RESERVA",
    structure: "RACK",
  },
  {
    code: "SEC-A",
    x: 118,
    z: 58,
    width: 44,
    depth: 60,
    aisles: 5,
    racks: 8,
    levels: 4,
    cells: 2,
    depthSlots: 1,
    profile: "RESERVA",
    structure: "RACK",
  },
  {
    code: "VEN",
    x: 163,
    z: 58,
    width: 34,
    depth: 60,
    aisles: 4,
    racks: 8,
    levels: 3,
    cells: 3,
    depthSlots: 1,
    profile: "PICKING",
    structure: "RACK",
  },
  {
    code: "FRI",
    x: 27,
    z: 106,
    width: 46,
    depth: 28,
    aisles: 3,
    racks: 6,
    levels: 3,
    cells: 2,
    depthSlots: 1,
    profile: "MIXTA_FRIA",
    structure: "CAMARA_FRIA",
  },
  {
    code: "CON",
    x: 69,
    z: 106,
    width: 32,
    depth: 28,
    aisles: 2,
    racks: 6,
    levels: 3,
    cells: 2,
    depthSlots: 1,
    profile: "MIXTA_FRIA",
    structure: "CAMARA_CONGELADA",
  },
  {
    code: "DSP-F",
    x: 96,
    z: 116,
    width: 14,
    depth: 18,
    aisles: 1,
    racks: 4,
    levels: 1,
    cells: 2,
    depthSlots: 1,
    profile: "DESPACHO",
    structure: "CAMARA_FRIA",
  },
  {
    code: "DSP-C",
    x: 112,
    z: 116,
    width: 14,
    depth: 18,
    aisles: 1,
    racks: 4,
    levels: 1,
    cells: 2,
    depthSlots: 1,
    profile: "DESPACHO",
    structure: "CAMARA_CONGELADA",
  },
  {
    code: "DSP",
    x: 149,
    z: 116,
    width: 46,
    depth: 18,
    aisles: 3,
    racks: 8,
    levels: 1,
    cells: 2,
    depthSlots: 1,
    profile: "DESPACHO",
    structure: "MUELLE",
  },
]);

const pad = (n) => String(n).padStart(2, "0");
function binCode(zone, aisle, rack, level, cell, depth = 1) {
  return `${BUILDING.code}-${zone}-A${pad(aisle)}-R${pad(rack)}-N${pad(level)}-C${pad(cell)}-D${pad(depth)}`;
}

function* binsFor(area) {
  for (let aisle = 1; aisle <= area.aisles; aisle++)
    for (let rack = 1; rack <= area.racks; rack++)
      for (let level = 1; level <= area.levels; level++)
        for (let cell = 1; cell <= area.cells; cell++)
          for (let depth = 1; depth <= area.depthSlots; depth++) {
            // Módulos contiguos a lo largo del pasillo; casilleros longitudinales
            // y doble fondo transversal. Conserva todas las direcciones e IDs.
            const modulePitch = Math.min(
              area.cells * 1.3 + 0.3,
              (area.depth - 4) / area.racks,
            );
            const cellPitch = (modulePitch - 0.2) / area.cells;
            const rowLength = area.racks * modulePitch;
            const x =
              area.x -
              area.width / 2 +
              3.2 +
              (aisle - 1) * ((area.width - 6.4) / area.aisles) +
              (depth - 1) * 1.3;
            const z =
              area.z -
              rowLength / 2 +
              (rack - 1) * modulePitch +
              0.1 +
              cellPitch / 2 +
              (cell - 1) * cellPitch;
            yield {
              code: binCode(area.code, aisle, rack, level, cell, depth),
              zone: area.code,
              aisle: pad(aisle),
              rack: pad(rack),
              level,
              cell,
              depthSlot: depth,
              x: Math.round(x * 100) / 100,
              z: Math.round(z * 100) / 100,
              type:
                area.profile === "MIXTA_FRIA"
                  ? level === 1
                    ? "PICKING"
                    : "RESERVA"
                  : area.profile,
              pickSequence:
                aisle * 100000 + rack * 1000 + level * 100 + cell * 10 + depth,
            };
          }
}

function allBins() {
  return AREAS.flatMap((area) => [...binsFor(area)]);
}
function lotCode(id) {
  return `L-${String(id).padStart(6, "0")}`;
}

module.exports = { BUILDING, AREAS, binsFor, allBins, binCode, lotCode };
