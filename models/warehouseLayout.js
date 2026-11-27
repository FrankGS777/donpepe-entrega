const { BUILDING, AREAS, allBins } = require("../config/warehouseBlueprint");

const number = (value) => Number(value || 0);

// Plano operativo planificado: la geometría se sincroniza con el maestro CD1.
// layout_verificado solo significa una medición física cuando vale 1.
function plannedLayout(zones, locations) {
  const areaByCode = new Map(AREAS.map((area) => [area.code, area]));
  const zoneById = new Map(zones.map((zone) => [Number(zone.id), zone]));
  const plannedBins = new Map(allBins().map((bin) => [bin.code, bin]));
  const rackLevels = new Map();
  for (const loc of locations) {
    const key = `${loc.zona_id}|${loc.pasillo}|${loc.estante}`;
    rackLevels.set(key, Math.max(rackLevels.get(key) || 0, number(loc.nivel)));
  }
  const shapedZones = zones
    .filter((zone) => areaByCode.has(zone.codigo_zona))
    .map((zone) => {
      const area = areaByCode.get(zone.codigo_zona);
      return {
        id: number(zone.id),
        code: zone.codigo_zona,
        name: zone.nombre,
        purpose: zone.proposito,
        condition: zone.condicion_almacenamiento,
        structure: area.structure,
        x: number(zone.plano_x) || area.x,
        z: number(zone.plano_z) || area.z,
        width: number(zone.ancho_m) || area.width,
        depth: number(zone.fondo_m) || area.depth,
        aisleCount: area.aisles,
        rackCount: area.racks,
        binCount: locations.filter(
          (loc) => number(loc.zona_id) === number(zone.id),
        ).length,
      };
    });
  const shapedLocations = locations
    .filter((loc) => loc.modelo_plano === BUILDING.code)
    .map((loc) => {
      const zone = zoneById.get(number(loc.zona_id));
      if (!zone) return null;
      const area = areaByCode.get(zone.codigo_zona);
      if (!area) return null;
      const rackKey = `${loc.zona_id}|${loc.pasillo}|${loc.estante}`;
      const aisle = String(loc.pasillo).padStart(2, "0");
      const rack = String(loc.estante).padStart(2, "0");
      const measured = Boolean(loc.layout_verificado);
      const planned = plannedBins.get(loc.codigo_loc);
      return {
        id: number(loc.ubicacion_id),
        code: loc.codigo_loc,
        zoneId: number(zone.id),
        zone: zone.nombre,
        zoneCode: zone.codigo_zona,
        aisle,
        rack,
        rackKey,
        level: number(loc.nivel),
        cell: number(loc.posicion),
        depthSlot: number(loc.profundidad) || 1,
        measured,
        type: loc.tipo,
        condition: zone.condicion_almacenamiento,
        capacity: number(loc.capacidad_hu) || 1,
        occupied: number(loc.ocupacion_hu),
        available: number(loc.capacidad_disponible),
        units: number(loc.unidades_ocupadas),
        occupancyPercent: number(loc.porcentaje_ocupacion),
        active: Boolean(loc.activo),
        x: measured || !planned ? number(loc.layout_x) : planned.x,
        z: measured || !planned ? number(loc.layout_z) : planned.z,
        visualRackLevels: rackLevels.get(rackKey) || area.levels,
      };
    })
    .filter(Boolean);
  return {
    kind: "PLANO_CD1",
    physicalSurveyVerified: shapedLocations.every((loc) => loc.measured),
    note: "Plano operativo planificado; no equivale a un levantamiento topográfico. Confirma señalética y medidas antes de usarlo para guiado físico.",
    width: BUILDING.width,
    depth: BUILDING.depth,
    aisleWidth: BUILDING.aisleWidth,
    zones: shapedZones,
    locations: shapedLocations,
  };
}

module.exports = { plannedLayout };
