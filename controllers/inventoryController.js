const Inventory = require("../models/Inventory");
const Product = require("../models/Product");
const Catalog = require("../models/Catalog");
const {
  createAudit,
  approveAudit,
  rejectAudit,
} = require("../services/auditService");
exports.lots = async (req, res) =>
  res.render("inventario/lotes", {
    title: "Lotes y vencimientos",
    lots: await Inventory.lots(req.query),
    zones: await Catalog.zones(),
    filters: req.query,
  });
exports.movements = async (req, res) =>
  res.render("inventario/movimientos", {
    title: "Kardex",
    movements: await Inventory.movements(req.query),
    filters: req.query,
  });
exports.health = async (req, res) => {
  const rows = await Inventory.health();
  const differences = rows.filter((row) => Number(row.diferencia) !== 0).length;
  res.render("inventario/salud", {
    title: "Salud de inventario",
    rows,
    summary: {
      total: rows.length,
      synchronized: rows.length - differences,
      differences,
    },
    checkedAt: new Date(),
  });
};
exports.audits = async (req, res) =>
  res.render("auditorias/index", {
    title: "Auditorías",
    audits: await Inventory.audits(req.query),
    filters: req.query,
  });
exports.auditForm = async (req, res) =>
  res.render("auditorias/form", {
    title: "Nueva auditoría",
    products: await Product.active(),
    locations: await Catalog.countingLocations(),
    countMatrix: await Inventory.countingMatrix(),
    form: req.query,
    errors: [],
  });
exports.createAudit = async (req, res) => {
  try {
    await createAudit({
      productId: req.validated.producto_id,
      physicalStock: req.validated.stock_fisico,
      userId: req.session.user.id,
      observations: req.validated.observaciones,
      locationId: req.validated.ubicacion_id,
      expiryDate: req.validated.fecha_vencimiento,
      batchCode: req.validated.codigo_lote,
    });
    req.session.flash = {
      type: "success",
      message:
        "Conteo registrado. Si existe diferencia, espera aprobación de otro responsable autorizado.",
    };
    return res.redirect("/auditorias");
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("auditorias/form", {
      title: "Revisa el conteo",
      products: await Product.active(),
      locations: await Catalog.countingLocations(),
      countMatrix: await Inventory.countingMatrix(),
      form: req.body,
      errors: [{ msg: error.message }],
    });
  }
};
exports.approveAudit = async (req, res) => {
  await approveAudit({
    auditId: req.validated.id,
    userId: req.session.user.id,
  });
  req.session.flash = {
    type: "success",
    message: "Ajuste aprobado; stock, lote y kardex fueron actualizados.",
  };
  res.redirect("/auditorias");
};
exports.rejectAudit = async (req, res) => {
  await rejectAudit({ auditId: req.validated.id, userId: req.session.user.id });
  req.session.flash = {
    type: "success",
    message: "Conteo rechazado sin modificar el inventario.",
  };
  res.redirect("/auditorias");
};
