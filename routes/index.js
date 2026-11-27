const express = require("express");
const asyncHandler = require("../utils/asyncHandler");
const { requireAuth, guestOnly, permit } = require("../middleware/auth");
const auth = require("../controllers/authController");
const passwords = require("../controllers/passwordController");
const validate = require("../middleware/validate");
const dashboard = require("../controllers/dashboardController");
const { homeByRole } = require("../utils/home");
const validators = require("../validators/common");
const account = require("../controllers/accountController");
const { body } = require("express-validator");
const { rateLimit } = require("express-rate-limit");
const recoveryEmailLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `account-${req.session.user.id}`,
  message:
    "Ya solicitaste varios cambios de correo. Espera una hora antes de intentarlo de nuevo.",
});
const router = express.Router();
router.get("/", (req, res) =>
  res.redirect(req.session.user ? homeByRole(req.session.user) : "/login"),
);
router.get("/login", guestOnly, auth.form);
router.post("/login", guestOnly, validators.login, asyncHandler(auth.login));
router.post("/logout", requireAuth, auth.logout);
router.use(require("./accountRequests"));
router.get("/mi-cuenta", requireAuth, asyncHandler(account.form));
router.post(
  "/mi-cuenta",
  requireAuth,
  recoveryEmailLimit,
  body("correo_recuperacion")
    .trim()
    .isEmail()
    .withMessage("Escribe un correo personal válido")
    .isLength({ max: 100 })
    .toLowerCase(),
  body("password_actual")
    .isString()
    .isLength({ min: 1, max: 72 })
    .withMessage("Confirma tu contraseña actual"),
  validate("cuenta/profile", account.context),
  asyncHandler(account.update),
);
router.get(
  "/mi-cuenta/verificar/:token",
  requireAuth,
  validators.activationToken,
  require("../middleware/rejectInvalid"),
  asyncHandler(account.verifyForm),
);
router.post(
  "/mi-cuenta/verificar/:token",
  requireAuth,
  validators.activationToken,
  require("../middleware/rejectInvalid"),
  asyncHandler(account.verify),
);
router.get("/mi-clave", requireAuth, passwords.form);
router.post(
  "/mi-clave",
  requireAuth,
  validators.ownPassword,
  validate("cuenta/password", passwords.validationView),
  asyncHandler(passwords.update),
);
router.get(
  "/dashboard",
  permit("dashboard.admin", "dashboard.warehouse"),
  asyncHandler(dashboard.index),
);
router.use("/productos", require("./products"));
router.use("/usuarios", require("./users"));
router.use("/roles", require("./roles"));
router.use("/catalogos", require("./catalogs"));
router.use("/inventario", require("./inventory"));
router.use("/wms", require("./wms"));
router.use("/rf", require("./rf"));
router.use("/auditorias", require("./audits"));
router.use("/compras", require("./purchases"));
router.use("/reportes", require("./reports"));
module.exports = router;
