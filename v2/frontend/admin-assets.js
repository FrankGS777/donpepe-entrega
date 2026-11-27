import { bindCatalogUpload } from "./catalog-upload.js";
import { limaDate, formatCalendarDate, formatLima } from "./time.js";

// Registry and technical decisions live in administration; physical missions
// continue to belong to the operations console and its autonomous controller.
export function createAdminAssets(ctx) {
  const {
    getState,
    main,
    dialog,
    showDialog,
    command,
    esc,
    icon,
    toast,
    bindForm,
    heading,
    field,
    select,
    message,
    image,
    imagePath,
    downloadCsv,
  } = ctx;
  const $ = (selector, root = main) => root.querySelector(selector);
  const views = ["categories", "brands", "assets", "maintenance"];
  const kindFor = { categories: "category", brands: "brand", assets: "asset" };
  const names = {
    categories: ["Categorías", "categoría"],
    brands: ["Marcas", "marca"],
    assets: ["Activos y maquinaria", "activo"],
  };
  const zones = {
    DRY: "Reserva seca",
    COLD: "Refrigerado",
    FROZEN: "Congelado",
    CLEANING: "Limpieza",
  };
  const types = {
    AMR: "Robot móvil autónomo",
    STACKER: "Transelevador",
    SHUTTLE: "Carro lanzadera",
    FORKLIFT: "Montacargas automático",
    TRUCK: "Camión de reparto",
    CHARGER: "Estación de carga",
    AUTO_UNLOADER: "Descargador automático de muelle",
    AUTO_ID_GATE: "Portal Auto-ID",
    PIE_STATION: "Inspección automática de entrada",
    INBOUND_CONVEYOR: "Transportador de recepción",
    CASE_PICKING_CELL: "Célula robótica de cajas cerradas",
    STORE_RECEIVING_STATION: "Recepción autónoma de tienda",
  };
  const statuses = {
    AVAILABLE: "Disponible",
    PLANNED: "Planificado",
    MAINTENANCE: "En mantenimiento",
    WAITING_SAFE: "Esperando parada segura",
    INACTIVE: "Desactivado",
    DELETED: "Eliminado",
  };
  const maintenanceStates = {
    REQUESTED: "Pendiente de aprobación",
    PENDING: "Pendiente de aprobación",
    APPROVED: "Autorizado",
    WAITING_SAFE: "Esperando parada segura",
    IN_PROGRESS: "Intervención en curso",
    COMPLETED: "Finalizado",
    REJECTED: "Rechazado",
    CANCELLED: "Cancelado",
  };
  const maintenanceTypes = {
    PREVENTIVE: "Preventivo",
    CORRECTIVE: "Correctivo",
    INSPECTION: "Inspección técnica",
  };
  const checklist = [
    ["safety", "Aislamiento y seguridad del equipo"],
    ["structure", "Estructura, ruedas y elementos de guiado"],
    ["sensors", "Sensores y dispositivos de seguridad"],
    ["power", "Alimentación, batería o sistema eléctrico"],
    ["lifting", "Sistema de elevación y sujeción de carga"],
    ["function", "Prueba funcional y liberación técnica"],
  ];
  function checklistFor(asset) {
    if (
      [
        "AUTO_UNLOADER",
        "AUTO_ID_GATE",
        "PIE_STATION",
        "INBOUND_CONVEYOR",
        "CASE_PICKING_CELL",
        "STORE_RECEIVING_STATION",
      ].includes(asset?.type)
    ) {
      const checks = {
        AUTO_UNLOADER: [
          ["restraint", "Enclavamiento del vehículo y transferencia de carga"],
          ["support", "Apoyo de carga y compatibilidad del remolque"],
        ],
        AUTO_ID_GATE: [
          [
            "identity",
            "Identificación de unidad logística y correlación con preaviso",
          ],
          ["reader", "Óptica, lectura y comunicación del portal"],
        ],
        PIE_STATION: [
          ["scale", "Vigencia de calibración y verificación de la báscula"],
          ["profile", "Comprobación de gálibo, patines y visión del embalaje"],
          ["temperature", "Verificación del registro térmico y conservación"],
        ],
        INBOUND_CONVEYOR: [
          ["transfer", "Transferencia, acumulación y detección de atasco"],
          ["destination", "Reserva y confirmación del destino de cada carga"],
        ],
        CASE_PICKING_CELL: [
          [
            "case",
            "Selección y conciliación de cajas cerradas sin alterar su lote",
          ],
          [
            "label",
            "Aplicación y lectura de la identidad de la carga de salida",
          ],
        ],
        STORE_RECEIVING_STATION: [
          ["restraint", "Enclavamiento del vehículo y buffer seguro de tienda"],
          ["identity", "Conciliación del manifiesto, identificación y acuse"],
          ["temperature", "Verificación de conservación en destino"],
        ],
      };
      return [
        ["safety", "Aislamiento y estado seguro de la célula"],
        ...checks[asset.type],
        ["communication", "Comunicación, identidad de equipo y trazabilidad"],
        ["function", "Prueba funcional documentada y liberación técnica"],
      ];
    }
    if (asset?.type === "TRUCK")
      return [
        ["safety", "Aislamiento, señalización y seguridad del vehículo"],
        ["brakes", "Frenos, neumáticos y dirección"],
        ["power", "Alimentación y sistemas eléctricos"],
        ["doors", "Puertas, caja de carga y sujeciones"],
        ["cooling", "Control térmico y aislamiento de la carga"],
        ["function", "Prueba funcional y liberación técnica"],
      ];
    if (asset?.type === "CHARGER")
      return [
        ["safety", "Aislamiento y seguridad de la estación"],
        ["power", "Protecciones y alimentación eléctrica"],
        ["connectors", "Conectores, cables y contactos de carga"],
        ["function", "Prueba funcional y liberación técnica"],
      ];
    return checklist.filter(
      ([id]) =>
        id !== "lifting" ||
        ["STACKER", "SHUTTLE", "FORKLIFT"].includes(asset?.type),
    );
  }
  const button = (
    label,
    action,
    id = "",
    cls = "secondary small",
    extra = "",
  ) =>
    `<button type="button" class="btn ${cls}" data-admin-data="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
  function lifecycleButtons(row) {
    const protectedDevice = current === "assets" && row.deviceId;
    const blocked = row.active !== false || protectedDevice;
    const explanation = protectedDevice
      ? "Equipo integrado: conserva su ficha técnica desactivada"
      : "Desactiva el registro antes de eliminarlo";
    return (
      button(
        row.active !== false ? "Desactivar" : "Activar",
        row.active !== false ? "deactivate" : "activate",
        row.id,
      ) +
      button(
        "Eliminar",
        "delete",
        row.id,
        "danger-ghost small",
        blocked ? `disabled title="${explanation}"` : "",
      )
    );
  }
  const format = (value) =>
    new Intl.NumberFormat("es-PE").format(Number(value) || 0);
  const day = (value) => {
    if (!value) return "No programado";
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value))
      ? formatCalendarDate(value)
      : formatLima(value);
  };
  const today = () => limaDate(getState().clock?.now || new Date());
  const preferences = {};
  let current = "",
    fingerprint = "";
  function prefs(view = current) {
    if (!preferences[view]) {
      let saved;
      try {
        saved = JSON.parse(sessionStorage.getItem(`donpepe:admin:${view}`));
      } catch {}
      preferences[view] = {
        query: "",
        type: "",
        page: 1,
        size: 24,
        ...(saved || {}),
        status:
          saved?.status === "archived" ? "inactive" : saved?.status || "active",
        sort: saved?.version === 2 ? saved.sort || "recent" : "recent",
        version: 2,
      };
    }
    return preferences[view];
  }
  function persist() {
    try {
      sessionStorage.setItem(
        `donpepe:admin:${current}`,
        JSON.stringify(prefs()),
      );
    } catch {}
  }
  const records = () =>
    current === "maintenance"
      ? getState().maintenance || []
      : (getState().catalog[current] || []).filter((row) => !row.deletedAt);
  const assetById = (id) =>
    (getState().catalog.assets || []).find((asset) => asset.id === id);
  const badge = (label, state) =>
    `<span class="badge ${["INACTIVE", "REJECTED", "CANCELLED"].includes(state) ? "red" : ["MAINTENANCE", "WAITING_SAFE", "REQUESTED", "PENDING", "IN_PROGRESS"].includes(state) ? "amber" : ["AVAILABLE", "COMPLETED"].includes(state) ? "green" : "purple"}">${esc(label || state)}</span>`;
  // Asset origin remains in catalog metadata; operational cards stay uncluttered.
  const media = (url, title, kind = "product") =>
    `<div class="admin-entity-photo">${image(url, title, kind)}</div>`;
  const countProducts = (kind, id, name) =>
    (getState().catalog.skus || []).filter(
      (sku) =>
        !sku.deletedAt &&
        (sku[`${kind}Id`] === id || (!sku[`${kind}Id`] && sku[kind] === name)),
    ).length;
  const revision = () => getState().configuration.revision;
  function render(view) {
    if (!views.includes(view)) return false;
    current = view;
    fingerprint = JSON.stringify([getState().catalog, getState().maintenance]);
    const p = prefs(),
      data = records(),
      isMaintenance = view === "maintenance",
      title = isMaintenance ? "Mantenimiento técnico" : names[view][0];
    main.innerHTML =
      heading(
        isMaintenance || view === "assets"
          ? "ACTIVOS DEL CENTRO"
          : "DATOS MAESTROS",
        title,
        isMaintenance
          ? "Solicitud, autorización, parada segura, intervención y liberación técnica."
          : view === "assets"
            ? "Ficha técnica, estado y conservación de los equipos del centro de distribución."
            : "Identidad comercial y compatibilidad de los productos del catálogo.",
        button("Exportar CSV", "export") +
          button(
            isMaintenance
              ? "+ Solicitar mantenimiento"
              : `+ Crear ${names[view][1]}`,
            isMaintenance ? "request" : "new",
            "",
            "primary",
          ),
      ) +
      (isMaintenance
        ? maintenanceMetrics(data)
        : view === "assets"
          ? assetMetrics(data)
          : taxonomyMetrics(data)) +
      `<section class="panel admin-registry-panel"><div class="master-filter-row admin-registry-filters"><label class="master-search">${icon("search")}<input type="search" id="admin-data-search" value="${esc(p.query)}" placeholder="${isMaintenance ? "Equipo, motivo o técnico" : view === "assets" ? "Nombre, fabricante, modelo o serie" : "Nombre o descripción"}" aria-label="Buscar ${title.toLowerCase()}"></label><label>Estado<select id="admin-data-status">${isMaintenance ? '<option value="all">Todos</option><option value="open">Pendientes y en curso</option><option value="completed">Finalizados</option><option value="closed">Rechazados y cancelados</option>' : '<option value="active">Activos</option><option value="inactive">Desactivados</option><option value="all">Todos</option>'}</select></label>${
        view === "assets" || isMaintenance
          ? `<label>Tipo<select id="admin-data-type"><option value="">Todos</option>${Object.entries(
              isMaintenance ? maintenanceTypes : types,
            )
              .map(([id, label]) => `<option value="${id}">${label}</option>`)
              .join("")}</select></label>`
          : ""
      }<label>Ordenar<select id="admin-data-sort"><option value="name">${isMaintenance ? "Equipo A–Z" : "Nombre A–Z"}</option><option value="name-desc">Nombre Z–A</option><option value="recent">Actualización reciente</option>${view === "assets" ? '<option value="due">Próxima revisión</option>' : ""}</select></label>${button("Limpiar", "reset")}</div><div class="master-catalog-caption"><h2>${esc(title)}</h2><span id="admin-data-count" role="status" aria-live="polite"></span></div><div id="admin-data-results" class="${isMaintenance ? "admin-maintenance-list" : "master-catalog-grid admin-registry-grid"}"></div><div id="admin-data-pagination" class="master-pagination"></div></section>`;
    $("#admin-data-status").value =
      isMaintenance &&
      !["all", "open", "completed", "closed"].includes(p.status)
        ? "open"
        : p.status;
    p.status = $("#admin-data-status").value;
    $("#admin-data-sort").value = p.sort;
    if ($("#admin-data-type")) $("#admin-data-type").value = p.type;
    for (const [id, key] of [
      ["search", "query"],
      ["status", "status"],
      ["sort", "sort"],
      ["type", "type"],
    ]) {
      const control = $(`#admin-data-${id}`);
      control?.addEventListener(
        id === "search" ? "input" : "change",
        (event) => {
          p[key] = event.target.value;
          p.page = 1;
          persist();
          results();
        },
      );
    }
    results();
    return true;
  }
  function refresh(view) {
    if (current !== view || dialog.open) return;
    const next = JSON.stringify([getState().catalog, getState().maintenance]);
    if (next !== fingerprint) {
      fingerprint = next;
      if (!main.contains(document.activeElement)) render(view);
      else results();
    }
  }
  function taxonomyMetrics(data) {
    const kind = kindFor[current];
    return `<div class="govern-summary admin-compact-metrics"><article><span>Registros activos</span><b>${format(data.filter((row) => row.active !== false).length)}</b></article><article><span>Productos vinculados</span><b>${format(data.reduce((total, row) => total + countProducts(kind, row.id, row.name), 0))}</b></article><article><span>Con imagen vinculada</span><b>${format(data.filter((row) => imagePath(row.imageUrl)).length)}</b></article></div>`;
  }
  function assetMetrics(data) {
    return `<div class="govern-summary admin-compact-metrics"><article><span>Equipos registrados</span><b>${format(data.length)}</b></article><article><span>Vinculados a la simulación</span><b>${format(data.filter((row) => row.deviceId).length)}</b></article><article><span>Intervenciones abiertas</span><b>${format((getState().maintenance || []).filter((row) => !["COMPLETED", "CANCELLED", "REJECTED"].includes(row.state)).length)}</b></article></div>`;
  }
  function maintenanceMetrics(data) {
    return `<div class="govern-summary admin-compact-metrics"><article><span>Por autorizar</span><b>${format(data.filter((row) => ["REQUESTED", "PENDING"].includes(row.state)).length)}</b></article><article><span>En intervención o espera segura</span><b>${format(data.filter((row) => ["IN_PROGRESS", "WAITING_SAFE"].includes(row.state)).length)}</b></article><article><span>Finalizados</span><b>${format(data.filter((row) => row.state === "COMPLETED").length)}</b></article></div>`;
  }
  function filtered() {
    const p = prefs(),
      query = p.query.trim().toLocaleLowerCase("es");
    return records()
      .filter((row) => {
        const asset = current === "maintenance" ? assetById(row.assetId) : null;
        const search = [
          row.name,
          row.code,
          row.description,
          row.manufacturer,
          row.model,
          row.serialNumber,
          row.reason,
          row.technician,
          asset?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase("es");
        const state =
          current === "maintenance"
            ? row.state
            : row.active === false
              ? "inactive"
              : "active";
        const status =
          p.status === "all" ||
          state === p.status ||
          (p.status === "open" &&
            !["COMPLETED", "CANCELLED", "REJECTED"].includes(state)) ||
          (p.status === "completed" && state === "COMPLETED") ||
          (p.status === "closed" && ["CANCELLED", "REJECTED"].includes(state));
        return (
          search.includes(query) && status && (!p.type || p.type === row.type)
        );
      })
      .sort((a, b) =>
        p.sort === "recent"
          ? (Date.parse(b.requestedAt || b.createdAt || b.updatedAt || "") ||
              0) -
              (Date.parse(a.requestedAt || a.createdAt || a.updatedAt || "") ||
                0) ||
            String(b.id).localeCompare(String(a.id), "es", { numeric: true })
          : p.sort === "due"
            ? String(
                a.nextMaintenanceAt || a.nextDueDate || "9999",
              ).localeCompare(
                String(b.nextMaintenanceAt || b.nextDueDate || "9999"),
              )
            : String(a.name || assetById(a.assetId)?.name || "").localeCompare(
                String(b.name || assetById(b.assetId)?.name || ""),
                "es",
              ) * (p.sort === "name-desc" ? -1 : 1),
      );
  }
  function results() {
    const p = prefs(),
      rows = filtered(),
      pages = Math.max(1, Math.ceil(rows.length / p.size));
    p.page = Math.max(1, Math.min(p.page, pages));
    const offset = (p.page - 1) * p.size;
    $("#admin-data-count").textContent =
      `${format(rows.length)} de ${format(records().length)} registros`;
    $("#admin-data-results").innerHTML =
      rows
        .slice(offset, offset + p.size)
        .map((row, index) =>
          current === "maintenance"
            ? maintenanceCard(row, index)
            : current === "assets"
              ? assetCard(row, index)
              : taxonomyCard(row, index),
        )
        .join("") ||
      `<div class="master-empty"><span>${icon("search")}</span><h3>No hay coincidencias</h3><p>Cambia los filtros o crea un registro para comenzar.</p>${button("Restablecer filtros", "reset")}</div>`;
    if (current === "assets")
      $("#admin-data-results")
        .querySelectorAll(".admin-asset-card")
        .forEach((card, index) => {
          const row = rows[offset + index];
          if (row.active !== false)
            card
              .querySelector(".master-record-footer .row-actions")
              .insertAdjacentHTML(
                "beforeend",
                button("Configurar", "configure", row.id, "primary small"),
              );
          if (row.pendingSettings)
            card
              .querySelector(".master-record-footer")
              .insertAdjacentHTML(
                "beforebegin",
                '<div class="admin-asset-alert">' +
                  icon("shield") +
                  " Reglas pendientes de aplicación segura</div>",
              );
        });
    $("#admin-data-pagination").innerHTML =
      `<span>${rows.length ? offset + 1 : 0}–${Math.min(offset + p.size, rows.length)} de ${rows.length}</span><label>Por página<select id="admin-page-size" aria-label="Registros por página"><option value="24">24</option><option value="48">48</option></select></label><div>${button("← Anterior", "page", String(p.page - 1), "secondary small", p.page <= 1 ? "disabled" : "")}<span aria-label="Página actual">${p.page} / ${pages}</span>${button("Siguiente →", "page", String(p.page + 1), "secondary small", p.page >= pages ? "disabled" : "")}</div>`;
    $("#admin-page-size").value = String(p.size);
    $("#admin-page-size").onchange = (event) => {
      p.size = Number(event.target.value);
      p.page = 1;
      persist();
      results();
    };
  }
  function taxonomyCard(row, index) {
    const kind = kindFor[current],
      products = countProducts(kind, row.id, row.name);
    return `<article class="master-record ${row.active === false ? "is-inactive" : ""}" style="--arrival:${Math.min(index, 8) * 22}ms">${media(row.imageUrl, row.name)}<div class="master-record-content"><div class="admin-card-top">${badge(row.active === false ? "Desactivado" : "Activo", row.active === false ? "INACTIVE" : "AVAILABLE")}<span>${format(products)} productos</span></div><h3>${esc(row.name)}</h3><p class="master-record-subtitle">${esc(row.description || "Sin descripción adicional")}</p><div class="master-record-tags">${kind === "category" ? (row.zoneIds || []).map((zone) => `<span>${esc(zones[zone] || zone)}</span>`).join("") : (row.supplierIds || []).map((id) => `<span>${esc(getState().catalog.suppliers.find((supplier) => supplier.id === id)?.name || "Proveedor desactivado")}</span>`).join("")}</div><div class="master-record-footer"><small>${esc(row.code)}</small><div class="row-actions">${button("Editar", "edit", row.id)}${lifecycleButtons(row)}</div></div></div></article>`;
  }
  function assetCard(row, index) {
    const physical = [
      ...(getState().equipment?.robots || []),
      ...(getState().equipment?.trucks || []),
    ].find((device) => device.id === row.deviceId);
    const open = (getState().maintenance || []).find(
      (job) =>
        job.assetId === row.id &&
        !["COMPLETED", "CANCELLED", "REJECTED"].includes(job.state),
    );
    return `<article class="master-record admin-asset-card ${row.active === false ? "is-inactive" : ""}" style="--arrival:${Math.min(index, 8) * 22}ms">${media(row.imageUrl, row.name)}<div class="master-record-content"><div class="admin-card-top">${badge(statuses[row.status], row.status)}<span>${row.deviceId ? "Vinculado al centro" : "Planificado"}</span></div><span class="master-record-kicker">${esc(types[row.type] || row.type)}</span><h3>${esc(row.name)}</h3><p class="master-record-subtitle">${esc([row.manufacturer, row.model].filter(Boolean).join(" · "))}</p><dl class="master-record-facts"><div><dt>Serie</dt><dd>${esc(row.serialNumber || "Por registrar")}</dd></div><div><dt>Capacidad</dt><dd>${format(row.capacityCases)} cajas · ${format(row.capacityKg)} kg</dd></div><div><dt>Intervalo de revisión</dt><dd>${format(row.serviceIntervalHours)} horas</dd></div><div><dt>Próxima revisión</dt><dd>${day(row.nextMaintenanceAt || row.nextDueDate)}</dd></div>${physical ? `<div><dt>Estado operativo</dt><dd>${esc(physical.status || physical.state || "Disponible")}</dd></div>` : ""}</dl>${open ? `<div class="admin-asset-alert">${icon("shield")} ${esc(maintenanceStates[open.state] || open.state)}</div>` : ""}<div class="master-record-footer"><small>${esc(row.code)}</small><div class="row-actions">${button("Ficha", "detail", row.id)}${button("Editar", "edit", row.id)}${lifecycleButtons(row)}</div></div></div></article>`;
  }
  function maintenanceCard(row, index) {
    const asset = assetById(row.assetId),
      canApprove = ["REQUESTED", "PENDING"].includes(row.state),
      canStart = row.state === "APPROVED",
      canComplete = row.state === "IN_PROGRESS";
    return `<article class="admin-maintenance-card" style="--arrival:${Math.min(index, 8) * 22}ms"><div class="admin-maintenance-photo">${image(asset?.imageUrl, asset?.name || "Equipo")}</div><div class="admin-maintenance-body"><div class="admin-card-top">${badge(maintenanceStates[row.state], row.state)}<small>${esc(maintenanceTypes[row.type] || row.type)}</small></div><h3>${esc(asset?.name || "Equipo registrado")}</h3><p>${esc(row.reason)}</p><div class="admin-maintenance-meta"><span>${icon("calendar")} ${day(row.scheduledDate || row.requestedAt)}</span><span>${esc(row.technician || "Técnico por asignar")}</span>${row.state === "COMPLETED" ? `<span>S/ ${Number(row.cost || 0).toFixed(2)}</span>` : ""}</div>${row.state === "WAITING_SAFE" ? '<p class="admin-safe-note">La carga y la misión actual se conservan hasta que el equipo termine y pueda detenerse de forma segura.</p>' : ""}<div class="row-actions">${button("Detalle", "job-detail", row.id)}${canApprove ? button("Autorizar", "approve", row.id, "primary small") + button("Rechazar", "reject", row.id, "danger-ghost small") : ""}${canStart ? button("Iniciar parada segura", "start", row.id, "primary small") : ""}${canComplete ? button("Registrar cierre", "complete", row.id, "primary small") : ""}${["REQUESTED", "PENDING", "APPROVED"].includes(row.state) ? button("Cancelar", "cancel", row.id, "ghost small") : ""}</div></div><div class="admin-job-stepper" aria-label="Progreso del mantenimiento">${["Solicitado", "Autorizado", "Parada segura", "Intervención", "Cierre"].map((step, i) => `<span class="${i <= ({ REQUESTED: 0, PENDING: 0, APPROVED: 1, WAITING_SAFE: 2, IN_PROGRESS: 3, COMPLETED: 4 }[row.state] ?? -1) ? "is-complete" : ""}"><i></i>${step}</span>`).join("")}</div></article>`;
  }
  function checkGroup(name, title, options, chosen) {
    return `<fieldset class="admin-choice-group"><legend>${esc(title)}</legend>${options.map(([id, label]) => `<label class="form-check"><input type="checkbox" name="${name}" value="${esc(id)}" ${(chosen || []).includes(id) ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</fieldset>`;
  }
  function photoFields(
    row,
    placeholder = "/images/representations/archivo.webp",
  ) {
    return `<label class="master-image-field">Imagen<input name="imageUrl" value="${esc(row?.imageUrl || "")}" maxlength="180" placeholder="${placeholder}"><small class="field-hint">Selecciona un archivo de la biblioteca o sube una fotografía.</small></label>`;
  }
  function photoPreview(row) {
    return `<div class="master-asset-preview"><div class="master-preview-image" id="master-preview-image">${image(row?.imageUrl, row?.name || "Vista previa")}</div><div><strong>Vista previa de la imagen</strong><p>Se conserva completa, sin deformar su proporción.</p><span id="master-preview-status" class="muted">${imagePath(row?.imageUrl) ? "Imagen vinculada" : "Selecciona o sube una imagen"}</span></div></div>`;
  }
  function bindPhoto(form, kind) {
    const input = form.elements.imageUrl;
    if (input) {
      input.required = true;
      const library = [
        ...new Map(
          Object.values(getState().catalog)
            .flatMap((rows) => (Array.isArray(rows) ? rows : []))
            .filter((row) => imagePath(row.imageUrl))
            .map((row) => [row.imageUrl, row]),
        ).values(),
      ];
      const picker = document.createElement("label");
      picker.className = "master-asset-picker";
      picker.innerHTML = `Biblioteca de imágenes<select aria-label="Elegir imagen"><option value="">Seleccionar una imagen…</option>${library.map((row) => `<option value="${esc(row.imageUrl)}" ${row.imageUrl === input.value ? "selected" : ""}>${esc(row.name)}</option>`).join("")}</select>`;
      input.closest("label").before(picker);
      picker.querySelector("select").addEventListener("change", (event) => {
        if (!event.target.value) return;
        input.value = event.target.value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    input?.addEventListener("input", () => {
      $("#master-preview-image", form).innerHTML = image(
        input.value.trim(),
        form.elements.name?.value || "Vista previa",
      );
      $("#master-preview-status", form).textContent = imagePath(
        input.value.trim(),
      )
        ? "Imagen local vinculada"
        : "Selecciona una ruta local válida";
    });
    bindCatalogUpload({ form, api: ctx.api, kind });
  }
  function formShell(title, content, row, note, action) {
    showDialog(
      title,
      `<form id="admin-data-form" class="master-edit-form"><div class="form-grid">${content}</div>${photoPreview(row)}${message(note)}<p class="form-error" id="admin-data-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" type="button" data-admin-data="close">Cancelar</button><button class="btn primary">${esc(action)}</button></div></form>`,
      "ADMINISTRACIÓN · DATOS MAESTROS",
    );
    return $("#admin-data-form", dialog);
  }
  function registryForm(id) {
    const row = records().find((item) => item.id === id),
      kind = kindFor[current],
      rev = revision(),
      state = getState();
    let fields =
      field(
        "code",
        "Código de referencia",
        row?.code,
        'required maxlength="40" pattern="[A-Za-z0-9_-]+"',
      ) +
      field(
        "name",
        "Nombre",
        row?.name,
        'required minlength="3" maxlength="100"',
      );
    if (kind === "asset") {
      fields +=
        select(
          "type",
          "Clase de equipo",
          Object.entries(types),
          row?.type || "AMR",
        ) +
        field(
          "manufacturer",
          "Fabricante",
          row?.manufacturer,
          'required minlength="2" maxlength="100"',
        ) +
        field(
          "model",
          "Modelo",
          row?.model,
          'required minlength="2" maxlength="100"',
        ) +
        field(
          "serialNumber",
          "Número de serie único",
          row?.serialNumber,
          'required minlength="3" maxlength="80"',
        ) +
        field(
          "commissionDate",
          "Fecha de alta o puesta en servicio",
          row?.commissionDate || today(),
          'required type="date"',
        ) +
        field(
          "warrantyUntil",
          "Garantía hasta (opcional)",
          row?.warrantyUntil,
          'type="date"',
        ) +
        field(
          "serviceIntervalHours",
          "Intervalo de revisión (horas)",
          row?.serviceIntervalHours ?? 250,
          'required type="number" min="1" max="10000" step="1"',
        ) +
        field(
          "capacityCases",
          "Capacidad nominal (cajas)",
          row?.capacityCases ?? 24,
          'required type="number" min="1" max="1000" step="1"',
        ) +
        field(
          "capacityKg",
          "Capacidad nominal (kg)",
          row?.capacityKg ?? 1500,
          'required type="number" min="1" max="100000" step="0.01"',
        ) +
        select(
          "temperatureClass",
          "Entorno compatible",
          [
            ["AMBIENT", "Temperatura ambiente"],
            ["CHILLED", "Refrigerado"],
            ["FROZEN", "Congelado"],
            ["MULTI", "Varias temperaturas"],
          ],
          row?.temperatureClass || "AMBIENT",
        ) +
        `<label class="admin-wide-field">Notas técnicas<textarea name="notes" maxlength="500" rows="3">${esc(row?.notes || "")}</textarea></label>`;
    } else {
      fields +=
        `<label class="admin-wide-field">Descripción<textarea name="description" maxlength="500" rows="3">${esc(row?.description || "")}</textarea></label>` +
        (kind === "category"
          ? checkGroup(
              "zoneIds",
              "Conservaciones compatibles · selecciona al menos una",
              Object.entries(zones),
              row?.zoneIds,
            )
          : checkGroup(
              "supplierIds",
              "Proveedores oficiales o distribuidores vinculados",
              state.catalog.suppliers
                .filter(
                  (s) => s.active !== false || row?.supplierIds?.includes(s.id),
                )
                .map((s) => [s.id, s.name]),
              row?.supplierIds,
            ));
    }
    fields += photoFields(row);
    const form = formShell(
      `${row ? "Editar" : "Crear"} ${names[current][1]}`,
      fields,
      row,
      kind === "asset"
        ? row?.deviceId
          ? "Este activo está vinculado a un equipo físico. La edición de la ficha no cambia su geometría ni su capacidad operativa. El mantenimiento requiere autorización y parada segura."
          : "Un activo nuevo se registra como planificado. No aparece un robot ni una ruta en el mapa automáticamente: su puesta en servicio requiere una integración física compatible."
        : "Archivar conserva el historial. El sistema bloquea cambios que dejen productos activos sin una marca, categoría o proveedor compatible.",
      `Guardar ${names[current][1]}`,
    );
    if (row?.deviceId) {
      form.elements.type.disabled = true;
      form.elements.capacityCases.readOnly = true;
      form.elements.capacityKg.readOnly = true;
      form.elements.temperatureClass.disabled = true;
    }
    bindPhoto(form, kind);
    if (kind === "asset" && !row) {
      let defaultImage = `/images/representations/equipment-${form.elements.type.value.toLowerCase()}.webp`;
      form.elements.imageUrl.value = defaultImage;
      form.elements.imageUrl.dispatchEvent(
        new Event("input", { bubbles: true }),
      );
      form.elements.type.addEventListener("change", () => {
        const next = `/images/representations/equipment-${form.elements.type.value.toLowerCase()}.webp`;
        if (
          !form.elements.imageUrl.value ||
          form.elements.imageUrl.value === defaultImage
        ) {
          form.elements.imageUrl.value = next;
          form.elements.imageUrl.dispatchEvent(
            new Event("input", { bubbles: true }),
          );
        }
        defaultImage = next;
      });
    }
    bindForm(
      form,
      async () => {
        const data = Object.fromEntries(new FormData(form));
        if (kind === "asset") {
          for (const key of [
            "serviceIntervalHours",
            "capacityCases",
            "capacityKg",
          ])
            data[key] = Number(data[key]);
          if (row?.deviceId) {
            data.type = row.type;
            data.temperatureClass = row.temperatureClass;
          }
        } else {
          const key = kind === "category" ? "zoneIds" : "supplierIds";
          data[key] = new FormData(form).getAll(key);
          if (!data[key].length)
            throw Object.assign(
              Error("Selecciona al menos una compatibilidad antes de guardar."),
              { fieldErrors: { [key]: "Selecciona al menos una opción." } },
            );
        }
        await command(
          `config.${kind}.${row ? "update" : "create"}`,
          { expectedRevision: rev, ...(row ? { id: row.id } : {}), data },
          "Registro maestro guardado.",
        );
        dialog.close();
        render(current);
      },
      "#admin-data-error",
    );
  }
  function assetConfiguration(id) {
    const asset = assetById(id),
      schema = getState().deviceSettingSchemas?.[asset?.type];
    if (!asset || !schema?.fields) {
      toast(
        "No se pudieron cargar las reglas de este equipo. Actualiza el registro e inténtalo de nuevo.",
        "error",
      );
      return;
    }
    const effective = { ...schema.defaults, ...asset.settings },
      values = { ...effective, ...asset.pendingSettings?.settings },
      rev = revision();
    const taskLabels = {
      PUTAWAY: "Almacenar mercancía recibida",
      PICK: "Recoger mercancía de reserva",
      PICK_TO_PACK: "Llevar a preparación",
      TO_STAGING: "Llevar a consolidación",
      RETURN_TO_QUARANTINE: "Retorno seguro a cuarentena",
      TRUCK_LOAD: "Cargar camión",
      TRUCK_UNLOAD: "Descargar y retirar carga",
      DELIVERY: "Repartir a sucursales",
      RETURN_PICKUP: "Recoger devoluciones",
    };
    const settingLabel = (field, value) =>
      field.type === "boolean"
        ? value
          ? "Habilitada"
          : "Deshabilitada"
        : field.type === "tasks"
          ? (value || []).map((task) => taskLabels[task] || task).join(" · ")
          : field.options?.find((option) => option.value === value)?.label ||
            String(value ?? "—");
    const controls = schema.fields
      .map((setting) => {
        if (setting.type === "boolean")
          return `<label class="admin-setting-switch admin-wide-field"><span><strong>${esc(setting.label)}</strong><small>Admite trabajo nuevo cuando el equipo está disponible y es compatible.</small></span><input type="checkbox" name="${esc(setting.key)}" ${values[setting.key] ? "checked" : ""}><i aria-hidden="true"></i></label>`;
        if (setting.type === "tasks")
          return `<fieldset class="admin-choice-group admin-device-tasks"><legend>${esc(setting.label)}</legend>${(schema.allowedTasks || []).map((task) => `<label class="form-check ${schema.mustKeepTasks?.includes(task) ? "is-locked" : ""}"><input type="checkbox" name="allowedTasks" value="${esc(task)}" ${(values.allowedTasks || []).includes(task) || schema.mustKeepTasks?.includes(task) ? "checked" : ""} ${schema.mustKeepTasks?.includes(task) ? "disabled" : ""}><span>${esc(taskLabels[task] || task)}${schema.mustKeepTasks?.includes(task) ? "<small>Función de seguridad obligatoria</small>" : ""}</span></label>`).join("")}</fieldset>`;
        if (setting.type === "select")
          return select(
            setting.key,
            setting.label,
            (setting.options || []).map((option) => [
              option.value,
              option.label,
            ]),
            values[setting.key],
          );
        return field(
          setting.key,
          setting.label,
          values[setting.key],
          `required type="number" min="${setting.min ?? 0}" max="${setting.max ?? 100}" step="1"`,
        );
      })
      .join("");
    showDialog(
      `Configurar ${asset.name}`,
      `<form id="asset-settings-form" class="master-edit-form"><div class="admin-device-config-hero">${media(asset.imageUrl, asset.name)}<div><span class="master-record-kicker">${esc(types[asset.type])}</span><h3>${esc(asset.name)}</h3><p>${esc([asset.manufacturer, asset.model].filter(Boolean).join(" · "))}</p>${badge(statuses[asset.status], asset.status)}</div></div>${asset.pendingSettings ? message("Existe una configuración pendiente. Los valores actuales siguen vigentes hasta que el equipo alcance una condición segura.", "warning") : ""}<div class="form-grid">${controls}</div><section class="admin-settings-effect"><h3>Aplicación de la configuración</h3><p>${asset.deviceId ? (asset.safeForMaintenance ? "El equipo está libre. Las reglas se aplican al confirmar si conserva su condición segura." : "El equipo tiene actividad. La configuración quedará pendiente y se aplicará al quedar libre, sin abandonar su carga.") : "Este equipo está planificado. Se guardan sus reglas para su futura integración al centro."}</p><dl>${schema.fields.map((setting) => `<div><dt>${esc(setting.label)}</dt><dd>${esc(settingLabel(setting, effective[setting.key]))}</dd></div>`).join("")}</dl><small>Valores efectivos actuales. El perfil de velocidad respeta los límites físicos del escenario; Eco trabaja al 75 % de la velocidad normal.</small></section><p class="form-error" id="asset-settings-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-admin-data="close">Volver</button><button class="btn primary">Guardar configuración</button></div></form>`,
      "EQUIPOS · REGLAS DE FUNCIONAMIENTO",
    );
    const form = $("#asset-settings-form", dialog);
    if (!schema.fields.some((setting) => setting.key === "speedProfile")) {
      form.querySelector(".admin-settings-effect > small").textContent =
        "Parámetros de coordinación del dispositivo simulado. No permiten editar ni omitir sus enclavamientos de seguridad.";
    }
    if (asset.pendingSettings) {
      form
        .querySelectorAll("input,select,textarea")
        .forEach((control) => (control.disabled = true));
      const submit = form.querySelector(".dialog-actions .primary");
      submit.disabled = true;
      submit.textContent = "Pendiente de aplicación segura";
      return;
    }
    bindForm(
      form,
      async () => {
        const settings = Object.fromEntries(
          schema.fields.map((setting) => [
            setting.key,
            setting.type === "boolean"
              ? form.elements.namedItem(setting.key).checked
              : setting.type === "tasks"
                ? [
                    ...form.querySelectorAll('[name="allowedTasks"]:checked'),
                  ].map((input) => input.value)
                : setting.type === "integer"
                  ? Number(form.elements.namedItem(setting.key).value)
                  : form.elements.namedItem(setting.key).value,
          ]),
        );
        if (
          schema.fields.some((setting) => setting.key === "allowedTasks") &&
          !settings.allowedTasks.length
        )
          throw Object.assign(
            Error("Habilita al menos una tarea compatible para este equipo."),
            { fieldErrors: { allowedTasks: "Selecciona al menos una tarea." } },
          );
        if (
          settings.chargeBelowPercent !== undefined &&
          settings.resumeAtPercent < settings.chargeBelowPercent + 30
        )
          throw Object.assign(
            Error(
              "La reanudación debe superar por al menos 30 puntos el umbral de carga.",
            ),
            {
              fieldErrors: {
                resumeAtPercent:
                  "Aumenta la reanudación o reduce el umbral de carga.",
              },
            },
          );
        await command(
          "config.asset.configure",
          { id: asset.id, expectedRevision: rev, settings },
          "Configuración del equipo registrada.",
        );
        dialog.close();
        render(current);
      },
      "#asset-settings-error",
    );
  }
  function assetDetail(id) {
    const row = assetById(id);
    if (!row) return;
    const jobs = (getState().maintenance || []).filter(
      (job) => job.assetId === id,
    );
    showDialog(
      row.name,
      `<div class="admin-asset-detail">${media(row.imageUrl, row.name)}<div>${badge(statuses[row.status], row.status)}<h3>${esc(types[row.type])}</h3><p>${esc([row.manufacturer, row.model].filter(Boolean).join(" · "))}</p><dl class="security-facts">${[
        ["Serie", row.serialNumber],
        ["Puesta en servicio", day(row.commissionDate)],
        ["Garantía", day(row.warrantyUntil)],
        [
          "Capacidad nominal",
          `${format(row.capacityCases)} cajas · ${format(row.capacityKg)} kg`,
        ],
        ["Revisión cada", `${format(row.serviceIntervalHours)} horas`],
        ["Horas de servicio", format(row.serviceHours)],
        ["Próxima revisión", day(row.nextMaintenanceAt || row.nextDueDate)],
        [
          "Vinculación",
          row.deviceId ? "Equipo operativo del centro" : "Registro planificado",
        ],
      ]
        .map(
          ([label, value]) =>
            `<div><dt>${esc(label)}</dt><dd>${esc(value || "Por registrar")}</dd></div>`,
        )
        .join(
          "",
        )}</dl></div></div>${row.notes ? message(row.notes) : ""}<section class="admin-service-history"><h3>Historial técnico</h3>${jobs.map((job) => `<article>${badge(maintenanceStates[job.state], job.state)}<div><strong>${esc(maintenanceTypes[job.type])}</strong><small>${day(job.performedDate || job.scheduledDate || job.requestedAt)} · ${esc(job.technician || "Sin técnico asignado")}</small><p>${esc(job.reason)}</p></div>${button("Abrir", "job-detail", job.id)}</article>`).join("") || '<p class="muted">Aún no hay intervenciones registradas para este activo.</p>'}</section><div class="dialog-actions">${button("Cerrar", "close")}${row.active !== false && row.deviceId ? button("Solicitar mantenimiento", "request", id, "primary") : ""}${lifecycleButtons(row)}</div>`,
      "ACTIVOS · FICHA TÉCNICA",
    );
  }
  function maintenanceForm(action, id) {
    const row = (getState().maintenance || []).find((job) => job.id === id),
      asset = row ? assetById(row.assetId) : assetById(id),
      rev = revision();
    const titles = {
      request: "Solicitar mantenimiento",
      approve: "Autorizar intervención técnica",
      complete: "Registrar cierre técnico",
      start: "Iniciar parada segura",
      reject: "Rechazar solicitud",
      cancel: "Cancelar mantenimiento",
    };
    let fields = "",
      note = "",
      selected = checklistFor(asset).map(([id]) => id);
    if (action === "request") {
      const assets = (getState().catalog.assets || []).filter(
        (item) => item.active !== false && item.deviceId,
      );
      if (!assets.length) {
        toast("No hay activos puestos en servicio para intervenir.", "error");
        return;
      }
      fields =
        select(
          "assetId",
          "Equipo registrado",
          assets.map((item) => [item.id, `${item.name} · ${types[item.type]}`]),
          asset?.id || assets[0].id,
        ) +
        select(
          "type",
          "Clase de intervención",
          Object.entries(maintenanceTypes),
          "PREVENTIVE",
        ) +
        field("scheduledDate", "Fecha prevista (opcional)", "", 'type="date"') +
        `<label class="admin-wide-field">Motivo de la solicitud<textarea name="reason" required minlength="10" maxlength="500" rows="3" placeholder="Describe el síntoma o la revisión requerida."></textarea></label><label class="admin-wide-field">Observaciones (opcional)<textarea name="notes" maxlength="500" rows="3"></textarea></label>`;
      note =
        "La solicitud registra una necesidad técnica. La autorización y la parada segura son pasos posteriores; una carga en traslado no desaparece ni se interrumpe de forma insegura.";
    } else if (action === "approve") {
      fields =
        field(
          "technician",
          "Técnico o empresa responsable",
          row?.technician,
          'required minlength="3" maxlength="100"',
        ) +
        field(
          "scheduledDate",
          "Fecha de intervención",
          row?.scheduledDate || today(),
          'required type="date"',
        ) +
        checkGroup(
          "checklistIds",
          "Alcance de la inspección · selecciona al menos un punto",
          checklistFor(asset),
          selected,
        );
      note = `Se autoriza ${asset?.name || "el equipo"}. El inicio esperará que esté ocioso y libre de cargas antes de permitir la intervención.`;
    } else if (action === "complete") {
      fields =
        field(
          "technician",
          "Responsable que certifica el cierre",
          row?.technician,
          'required minlength="3" maxlength="100"',
        ) +
        field(
          "performedDate",
          "Fecha de intervención realizada",
          today(),
          `required type="date" max="${today()}"`,
        ) +
        field(
          "cost",
          "Coste de la intervención (S/)",
          "0",
          'required type="number" min="0" max="1000000" step="0.01"',
        ) +
        field(
          "nextDueDate",
          "Próxima revisión (opcional)",
          "",
          `type="date" min="${today()}"`,
        ) +
        `<fieldset class="admin-choice-group"><legend>Certificación técnica · completa todos los puntos autorizados</legend>${(row?.checklist || []).map((item) => `<label class="form-check"><input type="checkbox" name="completed" value="${esc(item.id)}" required><span>${esc(item.label || checklist.find(([id]) => id === item.id)?.[1] || item.id)}</span></label>`).join("")}</fieldset><label class="admin-wide-field">Trabajo realizado y hallazgos<textarea name="notes" required minlength="10" maxlength="1000" rows="4" placeholder="Documenta lo revisado, los hallazgos, repuestos y resultado de la prueba."></textarea></label>`;
      note =
        "Confirma el trabajo realmente registrado en el escenario. Sólo un cierre completo libera el equipo; esta acción no recupera fallos operativos ajenos a la intervención.";
    } else if (action === "start") {
      fields = `<div class="admin-wide-field">${message(`Se iniciará la parada segura de ${asset?.name || "este equipo"}. Si todavía transporta mercancía, esperará a finalizar su misión antes de quedar indisponible.`)}</div>`;
      note =
        "La autorización no desplaza el equipo ni modifica sus existencias. El controlador coordina la espera y conserva las reservas.";
    } else {
      fields = `<label class="admin-wide-field">Motivo de ${action === "reject" ? "rechazo" : "cancelación"}<textarea name="reason" required minlength="10" maxlength="500" rows="3"></textarea></label>`;
      note =
        "La decisión queda registrada en el historial técnico. No se elimina la solicitud.";
    }
    showDialog(
      titles[action],
      `<form id="admin-maintenance-form" class="master-edit-form">${asset ? `<div class="admin-maintenance-subject"><span>${image(asset.imageUrl, asset.name)}</span><div><strong>${esc(asset.name)}</strong><small>${esc(types[asset.type])}</small></div></div>` : ""}<div class="form-grid">${fields}</div>${message(note)}<p class="form-error" id="admin-maintenance-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-admin-data="close">Volver</button><button class="btn ${["reject", "cancel"].includes(action) ? "danger-ghost" : "primary"}">${esc(titles[action])}</button></div></form>`,
      "CONTROL TÉCNICO · TRAZABILIDAD",
    );
    const form = $("#admin-maintenance-form", dialog);
    bindForm(
      form,
      async () => {
        const data = Object.fromEntries(new FormData(form));
        if (action === "approve") {
          const ids = new FormData(form).getAll("checklistIds");
          if (ids.length < 2)
            throw Object.assign(
              Error(
                "Selecciona al menos dos puntos técnicos que debe cubrir la intervención.",
              ),
              {
                fieldErrors: {
                  checklistIds: "Autoriza al menos dos puntos de inspección.",
                },
              },
            );
          data.checklist = checklistFor(asset)
            .filter(([id]) => ids.includes(id))
            .map(([id, label]) => ({ id, label }));
          delete data.checklistIds;
        }
        if (action === "complete") {
          const checked = new FormData(form).getAll("completed");
          data.checklist = (row.checklist || []).map((item) => ({
            id: item.id,
            done: checked.includes(item.id),
          }));
          data.cost = Number(data.cost);
          delete data.completed;
        }
        await command(
          `maintenance.${action}`,
          {
            ...data,
            ...(action === "request"
              ? {}
              : { id: row.id, expectedRevision: rev }),
          },
          action === "complete"
            ? "Intervención documentada y cierre registrado."
            : "Decisión técnica registrada.",
        );
        dialog.close();
        render(current);
      },
      "#admin-maintenance-error",
    );
  }
  function jobDetail(id) {
    const job = (getState().maintenance || []).find((row) => row.id === id),
      asset = assetById(job?.assetId);
    if (!job) return;
    showDialog(
      "Detalle de intervención",
      `<div class="admin-maintenance-subject"><span>${image(asset?.imageUrl, asset?.name || "Equipo")}</span><div><strong>${esc(asset?.name || "Equipo registrado")}</strong><small>${esc(maintenanceTypes[job.type])}</small></div>${badge(maintenanceStates[job.state], job.state)}</div><div class="admin-job-detail"><dl class="security-facts">${[
        ["Motivo", job.reason],
        ["Solicitado", day(job.requestedAt)],
        ["Programado", day(job.scheduledDate)],
        ["Técnico responsable", job.technician || "Por asignar"],
        ["Realizado", day(job.performedDate)],
        ["Coste", `S/ ${Number(job.cost || 0).toFixed(2)}`],
        ["Próxima revisión", day(job.nextDueDate)],
      ]
        .map(
          ([label, value]) =>
            `<div><dt>${esc(label)}</dt><dd>${esc(value || "No registrado")}</dd></div>`,
        )
        .join(
          "",
        )}</dl><h3>Alcance autorizado</h3><ul class="admin-checklist-read">${(job.checklist || []).map((item) => `<li class="${item.done ? "is-done" : ""}"><span>${item.done ? "✓" : "○"}</span>${esc(item.label || checklist.find(([id]) => id === item.id)?.[1] || item.id)}</li>`).join("") || "<li>Pendiente de autorización técnica.</li>"}</ul>${job.notes ? `<h3>Trabajo y observaciones</h3><p class="admin-preserve-lines">${esc(job.notes)}</p>` : ""}${job.rejectionReason || job.cancellationReason ? message(job.rejectionReason || job.cancellationReason, "warning") : ""}</div><div class="dialog-actions">${button("Cerrar", "close")}</div>`,
      "MANTENIMIENTO · HISTORIAL",
    );
  }
  function confirmRegistry(action, id) {
    const row = records().find((item) => item.id === id),
      kind = kindFor[current],
      rev = revision();
    if (!row) return;
    const labels = {
      activate: "Activar",
      deactivate: "Desactivar",
      delete: "Eliminar",
    };
    const explanation =
      action === "delete"
        ? "El registro se retirará del catálogo y no podrá reactivarse. Se conserva la referencia de sus operaciones anteriores. Los equipos integrados al circuito físico mantienen su ficha protegida."
        : action === "deactivate"
          ? "No admitirá nuevas operaciones. Puede activarse después; las dependencias y maniobras en curso se comprobarán antes de confirmar."
          : "Volverá a estar disponible si conserva sus compatibilidades y condiciones de seguridad.";
    showDialog(
      `${labels[action]} registro`,
      `<form id="admin-data-confirm">${message(`${row.name}. ${explanation}`, action === "activate" ? "" : "warning")}<label>Motivo (opcional)<textarea name="reason" rows="2" maxlength="250"></textarea></label><p class="form-error" id="admin-confirm-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-admin-data="close">Volver</button><button class="btn ${action === "activate" ? "primary" : "danger-ghost"}">${labels[action]}</button></div></form>`,
      "ADMINISTRACIÓN · CONFIRMACIÓN",
    );
    bindForm(
      $("#admin-data-confirm", dialog),
      async (form) => {
        await command(
          `config.${kind}.${action}`,
          { id, expectedRevision: rev, reason: form.elements.reason.value },
          action === "delete"
            ? "Registro eliminado."
            : action === "activate"
              ? "Registro activado."
              : "Registro desactivado.",
        );
        dialog.close();
        render(current);
      },
      "#admin-confirm-error",
    );
  }

  function exportCurrent() {
    const rows = filtered();
    if (current === "maintenance")
      downloadCsv(
        "DonPepe-mantenimiento.csv",
        [
          "Equipo",
          "Tipo",
          "Estado",
          "Motivo",
          "Técnico",
          "Programado",
          "Realizado",
          "Coste",
          "Próxima revisión",
        ],
        rows.map((row) => [
          assetById(row.assetId)?.name,
          maintenanceTypes[row.type],
          maintenanceStates[row.state],
          row.reason,
          row.technician,
          row.scheduledDate,
          row.performedDate,
          row.cost,
          row.nextDueDate,
        ]),
      );
    else if (current === "assets")
      downloadCsv(
        "DonPepe-activos.csv",
        [
          "Código",
          "Nombre",
          "Tipo",
          "Fabricante",
          "Modelo",
          "Serie",
          "Estado",
          "Puesta en servicio",
          "Garantía",
          "Intervalo (horas)",
          "Cajas",
          "Kg",
          "Entorno",
        ],
        rows.map((row) => [
          row.code,
          row.name,
          types[row.type],
          row.manufacturer,
          row.model,
          row.serialNumber,
          statuses[row.status],
          row.commissionDate,
          row.warrantyUntil,
          row.serviceIntervalHours,
          row.capacityCases,
          row.capacityKg,
          row.temperatureClass,
        ]),
      );
    else
      downloadCsv(
        `DonPepe-${current}.csv`,
        ["Código", "Nombre", "Descripción", "Productos", "Estado", "Imagen"],
        rows.map((row) => [
          row.code,
          row.name,
          row.description,
          countProducts(kindFor[current], row.id, row.name),
          row.active === false ? "Desactivado" : "Activo",
          row.imageUrl,
        ]),
      );
  }
  document.addEventListener("click", (event) => {
    const control = event.target.closest("[data-admin-data]");
    if (!control || !views.includes(current) || control.disabled) return;
    const { adminData: action, id } = control.dataset;
    if (action === "close") dialog.close();
    else if (action === "new") registryForm();
    else if (action === "edit") registryForm(id);
    else if (action === "configure") assetConfiguration(id);
    else if (action === "detail") assetDetail(id);
    else if (action === "job-detail") jobDetail(id);
    else if (
      ["request", "approve", "complete", "start", "reject", "cancel"].includes(
        action,
      )
    )
      maintenanceForm(action, id);
    else if (["deactivate", "activate", "delete"].includes(action))
      confirmRegistry(action, id);
    else if (action === "export") exportCurrent();
    else if (action === "page") {
      prefs().page = Number(id);
      persist();
      results();
      $("#admin-data-results").scrollIntoView({
        block: "start",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
    } else if (action === "reset") {
      preferences[current] = {
        query: "",
        status: current === "maintenance" ? "open" : "active",
        type: "",
        sort: "recent",
        page: 1,
        size: prefs().size,
      };
      persist();
      render(current);
    }
  });
  return { render, refresh, views };
}
