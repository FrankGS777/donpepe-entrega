const bcrypt = require("bcryptjs");
const { transaction } = require("../config/db");
const AppError = require("../utils/AppError");
const { setNewPassword, validatePasswordPolicy } = require("./passwordService");
const { requireActorPermission } = require("./accessPolicy");
const { invalidateRecoveryLinks } = require("./recoveryEmailService");

async function createUser(data, actorId) {
  if (!data.password) throw new AppError("La contraseña es obligatoria");
  validatePasswordPolicy(data.password);
  return transaction(async (conn) => {
    await requireActorPermission(conn, actorId, "users.create");
    const [[role]] = await conn.execute(
      "SELECT id,nombre,activo FROM roles WHERE id=? FOR UPDATE",
      [data.rol_id],
    );
    if (!role?.activo) throw new AppError("Selecciona un rol activo");
    if (role.nombre === "administrador_wms")
      throw new AppError(
        "El administrador es único. No se puede crear otra cuenta administradora",
        409,
      );
    const hash = await bcrypt.hash(data.password, 12);
    const [result] = await conn.execute(
      "INSERT INTO usuarios (nombre,correo,correo_recuperacion,password,rol_id,activo) VALUES (?,?,?,?,?,?)",
      [
        data.nombre,
        data.correo,
        data.correo_recuperacion,
        hash,
        data.rol_id,
        data.activo,
      ],
    );
    await conn.execute(
      "INSERT INTO seguridad_eventos (actor_id,accion,entidad_id,despues) VALUES (?,'USUARIO_CREADO',?,?)",
      [
        actorId,
        result.insertId,
        JSON.stringify({ rol_id: Number(data.rol_id), activo: data.activo }),
      ],
    );
    return result.insertId;
  });
}

async function updateUser({ targetId, actorId, data }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, actorId, "users.update");
    const [[target]] = await conn.execute(
      `SELECT u.id,u.nombre,u.correo,u.correo_recuperacion,u.rol_id,u.activo,r.nombre rol
      FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.id=? FOR UPDATE`,
      [targetId],
    );
    if (!target) throw new AppError("Usuario no encontrado", 404);
    const [[nextRole]] = await conn.execute(
      "SELECT id,nombre,activo FROM roles WHERE id=? FOR UPDATE",
      [data.rol_id],
    );
    if (!nextRole?.activo) throw new AppError("Selecciona un rol activo");
    if (
      nextRole.nombre === "administrador_wms" &&
      target.rol !== "administrador_wms"
    )
      throw new AppError(
        "Ya existe el administrador único; no puedes asignar ese rol a otra cuenta",
        409,
      );
    if (
      target.rol === "administrador_wms" &&
      (!data.activo || nextRole.nombre !== target.rol)
    )
      throw new AppError(
        "El administrador único debe permanecer activo y conservar su rol",
        409,
      );
    const self = Number(targetId) === Number(actorId);
    if (self && (!data.activo || nextRole.nombre !== target.rol))
      throw new AppError(
        "No puedes desactivar tu propia cuenta ni cambiar tu propio rol",
        409,
      );
    if (self && data.password)
      throw new AppError(
        "Para cambiar tu propia contraseña usa Mi clave y confirma la actual",
        422,
      );
    if (self && target.correo_recuperacion !== data.correo_recuperacion)
      throw new AppError(
        "Para vincular tu correo personal usa Mi cuenta y confirma el enlace de verificación",
        422,
      );
    if (target.correo_recuperacion !== data.correo_recuperacion)
      await invalidateRecoveryLinks(conn, targetId);
    await conn.execute(
      "UPDATE usuarios SET nombre=?,correo=?,correo_recuperacion=?,rol_id=?,activo=? WHERE id=?",
      [
        data.nombre,
        data.correo,
        data.correo_recuperacion,
        data.rol_id,
        data.activo,
        targetId,
      ],
    );
    if (data.password) await setNewPassword(conn, targetId, data.password);
    await conn.execute(
      "INSERT INTO seguridad_eventos (actor_id,accion,entidad_id,antes,despues) VALUES (?,'USUARIO_EDITADO',?,?,?)",
      [
        actorId,
        targetId,
        JSON.stringify({ rol_id: target.rol_id, activo: target.activo }),
        JSON.stringify({ rol_id: nextRole.id, activo: data.activo }),
      ],
    );
    return {
      id: Number(targetId),
      nombre: data.nombre,
      correo: data.correo,
      correo_recuperacion: data.correo_recuperacion,
      rol: nextRole.nombre,
      activo: data.activo,
    };
  });
}
module.exports = { createUser, updateUser };
