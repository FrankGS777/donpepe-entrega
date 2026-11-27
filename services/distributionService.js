const { transaction } = require("../config/db");
const { requireActorPermission } = require("./accessPolicy");
const { temporaryCode, branchOrderCode } = require("../utils/codes");
const { createTaskRecord, assignTaskRecord } = require("./wmsService");
const AppError = require("../utils/AppError");
const { createHandlingUnit } = require("./stockService");

function parseLines(raw) {
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    throw new AppError("El detalle del pedido no es JSON válido", 422);
  }
  if (!Array.isArray(parsed) || !parsed.length || parsed.length > 40)
    throw new AppError("Agrega entre 1 y 40 SKU al pedido", 422);
  const grouped = new Map();
  for (const entry of parsed) {
    const productId = Number(entry.producto_id ?? entry.productId);
    const quantity = Number(entry.cantidad ?? entry.quantity);
    if (
      !Number.isInteger(productId) ||
      productId < 1 ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100000
    )
      throw new AppError("Cada línea requiere un SKU y cantidad positiva", 422);
    grouped.set(productId, (grouped.get(productId) || 0) + quantity);
    if (grouped.get(productId) > 100000)
      throw new AppError(
        "La cantidad de un SKU supera el máximo permitido",
        422,
      );
  }
  return [...grouped].map(([productId, quantity]) => ({ productId, quantity }));
}

async function createBranchOrder({ branchId, items, userId, observations }) {
  if (!Number.isInteger(branchId) || branchId < 1)
    throw new AppError("Selecciona una sucursal activa", 422);
  const lines = parseLines(items);
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "distribution.create");
    const [[branch]] = await conn.execute(
      "SELECT id,nombre FROM sucursales WHERE id=? AND activo=1 FOR UPDATE",
      [branchId],
    );
    if (!branch) throw new AppError("Selecciona una sucursal activa", 409);
    for (const line of lines) {
      const [[product]] = await conn.execute(
        "SELECT id,activo FROM productos WHERE id=?",
        [line.productId],
      );
      if (!product?.activo)
        throw new AppError(`El SKU #${line.productId} no está activo`, 409);
    }
    const [created] = await conn.execute(
      `INSERT INTO pedidos_sucursal (codigo,sucursal_id,creado_por,observaciones)
       VALUES (?,?,?,?)`,
      [
        temporaryCode("PS"),
        branch.id,
        userId,
        String(observations || "")
          .trim()
          .slice(0, 500) || null,
      ],
    );
    const code = branchOrderCode(created.insertId);
    await conn.execute("UPDATE pedidos_sucursal SET codigo=? WHERE id=?", [
      code,
      created.insertId,
    ]);
    for (const line of lines)
      await conn.execute(
        `INSERT INTO pedidos_sucursal_detalle
         (pedido_id,producto_id,cantidad_solicitada) VALUES (?,?,?)`,
        [created.insertId, line.productId, line.quantity],
      );
    return { id: created.insertId, code };
  });
}

