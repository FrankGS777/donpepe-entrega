const Base = require("./BaseModel");

class Wms extends Base {
  static positions({ q = "", zone = "", loc = "" } = {}) {
    const params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    let zoneSql = "";
    if (zone) {
      zoneSql = " AND (codigo_zona=? OR zona=?)";
      params.push(zone, zone);
    }
    if (loc) {
      zoneSql += " AND codigo_loc=?";
      params.push(loc);
    }
    return this.query(
      `SELECT * FROM vw_stock_por_loc
       WHERE (producto LIKE ? OR sku LIKE ? OR codigo_loc LIKE ? OR numero_lote LIKE ?
         OR codigo_lote_wms LIKE ?)${zoneSql}
       ORDER BY zona,secuencia_pick,codigo_loc,producto,fecha_vencimiento`,
      params,
    );
  }

  static occupancy({ zone = "", aisle = "", rack = "", level = "" } = {}) {
    if (!zone) return Promise.resolve([]);
    const params = [zone];
    let clause = "z.codigo_zona=?";
    if (aisle) {
      clause += " AND o.pasillo=?";
      params.push(aisle);
    }
    if (rack) {
      clause += " AND o.estante=?";
      params.push(rack);
    }
    if (level) {
      clause += " AND o.nivel=?";
      params.push(Number(level));
    }
    return this.query(
      `SELECT o.* FROM vw_ocupacion_loc o
      JOIN zonas_almacen z ON z.id=o.zona_id
      WHERE o.activo=1 AND o.modelo_plano='CD1' AND ${clause}
      ORDER BY o.pasillo,o.estante,o.nivel,o.posicion,o.profundidad LIMIT 80`,
      params,
    );
  }

  static locationByCode(code) {
    return this.one(
      "SELECT * FROM vw_ocupacion_loc WHERE codigo_loc=? AND activo=1",
      [code],
    );
  }

  static aisles(zone) {
    return this.query(
      `SELECT DISTINCT u.pasillo FROM ubicaciones_almacen u
      JOIN zonas_almacen z ON z.id=u.zona_id
      WHERE z.codigo_zona=? AND u.modelo_plano='CD1' AND u.activo=1 ORDER BY u.pasillo`,
      [zone],
    );
  }

  static racks(zone, aisle) {
    if (!zone || !aisle) return Promise.resolve([]);
    return this.query(
      `SELECT DISTINCT u.estante FROM ubicaciones_almacen u
      JOIN zonas_almacen z ON z.id=u.zona_id
      WHERE z.codigo_zona=? AND u.pasillo=? AND u.modelo_plano='CD1' AND u.activo=1
      ORDER BY u.estante`,
      [zone, aisle],
    );
  }

  static levels(zone, aisle, rack) {
    if (!zone || !aisle || !rack) return Promise.resolve([]);
    return this.query(
      `SELECT DISTINCT u.nivel FROM ubicaciones_almacen u
      JOIN zonas_almacen z ON z.id=u.zona_id
      WHERE z.codigo_zona=? AND u.pasillo=? AND u.estante=? AND u.modelo_plano='CD1' AND u.activo=1
      ORDER BY u.nivel`,
      [zone, aisle, rack],
    );
  }

  static zones() {
    return this.query(
      `SELECT z.id zona_id,z.codigo_zona,z.nombre zona,z.proposito,
        z.condicion_almacenamiento,z.descripcion,
        COUNT(o.ubicacion_id) locs,COALESCE(SUM(o.capacidad_hu),0) capacidad,
        COALESCE(SUM(o.ocupacion_hu),0) ocupadas,
        COALESCE(ROUND(SUM(o.ocupacion_hu)*100/NULLIF(SUM(o.capacidad_hu),0),1),0) ocupacion
       FROM zonas_almacen z LEFT JOIN vw_ocupacion_loc o ON o.zona_id=z.id AND o.activo=1
       WHERE z.activo=1 GROUP BY z.id ORDER BY z.secuencia_operativa,z.id`,
    );
  }

