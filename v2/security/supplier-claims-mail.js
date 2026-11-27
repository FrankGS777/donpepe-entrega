"use strict";
const nodemailer = require("nodemailer");
function createSupplierClaimsMail({
  env = process.env,
  transport,
  mode = "demo",
} = {}) {
  const from = env.MAIL_FROM || env.SMTP_USER || "";
  const enabled = env.DONPEPE_SUPPLIER_NOTIFICATIONS === "smtp" || !!transport;
  let client = transport;
  const simulated = !enabled && mode === "demo";
  return {
    async send(claim) {
      if (simulated) return "SIMULATED";
      if (
        !enabled ||
        (!client &&
          (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS || !from))
      )
        throw new Error(
          "Configura SMTP y DONPEPE_SUPPLIER_NOTIFICATIONS=smtp para enviar al proveedor.",
        );
      if (!client)
        client = nodemailer.createTransport({
          host: env.SMTP_HOST,
          port: Number(env.SMTP_PORT || 587),
          secure: env.SMTP_SECURE === "true",
          requireTLS: env.SMTP_SECURE !== "true",
          auth: {
            user: env.SMTP_USER,
            pass:
              env.SMTP_HOST === "smtp.gmail.com"
                ? env.SMTP_PASS.replace(/\s/g, "")
                : env.SMTP_PASS,
          },
          connectionTimeout: 10000,
          greetingTimeout: 10000,
          socketTimeout: 15000,
        });
      const text = `DonPepe · Reclamación ${claim.id}\n\nProveedor: ${claim.supplierName}\nCompra: ${claim.purchaseId}\nFactura: ${claim.invoiceReference || "Pendiente de identificación"}\nProducto: ${claim.productName}\nLote: ${claim.lot}\nCarga: ${claim.huId}\nCajas afectadas: ${claim.cases}\nHallazgo: ${claim.defectLabel}\nInspección: ${claim.inspectionId || "Registro de recepción"}\nObservación: ${claim.note || "Sin observaciones adicionales"}\n\nLas cajas permanecen retenidas y no disponibles. Solicitamos confirmar la devolución o baja autorizada y la compensación mediante nota de crédito cuando corresponda. Responda indicando ${claim.id}.`;
      try {
        const result = await client.sendMail({
          from: from || "DonPepe <no-reply@donpepe.local>",
          to: claim.recipient,
          subject: `DonPepe · Reclamación ${claim.id} · ${claim.purchaseId}`,
          messageId: `<donpepe-${claim.id.toLowerCase()}-${claim.notification.attempts}@notifications.donpepe.local>`,
          text,
          attachments: [
            { filename: `Evidencia-${claim.id}.txt`, content: text },
          ],
        });
        if (
          !result?.accepted?.some(
            (to) => String(to).toLowerCase() === claim.recipient.toLowerCase(),
          )
        )
          throw new Error(
            "El servidor de correo no aceptó al destinatario del proveedor.",
          );
        return "SENT";
      } catch (error) {
        const knownRejection =
          error.responseCode >= 400 ||
          ["EAUTH", "EENVELOPE", "ENOTFOUND", "ECONNECTION"].includes(
            error.code,
          );
        // A timeout after DATA cannot prove the message was not delivered.
        if (
          !knownRejection &&
          ["ETIMEDOUT", "ESOCKET", "ECONNRESET"].includes(error.code)
        )
          error.deliveryUnknown = true;
        throw error;
      }
    },
    close() {
      client?.close?.();
    },
  };
}
module.exports = { createSupplierClaimsMail };
