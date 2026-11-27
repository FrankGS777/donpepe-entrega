const { transaction } = require("../config/db");
const { decreaseFifo, addLot } = require("./stockService");
const AppError = require("../utils/AppError");
const { todayInLima } = require("../utils/dates");
const { requireActorPermission } = require("./accessPolicy");

async function createAudit({
  productId,
  physicalStock,
  userId,
  observations,
  locationId,
  expiryDate,
  batchCode,
}) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "audits.create", "rf.count");
    const productIdNumber = Number(productId);
    const note = String(observations || "").trim();
    if (
      !Number.isInteger(productIdNumber) ||
      productIdNumber < 1 ||
      note.length > 2000
    )
      throw new AppError("Datos de auditoría inválidos");
    const [[product]] = await conn.execute(
      "SELECT * FROM productos WHERE id=? FOR UPDATE",
      [productIdNumber],
    );
    if (!product) throw new AppError("Producto no encontrado", 404);
    const location = Number(locationId);
    const manufacturerBatch = String(batchCode || "").trim();
    if (!manufacturerBatch || manufacturerBatch.length > 50)
      throw new AppError("Escanea o ingresa el lote real del fabricante", 422);
    if (!Number.isInteger(location) || location < 1)
      throw new AppError("Selecciona una LOC válida para el conteo");
    const [[locationRow]] = await conn.execute(
      `SELECT u.id,u.codigo_loc,z.proposito FROM ubicaciones_almacen u
       JOIN zonas_almacen z ON z.id=u.zona_id
       WHERE u.id=? AND u.activo=1 AND u.permite_conteo=1 FOR UPDATE`,
      [location],
    );
    if (!locationRow)
      throw new AppError("La LOC no admite conteos cíclicos", 409);
    const [locationLots] = await conn.execute(
      `SELECT l.id,l.cantidad_actual,l.estado_inventario,l.unidad_logistica_id
       FROM lotes l JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
       WHERE l.producto_id=? AND l.ubicacion_id=? AND b.codigo_lote=? FOR UPDATE`,
      [productIdNumber, location, manufacturerBatch],
    );
    const systemStock = locationLots.reduce(
      (sum, lot) => sum + lot.cantidad_actual,
      0,
    );
    const physical = Number(physicalStock);
    if (!Number.isInteger(physical) || physical < 0 || physical > 10000000)
      throw new AppError("El stock físico debe ser un entero no negativo");
    const difference = physical - systemStock;
    if (
      difference < 0 &&
      new Set(
        locationLots
          .filter((l) => l.cantidad_actual > 0)
          .map((l) => `${l.estado_inventario}:${l.unidad_logistica_id || 0}`),
      ).size > 1
    )
      throw new AppError(
        "Este lote se distribuye entre varias HU o estados en la LOC. Cuenta cada unidad por separado antes de ajustar; no se puede atribuir la merma con seguridad.",
        409,
      );
    if (difference !== 0 && note.length < 10)
      throw new AppError(
        "Describe el hallazgo físico en al menos 10 caracteres antes de solicitar un ajuste",
      );
    const type =
      difference > 0
        ? "INGRESO_POR_AJUSTE"
        : difference < 0
          ? "SALIDA_POR_PERDIDA"
          : "CUADRE_PERFECTO";
    let expiry = null;
    if (difference > 0 && product.control_vencimiento) {
      const today = todayInLima();
      const [[knownBatch]] = await conn.execute(
        `SELECT DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d') fecha_vencimiento,
          fecha_verificada,requiere_revision FROM lotes_fabricante
         WHERE producto_id=? AND codigo_lote=? FOR UPDATE`,
        [productIdNumber, manufacturerBatch],
      );
      if (knownBatch?.requiere_revision)
        throw new AppError(
          "Este lote tiene un vencimiento contradictorio; concílialo antes del ajuste",
          409,
        );
      expiry =
        String(expiryDate || "").trim() ||
        (knownBatch?.fecha_verificada ? knownBatch.fecha_vencimiento : null);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry) || expiry < today)
        throw new AppError(
          "Este SKU controla caducidad; confirma la fecha impresa del lote",
        );
      if (
        knownBatch?.fecha_vencimiento &&
        knownBatch.fecha_vencimiento !== expiry
      )
        throw new AppError(
          "La fecha impresa no coincide con la registrada para este lote",
          409,
        );
    }
    const state = difference === 0 ? "APROBADA" : "PENDIENTE";
    const [audit] = await conn.execute(
      `INSERT INTO inventarios_auditoria
    (usuario_id,producto_id,stock_sistema,stock_fisico,tipo_ajuste,observaciones,estado,ubicacion_id,codigo_lote,fecha_vencimiento_ajuste,aprobado_por,aprobado_en)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        userId,
        productIdNumber,
        systemStock,
        physical,
        type,
        note || null,
        state,
        location,
        manufacturerBatch,
        expiry,
        difference === 0 ? userId : null,
        difference === 0 ? new Date() : null,
      ],
    );
    return audit.insertId;
  });
}

async function approveAudit({ auditId, userId }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "audits.approve");
    const [[audit]] = await conn.execute(
      "SELECT * FROM inventarios_auditoria WHERE id=? FOR UPDATE",
      [auditId],
    );
    if (!audit || audit.estado !== "PENDIENTE")
      throw new AppError("El conteo no está pendiente de aprobación", 409);
    if (Number(audit.usuario_id) === Number(userId))
      throw new AppError(
        "Quien registra el conteo no puede aprobar su propio ajuste",
        409,
      );
    const [[product]] = await conn.execute(
      "SELECT * FROM productos WHERE id=? FOR UPDATE",
      [audit.producto_id],
    );
    if (!product) throw new AppError("Producto no encontrado", 404);
    if (!audit.codigo_lote)
      throw new AppError(
        "Este conteo anterior no identifica un lote de fabricante; recházalo y realiza uno nuevo",
        409,
      );
    let currentCountStock = product.stock_total;
    if (audit.ubicacion_id) {
      const [locationLots] = await conn.execute(
        `SELECT l.id,l.cantidad_actual,l.estado_inventario,l.unidad_logistica_id
         FROM lotes l JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
         WHERE l.producto_id=? AND l.ubicacion_id=? AND b.codigo_lote=? FOR UPDATE`,
        [audit.producto_id, audit.ubicacion_id, audit.codigo_lote],
      );
      currentCountStock = locationLots.reduce(
        (sum, lot) => sum + lot.cantidad_actual,
        0,
      );
      if (
        audit.diferencia < 0 &&
        new Set(
          locationLots
            .filter((l) => l.cantidad_actual > 0)
            .map((l) => `${l.estado_inventario}:${l.unidad_logistica_id || 0}`),
        ).size > 1
      )
        throw new AppError(
          "La composición HU/estado del lote cambió; rechaza este conteo y repítelo",
          409,
        );
    }
    if (currentCountStock !== audit.stock_sistema)
      throw new AppError(
        "El stock cambió después del conteo. Rechaza esta auditoría y realiza un nuevo conteo.",
        409,
      );
    if (audit.diferencia > 0) {
      if (!audit.ubicacion_id)
        throw new AppError(
          "Este conteo antiguo no identifica una LOC destino; recházalo y registra un conteo por LOC.",
          409,
        );
      await addLot(conn, {
        numeroLote: audit.codigo_lote,
        productoId: audit.producto_id,
        ubicacionId: audit.ubicacion_id,
        cantidad: audit.diferencia,
        fechaIngreso: todayInLima(),
        fechaVencimiento: audit.fecha_vencimiento_ajuste,
        expiryVerified: Boolean(product.control_vencimiento),
        inventoryState:
          (
            await conn.execute(
              `SELECT z.proposito FROM ubicaciones_almacen u JOIN zonas_almacen z ON z.id=u.zona_id WHERE u.id=?`,
              [audit.ubicacion_id],
            )
          )[0][0]?.proposito === "CONTROL"
            ? "CUARENTENA"
            : "DISPONIBLE",
        usuarioId: userId,
        referenciaTipo: "AJUSTE",
        referenciaId: audit.id,
        motivo: audit.observaciones || "Ajuste aprobado",
      });
    }
    if (audit.diferencia < 0)
      await decreaseFifo(conn, {
        productoId: audit.producto_id,
        cantidad: Math.abs(audit.diferencia),
        usuarioId: userId,
        referenciaTipo: "AJUSTE",
        referenciaId: audit.id,
        motivo: audit.observaciones || "Pérdida aprobada",
        allowExpired: true,
        locationId: audit.ubicacion_id,
        batchCode: audit.codigo_lote,
      });
    await conn.execute(
      "UPDATE inventarios_auditoria SET estado='APROBADA',aprobado_por=?,aprobado_en=CURRENT_TIMESTAMP WHERE id=?",
      [userId, audit.id],
    );
    return audit.id;
  });
}

async function rejectAudit({ auditId, userId }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, userId, "audits.reject");
    const [[audit]] = await conn.execute(
      "SELECT id,usuario_id,estado FROM inventarios_auditoria WHERE id=? FOR UPDATE",
      [auditId],
    );
    if (!audit || audit.estado !== "PENDIENTE")
      throw new AppError("El conteo no está pendiente de revisión", 409);
    if (Number(audit.usuario_id) === Number(userId))
      throw new AppError(
        "Quien registra el conteo no puede revisar su propio ajuste",
        409,
      );
    await conn.execute(
      "UPDATE inventarios_auditoria SET estado='RECHAZADA',aprobado_por=?,aprobado_en=CURRENT_TIMESTAMP WHERE id=?",
      [userId, audit.id],
    );
  });
}
module.exports = { createAudit, approveAudit, rejectAudit };
