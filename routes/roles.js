const router = require("express").Router();
const { permit } = require("../middleware/auth");
const asyncHandler = require("../utils/asyncHandler");
const controller = require("../controllers/roleController");
const { id } = require("../validators/common");
router.use(permit("roles.manage"));
router.get("/", asyncHandler(controller.index));
router.get("/nuevo", asyncHandler(controller.form));
router.post("/", asyncHandler(controller.save));
router.get(
  "/:id/editar",
  id(),
  require("../middleware/rejectInvalid"),
  asyncHandler(controller.form),
);
router.put(
  "/:id",
  id(),
  require("../middleware/rejectInvalid"),
  asyncHandler(controller.save),
);
module.exports = router;
