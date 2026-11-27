const r = require("express").Router();
const c = require("../controllers/rfController");
const a = require("../utils/asyncHandler");
const { permit } = require("../middleware/auth");
const v = require("../validators/common");
const reject = require("../middleware/rejectInvalid");

r.get("/", permit("rf.access"), a(c.home));
r.get("/scanner", permit("rf.access"), a(c.scanner));
r.get("/api/scan", permit("rf.access"), a(c.scan));
r.get("/recepcion", permit("rf.receive"), a(c.receiving));
r.get(
  "/recepcion/:id",
  permit("rf.receive"),
  v.id(),
  reject,
  a(c.receivingForm),
);
r.post("/recepcion/:id", permit("rf.receive"), v.receive, reject, a(c.receive));
r.get("/check-in", permit("rf.checkin"), a(c.checkIn));
r.get("/picking", permit("rf.pick"), a(c.picking));
r.get("/transfer", permit("rf.transfer"), a(c.transfer));
r.get("/count", permit("rf.count"), a(c.count));
r.get("/count/:id", permit("rf.count"), v.id(), reject, a(c.countForm));
r.post("/count/:id", permit("rf.count"), v.id(), reject, a(c.submitCount));
r.get("/returns", permit("rf.returns"), a(c.returns));
r.get(
  "/tareas/:id/ejecutar",
  permit("wms.tasks.execute"),
  v.id(),
  reject,
  a(c.executeTask),
);
r.post(
  "/tareas/:id/iniciar",
  permit("wms.tasks.execute"),
  v.id(),
  reject,
  a(c.startTask),
);
r.post(
  "/tareas/:id/completar",
  permit("wms.tasks.execute"),
  v.rfTaskConfirmation,
  reject,
  a(c.completeTask),
);

module.exports = r;