async function planBranchOrder({ orderId, userId, operatorId = null }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "distribution.plan");
    const [[order]] = await conn.execute(
      "SELECT * FROM pedidos_sucursal WHERE id=? FOR UPDATE",
      [orderId],
    );
    if (!order || !["PENDIENTE", "EN_PREPARACION"].includes(order.estado))
      throw new AppError("El pedido ya no admite planificación", 409);
    const [lines] = await conn.execute(
      `SELECT d.id,d.producto_id,d.cantidad_solicitada,p.sku,p.nombre,
       p.control_vencimiento,COALESCE(pz.condicion_almacenamiento,'AMBIENTE') condicion
       FROM pedidos_sucursal_detalle d JOIN productos p ON p.id=d.producto_id
       LEFT JOIN ubicaciones_almacen pl ON pl.id=p.ubicacion_picking_id
       LEFT JOIN zonas_almacen pz ON pz.id=pl.zona_id
       WHERE d.pedido_id=? ORDER BY d.id`,
      [orderId],
    );
    let created = 0;
    for (const line of lines) {
      const [[progress]] = await conn.execute(
        `SELECT COALESCE(SUM(cantidad),0) comprometida FROM tareas_almacen
         WHERE pedido_sucursal_detalle_id=?
         AND estado IN ('PENDIENTE','EN_PROCESO','COMPLETADA')`,
        [line.id],
      );
      let needed =
        Number(line.cantidad_solicitada) - Number(progress.comprometida);
      if (needed < 0)
        throw new AppError(
          "El pedido tiene más unidades preparadas que solicitadas",
          409,
        );
      if (!needed) continue;
      const [lots] = await conn.execute(
        `SELECT l.id,l.cantidad_actual,u.codigo_loc FROM lotes l
         JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
         WHERE l.producto_id=? AND l.cantidad_actual>0 AND l.estado_inventario='DISPONIBLE'
         AND u.activo=1 AND u.tipo='PICKING' AND u.permite_picking=1
         AND (?=0 OR l.fecha_vencimiento>=CURRENT_DATE)
         ORDER BY l.fecha_vencimiento,l.fecha_ingreso,l.id FOR UPDATE`,
        [line.producto_id, line.control_vencimiento],
      );
      for (const lot of lots) {
        if (!needed) break;
        const [[reservation]] = await conn.execute(
          `SELECT COALESCE(SUM(cantidad),0) unidades FROM tareas_almacen
           WHERE lote_origen_id=? AND estado IN ('PENDIENTE','EN_PROCESO')`,
          [lot.id],
        );
        const free = Number(lot.cantidad_actual) - Number(reservation.unidades);
        if (free <= 0) continue;
        const quantity = Math.min(needed, free);
        const [[staging]] = await conn.execute(
          `SELECT u.id,u.codigo_loc FROM ubicaciones_almacen u
           JOIN zonas_almacen z ON z.id=u.zona_id
           WHERE u.activo=1 AND u.tipo='DESPACHO' AND z.condicion_almacenamiento=?
           AND NOT EXISTS (SELECT 1 FROM lotes s WHERE s.ubicacion_id=u.id AND s.cantidad_actual>0)
           AND NOT EXISTS (SELECT 1 FROM tareas_almacen t WHERE t.ubicacion_destino_id=u.id
             AND t.estado IN ('PENDIENTE','EN_PROCESO'))
           ORDER BY u.secuencia_putaway,u.id LIMIT 1 FOR UPDATE`,
          [line.condicion],
        );
        if (!staging)
          throw new AppError(
            `No queda un casillero de staging ${line.condicion} libre para ${line.sku}`,
            409,
          );
        const task = await createTaskRecord(conn, {
          type: "PICKING",
          lotId: lot.id,
          destinationId: staging.id,
          quantity,
          priority: "NORMAL",
          userId,
          reference: order.codigo,
          branchOrderLineId: line.id,
          observations: `Pedido ${order.codigo} · separar para sucursal`,
        });
        if (operatorId != null && operatorId !== "")
          await assignTaskRecord(conn, { taskId: task.id, operatorId, userId });
        created += 1;
        needed -= quantity;
      }
      if (needed)
        throw new AppError(
          `${line.sku}: faltan ${needed} UND en picking. Reabastece desde reserva y vuelve a planificar; no se asignó trabajo parcial.`,
          409,
        );
    }
    if (!created)
      throw new AppError("No quedan líneas pendientes de planificación", 409);
    await conn.execute(
      "UPDATE pedidos_sucursal SET estado='EN_PREPARACION' WHERE id=?",
      [order.id],
    );
    return { code: order.codigo, tasks: created };
  });
}

