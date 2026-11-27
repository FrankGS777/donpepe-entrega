const Base = require("./BaseModel");
const { plannedLayout } = require("./warehouseLayout");

const toNumber = (value) => Number(value || 0);

/**
 * El layout usa la jerarquía real zona/pasillo/módulo/nivel/casillero.
 * X/Z solo se consideran medidos cuando layout_verificado=1; el resto conserva
 * una distribución esquemática y nunca decide físicamente un traslado.
 */
function schematicLayout(zones, locations) {
  const byZone = new Map();
  zones.forEach((zone) => byZone.set(Number(zone.id), []));
  locations.forEach((loc) => {
    const group = byZone.get(Number(loc.zona_id));
    if (group) group.push(loc);
  });

  const shapedZones = zones.map((zone) => {
    const aisleMap = new Map();
    (byZone.get(Number(zone.id)) || []).forEach((loc) => {
      const aisle = String(loc.pasillo || "SIN PASILLO");
      if (!aisleMap.has(aisle)) aisleMap.set(aisle, []);
      aisleMap.get(aisle).push(loc);
    });
    const aisles = [...aisleMap.entries()].sort(([a], [b]) =>
      a.localeCompare(b, "es", { numeric: true }),
    );
    aisles.forEach(([, rows]) =>
      rows.sort(
        (a, b) =>
          Number(a.estante) - Number(b.estante) ||
          Number(a.nivel) - Number(b.nivel) ||
          Number(a.posicion) - Number(b.posicion),
      ),
    );
    return {
      ...zone,
      aisles,
      width: Math.max(17, aisles.length * 5 + 5),
      depth: Math.max(
        13,
        Math.max(
          0,
          ...aisles.map(
            ([, rows]) => new Set(rows.map((loc) => String(loc.estante))).size,
          ),
        ) *
          4.2 +
          6,
      ),
    };
  });

  const rows = [];
  for (let i = 0; i < shapedZones.length; i += 3)
    rows.push(shapedZones.slice(i, i + 3));
  let zOffset = 0;
  const layoutZones = [];
  const layoutLocations = [];
  rows.forEach((row) => {
    const rowDepth = Math.max(...row.map((zone) => zone.depth));
    let xOffset = 0;
    row.forEach((zone) => {
      const x = xOffset + zone.width / 2;
      const z = zOffset + rowDepth / 2;
      layoutZones.push({
        id: Number(zone.id),
        code: zone.codigo_zona,
        name: zone.nombre,
        purpose: zone.proposito,
        condition: zone.condicion_almacenamiento,
        x,
        z,
        width: zone.width,
        depth: rowDepth,
        aisleCount: zone.aisles.length,
      });
      zone.aisles.forEach(([aisle, locs], aisleIndex) => {
        const aisleX = x - zone.width / 2 + 4 + aisleIndex * 5;
        const moduleKeys = [...new Set(locs.map((loc) => String(loc.estante)))];
        locs.forEach((loc) => {
          const rackIndex = moduleKeys.indexOf(String(loc.estante));
          const measured =
            Boolean(loc.layout_verificado) &&
            loc.layout_x != null &&
            loc.layout_z != null;
          layoutLocations.push({
            id: Number(loc.ubicacion_id),
            code: loc.codigo_loc,
            zoneId: Number(zone.id),
            zone: zone.nombre,
            zoneCode: zone.codigo_zona,
            aisle,
            rack: loc.estante,
            rackKey: `${zone.id}|${aisle}|${loc.estante}`,
            level: Math.max(1, Number(loc.nivel) || 1),
            cell: Math.max(1, Number(loc.posicion) || 1),
            measured,
            type: loc.tipo,
            condition: loc.condicion_almacenamiento || "AMBIENTE",
            capacity: toNumber(loc.capacidad_unidades),
            occupied: toNumber(loc.unidades_ocupadas),
            available: toNumber(loc.capacidad_disponible),
            occupancyPercent: toNumber(loc.porcentaje_ocupacion),
            active: Boolean(loc.activo),
            x: measured ? Number(loc.layout_x) : aisleX,
            z: measured
              ? Number(loc.layout_z)
              : z - rowDepth / 2 + 4.5 + rackIndex * 4.2,
            visualRackLevels: Math.max(
              3,
              ...locs
                .filter((item) => String(item.estante) === String(loc.estante))
                .map((item) => Number(item.nivel) || 1),
            ),
          });
        });
      });
      xOffset += zone.width + 4;
    });
    zOffset += rowDepth + 4;
  });
  const width = Math.max(
    0,
    ...rows.map((row) => row.reduce((sum, zone) => sum + zone.width + 4, -4)),
    ...layoutLocations.map((loc) => loc.x + 4),
  );
  const depth = Math.max(
    0,
    zOffset - 4,
    ...layoutLocations.map((loc) => loc.z + 4),
  );
  const verified = layoutLocations.filter((loc) => loc.measured).length;
  return {
    kind:
      verified === layoutLocations.length && verified > 0
        ? "LEVANTAMIENTO"
        : verified
          ? "MIXTO"
          : "ESQUEMATICO",
    physicalSurveyVerified: verified === layoutLocations.length && verified > 0,
    note:
      verified === layoutLocations.length && verified > 0
        ? "Todas las LOC tienen coordenadas verificadas; cada celda corresponde a pasillo, módulo, nivel y casillero."
        : "Solo las LOC marcadas como medidas usan coordenadas reales. Las restantes son estimadas; comprueba físicamente antes de mover mercancía.",
    width,
    depth,
    zones: layoutZones,
    locations: layoutLocations,
  };
}

