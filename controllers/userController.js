const User = require("../models/User");
const { createUser, updateUser } = require("../services/userService");
const AppError = require("../utils/AppError");
exports.index = async (req, res) => {
  const users = await User.all();
  res.render("usuarios/index", {
    title: "Usuarios y acceso",
    users,
    stats: {
      total: users.length,
      active: users.filter((user) => user.activo).length,
      administrators: users.filter(
        (user) => user.activo && user.rol === "administrador_wms",
      ).length,
      rf: users.filter(
        (user) => user.activo && (user.perfil || user.rol) === "operador_rf",
      ).length,
    },
  });
};
exports.newForm = async (req, res) =>
  res.render("usuarios/form", {
    title: "Nuevo usuario",
    user: { activo: 1, correo_recuperacion: "" },
    roles: await User.roles(),
    errors: [],
    isSelf: false,
  });
exports.create = async (req, res) => {
  try {
    await createUser(
      {
        ...req.validated,
        password: req.body.password,
        activo: Boolean(req.body.activo),
      },
      req.session.user.id,
    );
  } catch (error) {
    if (!(error instanceof AppError) || error.status >= 500) throw error;
    return res.status(error.status).render("usuarios/form", {
      title: "Nuevo usuario",
      user: { ...req.body, activo: Boolean(req.body.activo) },
      roles: await User.roles(),
      errors: [{ msg: error.message }],
      isSelf: false,
    });
  }
  req.session.flash = { type: "success", message: "Usuario creado." };
  res.redirect("/usuarios");
};
exports.editForm = async (req, res) => {
  const user = await User.find(req.params.id);
  if (!user) throw new AppError("El usuario solicitado no existe.", 404);
  res.render("usuarios/form", {
    title: "Editar usuario",
    user,
    roles: await User.roles(),
    errors: [],
    isSelf: Number(req.params.id) === Number(req.session.user.id),
  });
};
exports.update = async (req, res) => {
  let updated;
  try {
    updated = await updateUser({
      targetId: req.params.id,
      actorId: req.session.user.id,
      data: {
        ...req.validated,
        password: req.body.password || "",
        activo: Boolean(req.body.activo),
      },
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.status >= 500) throw error;
    return res.status(error.status).render("usuarios/form", {
      title: "Editar usuario",
      user: {
        ...req.body,
        id: req.params.id,
        activo: Boolean(req.body.activo),
      },
      roles: await User.roles(),
      errors: [{ msg: error.message }],
      isSelf: Number(req.params.id) === Number(req.session.user.id),
    });
  }
  if (updated.id === req.session.user.id)
    req.session.user = {
      ...req.session.user,
      nombre: updated.nombre,
      correo: updated.correo,
    };
  req.session.flash = { type: "success", message: "Usuario actualizado." };
  res.redirect("/usuarios");
};
