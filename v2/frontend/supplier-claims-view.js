const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const money = (v) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN" }).format(
    (v || 0) / 100,
  );
const date = (v) =>
  v
    ? new Intl.DateTimeFormat("es-PE", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/Lima",
      }).format(new Date(v))
    : "";
const labels = {
  AWAITING_RESPONSE: "Espera respuesta del proveedor",
  AWAITING_DISPOSITION: "Disposición pendiente",
  AWAITING_SETTLEMENT: "Resolución económica pendiente",
  CLOSED: "Cerrada",
};
const mailLabels = {
  QUEUED: "Notificación pendiente",
  SENDING: "Enviando al proveedor",
  SENT: "Correo aceptado por el servidor",
  FAILED: "Correo no enviado",
  SIMULATED: "Canal de prueba · sin correo real",
  UNKNOWN: "Entrega de correo por verificar",
  CONTACT_REQUIRED: "Falta el correo del proveedor",
};
const decisions = {
  RETURN: "Devolución autorizada",
  DISPOSE: "Baja autorizada",
  REJECTED: "Reclamación rechazada",
};
const button = (label, action, id, style = "secondary") =>
  `<button type="button" class="btn ${style}" data-action="claim-${action}" data-id="${esc(id)}">${label}</button>`;
const image = (c) =>
  c.imageUrl
    ? `<img src="${esc(c.imageUrl)}" alt="${esc(c.productName)}" loading="lazy" width="112" height="128">`
    : "";
