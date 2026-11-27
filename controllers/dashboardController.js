const Dashboard = require("../models/Dashboard");
const Wms = require("../models/Wms");
const LogisticsNetwork = require("../models/LogisticsNetwork");
exports.index = async (req, res) => {
  res.locals.shellContext = {
    section: "Inicio",
    page:
      req.session.user.perfil === "jefe_operaciones"
        ? "Centro de operaciones"
        : "Gobierno y aprobaciones",
  };
  if (req.session.user.perfil === "operador_rf") return res.redirect("/rf");
  if (req.session.user.perfil === "jefe_operaciones") {
    const [data, wms, network] = await Promise.all([
      Dashboard.warehouseSummary(), Wms.summary(), LogisticsNetwork.snapshot(),
    ]);
    return res.render("dashboard/warehouse", {
      title: "Torre de control WMS",
      data,
      wms,
      network,
    });
  }
  return res.render("dashboard/index", {
    title: "Gobierno general WMS",
    data: await Dashboard.summary(),
  });
};
