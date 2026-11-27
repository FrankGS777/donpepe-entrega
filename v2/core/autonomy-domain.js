"use strict";
const { createHash } = require("node:crypto");
const { problem } = require("./validation");
const { limaDate, addLimaDays } = require("./time");
const { automaticEquipmentStatus } = require("./autonomy-config");
const { can } = require("../security/policy");
const { INBOUND_STAGE_ASSET } = require("./automation-blueprint");
const { autonomyMapFrame, stageDuration } = require("./autonomy-map");
const { MECHANICAL_TIMING_VERSION, SUPPLIER_APPROACH_SECONDS } = require("./mechanical-timing");
const { defectForProduct, damagedCaseCount } = require("./packaging-quality");

const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
const ACTOR = "AUTONOMY-ORCHESTRATOR";
const STATIONS = INBOUND_STAGE_ASSET;
const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const temperatureRange = (zone) =>
  zone === "COLD"
    ? { min: 2, max: 6 }
    : zone === "FROZEN"
      ? { min: -35, max: -18 }
      : null;
const ssccFor = (serial) => {
  const body = `0000001${String(serial).padStart(10, "0")}`;
  const sum = [...body]
    .reverse()
    .reduce((n, digit, i) => n + Number(digit) * (i % 2 ? 1 : 3), 0);
  return body + ((10 - (sum % 10)) % 10);
};
const validSscc = (value) =>
  typeof value === "string" &&
  /^\d{18}$/.test(value) &&
  ssccFor(Number(value.slice(7, 17))) === value;
function migrateAutonomy(s) {
  if (s.autonomy) {
    let changed = false;
    const notices = new Map(s.autonomy.notices.map(notice => [notice.id, notice]));
    for (const job of s.autonomy.jobs) {
      if (job.kind === "PURCHASE" && job.state === "CANCELLED") {
        changed = closeInboundNotice(notices.get(job.noticeId), job.updatedAt || s.clock.now) || changed;
      }
    }
    return changed;
  }
  // Intentionally do not enroll old documents: deploying software is not an
  // authorization to accept loads, dispatch trucks or confirm old deliveries.
  s.autonomy = {
    version: 1,
    activatedAt: s.clock.now,
    jobs: [],
    notices: [],
    evidence: [],
    exceptions: [],
    nextLoadSerial: 0,
  };
  return true;
}
function transition(s, job, state, stage = state) {
  // Only a newly entered receipt adopts this cadence. A saved receipt already
  // in progress retains its witnessed duration and inventory handoff time.
  if (state === "DESTINATION_RECEIVING" && job.state !== state && !(job.state === "EXCEPTION" && (job.blockedState || job.blockedStage) === state)) job.storeHandlingVersion = 1;
  if (job.state !== state || job.stage !== stage) {
    job.state = state;
    job.stage = stage;
    job.stageElapsed = 0;
    job.revision++;
    job.updatedAt = s.clock.now;
  }
  job.waitingReason = null;
}
function releaseDevices(s, job) {
  for (const device of s.autonomyDevices || [])
    if (device.processId === job.id) {
      // A case-picking cell retains physical custody until its split is complete.
      // Reevaluating its job must not expose a loaded cell as free to another job.
      if (device.type === "CASE_PICKING_CELL" && device.carryingHuId) continue;
      device.processId = null;
      device.reservationId = null;
      if (device.state === "RESERVED") device.state = "IDLE";
    }
}
function cancelInboundProcess(s, job, actor, reason) {
  releaseDevices(s, job);
  if (job.inboundDockAcquiredAt != null && job.inboundDockReleasedAt == null) job.inboundDockReleasedAt = s.clock.now;
  closeInboundNotice(s.autonomy.notices.find((row) => row.id === job.noticeId), s.clock.now);
  const exception = s.autonomy.exceptions.find((row) => row.id === job.exceptionId && row.state === "OPEN");
  if (exception) Object.assign(exception, { state: "RESOLVED", resolvedAt: s.clock.now, resolvedBy: actor.id, reason });
  transition(s, job, "CANCELLED");
}
function closeInboundNotice(notice, at) {
  if (!notice) return false;
  let changed = notice.state !== "CANCELLED";
  notice.state = "CANCELLED";
  for (const load of notice.loads) {
    if (load.state !== "RECEIVED" && load.state !== "CANCELLED") { load.state = "CANCELLED"; changed = true; }
    if (load.bufferReservation && !load.bufferReservation.releasedAt) { load.bufferReservation.releasedAt = at; changed = true; }
  }
  return changed;
}
function exception(s, job, code, message, context) {
  if (job.state === "EXCEPTION") return;
  const row = {
    id: context.id(s, "AEX"),
    jobId: job.id,
    documentId: job.documentId,
    code,
    message,
    state: "OPEN",
    createdAt: s.clock.now,
    previousState: job.state,
    previousStage: job.stage,
  };
  s.autonomy.exceptions.push(row);
  job.blockedState = job.state;
  job.blockedStage = job.stage;
  // Preserve the exact witnessed phase when an interlock stops a load. The
  // presentation must hold here instead of restarting its animation at zero.
  job.blockedStageElapsed = job.stageElapsed || 0;
  transition(s, job, "EXCEPTION");
  job.exceptionId = row.id;
  job.waitingReason = message;
  context.event(s, "AUTONOMY_EXCEPTION", message, {
    jobId: job.id,
    [job.kind === "PURCHASE" ? "purchaseId" : "orderId"]: job.documentId,
    exceptionId: row.id,
    evidenceIds: [...job.evidenceIds],
    actorId: ACTOR,
  });
}
function reserve(s, job, assetId, context) {
  const registered = s.catalog.assets.find((row) => row.id === assetId),
    held = s.autonomyDevices?.find((row) => row.id === registered?.deviceId);
  if (held?.processId && held.processId !== job.id) {
    job.waitingReason = "La estación está ejecutando otra unidad de carga.";
    return null;
  }
  const status = automaticEquipmentStatus(s, assetId, { processId: job.id }),
    device = s.autonomyDevices?.find((row) => row.id === status.deviceId);
  if (!status.ready) {
    exception(s, job, "EQUIPMENT_NOT_READY", status.reason, context);
    return null;
  }
  if (device.processId && device.processId !== job.id) {
    job.waitingReason = "La estación está ejecutando otra unidad de carga.";
    return null;
  }
  device.state = "RESERVED";
  device.processId = job.id;
  device.reservationId = job.id;
  device.heartbeatAt = s.clock.now;
  job.waitingReason = null;
  return s.catalog.assets.find((row) => row.id === status.assetId);
}
function evidence(s, job, load, asset, checkpoint, payload) {
  const id = `${job.id}:${load?.id || job.documentId}:${checkpoint}:${job.attempt}`;
  const existing = s.autonomy.evidence.find((row) => row.id === id);
  if (existing) {
    if (existing.payloadHash !== digest(payload))
      problem("La identidad del evento ya existe con otro contenido.", 409);
    return existing;
  }
  const row = {
    id,
    jobId: job.id,
    documentId: job.documentId,
    loadId: load?.id || null,
    deviceId: asset.deviceId,
    assetId: asset.id,
    checkpoint,
    type: {
      UNLOAD: "SAFETY",
      AUTO_ID: "IDENTIFICATION",
      PIE: "QUALITY",
      BRANCH_RECEIPT: "BRANCH_RECEIPT",
    }[checkpoint],
    source: "SIMULATED_DEVICE",
    mode: "SIMULATED",
    observedAt: s.clock.now,
    observedElapsed: s.clock.elapsed,
    payload: structuredClone(payload),
    payloadHash: digest(payload),
    decision: "PENDING",
  };
  s.autonomy.evidence.push(row);
  job.evidenceIds.push(id);
  return row;
}
/** Pure validation boundary for a future authenticated device adapter. A clock
 * transition alone is never a positive reading. The current adapter produces
 * explicitly simulated, correlated device events rather than claiming IoT. */
