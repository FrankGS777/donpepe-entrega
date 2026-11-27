const { body, param } = require("express-validator");

const id = (name = "id") =>
  param(name).isInt({ min: 1 }).withMessage("Identificador inválido").toInt();
const catalogType = param("type")
  .isIn(["categorias", "marcas", "proveedores", "ubicaciones"])
  .withMessage("Catálogo inválido");
const login = [
  body("correo")
    .trim()
    .isEmail()
    .withMessage("Ingresa un correo válido")
    .normalizeEmail(),
  body("password")
    .isString()
    .isLength({ min: 1, max: 72 })
    .withMessage("Contraseña inválida"),
];
const passwordResetRequest = [
  body("correo")
    .trim()
    .isEmail()
    .withMessage("Ingresa un correo válido")
    .normalizeEmail(),
];
const activationToken = param("token")
  .matches(/^[a-f0-9]{64}$/)
  .withMessage("Enlace de activación inválido");
const newPassword = [
  activationToken,
  body("password")
    .isLength({ min: 10, max: 72 })
    .withMessage("La contraseña debe tener entre 10 y 72 caracteres")
    .matches(/[a-z]/)
    .withMessage("Incluye al menos una letra minúscula")
    .matches(/[A-Z]/)
    .withMessage("Incluye al menos una letra mayúscula")
    .matches(/[0-9]/)
    .withMessage("Incluye al menos un número"),
  body("confirmar_password").custom((value, { req }) => {
    if (value !== req.body.password)
      throw new Error("Las contraseñas no coinciden");
    return true;
  }),
];
const ownPassword = [
  body("password_actual").isString().notEmpty()
    .withMessage("Escribe tu contraseña actual"),
  body("password")
    .isLength({ min: 10, max: 72 })
    .withMessage("La contraseña debe tener entre 10 y 72 caracteres")
    .matches(/[a-z]/).withMessage("Incluye una minúscula")
    .matches(/[A-Z]/).withMessage("Incluye una mayúscula")
    .matches(/[0-9]/).withMessage("Incluye un número"),
  body("confirmar_password").custom((value, { req }) => {
    if (value !== req.body.password) throw new Error("Las contraseñas no coinciden");
    return true;
  }),
];
const requestDecision = [
  id(),
  body("observacion")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("La observación admite hasta 500 caracteres"),
];
const product = [
  body("sku")
    .trim()
    .toUpperCase()
    .matches(/^[A-Z0-9][A-Z0-9._-]{2,39}$/)
    .withMessage("El SKU debe tener entre 3 y 40 caracteres alfanuméricos"),
  body("nombre")
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage("El nombre debe tener entre 2 y 100 caracteres"),
  body("codigo_barras")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 50 })
    .withMessage("El código admite hasta 50 caracteres"),
  body("categoria_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona una categoría")
    .toInt(),
  body("marca_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona una marca")
    .toInt(),
  body("proveedor_id")
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage("Proveedor inválido")
    .toInt(),
  body("imagen_url")
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ protocols: ["https"], require_protocol: true })
    .withMessage("La imagen del SKU debe ser una URL HTTPS")
    .isLength({ max: 500 })
    .withMessage("La URL de imagen admite hasta 500 caracteres"),
  body("referencia_url")
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ protocols: ["https"], require_protocol: true })
    .withMessage("La ficha de referencia debe ser una URL HTTPS")
    .isLength({ max: 500 })
    .withMessage("La ficha de referencia admite hasta 500 caracteres"),
  body("precio_compra")
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("Costo inválido")
    .toFloat(),
  body("precio_venta")
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("Precio de venta inválido")
    .toFloat(),
  body("stock_minimo")
    .isInt({ min: 0, max: 10000000 })
    .withMessage("Stock mínimo inválido")
    .toInt(),
  body("clase_abc").isIn(["A", "B", "C"]).withMessage("Clase ABC inválida"),
  body("unidad_medida")
    .isIn(["UND", "CAJA", "PAQUETE", "KG", "L"])
    .withMessage("Unidad de medida inválida"),
  body("peso_kg")
    .isFloat({ min: 0, max: 999999.999 })
    .withMessage("Peso inválido")
    .toFloat(),
  body("volumen_m3")
    .isFloat({ min: 0, max: 999999.999999 })
    .withMessage("Volumen inválido")
    .toFloat(),
  body("ubicacion_picking_id")
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage("LOC primaria de picking inválida")
    .toInt(),
  body("stock_objetivo_pick")
    .isInt({ min: 0, max: 10000000 })
    .withMessage("Stock objetivo de picking inválido")
    .toInt(),
  body("control_lote").optional().toBoolean(),
  body("control_vencimiento").optional().toBoolean(),
  body("activo").optional().toBoolean(),
];
const productLogistics = [
  body("clase_abc").isIn(["A", "B", "C"]).withMessage("Clase ABC inválida"),
  body("unidad_medida")
    .isIn(["UND", "CAJA", "PAQUETE", "KG", "L"])
    .withMessage("Unidad de medida inválida"),
  body("peso_kg")
    .isFloat({ min: 0, max: 999999.999 })
    .withMessage("Peso inválido")
    .toFloat(),
  body("volumen_m3")
    .isFloat({ min: 0, max: 999999.999999 })
    .withMessage("Volumen inválido")
    .toFloat(),
  body("stock_minimo")
    .isInt({ min: 0, max: 10000000 })
    .withMessage("Stock mínimo inválido")
    .toInt(),
  body("ubicacion_picking_id")
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage("LOC primaria inválida")
    .toInt(),
  body("stock_objetivo_pick")
    .isInt({ min: 0, max: 10000000 })
    .withMessage("Objetivo de picking inválido")
    .toInt(),
  body("control_lote").optional().toBoolean(),
  body("control_vencimiento").optional().toBoolean(),
];
const user = [
  body("nombre")
    .trim()
    .isLength({ min: 3, max: 100 })
    .withMessage("El nombre debe tener entre 3 y 100 caracteres"),
  body("correo")
    .trim()
    .isEmail()
    .withMessage("Correo inválido")
    .normalizeEmail(),
  body("correo_recuperacion")
    .trim()
    .isEmail()
    .withMessage("Ingresa un correo de recuperación válido")
    .isLength({ max: 100 }).withMessage("El correo admite hasta 100 caracteres")
    .toLowerCase(),
  body("rol_id").isInt({ min: 1 }).withMessage("Rol inválido").toInt(),
  body("activo").optional().toBoolean(),
  body("password")
    .optional({ checkFalsy: true })
    .isLength({ min: 10, max: 72 })
    .withMessage("La contraseña debe tener entre 10 y 72 caracteres")
    .matches(/[a-z]/)
    .withMessage("La contraseña necesita una minúscula")
    .matches(/[A-Z]/)
    .withMessage("La contraseña necesita una mayúscula")
    .matches(/[0-9]/)
    .withMessage("La contraseña necesita un número"),
];
const catalog = [
  body("nombre")
    .if((_value, { req }) => ["categorias", "marcas"].includes(req.params.type))
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage("El nombre debe tener entre 2 y 50 caracteres"),
  body("descripcion")
    .if((_value, { req }) => ["categorias", "marcas"].includes(req.params.type))
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 255 })
    .withMessage("La descripción admite hasta 255 caracteres"),
  body("vida_util_dias")
    .if((_value, { req }) => req.params.type === "categorias")
    .isInt({ min: 0, max: 3650 })
    .withMessage("La vida útil debe estar entre 0 y 3650 días")
    .toInt(),
  body("ruc")
    .if((_value, { req }) => req.params.type === "proveedores")
    .trim()
    .matches(/^\d{11}$/)
    .withMessage("El RUC debe contener 11 dígitos"),
  body("razon_social")
    .if((_value, { req }) => req.params.type === "proveedores")
    .trim()
    .isLength({ min: 2, max: 150 })
    .withMessage("Razón social inválida"),
  body("telefono")
    .if((_value, { req }) => req.params.type === "proveedores")
    .optional({ checkFalsy: true })
    .trim()
    .matches(/^[0-9+()\-\s]{6,20}$/)
    .withMessage("Teléfono inválido"),
  body("email")
    .if((_value, { req }) => req.params.type === "proveedores")
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage("Correo del proveedor inválido")
    .normalizeEmail(),
  body("logo_url")
    .if((_value, { req }) => req.params.type === "proveedores")
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ protocols: ["https"], require_protocol: true })
    .withMessage("La URL del logo debe usar HTTPS")
    .isLength({ max: 500 })
    .withMessage("La URL del logo admite hasta 500 caracteres"),
  body("sitio_web")
    .if((_value, { req }) => req.params.type === "proveedores")
    .optional({ checkFalsy: true })
    .trim()
    .isURL({ protocols: ["https"], require_protocol: true })
    .withMessage("El sitio oficial debe usar HTTPS")
    .isLength({ max: 255 })
    .withMessage("El sitio oficial admite hasta 255 caracteres"),
  body("activo")
    .if((_value, { req }) => req.params.type === "proveedores")
    .optional()
    .toBoolean(),
  body("zona_id")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isInt({ min: 1 })
    .withMessage("Selecciona una zona WMS normalizada")
    .toInt(),
  body("pasillo")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .trim()
    .matches(/^(0?[1-9]|[1-9][0-9])$/)
    .withMessage("Pasillo: usa un número entre 01 y 99"),
  body("estante")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .trim()
    .matches(/^(0?[1-9]|[1-9][0-9])$/)
    .withMessage("Módulo: usa un número entre 01 y 99"),
  body("nivel")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isInt({ min: 1, max: 99 })
    .withMessage("Nivel inválido")
    .toInt(),
  body("posicion")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isInt({ min: 1, max: 99 })
    .withMessage("Casillero inválido")
    .toInt(),
  body("layout_x")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("Coordenada X inválida")
    .toFloat(),
  body("layout_z")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .optional({ checkFalsy: true })
    .isFloat({ min: 0, max: 999999.99 })
    .withMessage("Coordenada Z inválida")
    .toFloat(),
  body("layout_z")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .custom((_value, { req }) => {
      if (Boolean(req.body.layout_x) !== Boolean(req.body.layout_z))
        throw new Error(
          "Registra ambas coordenadas del plano o deja ambas vacías",
        );
      return true;
    }),
  body("tipo")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isIn(["RECEPCION", "RESERVA", "PICKING", "CUARENTENA", "DESPACHO"])
    .withMessage("Tipo de LOC inválido"),
  body("capacidad_unidades")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isInt({ min: 1, max: 10000000 })
    .withMessage("Capacidad de LOC inválida")
    .toInt(),
  body("secuencia_putaway")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isInt({ min: 1, max: 50000000 })
    .withMessage("Secuencia de put-away inválida")
    .toInt(),
  body("secuencia_pick")
    .if((_value, { req }) => req.params.type === "ubicaciones")
    .isInt({ min: 1, max: 50000000 })
    .withMessage("Secuencia de picking inválida")
    .toInt(),
  ...["activo"].map((field) =>
    body(field)
      .if((_value, { req }) => req.params.type === "ubicaciones")
      .optional()
      .toBoolean(),
  ),
];
const serializedItems = body("items")
  .isString()
  .isLength({ min: 2, max: 200000 })
  .withMessage("Detalle de operación inválido");
