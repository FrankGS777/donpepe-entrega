const r = require("express").Router(),
  c = require("../controllers/purchaseController"),
  a = require("../utils/asyncHandler"),
  { permit } = require("../middleware/auth"),
  v = require("../validators/common"),
  validate = require("../middleware/validate"),
  Product = require("../models/Product"),
  Catalog = require("../models/Catalog"),
  reject = require("../middleware/rejectInvalid");
const reloadPurchase = async () => ({
  products: await Product.active(),
  providers: await Catalog.all("proveedores"),
});
r.get("/", permit("purchases.view"), a(c.index));
r.get("/nueva", permit("purchases.create"), a(c.newForm));
r.post(
  "/",
  permit("purchases.create"),
  v.purchase,
  validate("compras/form", reloadPurchase),
  a(c.create),
);
r.get("/:id", permit("purchases.view"), v.id(), reject, a(c.show));
// Receiving es una operación física exclusiva de /rf/recepcion/:id.
r.post(
  "/:id/cancelar",
  permit("purchases.cancel"),
  v.id(),
  reject,
  a(c.cancel),
);
module.exports = r;
