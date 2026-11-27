const path = require("path");
const express = require("express");
const layouts = require("express-ejs-layouts");
const session = require("express-session");
const MySQLSessionStore = require("./config/MySQLSessionStore");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const methodOverride = require("method-override");
const env = require("./config/env");
const locals = require("./middleware/locals");
const csrf = require("./middleware/csrf");
const { publicDatabaseMessage } = require("./utils/databaseError");
const app = express();
if (env.nodeEnv === "production") app.set("trust proxy", 1);
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.set("layout", "layouts/main");
app.locals.storeName = env.storeName;
app.locals.homePath = "/login";
app.use(layouts);
app.use(
  helmet({
    strictTransportSecurity: env.nodeEnv === "production" ? undefined : false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", "data:"],
        imgSrc: [
          "'self'",
          "data:",
          "https://vegaperu.vteximg.com.br",
          "https://plazavea.vteximg.com.br",
          "https://www.arcacontinentallindley.pe",
          "https://cdn.upc.edu.pe",
          "https://www.alicorp.com.pe",
          "https://www.backus.pe",
          "https://www.molitalia.com.pe",
          "https://www.nestle.com.pe",
        ],
        upgradeInsecureRequests: env.nodeEnv === "production" ? [] : null,
      },
    },
  }),
);
app.use(compression());
app.use((req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(self)");
  next();
});
app.use(express.static(path.join(__dirname, "public")));
app.use(
  "/vendor/zxing",
  express.static(
    path.join(__dirname, "node_modules", "@zxing", "browser", "umd"),
    {
      immutable: env.nodeEnv === "production",
      maxAge: env.nodeEnv === "production" ? "30d" : 0,
    },
  ),
);
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(express.json({ limit: "1mb" }));
app.use(methodOverride("_method"));
if (env.nodeEnv !== "test")
  app.use(morgan(env.nodeEnv === "production" ? "combined" : "dev"));
const sessionStore = new MySQLSessionStore({
  expiration: 8 * 60 * 60 * 1000,
  checkExpirationInterval: 15 * 60 * 1000,
});
app.use(
  session({
    name: "minimarket.sid",
    secret: env.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.nodeEnv === "production",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);
app.post(
  "/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  }),
);
app.post(
  "/cuenta/recuperar",
  rateLimit({
    windowMs: 30 * 60 * 1000,
    limit: 8,
    standardHeaders: true,
    legacyHeaders: false,
    message: "Demasiadas solicitudes. Intenta nuevamente más tarde.",
  }),
);
app.use(locals);
app.use(csrf);
app.use(require("./routes"));
const errorLayout = (req) =>
  !req.session?.user
    ? "layouts/auth"
    : (req.session.user.perfil || req.session.user.rol) === "operador_rf"
      ? "layouts/rf"
      : "layouts/main";
app.use((req, res) =>
  res.status(404).render("errors/404", {
    layout: errorLayout(req),
    title: "Página no encontrada",
  }),
);
app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  const databaseError = (error.code || "").startsWith("ER_");
  const status = error.status || (databaseError ? 409 : 500);
  const message = databaseError
    ? publicDatabaseMessage(error)
    : error.expose || status < 500
      ? error.message
      : "Ocurrió un error inesperado.";
  res.status(status).render("errors/500", {
    layout: errorLayout(req),
    title: status === 500 ? "Error interno" : "No se pudo completar",
    status,
    message,
  });
});
module.exports = app;
