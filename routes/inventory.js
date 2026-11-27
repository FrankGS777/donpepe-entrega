const r = require("express").Router(),
  c = require("../controllers/inventoryController"),
  a = require("../utils/asyncHandler"),
  { permit } = require("../middleware/auth");
r.get("/lotes", permit("inventory.lots"), a(c.lots));
r.get("/movimientos", permit("inventory.movements"), a(c.movements));
r.get("/salud", permit("inventory.health"), a(c.health));
module.exports = r;
