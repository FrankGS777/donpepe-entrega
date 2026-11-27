const WarehouseMap = require("../models/WarehouseMap");
const LogisticsNetwork = require("../models/LogisticsNetwork");
const { can } = require("../config/permissions");

exports.index = async (req, res) => {
  const data = await WarehouseMap.data();
  res.render("wms/map", {
    title: "Mapa interactivo de almacén",
    zones: data.layout.zones,
    locations: data.layout.locations.filter((loc) => loc.occupied > 0).slice(0, 60),
    activeTaskCount: data.tasks.length,
  });
};

exports.data = async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await WarehouseMap.data());
};

exports.network = async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    ...(await LogisticsNetwork.snapshot()),
    capabilities: {
      plan: can(req.session.user, "distribution.plan"),
      dispatch: can(req.session.user, "distribution.dispatch"),
      purchasesView: can(req.session.user, "purchases.view"),
      purchasesReceive: can(req.session.user, "rf.receive"),
    },
  });
};
