const r = require("express").Router();
const c = require("../controllers/productController");
const a = require("../utils/asyncHandler");
const { permit } = require("../middleware/auth");
const v = require("../validators/common");
const validate = require("../middleware/validate");
const Product = require("../models/Product");
const reload = async (req) => ({
  product: {
    ...(req.params.id ? await Product.find(req.params.id) : {}),
    ...req.body,
    id: req.params.id || null,
    control_lote: Boolean(req.body.control_lote),
    control_vencimiento: Boolean(req.body.control_vencimiento),
  },
  ...(await Product.options()),
});
const productRulesByRole = (req, _res, next) => {
  const rules =
    req.session.user.perfil === "jefe_operaciones"
      ? v.productLogistics
      : v.product;
  Promise.all(rules.map((rule) => rule.run(req))).then(() => next(), next);
};
r.get("/", permit("products.view"), a(c.index));
r.get("/nuevo", permit("products.create"), a(c.newForm));
r.post(
  "/",
  permit("products.create"),
  v.product,
  validate("productos/form", reload),
  a(c.create),
);
r.get(
  "/:id/editar",
  permit("products.update", "products.update_logistics"),
  v.id(),
  a(c.editForm),
);
r.put(
  "/:id",
  permit("products.update", "products.update_logistics"),
  v.id(),
  productRulesByRole,
  validate("productos/form", reload),
  a(c.update),
);
r.delete("/:id", permit("products.deactivate"), v.id(), a(c.remove));
module.exports = r;
