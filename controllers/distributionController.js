const Distribution = require("../models/Distribution");
const {
  createBranchOrder,
  planBranchOrder,
  dispatchBranchOrder,
  registerBranchReturn,
} = require("../services/distributionService");
const { pool } = require("../config/db");
const AppError = require("../utils/AppError");
const Wms = require("../models/Wms");

exports.index = async (req, res) =>
  res.render("distribution/index", {
    title: "Pedidos de sucursales",
    orders: await Distribution.orders(),
    branches: await Distribution.branches(false),
  });
exports.form = async (req, res) =>
  res.render("distribution/form", {
    title: "Nuevo pedido de sucursal",
    branches: await Distribution.branches(),
    products: await Distribution.products(),
    errors: [],
    form: {},
  });
exports.create = async (req, res) => {
  try {
    const order = await createBranchOrder({
      branchId: Number(req.body.sucursal_id),
      items: req.body.items,
      userId: req.session.user.id,
      observations: req.body.observaciones,
    });
    req.session.flash = {
      type: "success",
      message: `Pedido ${order.code} registrado. Planifica el picking cuando haya stock en la zona activa.`,
    };
    return res.redirect(`/wms/sucursales/${order.id}`);
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("distribution/form", {
      title: "Revisa el pedido",
      branches: await Distribution.branches(),
      products: await Distribution.products(),
      errors: [{ msg: error.message }],
      form: req.body,
    });
  }
};
exports.show = async (req, res) => {
  const order = await Distribution.order(req.params.id);
  if (!order) throw new AppError("Pedido no encontrado", 404);
  const operators = res.locals.can("wms.tasks.assign") ? await Wms.operators() : [];
  return res.render("distribution/show", { title: order.codigo, order, operators });
};
exports.plan = async (req, res) => {
  try {
    const result = await planBranchOrder({
      orderId: Number(req.params.id),
      userId: req.session.user.id,
      operatorId: req.body.operador_id || null,
    });
    req.session.flash = {
      type: "success",
      message: req.body.operador_id
        ? `${result.tasks} tareas de ${result.code} preparadas y asignadas al operador.`
        : `${result.tasks} tareas de picking generadas para ${result.code}. Asígnalas a RF.`,
    };
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    req.session.flash = { type: "danger", message: error.message };
  }
  res.redirect(`/wms/sucursales/${req.params.id}`);
};
exports.dispatch = async (req, res) => {
  const result = await dispatchBranchOrder({
    orderId: Number(req.params.id),
    userId: req.session.user.id,
    guide: req.body.referencia_guia,
    plate: req.body.placa_vehiculo,
  });
  req.session.flash = {
    type: "success",
    message: `${result.code}: ${result.units} unidades descontadas del CD y salida registrada.`,
  };
  res.redirect(`/wms/sucursales/${req.params.id}`);
};
exports.registerReturn = async (req, res) => {
  try {
    const result = await registerBranchReturn({
      orderId: Number(req.params.id),
      pickingTaskId: Number(req.body.tarea_picking_id),
      quantity: req.body.cantidad,
      reason: req.body.motivo,
      userId: req.session.user.id,
    });
    req.session.flash = {
      type: "success",
      message: `${result.quantity} UND de ${result.code} aisladas en recepción. Asigna la tarea ${result.task} a RF para moverlas a cuarentena.`,
    };
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    req.session.flash = { type: "danger", message: error.message };
  }
  res.redirect(`/wms/sucursales/${req.params.id}`);
};
exports.createBranch = async (req, res) => {
  const code = String(req.body.codigo || "")
    .trim()
    .toUpperCase();
  const name = String(req.body.nombre || "").trim();
  const address = String(req.body.direccion || "").trim();
  if (
    !/^[A-Z0-9-]{3,15}$/.test(code) ||
    name.length < 3 ||
    name.length > 100 ||
    address.length < 5 ||
    address.length > 180
  )
    throw new AppError("Código, nombre o dirección de sucursal inválidos", 422);
  await pool.execute(
    "INSERT INTO sucursales (codigo,nombre,direccion) VALUES (?,?,?)",
    [code, name, address],
  );
  req.session.flash = {
    type: "success",
    message: `Sucursal ${name} habilitada.`,
  };
  res.redirect("/wms/sucursales");
};
