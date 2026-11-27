const r = require("express").Router(),
  c = require("../controllers/userController"),
  a = require("../utils/asyncHandler"),
  v = require("../validators/common"),
  validate = require("../middleware/validate"),
  User = require("../models/User"),
  { permit } = require("../middleware/auth");
const reload = async (req) => ({
  roles: await User.roles(),
  user: {
    ...req.body,
    id: req.params.id || null,
    activo: Boolean(req.body.activo),
  },
  isSelf: Number(req.params.id) === Number(req.session.user.id),
});
r.get("/", permit("users.view"), a(c.index));
r.get("/nuevo", permit("users.create"), a(c.newForm));
r.post(
  "/",
  permit("users.create"),
  v.user,
  validate("usuarios/form", reload),
  a(c.create),
);
r.get(
  "/:id/editar",
  permit("users.update"),
  v.id(),
  require("../middleware/rejectInvalid"),
  a(c.editForm),
);
r.put(
  "/:id",
  permit("users.update"),
  v.id(),
  v.user,
  validate("usuarios/form", reload),
  a(c.update),
);
module.exports = r;
