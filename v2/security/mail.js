"use strict";
const path = require("node:path");
const nodemailer = require("nodemailer");
// Read the existing server-side SMTP settings. Never inherit the old demo
// recipient override: recovery belongs to the verified individual recipient.
require("dotenv").config({ path: path.join(__dirname, "../../.env"), quiet: true });
function createRecoveryMail(options = {}) {
  const env = options.env || process.env;
  const config = { host: env.SMTP_HOST || "", port: Number(env.SMTP_PORT || 587), secure: env.SMTP_SECURE === "true", user: env.SMTP_USER || "", pass: env.SMTP_PASS || "", from: env.MAIL_FROM || env.SMTP_USER || "" };
  if (config.host === "smtp.gmail.com") config.pass = config.pass.replace(/\s/g, "");
  const configured = !!options.transport || !!(config.host && config.user && config.pass && config.from && Number.isInteger(config.port) && config.port > 0 && config.port <= 65535);
  let transport = options.transport;
  const masked = value => value.replace(/^(.{1,2}).*(@.*)$/, "$1•••$2");
  const status = () => ({ configured, provider: config.host === "smtp.gmail.com" ? "Gmail SMTP" : "SMTP", host: config.host, port: config.port, secure: config.secure, from: masked(config.user), recipientPolicy: "Gmail personal verificado de cada usuario; sin destinatario global." });
  async function send({ to, name, url, kind }) {
    if (!configured) { const e = new Error("El servicio de correo no está configurado. Administración debe revisar la conexión SMTP del servidor."); e.status = 503; throw e; }
    if (!transport) transport = nodemailer.createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: !config.secure, auth: { user: config.user, pass: config.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000 });
    const verification = kind === "verification";
    const subject = verification ? "Confirma tu correo de recuperación · DonPepe" : "Recupera tu acceso · DonPepe";
    const message = verification ? "Confirma que este Gmail te pertenece. Tu correo anterior seguirá vigente hasta confirmar." : "Tu solicitud de recuperación ha sido autorizada. Crea una contraseña nueva con este enlace de un solo uso.";
    const escaped = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
    await transport.sendMail({ from: config.from, to, subject, text: `Hola, ${name}.\n\n${message}\n\n${url}\n\nEl enlace vence en 30 minutos y sólo puede utilizarse una vez. Si no solicitaste esta acción, ignora este mensaje.`, html: `<div style="background:#f4f0f8;padding:32px;font-family:Arial,sans-serif;color:#241633"><div style="max-width:560px;margin:auto;background:#fff;border-radius:20px;padding:32px;border-top:6px solid #e1ad00"><h1 style="color:#7135ad">DONPEPE</h1><h2>${escaped(subject.split(" ·")[0])}</h2><p>Hola, ${escaped(name)}.</p><p style="line-height:1.7">${escaped(message)}</p><p style="padding:20px 0"><a style="background:#7135ad;color:white;border-radius:12px;padding:16px;text-decoration:none" href="${escaped(url)}">${verification ? "Confirmar mi Gmail" : "Crear nueva contraseña"}</a></p><p>Enlace de un uso · vence en 30 minutos.</p><small>Si no solicitaste esta acción, ignora este mensaje.</small></div></div>` });
  }
  return { status, send, close: () => transport?.close?.() };
}
module.exports = { createRecoveryMail };
