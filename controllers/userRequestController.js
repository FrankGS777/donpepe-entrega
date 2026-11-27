const UserRequest = require("../models/UserRequest");
const AppError = require("../utils/AppError");
const {
  requestPasswordReset,
  approveRequest,
  rejectRequest,
  regenerateLink,
  tokenRequest,
  completeWithPassword,
} = require("../services/userRequestService");

const authView = (res, view, data) =>
  res.render(view, { layout: "layouts/auth", ...data });

exports.forgotForm = (req, res) =>
  authView(res, "auth/forgot-password", {
    title: "Recuperar acceso",
    form: {},
    errors: [],
  });

exports.submitForgot = async (req, res) => {
  await requestPasswordReset({ email: req.validated.correo });
  return authView(res, "auth/request-sent", {
    title: "Solicitud recibida",
    kind: "reset",
  });
};

exports.activationForm = async (req, res) => {
  const request = await tokenRequest(req.params.token);
  return authView(res, "auth/set-password", {
    title: "Nueva contraseña",
    request,
    token: req.params.token,
    errors: [],
  });
};

exports.completeActivation = async (req, res) => {
  try {
    await completeWithPassword({
      token: req.params.token,
      password: req.validated.password,
    });
  } catch (error) {
    if (!(error instanceof AppError) || error.status >= 500 || error.status === 410)
      throw error;
    const request = await tokenRequest(req.params.token);
    return res.status(error.status).render("auth/set-password", {
      layout: "layouts/auth", title: "Nueva contraseña", request,
      token: req.params.token, errors: [{ msg: error.message }],
    });
  }
  return authView(res, "auth/password-complete", {
    title: "Acceso actualizado",
    kind: "reset",
  });
};

exports.index = async (req, res) => {
  await UserRequest.expireOld();
  const requests = await UserRequest.all(req.query);
  res.render("solicitudes/index", {
    title: "Recuperación de contraseñas",
    requests,
    filters: req.query,
  });
};

exports.approve = async (req, res) => {
  const result = await approveRequest({
    requestId: req.validated.id,
    actorId: req.session.user.id,
    note: req.validated.observacion,
  });
  res.render("solicitudes/link", {
    title: "Enlace seguro generado",
    ...result,
  });
};

exports.reject = async (req, res) => {
  await rejectRequest({
    requestId: req.validated.id,
    actorId: req.session.user.id,
    note: req.validated.observacion,
  });
  req.session.flash = {
    type: "success",
    message: "Solicitud rechazada y registrada en el historial.",
  };
  res.redirect("/solicitudes");
};

exports.regenerate = async (req, res) => {
  const result = await regenerateLink({
    requestId: req.validated.id,
    actorId: req.session.user.id,
  });
  res.render("solicitudes/link", {
    title: "Nuevo enlace seguro",
    ...result,
  });
};
