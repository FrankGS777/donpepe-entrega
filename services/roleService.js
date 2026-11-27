const { transaction } = require("../config/db");
const { catalog } = require("../config/permissionCatalog");
const { requireActorPermission } = require("./accessPolicy");
const AppError = require("../utils/AppError");

function validateRole(data) {
  const etiqueta = String(data.etiqueta || "").trim();
  const descripcion = String(data.descripcion || "").trim();
  const perfil = data.perfil;
  if (etiqueta.length < 3 || etiqueta.length > 70)
    throw new AppError("El nombre debe tener entre 3 y 70 caracteres", 422);
  if (descripcion.length < 12 || descripcion.length > 255)
    throw new AppError(
      "Explica la responsabilidad del rol en 12 a 255 caracteres",
      422,
    );
  if (!["jefe_operaciones", "operador_rf"].includes(perfil))
    throw new AppError(
      "Elige escritorio operativo o terminal RF; no se puede crear otro administrador",
      422,
    );
  const permisos = [
    ...new Set(
      Array.isArray(data.permisos)
        ? data.permisos
        : data.permisos
          ? [data.permisos]
          : [],
    ),
  ];
  if (!permisos.length)
    throw new AppError("Selecciona al menos un permiso", 422);
  for (const key of permisos) {
    const item = catalog.find((p) => p.key === key);
    if (!item?.profiles.includes(perfil))
      throw new AppError(
        `El permiso ${key} no pertenece a este perfil. Gobierno y ejecución física están separados.`,
        422,
      );
    for (const dependency of item.dependencies)
      if (!permisos.includes(dependency))
        throw new AppError(
          `${item.label} requiere: ${catalog.find((p) => p.key === dependency).label}`,
          422,
        );
  }
  if (perfil === "operador_rf" && !permisos.includes("rf.access"))
    throw new AppError("La terminal requiere Acceder a terminal RF", 422);
  if (
    permisos.includes("wms.tasks.execute") &&
    !["rf.checkin", "rf.pick", "rf.transfer", "rf.returns"].some((p) =>
      permisos.includes(p),
    )
  )
    throw new AppError(
      "Para ejecutar tareas, habilita al menos put-away, picking, transferencias o retornos",
      422,
    );
  return {
    etiqueta,
    descripcion,
    perfil,
    permisos,
    activo: Boolean(data.activo),
  };
}
async function saveRole({ actorId, roleId, data }) {
  const clean = validateRole(data);
  try {
    return await transaction(async (conn) => {
      await requireActorPermission(conn, actorId, "roles.manage");
      const [[duplicate]] = await conn.execute(
        "SELECT id FROM roles WHERE LOWER(etiqueta)=LOWER(?) AND id<>?",
        [clean.etiqueta, roleId || 0],
      );
      if (duplicate) throw new AppError("Ya existe un rol con ese nombre", 409);
      let before = null;
      if (roleId) {
        const [[role]] = await conn.execute(
          "SELECT * FROM roles WHERE id=? FOR UPDATE",
          [roleId],
        );
        if (!role) throw new AppError("Rol no encontrado", 404);
        if (role.sistema)
          throw new AppError(
            "Los roles de sistema están protegidos. Crea un rol personalizado sin modificar sus límites.",
            409,
          );
        const [assigned] = await conn.execute(
          "SELECT id FROM usuarios WHERE rol_id=? FOR UPDATE",
          [roleId],
        );
        if (assigned.length && (role.perfil !== clean.perfil || !clean.activo))
          throw new AppError(
            "Reasigna primero los usuarios del rol para cambiar su interfaz o desactivarlo",
            409,
          );
        const [grants] = await conn.execute(
          "SELECT permiso FROM roles_permisos WHERE rol_id=?",
          [roleId],
        );
        before = { ...role, permisos: grants.map((p) => p.permiso) };
        await conn.execute(
          "UPDATE roles SET etiqueta=?,descripcion=?,perfil=?,activo=? WHERE id=?",
          [
            clean.etiqueta,
            clean.descripcion,
            clean.perfil,
            clean.activo,
            roleId,
          ],
        );
        await conn.execute("DELETE FROM roles_permisos WHERE rol_id=?", [
          roleId,
        ]);
      } else {
        const code = `rol_${require("crypto").randomBytes(12).toString("hex")}`;
        const [result] = await conn.execute(
          "INSERT INTO roles (nombre,etiqueta,descripcion,perfil,activo,sistema) VALUES (?,?,?,?,?,0)",
          [code, clean.etiqueta, clean.descripcion, clean.perfil, clean.activo],
        );
        roleId = result.insertId;
      }
      for (const grant of clean.permisos)
        await conn.execute(
          "INSERT INTO roles_permisos (rol_id,permiso) VALUES (?,?)",
          [roleId, grant],
        );
      await conn.execute(
        "INSERT INTO seguridad_eventos (actor_id,accion,entidad_id,antes,despues) VALUES (?,?,?,?,?)",
        [
          actorId,
          before ? "ROL_EDITADO" : "ROL_CREADO",
          roleId,
          before ? JSON.stringify(before) : null,
          JSON.stringify(clean),
        ],
      );
      return roleId;
    });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY")
      throw new AppError("Ya existe un rol con ese nombre", 409);
    throw error;
  }
}
module.exports = { validateRole, saveRole };
