// Operational supervision only. Hardware evidence is created by the server's
// simulator, never by a browser button pretending a scanner has read a load.
import { photo } from "./experience.js";
import { newestFirst } from "./time.js";
import packagingQuality from "../core/packaging-quality.js";

const controlMessages = {
  IDENTITY_AND_POLICY_VERIFIED: ["Comprobaciones conformes", "La lectura coincide con la carga y cumple los controles del proceso."],
  UNKNOWN_DEVICE_OR_PROCESS: ["Equipo o proceso sin identificar", "Revisa el registro del equipo y su vinculación antes de reevaluar."],
  UNKNOWN_CHECKPOINT: ["Punto de control no reconocido", "Revisa la configuración del proceso antes de reevaluar."],
  MISSING_LOGISTIC_UNIT: ["Falta identificar la carga", "Revisa la unidad logística vinculada a este documento."],
  UNTRUSTED_SOURCE: ["Origen de lectura no verificado", "Comprueba la conexión y la identidad del equipo."],
  MISSING_PAYLOAD: ["Lectura incompleta", "El equipo debe aportar una nueva lectura completa."],
  WRONG_CORRELATION: ["La lectura corresponde a otra carga", "Comprueba documento, equipo y unidad logística antes de reevaluar."],
  PAYLOAD_CHANGED: ["La lectura cambió después de registrarse", "Conserva el registro y revisa el origen de la lectura."],
  STALE_EVENT: ["Lectura fuera de plazo", "Solicita una reevaluación para obtener una lectura nueva."],
  DUPLICATE_EVENT: ["Lectura duplicada", "Revisa la identidad del evento; una carga no puede recibirse dos veces."],
  ASN_MISMATCH: ["La carga no coincide con el preaviso", "Revisa producto, cajas, lote, vencimiento e identificación logística."],
  MISSING_IDENTITY: ["Identificación de carga incompleta", "Verifica lote y cantidad antes de continuar."],
  DUPLICATE_SSCC: ["Identificador logístico repetido", "Revisa las etiquetas de ambas cargas antes de reevaluar."],
  SAFETY_INTERLOCK: ["Transferencia sin condiciones seguras", "Comprueba sujeción del vehículo, nivelador y zona de transferencia."],
  READ_TIMEOUT: ["La identificación superó el tiempo permitido", "Revisa el lector y la etiqueta antes de solicitar una nueva lectura."],
  MISSING_PHYSICAL_PROFILE: ["Faltan medidas de la carga", "Comprueba peso, dimensiones y perfil logístico declarado."],
  PHYSICAL_ENVELOPE: ["Carga incompatible con el equipo", "Revisa peso, dimensiones, cajas y tipo de palé frente a la capacidad admitida."],
  WEIGHT_MISMATCH: ["Peso fuera de la tolerancia", "Contrasta el peso medido con el declarado por el proveedor."],
  DAMAGE_COUNT_MISMATCH: ["Detalle de daño inconsistente", "Repite la lectura antes de registrar cajas conformes o retenidas."],
  VISIBLE_QUALITY_HOLD: ["Observación en embalaje o etiqueta", "Revisa el embalaje, el palé y la legibilidad de la etiqueta."],
  SHELF_LIFE_HOLD: ["Vencimiento no aceptable", "Revisa la fecha y la vida útil mínima exigida al producto."],
  TEMPERATURE_HOLD: ["Temperatura fuera de rango", "Revisa la conservación del producto y la lectura de temperatura."],
  DELIVERY_MISMATCH: ["La entrega no coincide con el pedido", "Comprueba tienda, vehículo y cargas antes de confirmar la recepción."],
  EQUIPMENT_NOT_READY: ["Equipo no disponible", "Revisa su conexión, configuración y estado de mantenimiento."],
};
export function autonomyProcessMessage(job, snapshot = {}) {
  const autonomy = snapshot.autonomy || snapshot;
  const exception = (autonomy.exceptions || []).find(row => row.id === job.exceptionId);
  const code = exception?.code || job.waitingReason?.match(/^Proceso retenido:\s*([A-Z_]+)/)?.[1];
  if (controlMessages[code]) return `${controlMessages[code][0]}. ${controlMessages[code][1]}`;
  if (job.waitingReason && !/^Proceso retenido:/.test(job.waitingReason)) return job.waitingReason;
  return ({ COMPLETED: "Verificaciones y transferencias completadas.", EXCEPTION: "La carga está retenida hasta revisar la causa en su expediente.", CANCELLED: "Proceso cancelado con su historial conservado." })[job.state] || "El controlador coordina identificación, comprobaciones y transferencia de las cargas.";
}

