const User = require("../models/User");
const {
  requestEmailChange,
  confirmEmailChange,
  pendingEmailChange,
} = require("../services/recoveryEmailService");
const AppError = require("../utils/AppError");
const context = async (req) => ({
  title: "Mi cuenta",
  layout:
    req.session.user.perfil === "operador_rf" ? "layouts/rf" : "layouts/main",
  account: await User.find(req.session.user.id),
  errors: [],
});
exports.context = context;
exports.form = async (req, res) =>
  res.render("cuenta/profile", await context(req));
exports.update = async (req, res) => {
  try {
    await requestEmailChange({
      userId: req.session.user.id,
      email: req.validated.correo_recuperacion,
      currentPassword: req.body.password_actual,
    });
    req.session.flash = {
      type: "success",
      message:
        "Enviamos la verificación al nuevo correo. Abre el enlace desde tu sesión para vincularlo; el correo actual no cambia todavía.",
    };
    res.redirect("/mi-cuenta");
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    res.status(error.status).render("cuenta/profile", {
      ...(await context(req)),
      errors: [{ msg: error.message }],
      proposedEmail: req.validated.correo_recuperacion,
    });
  }
};
exports.verifyForm = async (req, res) =>
  res.render("cuenta/verify-email", {
    ...(await context(req)),
    token: req.params.token,
    proposedEmail: await pendingEmailChange({
      userId: req.session.user.id,
      token: req.params.token,
    }),
  });
exports.verify = async (req, res) => {
  await confirmEmailChange({
    userId: req.session.user.id,
    token: req.params.token,
  });
  req.session.flash = {
    type: "success",
    message:
      "Correo vinculado. Las próximas recuperaciones aprobadas llegarán a tu correo personal.",
  };
  res.redirect("/mi-cuenta");
};
