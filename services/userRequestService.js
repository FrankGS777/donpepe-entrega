const crypto = require("crypto");
const { pool, transaction } = require("../config/db");
const env = require("../config/env");
const { sendPasswordReset } = require("./emailService");
const AppError = require("../utils/AppError");
const { setNewPassword } = require("./passwordService");
const { requireActorPermission } = require("./accessPolicy");

const normalizedEmail = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();
const requestCode = () =>
  `SOL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const newToken = () => crypto.randomBytes(32).toString("hex");
const tokenHash = (token) =>
  crypto.createHash("sha256").update(String(token)).digest("hex");

async function requestPasswordReset({ email }) {
  const correo = normalizedEmail(email);
  return transaction(async (conn) => {
    const [[user]] = await conn.execute(
      "SELECT id,nombre,correo_recuperacion FROM usuarios WHERE correo=? AND activo=1 LIMIT 1",
      [correo],
    );
    const [[pending]] = await conn.execute(
      `SELECT id FROM solicitudes_usuario
       WHERE correo=? AND tipo='RESET_PASSWORD' AND estado='PENDIENTE'
       LIMIT 1 FOR UPDATE`,
      [correo],
    );
    if (user && !pending) {
      await conn.execute(
        `UPDATE solicitudes_usuario
         SET estado='EXPIRADA',token_hash=NULL,token_expira_en=NULL
         WHERE correo=? AND tipo='RESET_PASSWORD' AND estado='APROBADA'`,
        [correo],
      );
      await conn.execute(
        `INSERT INTO solicitudes_usuario
         (codigo,tipo,nombre,correo,motivo,usuario_id)
         VALUES (?,'RESET_PASSWORD',?,?,?,?)`,
        [
          requestCode(),
          user.nombre,
          correo,
          "Restablecimiento solicitado desde el portal de acceso",
          user.id,
        ],
      );
    }
    return { accepted: true };
  });
}

async function deliverReset(result) {
  const activationUrl = `${env.appUrl}${result.activationPath}`;
  const recoveryEmail = result.request.correo_recuperacion;
  if (!recoveryEmail)
    throw new AppError(
      "La cuenta no tiene un correo de recuperación configurado",
      409,
    );
  try {
    await sendPasswordReset({
      to: recoveryEmail,
      name: result.request.nombre,
      url: activationUrl,
      expiresIn: result.expiresIn,
    });
    await pool.execute(
      `UPDATE solicitudes_usuario
       SET envio_estado='ENVIADO',enviado_en=NOW(),envio_error=NULL
       WHERE id=?`,
      [result.request.id],
    );
    return {
      ...result,
      activationUrl,
      delivery: { sent: true, to: recoveryEmail },
    };
  } catch (error) {
    const reason = String(error.message || "No se pudo enviar el correo").slice(
      0,
      500,
    );
    await pool.execute(
      `UPDATE solicitudes_usuario
       SET envio_estado='ERROR',enviado_en=NULL,envio_error=?
       WHERE id=?`,
      [reason, result.request.id],
    );
    return {
      ...result,
      activationUrl,
      delivery: { sent: false, to: recoveryEmail, error: reason },
    };
  }
}

async function approveRequest({ requestId, actorId, note = "" }) {
  const result = await transaction(async (conn) => {
    await requireActorPermission(conn, actorId, "requests.manage");
    const [[request]] = await conn.execute(
      "SELECT * FROM solicitudes_usuario WHERE id=? FOR UPDATE",
      [requestId],
    );
    if (
      !request ||
      request.estado !== "PENDIENTE" ||
      request.tipo !== "RESET_PASSWORD"
    )
      throw new AppError("La solicitud ya fue atendida o no existe", 409);
    const userId = request.usuario_id;
    const [[user]] = await conn.execute(
      "SELECT id,nombre,correo,correo_recuperacion FROM usuarios WHERE id=? AND activo=1 FOR UPDATE",
      [userId],
    );
    if (!user) throw new AppError("La cuenta ya no está disponible", 409);
    const token = newToken();
    await conn.execute(
      `UPDATE solicitudes_usuario
       SET estado='APROBADA',usuario_id=?,revisado_por=?,observacion_admin=?,
       token_hash=?,token_expira_en=DATE_ADD(NOW(),INTERVAL 1 HOUR),revisado_en=NOW(),
       envio_estado='PENDIENTE',enviado_en=NULL,envio_error=NULL
       WHERE id=?`,
      [userId, actorId, note || null, tokenHash(token), requestId],
    );
    return {
      request: {
        ...request,
        nombre: user.nombre,
        correo: user.correo,
        correo_recuperacion: user.correo_recuperacion,
      },
      activationPath: `/cuenta/activar/${token}`,
      expiresIn: "1 hora",
    };
  });
  return deliverReset(result);
}

async function rejectRequest({ requestId, actorId, note }) {
  return transaction(async (conn) => {
    await requireActorPermission(conn, actorId, "requests.manage");
    const [result] = await conn.execute(
      `UPDATE solicitudes_usuario
       SET estado='RECHAZADA',revisado_por=?,observacion_admin=?,revisado_en=NOW(),
       token_hash=NULL,token_expira_en=NULL
       WHERE id=? AND estado='PENDIENTE'`,
      [actorId, note || "Solicitud no autorizada", requestId],
    );
    if (!result.affectedRows)
      throw new AppError("La solicitud ya fue atendida o no existe", 409);
  });
}

async function regenerateLink({ requestId, actorId }) {
  const result = await transaction(async (conn) => {
    await requireActorPermission(conn, actorId, "requests.manage");
    const [[request]] = await conn.execute(
      `SELECT s.*,u.correo_recuperacion
       FROM solicitudes_usuario s
       JOIN usuarios u ON u.id=s.usuario_id
       WHERE s.id=? AND s.tipo='RESET_PASSWORD' AND u.activo=1
       AND s.estado IN ('APROBADA','EXPIRADA') FOR UPDATE`,
      [requestId],
    );
    if (!request)
      throw new AppError(
        "Solo puede renovarse una solicitud aprobada o expirada",
        409,
      );
    const token = newToken();
    await conn.execute(
      `UPDATE solicitudes_usuario SET estado='APROBADA',token_hash=?,
       token_expira_en=DATE_ADD(NOW(),INTERVAL 1 HOUR),revisado_por=?,revisado_en=NOW(),
       envio_estado='PENDIENTE',enviado_en=NULL,envio_error=NULL
       WHERE id=?`,
      [tokenHash(token), actorId, requestId],
    );
    return {
      request,
      activationPath: `/cuenta/activar/${token}`,
      expiresIn: "1 hora",
    };
  });
  return deliverReset(result);
}

async function tokenRequest(token) {
  const hash = tokenHash(token);
  return transaction(async (conn) => {
    const [[request]] = await conn.execute(
      `SELECT s.id,s.codigo,s.tipo,s.nombre,s.correo,s.estado,s.token_expira_en,
       s.usuario_id,u.activo
       FROM solicitudes_usuario s
       JOIN usuarios u ON u.id=s.usuario_id
       WHERE s.token_hash=? AND s.estado='APROBADA' AND s.token_expira_en>NOW()
       FOR UPDATE`,
      [hash],
    );
    if (!request?.activo)
      throw new AppError("El enlace no es válido o ya fue utilizado", 410);
    return request;
  });
}

async function completeWithPassword({ token, password }) {
  const hash = tokenHash(token);
  return transaction(async (conn) => {
    const [[request]] = await conn.execute(
      `SELECT * FROM solicitudes_usuario
       WHERE token_hash=? AND estado='APROBADA' AND token_expira_en>NOW()
       FOR UPDATE`,
      [hash],
    );
    if (!request)
      throw new AppError(
        "El enlace no es válido, venció o ya fue utilizado",
        410,
      );
    const [[user]] = await conn.execute(
      "SELECT id,activo FROM usuarios WHERE id=? FOR UPDATE",
      [request.usuario_id],
    );
    if (!user?.activo)
      throw new AppError(
        "La cuenta ya no está disponible para recuperación",
        410,
      );
    await setNewPassword(conn, request.usuario_id, password);
    await conn.execute(
      `UPDATE solicitudes_usuario
       SET estado='COMPLETADA',token_hash=NULL,token_expira_en=NULL,completado_en=NOW()
       WHERE id=?`,
      [request.id],
    );
    return request;
  });
}

module.exports = {
  requestPasswordReset,
  approveRequest,
  rejectRequest,
  regenerateLink,
  tokenRequest,
  completeWithPassword,
};
