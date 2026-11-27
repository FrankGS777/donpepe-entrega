const { can, profileOf } = require("../config/permissions");
const User = require("../models/User");
const { homeByRole } = require("../utils/home");

async function refreshIdentity(req) {
  if (!req.session.user) return null;
  const user = await User.findSessionIdentity(req.session.user.id);
  if (!user || !user.activo || user.rol_activo === 0) return null;
  req.session.user = {
    id: user.id,
    nombre: user.nombre,
    correo: user.correo,
    rol: user.rol,
    perfil: profileOf(user),
    rol_etiqueta: user.rol_etiqueta,
    permisos: user.permisos,
  };
  return req.session.user;
}
async function requireAuth(req, res, next) {
  try {
    const user = await refreshIdentity(req);
    if (!user) {
      req.session.returnTo = req.originalUrl;
      delete req.session.user;
      return res.redirect("/login");
    }
    res.locals.currentUser = user;
    res.locals.homePath = homeByRole(user);
    next();
  } catch (error) {
    next(error);
  }
}
function guestOnly(req, res, next) {
  if (req.session.user) return res.redirect(homeByRole(req.session.user));
  next();
}
function permit(...permissions) {
  return async (req, res, next) => {
    try {
      const user = await refreshIdentity(req);
      if (!user) {
        delete req.session.user;
        return res.redirect("/login");
      }
      res.locals.currentUser = user;
      res.locals.homePath = homeByRole(user);
      if (!permissions.some((p) => can(user, p)))
        return res.status(403).render("errors/403", {
          layout:
            profileOf(user) === "operador_rf" ? "layouts/rf" : "layouts/main",
          title: "Acceso denegado",
        });
      next();
    } catch (error) {
      next(error);
    }
  };
}
module.exports = { requireAuth, guestOnly, permit, refreshIdentity };
