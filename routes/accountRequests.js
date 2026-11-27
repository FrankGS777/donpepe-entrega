const router = require("express").Router();
const controller = require("../controllers/userRequestController");
const asyncHandler = require("../utils/asyncHandler");
const validators = require("../validators/common");
const validate = require("../middleware/validate");
const rejectInvalid = require("../middleware/rejectInvalid");
const { guestOnly, permit } = require("../middleware/auth");
const { tokenRequest } = require("../services/userRequestService");

const passwordReload = async (req) => ({
  layout: "layouts/auth",
  request: await tokenRequest(req.params.token),
  token: req.params.token,
});

router.get("/cuenta/recuperar", guestOnly, controller.forgotForm);
router.post(
  "/cuenta/recuperar",
  guestOnly,
  validators.passwordResetRequest,
  validate("auth/forgot-password", () => ({ layout: "layouts/auth" })),
  asyncHandler(controller.submitForgot),
);
router.get(
  "/cuenta/activar/:token",
  guestOnly,
  validators.activationToken,
  rejectInvalid,
  asyncHandler(controller.activationForm),
);
router.post(
  "/cuenta/activar/:token",
  guestOnly,
  validators.newPassword,
  validate("auth/set-password", passwordReload),
  asyncHandler(controller.completeActivation),
);

router.get(
  "/solicitudes",
  permit("requests.manage"),
  asyncHandler(controller.index),
);
router.post(
  "/solicitudes/:id/aprobar",
  permit("requests.manage"),
  validators.requestDecision,
  rejectInvalid,
  asyncHandler(controller.approve),
);
router.post(
  "/solicitudes/:id/rechazar",
  permit("requests.manage"),
  validators.requestDecision,
  rejectInvalid,
  asyncHandler(controller.reject),
);
router.post(
  "/solicitudes/:id/regenerar",
  permit("requests.manage"),
  validators.id(),
  rejectInvalid,
  asyncHandler(controller.regenerate),
);

module.exports = router;