class WarehouseMap extends Base {
  static async data() {
    const [zones, locations, stock, tasks, latestTransfers] = await Promise.all(
      [
        this
          .query(`SELECT id,codigo_zona,nombre,proposito,condicion_almacenamiento,
        secuencia_operativa,plano_x,plano_z,ancho_m,fondo_m,estructura FROM zonas_almacen WHERE activo=1
        ORDER BY secuencia_operativa,id`),
        this.query(`SELECT * FROM vw_ocupacion_loc
        WHERE zona_id IN (SELECT id FROM zonas_almacen WHERE activo=1)
        ORDER BY zona_id,pasillo,estante,codigo_loc`),
        this.query(`SELECT ubicacion_id,lote_id,sku,producto,numero_lote,codigo_lote_wms,codigo_hu,
        cantidad_actual,estado_inventario,fecha_vencimiento
        FROM vw_stock_por_loc WHERE cantidad_actual>0
        ORDER BY ubicacion_id,producto,numero_lote`),
        this
          .query(`SELECT t.id,t.codigo_tarea,t.tipo,t.estado,t.prioridad,t.cantidad,
        t.ubicacion_origen_id originId,t.ubicacion_destino_id destinationId,
        p.sku,p.nombre product
        FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
        WHERE t.estado IN ('PENDIENTE','EN_PROCESO')
        ORDER BY FIELD(t.estado,'EN_PROCESO','PENDIENTE'),t.creado_en DESC
        LIMIT 150`),
        this.query(`SELECT locationId,MAX(completado_en) completedAt
        FROM (
          SELECT ubicacion_origen_id locationId,completado_en FROM tareas_almacen
          WHERE estado='COMPLETADA' AND completado_en IS NOT NULL
          UNION ALL
          SELECT ubicacion_destino_id locationId,completado_en FROM tareas_almacen
          WHERE estado='COMPLETADA' AND completado_en IS NOT NULL
        ) transferHistory GROUP BY locationId`),
      ],
    );
    const layout = plannedLayout(zones, locations);
    const stockByLocation = new Map();
    stock.forEach((item) => {
      const id = Number(item.ubicacion_id);
      if (!stockByLocation.has(id)) stockByLocation.set(id, []);
      stockByLocation.get(id).push({
        lotId: Number(item.lote_id),
        sku: item.sku,
        product: item.producto,
        lot: item.numero_lote,
        internalLot: item.codigo_lote_wms,
        handlingUnit: item.codigo_hu,
        quantity: toNumber(item.cantidad_actual),
        state: item.estado_inventario,
        expiry: item.fecha_vencimiento,
      });
    });
    const latest = new Map(
      latestTransfers.map((entry) => [
        Number(entry.locationId),
        entry.completedAt,
      ]),
    );
    layout.locations.forEach((location) => {
      location.stock = stockByLocation.get(location.id) || [];
      location.lastConfirmedTransfer = latest.get(location.id) || null;
    });
    return {
      generatedAt: new Date().toISOString(),
      layout,
      tasks: tasks.map((task) => ({
        id: Number(task.id),
        code: task.codigo_tarea,
        type: task.tipo,
        state: task.estado,
        priority: task.prioridad,
        quantity: toNumber(task.cantidad),
        originId: Number(task.originId),
        destinationId: Number(task.destinationId),
        sku: task.sku,
        product: task.product,
      })),
    };
  }
}

WarehouseMap.schematicLayout = schematicLayout;
module.exports = WarehouseMap;
