const { transaction } = require("../config/db");
const { requireActorPermission } = require("./accessPolicy");
const {
  purchaseCode,
  temporaryCode,
  handlingUnitCode,
} = require("../utils/codes");
const { addLot, createHandlingUnit } = require("./stockService");
const AppError = require("../utils/AppError");
const { roundMoney } = require("../utils/numbers");
const { createTaskRecord, suggestPutawayDestination } = require("./wmsService");
const { todayInLima } = require("../utils/dates");

function validItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100)
    throw new AppError("La orden debe contener entre 1 y 100 productos");
  const grouped = new Map();
  for (const item of items) {
    const product = Number(item.producto_id),
      quantity = Number(item.cantidad),
      price = roundMoney(item.precio);
    if (
      !Number.isInteger(product) ||
      product < 1 ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      quantity > 100000 ||
      !Number.isFinite(price) ||
      price < 0 ||
      price > 999999.99
    )
      throw new AppError("Detalle de compra inválido");
    const current = grouped.get(product);
    if (current && current.price !== price)
      throw new AppError(
        "Un producto repetido no puede tener dos costos distintos",
      );
    grouped.set(product, {
      product,
      quantity: (current?.quantity || 0) + quantity,
      price,
    });
  }
  return [...grouped.values()];
}

async function createPurchase({ providerId, userId, items: raw }) {
  const items = validItems(raw);
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "purchases.create");
    const provider = Number(providerId);
    if (!Number.isInteger(provider) || provider < 1)
      throw new AppError("Selecciona un proveedor válido");
    const [[providerRow]] = await conn.execute(
      "SELECT id FROM proveedores WHERE id=? AND activo=1 FOR UPDATE",
      [provider],
    );
    if (!providerRow)
      throw new AppError("El proveedor no existe o está inactivo", 409);
    const productIds = items.map((i) => i.product),
      placeholders = productIds.map(() => "?").join(",");
    const [products] = await conn.execute(
      `SELECT id FROM productos
       WHERE activo=1 AND proveedor_id=? AND id IN (${placeholders}) FOR UPDATE`,
      [provider, ...productIds],
    );
    if (products.length !== productIds.length)
      throw new AppError(
        "Uno o más SKU no pertenecen al proveedor seleccionado o están inactivos",
        409,
      );
    const total = roundMoney(
      items.reduce((s, i) => s + i.quantity * i.price, 0),
    );
    if (total > 99999999.99)
      throw new AppError("El total de la orden excede el límite permitido");
    const [order] = await conn.execute(
      "INSERT INTO ordenes_compra (codigo_orden,proveedor_id,usuario_id,total_estimado) VALUES (?,?,?,?)",
      [temporaryCode("C"), provider, userId, total],
    );
    const code = purchaseCode(order.insertId);
    await conn.execute("UPDATE ordenes_compra SET codigo_orden=? WHERE id=?", [
      code,
      order.insertId,
    ]);
    for (const i of items)
      await conn.execute(
        "INSERT INTO ordenes_compra_detalle (orden_id,producto_id,cantidad_solicitada,precio_unitario_compra) VALUES (?,?,?,?)",
        [order.insertId, i.product, i.quantity, i.price],
      );
    return { id: order.insertId, code };
  });
}

