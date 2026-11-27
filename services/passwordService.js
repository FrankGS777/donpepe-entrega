const bcrypt = require("bcryptjs");
const { transaction } = require("../config/db");
const AppError = require("../utils/AppError");

function validatePasswordPolicy(password) {
  if (typeof password !== "string" || password.length < 10 ||
      Buffer.byteLength(password, "utf8") > 72 ||
      !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password))
    throw new AppError("Usa entre 10 y 72 bytes, con mayúscula, minúscula y número", 422);
}

async function setNewPassword(conn, userId, password) {
  validatePasswordPolicy(password);
  const [[user]] = await conn.execute(
    "SELECT id,password FROM usuarios WHERE id=? FOR UPDATE", [userId],
  );
  if (!user) throw new AppError("Usuario no encontrado", 404);
  const [history] = await conn.execute(
    `SELECT id,password_hash FROM historial_contrasenas WHERE usuario_id=?
     ORDER BY id DESC LIMIT 5`, [userId],
  );
  for (const hash of [user.password, ...history.map((row) => row.password_hash)]) {
    if (await bcrypt.compare(password, hash))
      throw new AppError("La contraseña nueva no puede ser igual a la actual ni a las cinco anteriores", 422);
  }
  const nextHash = await bcrypt.hash(password, 12);
  await conn.execute(
    "INSERT INTO historial_contrasenas (usuario_id,password_hash) VALUES (?,?)",
    [userId, user.password],
  );
  await conn.execute("UPDATE usuarios SET password=? WHERE id=?", [nextHash, userId]);
  if (history.length === 5)
    await conn.execute(
      "DELETE FROM historial_contrasenas WHERE usuario_id=? AND id=?",
      [userId, history[4].id],
    );
}

async function changeOwnPassword({ userId, currentPassword, newPassword }) {
  return transaction(async (conn) => {
    const [[user]] = await conn.execute(
      "SELECT password FROM usuarios WHERE id=? AND activo=1 FOR UPDATE", [userId],
    );
    if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.password)))
      throw new AppError("La contraseña actual no es correcta", 422);
    await setNewPassword(conn, userId, newPassword);
  });
}

module.exports = { validatePasswordPolicy, setNewPassword, changeOwnPassword };
