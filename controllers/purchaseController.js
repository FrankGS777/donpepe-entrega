const Purchase = require("../models/Purchase");
const Product = require("../models/Product");
const Catalog = require("../models/Catalog");
const {
  createPurchase,
  receivePurchase,
  cancelPurchase,
} = require("../services/purchaseService");
const AppError = require("../utils/AppError");
const parse = (raw) => {
  try {
    return JSON.parse(raw || "[]");
  } catch {
    throw new AppError("Detalle inválido");
  }
};
exports.index = async (req, res) =>
  res.render("compras/index", {
    title: "Órdenes de compra",
    orders: await Purchase.all(req.query),
    filters: req.query,
  });
exports.newForm = async (req, res) =>
  res.render("compras/form", {
    title: "Nueva orden",
    products: await Product.active(),
    providers: await Catalog.all("proveedores"),
    errors: [],
  });
exports.create = async (req, res) => {
  try {
    const order = await createPurchase({
      providerId: req.validated.proveedor_id,
      userId: req.session.user.id,
      items: parse(req.validated.items),
    });
    req.session.flash = {
      type: "success",
      message: `Orden ${order.code} creada.`,
    };
    return res.redirect(`/compras/${order.id}`);
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("compras/form", {
      title: "Revisa la orden",
      products: await Product.active(),
      providers: await Catalog.all("proveedores"),
      form: req.body,
      errors: [{ msg: error.message }],
    });
  }
};
exports.show = async (req, res) => {
  const order = await Purchase.find(req.params.id);
  if (!order) throw new AppError("Orden no encontrada", 404);
  res.render("compras/show", { title: order.codigo_orden, order });
};
exports.receiveForm = async (req, res) => {
  const order = await Purchase.find(req.params.id);
  if (!order || !["PENDIENTE", "PARCIAL"].includes(order.estado))
    throw new AppError("La orden no se puede recibir", 409);
  res.render("compras/recibir", {
    title: `Recibir ${order.codigo_orden}`,
    order,
    locations: await Catalog.receivingLocations(),
    errors: [],
  });
};
exports.receive = async (req, res) => {
  try {
    const receipt = await receivePurchase({
      orderId: req.validated.id,
      userId: req.session.user.id,
      items: parse(req.validated.items),
    });
    req.session.flash = {
      type: "success",
      message: `Ingresaron ${receipt.recibido_ahora} unidades. ${receipt.pendiente ? `Quedan ${receipt.pendiente} pendientes en la OC.` : "La OC quedó completa."} Se generaron las tareas de put-away correspondientes.`,
    };
    return res.redirect(`/compras/${req.validated.id}`);
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    const order = await Purchase.find(req.params.id);
    return res.status(error.status).render("compras/recibir", {
      title: `Revisa ${order?.codigo_orden || "la recepción"}`,
      order,
      locations: await Catalog.receivingLocations(),
      errors: [{ msg: error.message }],
      form: req.body,
    });
  }
};
exports.cancel = async (req, res) => {
  await cancelPurchase(req.params.id);
  req.session.flash = { type: "success", message: "Orden cancelada." };
  res.redirect("/compras");
};
