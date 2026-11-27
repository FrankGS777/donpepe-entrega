const { transaction } = require("../config/db");
const { temporaryCode, warehouseTaskCode } = require("../utils/codes");
const AppError = require("../utils/AppError");
const { createHandlingUnit } = require("./stockService");
const { lotCode } = require("../config/warehouseBlueprint");
const {
  requireActorPermission,
  requireAssignedOperator,
} = require("./accessPolicy");

const TASK_TYPES = [
  "PUTAWAY",
  "REUBICACION",
  "REABASTECIMIENTO",
  "PICKING",
  "DEVOLUCION_RUTA",
];
const PRIORITIES = ["BAJA", "NORMAL", "ALTA", "URGENTE"];

async function locationWithCapacity(
  conn,
  locationId,
  quantity,
  reserveOpen = false,
) {
  const [[location]] = await conn.execute(
    `SELECT u.*,z.codigo_zona,z.condicion_almacenamiento,z.clase_abc
     FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
     WHERE u.id=? FOR UPDATE`,
    [locationId],
  );
  if (!location || !location.activo || !location.permite_almacenaje)
    throw new AppError("La LOC destino no admite almacenamiento", 409);
  const [[usage]] = await conn.execute(
    `SELECT COALESCE(SUM(cantidad_actual),0) ocupadas,
      COALESCE(SUM(cantidad_actual>0),0) hu_ocupadas
     FROM lotes WHERE ubicacion_id=?`,
    [locationId],
  );
  location.ocupadas = Number(usage.ocupadas);
  location.hu_ocupadas = Number(usage.hu_ocupadas);
  let inbound = 0;
  if (reserveOpen) {
    const [[planned]] = await conn.execute(
      `SELECT COUNT(*) slots,COALESCE(SUM(cantidad),0) units FROM tareas_almacen
       WHERE ubicacion_destino_id=? AND estado IN ('PENDIENTE','EN_PROCESO')`,
      [locationId],
    );
    inbound =
      location.modelo_plano === "CD1"
        ? Number(planned.slots)
        : Number(planned.units);
  }
  if (location.modelo_plano === "CD1") {
    if (location.hu_ocupadas + inbound >= location.capacidad_hu)
      throw new AppError(
        `La LOC ${location.codigo_loc} ya está ocupada o reservada por otra tarea`,
        409,
      );
    return location;
  }
  if (location.ocupadas + inbound + quantity > location.capacidad_unidades)
    throw new AppError(
      `La LOC ${location.codigo_loc} no tiene capacidad para ${quantity} unidades`,
      409,
    );
  return location;
}

