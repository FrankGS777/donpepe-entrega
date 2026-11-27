const Base = require("./BaseModel");

class Distribution extends Base {
  static branches(activeOnly = true) {
    return this.query(`SELECT s.*,
      (SELECT COUNT(*) FROM pedidos_sucursal p WHERE p.sucursal_id=s.id) pedidos
      FROM sucursales s ${activeOnly ? "WHERE s.activo=1" : ""}
      ORDER BY s.nombre`);
  }
  static products() {
    return this.query(`SELECT p.id,p.sku,p.nombre,p.unidad_medida,p.imagen_url,
      p.clase_abc,COALESCE(SUM(CASE WHEN l.estado_inventario='DISPONIBLE'
      AND u.permite_picking=1 AND (p.control_vencimiento=0 OR l.fecha_vencimiento>=CURRENT_DATE)
      THEN GREATEST(l.cantidad_actual-COALESCE((SELECT SUM(t.cantidad)
        FROM tareas_almacen t WHERE t.lote_origen_id=l.id
          AND t.estado IN ('PENDIENTE','EN_PROCESO')),0),0) ELSE 0 END),0) disponible_picking
      FROM productos p LEFT JOIN lotes l ON l.producto_id=p.id
      LEFT JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
      WHERE p.activo=1 GROUP BY p.id ORDER BY p.nombre`);
  }
  static orders() {
    return this.query(`SELECT o.*,s.codigo codigo_sucursal,s.nombre sucursal,
      COUNT(DISTINCT d.id) lineas,COALESCE(SUM(d.cantidad_solicitada),0) unidades,
      (SELECT COUNT(*) FROM tareas_almacen t JOIN pedidos_sucursal_detalle ld
       ON ld.id=t.pedido_sucursal_detalle_id WHERE ld.pedido_id=o.id
       AND t.estado IN ('PENDIENTE','EN_PROCESO')) tareas_abiertas
      FROM pedidos_sucursal o JOIN sucursales s ON s.id=o.sucursal_id
      JOIN pedidos_sucursal_detalle d ON d.pedido_id=o.id
      GROUP BY o.id ORDER BY o.creado_en DESC,o.id DESC LIMIT 100`);
  }
  static async order(id) {
    const order = await this.one(
      `SELECT o.*,s.codigo codigo_sucursal,s.nombre sucursal,
      s.direccion,u.nombre creador FROM pedidos_sucursal o
      JOIN sucursales s ON s.id=o.sucursal_id JOIN usuarios u ON u.id=o.creado_por
      WHERE o.id=?`,
      [id],
    );
    if (!order) return null;
    const [lines, tasks, returns] = await Promise.all([
      this.query(
        `SELECT d.*,p.sku,p.nombre producto,p.imagen_url,p.unidad_medida,
        COALESCE(SUM(CASE WHEN t.estado='COMPLETADA' THEN t.cantidad ELSE 0 END),0) preparada,
        COALESCE(SUM(CASE WHEN t.estado IN ('PENDIENTE','EN_PROCESO') THEN t.cantidad ELSE 0 END),0) en_tarea
        FROM pedidos_sucursal_detalle d JOIN productos p ON p.id=d.producto_id
        LEFT JOIN tareas_almacen t ON t.pedido_sucursal_detalle_id=d.id
        WHERE d.pedido_id=? GROUP BY d.id ORDER BY p.nombre`,
        [id],
      ),
      this.query(
        `SELECT t.id,t.codigo_tarea,t.estado,t.cantidad,t.prioridad,t.referencia_operativa,
        p.sku,l.numero_lote,ori.codigo_loc loc_origen,dst.codigo_loc loc_destino,
        a.nombre operador,
        t.cantidad-COALESCE((SELECT SUM(r.cantidad) FROM devoluciones_sucursal r
         WHERE r.tarea_picking_id=t.id),0) retornable FROM tareas_almacen t
        JOIN pedidos_sucursal_detalle d ON d.id=t.pedido_sucursal_detalle_id
        JOIN productos p ON p.id=t.producto_id JOIN lotes l ON l.id=t.lote_origen_id
        JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
        JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
        LEFT JOIN usuarios a ON a.id=t.asignado_a WHERE d.pedido_id=?
        ORDER BY t.id`,
        [id],
      ),
      this.query(
        `SELECT r.id,r.cantidad,r.motivo,r.numero_lote_original,
        r.registrado_en,p.sku,lt.numero_lote lote_retorno,
        t.codigo_tarea,t.estado estado_tarea FROM devoluciones_sucursal r
        JOIN tareas_almacen pick ON pick.id=r.tarea_picking_id
        JOIN productos p ON p.id=pick.producto_id
        JOIN lotes lt ON lt.id=r.lote_retorno_id
        JOIN tareas_almacen t ON t.id=r.tarea_cuarentena_id
        WHERE r.pedido_id=? ORDER BY r.id DESC`,
        [id],
      ),
    ]);
    return { ...order, lines, tasks, returns };
  }
}
module.exports = Distribution;