async function receivePurchase({ orderId, userId, items }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "rf.receive");
    const [[order]] = await conn.execute(
      "SELECT * FROM ordenes_compra WHERE id=? FOR UPDATE",
      [orderId],
    );
    if (!order || !["PENDIENTE", "PARCIAL"].includes(order.estado))
      throw new AppError("La orden ya no admite recepción", 409);
    const [details] = await conn.execute(
      "SELECT * FROM ordenes_compra_detalle WHERE orden_id=?",
      [orderId],
    );
    if (!Array.isArray(items) || items.length !== details.length)
      throw new AppError(
        "Debes registrar un lote por cada producto de la orden",
      );
    const detailMap = new Map(details.map((d) => [d.id, d]));
    const seen = new Set();
    let receivedNow = 0;
    for (const item of items) {
      const detailId = Number(item.detalle_id),
        locationId = Number(item.ubicacion_id),
        rawLot = String(item.numero_lote || "").trim(),
        quantity = Number(item.cantidad_recibida);
      const d = detailMap.get(detailId);
      const remaining = d
        ? Number(d.cantidad_solicitada) - Number(d.cantidad_recibida)
        : -1;
      if (
        !d ||
        seen.has(detailId) ||
        !Number.isInteger(quantity) ||
        quantity < 0 ||
        quantity > remaining ||
        rawLot.length > 50
      )
        throw new AppError("Detalle de recepción inválido");
      seen.add(detailId);
      if (!quantity) continue;
      if (!Number.isInteger(locationId) || locationId < 1)
        throw new AppError("Selecciona la LOC de recepción del lote", 422);
      const [[product]] = await conn.execute(
        `SELECT p.sku,p.control_lote,p.control_vencimiento,c.vida_util_dias,
         COALESCE(z.condicion_almacenamiento,'AMBIENTE') condicion_requerida
         FROM productos p JOIN categorias c ON c.id=p.categoria_id
         LEFT JOIN ubicaciones_almacen u ON u.id=p.ubicacion_picking_id
         LEFT JOIN zonas_almacen z ON z.id=u.zona_id
         WHERE p.id=? FOR UPDATE`,
        [d.producto_id],
      );
      const lot =
        rawLot || (!product.control_lote ? `INT-${order.id}-${d.id}` : "");
      if (!lot) throw new AppError(`Indica el lote del SKU ${product.sku}`);
      const arrivalDate = String(item.fecha_ingreso || "");
      const parsedDate = new Date(`${arrivalDate}T00:00:00Z`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(arrivalDate) ||
        !Number.isFinite(parsedDate.valueOf()) ||
        parsedDate.toISOString().slice(0, 10) !== arrivalDate ||
        arrivalDate > todayInLima()
      )
        throw new AppError(
          `Fecha de ingreso inválida o futura para el lote ${lot}`,
        );
      const [sameBatch] = await conn.execute(
        `SELECT DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d') fecha_vencimiento,
         fecha_verificada,requiere_revision
         FROM lotes_fabricante WHERE producto_id=? AND codigo_lote=? FOR UPDATE`,
        [d.producto_id, lot],
      );
      if (sameBatch[0]?.requiere_revision)
        throw new AppError(
          `El lote ${lot} requiere conciliación de fecha`,
          409,
        );
      const expiry =
        String(item.fecha_vencimiento || "").trim() ||
        (sameBatch[0]?.fecha_verificada
          ? sameBatch[0].fecha_vencimiento
          : null);
      if (product.control_vencimiento) {
        const parsedExpiry = new Date(`${expiry}T00:00:00Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(expiry || "") ||
          !Number.isFinite(parsedExpiry.valueOf()) ||
          parsedExpiry.toISOString().slice(0, 10) !== expiry ||
          expiry < todayInLima() ||
          expiry < arrivalDate
        )
          throw new AppError(
            `Escanea o registra la fecha de vencimiento impresa del lote ${lot}; no se estima desde la categoría`,
            422,
          );
      }
      const [[location]] = await conn.execute(
        `SELECT u.id,u.codigo_loc,z.condicion_almacenamiento FROM ubicaciones_almacen u
         JOIN zonas_almacen z ON z.id=u.zona_id
         WHERE u.id=? AND u.activo=1 AND u.permite_recepcion=1 AND u.tipo='RECEPCION'`,
        [locationId],
      );
      if (!location)
        throw new AppError(
          `Selecciona una LOC válida de recepción para ${lot}`,
        );
      if (location.condicion_almacenamiento !== product.condicion_requerida)
        throw new AppError(
          `${product.sku} requiere recepción ${product.condicion_requerida}; ${location.codigo_loc} no es compatible`,
          409,
        );
      const handlingUnitId = await createHandlingUnit(
        conn,
        handlingUnitCode(),
        "PALLET",
        order.codigo_orden,
      );
      const lotId = await addLot(conn, {
        numeroLote: lot,
        productoId: d.producto_id,
        ubicacionId: locationId,
        ordenCompraId: orderId,
        cantidad: quantity,
        handlingUnitId,
        fechaIngreso: item.fecha_ingreso,
        fechaVencimiento: expiry,
        expiryVerified: Boolean(product.control_vencimiento),
        usuarioId: userId,
        referenciaTipo: "COMPRA",
        referenciaId: orderId,
        motivo: `Recepción ${order.codigo_orden}`,
      });
      const destination = await suggestPutawayDestination(
        conn,
        d.producto_id,
        locationId,
        quantity,
      );
      await createTaskRecord(conn, {
        type: "PUTAWAY",
        lotId,
        destinationId: destination.id,
        quantity,
        priority: "ALTA",
        userId,
        observations: `Put-away automático desde ${location.codigo_loc} por recepción ${order.codigo_orden}`,
      });
      await conn.execute(
        "UPDATE ordenes_compra_detalle SET cantidad_recibida=cantidad_recibida+? WHERE id=?",
        [quantity, d.id],
      );
      receivedNow += quantity;
    }
    if (!receivedNow)
      throw new AppError(
        "Registra al menos una unidad física recibida; una entrega sin mercancía no crea recepción",
        422,
      );
    const [[pending]] = await conn.execute(
      `SELECT COALESCE(SUM(cantidad_solicitada-cantidad_recibida),0) unidades
       FROM ordenes_compra_detalle WHERE orden_id=?`,
      [orderId],
    );
    const nextState = Number(pending.unidades) > 0 ? "PARCIAL" : "RECIBIDA";
    await conn.execute("UPDATE ordenes_compra SET estado=? WHERE id=?", [
      nextState,
      orderId,
    ]);
    return {
      ...order,
      estado: nextState,
      recibido_ahora: receivedNow,
      pendiente: pending.unidades,
    };
  });
}

async function cancelPurchase(orderId) {
  const [result] = await require("../config/db").pool.execute(
    "UPDATE ordenes_compra SET estado='CANCELADA' WHERE id=? AND estado='PENDIENTE'",
    [orderId],
  );
  if (!result.affectedRows)
    throw new AppError("Solo se pueden cancelar órdenes pendientes", 409);
}
module.exports = {
  createPurchase,
  receivePurchase,
  cancelPurchase,
  validItems,
};