  static tasks({ status = "" } = {}) {
    const params = [];
    let where = "";
    if (
      ["PENDIENTE", "EN_PROCESO", "COMPLETADA", "CANCELADA"].includes(status)
    ) {
      where = "WHERE t.estado=?";
      params.push(status);
    }
    return this.query(
      `SELECT t.*,p.sku,p.nombre producto,l.numero_lote,
        ori.codigo_loc loc_origen,COALESCE(zo.nombre,ori.zona) zona_origen,
        dst.codigo_loc loc_destino,COALESCE(zd.nombre,dst.zona) zona_destino,
        a.nombre asignado,c.nombre creador
       FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
       JOIN lotes l ON l.id=t.lote_origen_id
       JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
       JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
       LEFT JOIN zonas_almacen zo ON zo.id=ori.zona_id
       LEFT JOIN zonas_almacen zd ON zd.id=dst.zona_id
       LEFT JOIN usuarios a ON a.id=t.asignado_a JOIN usuarios c ON c.id=t.creado_por
       ${where}
       ORDER BY FIELD(t.estado,'EN_PROCESO','PENDIENTE','COMPLETADA','CANCELADA'),
       FIELD(t.prioridad,'URGENTE','ALTA','NORMAL','BAJA'),t.creado_en DESC`,
      params,
    );
  }

  static operators() {
    return this.query(`SELECT u.id,u.nombre FROM usuarios u
      JOIN roles r ON r.id=u.rol_id
      WHERE u.activo=1 AND r.perfil='operador_rf' AND r.activo=1
      AND EXISTS (SELECT 1 FROM roles_permisos rp WHERE rp.rol_id=r.id AND rp.permiso='wms.tasks.execute') ORDER BY u.nombre`);
  }

  static tasksByTypes(types = [], { status = "", operatorId = null } = {}) {
    const safeTypes = types.filter((type) =>
      [
        "PUTAWAY",
        "PICKING",
        "REUBICACION",
        "REABASTECIMIENTO",
        "DEVOLUCION_RUTA",
      ].includes(type),
    );
    if (!safeTypes.length) return [];
    const params = [...safeTypes];
    let statusSql = "";
    if (
      ["PENDIENTE", "EN_PROCESO", "COMPLETADA", "CANCELADA"].includes(status)
    ) {
      statusSql = " AND t.estado=?";
      params.push(status);
    }
    if (operatorId) {
      statusSql += " AND t.asignado_a=?";
      params.push(operatorId);
    }
    return this.query(
      `SELECT t.*,p.sku,p.nombre producto,l.numero_lote,
        ori.codigo_loc loc_origen,COALESCE(zo.nombre,ori.zona) zona_origen,
        dst.codigo_loc loc_destino,COALESCE(zd.nombre,dst.zona) zona_destino,
        a.nombre asignado,c.nombre creador
       FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
       JOIN lotes l ON l.id=t.lote_origen_id
       JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
       JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
       LEFT JOIN zonas_almacen zo ON zo.id=ori.zona_id
       LEFT JOIN zonas_almacen zd ON zd.id=dst.zona_id
       LEFT JOIN usuarios a ON a.id=t.asignado_a JOIN usuarios c ON c.id=t.creado_por
       WHERE t.tipo IN (${safeTypes.map(() => "?").join(",")})${statusSql}
       ORDER BY FIELD(t.estado,'EN_PROCESO','PENDIENTE','COMPLETADA','CANCELADA'),
       FIELD(t.prioridad,'URGENTE','ALTA','NORMAL','BAJA'),t.creado_en DESC`,
      params,
    );
  }

  static task(id) {
    return this.one(
      `SELECT t.*,p.sku,p.codigo_barras,p.nombre producto,p.imagen_url,p.control_lote,l.numero_lote,
       l.lote_fabricante_id,CONCAT('L-',LPAD(l.lote_fabricante_id,6,'0')) codigo_lote_wms,hu.codigo_hu,
       l.estado_inventario,ori.codigo_loc loc_origen,
       COALESCE(zo.nombre,ori.zona) zona_origen,ori.tipo tipo_origen,
       dst.codigo_loc loc_destino,COALESCE(zd.nombre,dst.zona) zona_destino,
       dst.tipo tipo_destino,a.nombre asignado,c.nombre creador
       FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
       JOIN lotes l ON l.id=t.lote_origen_id
       LEFT JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
       JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
       JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
       LEFT JOIN zonas_almacen zo ON zo.id=ori.zona_id
       LEFT JOIN zonas_almacen zd ON zd.id=dst.zona_id
       LEFT JOIN usuarios a ON a.id=t.asignado_a
       JOIN usuarios c ON c.id=t.creado_por WHERE t.id=? LIMIT 1`,
      [id],
    );
  }

