"use strict";
const catalogAssets = require("./catalog-assets.json");
const { createAutomationBlueprint } = require("./automation-blueprint");
const { extendWarehouse } = require("./warehouse-expansion");

// This is a fictional educational installation, not a Mecalux installation plan.
// Geometry and dispatching share these coordinates: the map cannot invent routes.
const pad = (value) => String(value).padStart(2, "0");
function createLoadingDocks(stations = []) {
  return [1, 2].map(index => {
    const id = `DOCK-${index}`, x = stations.find(station => station.id === id)?.x ?? (index === 1 ? 28 : 44);
    return { id, name: `Muelle ${index}`, forkliftId: `FORKLIFT-${index}`, x, z: 23,
      portal: { x, y: 0, z: 34, width: 4.4, height: 4.8 },
      truckPose: { x, y: 0, z: 41.7, heading: 0 }, forkliftHome: { x: x - 6, y: 0, z: 28.5, heading: 0 },
      ramp: { start: { x, y: 0, z: 29 }, end: { x, y: 1.2, z: 34.5 }, width: 3 },
      trailer: { width: 2.6, length: 14, bedHeight: 1.2, rearLocalZ: -7.2, frontLocalZ: 6.8, cabLocalZ: 8 },
      stagingSlots: Array.from({ length: 24 }, (_, slot) => ({ id: `${id}-STAGE-${pad(slot + 1)}`, dockId: id, x: x + [-4.3, -2.95, -1.6, 1.6, 2.95, 4.3][slot % 6], y: 0.18, z: 24.7 - Math.floor(slot / 6) * 5.2, width: 1.16, depth: 0.94 })) };
  });
}
function createBlueprint() {
  const zones = [
    { id: "DRY", name: "Reserva seca automática", type: "DRY", x: -24, z: -12, width: 40, depth: 28, temperature: "Ambiente", color: "#dac278" },
    { id: "COLD", name: "Cámara refrigerada", type: "CHILLED", x: 14, z: -16, width: 24, depth: 24, temperature: "+2 a +6 °C", color: "#82d3dc" },
    { id: "FROZEN", name: "Cámara congelada", type: "FROZEN", x: 38, z: -16, width: 18, depth: 24, temperature: "−18 °C", color: "#94b6ed" },
    { id: "RECEIVING", name: "Recepción y control", type: "RECEIVING", x: -34, z: 21, width: 24, depth: 16, color: "#c4b4ed" },
    { id: "QUARANTINE", name: "Cuarentena · mercancía retenida", type: "QUARANTINE", x: -14, z: 22, width: 16, depth: 12, temperature: "Compartimentos separados: ambiente, refrigerado y congelado", color: "#edb2ad" },
    { id: "PACKING", name: "Preparación de cajas cerradas", type: "PACKING", x: 12, z: 18, width: 18, depth: 16, color: "#bea0e2" },
    { id: "DISPATCH", name: "Consolidación y expedición", type: "DISPATCH", x: 36, z: 20, width: 28, depth: 27, color: "#edd071" },
    { id: "CLEANING", name: "Limpieza · almacenamiento separado", type: "CLEANING", x: -10, z: -28, width: 18, depth: 6, color: "#adc3b1" },
  ];
  const nodes = [], edges = [];
  const node = (id, x, z, extra = {}) => { nodes.push({ id, x, z, ...extra }); return id; };
  const edge = (a, b, extra = {}) => edges.push({ id: [a, b].sort().join("~"), from: a, to: b, ...extra });
  for (const x of [-44, -34, -22, -2, 2, 12, 28, 38, 44]) node(`C${x}`, x, 6);
  const corridor = nodes.slice();
  corridor.slice(1).forEach((n, i) => edge(corridor[i].id, n.id));
  const splitCorridor = (a, b) => { const index = edges.findIndex((e) => [e.from, e.to].includes(a) && [e.from, e.to].includes(b)); if (index >= 0) edges.splice(index, 1); };
  node("RECEIVE", -34, 17); edge("C-34", "RECEIVE");
  node("Q", -14, 21); node("Q-ENTRY", -14, 6); edge("C-22", "Q-ENTRY"); edge("Q-ENTRY", "C-2"); edge("Q-ENTRY", "Q");
  splitCorridor("C-22", "C-2");
  node("Q-COLD", -18, 21); node("Q-FROZEN", -10, 21); edge("Q", "Q-COLD"); edge("Q", "Q-FROZEN");
  node("DRY-IN", -44, -12); edge("C-44", "DRY-IN");
  node("COLD-CORRIDOR", 0, 6); edge("C-2", "COLD-CORRIDOR"); edge("COLD-CORRIDOR", "C2");
  splitCorridor("C-2", "C2");
  node("COLD-IN", 0, -16); edge("COLD-CORRIDOR", "COLD-IN");
  node("PACK", 12, 18); edge("C12", "PACK");
  node("DOCK-1", 28, 23); edge("C28", "DOCK-1");
  node("DOCK-2", 44, 23); edge("C44", "DOCK-2");
  node("CLEAN-IN", -2, -25); edge("C-2", "CLEAN-IN");
  node("CLEAN-A1", -8, -25); node("CLEAN-A2", -14, -25); edge("CLEAN-IN", "CLEAN-A1"); edge("CLEAN-A1", "CLEAN-A2");
  node("CLEAN-1", -8, -28); edge("CLEAN-A1", "CLEAN-1");
  node("CLEAN-2", -14, -28); edge("CLEAN-A2", "CLEAN-2");
  node("FROZEN-IN", 38, -2); edge("C38", "FROZEN-IN");
  for (const z of [-10, -17, -24]) {
    node(`F${z}`, 38, z); edge(z === -10 ? "FROZEN-IN" : `F${z + 7}`, `F${z}`, { temperature: "FROZEN" });
    for (const x of [33, 43]) { node(`F${x}:${z}`, x, z); edge(`F${z}`, `F${x}:${z}`, { temperature: "FROZEN" }); }
  }
  for (const [i, x] of [-44, -22, -2].entries()) {
    node(`CHARGE-${i + 1}`, x, 10); edge(`C${x}`, `CHARGE-${i + 1}`);
  }
  for (const [i, x] of [-44, -34, -22, -2, 12, 28].entries()) {
    node(`PARK-${i + 1}`, i === 0 ? -42 : i === 3 ? -4 : x, 3); edge(`C${x}`, `PARK-${i + 1}`);
  }
  const racks = [], locations = [];
  const addRack = (zoneId, x, z, aisle, module, stackerId) => {
    const id = `${zoneId}-R${pad(module)}`;
    racks.push({ id, zoneId, aisle, module, x, z, width: 8, depth: 3.5, levels: 3, slots: 2, stackerId });
    for (let level = 1; level <= 3; level++) for (let slot = 1; slot <= 2; slot++) {
      const code = `CD1-${zoneId === "DRY" ? "SEC" : "REF"}-A${pad(aisle)}-R${pad(module)}-N${pad(level)}-P${pad(slot)}`;
      locations.push({ id: code, code, zoneId, rackId: id, aisle, module, level, slot, depth: 1,
        x: x + (slot === 1 ? -1.9 : 1.9), y: 0.8 + (level - 1) * 3.2, z,
        kind: "RACK", stackerId, handoffId: zoneId === "DRY" ? "DRY-IN" : "COLD-IN", capacityHus: 1 });
    }
  };
  let module = 0;
  for (const z of [-17, -7]) for (const x of [-37, -27, -17, -7]) addRack("DRY", x, z, 1, ++module, "STACKER-1");
  module = 0;
  for (const z of [-21, -11]) for (const x of [6, 14, 22]) addRack("COLD", x, z, 2, ++module, "STACKER-2");
  let frozenSlot = 0;
  for (const z of [-10, -17, -24]) for (const x of [33, 43]) {
    const code = `CD1-CON-A03-R01-N01-P${pad(++frozenSlot)}`;
    locations.push({ id: code, code, zoneId: "FROZEN", rackId: null, aisle: 3, module: 1, level: 1,
      slot: frozenSlot, x, y: 0.4, z, kind: "FLOOR", nodeId: `F${x}:${z}`, handoffId: "FROZEN-IN", stackerId: "SHUTTLE-1", capacityHus: 1 });
  }
  for (let i = 1; i <= 2; i++) locations.push({ id: `CD1-LIM-A04-R01-N01-P0${i}`, code: `CD1-LIM-A04-R01-N01-P0${i}`,
    zoneId: "CLEANING", rackId: null, aisle: 4, module: 1, level: 1, slot: i, x: i === 1 ? -8 : -14,
    y: 0.4, z: -28, kind: "FLOOR", nodeId: `CLEAN-${i}`, capacityHus: 1 });
  const stations = [
    { id: "RECEIVE", name: "Control de entrada", type: "RECEIVING", x: -34, z: 17 },
    { id: "Q", name: "Jaula de cuarentena ambiente", type: "QUARANTINE", x: -14, z: 21, temperature: "AMBIENT" },
    { id: "Q-COLD", name: "Cápsula de cuarentena refrigerada", type: "QUARANTINE", x: -18, z: 21, temperature: "CHILLED" },
    { id: "Q-FROZEN", name: "Cápsula de cuarentena congelada", type: "QUARANTINE", x: -10, z: 21, temperature: "FROZEN" },
    { id: "DRY-IN", name: "Transferencia de reserva seca", type: "HANDOFF", x: -44, z: -12, zoneId: "DRY" },
    { id: "COLD-IN", name: "Transferencia de cámara fría", type: "HANDOFF", x: 0, z: -16, zoneId: "COLD" },
    { id: "FROZEN-IN", name: "Transferencia de congelados", type: "HANDOFF", x: 38, z: -2, zoneId: "FROZEN" },
    { id: "PACK", name: "Estación automática de consolidación", type: "PACKING", x: 12, z: 18 },
    { id: "DOCK-1", name: "Muelle 1", type: "DOCK", x: 28, z: 23 },
    { id: "DOCK-2", name: "Muelle 2", type: "DOCK", x: 44, z: 23 },
    ...[1, 2, 3].map((i) => { const n = nodes.find((n) => n.id === `CHARGE-${i}`); return { ...n, name: `Cargador ${i}`, type: "CHARGER" }; }),
  ];
  const layout = { id: "CD1", name: "DonPepe · Centro de distribución", width: 104, depth: 72,
    bounds: { minX: -50, maxX: 50, minZ: -32, maxZ: 34 }, zones, nodes, edges, racks, locations, stations,
    doors: [{ id: "COLD-DOOR", x: 1.1, z: -16, width: 5 }, { id: "FREEZER-DOOR", x: 38, z: -4, width: 5 }],
    roads: [{ id: "YARD", points: [{ x: -55, z: 60 }, { x: 65, z: 60 }], width: 7 }],
    truckParking: [1, 2, 3].map(index => ({ id: `PARK-TRUCK-${index}`, x: 20 + index * 9, z: 75, heading: 0, width: 3.8, length: 19 })),
    loadingDocks: createLoadingDocks(stations),
    branches: BRANCHES.map((b) => ({ ...b, receivingPoint: { x: b.x, z: b.z + 12 } })),
  };
  extendWarehouse(layout);
  layout.automation = createAutomationBlueprint(layout);
  return layout;
}
const BRANCHES = [
  { id: "TIENDA-1", code: "DP-01", name: "DonPepe · San Miguel", x: -76, z: 48, travelSeconds: 36 },
  { id: "TIENDA-2", code: "DP-02", name: "DonPepe · Pueblo Libre", x: 76, z: 48, travelSeconds: 48 },
  { id: "TIENDA-3", code: "DP-03", name: "DonPepe · Jesús María", x: 8, z: 83, travelSeconds: 60 },
];
const SUPPLIERS = [
  { id: "PROV-1", name: "Proveedor de abarrotes · escenario", zones: ["DRY"] },
  { id: "PROV-2", name: "Proveedor de cadena fría · escenario", zones: ["COLD", "FROZEN"] },
  { id: "PROV-3", name: "Proveedor de limpieza · escenario", zones: ["CLEANING"] },
].map(supplier => ({ ...supplier, ...catalogAssets.suppliers.find(record => record.id === supplier.id),
  contact: "", email: "", phone: "", leadDays: 2,
  sourcingNote: "Relación de suministro, zonas y plazo configurados para el escenario DonPepe." }));
