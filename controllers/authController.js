const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { homeByRole } = require("../utils/home");
const { validationResult } = require("express-validator");
exports.form = (req, res) =>
  res.render("auth/login", {
    title: "Iniciar sesión",
    layout: "layouts/auth",
    error: null,
  });
exports.login = async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty())
    return res.status(422).render("auth/login", {
      title: "Iniciar sesión",
      layout: "layouts/auth",
      error: "Ingresa un correo y una contraseña válidos.",
    });
  const correo = String(req.body.correo || "")
    .trim()
    .toLowerCase();
  const password = String(req.body.password || "");
  const user = await User.findByEmail(correo);
  if (
    !user ||
    !user.activo ||
    user.rol_activo === 0 ||
    !(await bcrypt.compare(password, user.password))
  )
    return res.status(401).render("auth/login", {
      title: "Iniciar sesión",
      layout: "layouts/auth",
      error: "Correo o contraseña incorrectos.",
    });
  const returnTo = req.session.returnTo || homeByRole(user);
  delete req.session.returnTo;
  await new Promise((resolve, reject) =>
    req.session.regenerate((error) => (error ? reject(error) : resolve())),
  );
  req.session.user = {
    id: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rol: user.rol,
    perfil: user.perfil,
    permisos: user.permisos || [],
    rol_etiqueta: user.rol_etiqueta,
  };
  res.redirect(returnTo);
};
exports.logout = (req, res, next) =>
  req.session.destroy((error) =>
    error ? next(error) : res.redirect("/login"),
  );
