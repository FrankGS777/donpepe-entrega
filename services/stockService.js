const AppError = require("../utils/AppError");

async function resolveManufacturerBatch(conn, productId, code, expiry, verified = false) {
  const batchCode = String(code || "").trim();
  if (!batchCode || batchCode.length > 50)
    throw new AppError("El lote del fabricante debe tener entre 1 y 50 caracteres", 422);
  await conn.execute(
    `INSERT IGNORE INTO lotes_fabricante
     (producto_id,codigo_lote,fecha_vencimiento,fecha_verificada)
     VALUES (?,?,?,?)`,
    [productId, batchCode, expiry || null, verified ? 1 : 0],
  );
  const [[batch]] = await conn.execute(
    `SELECT id,DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d') fecha_vencimiento,
      fecha_verificada,requiere_revision FROM lotes_fabricante
     WHERE producto_id=? AND codigo_lote=? FOR UPDATE`,
    [productId, batchCode],
  );
  if (batch.requiere_revision)
    throw new AppError(`El lote ${batchCode} tiene fechas contradictorias; requiere conciliación`, 409);
  if (batch.fecha_vencimiento && expiry && batch.fecha_vencimiento !== expiry)
    throw new AppError(`El lote ${batchCode} ya está registrado con otro vencimiento`, 409);
  if (verified && !expiry)
    throw new AppError("Un lote con caducidad controlada requiere fecha impresa verificada", 422);
  if (verified && !batch.fecha_vencimiento) {
    const [[conflict]] = await conn.execute(
      `SELECT COUNT(*) total FROM lotes
       WHERE lote_fabricante_id=? AND fecha_vencimiento IS NOT NULL
         AND fecha_vencimiento<>?`,
      [batch.id, expiry],
    );
    if (Number(conflict.total))
      throw new AppError(`El lote ${batchCode} tiene posiciones con otro vencimiento; requiere conciliación`, 409);
    await conn.execute(
      "UPDATE lotes SET fecha_vencimiento=? WHERE lote_fabricante_id=? AND fecha_vencimiento IS NULL",
      [expiry, batch.id],
    );
    await conn.execute(
      "UPDATE lotes_fabricante SET fecha_vencimiento=?,fecha_verificada=1 WHERE id=?",
      [expiry, batch.id],
    );
  }
  else if (verified && !batch.fecha_verificada)
    await conn.execute("UPDATE lotes_fabricante SET fecha_verificada=1 WHERE id=?", [batch.id]);
  return batch.id;
}

async function createHandlingUnit(conn, code, type, reference = null) {
  await conn.execute(
    `INSERT IGNORE INTO unidades_logisticas (codigo_hu,tipo,referencia) VALUES (?,?,?)`,
    [code, type, reference],
  );
  const [[unit]] = await conn.execute(
    "SELECT id,tipo FROM unidades_logisticas WHERE codigo_hu=? FOR UPDATE",
    [code],
  );
  if (unit.tipo !== type)
    throw new AppError(`La unidad logística ${code} ya pertenece a otro flujo`, 409);
  return unit.id;
}

async function decreaseFifo(
  conn,
  {
    productoId,
    cantidad,
    usuarioId,
    referenciaTipo,
    referenciaId,
    motivo,
    allowExpired = false,
    locationId = null,
    requirePicking = false,
    inventoryState = null,
    batchCode = null,
  },
) {
  const expiryFilter = allowExpired
    ? ""
    : " AND (p.control_vencimiento=0 OR l.fecha_vencimiento>=CURRENT_DATE)";
  const locationFilter = locationId ? " AND l.ubicacion_id=?" : "";
  const pickingFilter = requirePicking ? " AND u.permite_picking=1" : "";
  const stateFilter = inventoryState ? " AND l.estado_inventario=?" : "";
  const batchFilter = batchCode ? " AND b.codigo_lote=?" : "";
  const params = [productoId];
  if (locationId) params.push(locationId);
  if (inventoryState) params.push(inventoryState);
  if (batchCode) params.push(batchCode);
  const [lots] = await conn.execute(
    `SELECT l.id,l.cantidad_actual FROM lotes l
    JOIN productos p ON p.id=l.producto_id
    JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
    JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
    WHERE l.producto_id=? AND l.cantidad_actual>0${expiryFilter}${locationFilter}${pickingFilter}${stateFilter}${batchFilter}
    ORDER BY u.secuencia_pick,l.fecha_vencimiento,l.id FOR UPDATE`,
    params,
  );
  const available = lots.reduce((sum, lot) => sum + lot.cantidad_actual, 0);
  if (available < cantidad)
    throw new AppError(
      `Stock disponible insuficiente: disponible ${available}, solicitado ${cantidad}. Revisa estado, vencimiento y LOC origen.`,
      409,
    );
  let pending = cantidad;
  const allocations = [];
  for (const lot of lots) {
    if (!pending) break;
    const taken = Math.min(pending, lot.cantidad_actual);
    await conn.execute(
      "UPDATE lotes SET cantidad_actual=cantidad_actual-? WHERE id=?",
      [taken, lot.id],
    );
    await conn.execute(
      `INSERT INTO movimientos_almacen
      (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,referencia_id,motivo)
      VALUES (?,?,?,'SALIDA',?,?,?,?)`,
      [
        productoId,
        lot.id,
        usuarioId,
        taken,
        referenciaTipo,
        referenciaId,
        motivo,
      ],
    );
    allocations.push({ lotId: lot.id, quantity: taken });
    pending -= taken;
  }
  await conn.execute(
    "UPDATE productos SET stock_total=stock_total-? WHERE id=?",
    [cantidad, productoId],
  );
  return allocations;
}