const checkpointTitles = {
  UNLOAD: "Descarga segura",
  AUTO_ID: "Identificación de la carga",
  PIE: "Inspección de entrada",
  BRANCH_RECEIPT: "Recepción en tienda",
  SAFETY: "Descarga segura",
  IDENTIFICATION: "Identificación de la carga",
  GS1_IDENTIFICATION: "Identificación de la carga",
  QUALITY: "Inspección de entrada",
};
const processDescriptions = {
  WAITING_ARRIVAL: ["Esperando la llegada del proveedor", "El preaviso está registrado. La descarga comenzará cuando llegue el vehículo y haya capacidad disponible."],
  WAITING_DOCK: ["Esperando un muelle disponible", "El vehículo permanece en espera hasta que el muelle pueda recibirlo."],
  UNLOADING: ["La carga está saliendo del vehículo", "El descargador comprueba las condiciones de transferencia antes de entregar la carga a identificación."],
  IDENTIFYING: ["Comprobando etiquetas y documento", "El lector contrasta producto, lote, vencimiento y cajas con el preaviso del proveedor."],
  INSPECTING: ["Comprobando el estado de la carga", "La estación revisa peso, dimensiones, embalaje y las condiciones de conservación aplicables."],
  RECEIVING: ["Registrando la mercancía verificada", "La mercancía verificada se registra en recepción y se entrega al almacenamiento cuando hay espacio disponible."],
  PUTAWAY: ["Trasladando la carga a su ubicación", "Los equipos ejecutan los traslados de almacenamiento autorizados."],
  PREPARING: ["Preparando las cajas del pedido", "Los equipos recuperan las cargas y preparan las cantidades reservadas para esta tienda."],
  WAITING_DISPATCH: ["Preparación terminada; espera vehículo", "El proceso continuará cuando se asigne y autorice un vehículo compatible."],
  LOADING: ["Cargando el vehículo", "Las cargas preparadas se transfieren al vehículo asignado."],
  TRANSPORTING: ["El pedido viaja a la tienda", "La mercancía conserva su vínculo con el pedido y el vehículo durante el trayecto."],
  DESTINATION_RECEIVING: ["Descargando y comprobando en tienda", "La estación de destino contrasta las cargas recibidas con el pedido antes de incorporarlas al stock de la tienda."],
  RETURNING: ["Entrega recibida; vehículo de regreso", "La recepción de la tienda está registrada. El proceso termina cuando el vehículo queda disponible."],
  COMPLETED: ["Proceso terminado", "El ciclo autorizado ha finalizado. Puedes consultar sus controles y registros de recepción."],
  CANCELLED: ["Proceso cancelado", "Este proceso ya no admite nuevas etapas."],
  EXCEPTION: ["La carga requiere atención", "Resuelve la causa indicada y solicita una reevaluación. Los controles anteriores se conservan."],
};
const numericReading = (value, unit = "", digits = 2) =>
  typeof value === "number" && Number.isFinite(value)
    ? `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: digits }).format(value)}${unit ? ` ${unit}` : ""}`
    : "Sin lectura";
const calendarDate = (value) => {
  if (!value) return "No aplica";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return String(value);
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
};

