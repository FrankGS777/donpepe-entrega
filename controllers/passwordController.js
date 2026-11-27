const AppError = require("../utils/AppError");
const { changeOwnPassword } = require("../services/passwordService");
const { homeByRole } = require("../utils/home");

const viewData = (req, errors = []) => ({
  title: "Cambiar mi contraseña",
  layout:
    req.session.user.perfil === "operador_rf" ? "layouts/rf" : "layouts/main",
  errors,
});

exports.form = (req, res) => res.render("cuenta/password", viewData(req));

exports.update = async (req, res) => {
  try {
    await changeOwnPassword({
      userId: req.session.user.id,
      currentPassword: req.validated.password_actual,
      newPassword: req.validated.password,
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.status >= 500) throw error;
    return res
      .status(error.status)
      .render("cuenta/password", viewData(req, [{ msg: error.message }]));
  }
  req.session.flash = { type: "success", message: "Contraseña actualizada." };
  return res.redirect(homeByRole(req.session.user));
};

exports.validationView = (req) => ({
  title: "Cambiar mi contraseña",
  layout:
    req.session.user.perfil === "operador_rf" ? "layouts/rf" : "layouts/main",
});
