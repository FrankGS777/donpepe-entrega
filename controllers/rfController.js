const Wms = require("../models/Wms");
const Catalog = require("../models/Catalog");
const Purchase = require("../models/Purchase");
const { pool } = require("../config/db");
const { receivePurchase } = require("../services/purchaseService");
const { createAudit } = require("../services/auditService");
const AppError = require("../utils/AppError");
const {
  startWarehouseTask,
  completeWarehouseTask,
} = require("../services/wmsService");

const modules = Object.freeze({
  recepcion: {
    key: "recepcion",
    title: "Recibir mercancía",
    subtitle: "Comprueba la entrega de un proveedor.",
    icon: "i-truck",
    path: "/rf/recepcion",
    permission: "rf.receive",
  },
  checkin: {
    key: "checkin",
    title: "Ubicar mercancía",
    subtitle: "Lleva cada carga a su estante asignado.",
    icon: "i-pin",
    path: "/rf/check-in",
    taskTypes: ["PUTAWAY"],
    permission: "rf.checkin",
  },
  picking: {
    key: "picking",
    title: "Preparar pedidos",
    subtitle: "Recoge productos para una sucursal.",
    icon: "i-package",
    path: "/rf/picking",
    taskTypes: ["PICKING"],
    permission: "rf.pick",
  },
  transfer: {
    key: "transfer",
    title: "Mover mercancía",
    subtitle: "Repón u organiza una carga asignada.",
    icon: "i-arrows",
    path: "/rf/transfer",
    taskTypes: ["REUBICACION", "REABASTECIMIENTO"],
    permission: "rf.transfer",
  },
  count: {
    key: "count",
    title: "Contar existencias",
    subtitle: "Escanea la ubicación y registra lo que encuentras.",
    icon: "i-clipboard",
    path: "/rf/count",
    permission: "rf.count",
  },
  returns: {
    key: "returns",
    title: "Aislar devoluciones",
    subtitle: "Lleva las cargas devueltas a control.",
    icon: "i-alert",
    path: "/rf/returns",
    taskTypes: ["DEVOLUCION_RUTA"],
    permission: "rf.returns",
  },
});

function rfLayout(res, view, data) {
  res.render(view, { layout: "layouts/rf", ...data });
}

function modulePathForTask(type) {
  if (type === "PUTAWAY") return "/rf/check-in";
  if (type === "PICKING") return "/rf/picking";
  if (type === "DEVOLUCION_RUTA") return "/rf/returns";
  if (["REUBICACION", "REABASTECIMIENTO"].includes(type)) return "/rf/transfer";
  return "/rf";
}

exports.home = async (req, res) =>
  rfLayout(res, "rf/home", {
    title: "RF WMS",
    modules: Object.values(modules).filter(module=>require("../config/permissions").can(req.session.user,module.permission)),
    summary: await Wms.rfSummary(req.session.user.id),
  });

exports.scanner = async (req, res) =>
  rfLayout(res, "rf/scanner", { title: "Scanner RF" });

exports.scan = async (req, res) => {
  const result = await Wms.scanLookup(req.query.code);
  res.json(
    result || {
      tipo: "NO_ENCONTRADO",
      codigo: req.query.code || "",
      titulo: "No encontrado",
      detalle: "No hay un registro asociado. Revisa la etiqueta y vuelve a escanear.",
    },
  );
};

exports.receiving = async (req, res) =>
  rfLayout(res, "rf/receiving", {
    title: "RF Receiving",
    module: modules.recepcion,
    orders: await Wms.pendingPurchaseOrders(),
  });

exports.receivingForm = async (req, res) => {
  const order = await Purchase.find(req.params.id);
  if (!order || !["PENDIENTE", "PARCIAL"].includes(order.estado))
    throw new AppError("La orden no se puede recibir", 409);
  rfLayout(res, "compras/recibir", {
    title: `RF recibir ${order.codigo_orden}`,
    order,
    locations: await Catalog.receivingLocations(),
    actionUrl: `/rf/recepcion/${order.id}`,
    errors: [],
  });
};

exports.receive = async (req, res) => {
  let items = [];
  try {
    items = JSON.parse(req.validated.items || "[]");
  } catch {
    throw new AppError("Detalle inválido");
  }
  const receipt = await receivePurchase({
    orderId: req.validated.id,
    userId: req.session.user.id,
    items,
  });
  req.session.flash = {
    type: "success",
    message: `Recibidas ${receipt.recibido_ahora} unidades; ${receipt.pendiente} siguen pendientes. Revisa las tareas de check-in.`,
  };
  res.redirect("/rf/recepcion");
};

