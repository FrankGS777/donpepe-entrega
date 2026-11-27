const Wms = require("../models/Wms");
const {
  createWarehouseTask,
  startWarehouseTask,
  completeWarehouseTask,
  cancelWarehouseTask,
  assignWarehouseTask,
} = require("../services/wmsService");

exports.positions = async (req, res) => {
  const selectedLoc = req.query.loc ? await Wms.locationByCode(req.query.loc) : null;
  const zone = selectedLoc?.codigo_zona || String(req.query.zone || "");
  const aisle = selectedLoc?.pasillo || String(req.query.aisle || "");
  const rack = selectedLoc?.estante || String(req.query.rack || "");
  const level = selectedLoc?.nivel || String(req.query.level || "");
  const [positions, occupancy, zones, aisles, racks, levels] = await Promise.all([
    req.query.loc ? Wms.positions(req.query) : Promise.resolve([]),
    Wms.occupancy({ zone, aisle, rack, level }),
    Wms.zones(),
    zone ? Wms.aisles(zone) : Promise.resolve([]),
    Wms.racks(zone, aisle),
    Wms.levels(zone, aisle, rack),
  ]);
  res.render("wms/positions", {
    title: "Zonas, LOC y stock",
    positions,
    occupancy,
    zones,
    aisles,
    racks,
    levels,
    selectedLoc,
    filters: { ...req.query, zone, aisle, rack, level },
  });
};

exports.labels = async (req, res) => {
  res.render("wms/labels", {
    title: "Etiquetas QR",
    data: await Wms.labelData(),
  });
};

exports.tasks = async (req, res) => {
  const [tasks, summary, operators] = await Promise.all([
    Wms.tasks(req.query),
    Wms.summary(),
    Wms.operators(),
  ]);
  res.render("wms/tasks", {
    title: "Tareas WMS",
    tasks,
    summary,
    operators,
    filters: req.query,
  });
};

exports.assignTask = async (req, res) => {
  const operator = await assignWarehouseTask({
    taskId: req.validated.id,
    operatorId: req.validated.operador_id,
    userId: req.session.user.id,
  });
  req.session.flash = {
    type: "success",
    message: `Tarea asignada a ${operator.nombre}; aparecerá en su RF.`,
  };
  res.redirect("/wms/tareas?status=PENDIENTE");
};

exports.newTask = async (req, res) =>
  res.render("wms/task-form", {
    title: "Nueva tarea WMS",
    ...(await Wms.taskOptions()),
    errors: [],
  });

exports.createTask = async (req, res) => {
  try {
    const task = await createWarehouseTask({
      type: req.validated.tipo,
      lotId: req.validated.lote_origen_id,
      destinationId: req.validated.ubicacion_destino_id,
      quantity: req.validated.cantidad,
      priority: req.validated.prioridad,
      observations: req.validated.observaciones,
      reference: req.validated.referencia_operativa,
      operatorId: req.validated.operador_id,
      userId: req.session.user.id,
    });
    req.session.flash = {
      type: "success",
      message: task.assignedTo
        ? `Tarea ${task.code} asignada a ${task.assignedTo.nombre}. Ya está en su RF.`
        : `Tarea ${task.code} creada y lista para asignación.`,
    };
    return res.redirect("/wms/tareas");
  } catch (error) {
    if (!error.status || error.status >= 500) throw error;
    return res.status(error.status).render("wms/task-form", {
      title: "Revisa la tarea WMS",
      ...(await Wms.taskOptions()),
      errors: [{ msg: error.message }],
      form: req.body,
    });
  }
};

exports.startTask = async (req, res) => {
  await startWarehouseTask({
    taskId: req.validated.id,
    userId: req.session.user.id,
  });
  req.session.flash = {
    type: "success",
    message: "Tarea asignada a tu usuario. Confirma físicamente el traslado.",
  };
  res.redirect("/wms/tareas");
};

exports.completeTask = async (req, res) => {
  await completeWarehouseTask({
    taskId: req.validated.id,
    userId: req.session.user.id,
    role: req.session.user.rol,
  });
  req.session.flash = {
    type: "success",
    message:
      "Traslado confirmado; las dos LOC y el kardex fueron actualizados.",
  };
  res.redirect("/wms/tareas");
};

exports.cancelTask = async (req, res) => {
  await cancelWarehouseTask({
    taskId: req.validated.id,
    userId: req.session.user.id,
    role: req.session.user.rol,
  });
  req.session.flash = { type: "success", message: "Tarea WMS cancelada." };
  res.redirect("/wms/tareas");
};
