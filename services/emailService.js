const nodemailer = require("nodemailer");
const env = require("../config/env");

const configured = () =>
  Boolean(env.mail.host && env.mail.user && env.mail.pass && env.mail.from);

let transporter;
const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

function getTransporter() {
  if (!configured()) return null;
  if (!transporter)
    transporter = nodemailer.createTransport({
      host: env.mail.host,
      port: env.mail.port,
      secure: env.mail.secure,
      auth: { user: env.mail.user, pass: env.mail.pass },
      pool: true,
      maxConnections: 3,
    });
  return transporter;
}

async function sendPasswordReset({ to, name, url, expiresIn }) {
  const mailer = getTransporter();
  if (!mailer)
    throw new Error(
      "El correo SMTP no está configurado. Completa SMTP_HOST, SMTP_USER, SMTP_PASS y MAIL_FROM.",
    );
  const greeting = name ? `Hola, ${name}.` : "Hola.";
  const safeGreeting = escapeHtml(greeting);
  const safeUrl = escapeHtml(url);
  const safeExpiry = escapeHtml(expiresIn);
  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject: "Restablece tu contraseña de Don Pepe WMS",
    text: `${greeting}\n\nEl administrador aprobó tu solicitud. Abre este enlace de un solo uso antes de ${expiresIn}:\n${url}\n\nSi no solicitaste el cambio, ignora este mensaje.`,
    html: `<!doctype html><html lang="es"><body style="margin:0;background:#f4f1f6;font-family:Arial,sans-serif;color:#241c2a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:36px 16px"><table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border:1px solid #e2dbe7;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 28px;background:#4b1f6f;color:#fff"><strong style="font-size:20px;letter-spacing:.08em">DON PEPE WMS</strong></td></tr><tr><td style="padding:34px 28px"><h1 style="margin:0 0 14px;font-size:26px">Restablece tu contraseña</h1><p style="line-height:1.6;color:#655a6d">${safeGreeting} El administrador aprobó tu solicitud. El enlace vence en ${safeExpiry} y solo puede utilizarse una vez.</p><p style="margin:28px 0"><a href="${safeUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#ffd200;color:#261533;font-weight:700;text-decoration:none">Crear nueva contraseña</a></p><p style="font-size:12px;line-height:1.55;color:#817687">Si no solicitaste el cambio, ignora este mensaje. Tu contraseña actual seguirá vigente.</p></td></tr></table></td></tr></table></body></html>`,
  });
}

async function sendRecoveryVerification({ to, name, url }) {
  const mailer = getTransporter();
  if (!mailer) throw new Error("SMTP no configurado");
  await mailer.sendMail({
    from: env.mail.from,
    to,
    subject: "Confirma tu correo de recuperación · DonPepe",
    text: `Hola, ${name}.\n\nConfirma este correo de recuperación desde tu sesión de DonPepe:\n${url}\n\nEl enlace vence en 30 minutos y sólo puede utilizarse una vez. Tu correo anterior seguirá vigente hasta que confirmes. Si no solicitaste este cambio, ignora el mensaje.`,
    html: `<div style="font-family:Arial,sans-serif;color:#271b35;max-width:560px;margin:auto;padding:32px"><h1>DONPEPE</h1><h2>Confirma tu correo de recuperación</h2><p>Hola, ${escapeHtml(name)}. Abre el enlace desde tu sesión de DonPepe para vincular este correo.</p><p><a style="display:inline-block;background:#7135ad;color:#fff;padding:16px 24px;border-radius:12px;text-decoration:none" href="${escapeHtml(url)}">Confirmar mi correo</a></p><p>Vence en 30 minutos. Tu correo anterior permanece vigente hasta confirmar. Si no solicitaste el cambio, ignora este mensaje.</p></div>`,
  });
}
module.exports = { configured, sendPasswordReset, sendRecoveryVerification };