  static taskOptions() {
    return Promise.all([
      this
        .query(`SELECT l.id,l.producto_id,p.sku,p.nombre producto,p.codigo_barras,
        p.imagen_url,p.referencia_url,p.clase_abc,p.control_vencimiento,l.fecha_vencimiento,
        l.fecha_vencimiento<CURRENT_DATE vencido,
        c.nombre categoria,m.nombre marca,pr.razon_social proveedor,l.numero_lote,
        l.cantidad_actual,l.estado_inventario,l.ubicacion_id,
        GREATEST(l.cantidad_actual-COALESCE((SELECT SUM(t.cantidad)
          FROM tareas_almacen t WHERE t.lote_origen_id=l.id
          AND t.estado IN ('PENDIENTE','EN_PROCESO')),0),0) disponible_planificable,
        u.codigo_loc,COALESCE(z.nombre,u.zona) zona,u.tipo,u.permite_recepcion,u.permite_picking,
        p.ubicacion_picking_id,p.stock_objetivo_pick,pl.codigo_loc loc_picking,
        pz.condicion_almacenamiento condicion_requerida,
        COALESCE((SELECT SUM(lp.cantidad_actual) FROM lotes lp
          JOIN ubicaciones_almacen up ON up.id=lp.ubicacion_id
          WHERE lp.producto_id=p.id AND up.tipo='PICKING' AND up.activo=1
          AND lp.estado_inventario='DISPONIBLE'
          AND (p.control_vencimiento=0 OR lp.fecha_vencimiento>=CURRENT_DATE)),0) stock_pick,
        GREATEST(p.stock_objetivo_pick-COALESCE((SELECT SUM(lp.cantidad_actual)
          FROM lotes lp JOIN ubicaciones_almacen up ON up.id=lp.ubicacion_id
          WHERE lp.producto_id=p.id AND up.tipo='PICKING' AND up.activo=1
          AND lp.estado_inventario='DISPONIBLE'
          AND (p.control_vencimiento=0 OR lp.fecha_vencimiento>=CURRENT_DATE)),0),0) deficit_pick
        FROM lotes l JOIN productos p ON p.id=l.producto_id
        LEFT JOIN categorias c ON c.id=p.categoria_id
        LEFT JOIN marcas m ON m.id=p.marca_id
        LEFT JOIN proveedores pr ON pr.id=p.proveedor_id
        JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
        LEFT JOIN ubicaciones_almacen pl ON pl.id=p.ubicacion_picking_id
        LEFT JOIN zonas_almacen z ON z.id=u.zona_id
        LEFT JOIN zonas_almacen pz ON pz.id=pl.zona_id
        WHERE l.cantidad_actual>0 AND u.activo=1
        ORDER BY u.permite_picking,u.zona,u.codigo_loc,p.nombre,l.fecha_vencimiento`),
      this
        .query(`SELECT u.id,u.codigo_loc,COALESCE(z.nombre,u.zona) zona,z.codigo_zona,
        u.pasillo,u.estante,u.nivel,u.posicion,u.profundidad,u.tipo,u.capacidad_hu,
        z.condicion_almacenamiento,z.clase_abc,
        u.permite_picking,u.secuencia_putaway,
        (SELECT p.id FROM productos p WHERE p.ubicacion_picking_id=u.id AND p.activo=1 LIMIT 1) picking_owner_id,
        COALESCE(SUM(l.cantidad_actual>0),0) ocupadas,
        GREATEST(u.capacidad_hu-COALESCE(SUM(l.cantidad_actual>0),0)-
          COALESCE((SELECT COUNT(*) FROM tareas_almacen t
            WHERE t.ubicacion_destino_id=u.id AND t.estado IN ('PENDIENTE','EN_PROCESO')),0),0) capacidad_libre
        FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
        LEFT JOIN lotes l ON l.ubicacion_id=u.id
        WHERE u.activo=1 AND u.permite_almacenaje=1 GROUP BY u.id,z.id
        ORDER BY u.permite_picking DESC,u.secuencia_putaway,u.codigo_loc`),
      this.operators(),
    ]).then(([positions, destinations, operators]) => ({ positions, destinations, operators }));
  }

