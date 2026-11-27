const Base = require("./BaseModel");
const { roleDescriptions } = require("../config/permissions");

class User extends Base {
  static findByEmail(correo) {
    return this.one(
      `SELECT u.*,r.nombre rol,r.perfil,r.etiqueta rol_etiqueta,r.activo rol_activo,
      (SELECT JSON_ARRAYAGG(permiso) FROM roles_permisos WHERE rol_id=r.id) permisos
      FROM usuarios u JOIN roles r ON r.id=u.rol_id WHERE u.correo=?`,
      [correo],
    );
  }
  static findSessionIdentity(id) {
    return this.one(
      `SELECT u.id,u.nombre,u.correo,u.correo_recuperacion,u.activo,r.nombre rol,r.perfil,r.etiqueta rol_etiqueta,r.activo rol_activo,
      COALESCE((SELECT JSON_ARRAYAGG(permiso) FROM roles_permisos WHERE rol_id=r.id),JSON_ARRAY()) permisos FROM usuarios u
      JOIN roles r ON r.id=u.rol_id WHERE u.id=?`,
      [id],
    );
  }
  static all() {
    return this.query(
      `SELECT u.id,u.nombre,u.correo,u.correo_recuperacion,u.activo,u.creado_en,u.actualizado_en,r.nombre rol,r.perfil,r.etiqueta rol_etiqueta,r.descripcion rol_descripcion,r.id rol_id
      FROM usuarios u JOIN roles r ON r.id=u.rol_id ORDER BY u.nombre`,
    ).then((users) =>
      users.map((user) => ({
        ...user,
        rol_descripcion: roleDescriptions[user.rol] || user.rol_descripcion,
      })),
    );
  }
  static roles() {
    return this.query(
      `SELECT r.*,(SELECT COUNT(*) FROM roles_permisos WHERE rol_id=r.id) permisos_count
      FROM roles r WHERE r.activo=1 ORDER BY r.sistema DESC,r.id`,
    );
  }
  static publicRoles() {
    return this.query(
      `SELECT id,nombre,descripcion FROM roles
       WHERE perfil IN ('jefe_operaciones','operador_rf') AND activo=1 ORDER BY id`,
    );
  }
  static find(id) {
    return this.one(
      "SELECT id,nombre,correo,correo_recuperacion,rol_id,activo,creado_en,actualizado_en FROM usuarios WHERE id=?",
      [id],
    );
  }
}
module.exports = User;