const purchase = [
  body("proveedor_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona un proveedor")
    .toInt(),
  serializedItems,
];
const sale = [serializedItems];
const receive = [id(), serializedItems];
const audit = [
  body("producto_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona un producto")
    .toInt(),
  body("stock_fisico")
    .isInt({ min: 0, max: 10000000 })
    .withMessage("Stock físico inválido")
    .toInt(),
  body("ubicacion_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona la LOC del conteo")
    .toInt(),
  body("codigo_lote")
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("Escanea o ingresa el lote real del fabricante"),
  body("fecha_vencimiento")
    .optional({ checkFalsy: true })
    .isISO8601({ strict: true })
    .withMessage("Fecha de vencimiento inválida"),
  body("observaciones")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 2000 })
    .withMessage("Las observaciones admiten hasta 2000 caracteres"),
];
const wmsTask = [
  body("operador_id")
    .optional({ checkFalsy: true })
    .isInt({ min: 1 })
    .withMessage("Selecciona un operador RF válido")
    .toInt(),
  body("tipo")
    .isIn(["REUBICACION", "REABASTECIMIENTO"])
    .withMessage("Tipo de tarea inválido"),
  body("lote_origen_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona una posición de origen")
    .toInt(),
  body("ubicacion_destino_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona una LOC destino")
    .toInt(),
  body("cantidad")
    .isInt({ min: 1, max: 10000000 })
    .withMessage("Cantidad de traslado inválida")
    .toInt(),
  body("prioridad")
    .isIn(["BAJA", "NORMAL", "ALTA", "URGENTE"])
    .withMessage("Prioridad inválida"),
  body("referencia_operativa")
    .customSanitizer((value) => String(value || "").trim())
    .isLength({ max: 60 })
    .withMessage("La referencia admite hasta 60 caracteres"),
  body("observaciones")
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 500 })
    .withMessage("La observación admite hasta 500 caracteres"),
];
const assignWmsTask = [
  id(),
  body("operador_id")
    .isInt({ min: 1 })
    .withMessage("Selecciona un operador RF")
    .toInt(),
];
const rfTaskConfirmation = [
  id(),
  body("codigo_origen")
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Escanea o ingresa la LOC de origen"),
  body("codigo_producto")
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Escanea el SKU, código de barras o lote"),
  body("codigo_destino")
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage("Escanea o ingresa la LOC destino"),
];

module.exports = {
  id,
  catalogType,
  login,
  passwordResetRequest,
  ownPassword,
  activationToken,
  newPassword,
  requestDecision,
  product,
  productLogistics,
  user,
  catalog,
  purchase,
  sale,
  receive,
  audit,
  wmsTask,
  assignWmsTask,
  rfTaskConfirmation,
};