async function dispatchBranchOrder({ orderId, userId, guide, plate }) {
  const guideCode = String(guide || "")
    .trim()
    .toUpperCase();
  const vehiclePlate = String(plate || "")
    .trim()
    .toUpperCase();
  if (
    !/^[A-Z0-9-]{4,40}$/.test(guideCode) ||
    !/^[A-Z0-9-]{5,12}$/.test(vehiclePlate)
  )
    throw new AppError(
      "Registra referencia de guía y placa válidas antes de despachar",
      422,
    );
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "distribution.dispatch");
    const [[order]] = await conn.execute(
      "SELECT * FROM pedidos_sucursal WHERE id=? FOR UPDATE",
      [orderId],
    );
    if (!order || order.estado !== "LISTO")
      throw new AppError(
        "Solo se despacha un pedido íntegramente preparado",
        409,
      );
    const [lines] = await conn.execute(
      "SELECT id,cantidad_solicitada FROM pedidos_sucursal_detalle WHERE pedido_id=?",
      [order.id],
    );
    const [tasks] = await conn.execute(
      `SELECT t.* FROM tareas_almacen t JOIN pedidos_sucursal_detalle d
       ON d.id=t.pedido_sucursal_detalle_id WHERE d.pedido_id=?
       AND t.tipo='PICKING' AND t.estado<>'CANCELADA' ORDER BY t.id FOR UPDATE`,
      [order.id],
    );
    for (const line of lines) {
      const own = tasks.filter(
        (task) => Number(task.pedido_sucursal_detalle_id) === Number(line.id),
      );
      if (
        own.some((task) => task.estado !== "COMPLETADA") ||
        own.reduce((sum, task) => sum + Number(task.cantidad), 0) !==
          Number(line.cantidad_solicitada)
      )
        throw new AppError(
          "El pedido tiene una línea incompleta o cancelada; replánificalo",
          409,
        );
    }
    for (const task of tasks) {
      if (!task.lote_destino_id)
        throw new AppError(
          "Un picking no tiene trazabilidad de su lote en staging",
          409,
        );
      const [[lot]] = await conn.execute(
        `SELECT l.*,p.control_vencimiento,l.fecha_vencimiento<CURRENT_DATE vencido
         FROM lotes l JOIN productos p ON p.id=l.producto_id
         WHERE l.id=? FOR UPDATE`,
        [task.lote_destino_id],
      );
      if (
        !lot ||
        Number(lot.ubicacion_id) !== Number(task.ubicacion_destino_id) ||
        lot.estado_inventario !== "DISPONIBLE" ||
        Number(lot.cantidad_actual) < Number(task.cantidad) ||
        (lot.control_vencimiento &&
          (lot.fecha_vencimiento == null || lot.vencido))
      )
        throw new AppError(
          "El stock preparado cambió en staging; revisa antes de cargar",
          409,
        );
      await conn.execute(
        "UPDATE lotes SET cantidad_actual=cantidad_actual-? WHERE id=?",
        [task.cantidad, lot.id],
      );
      await conn.execute(
        "UPDATE productos SET stock_total=stock_total-? WHERE id=?",
        [task.cantidad, task.producto_id],
      );
      await conn.execute(
        `INSERT INTO movimientos_almacen
         (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,referencia_id,motivo)
         VALUES (?,?,?,'SALIDA',?,'DESPACHO_SUCURSAL',?,?)`,
        [
          task.producto_id,
          lot.id,
          userId,
          task.cantidad,
          order.id,
          `${order.codigo} · guía ${guideCode} · vehículo ${vehiclePlate}`,
        ],
      );
    }
    await conn.execute(
      `UPDATE pedidos_sucursal SET estado='DESPACHADO',despachado_en=CURRENT_TIMESTAMP,
       referencia_guia=?,placa_vehiculo=? WHERE id=?`,
      [guideCode, vehiclePlate, order.id],
    );
    return {
      code: order.codigo,
      units: tasks.reduce((sum, task) => sum + Number(task.cantidad), 0),
    };
  });
}