// The view translates witnessed readings only. A missing sensor value is never
// presented as a passed control, and a future stage is never added as history.
export function describeAutonomyEvidence(row, snapshot = {}) {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {},
    catalog = snapshot.catalog || {},
    assets = catalog.assets || [],
    skus = catalog.skus || [],
    huList = snapshot.hus || snapshot.inventory?.hus || [],
    asset = assets.find((item) => item.id === row.assetId || item.deviceId === row.deviceId),
    declaredLoad = (snapshot.autonomy?.notices || []).flatMap((notice) => notice.loads || []).find((load) => load.id === row.loadId),
    sku = skus.find((item) => item.id === (payload.skuId || declaredLoad?.skuId)),
    checkpoint = row.checkpoint || row.type,
    facts = [],
    add = (label, value) => facts.push({ label, value: String(value) }),
    control = (label, value) => add(label, value === true ? "Confirmado" : value === false ? "No confirmado" : "Sin lectura");
  let summary = "Registro de control del proceso.";
  if (["UNLOAD", "SAFETY"].includes(checkpoint)) {
    summary = "Condiciones registradas para transferir la carga desde el vehículo.";
    control("Vehículo inmovilizado", payload.vehicleRestrained);
    control("Nivelador preparado", payload.levelerReady);
    control("Zona de transferencia libre", payload.transferAreaClear);
    control("Carga compatible", payload.supportedLoad);
  } else if (["AUTO_ID", "IDENTIFICATION", "GS1_IDENTIFICATION"].includes(checkpoint)) {
    summary = "Lectura de identidad contrastada con el preaviso del proveedor.";
    add("Cajas identificadas", numericReading(payload.cases, "cajas", 0));
    add("Lote del proveedor", payload.lot || "Sin lectura");
    add("Vencimiento", calendarDate(payload.expiry));
    add("Tiempo de lectura", numericReading(payload.acquisitionSeconds, "s"));
  } else if (["PIE", "QUALITY"].includes(checkpoint)) {
    const profile = payload.profile || {};
    summary = "Lecturas del embalaje y del perfil físico de la carga.";
    add("Peso de la carga", numericReading(profile.weightKg, "kg"));
    add("Ancho", numericReading(profile.widthM, "m"));
    add("Fondo", numericReading(profile.depthM, "m"));
    add("Altura", numericReading(profile.heightM, "m"));
    if (payload.visualDefect) {
      add("Defecto detectado por cámaras", packagingQuality.defectLabel(payload.visualDefect));
      const damaged = payload.damagedCases ?? payload.cases;
      add("Cajas con daño", `${damaged} de ${payload.cases}`);
      add("Separación", damaged < payload.cases
        ? `${payload.cases - damaged} a almacenamiento · ${damaged} a cuarentena`
        : "Carga retenida · Traslado a cuarentena");
    }
    add("Temperatura", payload.temperatureC == null ? "No registrada" : numericReading(payload.temperatureC, "°C"));
    for (const [key, label] of [["packaging", "Embalaje"], ["pallet", "Palé"], ["label", "Etiqueta"]])
      add(label, payload[key] === "OK" ? "Sin observaciones" : payload[key] ? "Con observaciones" : "Sin lectura");
  } else if (checkpoint === "BRANCH_RECEIPT") {
    summary = "Cargas comprobadas en el punto de recepción de la tienda.";
    const branch = (catalog.branches || []).find((item) => item.id === payload.branchId),
      truck = [...(snapshot.trucks || []), ...(snapshot.equipment?.trucks || []), ...assets].find((item) => item.id === payload.truckId);
    add("Tienda", branch?.name || "Destino del pedido");
    add("Vehículo", truck?.name || truck?.plate || "Vehículo asignado");
    control("Vehículo inmovilizado", payload.vehicleRestrained);
    control("Zona de recepción segura", payload.secureBuffer);
    add("Tiempo de lectura", numericReading(payload.acquisitionSeconds, "s"));
    if (Array.isArray(payload.loads)) {
      add("Cargas comprobadas", numericReading(payload.loads.length, "cargas", 0));
      const validCounts = payload.loads.every((load) => Number.isInteger(load.cases) && load.cases >= 0);
      if (validCounts) add("Cajas comprobadas", numericReading(payload.loads.reduce((total, load) => total + load.cases, 0), "cajas", 0));
    }
  }
  const products = Array.isArray(payload.loads) ? payload.loads.map((load) => {
    const hu = huList.find((item) => item.id === load.huId),
      allocation = (snapshot.orders || []).find((order) => order.id === row.documentId)?.allocations?.find((item) => item.huId === load.huId),
      product = skus.find((item) => item.id === (hu?.skuId || allocation?.skuId));
    return { product, name: product?.name || "Unidad de carga", cases: numericReading(load.cases, "cajas", 0), lot: load.lot || "Sin lectura", expiry: calendarDate(load.expiry), temperature: load.temperatureC == null ? null : numericReading(load.temperatureC, "°C"), id: load.huId };
  }) : [];
  const checks = (Array.isArray(row.checks) ? row.checks : []).map((code) => ({ code, title: controlMessages[code]?.[0] || "Comprobación registrada", detail: controlMessages[code]?.[1] || "Revisa el resultado y la referencia del control." }));
  return { title: checkpointTitles[checkpoint] || checkpointTitles[row.type] || "Control registrado", summary, asset, sku, facts, products, checks };
}

