const Base = require("./BaseModel");
class Role extends Base {
  static all() {
    return this
      .query(`SELECT r.*,(SELECT COUNT(*) FROM usuarios WHERE rol_id=r.id) usuarios_count,
      (SELECT COUNT(*) FROM roles_permisos WHERE rol_id=r.id) permisos_count FROM roles r ORDER BY sistema DESC,id`);
  }
  static async find(id) {
    const role = await this.one("SELECT * FROM roles WHERE id=?", [id]);
    if (role)
      role.permisos = (
        await this.query("SELECT permiso FROM roles_permisos WHERE rol_id=?", [
          id,
        ])
      ).map((p) => p.permiso);
    return role;
  }
  static history(id) {
    return this.query(
      `SELECT e.accion,e.creado_en,u.nombre actor FROM seguridad_eventos e
      LEFT JOIN usuarios u ON u.id=e.actor_id WHERE e.entidad_id=? AND e.accion IN ('ROL_CREADO','ROL_EDITADO') ORDER BY e.id DESC LIMIT 10`,
      [id],
    );
  }
}
module.exports = Role;
