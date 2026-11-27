// Prueba transaccional: crea una cuenta temporal y revierte todos los cambios.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const { setNewPassword } = require("../services/passwordService");

async function main() {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[role]] = await conn.execute("SELECT id FROM roles ORDER BY id LIMIT 1");
    const initial = `Inicial${crypto.randomBytes(8).toString("hex")}A1`;
    const second = `Segunda${crypto.randomBytes(8).toString("hex")}B2`;
    const third = `Tercera${crypto.randomBytes(8).toString("hex")}C3`;
    const correo = `verify-${crypto.randomUUID()}@example.invalid`;
    const [created] = await conn.execute(
      `INSERT INTO usuarios (nombre,correo,correo_recuperacion,password,rol_id,activo)
       VALUES (?,?,?,?,?,1)`, ["Verificación temporal", correo,
        "verify@gmail.com", await bcrypt.hash(initial, 12), role.id],
    );
    const id = created.insertId;
    await assert.rejects(setNewPassword(conn, id, initial), /no puede ser igual/);
    await setNewPassword(conn, id, second);
    await assert.rejects(setNewPassword(conn, id, initial), /no puede ser igual/);
    await assert.rejects(setNewPassword(conn, id, second), /no puede ser igual/);
    await setNewPassword(conn, id, third);
    const [[user]] = await conn.execute("SELECT password FROM usuarios WHERE id=?", [id]);
    assert(await bcrypt.compare(third, user.password));
    const [[history]] = await conn.execute(
      "SELECT COUNT(*) total FROM historial_contrasenas WHERE usuario_id=?", [id],
    );
    assert.equal(Number(history.total), 2);
    console.log("OK: se rechaza la clave actual y una anterior; el historial queda hasheado");
  } finally {
    await conn.rollback();
    conn.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
