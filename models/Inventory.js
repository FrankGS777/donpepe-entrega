const Base = require("./BaseModel");

class Inventory extends Base {
  static lots({ q = "", state = "", zone = "" } = {}) {
    const params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    let filters = "";
    if (["DISPONIBLE", "CUARENTENA", "BLOQUEADO"].includes(state)) {
      filters += " AND l.estado_inventario=?";
      params.push(state);
    }
    if (zone) {
      filters += " AND COALESCE(z.nombre,u.zona)=?";
      params.push(zone);
    }
    return this.query(
      `SELECT l.*,hu.codigo_hu,b.fecha_verificada,b.requiere_revision,
    p.sku,p.nombre producto,u.codigo_loc,COALESCE(z.nombre,u.zona) zona,
    u.pasillo,u.estante,u.tipo tipo_loc,z.condicion_almacenamiento,oc.codigo_orden,
    DATEDIFF(l.fecha_vencimiento,CURRENT_DATE) dias_restantes
    FROM lotes l JOIN productos p ON p.id=l.producto_id JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
    LEFT JOIN zonas_almacen z ON z.id=u.zona_id
    LEFT JOIN ordenes_compra oc ON oc.id=l.orden_compra_id
    LEFT JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
    LEFT JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
    WHERE (p.sku LIKE ? OR p.nombre LIKE ? OR l.numero_lote LIKE ? OR u.codigo_loc LIKE ?
      OR COALESCE(hu.codigo_hu,'') LIKE ?)${filters}
    ORDER BY (l.fecha_vencimiento IS NULL),l.fecha_vencimiento,l.id`,
      params,
    );
  }
  static movements({ q = "", type = "" } = {}) {
    const params = [`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
    let typeSql = "";
    if (["ENTRADA", "SALIDA"].includes(type)) {
      typeSql = " AND ma.tipo_movimiento=?";
      params.push(type);
    }
    return this.query(
      `SELECT ma.*,p.sku,p.nombre producto,u.nombre usuario,l.numero_lote,loc.codigo_loc FROM movimientos_almacen ma
    JOIN productos p ON p.id=ma.producto_id JOIN usuarios u ON u.id=ma.usuario_id LEFT JOIN lotes l ON l.id=ma.lote_id
    LEFT JOIN ubicaciones_almacen loc ON loc.id=l.ubicacion_id
    WHERE (p.sku LIKE ? OR p.nombre LIKE ? OR COALESCE(l.numero_lote,'') LIKE ? OR COALESCE(ma.motivo,'') LIKE ?)${typeSql}
    ORDER BY ma.creado_en DESC LIMIT 300`,
      params,
    );
  }
  static audits({ status = "" } = {}) {
    const params = [];
    let statusSql = "";
    if (["PENDIENTE", "APROBADA", "RECHAZADA"].includes(status)) {
      statusSql = "WHERE ia.estado=?";
      params.push(status);
    }
    return this.query(
      `SELECT ia.*,p.sku,p.nombre producto,u.nombre usuario,ap.nombre aprobador,
    ua.codigo_loc,COALESCE(za.nombre,ua.zona) zona,ua.pasillo,ua.estante FROM inventarios_auditoria ia
    JOIN productos p ON p.id=ia.producto_id JOIN usuarios u ON u.id=ia.usuario_id
    LEFT JOIN usuarios ap ON ap.id=ia.aprobado_por LEFT JOIN ubicaciones_almacen ua ON ua.id=ia.ubicacion_id
    LEFT JOIN zonas_almacen za ON za.id=ua.zona_id
    ${statusSql} ORDER BY (ia.estado='PENDIENTE') DESC,ia.fecha_auditoria DESC`,
      params,
    );
  }
  static countingMatrix() {
    return this.query(`SELECT l.producto_id,l.ubicacion_id,b.codigo_lote,
      SUM(l.cantidad_actual) stock_sistema
      FROM lotes l JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
      JOIN productos p ON p.id=l.producto_id
      JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
      WHERE p.activo=1 AND u.activo=1 AND u.permite_conteo=1
      GROUP BY l.producto_id,l.ubicacion_id,b.codigo_lote
      ORDER BY l.producto_id,l.ubicacion_id,b.codigo_lote`);
  }
  static health() {
    return this.query(
      "SELECT * FROM vw_stock_comparado ORDER BY (diferencia<>0) DESC,ABS(diferencia) DESC,nombre",
    );
  }
}
module.exports = Inventory;
