// Prueba de integración deliberadamente limitada a una base temporal de verificación.
const assert = require("node:assert/strict");
const { pool } = require("../config/db");
const { createPurchase, receivePurchase } = require("../services/purchaseService");
const { createTaskRecord, startWarehouseTask, completeWarehouseTask } = require("../services/wmsService");
const { todayInLima } = require("../utils/dates");

async function main() {
  if (!/^wms_cd1_.*verify_\d{8}$/.test(process.env.DB_NAME || ""))
    throw new Error("Esta prueba solo puede ejecutarse sobre una base temporal wms_cd1_*verify_YYYYMMDD");
  const [[product]] = await pool.execute(
    `SELECT p.id,p.sku,p.proveedor_id,p.control_vencimiento,z.condicion_almacenamiento
     FROM productos p JOIN ubicaciones_almacen u ON u.id=p.ubicacion_picking_id
     JOIN zonas_almacen z ON z.id=u.zona_id
     WHERE p.activo=1 AND p.proveedor_id IS NOT NULL ORDER BY p.id LIMIT 1`,
  );
  const [[user]] = await pool.execute("SELECT id FROM usuarios WHERE activo=1 ORDER BY id LIMIT 1");
  const [[receiving]] = await pool.execute(
    `SELECT u.id FROM ubicaciones_almacen u JOIN zonas_almacen z ON z.id=u.zona_id
     LEFT JOIN lotes l ON l.ubicacion_id=u.id AND l.cantidad_actual>0
     WHERE u.tipo='RECEPCION' AND u.activo=1 AND u.modelo_plano='CD1'
       AND z.condicion_almacenamiento=? AND l.id IS NULL ORDER BY u.id LIMIT 1`,
    [product.condicion_almacenamiento],
  );
  assert(product && user && receiving);
  const order = await createPurchase({
    providerId: product.proveedor_id,
    userId: user.id,
    items: [{ producto_id: product.id, cantidad: 3, precio: 5 }],
  });
  const [[detail]] = await pool.execute("SELECT id FROM ordenes_compra_detalle WHERE orden_id=?", [order.id]);
  const tomorrowYear = new Date();
  tomorrowYear.setUTCFullYear(tomorrowYear.getUTCFullYear() + 1);
  const batchCode = `VERIFY-${order.id}`;
  await receivePurchase({
    orderId: order.id,
    userId: user.id,
    items: [{
      detalle_id: detail.id,
      ubicacion_id: receiving.id,
      numero_lote: batchCode,
      cantidad_recibida: 3,
      fecha_ingreso: todayInLima(),
      fecha_vencimiento: product.control_vencimiento ? tomorrowYear.toISOString().slice(0, 10) : "",
    }],
  });
  const [[received]] = await pool.execute(
    `SELECT l.id,l.cantidad_actual,l.unidad_logistica_id,hu.codigo_hu,
      b.codigo_lote,t.id task_id,d.codigo_loc destination
     FROM lotes l JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
     JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
     JOIN tareas_almacen t ON t.lote_origen_id=l.id AND t.tipo='PUTAWAY'
     JOIN ubicaciones_almacen d ON d.id=t.ubicacion_destino_id
     WHERE b.producto_id=? AND b.codigo_lote=?`,
    [product.id, batchCode],
  );
  assert.equal(Number(received.cantidad_actual), 3);
  assert.match(received.codigo_hu, /^HU-[A-F0-9]{16}$/);
  assert.match(received.destination, /^CD1-/);
  await startWarehouseTask({ taskId: received.task_id, userId: user.id });
  await completeWarehouseTask({
    taskId: received.task_id, userId: user.id, role: "administrador_wms",
  });
  const [[placed]] = await pool.execute(
    `SELECT l.cantidad_actual,hu.codigo_hu,u.codigo_loc FROM lotes l
     JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
     JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
     WHERE l.lote_fabricante_id=(SELECT id FROM lotes_fabricante WHERE producto_id=? AND codigo_lote=?)
       AND u.codigo_loc=? AND l.cantidad_actual>0`,
    [product.id, batchCode, received.destination],
  );
  assert.equal(Number(placed.cantidad_actual), 3);
  assert.equal(placed.codigo_hu, received.codigo_hu);
  const [[candidate]] = await pool.execute(
    `SELECT l.id,l.cantidad_actual,u.id location_id,z.id zone_id
     FROM lotes l JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
     JOIN zonas_almacen z ON z.id=u.zona_id
     WHERE l.cantidad_actual>0 AND u.tipo='RESERVA' AND u.modelo_plano='CD1'
     ORDER BY l.id LIMIT 1`,
  );
  const [[target]] = await pool.execute(
    `SELECT u.id FROM ubicaciones_almacen u LEFT JOIN lotes l
       ON l.ubicacion_id=u.id AND l.cantidad_actual>0
     LEFT JOIN tareas_almacen t ON t.ubicacion_destino_id=u.id
       AND t.estado IN ('PENDIENTE','EN_PROCESO')
     WHERE u.zona_id=? AND u.tipo='RESERVA' AND u.id<>?
       AND l.id IS NULL AND t.id IS NULL AND u.activo=1 ORDER BY u.id LIMIT 1`,
    [candidate.zone_id, candidate.location_id],
  );
  assert(target);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const task = await createTaskRecord(conn, {
      type: "REUBICACION", lotId: candidate.id, destinationId: target.id,
      quantity: 1, userId: user.id,
    });
    assert.match(task.code, /^TA-/);
    await assert.rejects(
      createTaskRecord(conn, {
        type: "REUBICACION", lotId: candidate.id, destinationId: target.id,
        quantity: 1, userId: user.id,
      }),
      /ocupada o reservada/,
    );
    await conn.rollback();
  } finally {
    conn.release();
  }
  console.log(`OK OC ${order.code}; recepción ${received.codigo_hu}; put-away confirmado ${received.destination}; reserva de LOC validada`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => pool.end());