const SKUS = [
  ["ARROZ", "Arroz extra 1 kg", "DRY", 12, true], ["ACEITE", "Aceite vegetal 900 ml", "DRY", 12, true],
  ["FIDEOS", "Fideos 500 g", "DRY", 20, true], ["AZUCAR", "Azúcar rubia 1 kg", "DRY", 12, true],
  ["ATUN", "Atún en conserva 170 g", "DRY", 24, true], ["LECHE", "Leche UHT 1 litro", "DRY", 12, true],
  ["YOGUR", "Yogur natural 1 litro", "COLD", 6, true], ["QUESO", "Queso fresco 500 g", "COLD", 8, true],
  ["JUGO", "Jugo refrigerado 1 litro", "COLD", 6, true], ["HELADO", "Helado 1 litro", "FROZEN", 6, true],
  ["POLLO", "Pollo congelado 1 kg", "FROZEN", 10, true], ["DETERGENTE", "Detergente 1 kg", "CLEANING", 12, false],
].map(([id, name, zoneId, unitsPerCase, expiryControlled], i) => ({ id: `SKU-${id}`, code: `DP-${String(i + 1).padStart(4, "0")}`,
  name, zoneId, unitsPerCase, expiryControlled, caseLabel: `Caja × ${unitsPerCase}`, maxCasesPerHu: 24,
  supplierId: zoneId === "DRY" ? "PROV-1" : zoneId === "CLEANING" ? "PROV-3" : "PROV-2",
  temperature: zoneId === "COLD" ? "CHILLED" : zoneId === "FROZEN" ? "FROZEN" : "AMBIENT",
  reorderPoint: 12, ...catalogAssets.products.find(record => record.id === `SKU-${id}`) }));
module.exports = { createBlueprint, createLoadingDocks, SKUS, BRANCHES, SUPPLIERS };
