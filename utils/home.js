const { can, profileOf } = require("../config/permissions");
const homeByRole = (identity) => {
  if (profileOf(identity) === "operador_rf") return "/rf";
  if (
    typeof identity !== "object" ||
    can(identity, "dashboard.admin") ||
    can(identity, "dashboard.warehouse")
  )
    return "/dashboard";
  const pages = [
    ["wms.tasks", "/wms/tareas"],
    ["wms.positions", "/wms/posiciones"],
    ["products.view", "/productos"],
    ["inventory.lots", "/inventario/lotes"],
    ["distribution.view", "/wms/sucursales"],
    ["audits.view", "/auditorias"],
  ];
  return (
    pages.find(([permission]) => can(identity, permission))?.[1] || "/mi-cuenta"
  );
};
module.exports = { homeByRole };
