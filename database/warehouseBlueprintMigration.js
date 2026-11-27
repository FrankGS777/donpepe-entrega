const { pool } = require("../config/db");
const { AREAS, allBins } = require("../config/warehouseBlueprint");

async function hasColumn(table, column) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?`,
    [table, column],
  );
  return rows.length > 0;
}

async function addColumn(table, column, definition) {
  if (!(await hasColumn(table, column)))
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function ensureBlueprintColumns() {
  await addColumn("zonas_almacen", "plano_x", "DECIMAL(8,2) NULL");
  await addColumn("zonas_almacen", "plano_z", "DECIMAL(8,2) NULL");
  await addColumn("zonas_almacen", "ancho_m", "DECIMAL(8,2) NULL");
  await addColumn("zonas_almacen", "fondo_m", "DECIMAL(8,2) NULL");
  await addColumn("zonas_almacen", "estructura", "VARCHAR(24) NULL");
  await addColumn("ubicaciones_almacen", "profundidad", "TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER posicion");
  await addColumn("ubicaciones_almacen", "capacidad_hu", "TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER capacidad_unidades");
  await addColumn("ubicaciones_almacen", "modelo_plano", "VARCHAR(12) NOT NULL DEFAULT 'LEGADO' AFTER activo");
  const [code] = await pool.query(`SELECT CHARACTER_MAXIMUM_LENGTH longitud FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='ubicaciones_almacen' AND COLUMN_NAME='codigo_loc'`);
  if (Number(code[0]?.longitud) < 48)
    await pool.query("ALTER TABLE ubicaciones_almacen MODIFY COLUMN codigo_loc VARCHAR(48) NOT NULL");
  const [index] = await pool.query(`SELECT GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) columnas
    FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME='ubicaciones_almacen' AND INDEX_NAME='unica_ubicacion'`);
  if (index[0]?.columnas !== "modelo_plano,zona_id,pasillo,estante,nivel,posicion,profundidad") {
    if (index[0]?.columnas)
      await pool.query("ALTER TABLE ubicaciones_almacen DROP INDEX unica_ubicacion");
    await pool.query(`ALTER TABLE ubicaciones_almacen ADD UNIQUE KEY unica_ubicacion
      (modelo_plano,zona_id,pasillo,estante,nivel,posicion,profundidad)`);
  }
}

async function generateBins() {
  const [zones] = await pool.query("SELECT id,codigo_zona,nombre FROM zonas_almacen");
  if (!zones.length) return;
  const zoneByCode = new Map(zones.map((zone) => [zone.codigo_zona, zone]));
  for (const area of AREAS) {
    const zone = zoneByCode.get(area.code);
    if (!zone) continue;
    await pool.execute(
      `UPDATE zonas_almacen SET plano_x=?,plano_z=?,ancho_m=?,fondo_m=?,estructura=? WHERE id=?`,
      [area.x, area.z, area.width, area.depth, area.structure, zone.id],
    );
  }
  const bins = allBins().filter((bin) => zoneByCode.has(bin.zone));
  const fields = `(codigo_loc,zona_id,zona,pasillo,estante,nivel,posicion,profundidad,
    layout_x,layout_z,layout_verificado,tipo,capacidad_unidades,capacidad_hu,
    secuencia_putaway,secuencia_pick,permite_recepcion,permite_almacenaje,
    permite_picking,permite_conteo,activo,modelo_plano)`;
  const flags = {
    RECEPCION: [1, 0, 0], RESERVA: [0, 1, 0], PICKING: [0, 1, 1],
    CUARENTENA: [1, 1, 0], DESPACHO: [0, 1, 0],
  };
  for (let start = 0; start < bins.length; start += 100) {
    const group = bins.slice(start, start + 100);
    const params = group.flatMap((bin) => {
      const zone = zoneByCode.get(bin.zone);
      const [receive, store, pick] = flags[bin.type];
      const sequence = zone.id * 1000000 + bin.pickSequence;
      return [bin.code, zone.id, zone.nombre, bin.aisle, bin.rack, bin.level,
        bin.cell, bin.depthSlot, bin.x, bin.z, 0, bin.type, 10000000, 1,
        sequence, sequence, receive, store, pick, 1, 1, "CD1"];
    });
    await pool.execute(`INSERT IGNORE INTO ubicaciones_almacen ${fields} VALUES ${group
      .map(() => `(${Array(22).fill("?").join(",")})`).join(",")}`, params);
  }
}

// Las direcciones heredadas permanecen para el kardex histórico. Solo se
// trasladan posiciones positivas y tareas abiertas; no hay DELETE ni cascada.
async function relocateLegacyStock() {
  const [bins] = await pool.query(`SELECT u.id,u.zona_id,u.tipo,u.codigo_loc,u.secuencia_putaway,
      COALESCE(SUM(CASE WHEN l.cantidad_actual>0 THEN 1 ELSE 0 END),0) ocupada
    FROM ubicaciones_almacen u LEFT JOIN lotes l ON l.ubicacion_id=u.id
    WHERE u.modelo_plano='CD1' AND u.activo=1
    GROUP BY u.id ORDER BY u.secuencia_putaway,u.id`);
  if (!bins.length) return;
  const [planned] = await pool.query(`SELECT ubicacion_destino_id id FROM tareas_almacen
    WHERE estado IN ('PENDIENTE','EN_PROCESO')`);
  const used = new Set([...bins.filter((bin) => Number(bin.ocupada)>0).map((bin) => Number(bin.id)),
    ...planned.map((row) => Number(row.id))]);
  const candidates = (zoneId, type) => bins.filter((bin) =>
    Number(bin.zona_id) === Number(zoneId) && bin.tipo === type && !used.has(Number(bin.id)));
  const take = (zoneId, type, preferredId = null) => {
    const available = candidates(zoneId, type);
    const selected = available.find((bin) => Number(bin.id) === Number(preferredId)) || available[0];
    if (!selected) throw new Error(`Plano CD1 sin LOC libre: zona ${zoneId}, perfil ${type}`);
    used.add(Number(selected.id));
    return selected;
  };

  const [products] = await pool.query(`SELECT p.id,p.ubicacion_picking_id,u.zona_id,u.tipo,u.modelo_plano
    FROM productos p JOIN ubicaciones_almacen u ON u.id=p.ubicacion_picking_id
    WHERE u.modelo_plano='LEGADO' ORDER BY p.id`);
  const pickBinByProduct = new Map();
  for (const product of products) {
    const destination = take(product.zona_id, "PICKING");
    pickBinByProduct.set(Number(product.id), destination);
    await pool.execute("UPDATE productos SET ubicacion_picking_id=? WHERE id=?", [destination.id, product.id]);
  }
  // Los bins de picking asignados quedan reservados para el SKU propietario.
  const assignedPickIds = new Set([...pickBinByProduct.values()].map((bin) => Number(bin.id)));
  const [positions] = await pool.query(`SELECT l.id,l.producto_id,l.unidad_logistica_id,l.cantidad_actual,
      u.zona_id,u.tipo FROM lotes l JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
      WHERE u.modelo_plano='LEGADO' AND l.cantidad_actual>0 ORDER BY u.tipo='PICKING' DESC,l.id`);
  for (const position of positions) {
    const preferred = position.tipo === "PICKING" ? pickBinByProduct.get(Number(position.producto_id)) : null;
    let destination;
    if (preferred && assignedPickIds.has(Number(preferred.id))) {
      destination = preferred;
      assignedPickIds.delete(Number(preferred.id));
    } else destination = take(position.zona_id, position.tipo);
    if (preferred && Number(destination.id) === Number(preferred.id)) used.add(Number(destination.id));
    await pool.execute("UPDATE lotes SET ubicacion_id=? WHERE id=?", [destination.id, position.id]);
    if (!position.unidad_logistica_id) {
      const code = `HU-CD1-${String(position.id).padStart(6, "0")}`;
      await pool.execute(`INSERT IGNORE INTO unidades_logisticas (codigo_hu,tipo,referencia)
        VALUES (?,?,?)`, [code, position.tipo === "DESPACHO" ? "PEDIDO" : position.tipo === "PICKING" ? "CAJA" : "PALLET", "Migración CD1"]);
      await pool.execute(`UPDATE lotes SET unidad_logistica_id=(SELECT id FROM unidades_logisticas WHERE codigo_hu=?)
        WHERE id=?`, [code, position.id]);
    }
  }
  const [tasks] = await pool.query(`SELECT t.id,t.tipo,t.producto_id,t.lote_origen_id,
      dst.zona_id,dst.tipo tipo_destino,dst.modelo_plano modelo_destino
    FROM tareas_almacen t JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
    WHERE t.estado IN ('PENDIENTE','EN_PROCESO') ORDER BY t.id`);
  for (const task of tasks) {
    const [[origin]] = await pool.execute("SELECT ubicacion_id FROM lotes WHERE id=?", [task.lote_origen_id]);
    if (origin)
      await pool.execute("UPDATE tareas_almacen SET ubicacion_origen_id=? WHERE id=?", [origin.ubicacion_id, task.id]);
    if (task.modelo_destino === "CD1") continue;
    const destination = take(task.zona_id, task.tipo_destino);
    await pool.execute("UPDATE tareas_almacen SET ubicacion_destino_id=? WHERE id=?", [destination.id, task.id]);
  }
  await pool.query(`UPDATE ubicaciones_almacen u SET u.activo=0
    WHERE u.modelo_plano='LEGADO'
    AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.ubicacion_id=u.id AND l.cantidad_actual>0)
    AND NOT EXISTS (SELECT 1 FROM tareas_almacen t WHERE t.estado IN ('PENDIENTE','EN_PROCESO')
      AND (t.ubicacion_origen_id=u.id OR t.ubicacion_destino_id=u.id))`);
}

async function migrateWarehouseBlueprint() {
  await ensureBlueprintColumns();
  await generateBins();
  await relocateLegacyStock();
  const [unlabeled] = await pool.query(`SELECT l.id,u.tipo FROM lotes l
    JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
    WHERE u.modelo_plano='CD1' AND l.cantidad_actual>0 AND l.unidad_logistica_id IS NULL`);
  for (const position of unlabeled) {
    const code = `HU-CD1-${String(position.id).padStart(6, "0")}`;
    await pool.execute(`INSERT IGNORE INTO unidades_logisticas (codigo_hu,tipo,referencia)
      VALUES (?,?,?)`, [code, position.tipo === "DESPACHO" ? "PEDIDO" : position.tipo === "PICKING" ? "CAJA" : "PALLET", "Identificación de posición CD1"]);
    await pool.execute(`UPDATE lotes SET unidad_logistica_id=
      (SELECT id FROM unidades_logisticas WHERE codigo_hu=?) WHERE id=? AND unidad_logistica_id IS NULL`,
      [code, position.id]);
  }
}

module.exports = { migrateWarehouseBlueprint, ensureBlueprintColumns, generateBins, relocateLegacyStock };
