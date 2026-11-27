const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { isEmail } = require("validator");
const { transaction } = require("../config/db");
const { sendRecoveryVerification } = require("./emailService");
const env = require("../config/env");
const AppError = require("../utils/AppError");
const digest = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
async function invalidateRecoveryLinks(conn, userId) {
  await conn.execute(
    `UPDATE solicitudes_usuario SET estado='EXPIRADA',token_hash=NULL,token_expira_en=NULL
    WHERE usuario_id=? AND tipo='RESET_PASSWORD' AND estado='APROBADA'`,
    [userId],
  );
  await conn.execute(
    "UPDATE cambios_correo_recuperacion SET usado_en=NOW() WHERE usuario_id=? AND usado_en IS NULL",
    [userId],
  );
}
async function requestEmailChange({ userId, email, currentPassword }) {
  email = String(email || "")
    .trim()
    .toLowerCase();
  if (email.length > 100 || !isEmail(email))
    throw new AppError("Escribe un correo personal válido", 422);
  const token = crypto.randomBytes(32).toString("hex");
  const user = await transaction(async (conn) => {
    const [[user]] = await conn.execute(
      "SELECT id,nombre,password,correo_recuperacion,activo FROM usuarios WHERE id=? FOR UPDATE",
      [userId],
    );
    if (
      !user?.activo ||
      !(await bcrypt.compare(String(currentPassword || ""), user.password))
    )
      throw new AppError(
        "La contraseña actual no coincide. Confirma tu identidad para vincular otro correo.",
        422,
      );
    if (user.correo_recuperacion === email)
      throw new AppError("Ese correo ya está vinculado a tu cuenta", 409);
    await conn.execute(
      "UPDATE cambios_correo_recuperacion SET usado_en=NOW() WHERE usuario_id=? AND usado_en IS NULL",
      [userId],
    );
    await conn.execute(
      "INSERT INTO cambios_correo_recuperacion (usuario_id,correo,token_hash,expira_en) VALUES (?,?,?,DATE_ADD(NOW(),INTERVAL 30 MINUTE))",
      [userId, email, digest(token)],
    );
    return user;
  });
  try {
    await sendRecoveryVerification({
      to: email,
      name: user.nombre,
      url: `${env.appUrl}/mi-cuenta/verificar/${token}`,
    });
  } catch {
    await transaction((conn) =>
      conn.execute(
        "UPDATE cambios_correo_recuperacion SET usado_en=NOW() WHERE token_hash=?",
        [digest(token)],
      ),
    );
    throw new AppError(
      "No pudimos enviar la verificación. Tu correo anterior sigue vinculado; revisa la configuración SMTP e inténtalo de nuevo.",
      503,
    );
  }
}
async function confirmEmailChange({ userId, token }) {
  return transaction(async (conn) => {
    const [[user]] = await conn.execute(
      "SELECT id,activo FROM usuarios WHERE id=? FOR UPDATE",
      [userId],
    );
    if (!user?.activo) throw new AppError("Cuenta no disponible", 403);
    const [[change]] = await conn.execute(
      "SELECT id,correo FROM cambios_correo_recuperacion WHERE usuario_id=? AND token_hash=? AND usado_en IS NULL AND expira_en>NOW() FOR UPDATE",
      [userId, digest(token)],
    );
    if (!change)
      throw new AppError(
        "El enlace venció, ya se utilizó o pertenece a otra cuenta. Solicita una nueva verificación desde Mi cuenta.",
        409,
      );
    await conn.execute("UPDATE usuarios SET correo_recuperacion=? WHERE id=?", [
      change.correo,
      userId,
    ]);
    await conn.execute(
      "UPDATE cambios_correo_recuperacion SET usado_en=NOW() WHERE id=?",
      [change.id],
    );
    await invalidateRecoveryLinks(conn, userId);
    await conn.execute(
      "INSERT INTO seguridad_eventos (actor_id,accion,entidad_id) VALUES (?,'CORREO_RECUPERACION_CAMBIADO',?)",
      [userId, userId],
    );
    return change.correo;
  });
}
async function pendingEmailChange({ userId, token }) {
  return transaction(async (conn) => {
    const [[change]] = await conn.execute(
      "SELECT correo FROM cambios_correo_recuperacion WHERE usuario_id=? AND token_hash=? AND usado_en IS NULL AND expira_en>NOW()",
      [userId, digest(token)],
    );
    if (!change)
      throw new AppError(
        "El enlace venció, ya se utilizó o pertenece a otra cuenta. Solicita una nueva verificación desde Mi cuenta.",
        409,
      );
    return change.correo;
  });
}
module.exports = {
  invalidateRecoveryLinks,
  requestEmailChange,
  confirmEmailChange,
  pendingEmailChange,
};