  static pendingPurchaseOrders() {
    return this.query(
      `SELECT oc.id,oc.codigo_orden,oc.fecha_emision,oc.estado,p.razon_social proveedor,
        COUNT(d.id) lineas,SUM(d.cantidad_solicitada-d.cantidad_recibida) unidades
       FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id
       JOIN ordenes_compra_detalle d ON d.orden_id=oc.id
       WHERE oc.estado IN ('PENDIENTE','PARCIAL')
       GROUP BY oc.id ORDER BY oc.fecha_emision LIMIT 12`,
    );
  }

  static countingQueue() {
    return this.query(
      `SELECT o.*,COUNT(sp.lote_id) posiciones
       FROM vw_ocupacion_loc o LEFT JOIN vw_stock_por_loc sp ON sp.ubicacion_id=o.ubicacion_id
       WHERE o.activo=1 AND o.tipo<>'RECEPCION'
       GROUP BY o.ubicacion_id
       ORDER BY o.porcentaje_ocupacion DESC,o.codigo_loc LIMIT 12`,
    );
  }

  static labelData() {
    return Promise.all([
      this.query(
        `SELECT p.id,p.sku,p.codigo_barras,p.nombre,c.nombre categoria,m.nombre marca
         FROM productos p JOIN categorias c ON c.id=p.categoria_id
         JOIN marcas m ON m.id=p.marca_id
         WHERE p.activo=1 ORDER BY p.nombre LIMIT 300`,
      ),
      this.query(
        `SELECT l.id,p.sku,p.nombre producto,l.numero_lote,
         CONCAT('L-',LPAD(l.lote_fabricante_id,6,'0')) codigo_lote_wms,l.cantidad_actual,
         l.fecha_vencimiento,u.codigo_loc,COALESCE(z.nombre,u.zona) zona
         FROM lotes l JOIN productos p ON p.id=l.producto_id
         JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
         LEFT JOIN zonas_almacen z ON z.id=u.zona_id
         WHERE l.cantidad_actual>0 ORDER BY l.creado_en DESC LIMIT 300`,
      ),
      this.query(
        `SELECT u.id,u.codigo_loc,COALESCE(z.nombre,u.zona) zona,u.tipo,u.capacidad_hu
         FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
         WHERE u.activo=1 ORDER BY z.secuencia_operativa,u.codigo_loc`,
      ),
    ]).then(([products, lots, locations]) => ({ products, lots, locations }));
  }

  static async scanLookup(code = "") {
    const scan = require("../utils/scanCode").parseScan(code);
    const term = scan.term;
    if (!term) return null;
    const [location, product, lot, task, hu] = await Promise.all([
      this.one(
        `SELECT 'LOC' tipo,u.codigo_loc codigo,COALESCE(z.nombre,u.zona) titulo,
         CONCAT(u.tipo,' · ',IF(EXISTS(SELECT 1 FROM lotes l WHERE l.ubicacion_id=u.id AND l.cantidad_actual>0),'ocupada','libre')) detalle
         FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
         WHERE u.codigo_loc=? LIMIT 1`,
        [term],
      ),
      this.one(
        `SELECT 'SKU' tipo,p.sku codigo,p.sku,p.codigo_barras,p.imagen_url,p.nombre titulo,
         CONCAT('EAN ',COALESCE(p.codigo_barras,'N/D'),' · stock ',p.stock_total,' UND') detalle
         FROM productos p WHERE p.sku=? OR p.codigo_barras=? LIMIT 1`,
        [scan.sku || term, scan.ean || term],
      ),
      this.one(
        `SELECT 'LOTE' tipo,CONCAT('L-',LPAD(l.lote_fabricante_id,6,'0')) codigo,p.sku,p.codigo_barras,p.imagen_url,l.numero_lote,p.nombre titulo,
         CONCAT(p.sku,' · fabricante ',l.numero_lote,' · ',u.codigo_loc,' · ',l.cantidad_actual,' UND') detalle
         FROM lotes l JOIN productos p ON p.id=l.producto_id
         JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
         WHERE (l.numero_lote=? OR CONCAT('L-',LPAD(l.lote_fabricante_id,6,'0'))=?)
         AND (?='' OR p.sku=?) AND (?='' OR p.codigo_barras=?)
         ORDER BY l.cantidad_actual DESC,l.id LIMIT 1`,
        [term, term, scan.sku, scan.sku, scan.ean, scan.ean],
      ),
      this.one(
        `SELECT 'TAREA' tipo,t.codigo_tarea codigo,p.nombre titulo,
         CONCAT(t.tipo,' · ',t.estado,' · ',t.cantidad,' UND') detalle
         FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
         WHERE t.codigo_tarea=? LIMIT 1`,
        [term],
      ),
      this.one(
        `SELECT 'HU' tipo,hu.codigo_hu codigo,p.sku,p.codigo_barras,p.imagen_url,l.numero_lote,p.nombre titulo,
          CONCAT(hu.tipo,' · ',u.codigo_loc,' · ',l.cantidad_actual,' UND · ',l.estado_inventario) detalle
         FROM unidades_logisticas hu JOIN lotes l ON l.unidad_logistica_id=hu.id
         JOIN productos p ON p.id=l.producto_id JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
         WHERE hu.codigo_hu=? ORDER BY l.cantidad_actual DESC,l.id LIMIT 1`,
        [term],
      ),
    ]);
    const result = location || hu || lot || product || task || null;
    if (result && scan.lot && product && !lot)
      return {
        ...product,
        tipo: "ETIQUETA_RECEPCION",
        numero_lote: scan.lot,
        detalle: `${product.detalle} · lote ${scan.lot}${scan.expiry ? ` · vence ${scan.expiry}` : ""}`,
      };
    return result;
  }

