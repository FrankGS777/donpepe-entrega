const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const resources = [
  "sessions",
  "roles",
  "usuarios",
  "solicitudes_usuario",
  "proveedores",
  "categorias",
  "marcas",
  "zonas_almacen",
  "ubicaciones_almacen",
  "productos",
  "ordenes_compra",
  "ordenes_compra_detalle",
  "lotes",
  "tareas_almacen",
  "movimientos_almacen",
  "inventarios_auditoria",
  "vw_stock_comparado",
  "vw_stock_por_loc",
  "vw_ocupacion_loc",
];
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
}
test("cada recurso SQL está conectado con el código de aplicación", () => {
  const root = path.join(__dirname, "..");
  const files = ["models", "services", "controllers", "config"]
    .flatMap((dir) => walk(path.join(root, dir)))
    .filter((f) => f.endsWith(".js"));
  files.push(path.join(root, "app.js"));
  const source = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
  for (const resource of resources)
    assert.match(
      source,
      new RegExp(`\\b${resource}\\b`),
      `Recurso sin uso: ${resource}`,
    );
});

const fieldCoverage = {
  sessions: {
    files: ["app.js", "config/MySQLSessionStore.js"],
    fields: ["session_id", "expires", "data"],
  },
  roles: {
    files: [
      "models/User.js",
      "views/usuarios/form.ejs",
      "views/usuarios/index.ejs",
    ],
    fields: ["id", "nombre", "descripcion"],
  },
  usuarios: {
    files: [
      "models/User.js",
      "services/userService.js",
      "views/usuarios/index.ejs",
    ],
    fields: [
      "id",
      "nombre",
      "correo",
      "password",
      "rol_id",
      "activo",
      "creado_en",
      "actualizado_en",
    ],
  },
  solicitudes_usuario: {
    files: [
      "models/UserRequest.js",
      "services/userRequestService.js",
      "views/solicitudes/index.ejs",
    ],
    fields: [
      "id",
      "codigo",
      "tipo",
      "nombre",
      "correo",
      "rol_solicitado_id",
      "motivo",
      "estado",
      "usuario_id",
      "revisado_por",
      "observacion_admin",
      "token_hash",
      "token_expira_en",
      "creado_en",
      "revisado_en",
      "completado_en",
      "actualizado_en",
    ],
  },
  proveedores: {
    files: [
      "models/Catalog.js",
      "views/categorias/form.ejs",
      "views/categorias/index.ejs",
    ],
    fields: [
      "id",
      "ruc",
      "razon_social",
      "telefono",
      "email",
      "logo_url",
      "sitio_web",
      "activo",
    ],
  },
  categorias: {
    files: [
      "models/Catalog.js",
      "views/categorias/form.ejs",
      "models/Product.js",
    ],
    fields: ["id", "nombre", "descripcion", "vida_util_dias"],
  },
  marcas: {
    files: [
      "models/Catalog.js",
      "views/categorias/form.ejs",
      "models/Product.js",
    ],
    fields: ["id", "nombre", "descripcion"],
  },
  zonas_almacen: {
    files: ["models/Catalog.js", "models/Wms.js", "views/categorias/index.ejs"],
    fields: [
      "id",
      "codigo_zona",
      "nombre",
      "proposito",
      "condicion_almacenamiento",
      "descripcion",
      "secuencia_operativa",
      "activo",
    ],
  },
  ubicaciones_almacen: {
    files: [
      "models/Catalog.js",
      "models/Inventory.js",
      "models/Wms.js",
      "views/categorias/form.ejs",
      "views/rf/count.ejs",
    ],
    fields: [
      "id",
      "codigo_loc",
      "zona_id",
      "zona",
      "pasillo",
      "estante",
      "tipo",
      "capacidad_unidades",
      "secuencia_putaway",
      "secuencia_pick",
      "permite_recepcion",
      "permite_almacenaje",
      "permite_picking",
      "permite_conteo",
      "activo",
    ],
  },
  productos: {
    files: [
      "models/Product.js",
      "services/stockService.js",
      "views/productos/form.ejs",
      "views/productos/index.ejs",
      "views/wms/labels.ejs",
    ],
    fields: [
      "id",
      "sku",
      "codigo_barras",
      "nombre",
      "categoria_id",
      "marca_id",
      "proveedor_id",
      "precio_compra",
      "precio_venta",
      "stock_total",
      "stock_minimo",
      "activo",
      "unidad_medida",
      "peso_kg",
      "volumen_m3",
      "control_lote",
      "control_vencimiento",
      "ubicacion_picking_id",
      "stock_objetivo_pick",
      "imagen_url",
      "referencia_url",
      "creado_en",
      "actualizado_en",
    ],
  },
  ordenes_compra: {
    files: [
      "models/Purchase.js",
      "services/purchaseService.js",
      "views/compras/index.ejs",
      "views/compras/show.ejs",
      "views/rf/receiving.ejs",
    ],
    fields: [
      "id",
      "codigo_orden",
      "proveedor_id",
      "usuario_id",
      "fecha_emision",
      "estado",
      "total_estimado",
    ],
  },
  ordenes_compra_detalle: {
    files: [
      "models/Purchase.js",
      "services/purchaseService.js",
      "views/compras/show.ejs",
      "views/compras/recibir.ejs",
    ],
    fields: [
      "id",
      "orden_id",
      "producto_id",
      "cantidad_solicitada",
      "precio_unitario_compra",
      "subtotal",
    ],
  },
  lotes: {
    files: [
      "models/Inventory.js",
      "services/stockService.js",
      "views/inventario/lotes.ejs",
      "views/wms/labels.ejs",
    ],
    fields: [
      "id",
      "numero_lote",
      "producto_id",
      "ubicacion_id",
      "orden_compra_id",
      "cantidad_inicial",
      "cantidad_actual",
      "fecha_ingreso",
      "fecha_vencimiento",
      "estado_inventario",
      "creado_en",
    ],
  },
  tareas_almacen: {
    files: [
      "models/Wms.js",
      "services/wmsService.js",
      "views/wms/tasks.ejs",
      "views/rf/tasks.ejs",
    ],
    fields: [
      "id",
      "codigo_tarea",
      "tipo",
      "estado",
      "prioridad",
      "producto_id",
      "lote_origen_id",
      "ubicacion_origen_id",
      "ubicacion_destino_id",
      "cantidad",
      "asignado_a",
      "creado_por",
      "observaciones",
      "creado_en",
      "iniciado_en",
      "completado_en",
    ],
  },
  movimientos_almacen: {
    files: [
      "models/Inventory.js",
      "services/stockService.js",
      "views/inventario/movimientos.ejs",
    ],
    fields: [
      "id",
      "producto_id",
      "lote_id",
      "usuario_id",
      "tipo_movimiento",
      "cantidad",
      "referencia_tipo",
      "referencia_id",
      "motivo",
      "creado_en",
    ],
  },
  inventarios_auditoria: {
    files: [
      "models/Inventory.js",
      "services/auditService.js",
      "views/auditorias/index.ejs",
    ],
    fields: [
      "id",
      "fecha_auditoria",
      "usuario_id",
      "producto_id",
      "stock_sistema",
      "stock_fisico",
      "diferencia",
      "tipo_ajuste",
      "observaciones",
      "estado",
      "ubicacion_id",
      "fecha_vencimiento_ajuste",
      "aprobado_por",
      "aprobado_en",
    ],
  },
  vw_stock_comparado: {
    files: ["models/Inventory.js", "views/inventario/salud.ejs"],
    fields: [
      "producto_id",
      "nombre",
      "stock_cacheado",
      "stock_real_por_lotes",
      "diferencia",
    ],
  },
  vw_stock_por_loc: {
    files: ["models/Wms.js", "views/wms/positions.ejs", "views/wms/labels.ejs"],
    fields: [
      "lote_id",
      "producto_id",
      "sku",
      "producto",
      "unidad_medida",
      "numero_lote",
      "cantidad_actual",
      "fecha_vencimiento",
      "estado_inventario",
      "ubicacion_id",
      "codigo_loc",
      "zona_id",
      "zona",
      "codigo_zona",
      "proposito_zona",
      "condicion_almacenamiento",
      "tipo_loc",
      "secuencia_pick",
      "secuencia_putaway",
    ],
  },
  vw_ocupacion_loc: {
    files: ["models/Wms.js", "models/warehouseLayout.js", "views/wms/positions.ejs", "views/rf/count.ejs"],
    fields: [
      "ubicacion_id",
      "codigo_loc",
      "zona_id",
      "zona",
      "codigo_zona",
      "proposito_zona",
      "condicion_almacenamiento",
      "pasillo",
      "estante",
      "tipo",
      "capacidad_hu",
      "ocupacion_hu",
      "unidades_ocupadas",
      "capacidad_disponible",
      "porcentaje_ocupacion",
      "activo",
    ],
  },
};

test("cada campo del esquema participa en lógica, trazabilidad o interfaz", () => {
  const root = path.join(__dirname, "..");
  for (const [resource, contract] of Object.entries(fieldCoverage)) {
    const source = contract.files
      .map((file) => fs.readFileSync(path.join(root, file), "utf8"))
      .join("\n");
    for (const field of contract.fields)
      assert.match(
        source,
        new RegExp(`\\b${field}\\b`),
        `${resource}.${field} no tiene cobertura de aplicación`,
      );
  }
});
