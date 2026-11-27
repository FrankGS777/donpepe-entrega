const { can, roleDescriptions } = require("../config/permissions");
const env = require("../config/env");
const { homeByRole } = require("../utils/home");
const UserRequest = require("../models/UserRequest");

const pageContext = (path) => {
  const contexts = [
    [/^\/dashboard/, ["Inicio", "Resumen operativo"]],
    [/^\/solicitudes/, ["Seguridad", "Recuperación de contraseñas"]],
    [/^\/usuarios/, ["Seguridad", "Usuarios y roles"]],
    [/^\/roles/, ["Seguridad", "Roles y permisos"]],
    [/^\/mi-cuenta/, ["Cuenta", "Correo de recuperación"]],
    [/^\/productos/, ["Inventario", "Maestro de SKU"]],
    [/^\/compras/, ["Inbound", "Órdenes de compra"]],
    [/^\/wms\/posiciones/, ["WMS Core", "Zonas, LOC y stock"]],
    [/^\/wms\/tareas/, ["WMS Core", "Gestión de tareas"]],
    [/^\/inventario\/lotes/, ["Inventario", "Lotes y caducidad"]],
    [/^\/inventario\/movimientos/, ["Inventario", "Kardex por LOC"]],
    [/^\/auditorias/, ["Control", "Conteos físicos"]],
    [/^\/reportes/, ["Analítica", "Reportes WMS"]],
    [/^\/catalogos/, ["Gobierno", "Maestros WMS"]],
  ];
  const match = contexts.find(([pattern]) => pattern.test(path));
  return match?.[1] || ["Don Pepe WMS", "Operación de almacén"];
};

module.exports = async (req, res, next) => {
  res.locals.currentUser = req.session?.user || null;
  res.locals.currentPath = req.path;
  res.locals.homePath = homeByRole(req.session?.user);
  res.locals.can = (permission) => can(req.session.user, permission);
  res.locals.roleDescriptions = roleDescriptions;
  res.locals.storeName = env.storeName;
  res.locals.timeZone = env.timeZone;
  res.locals.flash = req.session?.flash || null;
  const [section, page] = pageContext(req.path);
  res.locals.shellContext = { section, page };
  res.locals.pendingRequestCount = 0;
  res.locals.pendingRequests = [];
  if (req.session) delete req.session.flash;
  res.locals.money = (value) =>
    new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency: "PEN",
    }).format(Number(value || 0));
  res.locals.date = (value, withTime = false) =>
    value
      ? new Intl.DateTimeFormat(
          "es-PE",
          withTime
            ? {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: env.timeZone,
              }
            : { dateStyle: "medium", timeZone: env.timeZone },
        ).format(new Date(value))
      : "";
  res.locals.weekday = (value) =>
    value
      ? new Intl.DateTimeFormat("es-PE", {
          weekday: "short",
          timeZone: env.timeZone,
        }).format(new Date(value))
      : "";
  try {
    if (req.session?.user?.rol === "administrador_wms") {
      const [count, requests] = await Promise.all([
        UserRequest.pendingCount(),
        UserRequest.pendingSummary(4),
      ]);
      res.locals.pendingRequestCount = count;
      res.locals.pendingRequests = requests;
    }
    next();
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") return next();
    next(error);
  }
};
