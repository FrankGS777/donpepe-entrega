const r = require("express").Router(),
  c = require("../controllers/reportController"),
  a = require("../utils/asyncHandler"),
  { permit } = require("../middleware/auth");
r.get("/", permit("reports.business"), a(c.index));
r.get("/kardex.csv", permit("reports.export"), a(c.csv));
module.exports = r;
