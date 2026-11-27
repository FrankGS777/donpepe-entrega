const { can } = require("../config/permissions");
const AppError = require("../utils/AppError");

// Nunca confiar en un rol enviado por el cliente: consultar la identidad persistida.
async function requireActorPermission(conn, userId, ...permissions) {
  const [[actor]] = await conn.execute(
    `SELECT u.id,u.activo,r.nombre rol,r.perfil,r.activo rol_activo,
     COALESCE((SELECT JSON_ARRAYAGG(permiso) FROM roles_permisos WHERE rol_id=r.id),JSON_ARRAY()) permisos FROM usuarios u
     JOIN roles r ON r.id=u.rol_id WHERE u.id=? FOR UPDATE`,
    [userId],
  );
  if (
    !actor?.activo ||
    !permissions.some((permission) => can(actor, permission))
  )
    throw new AppError("Tu cuenta no está autorizada para esta operación", 403);
  return actor;
}
function requireAssignedOperator(task, userId) {
  if (!task.asignado_a || Number(task.asignado_a) !== Number(userId))
    throw new AppError(
      "El jefe debe asignarte esta tarea antes de ejecutarla",
      403,
    );
}
const taskPermission = (type) =>
  ({
    PUTAWAY: "rf.checkin",
    PICKING: "rf.pick",
    REUBICACION: "rf.transfer",
    REABASTECIMIENTO: "rf.transfer",
    DEVOLUCION_RUTA: "rf.returns",
  })[type];
function requireTaskCapability(actor, task) {
  const permission = taskPermission(task.tipo);
  if (!permission || !can(actor, permission))
    throw new AppError(
      "El rol no tiene permiso para este tipo de tarea RF",
      403,
    );
}
module.exports = {
  requireActorPermission,
  requireAssignedOperator,
  requireTaskCapability,
  taskPermission,
};
