"use strict";

const INBOUND_STAGE_ASSET = Object.freeze({
  UNLOADING: "ASSET-AUTO-UNLOADER-IN-1",
  IDENTIFYING: "ASSET-AUTO-ID-IN-1",
  INSPECTING: "ASSET-PIE-IN-1",
  RECEIVING: "ASSET-INBOUND-CONVEYOR-1",
});

/** Additive installation: the original AMR graph, rack addresses, truck routes
 * and custody handoffs stay fixed. The annex is a separate physical footprint,
 * not a rescaling of the existing warehouse or a replacement of persisted stock. */
function createAutomationBlueprint(layout) {
  const receive = layout.stations.find((station) => station.id === "RECEIVE") || { x: -34, z: 17 };
  const pack = layout.stations.find((station) => station.id === "PACK") || { x: 12, z: 18 };
  const station = (deviceId, type, name, x, z, width, depth, extra = {}) => ({
    id: deviceId, deviceId, assetId: `ASSET-${deviceId}`, type, name,
    x, y: 0.85, z, heading: Math.PI / 2, width, depth, height: 4.2, ...extra,
  });
  const stations = [
    station("AUTO-UNLOADER-IN-1", "AUTO_UNLOADER", "Descarga automática de proveedor", -75, 17, 12, 5, { height: 2.8 }),
    station("AUTO-ID-IN-1", "AUTO_ID_GATE", "Portal de identificación", -64, 17, 5, 4),
    station("PIE-IN-1", "PIE_STATION", "Inspección de gálibo y peso", -54, 17, 6, 5),
    station("INBOUND-CONVEYOR-1", "INBOUND_CONVEYOR", "Transferencia a recepción", -43, 17, 16, 3, { height: 1.4, handoffId: "RECEIVE", handoffPoint: { ...receive, y: 0.18 } }),
    station("CASE-PICKER-1", "CASE_PICKING_CELL", "Célula de preparación y etiquetado", pack.x + 2, pack.z + 1, 12, 14,
      { y: 0, height: 6, heading: 0, handoffId: "PACK", handoffPoint: { x: pack.x, y: 0.18, z: pack.z },
        armBase: { x: pack.x + 4, y: 0, z: pack.z + 2 }, approach: [{ x: pack.x, y: 0, z: pack.z - 8 }, { x: pack.x, y: 0, z: pack.z }] }),
    ...(layout.branches || []).map((branch) => {
      const handoff = branch.receivingPoint || { x: branch.x, z: branch.z + 12 };
      // The truck approaches along +X: its rear is 7.2 m to the west.
      // Keep the fixed station outside that swept lane; the transfer bridge
      // only deploys after the receiving interlock has restrained the vehicle.
      return station(`STORE-RECEIVING-${branch.id}`, "STORE_RECEIVING_STATION", `Recepción · ${branch.name}`, handoff.x - 12, handoff.z + 6, 5, 4,
        { y: 1.2, height: 3.8, heading: 0, branchId: branch.id, handoffPoint: { x: handoff.x - 7.2, y: 1.2, z: handoff.z },
          truckPose: { x: handoff.x, y: 0, z: handoff.z, heading: Math.PI / 2 },
          bufferPoint: { x: handoff.x - 12, y: 1.2, z: handoff.z + 6 }, retractableTransfer: true,
          bufferSlots: Array.from({ length: 24 }, (_, index) => ({ id: `${branch.id}-RECEIVE-${String(index + 1).padStart(2, "0")}`,
            x: handoff.x - 12 + ((index % 6) - 2.5) * 1.5, y: 0.18, z: handoff.z + 10 + Math.floor(index / 6) * 1.5,
            width: 1.2, depth: 1 })),
          transferPath: [{ x: handoff.x - 7.2, y: 1.2, z: handoff.z }, { x: handoff.x - 12, y: 1.2, z: handoff.z }, { x: handoff.x - 12, y: 1.2, z: handoff.z + 6 }] });
    }),
  ];
  const receivingRoute = [
    { x: -86.8, y: 1.2, z: 17 },
    { x: -75, y: 0.85, z: 17 },
    { x: -64, y: 0.85, z: 17 },
    { x: -54, y: 0.85, z: 17 },
    { x: -43, y: 0.85, z: 17 },
    { x: receive.x, y: 0.18, z: receive.z },
  ];
  // The physical conveyor terminates before the AMR berth. A pallet clears
  // the line laterally on the distributor; the robot's graph node is retained.
  const mechanicalReceivingRoute = receivingRoute.map((point, index) => index === receivingRoute.length - 1
    ? { ...point, x: point.x - 3 } : { ...point });
  return {
    version: 1,
    coordinateUnits: "METRES",
    annex: { id: "INBOUND-ANNEX", name: "Anexo de recepción automatizada", bounds: { minX: -83, maxX: -50, minZ: 2, maxZ: 34 }, height: 12,
      opening: { x: -50, z: 17, width: 5, height: 5 },
      supplierOpening: { x: -83, z: 17, width: 5, height: 5 }, areaM2: 1056 },
    supplierDock: { id: "SUPPLIER-DOCK-1", truckPose: { x: -94, y: 0, z: 17, heading: -Math.PI / 2 },
      rearPoint: receivingRoute[0], transferPoint: receivingRoute[1],
      approach: [{ x: -105, y: 0, z: 60 }, { x: -105, y: 0, z: 17 }, { x: -94, y: 0, z: 17 }],
      safetyBounds: { minX: -106, maxX: -83, minZ: 12, maxZ: 22 }, capacityVehicles: 1 },
    stations, receivingRoute,
    mechanicalVersion: 1, mechanicalReceivingRoute,
    mechanicalPhasePaths: {
      UNLOADING: mechanicalReceivingRoute.slice(0, 2),
      IDENTIFYING: mechanicalReceivingRoute.slice(1, 3),
      INSPECTING: mechanicalReceivingRoute.slice(2, 4),
      RECEIVING: mechanicalReceivingRoute.slice(3),
    },
    receivingBufferSlots: Array.from({ length: 12 }, (_, index) => ({
      id: `RECEIVE-BUFFER-${String(index + 1).padStart(2, "0")}`, stationId: "RECEIVE",
      x: [-44, -41.8, -39.6][index % 3], y: 0.18, z: 21 + Math.floor(index / 3) * 2.2,
      width: 1.2, depth: 1,
    })),
    phasePaths: {
      UNLOADING: receivingRoute.slice(0, 2),
      IDENTIFYING: receivingRoute.slice(1, 3),
      INSPECTING: receivingRoute.slice(2, 4),
      RECEIVING: receivingRoute.slice(3),
    },
    handoffId: "RECEIVE",
    safetyClearanceM: 1.2,
  };
}

function migrateAutomationBlueprint(s) {
  const next = createAutomationBlueprint(s.layout);
  if (!(s.layout.automation?.version >= 1)) { s.layout.automation = next; return true; }
  // A new/relocated branch gets its own registered receiving endpoint. Do not
  // reset the central installation, running routes or any inventory location.
  let changed = false;
  if (!(s.layout.automation.mechanicalVersion >= 1)) {
    for (const field of ["mechanicalVersion", "mechanicalReceivingRoute", "mechanicalPhasePaths"])
      s.layout.automation[field] = next[field];
    changed = true;
  }
  const existing = s.layout.automation.stations.filter((station) => station.type !== "STORE_RECEIVING_STATION");
  const stores = next.stations.filter((station) => station.type === "STORE_RECEIVING_STATION");
  if (JSON.stringify(s.layout.automation.stations.filter((station) => station.type === "STORE_RECEIVING_STATION")) === JSON.stringify(stores)) return changed;
  s.layout.automation.stations = [...existing, ...stores];
  return true;
}

module.exports = { createAutomationBlueprint, migrateAutomationBlueprint, INBOUND_STAGE_ASSET };
