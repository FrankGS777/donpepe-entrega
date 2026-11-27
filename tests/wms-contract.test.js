const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("la recepción genera put-away dentro del servicio transaccional", () => {
  const source = read("services/purchaseService.js");
  assert.match(source, /addLot/);
  assert.match(source, /suggestPutawayDestination/);
  assert.match(source, /createTaskRecord/);
  assert.match(source, /type:\s*"PUTAWAY"/);
});

test("el sistema expone una operación RF móvil sin lógica de venta", () => {
  const routes = read("routes/index.js");
  const rf = read("controllers/rfController.js");
  const layout = read("views/layouts/rf.ejs");
  assert.match(routes, /router\.use\("\/rf"/);
  assert.doesNotMatch(routes, /router\.use\("\/ventas"/);
  assert.match(rf, /Recibir mercancía/);
  assert.match(rf, /Ubicar mercancía/);
  assert.match(rf, /Preparar pedidos/);
  assert.match(rf, /Aislar devoluciones/);
  assert.match(layout, /rf-footer/);
});

test("el conteo RF permanece dentro de la interfaz móvil", () => {
  const routes = read("routes/rf.js");
  const view = read("views/rf/count.ejs");
  const form = read("views/rf/count-form.ejs");
  assert.match(routes, /\/count\/:id/);
  assert.match(view, /href="\/rf\/count\//);
  assert.doesNotMatch(view, /\/auditorias\/nueva/);
  assert.match(form, /data-scan-input/);
});

test("la confirmación RF exige escanear origen, producto y destino", () => {
  const routes = read("routes/rf.js");
  const service = read("services/wmsService.js");
  const validator = read("validators/common.js");
  const execute = read("views/rf/execute.ejs");
  assert.match(routes, /\/tareas\/:id\/ejecutar/);
  assert.match(routes, /v\.rfTaskConfirmation/);
  assert.match(validator, /codigo_origen/);
  assert.match(validator, /codigo_producto/);
  assert.match(validator, /codigo_destino/);
  assert.match(service, /originCode !== normalize\(task\.loc_origen\)/);
  assert.match(service, /destinationCode !== normalize\(task\.loc_destino\)/);
  assert.match(execute, /name="codigo_origen"[^>]*data-scan-input/);
  assert.match(execute, /name="codigo_producto"[^>]*data-scan-input/);
  assert.match(execute, /name="codigo_destino"[^>]*data-scan-input/);
});

test("el escáner RF enumera cámaras y conserva una Continuity Camera elegida", () => {
  const app = read("app.js");
  const layout = read("views/layouts/rf.ejs");
  const scanner = read("public/js/rf.js");
  const engine = read("frontend/scanner.js");
  assert.match(app, /Permissions-Policy", "camera=\(self\)"/);
  assert.match(layout, /\/vendor\/zxing\/zxing-browser\.min\.js/);
  assert.match(engine, /enumerateDevices/);
  assert.match(engine, /deviceId:\s*\{ exact: deviceId \}/);
  assert.match(engine, /ZXingBrowser\.BrowserMultiFormatReader/);
  assert.match(scanner, /WmsScanner.confirmReading/);
  assert.match(layout, /\/js\/scanner.js/);
  assert.match(scanner, /donpepe\.wms\.camera/);
});

test("el jefe de operaciones actualiza solo columnas logísticas del SKU", () => {
  const source = read("models/Product.js");
  const method = source.match(
    /static updateLogistics[\s\S]*?static deactivate/,
  )?.[0];
  assert.ok(method);
  assert.match(method, /ubicacion_picking_id/);
  assert.match(method, /stock_objetivo_pick/);
  assert.doesNotMatch(method, /precio_venta/);
  assert.doesNotMatch(method, /proveedor_id/);
});

test("la estrategia SKU exige una LOC primaria real de picking", () => {
  const controller = read("controllers/productController.js");
  const model = read("models/Product.js");
  assert.match(controller, /validateWmsStrategy/);
  assert.match(controller, /stock_objetivo_pick/);
  assert.match(
    controller,
    /control de vencimiento requiere mantener trazabilidad por lote/,
  );
  assert.match(
    model,
    /u\.activo=1 AND u\.permite_picking=1 AND u\.tipo='PICKING'/,
  );
});

test("el esquema incluye posiciones, capacidad y ciclo de tareas WMS", () => {
  const sql = read("database/init.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS zonas_almacen/);
  assert.match(sql, /fk_loc_zona/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS tareas_almacen/);
  assert.match(sql, /PICKING','DEVOLUCION_RUTA/);
  assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS ventas/);
  assert.match(sql, /CREATE OR REPLACE VIEW vw_stock_por_loc/);
  assert.match(sql, /CREATE OR REPLACE VIEW vw_ocupacion_loc/);
  assert.match(sql, /capacidad_unidades/);
  assert.match(sql, /secuencia_putaway/);
  assert.match(sql, /secuencia_pick/);
});

test("zonas, perfiles y temperatura gobiernan las ubicaciones", () => {
  const warehouse = read("config/warehouse.js");
  const service = read("services/wmsService.js");
  const form = read("views/categorias/form.ejs");
  assert.match(warehouse, /ZONE_ALLOWED_TYPES/);
  assert.match(warehouse, /REC:[\s\S]*RECEPCION/);
  assert.match(warehouse, /VEN:[\s\S]*PICKING/);
  assert.match(warehouse, /DSP:[\s\S]*DESPACHO/);
  assert.match(service, /condicion_almacenamiento/);
  assert.match(service, /condicion_requerida/);
  assert.doesNotMatch(
    form,
    /name="permite_(recepcion|almacenaje|picking|conteo)"/,
  );
});

test("una LOC con inventario o dependencias no puede invalidarse", () => {
  const catalog = read("controllers/catalogController.js");
  const model = read("models/Catalog.js");
  assert.match(model, /locationUsage/);
  assert.match(model, /productos_picking/);
  assert.match(model, /tareas_abiertas/);
  assert.match(catalog, /Vacía la LOC y cierra sus tareas/);
  assert.match(
    catalog,
    /No renombres ni muevas una LOC con stock, tareas o SKU asignados/,
  );
});

test("compras y conteos usan asistentes con validación contextual", () => {
  const purchase = read("views/compras/form.ejs");
  const audit = read("views/auditorias/form.ejs");
  const purchaseBrowser = read("public/js/purchase.js");
  const auditBrowser = read("public/js/audit-form.js");
  assert.match(purchase, /purchase-workflow/);
  assert.match(purchaseBrowser, /existing\.cantidad \+= qty/);
  assert.doesNotMatch(purchaseBrowser, /innerHTML/);
  assert.match(audit, /audit-workflow/);
  assert.match(auditBrowser, /systemStock/);
  assert.match(auditBrowser, /expiry\.required/);
});

test("el reabastecimiento respeta reserva, LOC primaria y déficit de picking", () => {
  const source = read("services/wmsService.js");
  assert.match(source, /origen_picking/);
  assert.match(source, /estado_inventario !== "DISPONIBLE"/);
  assert.match(source, /ubicacion_picking_id/);
  assert.match(source, /const deficit = Math\.max/);
  assert.match(source, /qty > deficit/);
  assert.match(source, /Otra tarea cambió el stock de picking/);
});

test("picking y devoluciones RF respetan staging y cuarentena", () => {
  const source = read("services/wmsService.js");
  assert.match(source, /type === "PICKING"/);
  assert.match(source, /destinationLocation\.tipo !== "DESPACHO"/);
  assert.match(source, /type === "DEVOLUCION_RUTA"/);
  assert.match(source, /destinationLocation\.tipo !== "CUARENTENA"/);
});

test("la nueva tarea usa un asistente con ruta, RF y cantidad sugerida", () => {
  const template = read("views/wms/task-form.ejs");
  const browser = read("public/js/wms-task.js");
  assert.match(template, /¿Qué necesitas hacer\?/);
  assert.match(template, /task-route-preview/);
  assert.match(template, /Usar sugerida/);
  assert.match(template, /pedido de sucursal/);
  assert.doesNotMatch(template, /value="PICKING"/);
  assert.doesNotMatch(template, /value="DEVOLUCION_RUTA"/);
  assert.match(browser, /eligiblePositions/);
  assert.match(browser, /deficit_pick/);
  assert.match(browser, /capacidad_libre/);
  assert.doesNotMatch(browser, /DEVOLUCION_RUTA/);
});

test("la optimización UI cubre selectores modales, QR y RF aislado", () => {
  const appBrowser = read("public/js/app.js");
  const receiveBrowser = read("public/js/receive.js");
  const receiveTemplate = read("views/compras/recibir.ejs");
  const receiveService = read("services/purchaseService.js");
  const lots = read("views/inventario/lotes.ejs");
  const routes = read("routes/index.js");
  const positions = read("views/wms/positions.ejs");
  assert.match(appBrowser, /resourceSelectModal/);
  assert.match(appBrowser, /select-modal-trigger/);
  assert.match(appBrowser, /quickScanModal/);
  assert.match(appBrowser, /wms:scan/);
  assert.match(lots, /data-lot-qr/);
  assert.match(receiveTemplate, /Vencimiento impreso en el envase/);
  assert.match(receiveBrowser, /normalizeExpiry/);
  assert.match(receiveBrowser, /fecha_vencimiento/);
  assert.match(receiveService, /fecha_verificada/);
  assert.doesNotMatch(receiveService, /expiryFromCategory/);
  assert.match(routes, /permit\("dashboard.admin", "dashboard.warehouse"\)/);
  assert.doesNotMatch(read("routes/wms.js"), /permit\("wms.tasks.execute"\)/);
  assert.match(positions, /bin-finder/);
  assert.match(positions, /bin-grid/);
  assert.match(positions, /bin-stock-line/);
});

test("la navegación diferencia filtros simples y selectores de recursos", () => {
  const sidebar = read("views/partials/sidebar.ejs");
  const appBrowser = read("public/js/app.js");
  const css = read("public/css/app.css");
  const positions = read("views/wms/positions.ejs");
  assert.doesNotMatch(sidebar, /Etiquetas QR|Conciliación/);
  assert.match(appBrowser, /select\.form-select\[data-complex-select\]/);
  assert.match(appBrowser, /resourceMedia/);
  assert.match(appBrowser, /data\.image/);
  assert.match(appBrowser, /data\.referenceUrl/);
  assert.doesNotMatch(appBrowser, /images\.unsplash\.com/);
  assert.doesNotMatch(appBrowser, /world\.openfoodfacts\.org/);
  assert.match(positions, /name="zone"/);
  assert.match(positions, /name="aisle"/);
  assert.match(positions, /name="rack"/);
  assert.match(positions, /bin-detail/);
  assert.match(
    css,
    /resource-select-list[\s\S]*grid-template-columns: repeat\(2/,
  );
  assert.doesNotMatch(appBrowser, /rowDetailModal|i-eye/);
  assert.doesNotMatch(css, /row-detail-button/);
});
