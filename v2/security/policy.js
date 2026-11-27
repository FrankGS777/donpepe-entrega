"use strict";

// The ceiling is part of the application, not data editable by an administrator.
// Granting a checkbox can restrict a role; it cannot cross separation of duties.
const ROLE_NAMES = Object.freeze({ admin: "Administrador del sistema", operations: "Jefe de operaciones", store: "Gestor de tienda" });
const PERMISSIONS = Object.freeze([
  ["identity.users.read", "Consultar cuentas", "Gobierno"],
  ["identity.users.manage", "Crear, editar, desactivar y eliminar cuentas", "Gobierno"],
  ["identity.roles.read", "Consultar permisos por perfil", "Gobierno"],
  ["identity.roles.manage", "Restringir permisos por perfil", "Gobierno"],
  ["identity.recoveries.review", "Aprobar o rechazar recuperaciones", "Seguridad"],
  ["audit.read", "Consultar auditoría", "Seguridad"],
  ["settings.read", "Consultar configuración técnica", "Configuración"],
  ["config.sku.manage", "Configurar productos", "Configuración"],
  ["config.supplier.manage", "Configurar proveedores", "Configuración"],
  ["config.brand.manage", "Gestionar marcas y proveedores vinculados", "Configuración"],
  ["config.category.manage", "Gestionar categorías y conservación", "Configuración"],
  ["config.asset.manage", "Gestionar registro y ficha técnica de equipos", "Configuración"],
  ["config.autonomy.manage", "Configurar políticas e infraestructura autónoma", "Configuración"],
  ["autonomy.read", "Consultar procesos y evidencias autónomas de mi ámbito", "Consulta"],
  ["autonomy.authorize", "Autorizar procesos autónomos y adoptar expedientes anteriores", "Operación"],
  ["autonomy.exception.resolve", "Resolver excepciones documentadas sin inventar evidencia", "Operación"],
  ["maintenance.read", "Consultar planes e historial de mantenimiento", "Consulta"],
  ["maintenance.manage", "Aprobar, retirar, inspeccionar y cerrar mantenimiento", "Configuración"],
  ["maintenance.request", "Solicitar inspección o mantenimiento", "Operación"],
  ["config.branch.manage", "Configurar sucursales", "Configuración"],
  ["config.settings.manage", "Configurar reglas del escenario", "Configuración"],
  ["profile.manage", "Gestionar mi contraseña y correo de recuperación", "Mi cuenta"],
  ["overview.view", "Consultar resumen de mi ámbito", "Consulta"],
  ["catalog.read", "Consultar catálogo de mi ámbito", "Consulta"],
  ["inventory.summary.read", "Consultar balance y alertas del inventario sin acciones operativas", "Consulta"],
  ["map.view", "Interactuar con mapa operativo", "Operación"],
  ["inventory.read", "Consultar existencias de mi ámbito", "Consulta"],
  ["analytics.read", "Consultar indicadores logísticos", "Consulta"],
  ["supplierClaim.read", "Consultar reclamaciones y evidencia de proveedor", "Consulta"],
  ["supplierClaim.manage", "Reportar, notificar y resolver cajas observadas", "Entrada"],
  ["supplierClaim.settle", "Conciliar notas de crédito y pérdidas de proveedor", "Configuración"],
  ["purchase.create", "Emitir compra a proveedor", "Entrada"],
  ["purchase.arrive", "Registrar llegada de proveedor", "Entrada"],
  ["purchase.receive", "Aceptar recepción y retener diferencias", "Entrada"],
  ["purchase.inspect", "Documentar verificaciones de entrada antes de recibir", "Entrada"],
  ["purchase.cancel", "Cancelar compra sin ingreso de mercancía", "Entrada"],
  ["inventory.releaseQuarantine", "Liberar retención compatible", "Entrada"],
  ["order.create", "Crear pedido de sucursal", "Salida"],
  ["order.edit", "Editar mi solicitud antes de su preparación", "Tienda"],
  ["order.release", "Liberar pedido y planificar equipos", "Salida"],
  ["order.dispatch", "Autorizar expedición", "Salida"],
  ["order.cancel", "Cancelar pedido antes de recogida", "Salida"],
  ["order.priority", "Priorizar pedido pendiente", "Salida"],
  ["order.rejectPrepared", "Retener una carga preparada con incidencia", "Salida"],
  ["incident.resolve", "Resolver incidencia documentada", "Operación"],
  ["order.receive", "Confirmar recepción de mi sucursal", "Tienda"],
  ["return.create", "Solicitar devolución de mi sucursal", "Tienda"],
  ["store.consume", "Registrar salida de inventario en mi tienda", "Tienda"],
  ["equipment.fault", "Retirar equipo por incidencia", "Operación"],
  ["equipment.recover", "Recuperar equipo inspeccionado", "Operación"],
  ["location.block", "Bloquear o habilitar ubicación", "Operación"],
  ["simulation.pause", "Pausar o continuar escenario", "Simulación"],
  ["simulation.speed", "Cambiar velocidad del escenario", "Simulación"],
].map(([id, label, group]) => Object.freeze({ id, label, group })));
const GOVERNANCE = PERMISSIONS.filter(p => ["Gobierno", "Seguridad", "Configuración"].includes(p.group)).map(p => p.id);
const SHARED = ["profile.manage", "overview.view", "catalog.read", "autonomy.read"];
const ROLE_CEILINGS = Object.freeze({
  admin: Object.freeze([...GOVERNANCE, ...SHARED, "inventory.summary.read", "supplierClaim.read", "maintenance.read", "maintenance.request"]),
  operations: Object.freeze([...SHARED, "supplierClaim.read", "supplierClaim.manage", "autonomy.authorize", "autonomy.exception.resolve", "map.view", "inventory.read", "analytics.read", "purchase.create", "purchase.arrive", "purchase.receive", "purchase.inspect", "purchase.cancel", "inventory.releaseQuarantine", "order.release", "order.dispatch", "order.cancel", "order.priority", "order.rejectPrepared", "incident.resolve", "equipment.fault", "equipment.recover", "maintenance.read", "maintenance.request", "location.block", "simulation.pause", "simulation.speed"]),
  store: Object.freeze([...SHARED, "inventory.read", "order.create", "order.edit", "order.cancel", "order.receive", "return.create", "store.consume"]),
});
const DEFAULT_GRANTS = ROLE_CEILINGS;
const COMMAND_PERMISSIONS = Object.freeze({
  ...Object.fromEntries(["report","retry","respond","prepareReturn","handover","dispose"].map(action=>[`supplierClaim.${action}`,"supplierClaim.manage"])),
  "supplierClaim.settle":"supplierClaim.settle",
  "config.company.update": "config.settings.manage",
  "finance.bill.create": "config.settings.manage",
  "finance.payment.create": "config.settings.manage",
  ...Object.fromEntries(PERMISSIONS.filter(p => /^(purchase\.|order\.|return\.|store\.|inventory\.release|equipment\.|incident\.|location\.|simulation\.)/.test(p.id)).map(p => [p.id, p.id])),
  ...Object.fromEntries(["sku", "supplier", "branch", "brand", "category", "asset"].flatMap(entity => ["create", "update", "deactivate", "activate", "delete"].map(action => [`config.${entity}.${action}`, `config.${entity}.manage`]))),
  "maintenance.request": "maintenance.request",
  ...Object.fromEntries(["approve", "start", "complete", "reject", "cancel"].map(action => [`maintenance.${action}`, "maintenance.manage"])),
  "config.settings.update": "config.settings.manage",
  "config.asset.configure": "config.asset.manage",
  "config.autonomy.update": "config.autonomy.manage",
  "autonomy.authorize": "autonomy.authorize",
  "autonomy.adopt": "autonomy.authorize",
  "autonomy.exception.resolve": "autonomy.exception.resolve",
  "autonomy.retry": "autonomy.exception.resolve",
});
function effectivePermissions(role, granted) {
  const ceiling = Object.hasOwn(ROLE_CEILINGS, role) ? ROLE_CEILINGS[role] : [];
  const source = Array.isArray(granted) ? granted : Object.hasOwn(DEFAULT_GRANTS, role) ? DEFAULT_GRANTS[role] : [];
  return [...new Set(source)].filter(p => ceiling.includes(p));
}
function can(actor, permission) {
  return !!actor && typeof actor.id === "string" && effectivePermissions(actor.role, actor.permissions).includes(permission);
}
function denied(message = "Tu perfil no tiene permiso para esta acción.") { const e = new Error(message); e.status = 403; throw e; }
function assertCommandAllowed(actor, type) {
  const permission = COMMAND_PERMISSIONS[type];
  if (!permission || !can(actor, permission)) denied(type === "simulation.reset" ? "El reinicio destructivo no está disponible. La configuración no modifica movimientos ya registrados." : undefined);
}
module.exports = { ROLE_NAMES, PERMISSIONS, ROLE_CEILINGS, DEFAULT_GRANTS, COMMAND_PERMISSIONS, effectivePermissions, can, denied, assertCommandAllowed };
