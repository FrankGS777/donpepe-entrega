const Role = require("../models/Role");
const { catalog } = require("../config/permissionCatalog");
const { saveRole } = require("../services/roleService");
const AppError = require("../utils/AppError");
exports.index = async (req, res) =>
  res.render("roles/index", {
    title: "Roles y permisos",
    roles: await Role.all(),
  });
exports.form = async (req, res) => {
  const role = req.params.id
    ? await Role.find(req.params.id)
    : { activo: 1, perfil: "jefe_operaciones", permisos: [] };
  if (!role) throw new AppError("Rol no encontrado", 404);
  res.render("roles/form", {
    title: role.sistema
      ? "Permisos del rol"
      : role.id
        ? "Editar rol"
        : "Crear rol",
    role,
    catalog,
    history: role.id ? await Role.history(role.id) : [],
    errors: [],
  });
};
exports.save = async (req, res) => {
  try {
    await saveRole({
      actorId: req.session.user.id,
      roleId: req.params.id,
      data: req.body,
    });
    req.session.flash = {
      type: "success",
      message:
        "Rol guardado. Los permisos se aplican en la siguiente petición de cada usuario.",
    };
    res.redirect("/roles");
  } catch (error) {
    if (!(error instanceof AppError) || error.status >= 500) throw error;
    const existing = req.params.id ? await Role.find(req.params.id) : {};
    const role = {
      ...existing,
      ...req.body,
      id: req.params.id,
      activo: Boolean(req.body.activo),
      permisos: Array.isArray(req.body.permisos)
        ? req.body.permisos
        : req.body.permisos
          ? [req.body.permisos]
          : [],
    };
    res
      .status(error.status)
      .render("roles/form", {
        title: "Revisa el rol",
        role,
        catalog,
        history: [],
        errors: [{ msg: error.message }],
      });
  }
};
