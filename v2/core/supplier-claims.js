"use strict";
const { problem } = require("./validation");
const { defectLabel } = require("./packaging-quality");
const { can } = require("../security/policy");
const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
const text = (value, label, min = 5, max = 300) => {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    problem(`${label}: escribe entre ${min} y ${max} caracteres.`, 422);
  return value.trim();
};
function migrateSupplierClaims(s) {
  let changed = false;
  if (!s.supplierClaims) {
    s.supplierClaims = [];
    changed = true;
  }
  if (s.ledger.supplierReturnedCases === undefined) {
    s.ledger.supplierReturnedCases = 0;
    changed = true;
  }
  s.finance ||= { bills: [], payments: [] };
  if (!s.finance.creditNotes) {
    s.finance.creditNotes = [];
    changed = true;
  }
  // Delivery may have happened before a crash. Retrying is an explicit decision.
  for (const claim of s.supplierClaims)
    if (claim.notification.status === "SENDING") {
      claim.notification.status = "UNKNOWN";
      claim.notification.error =
        "Envío interrumpido: verifica con el proveedor antes de reintentar.";
      changed = true;
    }
  return changed;
}
function damagedCandidate(s, hu) {
  return (
    hu &&
    hu.cases > 0 &&
    hu.packagingDefect &&
    hu.purchaseId &&
    s.purchases.some((p) => p.id === hu.purchaseId) &&
    ![
      "STORED",
      "DELIVERED",
      "IN_TRANSIT",
      "WRITTEN_OFF",
      "RETURNED_SUPPLIER",
    ].includes(hu.state)
  );
}
function evidence(s, hu) {
  const purchase = s.purchases.find((p) => p.id === hu.purchaseId),
    supplier = s.catalog.suppliers.find((p) => p.id === purchase.supplierId),
    sku = s.catalog.skus.find((p) => p.id === hu.skuId);
  const bill = s.finance.bills.find(
      (b) => b.purchaseId === purchase.id && !b.cancelledAt,
    ),
    line = bill?.lines?.find((l) => l.skuId === hu.skuId);
  // Allocate the original line's rounded tax across disjoint claims without
  // rounding each box independently or allowing total credits above the line.
  const prior = s.supplierClaims
    .filter((c) => c.billId === bill?.id && c.skuId === hu.skuId)
    .reduce((n, c) => n + c.cases, 0);
  const tax = line
    ? Math.round((line.taxCents * (prior + hu.cases)) / line.cases) -
      Math.round((line.taxCents * prior) / line.cases)
    : 0;
  const net = line ? line.caseUnitNetCents * hu.cases : 0;
  if (line && prior + hu.cases > line.cases)
    problem(
      "Las cajas reclamadas superan la cantidad facturada del producto.",
      409,
    );
  return {
    huId: hu.id,
    purchaseId: purchase.id,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierLogo: supplier.logoUrl || "",
    recipient: supplier.email || "",
    skuId: sku.id,
    productName: sku.name,
    imageUrl: sku.imageUrl || "",
    lot: hu.lot,
    expiry: hu.expiry,
    cases: hu.cases,
    defect: hu.packagingDefect,
    defectLabel: defectLabel(hu.packagingDefect),
    receiptId: hu.receiptId || null,
    inspectionId: hu.inspectionId || null,
    sourceSscc: hu.sourceSscc || null,
    billId: bill?.id || null,
    invoiceReference: bill?.reference || null,
    netCents: net,
    taxCents: tax,
    claimableCents: net + tax,
  };
}
function refresh(claim, s, actor) {
  claim.updatedAt = s.clock.now;
  claim.updatedBy = actor.id;
  claim.revision++;
  claim.state =
    claim.physicalResolution && claim.settlement
      ? "CLOSED"
      : claim.physicalResolution
        ? "AWAITING_SETTLEMENT"
        : claim.response
          ? "AWAITING_DISPOSITION"
          : "AWAITING_RESPONSE";
}
function supplierClaimCommand(s, type, p, actor, ctx) {
  const { id, event, newMission, buffered } = ctx;
  const record = (claim, action, detail) => {
    claim.history.push({ at: s.clock.now, actorId: actor.id, action, detail });
    refresh(claim, s, actor);
    event(s, `SUPPLIER_CLAIM_${action}`, `${claim.id}: ${detail}`, {
      claimId: claim.id,
      huId: claim.huId,
      purchaseId: claim.purchaseId,
      actorId: actor.id,
    });
  };
  if (type === "supplierClaim.report") {
    const hu = s.hus.find((h) => h.id === p.huId);
    if (!damagedCandidate(s, hu))
      problem(
        "Selecciona cajas dañadas retenidas de una recepción de proveedor.",
        409,
      );
    if (s.supplierClaims.some((c) => c.huId === hu.id))
      problem(
        "Estas cajas ya tienen una reclamación. Abre su expediente.",
        409,
      );
    if (p.cases !== hu.cases)
      problem(
        "La cantidad retenida cambió. Actualiza la recepción antes de reportar.",
        409,
      );
    const note = p.note ? text(p.note, "Observación", 3) : "";
    const claim = {
      id: id(s, "RCL"),
      ...evidence(s, hu),
      note,
      createdAt: s.clock.now,
      createdBy: actor.id,
      revision: 0,
      history: [],
      response: null,
      physicalResolution: null,
      settlement: null,
      notification: { status: "QUEUED", attempts: 0 },
    };
    if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(claim.recipient))
      Object.assign(claim.notification, {
        status: "CONTACT_REQUIRED",
        error:
          "Administración debe registrar el correo del proveedor para notificar.",
      });
    s.supplierClaims.push(claim);
    record(
      claim,
      "REPORTED",
      `${claim.cases} cajas de ${claim.productName}, lote ${claim.lot}: ${claim.defectLabel}. Notificación pendiente a ${claim.recipient}.`,
    );
    return { id: claim.id };
  }
  const claim = s.supplierClaims.find((c) => c.id === p.id);
  if (!claim) problem("La reclamación no existe.", 404);
  if (p.revision !== claim.revision)
    problem(
      "El expediente cambió. Revisa su estado actualizado antes de continuar.",
      409,
    );
  const hu = s.hus.find((h) => h.id === claim.huId);
  const safe = (location, expectedState = "QUARANTINE") => {
    if (
      !hu ||
      hu.cases !== claim.cases ||
      hu.reservedCases ||
      hu.state !== expectedState ||
      hu.locationId !== location ||
      s.robots.some((r) => r.carryingHuId === hu.id) ||
      s.missions.some((m) => m.huId === hu.id && !CLOSED.has(m.state))
    )
      problem(
        "La carga debe estar depositada y libre de misiones o reservas. Espera su llegada segura.",
        409,
      );
  };
  if (type === "supplierClaim.retry") {
    if (
      ![
        "QUEUED",
        "FAILED",
        "UNKNOWN",
        "SIMULATED",
        "CONTACT_REQUIRED",
      ].includes(claim.notification.status)
    )
      problem(
        "No hay un envío fallido o pendiente de verificar que reintentar.",
        409,
      );
    if (
      claim.notification.status === "UNKNOWN" &&
      p.confirmDuplicateRisk !== true
    )
      problem(
        "Confirma que verificaste el envío anterior para evitar un correo duplicado.",
        422,
      );
    const supplier = s.catalog.suppliers.find((r) => r.id === claim.supplierId);
    const recipient = supplier?.email || "";
    if (!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(recipient))
      problem("Corrige el correo del proveedor antes de reintentar.", 422);
    Object.assign(claim.notification, { status: "QUEUED", error: null });
    claim.recipient = recipient;
    record(claim, "NOTIFICATION_QUEUED", `Reenvío solicitado a ${recipient}.`);
    return { id: claim.id };
  }
  if (type === "supplierClaim.respond") {
    if (
      claim.response ||
      claim.physicalResolution ||
      claim.returnMissionId ||
      claim.returnPreparedAt
    )
      problem("La respuesta ya está registrada y no puede sustituirse.", 409);
    if (!["RETURN", "DISPOSE", "REJECTED"].includes(p.decision))
      problem("Selecciona la disposición comunicada por el proveedor.", 422);
    if (
      p.decision === "RETURN" &&
      ["LIQUID_LEAK", "WET_LEAK"].includes(claim.defect)
    )
      problem(
        "El derrame requiere contención: registra autorización de baja o rechazo de la reclamación, no una devolución ordinaria.",
        409,
      );
    claim.response = {
      decision: p.decision,
      reference: text(p.reference, "Referencia de respuesta", 5, 100),
      note: p.note ? text(p.note, "Detalle", 3) : "",
      at: s.clock.now,
      actorId: actor.id,
    };
    record(
      claim,
      "RESPONSE_RECORDED",
      `Respuesta del proveedor: ${p.decision === "RETURN" ? "devolución autorizada" : p.decision === "DISPOSE" ? "baja autorizada" : "reclamación rechazada"} · ${claim.response.reference}.`,
    );
    return { id: claim.id };
  }
  if (type === "supplierClaim.prepareReturn") {
    if (
      claim.response?.decision !== "RETURN" ||
      claim.physicalResolution ||
      claim.returnMissionId ||
      claim.returnPreparedAt
    )
      problem(
        "Se necesita una devolución autorizada sin preparar previamente.",
        409,
      );
    safe(hu?.locationId);
    if (!/^Q(?:-|$)/.test(hu.locationId))
      problem("La carga debe estar en cuarentena.", 409);
    if (claim.defect === "LIQUID_LEAK" || claim.defect === "WET_LEAK")
      problem(
        "Una carga con derrame requiere contención y baja documentada; no puede circular por recepción como devolución ordinaria.",
        409,
      );
    const zone = s.catalog.skus.find((x) => x.id === hu.skuId).zoneId;
    if (["COLD", "FROZEN", "CLEANING"].includes(zone)) {
      claim.returnPreparedAt = s.clock.now;
      claim.returnPickupLocation = hu.locationId;
      hu.state = "SUPPLIER_RETURN_READY";
      record(
        claim,
        "RETURN_READY",
        "Recogida segregada desde cuarentena compatible; se conserva temperatura o separación química hasta la entrega.",
      );
      return { id: claim.id };
    }
    if (
      buffered(s, "RECEIVE") +
        s.missions.filter(
          (m) => m.destinationId === "RECEIVE" && !CLOSED.has(m.state),
        ).length >=
      12
    )
      problem(
        "Recepción no tiene una plaza libre para la devolución. Reintenta cuando se libere espacio.",
        409,
      );
    const mission = newMission(s, {
      kind: "SUPPLIER_RETURN",
      huId: hu.id,
      cases: hu.cases,
      sourceId: hu.locationId,
      destinationId: "RECEIVE",
      deviceType: "AMR",
      zoneId: s.catalog.skus.find((x) => x.id === hu.skuId).zoneId,
      supplierClaimId: claim.id,
      priority: "NORMAL",
    });
    claim.returnMissionId = mission.id;
    hu.state = "WAITING_SUPPLIER_RETURN";
    record(
      claim,
      "RETURN_REQUESTED",
      `Traslado autónomo ${mission.id} a recepción; mercancía segregada y bloqueada.`,
    );
    return { id: claim.id };
  }
  if (type === "supplierClaim.handover" || type === "supplierClaim.dispose") {
    if (claim.physicalResolution)
      problem("La salida física ya está documentada.", 409);
    const returning = type.endsWith(".handover");
    if (returning) {
      if (
        claim.response?.decision !== "RETURN" ||
        (!claim.returnMissionId && !claim.returnPreparedAt)
      )
        problem("Prepara la devolución autorizada primero.", 409);
      safe(claim.returnPickupLocation || "RECEIVE", "SUPPLIER_RETURN_READY");
      if (claim.returnPickupLocation && p.confirmConservation !== true)
        problem(
          "Confirma que la recogida mantiene conservación y separación compatibles.",
          422,
        );
    } else {
      const decision = claim.response?.decision;
      if (
        decision !== "DISPOSE" &&
        !(decision === "REJECTED" && claim.settlement?.kind === "LOSS") &&
        !(
          decision === "RETURN" &&
          ["LIQUID_LEAK", "WET_LEAK"].includes(claim.defect) &&
          claim.settlement?.kind === "LOSS"
        )
      )
        problem(
          "Registra una baja autorizada por el proveedor o la aceptación administrativa de la pérdida tras el rechazo.",
          409,
        );
      safe(hu?.locationId);
      if (!/^Q(?:-|$)/.test(hu.locationId))
        problem("La baja requiere depósito seguro en cuarentena.", 409);
    }
    if (p.confirm !== true)
      problem(
        "Confirma la entrega física documentada. No se elimina stock por una intención de retirada.",
        422,
      );
    const reference = text(
      p.reference,
      returning ? "Acta o guía de recogida" : "Acta de retirada de residuos",
      5,
      100,
    );
    const party = text(
      p.party,
      returning ? "Transportista que recoge" : "Gestor que retira los residuos",
      3,
      120,
    );
    claim.physicalResolution = {
      kind: returning ? "RETURN" : "DISPOSAL",
      cases: hu.cases,
      reference,
      party,
      at: s.clock.now,
      actorId: actor.id,
      locationId: hu.locationId,
    };
    if (returning) s.ledger.supplierReturnedCases += hu.cases;
    else s.ledger.writtenOffCases += hu.cases;
    hu.cases = 0;
    hu.state = returning ? "RETURNED_SUPPLIER" : "WRITTEN_OFF";
    hu.supplierClaimId = claim.id;
    hu.closedAt = s.clock.now;
    if (returning) hu.returnedToSupplierAt = s.clock.now;
    else {
      hu.writtenOffAt = s.clock.now;
      hu.writeOffReason = `Reclamación ${claim.id}: retirada ${reference} por ${party}.`;
    }
    record(
      claim,
      returning ? "RETURNED" : "DISPOSED",
      `${claim.cases} cajas entregadas a ${party} · ${reference}.`,
    );
    return { id: claim.id };
  }
  if (type === "supplierClaim.settle") {
    if (claim.settlement)
      problem("La resolución económica ya está registrada.", 409);
    if (!claim.response)
      problem("Registra primero la respuesta del proveedor.", 409);
    if (!["CREDIT", "LOSS"].includes(p.kind))
      problem("Selecciona nota de crédito o pérdida asumida.", 422);
    const reference = text(
      p.reference,
      p.kind === "CREDIT"
        ? "Nota de crédito recibida"
        : "Motivo de pérdida asumida",
      p.kind === "CREDIT" ? 5 : 12,
      120,
    );
    if (p.kind === "CREDIT") {
      const bill = s.finance.bills.find(
        (b) => b.id === claim.billId && !b.cancelledAt,
      );
      if (!bill || !claim.claimableCents)
        problem(
          "No hay factura valorada que permita conciliar esta reclamación.",
          409,
        );
      if (
        s.finance.creditNotes.some(
          (c) =>
            c.supplierId === claim.supplierId &&
            c.reference.toUpperCase() === reference.toUpperCase(),
        )
      )
        problem("La nota de crédito del proveedor ya está registrada.", 409);
      if (
        !Number.isSafeInteger(p.amountCents) ||
        p.amountCents < 1 ||
        p.amountCents > claim.claimableCents
      )
        problem(
          "El abono debe ser positivo y no superar el importe de las cajas reclamadas.",
          422,
        );
      if (p.amountCents < claim.claimableCents && p.acceptDifference !== true)
        problem("Confirma la diferencia no compensada por el proveedor.", 422);
      const credited = s.finance.creditNotes
        .filter((c) => c.billId === bill.id)
        .reduce((n, c) => n + c.amountCents, 0);
      if (credited + p.amountCents > bill.totalCents)
        problem("El abono acumulado supera la factura.", 409);
      const credit = {
        id: id(s, "NC"),
        claimId: claim.id,
        billId: bill.id,
        supplierId: claim.supplierId,
        reference,
        amountCents: p.amountCents,
        at: s.clock.now,
        actorId: actor.id,
      };
      s.finance.creditNotes.push(credit);
      claim.settlement = {
        kind: "CREDIT",
        creditNoteId: credit.id,
        amountCents: p.amountCents,
        uncompensatedCents: claim.claimableCents - p.amountCents,
        reference,
        at: s.clock.now,
        actorId: actor.id,
      };
    } else {
      if (p.confirm !== true)
        problem("Confirma la pérdida asumida sin abono del proveedor.", 422);
      claim.settlement = {
        kind: "LOSS",
        amountCents: 0,
        uncompensatedCents: claim.claimableCents,
        reference,
        at: s.clock.now,
        actorId: actor.id,
      };
    }
    record(
      claim,
      "SETTLED",
      `${p.kind === "CREDIT" ? "Nota de crédito registrada" : "Pérdida aceptada"} · ${reference}. La salida física se controla por separado.`,
    );
    return { id: claim.id };
  }
  problem("Acción de reclamación desconocida.", 404);
}
function supplierClaimsReadModel(s, actor) {
  if (!can(actor, "supplierClaim.read")) return { claims: [], candidates: [] };
  const claimed = new Set(s.supplierClaims.map((c) => c.huId));
  return {
    claims: [...s.supplierClaims].reverse().map((c) => ({
      ...c,
      huState: s.hus.find((h) => h.id === c.huId)?.state,
      locationId: s.hus.find((h) => h.id === c.huId)?.locationId,
    })),
    candidates: s.hus
      .filter((h) => damagedCandidate(s, h) && !claimed.has(h.id))
      .map((h) => ({
        ...evidence(s, h),
        huState: h.state,
        locationId: h.locationId,
      })),
  };
}
module.exports = {
  migrateSupplierClaims,
  supplierClaimCommand,
  supplierClaimsReadModel,
};