  static async rfSummary(operatorId) {
    const [tasks, purchases, counts, zones, nextTask] = await Promise.all([
      this.one(
        `SELECT COUNT(*) total,
        SUM(tipo='PUTAWAY' AND estado='PENDIENTE') putaway,
        SUM(tipo='PICKING' AND estado='PENDIENTE') picking,
        SUM(tipo IN ('REUBICACION','REABASTECIMIENTO') AND estado='PENDIENTE') transferencias,
        SUM(tipo='DEVOLUCION_RUTA' AND estado='PENDIENTE') devoluciones,
        SUM(estado='EN_PROCESO') en_proceso
        FROM tareas_almacen WHERE asignado_a=?`,
        [operatorId],
      ),
      this.one(
        "SELECT COUNT(*) pendientes FROM ordenes_compra WHERE estado IN ('PENDIENTE','PARCIAL')",
      ),
      this.one(
        "SELECT COUNT(*) pendientes FROM inventarios_auditoria WHERE estado='PENDIENTE'",
      ),
      this.zones(),
      this.one(`SELECT t.id,t.tipo,t.estado,t.codigo_tarea,p.nombre producto
        FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
        WHERE t.asignado_a=? AND t.estado IN ('EN_PROCESO','PENDIENTE')
        ORDER BY FIELD(t.estado,'EN_PROCESO','PENDIENTE'),
          FIELD(t.prioridad,'URGENTE','ALTA','NORMAL','BAJA'),t.creado_en LIMIT 1`, [operatorId]),
    ]);
    return { tasks, purchases, counts, zones, nextTask };
  }

  static async summary() {
    const [tasks, zones, replenishment] = await Promise.all([
      this.one(`SELECT COUNT(*) total,
        SUM(estado='PENDIENTE') pendientes,SUM(estado='EN_PROCESO') en_proceso,
        SUM(estado='COMPLETADA' AND DATE(completado_en)=CURRENT_DATE) completadas_hoy
        FROM tareas_almacen`),
      this.zones(),
      this
        .query(`SELECT p.id,p.sku,p.nombre,pl.codigo_loc loc_picking,p.stock_objetivo_pick,
        COALESCE(SUM(CASE WHEN l.ubicacion_id=p.ubicacion_picking_id THEN l.cantidad_actual ELSE 0 END),0) stock_pick,
        COALESCE(SUM(CASE WHEN l.ubicacion_id<>p.ubicacion_picking_id AND ul.permite_almacenaje=1 THEN l.cantidad_actual ELSE 0 END),0) stock_reserva
        FROM productos p JOIN ubicaciones_almacen pl ON pl.id=p.ubicacion_picking_id
        LEFT JOIN lotes l ON l.producto_id=p.id LEFT JOIN ubicaciones_almacen ul ON ul.id=l.ubicacion_id
        WHERE p.activo=1 AND p.stock_objetivo_pick>0 GROUP BY p.id
        HAVING stock_pick<stock_objetivo_pick AND stock_reserva>0
        ORDER BY (stock_objetivo_pick-stock_pick) DESC LIMIT 8`),
    ]);
    return { tasks, zones, replenishment };
  }
}

module.exports = Wms;
