const { pool, transaction } = require("../config/db");
const { permissions, roleDescriptions } = require("../config/permissions");
const { catalog } = require("../config/permissionCatalog");

async function migrateSecurity() {
  const [columns] = await pool.query("SHOW COLUMNS FROM roles");
  const names = new Set(columns.map((c) => c.Field));
  for (const [name, definition] of Object.entries({
    etiqueta: "VARCHAR(70) NULL",
    perfil: "VARCHAR(50) NOT NULL DEFAULT 'jefe_operaciones'",
    activo: "BOOLEAN NOT NULL DEFAULT TRUE",
    sistema: "BOOLEAN NOT NULL DEFAULT FALSE",
    creado_en: "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP",
    actualizado_en:
      "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
  }))
    if (!names.has(name))
      await pool.query(`ALTER TABLE roles ADD COLUMN ${name} ${definition}`);
  const [roleIndexes] = await pool.query("SHOW INDEX FROM roles");
  if (!roleIndexes.some((index) => index.Key_name === "uq_roles_etiqueta")) {
    await pool.query(
      "ALTER TABLE roles ADD UNIQUE KEY uq_roles_etiqueta (etiqueta)",
    );
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS permisos (
    codigo VARCHAR(80) PRIMARY KEY, etiqueta VARCHAR(100) NOT NULL, grupo VARCHAR(60) NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS roles_permisos (
    rol_id INT NOT NULL, permiso VARCHAR(80) NOT NULL, PRIMARY KEY (rol_id,permiso),
    CONSTRAINT fk_rp_rol FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_rp_permiso FOREIGN KEY (permiso) REFERENCES permisos(codigo) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS seguridad_eventos (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NULL, accion VARCHAR(60) NOT NULL,
    entidad_id INT NULL, antes JSON NULL, despues JSON NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_evento_actor FOREIGN KEY (actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cambios_correo_recuperacion (
    id BIGINT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, correo VARCHAR(100) NOT NULL,
    token_hash CHAR(64) UNIQUE NOT NULL, expira_en DATETIME NOT NULL, usado_en DATETIME NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cambio_correo_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
    INDEX idx_cambio_correo_usuario (usuario_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const labels = ["Administrador WMS", "Jefe de operaciones", "Operador RF"];
  let i = 0;
  for (const [key, grants] of Object.entries(permissions)) {
    await pool.execute(
      `INSERT INTO roles (nombre,descripcion,etiqueta,perfil,sistema)
      VALUES (?,?,?,?,1) ON DUPLICATE KEY UPDATE sistema=1,perfil=VALUES(perfil),etiqueta=COALESCE(etiqueta,VALUES(etiqueta))`,
      [key, roleDescriptions[key], labels[i++], key],
    );
    const [[role]] = await pool.execute("SELECT id FROM roles WHERE nombre=?", [
      key,
    ]);
    for (const grant of grants) {
      const item = catalog.find((p) => p.key === grant);
      await pool.execute(
        "INSERT INTO permisos (codigo,etiqueta,grupo) VALUES (?,?,?) ON DUPLICATE KEY UPDATE etiqueta=VALUES(etiqueta),grupo=VALUES(grupo)",
        [grant, item.label, item.group],
      );
      await pool.execute(
        "INSERT IGNORE INTO roles_permisos (rol_id,permiso) VALUES (?,?)",
        [role.id, grant],
      );
    }
  }
  const [[adminRole]] = await pool.query(
    "SELECT id FROM roles WHERE nombre='administrador_wms'",
  );
  const [[chiefRole]] = await pool.query(
    "SELECT id FROM roles WHERE nombre='jefe_operaciones'",
  );
  // No borrar cuentas. Conservar propietario conocido, o el administrador más
  // antiguo si se instala en otro entorno. Registrar cada reasignación reversible.
  await transaction(async (conn) => {
    const [admins] = await conn.execute(
      `SELECT id,nombre,correo,rol_id,activo FROM usuarios
      WHERE rol_id=? ORDER BY (correo='frank@minimarket.com') DESC,activo DESC,id FOR UPDATE`,
      [adminRole.id],
    );
    if (admins.length && !admins[0].activo)
      throw new Error("Activa el administrador principal antes de migrar RBAC");
    for (const extra of admins.slice(1)) {
      await conn.execute(
        "INSERT INTO seguridad_eventos (accion,entidad_id,antes,despues) VALUES ('MIGRACION_ADMIN_UNICO',?,?,?)",
        [
          extra.id,
          JSON.stringify({ rol_id: extra.rol_id }),
          JSON.stringify({ rol_id: chiefRole.id }),
        ],
      );
      await conn.execute("UPDATE usuarios SET rol_id=? WHERE id=?", [
        chiefRole.id,
        extra.id,
      ]);
    }
  });
  const [userColumns] = await pool.query("SHOW COLUMNS FROM usuarios");
  if (!userColumns.some((c) => c.Field === "administrador_unico")) {
    const adminId = Number(adminRole.id);
    if (!Number.isSafeInteger(adminId) || adminId < 1)
      throw new Error("Rol administrador inválido");
    await pool.query(`ALTER TABLE usuarios ADD COLUMN administrador_unico TINYINT
      GENERATED ALWAYS AS (CASE WHEN rol_id=${adminId} THEN 1 ELSE NULL END) STORED,
      ADD UNIQUE KEY uq_administrador_unico (administrador_unico)`);
  }
}
module.exports = { migrateSecurity };
