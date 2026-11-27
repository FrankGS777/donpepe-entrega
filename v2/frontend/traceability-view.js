import { formatLima, formatCalendarDate, limaDate } from "./time.js";
import identification from "../core/inventory-identification.js";

export function createProductTraceability(ctx) {
  const {
    api,
    getState,
    getUser,
    esc,
    photo,
    num,
    showDialog,
    getHus,
    locationName,
    status,
    onMovement,
  } = ctx;
  async function open(skuId, options = {}) {
    const state = getState(),
      product = state.catalog.skus.find((item) => item.id === skuId);
    if (!product) return;
    const isStore = getUser().role === "store";
    const hus = getHus().filter(
      (item) => item.skuId === skuId && item.cases > 0,
    );
    const stock = (
      state.inventory?.storeStock ||
      state.storeStock ||
      []
    ).filter((item) => item.skuId === skuId && item.cases > 0);
    const lots = identification.lotOverview(hus, stock, product.unitsPerCase);
    const summary = state.inventorySummary?.products?.find(
      (item) => item.skuId === skuId,
    );
    const sum = (key) => lots.reduce((n, lot) => n + lot[key], 0);
    const casesLabel = (n) => `${num(n)} ${n === 1 ? "caja" : "cajas"}`;
    const contents = (n) => {
      const p = identification.packaging(n, product.unitsPerCase);
      return p.units === null
        ? ""
        : `${casesLabel(n)} × ${num(p.unitsPerCase)} unidades = ${num(p.units)} unidades de producto`;
    };
    const total = (label, n) =>
      `<article><strong>${num(n)} <small>cajas</small></strong><span>${label}</span></article>`;
    const balances = isStore
      ? total("En mi tienda", sum("storeCases"))
      : total("En el centro", summary?.warehouseCases ?? sum("centerCases")) +
        total("En tránsito", summary?.inTransitCases ?? sum("transitCases")) +
        total("En tiendas", summary?.branchCases ?? sum("storeCases"));
    const discrepancy = summary?.discrepancyCases ?? sum("discrepancyCases");
    const position = (item) =>
      item.kind === "stock"
        ? state.catalog.branches.find((branch) => branch.id === item.branchId)
            ?.name || "Tienda"
        : item.locationLabel || locationName(item.locationId || item.robotId);
    const recordCard = (item) =>
      `<article class="trace-load"><header><div><span class="trace-kicker">${item.kind === "stock" ? "Existencias recibidas en tienda" : "Unidad de carga"}</span><strong>${item.kind === "stock" ? esc(position(item)) : `<span class="record-id">${esc(item.id)}</span>`}</strong></div><b>${casesLabel(item.cases)}</b></header><p class="trace-packaging">${esc(contents(item.cases))}</p>${item.expiry && item.expiry < limaDate(state.clock.now) ? '<p class="notice warning">Lote vencido: bloqueado para venta y despacho. Retiro automático a cuarentena.</p>' : ""}<dl><div><dt>Lote de fabricante</dt><dd>${esc(item.lot || "Sin referencia registrada")}</dd></div><div><dt>Vencimiento</dt><dd>${esc(formatCalendarDate(item.expiry))}</dd></div>${item.kind === "load" ? `<div class="trace-load-location"><dt>Ubicación y custodia</dt><dd>${esc(position(item))}</dd></div><div><dt>Estado</dt><dd>${esc(status(item.status || item.state))}</dd></div>` : `<div><dt>Pedido de origen</dt><dd>${esc(item.orderId || "Sin referencia")}</dd></div><div><dt>Recibido</dt><dd>${esc(formatLima(item.receivedAt))}</dd></div>`}${item.sscc ? `<div class="trace-load-location"><dt>Etiqueta logística</dt><dd class="record-id">${esc(item.sscc)}</dd></div>` : ""}${item.parentId ? `<div class="trace-load-location"><dt>Separada de la carga</dt><dd class="record-id">${esc(item.parentId)}</dd></div>` : ""}</dl><button type="button" class="text-button" data-trace-find="${esc(item.kind === "stock" ? item.lot || "" : item.id)}">Ver sus movimientos ↗</button></article>`;
    const lotCards = lots
      .map(
        (lot) =>
          `<details class="trace-lot"><summary><span><small>Lote de fabricante</small><strong class="record-id">${esc(lot.lot || "Sin referencia registrada")}</strong><small>Vence ${esc(formatCalendarDate(lot.expiry))}</small></span><span class="trace-lot-quantity"><b>${casesLabel(lot.cases)}</b><small>${lot.units === null ? "" : `${num(lot.units)} unidades de producto`}</small></span></summary><div class="trace-lot-body"><div class="trace-lot-distribution">${!isStore ? total("En el centro", lot.centerCases) + total("En tránsito", lot.transitCases) : ""}${total(isStore ? "En mi tienda" : "En tiendas", lot.storeCases)}${lot.discrepancyCases ? total("Diferencia pendiente", lot.discrepancyCases) : ""}</div><p class="trace-reading-note">${esc(contents(lot.cases))}. ${lot.loadCount ? `${num(lot.loadCount)} ${lot.loadCount === 1 ? "carga agrupa" : "cargas agrupan"} las cajas controladas en el centro o en tránsito.` : "Cantidades recibidas, agrupadas por tienda y pedido."}</p>${lot.records.map(recordCard).join("")}</div></details>`,
      )
      .join("");
    const records = lots.flatMap((lot) => lot.records);
    showDialog(
      "Trazabilidad del producto",
      `<section class="traceability-view"><div class="product-spotlight">${photo(product)}<div><strong>${esc(product.name)}</strong><small>${esc([product.brand, product.category].filter(Boolean).join(" · "))}</small><span class="trace-product-pack">1 caja contiene ${num(product.unitsPerCase)} unidades de producto</span></div></div><details class="trace-code-guide"><summary>Producto, lote y carga: qué identifica cada código</summary><dl><div><dt>Producto · ${esc(product.code || product.id)}</dt><dd>Identifica el artículo y su presentación. El código comercial del envase es ${esc(product.barcode || "el registrado en su ficha")}.</dd></div><div><dt>Lote de fabricante</dt><dd>Agrupa producto de una misma fabricación; conserva su vencimiento durante los traslados.</dd></div><div><dt>Carga · HU</dt><dd>Identificador interno de una agrupación que se manipula junta. Una carga puede contener 12 cajas; ese código identifica al grupo, no a cada caja por separado.</dd></div></dl><p>No se asignan números de serie individuales a las cajas que no fueron identificadas de esa manera en la recepción.</p></details><section class="trace-current"><div class="trace-section-heading"><h3>Existencias actuales</h3><small>Al abrir la ficha · ${esc(formatLima(state.clock.now))}</small></div><div class="trace-balances">${balances}</div>${discrepancy ? `<p class="trace-reading-note">Además, ${casesLabel(discrepancy)} con diferencia de recepción pendiente; no están confirmadas como recibidas.</p>` : ""}</section><div class="trace-tabs" role="tablist" aria-label="Consultar trazabilidad"><button type="button" role="tab" id="trace-tab-lots" data-trace-tab="lots" aria-controls="trace-lots">Lotes <span>${lots.length}</span></button><button type="button" role="tab" id="trace-tab-loads" data-trace-tab="loads" aria-controls="trace-loads">${isStore ? "Recepciones" : "Cargas y ubicaciones"} <span>${records.length}</span></button><button type="button" role="tab" id="trace-tab-history" data-trace-tab="history" aria-controls="trace-history">Movimientos</button></div><section id="trace-lots" class="trace-tab-panel" role="tabpanel" aria-labelledby="trace-tab-lots"><p class="trace-reading-note">Cantidad actual por lote y vencimiento. Abre un lote para consultar sus cargas y ubicaciones.</p><div class="trace-lots">${lotCards || '<div class="trace-empty"><h4>Sin lotes detallados en este ámbito</h4><p>Consulta los movimientos registrados para conocer su historial.</p></div>'}</div></section><section id="trace-loads" class="trace-tab-panel" role="tabpanel" aria-labelledby="trace-tab-loads" hidden><label class="trace-filter"><span>Buscar ${isStore ? "lote o pedido" : "carga, lote o ubicación"}</span><input type="search" class="trace-load-search" maxlength="120" placeholder="Escribe para filtrar…"></label><div class="trace-loads">${records.map(recordCard).join("") || '<p class="trace-reading-note">No hay cargas actuales detalladas para este perfil.</p>'}</div><p class="trace-load-empty" hidden>No hay coincidencias para esta búsqueda.</p></section><section id="trace-history" class="trace-tab-panel trace-history" role="tabpanel" aria-labelledby="trace-tab-history" hidden><div class="trace-history-head"><h3>Movimientos confirmados</h3><span class="trace-count" role="status"></span></div><p class="trace-reading-note">Del más reciente al más antiguo. Cada fila describe un hecho: trasladar una carga conserva sus cajas, no añade stock nuevo.</p><label class="trace-filter"><span>Buscar en el recorrido</span><input type="search" class="trace-history-search" maxlength="120" placeholder="Lote, carga, documento, equipo o ubicación…"></label><p class="trace-error form-error" role="alert" hidden></p><div class="trace-events" aria-busy="true"><p class="muted">Consultando movimientos confirmados…</p></div><footer class="trace-pagination"><button type="button" class="btn secondary small" data-trace-page="-1">Anterior</button><span></span><button type="button" class="btn secondary small" data-trace-page="1">Siguiente</button></footer></section></section>`,
      "INVENTARIO · LOTES Y CARGAS",
    );
    const root = document.querySelector("#dialog-body .traceability-view");
    if (!root) return;
    let page = 1,
      query = "",
      sequence = 0,
      timer,
      rows = [],
      loaded = false;
    const error = root.querySelector(".trace-error"),
      list = root.querySelector(".trace-events");
    function tab(name) {
      root.style.setProperty(
        "--trace-head-height",
        `${document.querySelector("#dialog .dialog-head")?.getBoundingClientRect().height || 90}px`,
      );
      root.querySelectorAll("[data-trace-tab]").forEach((button) => {
        const active = button.dataset.traceTab === name;
        button.setAttribute("aria-selected", String(active));
        button.tabIndex = active ? 0 : -1;
      });
      root.querySelectorAll(".trace-tab-panel").forEach((panel) => {
        panel.hidden = panel.id !== `trace-${name}`;
      });
      if (name === "history" && !loaded) load();
    }
    async function load() {
      const run = ++sequence;
      error.hidden = true;
      list.setAttribute("aria-busy", "true");
      try {
        const data = await api(
          `/api/inventory/movements?${new URLSearchParams({ skuId, query, page, pageSize: 12 })}`,
        );
        if (!root.isConnected || run !== sequence) return;
        loaded = true;
        page = data.page;
        rows = data.items;
        root.querySelector(".trace-count").textContent =
          `${num(data.total)} movimientos`;
        list.innerHTML =
          rows
            .map(
              (row, index) =>
                `<article class="trace-event"><header><time>${esc(formatLima(row.at, { timeStyle: "medium" }))}</time><strong>${casesLabel(row.cases)}</strong></header><h4>${esc(row.explanation?.title || row.typeLabel)}</h4><p class="trace-event-lot">Lote <span class="record-id">${esc(row.lot || "Sin referencia")}</span>${row.huId ? ` · Carga <span class="record-id">${esc(row.huId)}</span>` : ""}</p><div class="trace-event-route"><div><span>Origen</span><strong>${esc(row.from.label)}</strong></div><span aria-hidden="true">→</span><div><span>Destino</span><strong>${esc(row.to.label)}</strong></div></div><footer><span class="movement-effect" data-effect="${esc(row.explanation?.effect || "MOVE")}">${esc(row.explanation?.effectLabel || "Movimiento confirmado")}</span><button type="button" class="text-button" data-trace-event="${index}">Ver detalle</button></footer>${row.documentId ? `<small>Documento <span class="record-id">${esc(row.documentId)}</span></small>` : ""}</article>`,
            )
            .join("") ||
          '<div class="trace-empty"><h4>Sin movimientos para esta búsqueda</h4><p>Elimina el texto para ampliar la consulta.</p></div>';
        root.querySelector(".trace-pagination > span").textContent =
          `${page} / ${data.pages}`;
        root.querySelector('[data-trace-page="-1"]').disabled = page <= 1;
        root.querySelector('[data-trace-page="1"]').disabled =
          page >= data.pages;
      } catch (failure) {
        if (root.isConnected && run === sequence) {
          loaded = false;
          error.textContent = failure.message;
          error.hidden = false;
          list.innerHTML =
            '<p class="muted">No se pudo obtener el historial. Cambia la búsqueda o vuelve a la pestaña para reintentar.</p>';
        }
      } finally {
        if (root.isConnected && run === sequence)
          list.setAttribute("aria-busy", "false");
      }
    }
    root.querySelector(".trace-history-search").oninput = (event) => {
      query = event.target.value.trim();
      page = 1;
      sequence++;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (root.isConnected) load();
      }, 120);
    };
    root.querySelector(".trace-load-search").oninput = (event) => {
      const term = event.target.value.trim().toLocaleLowerCase("es");
      let count = 0;
      root.querySelectorAll(".trace-loads .trace-load").forEach((card) => {
        card.hidden = !card.textContent.toLocaleLowerCase("es").includes(term);
        if (!card.hidden) count++;
      });
      root.querySelector(".trace-load-empty").hidden =
        count > 0 || records.length === 0;
    };
    root.onclick = (event) => {
      const selected = event.target.closest("[data-trace-tab]");
      if (selected) {
        tab(selected.dataset.traceTab);
        return;
      }
      const find = event.target.closest("[data-trace-find]");
      if (find) {
        clearTimeout(timer);
        query = find.dataset.traceFind;
        page = 1;
        root.querySelector(".trace-history-search").value = query;
        loaded = true;
        tab("history");
        load();
        return;
      }
      const movement = event.target.closest("[data-trace-event]");
      if (movement) {
        onMovement(rows[Number(movement.dataset.traceEvent)]);
        return;
      }
      const button = event.target.closest("[data-trace-page]");
      if (button && !button.disabled) {
        clearTimeout(timer);
        page += Number(button.dataset.tracePage);
        load();
      }
    };
    root.querySelector(".trace-tabs").onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
        return;
      const buttons = [...root.querySelectorAll("[data-trace-tab]")],
        current = buttons.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? buttons.length - 1
            : (current +
                (event.key === "ArrowRight" ? 1 : -1) +
                buttons.length) %
              buttons.length;
      tab(buttons[index].dataset.traceTab);
      buttons[index].focus();
    };
    tab(options.tab === "history" ? "history" : "lots");
  }
  return { open };
}
