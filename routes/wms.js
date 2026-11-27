const r = require("express").Router();
const c = require("../controllers/wmsController");
const map = require("../controllers/warehouseMapController");
const a = require("../utils/asyncHandler");
const { permit } = require("../middleware/auth");
const v = require("../validators/common");
const reject = require("../middleware/rejectInvalid");
const validate = require("../middleware/validate");
const Wms = require("../models/Wms");

r.get(
  "/api/scan",
  permit("wms.positions", "inventory.lots", "products.view"),
  a(require("../controllers/rfController").scan),
);

r.get("/posiciones", permit("wms.positions"), a(c.positions));
r.use("/sucursales", require("./distribution"));
r.get("/mapa", permit("wms.positions"), a(map.index));
r.get("/mapa/datos", permit("wms.positions"), a(map.data));
r.get("/red/datos", permit("wms.positions"), a(map.network));
r.get("/etiquetas", permit("wms.labels"), a(c.labels));
r.get("/tareas", permit("wms.tasks"), a(c.tasks));
r.get("/tareas/nueva", permit("wms.tasks.create"), a(c.newTask));
r.post(
  "/tareas/:id/asignar",
  permit("wms.tasks.assign"),
  v.assignWmsTask,
  reject,
  a(c.assignTask),
);
r.post(
  "/tareas",
  permit("wms.tasks.create"),
  v.wmsTask,
  validate("wms/task-form", () => Wms.taskOptions()),
  a(c.createTask),
);
// La ejecución física existe únicamente en /rf y exige los tres escaneos.
r.post(
  "/tareas/:id/cancelar",
  permit("wms.tasks.manage"),
  v.id(),
  reject,
  a(c.cancelTask),
);

module.exports = r;