function validateTelemetry(s, job, load, reading, asset, checkpoint) {
  const errors = [];
  if (!asset?.deviceId || !asset.settings || !job?.policy) return ["UNKNOWN_DEVICE_OR_PROCESS"];
  if (!["UNLOAD", "AUTO_ID", "PIE", "BRANCH_RECEIPT"].includes(checkpoint)) return ["UNKNOWN_CHECKPOINT"];
  if (["UNLOAD", "AUTO_ID", "PIE"].includes(checkpoint) && !load) return ["MISSING_LOGISTIC_UNIT"];
  if (
    !reading ||
    reading.source !== "SIMULATED_DEVICE" ||
    reading.mode !== "SIMULATED"
  )
    return ["UNTRUSTED_SOURCE"];
  if (
    !reading.payload ||
    typeof reading.payload !== "object" ||
    Array.isArray(reading.payload)
  )
    return ["MISSING_PAYLOAD"];
  if (
    reading.jobId !== job.id ||
    reading.documentId !== job.documentId ||
    reading.deviceId !== asset.deviceId ||
    reading.checkpoint !== checkpoint ||
    (load && reading.loadId !== load.id)
  )
    errors.push("WRONG_CORRELATION");
  if (reading.payloadHash !== digest(reading.payload))
    errors.push("PAYLOAD_CHANGED");
  const age = s.clock.elapsed - reading.observedElapsed;
  const timestampAgeMs =
    Date.parse(s.clock.now) - Date.parse(reading.observedAt);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > job.policy.eventTimeoutSeconds ||
    !Number.isFinite(timestampAgeMs) ||
    timestampAgeMs < 0 ||
    timestampAgeMs > job.policy.eventTimeoutSeconds * 1000 ||
    // Accelerated simulated equipment still records the actual wall-clock
    // instant. Both ages must be fresh, but their scales are intentionally
    // different. Deterministic fixtures retain the strict clock consistency.
    (s.clock.timeBasis !== "WALL_CLOCK" && Math.abs(timestampAgeMs - age * 1000) > 1000)
  )
    errors.push("STALE_EVENT");
  if (s.autonomy.evidence.filter((row) => row.id === reading.id).length !== 1)
    errors.push("DUPLICATE_EVENT");
  const p = reading.payload || {};
  if (load && ["AUTO_ID", "PIE"].includes(checkpoint)) {
    if (
      !validSscc(load.sscc) ||
      p.sscc !== load.sscc ||
      p.skuId !== load.skuId ||
      p.barcode !== load.barcode ||
      p.lot !== load.lot ||
      p.expiry !== load.expiry ||
      p.cases !== load.cases
    )
      errors.push("ASN_MISMATCH");
    if (
      !load.lot ||
      typeof load.lot !== "string" ||
      !Number.isInteger(load.cases) ||
      load.cases <= 0
    )
      errors.push("MISSING_IDENTITY");
    if (
      s.autonomy.notices.some((notice) =>
        notice.loads.some(
          (other) => other.id !== load.id && other.sscc === load.sscc,
        ),
      )
    )
      errors.push("DUPLICATE_SSCC");
  }
  if (
    checkpoint === "UNLOAD" &&
    (p.vehicleRestrained !== true ||
      p.levelerReady !== true ||
      p.transferAreaClear !== true ||
      p.supportedLoad !== true)
  )
    errors.push("SAFETY_INTERLOCK");
  if (
    ["AUTO_ID", "BRANCH_RECEIPT"].includes(checkpoint) &&
    (!Number.isFinite(p.acquisitionSeconds) ||
      p.acquisitionSeconds < 0 ||
      p.acquisitionSeconds > asset.settings.readTimeoutSeconds)
  )
    errors.push("READ_TIMEOUT");
  if (checkpoint === "PIE") {
    const profile = load.profile,
      observed = p.profile;
    if (
      !profile ||
      profile.source !== "SIMULATED_SUPPLIER_PROFILE" ||
      !observed ||
      ![
        profile.weightKg,
        profile.widthM,
        profile.depthM,
        profile.heightM,
        observed.weightKg,
        observed.widthM,
        observed.depthM,
        observed.heightM,
      ].every((n) => typeof n === "number" && Number.isFinite(n) && n > 0)
    )
      errors.push("MISSING_PHYSICAL_PROFILE");
    else {
      if (
        observed.weightKg > asset.capacityKg ||
        load.cases > asset.capacityCases ||
        observed.widthM > 1.2 ||
        observed.depthM > 1.0 ||
        observed.heightM > 1.8 ||
        p.palletType !== "EUR_COMPATIBLE"
      )
        errors.push("PHYSICAL_ENVELOPE");
      if (
        (Math.abs(observed.weightKg - profile.weightKg) / profile.weightKg) *
          100 >
        Math.min(
          job.policy.weightTolerancePercent,
          asset.settings.weightTolerancePercent,
        )
      )
        errors.push("WEIGHT_MISMATCH");
    }
    if (Array.isArray(load.damagedCaseIndexes)) {
      const checked = p.damagedCaseIndexes;
      if (!Array.isArray(checked) || checked.length !== damagedCaseCount(load) ||
          checked.some((index, i) => !Number.isInteger(index) || index < 0 || index >= load.cases ||
            index !== load.damagedCaseIndexes[i] || checked.indexOf(index) !== i) ||
          p.damagedCases !== checked.length || (p.visualDefect || null) !== (load.packagingDefect || null) ||
          p.packaging !== (checked.length ? "DAMAGED" : "OK"))
        errors.push("DAMAGE_COUNT_MISMATCH");
    }
    if (p.packaging !== "OK" || p.pallet !== "OK" || p.label !== "OK")
      errors.push("VISIBLE_QUALITY_HOLD");
    const sku = s.catalog.skus.find((row) => row.id === load.skuId),
      range = temperatureRange(sku?.zoneId);
    if (
      !sku ||
      (sku.expiryControlled &&
        (!load.expiry ||
          !/^\d{4}-\d{2}-\d{2}$/.test(load.expiry) ||
          !Number.isFinite(Date.parse(load.expiry)) ||
          new Date(`${load.expiry}T00:00:00Z`).toISOString().slice(0, 10) !==
            load.expiry ||
          load.expiry <
            addLimaDays(s.clock.now, s.configuration.settings.minShelfLifeDays)))
    )
      errors.push("SHELF_LIFE_HOLD");
    if (
      range &&
      (typeof p.temperatureC !== "number" ||
        !Number.isFinite(p.temperatureC) ||
        p.temperatureC < range.min ||
        p.temperatureC > range.max)
    )
      errors.push("TEMPERATURE_HOLD");
  }
  if (checkpoint === "BRANCH_RECEIPT") {
    const order = s.orders.find((row) => row.id === job.documentId);
    if (
      !order ||
      p.branchId !== order.branchId ||
      p.truckId !== order.truckId ||
      p.secureBuffer !== true ||
      p.vehicleRestrained !== true ||
      !Array.isArray(p.loads) ||
      p.loads.length !== order.allocations.length
    )
      errors.push("DELIVERY_MISMATCH");
    else
      for (const allocation of order.allocations) {
        const hu = s.hus.find((row) => row.id === allocation.huId),
          actual = p.loads.find((row) => row.huId === allocation.huId),
          sku = s.catalog.skus.find((row) => row.id === allocation.skuId),
          range = temperatureRange(sku?.zoneId);
        if (
          !hu ||
          !actual ||
          actual.cases !== allocation.cases ||
          actual.cases !== hu.cases ||
          actual.lot !== hu.lot ||
          actual.expiry !== hu.expiry ||
          hu.locationId !== order.truckId
        )
          errors.push("DELIVERY_MISMATCH");
        if (
          actual &&
          range &&
          (typeof actual.temperatureC !== "number" ||
            !Number.isFinite(actual.temperatureC) ||
            actual.temperatureC < range.min ||
            actual.temperatureC > range.max)
        )
          errors.push("TEMPERATURE_HOLD");
        if (hu?.expiry && hu.expiry < limaDate(s.clock.now))
          errors.push("SHELF_LIFE_HOLD");
      }
  }
  return [...new Set(errors)];
}
function acceptEvidence(s, job, load, reading, asset, checkpoint, context) {
  const errors = validateTelemetry(s, job, load, reading, asset, checkpoint);
  if (checkpoint === "PIE" && load?.qualityHeld && reading?.payload?.visualDefect === load.packagingDefect) {
    const index = errors.indexOf("VISIBLE_QUALITY_HOLD");
    if (index >= 0) errors.splice(index, 1);
    reading.decision = "HOLD";
    reading.checks = ["VISIBLE_QUALITY_HOLD", "SEGREGATED_RECEIPT_ONLY"];
  }
  if (reading?.decision === "PENDING") {
    reading.decision = errors.length ? "HOLD" : "PASS";
    reading.checks = errors.length ? errors : ["IDENTITY_AND_POLICY_VERIFIED"];
  }
  if (errors.length) {
    exception(
      s,
      job,
      errors[0],
      `Proceso retenido: ${errors.join(", ")}. No se han aceptado existencias de esta carga.`,
      context,
    );
    return false;
  }
  return true;
}
function createNotice(s, purchase, job, context) {
  const notice = {
    id: context.id(s, "ASN"),
    purchaseId: purchase.id,
    supplierId: purchase.supplierId,
    source: "SIMULATED_SUPPLIER",
    mode: "SIMULATED",
    ssccScheme: "SIMULATED_SSCC18_NOT_GS1_LICENSED",
    state: "DECLARED",
    documentNumber: `ASN-${purchase.id}`,
    createdAt: s.clock.now,
    loads: [],
  };
  for (const line of purchase.lines) {
    const sku = s.catalog.skus.find((row) => row.id === line.skuId);
    let pending = line.cases - line.receivedCases;
    const expiry = sku.expiryControlled
      ? addLimaDays(s.clock.now, sku.zoneId === "COLD" ? 21 : 240)
      : null;
    while (pending > 0) {
      const cases = Math.min(pending, sku.maxCasesPerHu);
      pending -= cases;
      const serial = ++s.autonomy.nextLoadSerial;
      const sample = digest([purchase.id, serial, "packaging"]);
      const probability = (s.configuration.settings.packagingDamagePercent ?? 12) / 100;
      const hasDamage = parseInt(sample.slice(0, 8), 16) / 0x100000000 < probability;
      const maxAffected = Math.min(3, Math.max(1, cases - 1));
      const affected = hasDamage ? 1 + parseInt(sample.slice(8, 16), 16) % maxAffected : 0;
      // The exposed cartons are at the top of the indexed stack.
      const damagedCaseIndexes = Array.from({ length: affected }, (_, index) => cases - affected + index);
      notice.loads.push({
        id: `INLOAD-${String(serial).padStart(8, "0")}`,
        sscc: ssccFor(serial),
        lineId: line.id,
        skuId: sku.id,
        barcode: sku.barcode || sku.code,
        lot: `FAB-${purchase.supplierId}-${purchase.id}-${line.id}`,
        expiry,
        cases,
        state: "DECLARED",
        packagingDefect: affected ? defectForProduct(sku) : null,
        damagedCaseIndexes,
        profile: {
          source: "SIMULATED_SUPPLIER_PROFILE",
          palletType: "EUR_COMPATIBLE",
          widthM: 1.2,
          depthM: 1,
          heightM: 1.4,
          weightKg: cases * 10 + 25,
          note: "Perfil logístico declarado por el simulador del proveedor, no peso oficial del producto.",
        },
      });
    }
  }
  s.autonomy.notices.push(notice);
  job.noticeId = notice.id;
  job.loadIds = notice.loads.map((row) => row.id);
}
function authorizeAutonomy(
  s,
  kind,
  document,
  actor,
  context,
  legacyAdoption = false,
) {
  if (!can(actor, kind === "PURCHASE" ? "purchase.create" : "order.release"))
    problem(
      "Tu perfil no tiene la autorización de negocio necesaria para este tipo de proceso.",
      403,
    );
  const policy = s.configuration.autonomy;
  if (
    !policy.enabled ||
    (kind === "PURCHASE"
      ? !policy.inboundEnabled
      : !policy.outboundEnabled || !policy.storeReceivingEnabled)
  )
    problem(
      "La política no admite un nuevo ciclo autónomo completo de este tipo. Administración debe habilitar sus etapas antes de autorizarlo.",
      409,
    );
  if (
    s.autonomy.jobs.some(
      (job) =>
        job.kind === kind &&
        job.documentId === document.id &&
        !CLOSED.has(job.state),
    )
  )
    problem("Este documento ya tiene un proceso autónomo activo.", 409);
  const job = {
    id: context.id(s, "AUTO"),
    kind,
    documentId: document.id,
    branchId: kind === "ORDER" ? document.branchId : null,
    state: kind === "PURCHASE" ? "WAITING_ARRIVAL" : "PREPARING",
    stage: kind === "PURCHASE" ? "WAITING_ARRIVAL" : "PREPARING",
    revision: 1,
    createdAt: s.clock.now,
    updatedAt: s.clock.now,
    authorizedBy: actor.id,
    legacyAdoption,
    mechanicalTimingVersion: MECHANICAL_TIMING_VERSION,
    policy: structuredClone(s.configuration.autonomy),
    attempt: 0,
    stageElapsed: 0,
    loadIndex: 0,
    loadIds: [],
    evidenceIds: [],
    receiptIds: [],
    waitingReason: null,
  };
  s.autonomy.jobs.push(job);
  document.autonomyJobId = job.id;
  if (kind === "PURCHASE") createNotice(s, document, job, context);
  context.event(
    s,
    "AUTONOMY_AUTHORIZED",
    `${document.id}: ejecución autónoma autorizada${legacyAdoption ? " expresamente sobre trabajo anterior" : ""}.`,
    {
      jobId: job.id,
      [kind === "PURCHASE" ? "purchaseId" : "orderId"]: document.id,
      actorId: actor.id,
    },
  );
  return {
    id: job.id,
    jobId: job.id,
    documentId: document.id,
    revision: job.revision,
  };
}
function autonomyCommand(s, type, p, actor, context) {
  if (actor.role !== "operations")
    problem(
      "La autorización y reevaluación de procesos corresponden a Operaciones.",
      403,
    );
  if (type === "autonomy.authorize") {
    if (!["PURCHASE", "ORDER"].includes(p.kind))
      problem("Selecciona un tipo de documento válido.", 422);
    const document = (p.kind === "PURCHASE" ? s.purchases : s.orders).find(
      (row) => row.id === p.id,
    );
    if (!document) problem("El documento no existe.", 404);
    if (
      p.expectedRevision !== undefined &&
      p.expectedRevision !== (document.revision || 1)
    )
      problem(
        "El documento cambió en otra sesión; recarga antes de autorizar.",
        409,
      );
    if (
      !(
        p.kind === "PURCHASE"
          ? ["ORDERED", "ARRIVED", "PARTIAL"]
          : ["PREPARING", "READY", "LOADING", "DISPATCHED", "ARRIVED"]
      ).includes(document.state)
    )
      problem(
        "El estado del documento no permite incorporarlo a un proceso autónomo. Autoriza primero la preparación de pedidos pendientes.",
        409,
      );
    return authorizeAutonomy(s, p.kind, document, actor, context, true);
  }
  if (type === "autonomy.retry") {
    if (!can(actor, "incident.resolve"))
      problem(
        "Tu perfil no tiene permiso para reevaluar incidencias operativas.",
        403,
      );
    const job = s.autonomy.jobs.find((row) => row.id === p.id);
    if (!job) problem("El proceso autónomo no existe.", 404);
    if (p.expectedRevision !== undefined && p.expectedRevision !== job.revision)
      problem("El proceso cambió; recarga su estado.", 409);
    if (job.state !== "EXCEPTION")
      problem("Solo se reevalúan procesos retenidos.", 409);
    if (
      typeof p.reason !== "string" ||
      p.reason.trim().length < 10 ||
      p.reason.length > 500
    )
      problem(
        "Explica la medida correctiva con entre 10 y 500 caracteres.",
        422,
        { reason: "Indica una medida correctiva verificable." },
      );
    if (job.attempt >= job.policy.maxAutoRetries)
      problem(
        "Se agotaron las reevaluaciones autorizadas. Conserva la retención y revisa la infraestructura; no se permite una aceptación forzada.",
        409,
      );
    const row = s.autonomy.exceptions.find((row) => row.id === job.exceptionId);
    row.state = "RESOLVED";
    row.resolvedAt = s.clock.now;
    row.reason = p.reason.trim();
    row.resolvedBy = actor.id;
    job.attempt++;
    job.retryHistory ||= [];
    job.retryHistory.push({
      at: s.clock.now,
      actorId: actor.id,
      reason: p.reason.trim(),
      exceptionId: row.id,
    });
    let state = job.blockedState,
      stage = job.blockedStage;
    // A transfer retry must obtain fresh Auto-ID and PIE observations. It may
    // not reuse a missing/stale event or change the old event into a success.
    if (
      job.kind === "PURCHASE" &&
      ["IDENTIFYING", "INSPECTING", "RECEIVING"].includes(state)
    ) {
      state = "IDENTIFYING";
      stage = state;
    }
    releaseDevices(s, job);
    transition(s, job, state, stage);
    delete job.exceptionId;
    context.event(
      s,
      "AUTONOMY_RETRIED",
      `${job.documentId}: se reevalúan las comprobaciones sin eliminar lecturas anteriores.`,
      { jobId: job.id, actorId: actor.id, exceptionId: row.id },
    );
    return {
      id: job.id,
      jobId: job.id,
      state: job.state,
      revision: job.revision,
    };
  }
  problem("Acción autónoma desconocida.", 404);
}
function tickPurchase(s, job, seconds, context) {
  const purchase = s.purchases.find((row) => row.id === job.documentId),
    notice = s.autonomy.notices.find((row) => row.id === job.noticeId);
  if (!purchase || purchase.state === "CANCELLED") {
    releaseDevices(s, job);
    if (job.inboundDockAcquiredAt != null && job.inboundDockReleasedAt == null) job.inboundDockReleasedAt = s.clock.now;
    transition(s, job, "CANCELLED");
    return;
  }
  if (job.state === "WAITING_ARRIVAL") {
    if (purchase.state === "ORDERED") return;
    transition(s, job, "WAITING_DOCK");
  }
  if (job.state === "PUTAWAY") {
    if (job.handlingVersion >= 2 && job.inboundDockReleasedAt == null) {
      job.departureStartedElapsed ??= s.clock.elapsed;
      if (s.clock.elapsed - job.departureStartedElapsed < 5) return;
      job.inboundDockReleasedAt = s.clock.now;
    }
    const loads = s.hus.filter(
      (row) =>
        row.purchaseId === purchase.id &&
        job.receiptIds.includes(row.receiptId),
    );
    if (
      loads.length &&
      loads.every(
        (row) =>
          ["STORED", "EMPTY", "DELIVERED", "QUARANTINE"].includes(row.state) ||
          row.cases === 0,
      )
    ) {
      transition(s, job, "COMPLETED");
      notice.state = "RECEIVED";
      context.event(
        s,
        "AUTONOMY_COMPLETED",
        `${purchase.id}: identificación, recepción y almacenamiento completados.`,
        {
          jobId: job.id,
          purchaseId: purchase.id,
          evidenceIds: [...job.evidenceIds],
          actorId: ACTOR,
        },
      );
    } else
      job.waitingReason =
        "Las misiones automáticas de almacenamiento conservan la carga hasta alcanzar una ubicación compatible.";
    return;
  }
  const load = notice.loads[job.loadIndex];
  if (!load) {
    releaseDevices(s, job);
    transition(s, job, "PUTAWAY");
    return;
  }
  if (job.state === "WAITING_DOCK") {
    // The receiving annex has one compatible supplier trailer berth. A truck
    // retains it until all its declared loads have left its receiving line.
    // Already-running documents without this additive field remain owners;
    // deployment must not relocate their loads or change their document IDs.
    const dockOwner = s.autonomy.jobs.find((other) => other.id !== job.id && other.kind === "PURCHASE" && !CLOSED.has(other.state) &&
      ((other.inboundDockAcquiredAt != null && other.inboundDockReleasedAt == null) ||
        (other.inboundDockAcquiredAt == null && Boolean(STATIONS[other.state === "EXCEPTION" ? other.blockedState : other.state]))));
    if (dockOwner) {
      job.waitingReason = "El muelle de proveedor está ocupado; el camión espera fuera del área de transferencia.";
      return;
    }
    if (!context.canReceive(s, job)) {
      job.waitingReason =
        "El buffer de recepción está lleno; la unidad permanece identificada en el camión del proveedor.";
      return;
    }
    if (job.inboundDockAcquiredAt == null) {
      job.inboundDockAcquiredAt = s.clock.now;
      job.arrivalStartedElapsed = s.clock.elapsed;
      job.arrivalDuration = job.mechanicalTimingVersion >= 2 ? SUPPLIER_APPROACH_SECONDS : 6;
      job.handlingVersion = 2;
    }
    if (job.handlingVersion >= 2 && s.clock.elapsed - job.arrivalStartedElapsed < job.arrivalDuration) {
      job.waitingReason = "Camión de proveedor en aproximación y acoplamiento al muelle.";
      return;
    }
    load.bufferReservation ||= {
      stationId: "RECEIVE",
      jobId: job.id,
      reservedAt: s.clock.now,
      releasedAt: null,
    };
    transition(s, job, "UNLOADING");
    if (job.mechanicalTimingVersion >= 2) return;
  }
  const assetId = STATIONS[job.state];
  if (!assetId) return;
  const asset = reserve(s, job, assetId, context);
  if (!asset) return;
  const duration = stageDuration(s, job);
  job.stageElapsed += seconds;
  if (job.stageElapsed < duration) return;
  const identity = {
    sscc: load.sscc,
    skuId: load.skuId,
    barcode: load.barcode,
    lot: load.lot,
    expiry: load.expiry,
    cases: load.cases,
  };
  if (job.state === "UNLOADING") {
    const reading = evidence(s, job, load, asset, "UNLOAD", {
      vehicleRestrained: true,
      levelerReady: true,
      transferAreaClear: true,
      supportedLoad: true,
    });
    if (!acceptEvidence(s, job, load, reading, asset, "UNLOAD", context))
      return;
    load.state = "UNLOADED";
    releaseDevices(s, job);
    transition(s, job, "IDENTIFYING");
  } else if (job.state === "IDENTIFYING") {
    const reading = evidence(s, job, load, asset, "AUTO_ID", {
      ...identity,
      // The conveyor's approach through Auto-ID does not consume the scan timeout.
      acquisitionSeconds: job.mechanicalTimingVersion >= 2 ? job.policy.identifySeconds : job.stageElapsed,
    });
    if (!acceptEvidence(s, job, load, reading, asset, "AUTO_ID", context))
      return;
    load.state = "IDENTIFIED";
    releaseDevices(s, job);
    transition(s, job, "INSPECTING");
  } else if (job.state === "INSPECTING") {
    const sku = s.catalog.skus.find((row) => row.id === load.skuId),
      range = temperatureRange(sku?.zoneId);
    const reading = evidence(s, job, load, asset, "PIE", {
      ...identity,
      profile: structuredClone(load.profile),
      palletType: load.profile?.palletType,
      packaging: load.packagingDefect ? "DAMAGED" : "OK",
      visualDefect: load.packagingDefect || null,
      damagedCases: damagedCaseCount(load),
      ...(load.damagedCaseIndexes && { damagedCaseIndexes: [...load.damagedCaseIndexes] }),
      vision: { cameras: "TOP_AND_SIDES", illumination: "CONTROLLED", result: load.packagingDefect ? "REJECT" : "PASS" },
      pallet: "OK",
      label: "OK",
      temperatureC: range ? (range.min + range.max) / 2 : null,
      scope:
        "CONTROLS_OF_VISIBLE_PACKAGING_AND_DECLARED_LOGISTIC_PROFILE_NOT_LABORATORY_FOOD_SAFETY",
    });
    const qualityErrors = validateTelemetry(s, job, load, reading, asset, "PIE");
    if (load.packagingDefect && qualityErrors.length === 1 && qualityErrors[0] === "VISIBLE_QUALITY_HOLD") load.qualityHeld = true;
    if (!acceptEvidence(s, job, load, reading, asset, "PIE", context)) return;
    load.state = "VERIFIED";
    releaseDevices(s, job);
    transition(s, job, "RECEIVING");
  } else if (job.state === "RECEIVING") {
    const held = load.qualityHeld ? damagedCaseCount(load) : 0;
    const split = held > 0 && held < load.cases;
    if (!context.canReceive(s, job, split ? 2 : 1)) {
      job.waitingReason = split
        ? "La recepción espera dos plazas libres para separar las cajas conformes de las retenidas."
        : "La transferencia espera una plaza libre del buffer de recepción.";
      return;
    }
    const identityReading = s.autonomy.evidence.find(
        (row) => row.id === `${job.id}:${load.id}:AUTO_ID:${job.attempt}`,
      ),
      qualityReading = s.autonomy.evidence.find(
        (row) => row.id === `${job.id}:${load.id}:PIE:${job.attempt}`,
      );
    const autoId = s.catalog.assets.find(
        (row) => row.id === STATIONS.IDENTIFYING,
      ),
      pie = s.catalog.assets.find((row) => row.id === STATIONS.INSPECTING);
    if (
      !acceptEvidence(
        s,
        job,
        load,
        identityReading,
        autoId,
        "AUTO_ID",
        context,
      ) ||
      !acceptEvidence(s, job, load, qualityReading, pie, "PIE", context)
    )
      return;
    if(load.qualityHeld && context.canReceiveQuality && !context.canReceiveQuality(s,load)) { job.waitingReason="La zona de cuarentena está completa; la carga permanece soportada en la recepción segregada."; return; }
    const result = context.receivePurchase(
      s,
      purchase,
      notice,
      load,
      qualityReading,
      job,
    );
    job.receiptIds.push(result.receiptId);
    load.state = "RECEIVED";
    load.receiptId = result.receiptId;
    load.bufferReservation.releasedAt = s.clock.now;
    load.huIds = s.receipts
      .find((row) => row.id === result.receiptId)
      .lines.flatMap((row) => row.huIds);
    for (const hu of s.hus.filter((row) => load.huIds.includes(row.id))) {
      hu.sourceSscc = load.sscc;
      // Only the retained cartons move onto a new pallet when the rest can stay.
      if (!split || !hu.packagingDefect) hu.sscc = load.sscc;
      hu.autonomyLoadId = load.id;
      hu.autonomyJobId = job.id;
    }
    context.event(
      s,
      "AUTONOMY_RECEIPT",
      `${purchase.id}: carga ${load.sscc}; ${load.cases - held} cajas aceptadas y ${held} retenidas por inspección.`,
      {
        jobId: job.id,
        purchaseId: purchase.id,
        receiptId: result.receiptId,
        evidenceIds: [identityReading.id, qualityReading.id],
        actorId: ACTOR,
      },
    );
    job.loadIndex++;
    if (job.loadIndex >= notice.loads.length && !(job.handlingVersion >= 2)) job.inboundDockReleasedAt = s.clock.now;
    releaseDevices(s, job);
    transition(s, job, "WAITING_DOCK");
  }
}
function tickOrder(s, job, seconds, context) {
  const order = s.orders.find((row) => row.id === job.documentId);
  if (
    !order ||
    ["CANCELLED", "CANCELLED_AFTER_PREPARATION"].includes(order.state)
  ) {
    releaseDevices(s, job);
    transition(s, job, "CANCELLED");
    return;
  }
  if (order.state === "PREPARING") {
    const held = s.hus.find(
      (hu) => hu.packContext?.orderId === order.id && hu.packingBlockedReason,
    );
    if (held) {
      exception(
        s,
        job,
        "CASE_PICKING_NOT_READY",
        held.packingBlockedReason,
        context,
      );
      return;
    }
    transition(s, job, "PREPARING");
    return;
  }
  if (order.state === "READY") {
    transition(s, job, "WAITING_DISPATCH");
    const issue = context.dispatchReadiness(s, order);
    if (issue) {
      job.waitingReason = issue;
      return;
    }
    context.dispatch(s, order);
    transition(s, job, "LOADING");
    context.event(
      s,
      "AUTONOMY_DISPATCH",
      `${order.id}: carga y despacho iniciados bajo la autorización de preparación.`,
      { jobId: job.id, orderId: order.id, actorId: ACTOR },
    );
    return;
  }
  if (order.state === "LOADING") {
    if (order.loading?.phase === "QUALITY_HOLD")
      exception(
        s,
        job,
        "OUTBOUND_QUALITY_HOLD",
        "La verificación final de carga ha retenido el vehículo.",
        context,
      );
    else transition(s, job, "LOADING");
    return;
  }
  if (order.state === "DISPATCHED") {
    transition(s, job, "TRANSPORTING");
    return;
  }
  if (order.state === "ARRIVED") {
    transition(s, job, "DESTINATION_RECEIVING");
    if (!job.policy.storeReceivingEnabled) {
      job.waitingReason =
        "La autorización no incluía recepción automática de tienda; requiere una política de recepción compatible.";
      return;
    }
    const branch = s.catalog.branches.find((row) => row.id === order.branchId);
    if (!branch?.active) {
      exception(
        s,
        job,
        "BRANCH_UNAVAILABLE",
        "La tienda está archivada; no se transfiere la custodia de la carga.",
        context,
      );
      return;
    }
    const asset = reserve(
      s,
      job,
      `ASSET-STORE-RECEIVING-${order.branchId}`,
      context,
    );
    if (!asset) return;
    job.stageElapsed += seconds;
    if (
      job.stageElapsed <
      stageDuration(s, job)
    )
      return;
    const loads = order.allocations.map((allocation) => {
      const hu = s.hus.find((row) => row.id === allocation.huId),
        sku = s.catalog.skus.find((row) => row.id === allocation.skuId),
        range = temperatureRange(sku?.zoneId);
      return {
        huId: hu?.id,
        cases: hu?.cases,
        lot: hu?.lot,
        expiry: hu?.expiry,
        temperatureC: range ? (range.min + range.max) / 2 : null,
      };
    });
    const reading = evidence(s, job, null, asset, "BRANCH_RECEIPT", {
      branchId: order.branchId,
      truckId: order.truckId,
      secureBuffer: true,
      vehicleRestrained: true,
      acquisitionSeconds: job.policy.storeIdentifySeconds,
      loads,
    });
    if (
      !acceptEvidence(s, job, null, reading, asset, "BRANCH_RECEIPT", context)
    )
      return;
    context.receiveStore(s, order);
    job.branchReceiptEvidenceId = reading.id;
    releaseDevices(s, job);
    transition(s, job, "RETURNING");
    context.event(
      s,
      "AUTONOMY_BRANCH_RECEIVED",
      `${order.id}: descarga y conciliación autónoma verificadas en destino; camión en retorno.`,
      {
        jobId: job.id,
        orderId: order.id,
        branchId: order.branchId,
        evidenceIds: [reading.id],
        actorId: ACTOR,
      },
    );
    return;
  }
  if (["RECEIVED", "RECEIVED_WITH_DIFFERENCE"].includes(order.state)) {
    const truck = s.trucks.find((row) => row.id === order.truckId);
    if (truck?.state === "AVAILABLE" || truck?.orderId !== order.id) {
      transition(s, job, "COMPLETED");
      context.event(
        s,
        "AUTONOMY_COMPLETED",
        `${order.id}: entrega conciliada y vehículo retornado.`,
        { jobId: job.id, orderId: order.id, actorId: ACTOR },
      );
    } else transition(s, job, "RETURNING");
  }
}
function tickAutonomy(s, seconds, context) {
  // Heartbeats belong to the explicit simulated adapter. An offline device or
  // a future external source cannot be made healthy by advancing the clock.
  for (const device of s.autonomyDevices || [])
    if (device.online === true && device.source === "SIMULATOR")
      device.heartbeatAt = s.clock.now;
  for (const job of s.autonomy.jobs.filter(
    (row) => !CLOSED.has(row.state) && row.state !== "EXCEPTION",
  )) {
    // Admission is checked at authorization. A later administrative pause does
    // not strand a load whose complete cycle was already authorized.
    if (job.kind === "PURCHASE") tickPurchase(s, job, seconds, context);
    else tickOrder(s, job, seconds, context);
  }
}
function autonomyReadModel(s, actor) {
  if (!can(actor, "autonomy.read") && !can(actor, "config.autonomy.manage"))
    return {
      version: 1,
      mode: "SIMULATED",
      jobs: [],
      notices: [],
      evidence: [],
      exceptions: [],
      legacyCandidates: [],
      canAuthorize: false,
      canRetry: false,
      physicalConnection: false,
      map: null,
    };
  const own = (row) =>
    actor.role !== "store" ||
    (row.kind === "ORDER" && row.branchId === actor.branchId);
  const jobs = s.autonomy.jobs
    .filter(own)
    .map((row) => ({
      ...structuredClone(row),
      progress:
        row.state === "COMPLETED"
          ? 100
          : row.kind === "PURCHASE"
            ? Math.round((row.loadIndex / Math.max(1, row.loadIds.length)) * 90)
            : {
                PREPARING: 10,
                WAITING_DISPATCH: 30,
                LOADING: 40,
                TRANSPORTING: 65,
                DESTINATION_RECEIVING: 80,
                RETURNING: 95,
              }[row.state] || 0,
    }));
  const ids = new Set(jobs.map((row) => row.id));
  const legacyCandidates = [
    ...s.purchases
      .filter((row) => ["ORDERED", "ARRIVED", "PARTIAL"].includes(row.state))
      .map((row) => ({
        kind: "PURCHASE",
        id: row.id,
        state: row.state,
        expectedRevision: row.revision || 1,
      })),
    ...s.orders
      .filter((row) =>
        ["PREPARING", "READY", "LOADING", "DISPATCHED", "ARRIVED"].includes(
          row.state,
        ),
      )
      .map((row) => ({
        kind: "ORDER",
        id: row.id,
        branchId: row.branchId,
        state: row.state,
        expectedRevision: row.revision || 1,
      })),
  ].filter(
    (row) =>
      !s.autonomy.jobs.some(
        (job) => job.documentId === row.id && job.kind === row.kind,
      ) &&
      (actor.role !== "store" ||
        (row.kind === "ORDER" && row.branchId === actor.branchId)),
  );
  return {
    version: 1,
    mode: "SIMULATED",
    configuration: structuredClone(s.configuration.autonomy),
    jobs,
    notices: actor.role === "store" ? [] : structuredClone(s.autonomy.notices),
    evidence: structuredClone(
      s.autonomy.evidence.filter((row) => ids.has(row.jobId)),
    ),
    exceptions: structuredClone(
      s.autonomy.exceptions.filter((row) => ids.has(row.jobId)),
    ),
    legacyCandidates,
    canAuthorize:
      actor.role === "operations" &&
      can(actor, "autonomy.authorize") &&
      (can(actor, "purchase.create") || can(actor, "order.release")),
    canRetry:
      actor.role === "operations" &&
      can(actor, "autonomy.exception.resolve") &&
      can(actor, "incident.resolve"),
    physicalConnection: false,
    map: can(actor, "map.view") ? autonomyMapFrame(s) : null,
  };
}
module.exports = {
  migrateAutonomy,
  authorizeAutonomy,
  cancelInboundProcess,
  autonomyCommand,
  tickAutonomy,
  autonomyReadModel,
  validateTelemetry,
  ssccFor,
};