export function createAutonomyView({
  getState,
  getUser,
  can,
  command,
  esc,
  showDialog,
  dialog,
  pageHeading,
  formIssue,
}) {
const labels = {
    WAITING_ARRIVAL: "Preaviso confirmado",
    WAITING_DOCK: "Esperando muelle",
    UNLOADING: "Descarga automática",
    IDENTIFYING: "Identificando cargas",
    INSPECTING: "Inspección automática",
    RECEIVING: "Registrando recepción",
    PUTAWAY: "Almacenamiento automático",
    PREPARING: "Preparación automática",
    LOADING: "Carga del vehículo",
    WAITING_DISPATCH: "Esperando vehículo",
    TRANSPORTING: "Transporte a tienda",
    DESTINATION_RECEIVING: "Recepción autónoma de tienda",
    RETURNING: "Retorno del vehículo",
    COMPLETED: "Proceso completado",
    EXCEPTION: "Retenido por excepción",
    CANCELLED: "Cancelado",
    OPEN: "Pendiente",
    PENDING: "Pendiente de validar",
    RESOLVED: "Resuelta",
    PASS: "Conforme",
    ACCEPT: "Aceptada",
    HOLD: "Retenida",
    FAIL: "No conforme",
  };
  let root,
    filter = "ACTIVE",
    signature = "";
  const data = () => {
    const snapshot = getState();
    return snapshot?.autonomy ? {
      ...snapshot.autonomy,
      infrastructure: snapshot.autonomyConfiguration || snapshot.autonomy.infrastructure,
      configurationModel: snapshot.autonomyConfiguration || snapshot.autonomy.configurationModel,
    } : {
      jobs: [],
      notices: [],
      evidence: [],
      exceptions: [],
      legacyCandidates: [],
    };
  };
  const date = (value) =>
    value && Number.isFinite(Date.parse(value))
      ? new Intl.DateTimeFormat("es-PE", {
          dateStyle: "short",
          timeStyle: "medium",
          timeZone: "America/Lima",
        }).format(new Date(value))
      : "—";
  const badge = (state) =>
    `<span class="badge ${["COMPLETED", "PASS", "ACCEPT", "RESOLVED"].includes(state) ? "green" : ["EXCEPTION", "FAIL", "HOLD"].includes(state) ? "red" : "amber"}">${esc(labels[state] || "Estado registrado")}</span>`;
  const btn = (text, action, id = "", cls = "secondary small", extra = "") =>
    `<button type="button" class="btn ${cls}" data-autonomy="${action}" data-id="${esc(id)}" ${extra}>${esc(text)}</button>`;
  const processSummary = (job) => {
    const exception = (data().exceptions || []).find((row) => row.id === job.exceptionId);
    if (exception && controlMessages[exception.code]) return controlMessages[exception.code][0];
    return job.waitingReason || processDescriptions[job.state]?.[1] || "Consulta los controles registrados del proceso.";
  };
  const title = (job) => {
    if (job.partnerName || job.documentLabel)
      return job.partnerName || job.documentLabel;
    const state = getState();
    if (job.kind === "PURCHASE") {
      const purchase = (state.purchases || []).find((p) => p.id === job.documentId);
      return (
        state.catalog.suppliers.find((p) => p.id === purchase?.supplierId)
          ?.name || "Recepción de proveedor"
      );
    }
    const order = (state.orders || []).find((p) => p.id === job.documentId);
    return (
      state.catalog.branches.find(
        (p) => p.id === (job.branchId || order?.branchId),
      )?.name || "Abastecimiento de tienda"
    );
  };
  function mount(container) {
    root = container;
    draw();
  }
  function draw() {
    const state = data(),
      jobs = state.jobs || [],
      active = jobs.filter(
        (job) => !["COMPLETED", "CANCELLED"].includes(job.state),
      ),
      exceptions = (state.exceptions || []).filter(
        (row) => row.state === "OPEN",
      );
    signature = JSON.stringify(state);
    const visible = newestFirst(jobs)
      .filter(
        (job) =>
          filter === "ALL" ||
          (filter === "ACTIVE"
            ? !["COMPLETED", "CANCELLED"].includes(job.state)
            : job.state === filter),
      )
      ;
    const config = state.configuration?.settings || state.configuration || {},
      assets = state.assets || state.infrastructure?.assets || [];
    root.innerHTML =
      pageHeading(
        "ORQUESTACIÓN LOGÍSTICA",
        "Centro de autonomía",
        getUser().role === "store"
          ? "Recepción y trazabilidad automática de tu sucursal."
          : "Procesos autorizados, equipos coordinados y excepciones documentadas.",
        can("config.autonomy.manage")
          ? btn("Configurar orquestación", "configure", "", "primary")
          : "",
      ) +
      `<div class="autonomy-workspace"><div class="autonomy-metrics"><article><span>Procesos activos</span><strong>${active.length}</strong></article><article><span>Excepciones abiertas</span><strong>${exceptions.length}</strong></article><article><span>Procesos completados</span><strong>${jobs.filter((job) => job.state === "COMPLETED").length}</strong></article><article><span>Admisión automática</span><strong class="autonomy-status-value">${config.enabled === false ? "Pausada" : "Habilitada"}</strong></article></div>
      <section class="panel"><div class="section-heading"><h2>Procesos y custodia</h2><label class="autonomy-filter">Mostrar<select id="autonomy-filter"><option value="ACTIVE" ${filter === "ACTIVE" ? "selected" : ""}>En curso</option><option value="EXCEPTION" ${filter === "EXCEPTION" ? "selected" : ""}>Con excepción</option><option value="COMPLETED" ${filter === "COMPLETED" ? "selected" : ""}>Completados</option><option value="ALL" ${filter === "ALL" ? "selected" : ""}>Todos</option></select></label></div><div class="autonomy-job-list">${visible.map((job) => `<article class="autonomy-job"><div><small>${esc(job.documentId)} · ${job.kind === "PURCHASE" ? "Entrada" : "Salida"}</small><h3>${esc(title(job))}</h3>${badge(job.state)}<p>${esc(processSummary(job))}</p></div><div class="autonomy-job-actions">${btn("Ver expediente", "detail", job.id)}${can("autonomy.exception.resolve") && job.state === "EXCEPTION" ? btn("Solicitar reevaluación", "retry", job.id) : ""}</div></article>`).join("") || '<div class="empty-state"><h3>No hay procesos en este filtro</h3><p>Una compra o una preparación autorizada inicia su propio proceso autónomo.</p></div>'}</div></section>
      ${(state.legacyCandidates || []).length ? `<section class="panel"><div class="section-heading"><h2>Documentos anteriores pendientes</h2></div><div class="pad"><p>Conservan sus cantidades y su estado original. Incorporarlos inicia una verificación nueva; no confirma retrospectivamente una descarga o entrega.</p><div class="autonomy-legacy-list">${state.legacyCandidates.map((item) => `<article><div><strong>${esc(item.id)}</strong><small>${item.kind === "PURCHASE" ? "Recepción de proveedor" : "Abastecimiento de tienda"}</small></div>${can("autonomy.authorize") ? btn("Autorizar proceso autónomo", "authorize", item.id, "secondary small", `data-kind="${esc(item.kind)}"`) : '<span class="muted">Pendiente de autorización de Operaciones</span>'}</article>`).join("")}</div></div></section>` : ""}
      ${assets.length ? `<section class="panel"><div class="section-heading"><h2>Infraestructura autónoma</h2></div><div class="autonomy-infrastructure">${assets.map((asset) => `<article data-autonomy-asset="${esc(asset.id)}">${photo(asset, "autonomy-equipment-photo")}<div class="autonomy-equipment-content"><strong>${esc(asset.name)}</strong><span class="badge ${asset.readiness?.ready ? "green" : "amber"}">${asset.readiness?.ready ? "Disponible" : "No disponible"}</span><p>${esc(asset.readiness?.reason || "Identificación, seguridad y transferencia controladas.")}</p></div></article>`).join("")}</div></section>` : ""}
      <details class="autonomy-scope"><summary>Alcance y términos</summary><p>WMS: gestión de existencias y pedidos. WES: coordinación de trabajos. WCS: ejecución y comprobación de equipos. ASN: preaviso del proveedor. SSCC: identidad de una unidad logística, distinta del lote del producto. Los eventos de esta instalación proceden del simulador; no acreditan lecturas de equipos físicos.</p></details></div>`;
    root.querySelector("#autonomy-filter").onchange = (event) => {
      filter = event.target.value;
      draw();
    };
    root
      .querySelectorAll("[data-autonomy]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            action(
              button.dataset.autonomy,
              button.dataset.id,
              button.dataset.kind,
            )),
      );
  }
  function refresh() {
    if (
      !root?.isConnected ||
      dialog.open ||
      ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)
    )
      return;
    if (signature !== JSON.stringify(data())) {
      const y = scrollY;
      draw();
      window.scrollTo({ top: y, behavior: "instant" });
    }
  }
  function detail(id) {
    const state = data(),
      snapshot = getState(),
      job = (state.jobs || []).find((row) => row.id === id);
    if (!job) return;
    const evidence = (state.evidence || []).filter((row) => row.jobId === id).sort((a, b) => (Date.parse(a.observedAt) || 0) - (Date.parse(b.observedAt) || 0)),
      notice = (state.notices || []).find((row) => row.id === job.noticeId),
      exception = (state.exceptions || []).find((row) => row.id === job.exceptionId),
      description = processDescriptions[job.state] || ["Proceso en curso", "Consulta los controles registrados y el estado del documento."],
      cause = exception && controlMessages[exception.code],
      order = (snapshot.orders || []).find((row) => row.id === job.documentId),
      loads = notice?.loads || [],
      receipt = evidence.findLast((row) => row.checkpoint === "BRANCH_RECEIPT"),
      loadCount = loads.length || receipt?.payload?.loads?.length || order?.allocations?.length || job.loadIds?.length || 0,
      quantities = loads.length ? loads : order?.lines || [],
      cases = quantities.length && quantities.every((row) => Number.isInteger(row.cases) && row.cases >= 0) ? quantities.reduce((sum, row) => sum + row.cases, 0) : null,
      facts = (items, cls = "autonomy-reading-grid") => `<dl class="${cls}">${items.map(({ label, value }) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join("")}</dl>`,
      references = (items) => facts(items.filter((item) => item.value != null && item.value !== ""), "autonomy-reference-grid"),
      currentUser = getUser(),
      author = currentUser?.id === job.authorizedBy ? currentUser.name || "Cuenta actual" : "Cuenta autorizada",
      currentReason = job.waitingReason && !/^Proceso retenido:/.test(job.waitingReason) ? job.waitingReason : null,
      controlCards = evidence.map((row, index) => {
        const view = describeAutonomyEvidence(row, snapshot),
          held = ["HOLD", "FAIL"].includes(row.decision),
          productName = view.sku?.name,
          technical = [
            { label: "Registro", value: row.id },
            { label: "Equipo de lectura", value: row.deviceId },
            { label: "Unidad logística", value: row.payload?.sscc || row.loadId },
            { label: "Código de barras", value: row.payload?.barcode },
            { label: "Origen", value: row.source === "SIMULATED_DEVICE" ? "Dispositivo simulado de la instalación" : row.source === "DEVICE" ? "Dispositivo de la instalación" : "Registro del controlador" },
          ];
        return `<details class="autonomy-evidence-card ${held ? "is-held" : row.decision === "PASS" ? "is-passed" : ""}" ${held || index === evidence.length - 1 ? "open" : ""}><summary><span class="autonomy-control-mark" aria-hidden="true">${row.decision === "PASS" ? "✓" : held ? "!" : "·"}</span><span class="autonomy-evidence-heading"><strong>${esc(view.title)}</strong><span>${esc(productName || view.asset?.name || "Control de proceso")}</span><small>${esc(date(row.observedAt))}</small></span>${badge(row.decision)}<span class="autonomy-disclosure" aria-hidden="true">⌄</span></summary><div class="autonomy-evidence-body"><p class="autonomy-control-description">${esc(view.summary)}</p>${view.asset ? `<div class="autonomy-recorded-by"><span>Equipo</span><strong>${esc(view.asset.name)}</strong></div>` : ""}${view.facts.length ? facts(view.facts) : '<p class="muted">El registro no contiene mediciones adicionales.</p>'}${view.products.length ? `<div class="autonomy-received-loads">${view.products.map((load) => `<article>${load.product ? photo(load.product, "autonomy-load-photo") : '<span class="autonomy-load-symbol" aria-hidden="true">▦</span>'}<div><strong>${esc(load.name)}</strong><span>${esc(load.cases)} · Lote ${esc(load.lot)}</span><small>Vence: ${esc(load.expiry)}${load.temperature ? ` · ${esc(load.temperature)}` : ""}</small></div></article>`).join("")}</div>` : ""}${view.checks.length ? `<ul class="autonomy-check-results">${view.checks.map((check) => `<li><span aria-hidden="true">${row.decision === "PASS" ? "✓" : "!"}</span><div><strong>${esc(check.title)}</strong><p>${esc(check.detail)}</p></div></li>`).join("")}</ul>` : ""}${row.checkpoint === "PIE" || row.type === "QUALITY" ? '<p class="autonomy-reading-scope">Esta inspección registra el embalaje visible y el perfil logístico; no sustituye un análisis de inocuidad alimentaria.</p>' : ""}<details class="autonomy-references"><summary>Referencias del registro</summary>${references(technical)}</details></div></details>`;
      }).join("");
    showDialog(
      title(job),
      `<div class="autonomy-dossier"><section class="autonomy-process-overview ${job.state === "EXCEPTION" ? "is-held" : ""}"><div class="autonomy-process-kicker"><span>${job.kind === "PURCHASE" ? "Recepción de proveedor" : "Abastecimiento de tienda"}</span>${badge(job.state)}</div><h3>${esc(description[0])}</h3><p>${esc(currentReason || description[1])}</p><div class="autonomy-process-metrics">${cases != null ? `<div><strong>${esc(numericReading(cases, "", 0))}</strong><span>Cajas del documento</span></div>` : ""}<div><strong>${loadCount}</strong><span>Unidades de carga</span></div><div><strong>${evidence.filter((row) => row.decision === "PASS").length}<small> / ${evidence.length}</small></strong><span>Controles conformes</span></div></div></section>${exception ? `<section class="autonomy-attention" role="status"><span class="autonomy-attention-symbol" aria-hidden="true">!</span><div><span>Requiere atención</span><h4>${esc(cause?.[0] || "Proceso retenido")}</h4><p>${esc(cause?.[1] || currentReason || exception.message || description[1])}</p>${can("autonomy.exception.resolve") ? btn("Solicitar reevaluación", "retry", job.id, "secondary small") : '<p class="autonomy-attention-owner">Operaciones debe revisar la causa para continuar.</p>'}</div></section>` : ""}<div class="autonomy-dossier-meta"><span>Documento <strong>${esc(job.documentId)}</strong></span><span>Actualizado ${esc(date(job.updatedAt))}</span></div>${notice ? `<details class="autonomy-manifest"><summary><span><strong>Mercancía del preaviso</strong><small>${loads.length} ${loads.length === 1 ? "unidad logística declarada" : "unidades logísticas declaradas"} por el proveedor</small></span><span class="autonomy-disclosure" aria-hidden="true">⌄</span></summary><div class="autonomy-manifest-loads">${loads.map((load) => {
        const sku = (snapshot.catalog?.skus || []).find((item) => item.id === load.skuId);
        return `<article>${sku ? photo(sku, "autonomy-load-photo") : '<span class="autonomy-load-symbol" aria-hidden="true">▦</span>'}<div><h4>${esc(sku?.name || "Producto del documento")}</h4><span>${esc(numericReading(load.cases, "cajas", 0))}</span><p>Lote ${esc(load.lot || "No registrado")} · Vence: ${esc(calendarDate(load.expiry))}</p><details class="autonomy-load-identity"><summary>Identificación logística</summary>${references([{ label: "Unidad logística (SSCC)", value: load.sscc }, { label: "Referencia de carga", value: load.id }])}</details></div></article>`;
      }).join("")}</div></details>` : ""}<section class="autonomy-history"><div class="autonomy-history-heading"><h3>Controles registrados</h3><span>${evidence.length} ${evidence.length === 1 ? "registro" : "registros"}</span></div><p class="autonomy-history-caption">Resultados capturados durante este proceso, en orden de registro.</p><div class="autonomy-authorization"><span class="autonomy-control-mark" aria-hidden="true">✓</span><div><strong>Proceso autorizado</strong><span>${esc(date(job.createdAt))} · ${esc(author)}</span></div></div><div class="autonomy-evidence-list">${controlCards || '<div class="autonomy-no-readings"><strong>Aún no hay lecturas registradas</strong><p>Los controles aparecerán cuando la carga llegue a cada estación.</p></div>'}</div></section>${job.retryHistory?.length ? `<section class="autonomy-corrections"><h3>Reevaluaciones solicitadas</h3>${job.retryHistory.map((retry) => `<article><span>${esc(date(retry.at))}</span><p>${esc(retry.reason)}</p></article>`).join("")}</section>` : ""}<details class="autonomy-references autonomy-process-references"><summary>Datos de trazabilidad del proceso</summary>${references([{ label: "Expediente", value: job.id }, { label: "Documento", value: job.documentId }, { label: "Cuenta que autorizó", value: job.authorizedBy }, { label: "Autorizado", value: date(job.createdAt) }, { label: "Última actualización", value: date(job.updatedAt) }, ...(exception ? [{ label: "Referencia de incidencia", value: exception.id }, { label: "Código del control", value: exception.code }] : [])])}</details></div>`,
      "SEGUIMIENTO DEL PROCESO",
    );
    dialog.querySelectorAll("[data-autonomy]").forEach((button) => {
      button.onclick = () => action(button.dataset.autonomy, button.dataset.id);
    });
  }
  function action(type, id, kind) {
    if (type === "detail") return detail(id);
    if (type === "configure") return configure();
    if (
      (type === "authorize" && !can("autonomy.authorize")) ||
      (type === "retry" && !can("autonomy.exception.resolve"))
    )
      return;
    const target =
      type === "retry"
        ? data().jobs.find((job) => job.id === id)
        : data().legacyCandidates.find(
            (row) => row.id === id && row.kind === kind,
          );
    if (!target) return;
    showDialog(
      type === "retry"
        ? "Reevaluar el proceso retenido"
        : "Autorizar verificación autónoma",
      `<form id="autonomy-decision-form"><div class="notice">${type === "retry" ? "La reevaluación conserva todas las evidencias anteriores. No fuerza una aceptación ni omite controles fallidos." : "El controlador verificará las cargas pendientes desde su estado actual. La mercancía no se recibe hasta superar los controles requeridos."}</div><label>Motivo de la autorización<textarea name="reason" rows="3" required minlength="10" maxlength="500"></textarea></label><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn primary">${type === "retry" ? "Solicitar reevaluación" : "Autorizar e iniciar"}</button></div></form>`,
      esc(id),
    );
    document.querySelector("#autonomy-decision-form").onsubmit = async (
      event,
    ) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        await command(
          type === "retry" ? "autonomy.retry" : "autonomy.authorize",
          {
            id,
            ...(kind ? { kind } : {}),
            expectedRevision: target.expectedRevision ?? target.revision,
            reason: form.reason.value,
          },
          "Autorización registrada. El controlador comprobará las condiciones antes de continuar.",
        );
        dialog.close();
        draw();
      } catch (error) {
        formIssue(form, error.message, error.fieldErrors);
      }
    };
  }
  function configure() {
    if (!can("config.autonomy.manage")) return;
    const state = data(),
      model = state.configurationModel || {},
      settings =
        model.settings ||
        state.configuration?.settings ||
        state.configuration ||
        {},
      fields = state.configurationSchema || model.fields || [],
      transferTiming = '<section class="notice"><strong>Recorrido y transferencia de la carga</strong><p>Los tiempos configurados son mínimos de control. En nuevas autorizaciones, el recorrido de recepción conserva un mínimo mecánico de 75 segundos por carga; la entrega entre recepción y robot requiere al menos 24 segundos, y la transferencia en preparación, 14 segundos. El proceso espera más si faltan espacio o condiciones de transferencia. Los trabajos ya autorizados conservan sus plazos.</p></section>',
      revision =
        state.configurationRevision ??
        model.configurationRevision ??
        getState().configuration.revision;
    showDialog(
      "Políticas de orquestación autónoma",
      `<form id="autonomy-settings-form"><div class="notice">Pausar una admisión impide iniciar procesos nuevos. Los procesos autorizados conservan su carga y sus reglas. Los enclavamientos de seguridad no son editables ni se pueden omitir.</div>${transferTiming}<div class="form-grid">${fields.map((field) => (field.type === "boolean" ? `<label class="form-check"><input type="checkbox" name="${esc(field.key)}" ${settings[field.key] ? "checked" : ""}><span>${esc(field.label)}</span></label>` : `<label>${esc(field.label)}<input type="number" name="${esc(field.key)}" value="${esc(settings[field.key])}" min="${field.min}" max="${field.max}" step="1" required></label>`)).join("")}</div><p class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn primary">Guardar política</button></div></form>`,
      "ADMINISTRACIÓN · AUTONOMÍA",
    );
    document.querySelector("#autonomy-settings-form").onsubmit = async (
      event,
    ) => {
      event.preventDefault();
      const form = event.currentTarget;
      const next = Object.fromEntries(
        fields.map((field) => [
          field.key,
          field.type === "boolean"
            ? form.elements.namedItem(field.key).checked
            : Number(form.elements.namedItem(field.key).value),
        ]),
      );
      try {
        await command(
          "config.autonomy.update",
          { expectedRevision: revision, settings: next },
          "Política actualizada sin alterar cargas en curso.",
        );
        dialog.close();
        draw();
      } catch (error) {
        formIssue(form, error.message, error.fieldErrors);
      }
    };
  }
  return {
    mount,
    refresh,
    detail,
    authorize: (kind, id) => action("authorize", id, kind),
    retry: (id) => action("retry", id),
  };
}
