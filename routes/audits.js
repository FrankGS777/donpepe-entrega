const r = require("express").Router(),
  c = require("../controllers/inventoryController"),
  a = require("../utils/asyncHandler"),
  { permit } = require("../middleware/auth"),
  v = require("../validators/common"),
  validate = require("../middleware/validate"),
  Inventory = require("../models/Inventory"),
  Product = require("../models/Product"),
  Catalog = require("../models/Catalog"),
  reject = require("../middleware/rejectInvalid");
const reloadAudit = async () => ({
  products: await Product.active(),
  locations: await Catalog.countingLocations(),
  countMatrix: await Inventory.countingMatrix(),
});
r.get("/", permit("audits.view"), a(c.audits));
r.get("/nueva", permit("audits.create"), a(c.auditForm));
r.post(
  "/",
  permit("audits.create"),
  v.audit,
  validate("auditorias/form", reloadAudit),
  a(c.createAudit),
);
r.post(
  "/:id/aprobar",
  permit("audits.approve"),
  v.id(),
  reject,
  a(c.approveAudit),
);
r.post(
  "/:id/rechazar",
  permit("audits.reject"),
  v.id(),
  reject,
  a(c.rejectAudit),
);
module.exports = r;