export function supplierClaimsMarkup(state, administrative = false) {
  const model = state.supplierClaims || { claims: [], candidates: [] };
  if (!state.permissions?.includes("supplierClaim.read")) return "";
  const open = model.claims.filter((c) => c.state !== "CLOSED"),
    closed = model.claims.filter((c) => c.state === "CLOSED");
  const candidates = administrative ? [] : model.candidates;
  const card = (c) =>
    `<article class="claim-card"><div class="claim-product">${image(c)}<div><strong class="document-code">${esc(c.id || c.huId)}</strong><h3>${esc(c.productName)}</h3><p>${esc(c.supplierName)}</p></div></div><div class="claim-summary"><strong>${c.cases} ${c.cases === 1 ? "caja afectada" : "cajas afectadas"}</strong><span>${esc(c.defectLabel)}</span><span>Lote ${esc(c.lot)}</span></div>${c.id ? `<p class="claim-status">${labels[c.state]}</p><p class="muted">${mailLabels[c.notification.status] || "Notificación pendiente"}</p>${button(administrative ? "Revisar y conciliar" : "Abrir reclamación", "open", c.id)}` : `<p class="claim-status">Hallazgo sin reportar</p>${button("Reportar y notificar", "report", c.huId, "primary")}`}</article>`;
  return `<section class="panel supplier-claims" id="supplier-claims"><div class="section-heading"><div><h2>${administrative ? "Reclamaciones y notas de crédito" : "Cajas observadas"}</h2><p>${administrative ? "Concilia la respuesta económica del proveedor. La devolución o baja la documenta Operaciones." : "Hallazgos retenidos para reclamar al proveedor y resolver su devolución o baja."}</p></div><span class="badge ${open.length + candidates.length ? "amber" : ""}">${open.length + candidates.length} pendientes</span></div>${candidates.length + open.length ? `<div class="claims-grid">${candidates.map(card).join("")}${open.map(card).join("")}</div>` : '<p class="claims-empty">Sin cajas pendientes de reclamar o resolver.</p>'}${closed.length ? `<details class="claims-closed"><summary>Reclamaciones cerradas · ${closed.length}</summary><div class="claims-grid">${closed.map(card).join("")}</div></details>` : ""}</section>`;
}
export async function handleSupplierClaim(
  action,
  id,
  { getState, user, command, dialog },
) {
  if (!action?.startsWith("claim-")) return false;
  const state = getState(),
    model = state.supplierClaims || { claims: [], candidates: [] };
  let claim = model.claims.find((c) => c.id === id),
    candidate = model.candidates.find((c) => c.huId === id);
  if (action === "claim-for-hu") {
    claim = model.claims.find((c) => c.huId === id);
    candidate = model.candidates.find((c) => c.huId === id);
    action = claim ? "claim-open" : "claim-report";
  }
  const permission = (p) => state.permissions.includes(p);
  const form = (title, body, fields, label, submit) => {
    dialog(
      title,
      `${body}<form id="supplier-claim-form">${fields}<p class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn primary">${label}</button></div></form>`,
      "PROVEEDORES · CAJAS OBSERVADAS",
    );
    const f = document.querySelector("#supplier-claim-form");
    f.onsubmit = async (e) => {
      e.preventDefault();
      if (!f.reportValidity()) return;
      const b = f.querySelector("button");
      b.disabled = true;
      try {
        await submit(Object.fromEntries(new FormData(f)));
      } catch (error) {
        f.querySelector(".form-error").textContent = error.message;
        b.disabled = false;
      }
    };
  };
  const spot = (c) =>
    `<div class="claim-product claim-spotlight">${image(c)}<div><h3>${esc(c.productName)}</h3><p>${esc(c.supplierName)} · ${c.cases} ${c.cases === 1 ? "caja" : "cajas"}</p><strong>${esc(c.defectLabel)}</strong><p>Lote ${esc(c.lot)} · ${esc(c.huId)} (carga retenida)</p></div></div>`;
  const reference = (label) =>
    `<label>${label}<input name="reference" required minlength="5" maxlength="100" autocomplete="off"></label>`;
  const check = (name, label) =>
    `<label class="form-check"><input name="${name}" type="checkbox" required>${label}</label>`;
  const execute = async (type, payload, message) => {
    const result = await command(type, payload, message);
    await handleSupplierClaim("claim-open", result.id || claim.id, {
      getState,
      user,
      command,
      dialog,
    });
  };
  const send = (type, values, message) =>
    execute(
      type,
      { id: claim.id, revision: claim.revision, ...values },
      message,
    );
  if (action === "claim-report") {
    if (!candidate || !permission("supplierClaim.manage"))
      throw Error(
        "El hallazgo ya cambió o no tienes permiso para reportarlo. Actualiza Recepción.",
      );
    form(
      "Reportar cajas al proveedor",
      spot(candidate) +
        `<div class="notice">${candidate.recipient ? `Destinatario: <strong>${esc(candidate.recipient)}</strong>. El expediente conservará el resultado del envío.` : "El proveedor no tiene correo registrado. El reporte se conservará y Administración deberá completar el contacto para notificar."}</div><p>Compra ${esc(candidate.purchaseId)} · Factura ${esc(candidate.invoiceReference || "sin vincular")}. Se adjunta el hallazgo de inspección, sin modificar las cajas sanas ni el importe de la factura.</p>`,
      `<label>Observación adicional<textarea name="note" maxlength="300" rows="2" placeholder="Opcional"></textarea></label>`,
      "Reportar y notificar",
      (v) =>
        execute(
          "supplierClaim.report",
          { huId: candidate.huId, cases: candidate.cases, note: v.note },
          "Reclamación registrada. Revisa el estado de su notificación.",
        ),
    );
    return true;
  }
  if (!claim) throw Error("No se encontró la reclamación. Actualiza la vista.");
  if (action === "claim-open") {
    const ops = permission("supplierClaim.manage"),
      admin = permission("supplierClaim.settle"),
      ready = claim.huState === "SUPPLIER_RETURN_READY",
      safe = claim.huState === "QUARANTINE";
    const acts = [];
    if (
      ops &&
      ["QUEUED", "FAILED", "UNKNOWN", "SIMULATED", "CONTACT_REQUIRED"].includes(
        claim.notification.status,
      )
    )
      acts.push(button("Reintentar notificación", "retry", id));
    if (ops && !claim.response)
      acts.push(
        button("Registrar respuesta del proveedor", "respond", id, "primary"),
      );
    if (
      ops &&
      claim.response?.decision === "RETURN" &&
      !claim.physicalResolution &&
      !claim.returnMissionId &&
      !claim.returnPreparedAt
    )
      acts.push(button("Preparar devolución", "prepare", id, "primary"));
    if (ops && ready && !claim.physicalResolution)
      acts.push(
        button("Confirmar recogida del proveedor", "handover", id, "primary"),
      );
    if (
      ops &&
      !claim.physicalResolution &&
      (claim.response?.decision === "DISPOSE" ||
        (claim.response?.decision === "REJECTED" &&
          claim.settlement?.kind === "LOSS"))
    )
      acts.push(button("Documentar retirada y baja", "dispose", id, "primary"));
    if (admin && claim.response && !claim.settlement)
      acts.push(button("Resolver importe reclamado", "settle", id, "primary"));
    const physical = claim.physicalResolution
      ? `${claim.physicalResolution.kind === "RETURN" ? "Devuelto al proveedor" : "Baja por retirada documentada"} · ${claim.physicalResolution.reference} · ${claim.physicalResolution.party}`
      : ready
        ? "Carga preparada para recogida"
        : claim.returnMissionId
          ? "Traslado autónomo en curso"
          : safe
            ? "Retenida en cuarentena"
            : "Espera un depósito seguro en cuarentena";
    dialog(
      `Reclamación ${claim.id}`,
      `<span hidden data-supplier-claim-dossier="${esc(claim.id)}" data-claim-revision="${claim.revision}"></span>${spot(claim)}<div class="claim-facts"><div><span>Situación</span><strong>${labels[claim.state]}</strong></div><div><span>Notificación a ${esc(claim.recipient || "contacto sin registrar")}</span><strong>${mailLabels[claim.notification.status]}</strong>${claim.notification.error ? `<p class="form-error">${esc(claim.notification.error)}</p>` : ""}</div><div><span>Compra y factura</span><strong>${esc(claim.purchaseId)} · ${esc(claim.invoiceReference || "Sin factura vinculada")}</strong></div><div><span>Respuesta registrada</span><strong>${claim.response ? `${decisions[claim.response.decision]} · ${esc(claim.response.reference)}` : "Pendiente del proveedor"}</strong></div><div><span>Destino físico</span><strong>${esc(physical)}</strong></div><div><span>Importe reclamable</span><strong>${money(claim.claimableCents)}</strong><p>${claim.settlement ? (claim.settlement.kind === "CREDIT" ? `Abono ${money(claim.settlement.amountCents)} · ${esc(claim.settlement.reference)}${claim.settlement.uncompensatedCents ? ` · diferencia asumida ${money(claim.settlement.uncompensatedCents)}` : ""}` : `Pérdida asumida · ${esc(claim.settlement.reference)}`) : "Conciliación pendiente de Administración"}</p></div></div><div class="dialog-actions claim-actions">${acts.join("")}</div><details class="claims-history"><summary>Historial y evidencia</summary><p>Recepción ${esc(claim.receiptId || "sin referencia")} · Inspección ${esc(claim.inspectionId || "sin referencia")}</p>${claim.history.map((h) => `<article><small>${date(h.at)} · ${esc(h.actorId)}</small><p>${esc(h.detail)}</p></article>`).join("")}</details>`,
      "PROVEEDORES · EXPEDIENTE",
    );
    return true;
  }
  if (action === "claim-retry") {
    form(
      "Reintentar notificación",
      `<p>Se utilizará el correo vigente de la ficha del proveedor. Estado anterior: ${mailLabels[claim.notification.status]}.</p>`,
      claim.notification.status === "UNKNOWN"
        ? check(
            "confirmDuplicateRisk",
            "Verifiqué el envío anterior con el proveedor y autorizo el reintento.",
          )
        : "",
      "Reintentar envío",
      (v) =>
        send(
          "supplierClaim.retry",
          { confirmDuplicateRisk: v.confirmDuplicateRisk === "on" },
          "Reintento registrado. Revisa el resultado.",
        ),
    );
    return true;
  }
  if (action === "claim-respond") {
    const leaking = ["LIQUID_LEAK", "WET_LEAK"].includes(claim.defect);
    form(
      "Registrar respuesta del proveedor",
      spot(claim) +
        `<p>Registra una respuesta recibida; el sistema no supone una aceptación automática.${leaking ? " El derrame requiere contención y no admite una devolución ordinaria." : ""}</p>`,
      `<label>Disposición autorizada<select name="decision">${leaking ? "" : '<option value="RETURN">Devolución al proveedor</option>'}<option value="DISPOSE">Baja y retirada de mercancía</option><option value="REJECTED">Reclamación rechazada</option></select></label>${reference("Correo, autorización o referencia recibida")}<label>Detalle<textarea name="note" maxlength="300" rows="2"></textarea></label>`,
      "Guardar respuesta",
      (v) => send("supplierClaim.respond", v, "Respuesta registrada."),
    );
    return true;
  }
  if (action === "claim-prepare") {
    form(
      "Preparar devolución",
      spot(claim) +
        `<p>Las cajas seguirán bloqueadas para venta. Un AMR trasladará las cargas secas a recepción. Los productos refrigerados, congelados o químicos conservan su cuarentena compatible hasta la recogida segregada.</p>`,
      "",
      "Solicitar preparación",
      () => send("supplierClaim.prepareReturn", {}, "Preparación registrada."),
    );
    return true;
  }
  if (action === "claim-handover" || action === "claim-dispose") {
    const returning = action === "claim-handover";
    form(
      returning
        ? "Confirmar recogida del proveedor"
        : "Documentar retirada de mercancía",
      spot(claim) +
        `<div class="notice warning">Confirma una salida realizada, con su documento de entrega. Esta acción descuenta ${claim.cases} cajas físicas y no cambia la factura original.</div>`,
      `${reference(returning ? "Acta o guía de recogida" : "Acta de retirada de residuos")}<label>${returning ? "Transportista que recoge" : "Gestor que retira los residuos"}<input name="party" required minlength="3" maxlength="120"></label>${claim.returnPickupLocation ? check("confirmConservation", "La recogida conserva la temperatura o separación química requerida.") : ""}${check("confirm", "Verifiqué la entrega física y su documento de respaldo.")}`,
      "Confirmar salida",
      (v) =>
        send(
          returning ? "supplierClaim.handover" : "supplierClaim.dispose",
          {
            reference: v.reference,
            party: v.party,
            confirm: v.confirm === "on",
            confirmConservation: v.confirmConservation === "on",
          },
          "Salida documentada.",
        ),
    );
    return true;
  }
  if (action === "claim-settle") {
    form(
      "Resolver importe reclamado",
      spot(claim) +
        `<p>Máximo reclamable: <strong>${money(claim.claimableCents)}</strong>. Registra el documento recibido del proveedor. Si la factura ya fue pagada, el abono quedará como saldo a favor por recuperar.</p>`,
      `<label>Resolución<select name="kind" id="claim-settlement-kind"><option value="CREDIT">Nota de crédito recibida</option><option value="LOSS">Pérdida asumida sin abono</option></select></label><label id="claim-credit-amount">Importe abonado S/<input name="amount" type="number" min="0.01" max="${claim.claimableCents / 100}" step="0.01" value="${(claim.claimableCents / 100).toFixed(2)}"></label><label>Nota de crédito o motivo documentado<input name="reference" required minlength="5" maxlength="120"></label><label class="form-check"><input name="acceptDifference" type="checkbox">Acepto una compensación parcial y su diferencia sin abonar, si corresponde.</label>${check("confirm", "He verificado el documento o autorizo asumir la pérdida indicada.")}`,
      "Guardar resolución",
      (v) =>
        send(
          "supplierClaim.settle",
          {
            kind: v.kind,
            reference: v.reference,
            amountCents: Math.round(Number(v.amount) * 100),
            confirm: v.confirm === "on",
            acceptDifference: v.acceptDifference === "on",
          },
          "Resolución económica registrada.",
        ),
    );
    const kind = document.querySelector("#claim-settlement-kind");
    kind.onchange = () => {
      document.querySelector("#claim-credit-amount").hidden =
        kind.value !== "CREDIT";
      document.querySelector('[name="reference"]').minLength =
        kind.value === "LOSS" ? 12 : 5;
    };
    return true;
  }
  return false;
}

export function refreshSupplierClaimDialog(options) {
  const marker = document.querySelector(
    "#dialog[open] [data-supplier-claim-dossier]",
  );
  if (!marker) return;
  const state = options.getState(),
    claim = state.supplierClaims?.claims.find(
      (c) => c.id === marker.dataset.supplierClaimDossier,
    );
  if (!claim || !state.permissions.includes("supplierClaim.read")) {
    document.querySelector("#dialog")?.close();
    return;
  }
  if (Number(marker.dataset.claimRevision) !== claim.revision) {
    const el = document.querySelector("#dialog"),
      top = el.scrollTop;
    handleSupplierClaim("claim-open", claim.id, options);
    el.scrollTop = top;
  }
}