async function createTaskRecord(
  conn,
  {
    type,
    lotId,
    destinationId,
    quantity,
    priority = "NORMAL",
    userId,
    observations = null,
    reference = null,
    branchOrderLineId = null,
  },
) {
  if (!TASK_TYPES.includes(type) || !PRIORITIES.includes(priority))
    throw new AppError("Tipo o prioridad de tarea WMS inválidos");
  const qty = Number(quantity),
    lot = Number(lotId),
    destination = Number(destinationId);
  if (
    !Number.isInteger(qty) ||
    qty < 1 ||
    qty > 10000000 ||
    !Number.isInteger(lot) ||
    !Number.isInteger(destination)
  )
    throw new AppError("Datos de tarea WMS inválidos");
  const [[origin]] = await conn.execute(
    `SELECT l.*,p.sku,p.nombre producto,p.ubicacion_picking_id,p.control_vencimiento,
      l.fecha_vencimiento<CURRENT_DATE vencido,
      p.stock_objetivo_pick,p.clase_abc,u.codigo_loc loc_origen,u.tipo tipo_origen,
      u.permite_recepcion origen_recepcion,u.permite_picking origen_picking,
      pz.condicion_almacenamiento condicion_requerida
     FROM lotes l JOIN productos p ON p.id=l.producto_id
     JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
     LEFT JOIN ubicaciones_almacen pp ON pp.id=p.ubicacion_picking_id
     LEFT JOIN zonas_almacen pz ON pz.id=pp.zona_id
     WHERE l.id=? FOR UPDATE`,
    [lot],
  );
  if (!origin || origin.cantidad_actual < qty)
    throw new AppError("El lote origen no tiene cantidad suficiente", 409);
  const operationalReference = String(reference || "").trim();
  if (["PICKING", "DEVOLUCION_RUTA"].includes(type) && !operationalReference)
    throw new AppError(
      "El pedido o la devolución debe tener una referencia trazable",
      409,
    );
  if (operationalReference.length > 60)
    throw new AppError("La referencia operativa admite 60 caracteres");
  if (type === "PICKING" && !branchOrderLineId)
    throw new AppError(
      "El picking debe pertenecer a un pedido de sucursal planificado",
      409,
    );
  if (branchOrderLineId) {
    if (type !== "PICKING")
      throw new AppError(
        "Solo picking puede enlazarse a un pedido de sucursal",
        409,
      );
    const [[line]] = await conn.execute(
      `SELECT d.producto_id,o.estado FROM pedidos_sucursal_detalle d
       JOIN pedidos_sucursal o ON o.id=d.pedido_id WHERE d.id=? FOR UPDATE`,
      [branchOrderLineId],
    );
    if (
      !line ||
      Number(line.producto_id) !== Number(origin.producto_id) ||
      !["PENDIENTE", "EN_PREPARACION"].includes(line.estado)
    )
      throw new AppError(
        "La línea del pedido no corresponde al SKU o ya no admite picking",
        409,
      );
  }
  if (Number(origin.ubicacion_id) === destination)
    throw new AppError("La LOC origen y destino deben ser distintas");
  const destinationLocation = await locationWithCapacity(
    conn,
    destination,
    qty,
    true,
  );
  if (destinationLocation.permite_picking) {
    const [[owner]] = await conn.execute(
      `SELECT sku FROM productos WHERE ubicacion_picking_id=? AND activo=1
       AND id<>? LIMIT 1`,
      [destination, origin.producto_id],
    );
    if (owner)
      throw new AppError(
        `La cara ${destinationLocation.codigo_loc} pertenece al SKU ${owner.sku}`,
        409,
      );
  }
  if (
    destinationLocation.tipo === "RESERVA" &&
    destinationLocation.clase_abc &&
    destinationLocation.clase_abc !== origin.clase_abc
  )
    throw new AppError(
      `El SKU ${origin.sku} es clase ${origin.clase_abc}; la reserva destino es clase ${destinationLocation.clase_abc}`,
      409,
    );
  if (
    origin.condicion_requerida &&
    destinationLocation.condicion_almacenamiento !== origin.condicion_requerida
  )
    throw new AppError(
      `El SKU ${origin.sku} requiere zona ${origin.condicion_requerida}; ${destinationLocation.codigo_loc} no es compatible`,
      409,
    );
  if (type === "PUTAWAY" && !origin.origen_recepcion)
    throw new AppError("El put-away debe partir de una LOC de recepción", 409);
  if (
    type === "PUTAWAY" &&
    !["RESERVA", "PICKING"].includes(destinationLocation.tipo)
  )
    throw new AppError(
      "Desde recepción solo se ubica en reserva o picking",
      409,
    );
  if (type === "REUBICACION") {
    if (
      !["RESERVA", "PICKING"].includes(origin.tipo_origen) ||
      !["RESERVA", "PICKING"].includes(destinationLocation.tipo)
    )
      throw new AppError(
        "La reubicación solo conecta LOC de reserva y picking",
        409,
      );
    if (origin.estado_inventario !== "DISPONIBLE")
      throw new AppError(
        "El stock bloqueado requiere revisión, no reubicación",
        409,
      );
  }
  if (type === "REABASTECIMIENTO") {
    if (origin.control_vencimiento && (origin.fecha_vencimiento == null || origin.vencido))
      throw new AppError("Ese lote no está apto para reponer: revisa su vencimiento", 409);
    if (origin.tipo_origen !== "RESERVA")
      throw new AppError(
        "Para reponer picking, el origen debe ser una LOC de reserva",
        409,
      );
    if (origin.estado_inventario !== "DISPONIBLE")
      throw new AppError(
        "Solo el inventario DISPONIBLE puede abastecer una cara de picking",
        409,
      );
    if (!origin.ubicacion_picking_id || origin.stock_objetivo_pick < 1)
      throw new AppError(
        `El SKU ${origin.sku} no tiene LOC primaria y objetivo de picking configurados`,
        409,
      );
    if (!destinationLocation.permite_picking)
      throw new AppError(
        "El reabastecimiento debe terminar en una LOC de picking",
        409,
      );
    // En picking activo, una cara dinámica vacía evita mezclar lotes/HU
    // cuando la LOC primaria ya está ocupada por otro lote.
    const [pickLots] = await conn.execute(
      `SELECT l.id,l.cantidad_actual FROM lotes l
       JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
       JOIN productos pp ON pp.id=l.producto_id
       WHERE l.producto_id=? AND u.permite_picking=1 AND u.activo=1
       AND l.estado_inventario='DISPONIBLE'
       AND (pp.control_vencimiento=0 OR l.fecha_vencimiento>=CURRENT_DATE) FOR UPDATE`,
      [origin.producto_id],
    );
    const currentPick = pickLots.reduce(
      (total, position) => total + Number(position.cantidad_actual),
      0,
    );
    const [[plannedPick]] = await conn.execute(
      `SELECT COALESCE(SUM(t.cantidad),0) cantidad FROM tareas_almacen t
       JOIN ubicaciones_almacen u ON u.id=t.ubicacion_destino_id
       WHERE t.producto_id=? AND t.tipo IN ('PUTAWAY','REABASTECIMIENTO')
         AND t.estado IN ('PENDIENTE','EN_PROCESO') AND u.permite_picking=1`,
      [origin.producto_id],
    );
    const deficit = Math.max(
      Number(origin.stock_objetivo_pick) -
        currentPick -
        Number(plannedPick.cantidad),
      0,
    );
    if (!deficit)
      throw new AppError(
        `La cara de picking de ${origin.sku} ya alcanzó su objetivo (${origin.stock_objetivo_pick} UND)`,
        409,
      );
    if (qty > deficit)
      throw new AppError(
        `La cantidad supera la necesidad de picking. Máximo permitido: ${deficit} UND`,
        409,
      );
  }
  if (type === "PICKING") {
    if (origin.tipo_origen !== "PICKING" || !origin.origen_picking)
      throw new AppError(
        "El picking debe iniciar en una LOC habilitada para preparación",
        409,
      );
    if (origin.estado_inventario !== "DISPONIBLE")
      throw new AppError("Solo stock DISPONIBLE puede prepararse", 409);
    if (destinationLocation.tipo !== "DESPACHO")
      throw new AppError(
        "El picking debe terminar en una LOC de despacho/staging",
        409,
      );
  }
  if (type === "DEVOLUCION_RUTA") {
    if (!["DESPACHO", "RECEPCION"].includes(origin.tipo_origen))
      throw new AppError(
        "La devolución de ruta debe partir de despacho/staging o recepción",
        409,
      );
    if (destinationLocation.tipo !== "CUARENTENA")
      throw new AppError(
        "Las devoluciones de ruta deben aislarse en cuarentena",
        409,
      );
  }
  const [open] = await conn.execute(
    `SELECT id,cantidad FROM tareas_almacen WHERE lote_origen_id=?
     AND estado IN ('PENDIENTE','EN_PROCESO') FOR UPDATE`,
    [lot],
  );
  const reserved = open.reduce((sum, task) => sum + Number(task.cantidad), 0);
  if (reserved + qty > Number(origin.cantidad_actual))
    throw new AppError(
      `El lote ya tiene ${reserved} UND comprometidas; no alcanza para esta tarea`,
      409,
    );
  const [result] = await conn.execute(
    `INSERT INTO tareas_almacen
     (codigo_tarea,tipo,prioridad,producto_id,lote_origen_id,ubicacion_origen_id,
      ubicacion_destino_id,cantidad,creado_por,referencia_operativa,pedido_sucursal_detalle_id,observaciones)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      temporaryCode("T"),
      type,
      priority,
      origin.producto_id,
      origin.id,
      origin.ubicacion_id,
      destination,
      qty,
      userId,
      operationalReference || null,
      branchOrderLineId || null,
      String(observations || "")
        .trim()
        .slice(0, 500) || null,
    ],
  );
  const code = warehouseTaskCode(result.insertId);
  await conn.execute("UPDATE tareas_almacen SET codigo_tarea=? WHERE id=?", [
    code,
    result.insertId,
  ]);
  return { id: result.insertId, code };
}

async function createWarehouseTask(data) {
  if (!["REUBICACION", "REABASTECIMIENTO"].includes(data.type))
    throw new AppError(
      "Las tareas de picking y retorno nacen de un pedido de sucursal, no del asistente libre",
      409,
    );
  return transaction(async (conn) => {
    await requireActorPermission(conn, data.userId, "wms.tasks.create");
    const task = await createTaskRecord(conn, data);
    if (data.operatorId != null && data.operatorId !== "") {
      task.assignedTo = await assignTaskRecord(conn, {
        taskId: task.id, operatorId: data.operatorId, userId: data.userId,
      });
    }
    return task;
  });
}

async function suggestPutawayDestination(
  conn,
  productId,
  originLocationId,
  qty,
) {
  const [locations] = await conn.execute(
    `SELECT u.*,COALESCE(SUM(l.cantidad_actual),0) ocupadas,
      COALESCE(SUM(l.cantidad_actual>0),0) hu_ocupadas,
      COALESCE((SELECT COUNT(*) FROM tareas_almacen t
        WHERE t.ubicacion_destino_id=u.id AND t.estado IN ('PENDIENTE','EN_PROCESO')),0) inbound,
      (u.id=p.ubicacion_picking_id) preferida
     FROM productos p JOIN ubicaciones_almacen u ON u.activo=1 AND u.permite_almacenaje=1
     JOIN zonas_almacen uz ON uz.id=u.zona_id
     LEFT JOIN ubicaciones_almacen pp ON pp.id=p.ubicacion_picking_id
     LEFT JOIN zonas_almacen pz ON pz.id=pp.zona_id
     LEFT JOIN lotes l ON l.ubicacion_id=u.id
     WHERE p.id=? AND u.id<>? AND u.tipo IN ('PICKING','RESERVA')
     AND (pz.id IS NULL OR uz.condicion_almacenamiento=pz.condicion_almacenamiento)
     AND (u.tipo<>'RESERVA' OR uz.clase_abc IS NULL OR uz.clase_abc=p.clase_abc)
     AND (u.tipo<>'PICKING' OR (
       NOT EXISTS (SELECT 1 FROM productos owner WHERE owner.ubicacion_picking_id=u.id
         AND owner.id<>p.id AND owner.activo=1)
       AND ?<=GREATEST(p.stock_objetivo_pick-COALESCE(
         (SELECT SUM(lp.cantidad_actual) FROM lotes lp
          JOIN ubicaciones_almacen pu ON pu.id=lp.ubicacion_id
          WHERE lp.producto_id=p.id AND lp.estado_inventario='DISPONIBLE'
            AND (p.control_vencimiento=0 OR lp.fecha_vencimiento>=CURRENT_DATE)
            AND pu.permite_picking=1 AND pu.activo=1),0)-COALESCE(
         (SELECT SUM(tp.cantidad) FROM tareas_almacen tp
          JOIN ubicaciones_almacen dp ON dp.id=tp.ubicacion_destino_id
          WHERE tp.producto_id=p.id AND tp.tipo IN ('PUTAWAY','REABASTECIMIENTO')
            AND tp.estado IN ('PENDIENTE','EN_PROCESO') AND dp.permite_picking=1),0),0)))
     GROUP BY u.id,p.id,p.ubicacion_picking_id,p.stock_objetivo_pick
     HAVING (u.modelo_plano='CD1' AND hu_ocupadas+inbound<u.capacidad_hu)
       OR (u.modelo_plano<>'CD1' AND ocupadas+inbound+?<=u.capacidad_unidades)
     ORDER BY preferida DESC,FIELD(u.tipo,'PICKING','RESERVA'),u.secuencia_putaway,u.id
     LIMIT 1`,
    [productId, originLocationId, qty, qty],
  );
  if (!locations[0])
    throw new AppError(
      "No existe una LOC de almacenaje con capacidad para generar el put-away",
      409,
    );
  return locations[0];
}

async function startWarehouseTask({ taskId, userId }) {
  return transaction(async (conn) => {
    const actor = await requireActorPermission(conn, userId, "wms.tasks.execute");
    const [[task]] = await conn.execute(
      "SELECT * FROM tareas_almacen WHERE id=? FOR UPDATE",
      [taskId],
    );
    if (!task || task.estado !== "PENDIENTE")
      throw new AppError("La tarea ya no está pendiente", 409);
    requireAssignedOperator(task, userId);
    require("./accessPolicy").requireTaskCapability(actor,task);
    await conn.execute(
      `UPDATE tareas_almacen SET estado='EN_PROCESO',asignado_a=?,iniciado_en=CURRENT_TIMESTAMP
       WHERE id=?`,
      [userId, task.id],
    );
    return task;
  });
}

async function assignTaskRecord(conn, { taskId, operatorId, userId }) {
    if (!Number.isInteger(Number(operatorId)) || Number(operatorId) < 1)
      throw new AppError("Selecciona un operador RF activo", 422);
    await requireActorPermission(conn, userId, "wms.tasks.assign");
    const [[task]] = await conn.execute(
      "SELECT id,estado,tipo FROM tareas_almacen WHERE id=? FOR UPDATE",
      [taskId],
    );
    if (!task || task.estado !== "PENDIENTE")
      throw new AppError("Solo se puede asignar una tarea pendiente", 409);
    const [[operator]] = await conn.execute(
      `SELECT u.id,u.nombre FROM usuarios u JOIN roles r ON r.id=u.rol_id
       WHERE u.id=? AND u.activo=1 AND r.perfil='operador_rf' AND r.activo=1`,
      [operatorId],
    );
    if (!operator) throw new AppError("Selecciona un operador RF activo", 409);
    const identity=await requireActorPermission(conn,operatorId,"wms.tasks.execute");
    require("./accessPolicy").requireTaskCapability(identity,task);
    await conn.execute("UPDATE tareas_almacen SET asignado_a=? WHERE id=?", [
      operator.id,
      taskId,
    ]);
    return operator;
}

async function assignWarehouseTask(data) {
  return transaction((conn) => assignTaskRecord(conn, data));
}

async function completeWarehouseTask({
  taskId,
  userId,
  role,
  scannedOrigin = "",
  scannedProduct = "",
  scannedDestination = "",
}) {
  return transaction(async (conn) => {
    const actor = await requireActorPermission(
      conn,
      userId,
      "wms.tasks.execute",
    );
    role = actor.perfil || actor.rol;
    const [[task]] = await conn.execute(
      `SELECT t.*,p.stock_objetivo_pick,p.sku,p.codigo_barras,p.control_lote,p.control_vencimiento,l.numero_lote,
       l.lote_fabricante_id,hu.codigo_hu,
       ori.codigo_loc loc_origen,dst.codigo_loc loc_destino,
       pz.condicion_almacenamiento condicion_requerida
       FROM tareas_almacen t JOIN productos p ON p.id=t.producto_id
       JOIN lotes l ON l.id=t.lote_origen_id
       LEFT JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
       JOIN ubicaciones_almacen ori ON ori.id=t.ubicacion_origen_id
       JOIN ubicaciones_almacen dst ON dst.id=t.ubicacion_destino_id
       LEFT JOIN ubicaciones_almacen pp ON pp.id=p.ubicacion_picking_id
       LEFT JOIN zonas_almacen pz ON pz.id=pp.zona_id
       WHERE t.id=? FOR UPDATE`,
      [taskId],
    );
    if (!task || task.estado !== "EN_PROCESO")
      throw new AppError("Primero debes iniciar la tarea", 409);
    requireAssignedOperator(task, userId);
    require("./accessPolicy").requireTaskCapability(actor,task);
    if (role === "operador_rf") {
      const normalize = (value) =>
        String(value || "")
          .trim()
          .toUpperCase();
      const originCode = normalize(scannedOrigin);
      const productCode = normalize(scannedProduct);
      const destinationCode = normalize(scannedDestination);
      if (originCode !== normalize(task.loc_origen))
        throw new AppError(
          `Origen incorrecto. Escanea la etiqueta de la LOC ${task.loc_origen}`,
          409,
        );
      if (!require("../utils/rfIdentity").matchesTaskLoad({
        ...task, codigo_lote_wms: lotCode(task.lote_fabricante_id),
      }, productCode))
        throw new AppError(
          `Carga incorrecta. Confirma el lote ${lotCode(task.lote_fabricante_id)} o la HU ${task.codigo_hu || "asignada"}; el EAN solo identifica el producto.`,
          409,
        );
      if (destinationCode !== normalize(task.loc_destino))
        throw new AppError(
          `Destino incorrecto. Escanea la etiqueta de la LOC ${task.loc_destino}`,
          409,
        );
    }
    const [[origin]] = await conn.execute(
      "SELECT *,fecha_vencimiento<CURRENT_DATE vencido FROM lotes WHERE id=? FOR UPDATE",
      [task.lote_origen_id],
    );
    if (!origin || origin.cantidad_actual < task.cantidad)
      throw new AppError(
        "El stock de la LOC origen cambió; revisa la tarea",
        409,
      );
    if (
      ["PICKING", "REABASTECIMIENTO"].includes(task.tipo) &&
      (origin.estado_inventario !== "DISPONIBLE" ||
        (task.control_vencimiento &&
          (origin.fecha_vencimiento == null || origin.vencido)))
    )
      throw new AppError(
        "El lote quedó bloqueado o vencido; cancela y vuelve a planificar",
        409,
      );
    if (task.tipo === "PICKING" && !task.pedido_sucursal_detalle_id)
      throw new AppError(
        "Este picking legado no tiene pedido de sucursal; debe cancelarse y planificarse de nuevo",
        409,
      );
    if (task.tipo === "REABASTECIMIENTO") {
      const [pickLots] = await conn.execute(
        `SELECT l.id,l.cantidad_actual FROM lotes l
         JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
         JOIN productos pp ON pp.id=l.producto_id
         WHERE l.producto_id=? AND u.permite_picking=1 AND u.activo=1
         AND l.estado_inventario='DISPONIBLE'
         AND (pp.control_vencimiento=0 OR l.fecha_vencimiento>=CURRENT_DATE) FOR UPDATE`,
        [task.producto_id],
      );
      const currentPick = pickLots.reduce(
        (total, position) => total + Number(position.cantidad_actual),
        0,
      );
      if (
        currentPick + Number(task.cantidad) >
        Number(task.stock_objetivo_pick)
      )
        throw new AppError(
          `Otra tarea cambió el stock de picking. Hoy solo caben ${Math.max(Number(task.stock_objetivo_pick) - currentPick, 0)} UND; cancela y vuelve a planificar`,
          409,
        );
    }
    const destination = await locationWithCapacity(
      conn,
      task.ubicacion_destino_id,
      task.cantidad,
    );
    if (
      task.condicion_requerida &&
      destination.condicion_almacenamiento !== task.condicion_requerida
    )
      throw new AppError(
        `La estrategia térmica del SKU ${task.sku} cambió; cancela y vuelve a planificar la tarea`,
        409,
      );
    await conn.execute(
      "UPDATE lotes SET cantidad_actual=cantidad_actual-? WHERE id=?",
      [task.cantidad, origin.id],
    );
    // El lote de fabricación permanece invariable. Una expedición o un split
    // recibe su propia HU, sin falsificar la trazabilidad del fabricante.
    let handlingUnitId = origin.unidad_logistica_id || null;
    if (task.tipo === "PICKING")
      handlingUnitId = await createHandlingUnit(
        conn,
        `HU-PS-${task.pedido_sucursal_detalle_id}-${task.id}`,
        "PEDIDO",
        task.referencia_operativa,
      );
    else if (
      handlingUnitId &&
      Number(origin.cantidad_actual) > Number(task.cantidad)
    )
      handlingUnitId = await createHandlingUnit(
        conn,
        `HU-SPLIT-${task.id}`,
        "CAJA",
        task.codigo_tarea,
      );
    const [[existing]] = await conn.execute(
      `SELECT * FROM lotes WHERE producto_id=? AND lote_fabricante_id=?
       AND ubicacion_id=? AND estado_inventario=? AND unidad_logistica_id <=> ? FOR UPDATE`,
      [
        origin.producto_id,
        origin.lote_fabricante_id,
        destination.id,
        task.tipo === "DEVOLUCION_RUTA"
          ? "CUARENTENA"
          : origin.estado_inventario,
        handlingUnitId,
      ],
    );
    let destinationLotId;
    const destinationState =
      task.tipo === "DEVOLUCION_RUTA" ? "CUARENTENA" : origin.estado_inventario;
    if (existing) {
      if (existing.estado_inventario !== destinationState)
        throw new AppError(
          "El mismo lote existe en destino con otro estado de inventario",
          409,
        );
      await conn.execute(
        `UPDATE lotes SET cantidad_inicial=cantidad_inicial+?,cantidad_actual=cantidad_actual+?
         WHERE id=?`,
        [task.cantidad, task.cantidad, existing.id],
      );
      destinationLotId = existing.id;
    } else {
      const [created] = await conn.execute(
        `INSERT INTO lotes
         (numero_lote,lote_fabricante_id,unidad_logistica_id,producto_id,ubicacion_id,orden_compra_id,cantidad_inicial,cantidad_actual,
          fecha_ingreso,fecha_vencimiento,estado_inventario)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [
          origin.numero_lote,
          origin.lote_fabricante_id,
          handlingUnitId,
          origin.producto_id,
          destination.id,
          origin.orden_compra_id,
          task.cantidad,
          task.cantidad,
          origin.fecha_ingreso,
          origin.fecha_vencimiento,
          destinationState,
        ],
      );
      destinationLotId = created.insertId;
    }
    const reason = `${task.codigo_tarea}: ${task.tipo} ${task.cantidad} UND · confirmado RF`;
    await conn.execute(
      `INSERT INTO movimientos_almacen
       (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,referencia_id,motivo)
       VALUES (?,?,?,'SALIDA',?,'TRASLADO',?,?),(?,?,?,'ENTRADA',?,'TRASLADO',?,?)`,
      [
        task.producto_id,
        origin.id,
        userId,
        task.cantidad,
        task.id,
        reason,
        task.producto_id,
        destinationLotId,
        userId,
        task.cantidad,
        task.id,
        reason,
      ],
    );
    await conn.execute(
      `UPDATE tareas_almacen SET estado='COMPLETADA',lote_destino_id=?,completado_en=CURRENT_TIMESTAMP
       WHERE id=?`,
      [destinationLotId, task.id],
    );
    if (task.pedido_sucursal_detalle_id) {
      const [[order]] = await conn.execute(
        `SELECT o.id FROM pedidos_sucursal o JOIN pedidos_sucursal_detalle d ON d.pedido_id=o.id
         WHERE d.id=? FOR UPDATE`,
        [task.pedido_sucursal_detalle_id],
      );
      const [lines] = await conn.execute(
        `SELECT d.cantidad_solicitada,
          COALESCE(SUM(CASE WHEN t.estado='COMPLETADA' THEN t.cantidad ELSE 0 END),0) preparada
         FROM pedidos_sucursal_detalle d LEFT JOIN tareas_almacen t
         ON t.pedido_sucursal_detalle_id=d.id AND t.tipo='PICKING'
         WHERE d.pedido_id=? GROUP BY d.id`,
        [order.id],
      );
      if (
        lines.every(
          (line) => Number(line.preparada) === Number(line.cantidad_solicitada),
        )
      )
        await conn.execute(
          "UPDATE pedidos_sucursal SET estado='LISTO' WHERE id=? AND estado='EN_PREPARACION'",
          [order.id],
        );
    }
    return task;
  });
}

async function cancelWarehouseTask({ taskId, userId }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "wms.tasks.manage");
    const [[task]] = await conn.execute(
      "SELECT * FROM tareas_almacen WHERE id=? FOR UPDATE",
      [taskId],
    );
    if (!task || !["PENDIENTE", "EN_PROCESO"].includes(task.estado))
      throw new AppError("La tarea no puede cancelarse", 409);
    await conn.execute(
      "UPDATE tareas_almacen SET estado='CANCELADA',completado_en=CURRENT_TIMESTAMP WHERE id=?",
      [task.id],
    );
  });
}

module.exports = {
  createTaskRecord,
  createWarehouseTask,
  suggestPutawayDestination,
  startWarehouseTask,
  assignWarehouseTask,
  assignTaskRecord,
  completeWarehouseTask,
  cancelWarehouseTask,
};
