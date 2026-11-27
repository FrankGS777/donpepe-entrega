const Base = require("./BaseModel");

class UserRequest extends Base {
  static expireOld() {
    return this.query(`UPDATE solicitudes_usuario
      SET estado='EXPIRADA',token_hash=NULL
      WHERE estado='APROBADA' AND token_expira_en<=NOW()`);
  }

  static pendingSummary(limit = 5) {
    return this.query(
      `SELECT s.id,s.codigo,s.tipo,s.nombre,s.correo,s.creado_en,
       r.nombre rol_solicitado
       FROM solicitudes_usuario s
       LEFT JOIN roles r ON r.id=s.rol_solicitado_id
       WHERE s.estado='PENDIENTE' AND s.tipo='RESET_PASSWORD'
       ORDER BY s.creado_en DESC LIMIT ?`,
      [Number(limit)],
    );
  }

  static async pendingCount() {
    const row = await this.one(
      "SELECT COUNT(*) total FROM solicitudes_usuario WHERE estado='PENDIENTE' AND tipo='RESET_PASSWORD'",
    );
    return Number(row?.total || 0);
  }

  static all({ status = "", type = "" } = {}) {
    const clauses = [],
      params = [];
    if (
      ["PENDIENTE", "APROBADA", "RECHAZADA", "COMPLETADA", "EXPIRADA"].includes(
        status,
      )
    ) {
      clauses.push("s.estado=?");
      params.push(status);
    }
    clauses.push("s.tipo='RESET_PASSWORD'");
    return this.query(
      `SELECT s.*,r.nombre rol_solicitado,u.nombre usuario_nombre,u.correo_recuperacion,
       rv.nombre revisor_nombre
       FROM solicitudes_usuario s
       LEFT JOIN roles r ON r.id=s.rol_solicitado_id
       LEFT JOIN usuarios u ON u.id=s.usuario_id
       LEFT JOIN usuarios rv ON rv.id=s.revisado_por
       ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
       ORDER BY FIELD(s.estado,'PENDIENTE','APROBADA','RECHAZADA','EXPIRADA','COMPLETADA'),
       s.creado_en DESC`,
      params,
    );
  }

  static find(id) {
    return this.one(
      `SELECT s.*,r.nombre rol_solicitado,u.nombre usuario_nombre,u.correo_recuperacion,
       rv.nombre revisor_nombre
       FROM solicitudes_usuario s
       LEFT JOIN roles r ON r.id=s.rol_solicitado_id
       LEFT JOIN usuarios u ON u.id=s.usuario_id
       LEFT JOIN usuarios rv ON rv.id=s.revisado_por
       WHERE s.id=?`,
      [id],
    );
  }
}

module.exports = UserRequest;
