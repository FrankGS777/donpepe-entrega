const Base = require("../models/BaseModel");
const { dateTimeInLima } = require("../utils/dates");

exports.index = async (req, res) => {
  const [flow, taskSummary, stock, expiring, occupancy] = await Promise.all([
    Base.query(
      `SELECT DATE(creado_en) fecha,
       SUM(CASE WHEN tipo_movimiento='ENTRADA' THEN cantidad ELSE 0 END) entradas,
       SUM(CASE WHEN tipo_movimiento='SALIDA' THEN cantidad ELSE 0 END) salidas,
       COUNT(*) operaciones
       FROM movimientos_almacen
       WHERE creado_en>=CURRENT_DATE-INTERVAL 30 DAY
       GROUP BY DATE(creado_en) ORDER BY fecha`,
    ),
    Base.query(
      `SELECT tipo,estado,COUNT(*) tareas,SUM(cantidad) unidades
       FROM tareas_almacen GROUP BY tipo,estado
       ORDER BY FIELD(estado,'PENDIENTE','EN_PROCESO','COMPLETADA','CANCELADA'),tipo`,
    ),
    Base.query(
      `SELECT c.nombre categoria,SUM(p.stock_total) unidades,
       SUM(p.stock_total*p.precio_compra) valorizado
       FROM productos p JOIN categorias c ON c.id=p.categoria_id
       WHERE p.activo=1 GROUP BY c.id ORDER BY valorizado DESC`,
    ),
    Base.query(
      `SELECT p.nombre,l.numero_lote,l.cantidad_actual,l.fecha_vencimiento,
       DATEDIFF(l.fecha_vencimiento,CURRENT_DATE) dias,u.codigo_loc
       FROM lotes l JOIN productos p ON p.id=l.producto_id
       JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
       WHERE l.cantidad_actual>0 AND l.fecha_vencimiento<=CURRENT_DATE+INTERVAL 30 DAY
       ORDER BY l.fecha_vencimiento`,
    ),
    Base.query(
      `SELECT zona,codigo_loc,tipo,unidades_ocupadas,ocupacion_hu,capacidad_hu,porcentaje_ocupacion
       FROM vw_ocupacion_loc WHERE activo=1 AND modelo_plano='CD1'
       ORDER BY porcentaje_ocupacion DESC LIMIT 100`,
    ),
  ]);
  res.render("reportes/index", {
    title: "Reportes WMS",
    flow,
    taskSummary,
    stock,
    expiring,
    occupancy,
    summary: {
      operations: flow.reduce(
        (total, row) => total + Number(row.operaciones || 0),
        0,
      ),
      inbound: flow.reduce(
        (total, row) => total + Number(row.entradas || 0),
        0,
      ),
      outbound: flow.reduce(
        (total, row) => total + Number(row.salidas || 0),
        0,
      ),
      inventoryValue: stock.reduce(
        (total, row) => total + Number(row.valorizado || 0),
        0,
      ),
      averageOccupancy: occupancy.length
        ? occupancy.reduce(
            (total, row) => total + Number(row.porcentaje_ocupacion || 0),
            0,
          ) / occupancy.length
        : 0,
      tasks: taskSummary.reduce(
        (total, row) => total + Number(row.tareas || 0),
        0,
      ),
      completedTasks: taskSummary
        .filter((row) => row.estado === "COMPLETADA")
        .reduce((total, row) => total + Number(row.tareas || 0), 0),
    },
  });
};

exports.csv = async (req, res) => {
  const rows = await Base.query(
    `SELECT ma.creado_en,ma.tipo_movimiento,ma.cantidad,ma.referencia_tipo,
     ma.motivo,p.sku,p.nombre producto,u.nombre usuario,l.numero_lote,loc.codigo_loc
     FROM movimientos_almacen ma JOIN productos p ON p.id=ma.producto_id
     JOIN usuarios u ON u.id=ma.usuario_id
     LEFT JOIN lotes l ON l.id=ma.lote_id
     LEFT JOIN ubicaciones_almacen loc ON loc.id=l.ubicacion_id
     ORDER BY ma.creado_en DESC`,
  );
  const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = [
    "Fecha,Movimiento,SKU,Producto,Lote,LOC,Cantidad,Referencia,Usuario,Motivo",
    ...rows.map((r) =>
      [
        dateTimeInLima(r.creado_en),
        r.tipo_movimiento,
        r.sku,
        r.producto,
        r.numero_lote,
        r.codigo_loc,
        r.cantidad,
        r.referencia_tipo,
        r.usuario,
        r.motivo,
      ]
        .map(escape)
        .join(","),
    ),
  ].join("\n");
  res
    .set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kardex-wms.csv"',
    })
    .send("\ufeff" + csv);
};
