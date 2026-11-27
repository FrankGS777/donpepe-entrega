const Product = require("../models/Product");
const { can } = require("../config/permissions");
const AppError = require("../utils/AppError");

async function validateWmsStrategy(data, productId = 0) {
  if (data.control_vencimiento && !data.control_lote)
    throw new AppError(
      "El control de vencimiento requiere mantener trazabilidad por lote",
      422,
    );
  if (Number(data.stock_objetivo_pick) > 0 && !data.ubicacion_picking_id)
    throw new AppError(
      "Selecciona una LOC primaria cuando el objetivo de picking es mayor que cero",
      422,
    );
  if (
    data.ubicacion_picking_id &&
    !(await Product.pickingLocation(data.ubicacion_picking_id))
  )
    throw new AppError(
      "La LOC primaria debe estar activa y tener perfil PICKING",
      422,
    );
  if (data.ubicacion_picking_id) {
    const owner = await Product.primaryOwner(data.ubicacion_picking_id, productId);
    if (owner) throw new AppError(`La cara de picking ya está asignada al SKU ${owner.sku}`, 409);
  }
}

async function renderProductError(req, res, error, product) {
  const original = product.id ? await Product.find(product.id) : null;
  return res.status(error.status).render("productos/form", {
    title: "Revisa el SKU",
    product: { ...original, ...product },
    ...(await Product.options()),
    errors: [{ msg: error.message }],
  });
}
exports.index = async (req, res) =>
  res.render("productos/index", {
    title: "Productos",
    products: await Product.all(req.query),
    filters: req.query,
  });
exports.newForm = async (req, res) => {
  const options = await Product.options();
  return res.render("productos/form", {
    title: "Nuevo producto",
    product: {
      activo: 1,
      unidad_medida: "UND",
      peso_kg: 0,
      volumen_m3: 0,
      control_lote: 1,
      control_vencimiento: 1,
      stock_minimo: 10,
      clase_abc: "B",
      stock_objetivo_pick: 20,
      ubicacion_picking_id: options.pickingLocations.find((loc) => !loc.owner_sku)?.id || null,
    },
    ...options,
    errors: [],
  });
};
exports.create = async (req, res) => {
  const changes = {
    ...req.validated,
    activo: Boolean(req.body.activo),
    control_lote: Boolean(req.body.control_lote),
    control_vencimiento: Boolean(req.body.control_vencimiento),
  };
  try {
    await validateWmsStrategy(changes);
    await Product.create(changes);
    req.session.flash = { type: "success", message: "Producto creado." };
    return res.redirect("/productos");
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return renderProductError(req, res, error, {
      ...req.body,
      ...changes,
      activo: Boolean(req.body.activo),
    });
  }
};
exports.editForm = async (req, res) => {
  const product = await Product.find(req.params.id);
  if (!product) return res.sendStatus(404);
  res.render("productos/form", {
    title: "Editar producto",
    product,
    ...(await Product.options()),
    errors: [],
  });
};
exports.update = async (req, res) => {
  let changes = {
    ...req.validated,
    activo: Boolean(req.body.activo),
    control_lote: Boolean(req.body.control_lote),
    control_vencimiento: Boolean(req.body.control_vencimiento),
  };
  const logisticsOnly =
    !can(req.session.user, "products.update") &&
    can(req.session.user, "products.update_logistics");
  try {
    await validateWmsStrategy(changes, req.params.id);
    if (logisticsOnly) {
      await Product.updateLogistics(req.params.id, changes);
    } else {
      await Product.update(req.params.id, changes);
    }
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return renderProductError(req, res, error, {
      ...req.body,
      ...changes,
      id: req.params.id,
      activo: Boolean(req.body.activo),
    });
  }
  req.session.flash = {
    type: "success",
    message: logisticsOnly
      ? "Estrategia WMS del SKU actualizada; los datos comerciales se conservaron."
      : "Producto actualizado.",
  };
  res.redirect("/productos");
};
exports.remove = async (req, res) => {
  await Product.deactivate(req.params.id);
  req.session.flash = {
    type: "success",
    message: "Producto desactivado sin borrar su historial.",
  };
  res.redirect("/productos");
};
