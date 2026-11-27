const Base = require("./BaseModel");

class Dashboard extends Base {
  static async summary() {
    const [
      stats,
      daily,
      categories,
      movements,
      critical,
      taskStatus,
      hotLocations,
    ] = await Promise.all([
      this.one(`SELECT COUNT(*) productos,COALESCE(SUM(stock_total),0) unidades,
        COALESCE(SUM(stock_total*precio_compra),0) valor_stock,
        SUM(stock_total<=stock_minimo AND activo=1) alertas,
        (SELECT COUNT(*) FROM inventarios_auditoria WHERE estado='PENDIENTE') auditorias_pendientes,
        (SELECT COUNT(*) FROM tareas_almacen WHERE estado='PENDIENTE') tareas_pendientes,
        (SELECT COUNT(*) FROM tareas_almacen WHERE estado='EN_PROCESO') tareas_en_proceso,
        (SELECT COUNT(*) FROM lotes WHERE cantidad_actual>0 AND fecha_vencimiento<=CURRENT_DATE+INTERVAL 30 DAY) lotes_por_vencer,
        (SELECT COUNT(*) FROM ordenes_compra WHERE estado IN ('PENDIENTE','PARCIAL')) recepciones_pendientes
        FROM productos WHERE activo=1`),
      this.query(`SELECT DATE(creado_en) fecha,
        SUM(CASE WHEN tipo_movimiento='ENTRADA' THEN cantidad ELSE 0 END) entradas,
        SUM(CASE WHEN tipo_movimiento='SALIDA' THEN cantidad ELSE 0 END) salidas
        FROM movimientos_almacen
        WHERE creado_en>=CURRENT_DATE-INTERVAL 6 DAY GROUP BY DATE(creado_en) ORDER BY fecha`),
      this.query(
        `SELECT c.nombre,COALESCE(SUM(p.stock_total),0) stock FROM categorias c LEFT JOIN productos p ON p.categoria_id=c.id GROUP BY c.id ORDER BY stock DESC`,
      ),
      this
        .query(`SELECT ma.*,p.nombre producto,u.nombre usuario FROM movimientos_almacen ma JOIN productos p ON p.id=ma.producto_id
        JOIN usuarios u ON u.id=ma.usuario_id ORDER BY ma.creado_en DESC LIMIT 8`),
      this.query(
        `SELECT id,nombre,stock_total,stock_minimo FROM productos WHERE activo=1 AND stock_total<=stock_minimo ORDER BY stock_total LIMIT 8`,
      ),
      this
        .query(`SELECT estado,COUNT(*) tareas,COALESCE(SUM(cantidad),0) unidades
        FROM tareas_almacen GROUP BY estado
        ORDER BY FIELD(estado,'PENDIENTE','EN_PROCESO','COMPLETADA','CANCELADA')`),
      this
        .query(`SELECT zona,codigo_loc,tipo,unidades_ocupadas,ocupacion_hu,capacidad_hu,porcentaje_ocupacion
        FROM vw_ocupacion_loc WHERE activo=1 AND modelo_plano='CD1'
        ORDER BY porcentaje_ocupacion DESC LIMIT 5`),
    ]);
    return {
      stats,
      daily,
      categories,
      movements,
      critical,
      taskStatus,
      hotLocations,
    };
  }
  static async warehouseSummary() {
    const [stats, floorQueue, expiring, critical, movements] =
      await Promise.all([
        this.one(`SELECT COALESCE(SUM(stock_total),0) unidades,
        SUM(stock_total<=stock_minimo AND activo=1) criticos,
        (SELECT COUNT(*) FROM lotes WHERE cantidad_actual>0 AND fecha_vencimiento<=CURRENT_DATE+INTERVAL 30 DAY) por_vencer,
        (SELECT COUNT(*) FROM tareas_almacen WHERE tipo='PUTAWAY' AND estado='PENDIENTE') putaway_pendientes,
        (SELECT COUNT(*) FROM lotes l JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id WHERE l.cantidad_actual>0 AND u.tipo='RECEPCION') lotes_en_recepcion
        FROM productos WHERE activo=1`),
        this
          .query(`SELECT t.id,t.codigo_tarea,t.tipo,t.prioridad,t.cantidad,t.creado_en,
        p.sku,p.nombre producto,ori.codigo_loc origen,dst.codigo_loc destino,
        a.nombre asignado
        FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
        JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
        JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
        LEFT JOIN usuarios a ON a.id=t.asignado_a
        WHERE t.estado='PENDIENTE'
        ORDER BY FIELD(t.prioridad,'URGENTE','ALTA','NORMAL','BAJA'),t.creado_en LIMIT 6`),
        this
          .query(`SELECT p.nombre,l.numero_lote,l.cantidad_actual,l.fecha_vencimiento,
        DATEDIFF(l.fecha_vencimiento,CURRENT_DATE) dias
        FROM lotes l JOIN productos p ON p.id=l.producto_id
        WHERE l.cantidad_actual>0 AND l.fecha_vencimiento<=CURRENT_DATE+INTERVAL 30 DAY
        ORDER BY l.fecha_vencimiento LIMIT 6`),
        this.query(`SELECT id,nombre,stock_total,stock_minimo FROM productos
        WHERE activo=1 AND stock_total<=stock_minimo ORDER BY stock_total LIMIT 6`),
        this
          .query(`SELECT ma.tipo_movimiento,ma.cantidad,ma.creado_en,p.sku,p.nombre producto,
        l.numero_lote,loc.codigo_loc
        FROM movimientos_almacen ma JOIN productos p ON p.id=ma.producto_id
        LEFT JOIN lotes l ON l.id=ma.lote_id
        LEFT JOIN ubicaciones_almacen loc ON loc.id=l.ubicacion_id
        ORDER BY ma.creado_en DESC LIMIT 6`),
      ]);
    return { stats, floorQueue, expiring, critical, movements };
  }
}
module.exports = Dashboard;
