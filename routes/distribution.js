const r = require("express").Router();
const c = require("../controllers/distributionController");
const a = require("../utils/asyncHandler");
const { permit } = require("../middleware/auth");
const { id } = require("../validators/common");
const reject = require("../middleware/rejectInvalid");

r.get("/", permit("distribution.view"), a(c.index));
r.get("/nuevo", permit("distribution.create"), a(c.form));
r.post("/", permit("distribution.create"), a(c.create));
r.post("/maestro", permit("distribution.branches.manage"), a(c.createBranch));
r.get("/:id", permit("distribution.view"), id(), reject, a(c.show));
r.post("/:id/planificar", permit("distribution.plan"), id(), reject, a(c.plan));
r.post(
  "/:id/despachar",
  permit("distribution.dispatch"),
  id(),
  reject,
  a(c.dispatch),
);
r.post(
  "/:id/devolver",
  permit("distribution.return"),
  id(),
  reject,
  a(c.registerReturn),
);
module.exports = r;