async function taskModule(req, res, moduleKey) {
  const module = modules[moduleKey];
  rfLayout(res, "rf/tasks", {
    title: `RF ${module.title}`,
    module,
    tasks: await Wms.tasksByTypes(module.taskTypes, {
      ...req.query,
      operatorId:
        req.session.user.perfil === "operador_rf" ? req.session.user.id : null,
    }),
    filters: req.query,
  });
}

exports.checkIn = (req, res) => taskModule(req, res, "checkin");
exports.picking = (req, res) => taskModule(req, res, "picking");
exports.transfer = (req, res) => taskModule(req, res, "transfer");
exports.returns = (req, res) => taskModule(req, res, "returns");

exports.count = async (req, res) =>
  rfLayout(res, "rf/count", {
    title: "RF Count",
    module: modules.count,
    locations: await Wms.countingQueue(),
  });

async function countLocation(locationId) {
  const [[location]] = await pool.execute(
    `SELECT u.id,u.codigo_loc,u.tipo,COALESCE(z.nombre,u.zona) zona
     FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
     WHERE u.id=? AND u.activo=1 AND u.permite_conteo=1`,
    [locationId],
  );
  if (!location)
    throw new AppError("La LOC no está disponible para conteo", 404);
  return location;
}

exports.countForm = async (req, res) =>
  rfLayout(res, "rf/count-form", {
    title: "Conteo RF",
    location: await countLocation(req.validated.id),
    form: {},
    errors: [],
  });

exports.submitCount = async (req, res) => {
  const location = await countLocation(req.validated.id);
  try {
    if (
      String(req.body.codigo_loc || "")
        .trim()
        .toUpperCase() !== location.codigo_loc.toUpperCase()
    )
      throw new AppError(
        `Confirma la etiqueta física ${location.codigo_loc}`,
        409,
      );
    const productCode = String(req.body.codigo_producto || "")
      .trim()
      .toUpperCase();
    const [[product]] = await pool.execute(
      `SELECT id,sku FROM productos WHERE activo=1 AND (sku=? OR codigo_barras=?) LIMIT 1`,
      [productCode, productCode],
    );
    if (!product)
      throw new AppError("SKU o EAN no encontrado; escanéalo de nuevo", 422);
    await createAudit({
      productId: product.id,
      physicalStock: req.body.stock_fisico,
      userId: req.session.user.id,
      observations: req.body.observaciones,
      locationId: location.id,
      expiryDate: req.body.fecha_vencimiento,
      batchCode: req.body.codigo_lote,
    });
    req.session.flash = {
      type: "success",
      message: `Conteo de ${product.sku} en ${location.codigo_loc} registrado. Una diferencia queda pendiente de aprobación.`,
    };
    return res.redirect("/rf/count");
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("rf/count-form", {
      layout: "layouts/rf",
      title: "Revisa el conteo",
      location,
      form: req.body,
      errors: [{ msg: error.message }],
    });
  }
};

exports.startTask = async (req, res) => {
  const task = await startWarehouseTask({
    taskId: req.validated.id,
    userId: req.session.user.id,
  });
  req.session.flash = {
    type: "success",
    message: "Tarea tomada. Escanea origen, mueve y confirma destino.",
  };
  res.redirect(`/rf/tareas/${task.id}/ejecutar`);
};

exports.executeTask = async (req, res) => {
  const task = await Wms.task(req.validated.id);
  if (!task) throw new AppError("La tarea no existe", 404);
  if (task.estado !== "EN_PROCESO")
    throw new AppError("Primero debes tomar la tarea desde su cola", 409);
  if (Number(task.asignado_a) !== Number(req.session.user.id))
    throw new AppError("La tarea está asignada a otro operario", 403);
  require("../services/accessPolicy").requireTaskCapability(req.session.user,task);
  rfLayout(res, "rf/execute", {
    title: `Ejecutar ${task.codigo_tarea}`,
    task,
    returnPath: modulePathForTask(task.tipo),
  });
};

exports.completeTask = async (req, res) => {
  let task;
  try {
    task = await completeWarehouseTask({
      taskId: req.validated.id,
      userId: req.session.user.id,
      role: req.session.user.rol,
      scannedOrigin: req.validated.codigo_origen,
      scannedProduct: req.validated.codigo_producto,
      scannedDestination: req.validated.codigo_destino,
    });
  } catch (error) {
    if (error.status && error.status < 500) {
      req.session.flash = { type: "danger", message: error.message };
      return res.redirect(`/rf/tareas/${req.validated.id}/ejecutar`);
    }
    throw error;
  }
  req.session.flash = {
    type: "success",
    message: "Movimiento confirmado y kardex actualizado.",
  };
  res.redirect(modulePathForTask(task.tipo));
};
