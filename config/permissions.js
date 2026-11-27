const permissions = Object.freeze({
  administrador_wms: [
    "dashboard.admin",
    "users.view",
    "users.create",
    "users.update",
    "roles.manage",
    "requests.manage",
    "catalogs.view",
    "catalogs.create",
    "catalogs.update",
    "catalogs.delete",
    "products.view",
    "products.create",
    "products.update",
    "products.deactivate",
    "inventory.lots",
    "inventory.movements",
    "inventory.health",
    "wms.positions",
    "wms.tasks",
    "wms.labels",
    "distribution.view",
    "distribution.branches.manage",
    "purchases.view",
    "purchases.create",
    "purchases.cancel",
    "audits.view",
    "audits.approve",
    "audits.reject",
    "reports.business",
    "reports.export",
  ],
  jefe_operaciones: [
    "dashboard.warehouse",
    "products.view",
    "products.update_logistics",
    "inventory.lots",
    "inventory.movements",
    "inventory.health",
    "wms.positions",
    "wms.tasks",
    "wms.tasks.create",
    "wms.tasks.assign",
    "wms.tasks.manage",
    "wms.labels",
    "distribution.view",
    "distribution.create",
    "distribution.plan",
    "distribution.dispatch",
    "distribution.return",
    "audits.view",
    "audits.create",
  ],
  operador_rf: [
    "rf.access",
    "rf.receive",
    "rf.checkin",
    "rf.pick",
    "rf.transfer",
    "rf.count",
    "rf.returns",
    "wms.tasks.execute",
  ],
});

// Inmutable también en profundidad: ninguna petición puede ampliar un rol.
Object.values(permissions).forEach(Object.freeze);

// En ejecución se usa la identidad persistida con permisos efectivos; el nombre
// por sí solo sólo sirve para las plantillas inmutables de los roles de sistema.
const can = (identity, permission) => {
  if (identity && typeof identity === "object") {
    if (identity.rol_activo === 0) return false;
    if (Array.isArray(identity.permisos))
      return identity.permisos.includes(permission);
    return can(identity.rol, permission);
  }
  return Boolean(
    Object.hasOwn(permissions, identity) &&
      permissions[identity].includes(permission),
  );
};
const profileOf = (identity) =>
  typeof identity === "object" ? identity?.perfil || identity?.rol : identity;
const roleDescriptions = Object.freeze({
  administrador_wms:
    "Gobierno, seguridad, maestros, compras y aprobación de ajustes; consulta de la operación sin ejecución física.",
  jefe_operaciones:
    "Planificación, delegación RF, pedidos, despachos y estrategia logística; registra diferencias sin aprobar ajustes.",
  operador_rf:
    "Recepción y conteo móvil; ejecución de tareas asignadas con validación de origen, producto y destino.",
});
module.exports = { permissions, can, roleDescriptions, profileOf };