async function addLot(conn, data) {
  const batchId = await resolveManufacturerBatch(
    conn,
    data.productoId,
    data.numeroLote,
    data.fechaVencimiento,
    Boolean(data.expiryVerified),
  );
  const handlingUnitId = data.handlingUnitId || null;
  const [[location]] = await conn.execute(
    "SELECT * FROM ubicaciones_almacen WHERE id=? FOR UPDATE",
    [data.ubicacionId],
  );
  if (!location || !location.activo)
    throw new AppError("La LOC seleccionada no está activa", 409);
  const [[existing]] = await conn.execute(
    `SELECT id,DATE_FORMAT(fecha_ingreso,'%Y-%m-%d') fecha_ingreso,
      DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d') fecha_vencimiento,
      estado_inventario,orden_compra_id
     FROM lotes WHERE producto_id=? AND lote_fabricante_id=? AND ubicacion_id=?
       AND estado_inventario=? AND unidad_logistica_id <=> ? FOR UPDATE`,
    [data.productoId, batchId, data.ubicacionId, data.inventoryState || "DISPONIBLE", handlingUnitId],
  );
  const [occupants] = await conn.execute(
    `SELECT id,cantidad_actual FROM lotes WHERE ubicacion_id=? AND cantidad_actual>0 FOR UPDATE`,
    [data.ubicacionId],
  );
  if (location.modelo_plano === "CD1") {
    if (occupants.some((position) => Number(position.id) !== Number(existing?.id)))
      throw new AppError(`La LOC ${location.codigo_loc} ya contiene otra HU o lote; selecciona un casillero vacío`, 409);
  } else {
    const occupiedUnits = occupants.reduce((sum, position) => sum + Number(position.cantidad_actual), 0);
    if (occupiedUnits + Number(data.cantidad) > Number(location.capacidad_unidades))
      throw new AppError(`La LOC ${location.codigo_loc} no tiene capacidad suficiente`, 409);
  }
  let lotId;
  if (existing) {
    if (
      existing.estado_inventario !== (data.inventoryState || "DISPONIBLE") ||
      existing.fecha_vencimiento !== (data.fechaVencimiento || null)
    )
      throw new AppError(
        "El lote ya existe en esta LOC con vencimiento o estado distintos; verifica la etiqueta y separa el ingreso",
        409,
      );
    await conn.execute(
      `UPDATE lotes SET cantidad_inicial=cantidad_inicial+?,cantidad_actual=cantidad_actual+?,
       fecha_ingreso=LEAST(fecha_ingreso,?),
       orden_compra_id=IF(orden_compra_id <=> ?,orden_compra_id,NULL) WHERE id=?`,
      [
        data.cantidad,
        data.cantidad,
        data.fechaIngreso,
        data.ordenCompraId || null,
        existing.id,
      ],
    );
    lotId = existing.id;
  } else {
    const [result] = await conn.execute(
      `INSERT INTO lotes
      (numero_lote,lote_fabricante_id,unidad_logistica_id,producto_id,ubicacion_id,orden_compra_id,cantidad_inicial,cantidad_actual,
       fecha_ingreso,fecha_vencimiento,estado_inventario)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        data.numeroLote,
        batchId,
        handlingUnitId,
        data.productoId,
        data.ubicacionId,
        data.ordenCompraId || null,
        data.cantidad,
        data.cantidad,
        data.fechaIngreso,
        data.fechaVencimiento,
        data.inventoryState || "DISPONIBLE",
      ],
    );
    lotId = result.insertId;
  }
  await conn.execute(
    "UPDATE productos SET stock_total=stock_total+? WHERE id=?",
    [data.cantidad, data.productoId],
  );
  await conn.execute(
    `INSERT INTO movimientos_almacen
    (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,referencia_id,motivo)
    VALUES (?,?,?,'ENTRADA',?,?,?,?)`,
    [
      data.productoId,
      lotId,
      data.usuarioId,
      data.cantidad,
      data.referenciaTipo,
      data.referenciaId,
      data.motivo,
    ],
  );
  return lotId;
}
module.exports = { decreaseFifo, addLot, resolveManufacturerBatch, createHandlingUnit };
