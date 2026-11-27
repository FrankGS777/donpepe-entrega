const Base = require("./BaseModel");

// Read model only. Scene playback never posts movements, deliveries or GPS events.
class LogisticsNetwork extends Base {
  static async snapshot() {
    const [branches, suppliers, orders, purchases, tasks, stats] = await Promise.all([
      this.query(`SELECT id,codigo,nombre,direccion,activo FROM sucursales ORDER BY activo DESC,nombre`),
      this.query(`SELECT id,razon_social FROM proveedores WHERE activo=1 ORDER BY razon_social`),
      this.query(`SELECT o.id,o.codigo,o.estado,o.sucursal_id,s.nombre sucursal,
        COALESCE(d.unidades,0) unidades,COALESCE(d.lineas,0) lineas,
        o.creado_en,o.despachado_en,o.referencia_guia,o.placa_vehiculo
        FROM pedidos_sucursal o JOIN sucursales s ON s.id=o.sucursal_id
        LEFT JOIN (SELECT pedido_id,SUM(cantidad_solicitada) unidades,COUNT(*) lineas
          FROM pedidos_sucursal_detalle GROUP BY pedido_id) d ON d.pedido_id=o.id
        WHERE o.estado<>'CANCELADO'
        ORDER BY FIELD(o.estado,'LISTO','EN_PREPARACION','PENDIENTE','DESPACHADO'),o.creado_en DESC LIMIT 80`),
      this.query(`SELECT oc.id,oc.codigo_orden,oc.estado,p.razon_social proveedor,
        SUM(d.cantidad_solicitada-d.cantidad_recibida) unidades_pendientes
        FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id
        JOIN ordenes_compra_detalle d ON d.orden_id=oc.id
        WHERE oc.estado IN ('PENDIENTE','PARCIAL') GROUP BY oc.id,p.razon_social
        ORDER BY oc.fecha_emision LIMIT 30`),
      this.query(`SELECT t.id,t.codigo_tarea,t.tipo,t.estado,t.prioridad,t.cantidad,
        p.nombre producto,p.sku,a.nombre asignado,
        COALESCE(zo.nombre,ori.zona) origen,COALESCE(zd.nombre,dst.zona) destino
        FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
        JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
        JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
        LEFT JOIN zonas_almacen zo ON zo.id=ori.zona_id
        LEFT JOIN zonas_almacen zd ON zd.id=dst.zona_id
        LEFT JOIN usuarios a ON a.id=t.asignado_a
        WHERE t.estado IN ('PENDIENTE','EN_PROCESO')
        ORDER BY FIELD(t.estado,'EN_PROCESO','PENDIENTE'),
          FIELD(t.prioridad,'URGENTE','ALTA','NORMAL','BAJA'),t.creado_en LIMIT 60`),
      this.one(`SELECT
        (SELECT COALESCE(SUM(cantidad_actual),0) FROM lotes) units,
        (SELECT COUNT(*) FROM tareas_almacen WHERE estado='PENDIENTE') pendingTasks,
        (SELECT COUNT(*) FROM tareas_almacen WHERE estado='EN_PROCESO') inProgressTasks,
        (SELECT COUNT(*) FROM pedidos_sucursal WHERE estado='LISTO') readyOrders,
        (SELECT COUNT(*) FROM pedidos_sucursal WHERE estado='PENDIENTE') pendingOrders,
        (SELECT COUNT(*) FROM pedidos_sucursal WHERE estado='EN_PREPARACION') inPreparationOrders,
        (SELECT COUNT(*) FROM pedidos_sucursal WHERE estado='DESPACHADO') dispatchedOrders,
        (SELECT COUNT(*) FROM ordenes_compra WHERE estado IN ('PENDIENTE','PARCIAL')) pendingPurchases`),
    ]);
    return {
      generatedAt: new Date().toISOString(),
      warehouse: { id: "CD1", name: "Centro de distribución DonPepe" },
      branches,
      suppliers,
      orders,
      purchases,
      tasks,
      stats: Object.fromEntries(Object.entries(stats || {}).map(([key, value]) => [key, Number(value || 0)])),
      simulation: { schematic: true, telemetry: false },
    };
  }
}

module.exports = LogisticsNetwork;
