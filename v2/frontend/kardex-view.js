import { formatLima, formatCalendarDate } from "./time.js";
import movementPresentation from "../core/movement-presentation.js";
import identification from "../core/inventory-identification.js";

export function createKardexView({
  api,
  getState,
  getUser,
  esc,
  photo,
  num,
  showDialog,
  pageHeading,
  icon,
  onProduct,
}) {
  let root,
    sequence = 0,
    filterTimer,
    rows = [],
    response;
  const filters = {
    query: "",
    skuId: "",
    lot: "",
    type: "",
    fromDate: "",
    toDate: "",
    page: 1,
    pageSize: 25,
  };
  const date = (value) => formatLima(value, { timeStyle: "medium" });
  const scope = (value) =>
    ({
      CD: "Centro de distribución",
      WAREHOUSE: "Centro de distribución",
      STORE: "Tienda",
      TRANSPORT: "Transporte",
      DEVICE: "Equipo de manipulación",
      EXTERNAL: "Origen o destino externo",
      OPENING: "Saldo de apertura",
      DISCREPANCY: "Diferencia pendiente",
      UNKNOWN: "Ubicación pendiente de registrar",
      SUPPLIER: "Proveedor",
      TRANSIT: "En tránsito",
      CONSUMED: "Venta",
      WRITE_OFF: "Baja",
    })[value] ||
    value ||
    "—";
  function queryString() {
    return new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== ""),
    ).toString();
  }
  function mount(container, initial = {}) {
    clearTimeout(filterTimer);
    root = container;
    Object.assign(filters, initial);
    const skus = getState().catalog.skus;
    root.innerHTML =
      pageHeading(
        "CONTROL DE EXISTENCIAS",
        "Movimientos de inventario",
        getUser().role === "store"
          ? "Entradas, ventas, devoluciones y diferencias de tu tienda."
          : "El recorrido documentado de cada carga, desde la entrada hasta su destino.",
        `<button class="btn secondary" id="kardex-refresh">${icon("arrows")} Actualizar</button><a class="btn primary" id="kardex-export" href="/api/inventory/movements/export.csv">Exportar CSV</a>`,
      ) +
      `<aside class="kardex-reading-note"><strong>Cómo leer estos movimientos</strong><p>Un movimiento puede afectar a una carga de varias cajas. El código HU identifica esa carga agrupada; el lote identifica su fabricación. Los traslados no crean existencias nuevas.</p></aside><section class="panel kardex-panel"><form id="kardex-filters" class="kardex-filters"><label class="kardex-search">Buscar<input type="search" name="query" value="${esc(filters.query)}" maxlength="120" placeholder="Producto, carga, documento o ubicación…"></label><label>Tipo de movimiento<select name="type"><option value="">Todos los movimientos</option></select></label><details class="kardex-advanced"><summary>Filtros detallados</summary><div><label>Producto<select name="skuId"><option value="">Todos los productos</option>${skus.map((item) => `<option value="${esc(item.id)}" ${filters.skuId === item.id ? "selected" : ""}>${esc(item.name)}</option>`).join("")}</select></label><label>Lote de proveedor<input name="lot" value="${esc(filters.lot)}" maxlength="80" placeholder="Código del lote"></label><label>Desde<input type="date" name="fromDate" value="${esc(filters.fromDate)}"></label><label>Hasta<input type="date" name="toDate" value="${esc(filters.toDate)}"></label><button class="btn secondary small" type="button" id="kardex-clear">Limpiar filtros</button></div></details><p class="form-error" id="kardex-error" role="alert" hidden></p></form><div class="kardex-result-heading"><strong id="kardex-count" role="status">Consultando movimientos…</strong><span id="kardex-updated" class="muted"></span></div><div id="kardex-results" aria-busy="true"></div><footer class="kardex-pagination"><button class="btn secondary small" type="button" data-kardex-page="-1">Anterior</button><span id="kardex-page"></span><button class="btn secondary small" type="button" data-kardex-page="1">Siguiente</button></footer></section><details class="kardex-coverage"><summary>Alcance del registro</summary><p id="kardex-coverage-note">Se conservan los movimientos confirmados y los saldos de apertura identificados.</p></details>`;
    root
      .querySelector(".kardex-result-heading")
      .append(root.querySelector("#kardex-clear"));
    root.querySelector("#kardex-filters").onsubmit = (event) => {
      event.preventDefault();
    };
    const filterForm = root.querySelector("#kardex-filters");
    const updateFilters = (event) => {
      if (!event.target.name) return;
      if (event.type === "input" && event.target.tagName === "SELECT") return;
      const data = new FormData(filterForm);
      Object.assign(filters, Object.fromEntries(data), { page: 1 });
      filters.query = filters.query.trim();
      filters.lot = filters.lot.trim();
      clearTimeout(filterTimer);
      // Invalidate an in-flight response immediately, before the short typing
      // delay, so it cannot replace the result for newer text.
      sequence++;
      if (event.target.type === "search" || event.target.name === "lot")
        filterTimer = setTimeout(() => {
          if (filterForm.isConnected) load();
        }, 120);
      else load();
    };
    filterForm.oninput = updateFilters;
    filterForm.onchange = updateFilters;
    root.querySelector("#kardex-refresh").onclick = load;
    root.querySelector("#kardex-clear").onclick = () => {
      Object.assign(filters, {
        query: "",
        skuId: "",
        lot: "",
        type: "",
        fromDate: "",
        toDate: "",
        page: 1,
      });
      mount(root);
    };
    root.querySelectorAll("[data-kardex-page]").forEach(
      (button) =>
        (button.onclick = () => {
          filters.page += Number(button.dataset.kardexPage);
          load();
        }),
    );
    root.querySelector("#kardex-results").onclick = (event) => {
      const button = event.target.closest("[data-kardex-id]");
      if (button)
        detail(rows.find((row) => row.id === button.dataset.kardexId));
    };
    load();
  }
  async function load() {
    const container = root,
      run = ++sequence,
      errorBox = container.querySelector("#kardex-error");
    errorBox.hidden = true;
    for (const field of container.querySelectorAll(
      '[name="fromDate"],[name="toDate"]',
    ))
      field.removeAttribute("aria-invalid");
    if (
      filters.fromDate &&
      filters.toDate &&
      filters.fromDate > filters.toDate
    ) {
      errorBox.textContent =
        "La fecha inicial no puede ser posterior a la fecha final.";
      errorBox.hidden = false;
      container
        .querySelector("[name=fromDate]")
        .setAttribute("aria-invalid", "true");
      container
        .querySelector("[name=toDate]")
        .setAttribute("aria-invalid", "true");
      container
        .querySelector("#kardex-results")
        .setAttribute("aria-busy", "false");
      container.querySelector("#kardex-refresh").disabled = false;
      return;
    }
    container
      .querySelector("#kardex-results")
      .setAttribute("aria-busy", "true");
    container.querySelector("#kardex-refresh").disabled = true;
    try {
      const data = await api(`/api/inventory/movements?${queryString()}`);
      if (run !== sequence || !container.isConnected || root !== container)
        return;
      response = data;
      rows = data.items || [];
      filters.page = data.page;
      const typeSelect = container.querySelector("[name=type]");
      const typeOptions =
        '<option value="">Todos los movimientos</option>' +
        (data.types || [])
          .map((type) => {
            const id =
              typeof type === "string"
                ? type
                : type.id || type.type || type.value;
            const label =
              typeof type === "string"
                ? type
                : type.label || type.typeLabel || id;
            return `<option value="${esc(id)}" ${id === filters.type ? "selected" : ""}>${esc(label)}</option>`;
          })
          .join("");
      if (typeSelect.innerHTML !== typeOptions)
        typeSelect.innerHTML = typeOptions;
      container.querySelector("#kardex-count").textContent =
        `${num(data.total)} movimientos${Object.entries(filters).some(([key, value]) => !["page", "pageSize"].includes(key) && value) ? " encontrados" : " registrados"}`;
      container.querySelector("#kardex-updated").textContent =
        `Actualizado ${new Intl.DateTimeFormat("es-PE", { timeStyle: "short", timeZone: "America/Lima" }).format(new Date())}`;
      container.querySelector("#kardex-export").href =
        `/api/inventory/movements/export.csv?${queryString()}`;
      container.querySelector("#kardex-coverage-note").textContent =
        data.coverage?.note ||
        "Movimientos confirmados desde la activación del registro. Un saldo de apertura no reconstruye movimientos anteriores.";
      container.querySelector("#kardex-results").innerHTML = rows.length
        ? `<div class="table-scroll"><table class="kardex-table"><thead><tr><th>Qué ocurrió y cuándo</th><th>Producto, lote y carga</th><th>De dónde salió y adónde llegó</th><th>Cantidad del movimiento</th><th>Documento</th><th scope="col" aria-label="Acción">Acción</th></tr></thead><tbody>${rows
            .map((row) => {
              const item = getState().catalog.skus.find(
                (item) => item.id === row.skuId,
              ) || { name: row.skuName, imageUrl: row.imageUrl };
              return `<tr><td><strong>${esc(row.explanation?.title || row.typeLabel || row.type)}</strong><small>${esc(date(row.at))}</small><span class="movement-effect" data-effect="${esc(row.explanation?.effect || "MOVE")}">${esc(row.explanation?.effectLabel || "Movimiento confirmado")}</span></td><td><div class="kardex-product">${photo(item, "kardex-product-image")}<div><strong>${esc(row.skuName || item.name)}</strong><small>Lote <span class="record-id">${esc(row.lot || "Sin lote")}</span></small>${row.huId ? `<small>Carga <span class="record-id">${esc(row.huId)}</span></small>` : ""}</div></div></td><td><div class="kardex-route"><span>${esc(row.from?.label || scope(row.from?.scope))}</span><i aria-hidden="true">↳</i><strong>${esc(row.to?.label || scope(row.to?.scope))}</strong></div></td><td><strong class="kardex-cases">${num(row.cases)}</strong><small>${row.cases === 1 ? "caja" : "cajas"}</small>${identification.packaging(row.cases, item.unitsPerCase).units !== null ? `<small class="kardex-unit-count">${num(row.cases * item.unitsPerCase)} unidades de producto</small>` : ""}</td><td><span class="document-code">${esc(row.documentId || "Movimiento interno")}</span>${row.deviceId ? `<small>${esc(row.deviceId)}</small>` : ""}</td><td><button type="button" class="btn secondary small" data-kardex-id="${esc(row.id)}">Detalle</button></td></tr>`;
            })
            .join("")}</tbody></table></div>`
        : '<div class="empty-state"><h2>Sin movimientos para esta consulta</h2><p>Cambia el período o elimina un filtro para ampliar la búsqueda.</p></div>';
      container.querySelector("#kardex-page").textContent =
        `${data.page} / ${Math.max(1, data.pages || 1)}`;
      container.querySelectorAll("[data-kardex-page]").forEach((button) => {
        button.disabled =
          Number(button.dataset.kardexPage) < 0
            ? data.page <= 1
            : data.page >= (data.pages || 1);
      });
    } catch (error) {
      if (run !== sequence || !container.isConnected || root !== container)
        return;
      errorBox.textContent = error.message;
      errorBox.hidden = false;
      container.querySelector("#kardex-count").textContent =
        "No se pudo actualizar el registro";
    } finally {
      if (run === sequence && container.isConnected && root === container) {
        container
          .querySelector("#kardex-results")
          .setAttribute("aria-busy", "false");
        container.querySelector("#kardex-refresh").disabled = false;
      }
    }
  }
  function detail(row) {
    if (!row) return;
    const explanation =
      row.explanation || movementPresentation.explainMovement(row);
    const item = getState().catalog.skus.find(
      (item) => item.id === row.skuId,
    ) || { name: row.skuName, imageUrl: row.imageUrl };
    const field = (label, value) =>
      `<div class="info-row"><span>${esc(label)}</span><strong>${esc(value ?? "—")}</strong></div>`;
    row = {
      ...row,
      actorId: ["AUTOMATION", "SYSTEM"].includes(row.actorId)
        ? "Motor de automatización"
        : row.actorId,
      actorRole:
        {
          admin: "Administrador",
          operations: "Jefe de operaciones",
          store: "Gestor de tienda",
          system: "Motor de automatización",
          SYSTEM: "Motor de automatización",
          automation: "Motor de automatización",
        }[row.actorRole] || row.actorRole,
    };
    showDialog(
      explanation.title,
      `<section class="movement-story"><span class="movement-effect" data-effect="${esc(explanation.effect)}">${esc(explanation.effectLabel)}</span><p>${esc(explanation.summary)}</p></section><div class="product-spotlight">${photo(item)}<div><span class="eyebrow">${esc(row.brand || item.brand || "")}</span><strong>${esc(row.skuName || item.name)}</strong><small>${esc(date(row.at))}</small></div></div><div class="kardex-detail-route"><article><span>Origen</span><strong>${esc(row.from?.label || "—")}</strong><small>${esc(scope(row.from?.scope))}</small></article><span aria-hidden="true">→</span><article><span>Destino</span><strong>${esc(row.to?.label || "—")}</strong><small>${esc(scope(row.to?.scope))}</small></article></div><div class="movement-packaging"><strong>${num(row.cases)} ${row.cases === 1 ? "caja" : "cajas"}${Number.isInteger(item.unitsPerCase) ? ` × ${num(item.unitsPerCase)} unidades = ${num(row.cases * item.unitsPerCase)} unidades de producto` : ""}</strong><p>${row.huId ? `La carga ${esc(row.huId)} agrupa las cajas de este movimiento. No es el número de serie de una caja individual.` : "La cantidad corresponde a las cajas involucradas en el hecho registrado."}</p></div><div class="kardex-detail-grid">${field("Cajas involucradas en este hecho", num(row.cases))}${field("Lote de proveedor", row.lot)}${row.huId ? field("Identificador de carga agrupada", row.huId) : ""}${row.parentHuId ? field("Carga de origen", row.parentHuId) : ""}${field("Vencimiento", formatCalendarDate(row.expiry))}${field("Documento", row.documentId)}${row.externalReference ? field("Referencia de venta o salida", row.externalReference) : ""}${field("Equipo", row.deviceId)}${field("Responsable", row.actorName || row.actorId || "Motor de automatización")}${row.beforeCases !== null && row.beforeCases !== undefined ? field("Saldo de este lote en la ubicación antes", num(row.beforeCases)) : ""}${row.afterCases !== null && row.afterCases !== undefined ? field("Saldo de este lote en la ubicación después", num(row.afterCases)) : ""}${row.networkBalanceCases !== null && row.networkBalanceCases !== undefined ? field("Saldo de este lote en toda la red", num(row.networkBalanceCases)) : ""}</div>${row.reason ? `<div class="notice"><strong>Motivo registrado</strong><p>${esc(row.reason)}</p></div>` : ""}<p class="movement-balance-note"><strong>Ubicación del saldo:</strong> ${esc(explanation.balanceLocation)}. ${esc(explanation.balanceMeaning)}</p><details class="kardex-technical"><summary>Referencias técnicas del registro</summary>${field("Movimiento", row.id)}${field("Producto", row.skuId)}${field("Origen", row.from?.id)}${field("Destino", row.to?.id)}${field("Rol del responsable", row.actorRole)}<p>Los saldos corresponden a este producto, lote y vencimiento inmediatamente después del evento; no son el saldo actual de todos los productos.</p></details>`,
      "INVENTARIO · MOVIMIENTO CONFIRMADO",
    );
    if (onProduct) {
      const back = document.createElement("button");
      back.type = "button";
      back.className = "btn secondary trace-product-link";
      back.textContent = "Ver recorrido completo de este producto";
      back.onclick = () => onProduct(row.skuId);
      document.querySelector("#dialog-body")?.append(back);
    }
    if (
      row.from?.id === row.to?.id &&
      row.sourceState &&
      row.targetState &&
      row.sourceState !== row.targetState
    )
      document
        .querySelector("#dialog-body .kardex-detail-route")
        ?.insertAdjacentHTML(
          "afterend",
          '<p class="field-hint">La carga permanece en el mismo equipo o ubicación; cambia su estado operativo.</p>',
        );
  }
  return { mount, refresh: load, detail };
}