async function registerBranchReturn({
  orderId,
  pickingTaskId,
  quantity,
  reason,
  userId,
}) {
  const qty = Number(quantity);
  if (
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > 100000 ||
    !["RECHAZO", "DANIO", "SOBRANTE"].includes(reason)
  )
    throw new AppError(
      "Indica tarea de picking, cantidad y motivo válidos",
      422,
    );
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "distribution.return");
    const [[order]] = await conn.execute(
      "SELECT id,codigo,estado FROM pedidos_sucursal WHERE id=? FOR UPDATE",
      [orderId],
    );
    if (!order || order.estado !== "DESPACHADO")
      throw new AppError(
        "Solo se acepta una devolución de un pedido ya despachado",
        409,
      );
    const [[shipment]] = await conn.execute(
      `SELECT t.id,t.cantidad,t.producto_id,t.lote_destino_id,t.estado,
       original.numero_lote,original.lote_fabricante_id,l.orden_compra_id,l.fecha_ingreso,l.fecha_vencimiento,
       COALESCE(z.condicion_almacenamiento,'AMBIENTE') condicion
       FROM tareas_almacen t JOIN pedidos_sucursal_detalle d
       ON d.id=t.pedido_sucursal_detalle_id
       JOIN lotes l ON l.id=t.lote_destino_id
       JOIN lotes original ON original.id=t.lote_origen_id
       LEFT JOIN ubicaciones_almacen p ON p.id=(SELECT ubicacion_picking_id FROM productos WHERE id=t.producto_id)
       LEFT JOIN zonas_almacen z ON z.id=p.zona_id
       WHERE t.id=? AND d.pedido_id=? AND t.tipo='PICKING' FOR UPDATE`,
      [pickingTaskId, order.id],
    );
    if (!shipment || shipment.estado !== "COMPLETADA")
      throw new AppError(
        "Elige una línea realmente preparada y despachada",
        409,
      );
    const [[already]] = await conn.execute(
      `SELECT COALESCE(SUM(cantidad),0) cantidad FROM devoluciones_sucursal
       WHERE tarea_picking_id=?`,
      [shipment.id],
    );
    const remaining = Number(shipment.cantidad) - Number(already.cantidad);
    if (qty > remaining)
      throw new AppError(
        `Solo quedan ${remaining} UND retornables de esa expedición`,
        409,
      );
    const [locations] = await conn.execute(
      `SELECT u.id,u.codigo_loc,u.tipo,z.condicion_almacenamiento condicion
       FROM ubicaciones_almacen u JOIN zonas_almacen z ON z.id=u.zona_id
       WHERE u.activo=1 AND u.tipo IN ('RECEPCION','CUARENTENA')
       AND z.condicion_almacenamiento=?
       AND NOT EXISTS (SELECT 1 FROM lotes l WHERE l.ubicacion_id=u.id AND l.cantidad_actual>0)
       AND NOT EXISTS (SELECT 1 FROM tareas_almacen t WHERE t.ubicacion_destino_id=u.id
         AND t.estado IN ('PENDIENTE','EN_PROCESO'))
       ORDER BY u.secuencia_putaway,u.id FOR UPDATE`,
      [shipment.condicion],
    );
    const receiving = locations.find((loc) => loc.tipo === "RECEPCION");
    const quarantine = locations.find((loc) => loc.tipo === "CUARENTENA");
    if (!receiving || !quarantine)
      throw new AppError(
        `Faltan recepción o cuarentena ${shipment.condicion} activas`,
        409,
      );
    const [returnRow] = await conn.execute(
      `INSERT INTO devoluciones_sucursal
       (pedido_id,tarea_picking_id,numero_lote_original,cantidad,motivo,registrado_por)
       VALUES (?,?,?,?,?,?)`,
      [order.id, shipment.id, shipment.numero_lote, qty, reason, userId],
    );
    // La HU identifica el paquete devuelto; el lote original permite FEFO y trazabilidad.
    const returnHuId = await createHandlingUnit(
      conn,
      `RT-${order.id}-${shipment.id}-${returnRow.insertId}`,
      "RETORNO",
      order.codigo,
    );
    const [lot] = await conn.execute(
      `INSERT INTO lotes
       (numero_lote,lote_fabricante_id,unidad_logistica_id,producto_id,ubicacion_id,orden_compra_id,cantidad_inicial,cantidad_actual,
        fecha_ingreso,fecha_vencimiento,estado_inventario)
       VALUES (?,?,?,?,?,?,?,?,?,?,'CUARENTENA')`,
      [
        shipment.numero_lote,
        shipment.lote_fabricante_id,
        returnHuId,
        shipment.producto_id,
        receiving.id,
        shipment.orden_compra_id,
        qty,
        qty,
        shipment.fecha_ingreso,
        shipment.fecha_vencimiento,
      ],
    );
    const task = await createTaskRecord(conn, {
      type: "DEVOLUCION_RUTA",
      lotId: lot.insertId,
      destinationId: quarantine.id,
      quantity: qty,
      priority: "ALTA",
      userId,
      reference: order.codigo,
      observations: `Retorno ${returnRow.insertId} · lote proveedor ${shipment.numero_lote} · ${reason}`,
    });
    await conn.execute(
      `UPDATE devoluciones_sucursal SET lote_retorno_id=?,tarea_cuarentena_id=? WHERE id=?`,
      [lot.insertId, task.id, returnRow.insertId],
    );
    await conn.execute(
      "UPDATE productos SET stock_total=stock_total+? WHERE id=?",
      [qty, shipment.producto_id],
    );
    await conn.execute(
      `INSERT INTO movimientos_almacen
       (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,referencia_id,motivo)
       VALUES (?,?,?,'ENTRADA',?,'DEVOLUCION_SUCURSAL',?,?)`,
      [
        shipment.producto_id,
        lot.insertId,
        userId,
        qty,
        returnRow.insertId,
        `${order.codigo} · retorno ${reason} · lote original ${shipment.numero_lote}`,
      ],
    );
    return { code: order.codigo, task: task.code, quantity: qty };
  });
}

module.exports = {
  parseLines,
  createBranchOrder,
  planBranchOrder,
  dispatchBranchOrder,
  registerBranchReturn,
};
