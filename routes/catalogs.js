const r = require("express").Router(),
  c = require("../controllers/catalogController"),
  a = require("../utils/asyncHandler"),
  { permit } = require("../middleware/auth"),
  v = require("../validators/common"),
  validate = require("../middleware/validate"),
  Catalog = require("../models/Catalog"),
  reject = require("../middleware/rejectInvalid");
const reload = async (req) => ({
  type: req.params.type,
  item: {
    ...req.body,
    id: req.params.id || null,
    activo: Boolean(req.body.activo),
  },
  zones: req.params.type === "ubicaciones" ? await Catalog.zones() : [],
});
r.get("/:type", permit("catalogs.view"), v.catalogType, reject, a(c.index));
r.get(
  "/:type/nuevo",
  permit("catalogs.create"),
  v.catalogType,
  reject,
  a(c.newForm),
);
r.post(
  "/:type",
  permit("catalogs.create"),
  v.catalogType,
  v.catalog,
  validate("categorias/form", reload),
  a(c.create),
);
r.get(
  "/:type/:id/editar",
  permit("catalogs.update"),
  v.catalogType,
  v.id(),
  reject,
  a(c.editForm),
);
r.put(
  "/:type/:id",
  permit("catalogs.update"),
  v.catalogType,
  v.id(),
  v.catalog,
  validate("categorias/form", reload),
  a(c.update),
);
r.delete(
  "/:type/:id",
  permit("catalogs.delete"),
  v.catalogType,
  v.id(),
  reject,
  a(c.remove),
);
module.exports = r;
