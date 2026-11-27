import {
  limaDate,
  addLimaDays,
  formatLima,
  formatCalendarDate,
  newestFirst,
} from "./time.js";

const CLOSED = new Set([
  "RECEIVED",
  "RECEIVED_WITH_DIFFERENCE",
  "CANCELLED",
  "CANCELLED_AFTER_PREPARATION",
]);
const RECEIVED = new Set(["RECEIVED", "RECEIVED_WITH_DIFFERENCE"]);
const textKey = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

// Tienda has its own browsing, ordering and inventory workspace. It uses the
// same authorized commands as the other clients; it never edits stock locally.
export function createStorePortal(ctx) {
  const {
    main,
    getState,
    getUser,
    esc,
    icon,
    photo,
    num,
    badge,
    showDialog,
    command,
    dialog,
    formIssue,
    toast,
  } = ctx;
  const filters = {},
    quantities = new Map();
  let current = "overview",
    signature = "",
    draftLoaded = false,
    page = 1;
  const state = () => getState(),
    user = () => getUser();
  const branch = () =>
    state().catalog.branches.find((row) => row.id === user().branchId) || {};
  const storeName = () =>
    (branch().name || "Mi tienda").replace(/^DonPepe[\s·–—-]*/i, "");
  const storeTitle = () => {
    const [first, ...rest] = storeName().split(/\s+/);
    return `<span>${esc(first)}</span>${rest.length ? ` <em>${esc(rest.join(" "))}</em>` : ""}`;
  };
  const sku = (id) => state().catalog.skus.find((row) => row.id === id);
  const today = () => limaDate(state().clock.now);
  const maxCases = () => state().storePolicy?.maxOrderCases || 120;
  const cartKey = () => `donpepe.store.basket.${user().id}.${user().branchId}`;
  const total = () =>
    [...quantities.values()].reduce((n, value) => n + value, 0);
  const activeOrders = () =>
    newestFirst(state().orders.filter((row) => !CLOSED.has(row.status)));
  const stock = (id) =>
    (state().storeStock || []).filter(
      (row) => row.skuId === id && row.cases > 0,
    );
  const usable = (id) =>
    stock(id)
      .filter((row) => !row.expiry || row.expiry >= today())
      .reduce((n, row) => n + row.cases, 0);
  const count = (id) => stock(id).reduce((n, row) => n + row.cases, 0);
  const button = (label, action, id = "", cls = "secondary") =>
    `<button type="button" class="btn ${cls}" data-store-action="${action}" data-id="${esc(id)}">${label}</button>`;
  const link = (label, to, cls = "secondary") =>
    `<a class="btn ${cls}" href="#${to}">${label}</a>`;
  const empty = (title, detail, action = "") =>
    `<div class="store-empty">${icon("package")}<h3>${esc(title)}</h3><p>${esc(detail)}</p>${action}</div>`;
  const heading = (eyebrow, title, detail, action = "") =>
    `<section class="page-heading store-page-heading"><h1>${title}</h1><div class="heading-actions">${action}</div></section>`;
  const metric = (value, label, detail) =>
    `<article class="store-number"><strong>${num(value)}</strong><div><b>${label}</b></div></article>`;
  const stepper = (id) =>
    `<div class="store-quantity-control"><div class="store-stepper" role="group" aria-label="Cajas de ${esc(sku(id)?.name)}">${button("−", "less", id, "store-step")}<input type="number" inputmode="numeric" min="0" max="${maxCases() - total() + (quantities.get(id) || 0)}" step="1" value="${quantities.get(id) || 0}" data-store-quantity="${esc(id)}" aria-label="Cajas de ${esc(sku(id)?.name)}" aria-describedby="store-quantity-error-${esc(id)}">${button("+", "more", id, "store-step")}</div><small class="store-quantity-error" id="store-quantity-error-${esc(id)}" role="alert" hidden></small></div>`;

  function save() {
    try {
      sessionStorage.setItem(cartKey(), JSON.stringify([...quantities]));
    } catch {}
  }
  function loadDraft() {
    if (draftLoaded) return;
    draftLoaded = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(cartKey()) || "[]");
      if (Array.isArray(saved))
        for (const [id, amount] of saved.slice(0, 12)) {
          if (
            sku(id)?.active !== false &&
            sku(id) &&
            Number.isInteger(amount) &&
            amount > 0 &&
            total() + amount <= maxCases()
          )
            quantities.set(id, amount);
        }
    } catch {}
  }
  function nav(view) {
    loadDraft();
    let dock = document.querySelector("#store-navigation");
    if (!dock) {
      dock = document.createElement("nav");
      dock.id = "store-navigation";
      dock.className = "store-navigation";
      dock.setAttribute("aria-label", "Espacio de tienda");
      document.querySelector(".workspace").append(dock);
    }
    const entries = [
      ["overview", "store", "Mi tienda"],
      ["shop", "package", "Reponer"],
      ["orders", "truck", "Pedidos"],
      ["inventory", "layers", "Existencias"],
      ["stores", "arrows", "Entregas"],
      ["kardex", "clipboard", "Movimientos"],
      ["finance", "clipboard", "Documentos"],
    ];
    // Preserve the actual links while quantity fields commit on blur. Replacing
    // the dock between pointerdown and click silently cancelled navigation.
    if (!dock.querySelector("a"))
      dock.innerHTML = entries
        .map(
          ([id, glyph, title]) =>
            `<a href="#${id}">${icon(glyph)}<span>${title}</span></a>`,
        )
        .join("");
    for (const [id] of entries) {
      const entry = dock.querySelector(`a[href="#${id}"]`);
      entry.classList.toggle("active", view === id);
      if (view === id) entry.setAttribute("aria-current", "page");
      else entry.removeAttribute("aria-current");
    }
    const shopping = dock.querySelector('a[href="#shop"]');
    let counter = shopping.querySelector("b");
    if (total()) {
      if (!counter) {
        counter = document.createElement("b");
        shopping.append(counter);
      }
      counter.textContent = num(total());
    } else counter?.remove();
    document.querySelector("#workspace-nav").innerHTML = "";
    document.querySelector("#navigation").innerHTML = "";
  }
  function filterBox(
    view,
    { status = false, category = false, brand = false, dates = false } = {},
  ) {
    const f = (filters[view] ||= {
      q: "",
      status: "all",
      category: "all",
      brand: "all",
      from: "",
      to: "",
    });
    const select = (name, label, values) =>
      `<label><span>${label}</span><select data-store-filter="${name}">${values.map(([value, title]) => `<option value="${esc(value)}" ${f[name] === value ? "selected" : ""}>${esc(title)}</option>`).join("")}</select></label>`;
    const values = (name) =>
      [
        ...new Set(
          state()
            .catalog.skus.map((row) => row[name])
            .filter(Boolean),
        ),
      ]
        .sort((a, b) => a.localeCompare(b, "es"))
        .map((value) => [value, value]);
    return `<div class="store-filter-bar" role="search" aria-label="Filtros de ${view === "shop" ? "catálogo" : "registros"}"><label class="store-filter-search"><span>Buscar</span><div>${icon("search")}<input data-store-filter="q" type="search" value="${esc(f.q)}" maxlength="160" placeholder="${view === "orders" || view === "stores" ? "Producto o referencia del pedido" : "Producto, marca o código de barras"}"></div></label>${category ? select("category", "Categoría", [["all", "Todas"], ...values("category")]) : ""}${brand ? select("brand", "Marca", [["all", "Todas"], ...values("brand")]) : ""}${
      status
        ? select(
            "status",
            "Estado",
            view === "inventory"
              ? [
                  ["all", "Todos"],
                  ["available", "Con existencias vigentes"],
                  ["empty", "Por reponer"],
                  ["expiring", "Próximos a vencer"],
                  ["expired", "Con lotes vencidos"],
                ]
              : [
                  ["all", "Todos"],
                  ["active", "En curso"],
                  ["PENDING", "Por autorizar"],
                  ["DISPATCHED", "En camino"],
                  ["ARRIVED", "En destino"],
                  ["received", "Recibidos"],
                  ["cancelled", "Cancelados"],
                ],
          )
        : ""
    }${dates ? `<label><span>Desde · Lima</span><input type="date" data-store-filter="from" value="${esc(f.from)}"></label><label><span>Hasta · Lima</span><input type="date" data-store-filter="to" value="${esc(f.to)}"></label>` : ""}${button("Limpiar", "reset-filters", "", "secondary store-reset")}</div>${f.from && f.to && f.from > f.to ? '<p class="form-error" role="alert">La fecha inicial debe ser anterior o igual a la final.</p>' : ""}`;
  }
  function filteredProducts(view) {
    const f = filters[view] || {};
    return state().catalog.skus.filter(
      (row) =>
        row.active !== false &&
        (f.category === "all" || !f.category || row.category === f.category) &&
        (f.brand === "all" || !f.brand || row.brand === f.brand) &&
        textKey(
          [row.name, row.brand, row.category, row.barcode, row.code].join(" "),
        ).includes(textKey(f.q)) &&
        (!f.status ||
          f.status === "all" ||
          (f.status === "available" && usable(row.id) > 0) ||
          (f.status === "empty" && usable(row.id) === 0) ||
          (f.status === "expired" &&
            stock(row.id).some((lot) => lot.expiry && lot.expiry < today())) ||
          (f.status === "expiring" &&
            stock(row.id).some(
              (lot) =>
                lot.expiry &&
                lot.expiry >= today() &&
                lot.expiry <= addLimaDays(state().clock.now, 7),
            ))),
    );
  }
  function filteredOrders() {
    const f = filters[current] || {};
    if (f.from && f.to && f.from > f.to) return [];
    return newestFirst(state().orders).filter((row) => {
      const day = limaDate(row.createdAt),
        name = [
          row.id,
          row.notes,
          ...row.lines.map((line) => sku(line.skuId)?.name),
        ].join(" ");
      const match =
        !f.status ||
        f.status === "all" ||
        (f.status === "active" && !CLOSED.has(row.status)) ||
        (f.status === "received" && RECEIVED.has(row.status)) ||
        (f.status === "cancelled" && row.status.startsWith("CANCELLED")) ||
        row.status === f.status;
      return (
        textKey(name).includes(textKey(f.q)) &&
        match &&
        (!f.from || day >= f.from) &&
        (!f.to || day <= f.to)
      );
    });
  }
  function miniProducts(order) {
    return `<div class="store-order-products">${order.lines
      .slice(0, 4)
      .map(
        (line) =>
          `<span title="${esc(sku(line.skuId)?.name)}">${photo(sku(line.skuId) || {}, "store-order-photo")}<b>${num(line.cases)}</b></span>`,
      )
      .join(
        "",
      )}${order.lines.length > 4 ? `<small>+${order.lines.length - 4}</small>` : ""}</div>`;
  }
  function orderCard(order, compact = false) {
    const milestones =
      state().orderReadModels?.find((row) => row.orderId === order.id)
        ?.milestones || [];
    return `<article class="store-order-card ${compact ? "compact" : ""}"><div class="card-top"><span class="document-code">${esc(order.id)}</span>${badge(order.status)}</div><h2>${num(order.lines.reduce((n, row) => n + row.cases, 0))} cajas · ${order.lines.length} productos</h2><p class="store-record-time">${icon("clipboard")} ${esc(formatLima(order.createdAt))}</p>${miniProducts(order)}${
      !compact
        ? `<div class="store-delivery-track" aria-label="Progreso de entrega">${[
            "Solicitado",
            "Preparación",
            "En camino",
            "Recibido",
          ]
            .map((label, index) => {
              const active =
                order.status === "PENDING"
                  ? 0
                  : RECEIVED.has(order.status)
                    ? 3
                    : ["DISPATCHED", "ARRIVED"].includes(order.status)
                      ? 2
                      : 1;
              return `<span class="${index <= active && !order.status.startsWith("CANCELLED") ? "done" : ""}"><i></i>${label}</span>`;
            })
            .join(
              "",
            )}</div>${order.requestedByDate ? `<p class="store-note">Necesario para el ${esc(formatCalendarDate(order.requestedByDate))}</p>` : ""}${order.notes ? `<p class="store-note">${esc(order.notes)}</p>` : ""}${milestones.filter((row) => row.at).length ? `<small class="muted">Último hito: ${esc(formatLima(milestones.filter((row) => row.at).at(-1).at))}</small>` : ""}`
        : ""
    }<div class="store-card-actions"><button class="btn secondary" data-action="open-order" data-id="${esc(order.id)}">Ver seguimiento ${icon("arrows")}</button>${RECEIVED.has(order.status) && order.lines.some((line) => line.receivedCases > 0) ? `<button class="text-button" data-action="new-return" data-id="${esc(order.id)}">Solicitar devolución</button>` : ""}</div></article>`;
  }
  function productCard(product, preview = false) {
    return `<article class="store-catalog-card"><div class="store-product-stage">${photo(product, "store-product-photo")}</div><div class="store-product-body"><span class="eyebrow">${esc(product.category || "Catálogo")}</span><h2>${esc(product.name)}</h2><p>${num(product.unitsPerCase)} unidades por caja</p><div class="store-product-bottom"><span><b>${num(usable(product.id))}</b><small>cajas vigentes en tienda</small></span>${preview ? link("Elegir", "shop") : stepper(product.id)}</div></div></article>`;
  }
  function home() {
    const shop = branch(),
      active = activeOrders(),
      lots = (state().storeStock || []).filter((row) => row.cases > 0),
      soon = lots.filter(
        (row) => row.expiry && row.expiry <= addLimaDays(state().clock.now, 7),
      );
    return `<section class="store-hero"><div class="store-hero-copy"><h1>${storeTitle()}</h1>${shop.address ? `<p>${esc(shop.address)}</p>` : ""}<div class="store-hero-actions">${link(`Preparar reposición ${icon("package")}`, "shop", "primary")}${link("Seguir mis pedidos ↗", "orders", "store-quiet")}</div></div><div class="store-hero-art">${photo(shop, "store-hero-photo").replace('loading="lazy"', 'loading="eager" fetchpriority="high"')}</div></section><section class="store-number-strip" aria-label="Estado de mi tienda">${metric(
      lots.reduce((n, row) => n + row.cases, 0),
      "cajas en tienda",
      "Existencias recibidas",
    )}${metric(active.length, "pedidos en curso", "Centro y transporte")}${metric(
      soon.reduce((n, row) => n + row.cases, 0),
      "cajas por revisar",
      "Vencimiento en 7 días o anterior",
    )}</section><div class="store-home-columns${soon.length ? " has-alerts" : ""}"><section class="store-surface"><div class="store-section-title"><div><h2>Próximas entregas</h2></div><a href="#orders">Ver todas ↗</a></div>${
      active.length
        ? `<div class="store-delivery-list">${active
            .slice(0, 2)
            .map((row) => orderCard(row, true))
            .join("")}</div>`
        : empty(
            "Tu próxima reposición empieza aquí",
            "Explora productos por marca y añade las cajas que necesita tu sucursal.",
            link("Abrir catálogo", "shop", "primary"),
          )
    }</section>${soon.length ? `<aside class="store-surface store-attention"><h2>Vencimientos por revisar</h2><p>${num(soon.length)} lotes · ${num(soon.reduce((n, lot) => n + lot.cases, 0))} cajas</p>${link("Revisar lotes", "inventory", "primary")}</aside>` : ""}</div><section class="store-editorial"><div class="store-section-title"><div><h2>Productos</h2></div><a href="#shop">Explorar catálogo ↗</a></div><div class="store-product-grid store-preview-grid">${state()
      .catalog.skus.filter((row) => row.active !== false)
      .slice(0, 4)
      .map((row) => productCard(row, true))
      .join("")}</div></section>`;
  }
  function basket() {
    return `<aside class="store-basket"><div class="store-basket-heading"><span class="eyebrow">Solicitud</span><strong>${num(total())}<small> cajas</small></strong><p>${quantities.size} de 12 productos · máximo ${num(maxCases())} cajas</p></div><div class="store-basket-lines">${quantities.size ? [...quantities].map(([id, amount]) => `<div>${photo(sku(id) || {}, "store-basket-photo")}<span><b>${esc(sku(id)?.name || "Producto no disponible")}</b><small>${num(amount)} cajas</small></span>${button("×", "remove", id, "store-remove")}</div>`).join("") : `<div class="store-basket-empty">${icon("package")}<p>Añade productos a la solicitud.</p></div>`}</div><div class="store-basket-footer">${button(`Revisar solicitud ${icon("arrows")}`, "checkout", "", "primary wide")}${quantities.size ? button("Vaciar selección", "clear-cart", "", "store-quiet small") : ""}</div></aside>`;
  }
  function catalog() {
    const list = filteredProducts("shop"),
      pages = Math.max(1, Math.ceil(list.length / 12));
    page = Math.min(page, pages);
    return `${heading("REPOSICIÓN A TU RITMO", "Reponer productos", "Productos del catálogo del centro, organizados por marca y categoría.")}${filterBox("shop", { category: true, brand: true })}<div class="store-shopping-layout"><section><div class="store-results-meta"><span>${num(list.length)} productos</span></div><div class="store-product-grid">${
      list
        .slice((page - 1) * 12, page * 12)
        .map((row) => productCard(row))
        .join("") ||
      empty(
        "No encontramos ese producto",
        "Prueba otra marca o elimina un filtro.",
      )
    }</div>${pagination(pages)}</section>${basket()}</div><p class="store-inline-message" id="store-inline-message" role="status" aria-live="polite"></p>`;
  }
  function pagination(pages) {
    return `<div class="store-pagination">${button("← Anterior", "previous-page")}<span>Página ${page} de ${pages}</span>${button("Siguiente →", "next-page", String(pages))}</div>`;
  }
  function inventory() {
    const list = filteredProducts("inventory"),
      pages = Math.max(1, Math.ceil(list.length / 12));
    page = Math.min(page, pages);
    const returns=state().expiry?.automaticReturns?.filter(row=>row.state!=="QUARANTINED") || [];
    return `${heading("EXISTENCIAS DE TU SUCURSAL", "Existencias", "Consulta cajas vigentes, lotes y fechas antes de registrar salidas o devoluciones.", link("Reponer productos +", "shop", "primary"))}${returns.length ? `<aside class="notice warning">${num(returns.reduce((n,row)=>n+row.cases,0))} cajas vencidas apartadas para recogida automática. <a href="#stores">Seguir retiro ↗</a></aside>` : ""}${filterBox("inventory", { category: true, status: true })}<div class="store-results-meta"><span>${num(list.length)} productos</span><a href="#kardex">Ver cada movimiento ↗</a></div><div class="store-stock-grid">${
      list
        .slice((page - 1) * 12, page * 12)
        .map((product) => {
          const lots = newestFirst(stock(product.id)),
            valid = usable(product.id),
            expired = count(product.id) - valid;
          return `<article class="store-stock-card"><div class="store-stock-heading">${photo(product, "store-stock-photo")}<div><h2>${esc(product.name)}</h2><small>${num(product.unitsPerCase)} unidades por caja</small></div><strong class="store-stock-number">${num(valid)}<small>cajas vigentes</small></strong></div>${expired ? `<p class="store-expiry-alert">${icon("shield")} ${num(expired)} cajas vencidas: salida bloqueada.</p>` : ""}<details class="store-lot-detail"><summary>${lots.length ? `${lots.length} lotes registrados` : "Sin lotes recibidos"}</summary>${lots.map((lot) => `<div><span><b>Lote ${esc(lot.lot || "Sin referencia")}</b><small>Pedido ${esc(lot.orderId || "registrado")}</small></span><span><b>${num(lot.cases)} cajas</b><small>Vence ${esc(formatCalendarDate(lot.expiry))}</small></span></div>`).join("")}</details><div class="store-card-actions">${valid ? `<button class="btn secondary small" data-action="consume" data-sku="${esc(product.id)}" data-branch="${esc(user().branchId)}">Registrar salida</button>` : link("Solicitar reposición", "shop", "primary small")}<button class="text-button" data-action="sku-detail" data-id="${esc(product.id)}">Ver trazabilidad ↗</button></div></article>`;
        })
        .join("") ||
      empty(
        "No hay coincidencias",
        "Cambia el producto, la categoría o el estado.",
      )
    }</div>${pagination(pages)}`;
  }
  function orders() {
    const list = filteredOrders();
    return `${heading("PEDIDOS Y SEGUIMIENTO", "Pedidos", "Los pedidos más recientes aparecen primero. Abre uno para conocer sus hitos y cantidades.", link("Nueva reposición +", "shop", "primary"))}${filterBox("orders", { status: true, dates: true })}<div class="store-results-meta"><span>${num(list.length)} pedidos</span></div><div class="store-orders-grid">${
      list
        .slice(0, page * 12)
        .map((row) => orderCard(row))
        .join("") ||
      empty(
        "No hay pedidos con estos filtros",
        "Prepara una reposición o amplía el intervalo de fechas.",
        link("Elegir productos", "shop", "primary"),
      )
    }</div>${list.length > page * 12 ? button("Mostrar más pedidos", "load-more") : ""}`;
  }
  function deliveries() {
    const list = filteredOrders().filter((row) =>
      [
        "DISPATCHED",
        "ARRIVED",
        "RECEIVED",
        "RECEIVED_WITH_DIFFERENCE",
      ].includes(row.status),
    );
    const f = filters.stores || {};
    const returns = newestFirst(state().returns).filter((row) => {
      const day = limaDate(row.createdAt),
        matches =
          !f.status ||
          f.status === "all" ||
          (f.status === "active" && row.status !== "QUARANTINED") ||
          (f.status === "received" && row.status === "QUARANTINED") ||
          row.status === f.status;
      return (
        !(f.from && f.to && f.from > f.to) &&
        matches &&
        (!f.from || day >= f.from) &&
        (!f.to || day <= f.to) &&
        textKey(`${row.id} ${row.reason} ${sku(row.skuId)?.name}`).includes(
          textKey(f.q),
        )
      );
    });
    return `${heading("ENTREGAS Y LOGÍSTICA INVERSA", "Entregas y devoluciones", "La estación de tienda identifica y concilia la entrega. Las devoluciones conservan producto, lote y motivo.")}${filterBox("stores", { status: true, dates: true })}<div class="store-section-title"><h2>Entregas a tu tienda</h2><span>${num(list.length)} registros</span></div><div class="store-orders-grid">${
      list
        .slice(0, page * 12)
        .map((row) => orderCard(row))
        .join("") ||
      empty(
        "Aún no hay entregas para mostrar",
        "Aquí aparecerán los pedidos cuando salgan del centro.",
        link("Seguir mis pedidos", "orders"),
      )
    }</div><section class="store-surface store-returns"><div class="store-section-title"><h2>Devoluciones registradas</h2><span>Más recientes primero</span></div>${returns.map((row) => `<article class="store-return-row">${photo(sku(row.skuId) || {}, "store-order-photo")}<div><strong>${esc(sku(row.skuId)?.name || row.skuId)}</strong><p>${esc(row.reason)}</p><small>${esc(row.id)} · Pedido ${esc(row.orderId)} · ${esc(formatLima(row.createdAt))}</small></div><div><b>${num(row.cases)} cajas</b>${badge(row.status)}</div></article>`).join("") || '<p class="muted">Las devoluciones se solicitan desde el detalle de una entrega recibida.</p>'}</section>`;
  }
  const routes = {
    overview: home,
    shop: catalog,
    orders,
    inventory,
    stores: deliveries,
  };
  function fingerprint() {
    return JSON.stringify([
      state().orders,
      state().storeStock,
      state().returns,
      state().catalog.skus,
    ]);
  }
  function render(view, keepScroll = false) {
    if (!routes[view]) return false;
    loadDraft();
    if (view !== current) {
      current = view;
      page = 1;
    }
    const y = scrollY;
    main.innerHTML = `<div class="store-portal">${routes[view]()}</div>`;
    signature = fingerprint();
    nav(view);
    if (keepScroll) window.scrollTo({ top: y, behavior: "instant" });
    return true;
  }
  function redrawWithFocus(input) {
    const name = input.dataset.storeFilter,
      selection = input.selectionStart,
      y = scrollY;
    render(current, true);
    const restored = main.querySelector(`[data-store-filter="${name}"]`);
    restored?.focus({ preventScroll: true });
    if (restored?.type === "search" && selection != null)
      restored.setSelectionRange(selection, selection);
    window.scrollTo({ top: y, behavior: "instant" });
  }
  function filterEvent(event) {
    const input = event.target.closest("[data-store-filter]");
    if (!input || !main.querySelector(".store-portal")) return;
    if (
      (event.type === "input" && input.tagName === "SELECT") ||
      (event.type === "change" && input.type === "search")
    )
      return;
    filters[current][input.dataset.storeFilter] = input.value;
    page = 1;
    redrawWithFocus(input);
  }
  main.addEventListener("input", filterEvent);
  main.addEventListener("change", filterEvent);
  function updateQuantity(input, commitEmpty = false) {
    const id = input.dataset.storeQuantity;
    const error = main.querySelector(`#store-quantity-error-${CSS.escape(id)}`);
    if (!error) return;
    const clearError = () => {
      input.removeAttribute("aria-invalid");
      error.hidden = true;
      error.textContent = "";
    };
    if (input.value === "" && !commitEmpty) {
      clearError();
      return;
    }
    const amount = input.value === "" ? 0 : Number(input.value);
    const remaining = maxCases() - total() + (quantities.get(id) || 0);
    let issue = "";
    if (
      !/^\d+$/.test(input.value || "0") ||
      !Number.isSafeInteger(amount) ||
      amount < 0
    )
      issue = "Usa un número entero de cajas, desde 0.";
    else if (amount > remaining)
      issue = `Puedes añadir hasta ${remaining} cajas de este producto: la solicitud admite ${maxCases()} en total.`;
    else if (amount > 0 && !quantities.has(id) && quantities.size >= 12)
      issue =
        "La solicitud admite hasta 12 productos. Retira uno antes de añadir otro.";
    else if (!sku(id) || sku(id).active === false)
      issue = "Este producto ya no está disponible.";
    if (issue) {
      input.setAttribute("aria-invalid", "true");
      error.textContent = issue;
      error.hidden = false;
      return;
    }
    clearError();
    const changed = amount !== (quantities.get(id) || 0);
    if (amount === 0) quantities.delete(id);
    else quantities.set(id, amount);
    if (input.value === "" || commitEmpty) input.value = String(amount);
    if (!changed) return;
    save();
    const panel = main.querySelector(".store-basket");
    if (panel) {
      // The footer can be the pointer's next target; keep its checkout button
      // connected while a cleared quantity is committed by that same click.
      const template = document.createElement("template");
      template.innerHTML = basket();
      for (const selector of [".store-basket-heading", ".store-basket-lines"])
        panel
          .querySelector(selector)
          .replaceWith(template.content.querySelector(selector));
      const clear = panel.querySelector('[data-store-action="clear-cart"]');
      if (!quantities.size) clear?.remove();
      else if (!clear)
        panel
          .querySelector(".store-basket-footer")
          .append(
            template.content.querySelector('[data-store-action="clear-cart"]'),
          );
    }
    for (const field of main.querySelectorAll("[data-store-quantity]"))
      field.max =
        maxCases() -
        total() +
        (quantities.get(field.dataset.storeQuantity) || 0);
    nav(current);
  }
  main.addEventListener("input", (event) => {
    const input = event.target.closest("[data-store-quantity]");
    if (input) updateQuantity(input);
  });
  main.addEventListener("change", (event) => {
    const input = event.target.closest("[data-store-quantity]");
    if (input) updateQuantity(input, true);
  });
  main.addEventListener("focusout", (event) => {
    const input = event.target.closest("[data-store-quantity]");
    if (input && input.value === "") updateQuantity(input, true);
  });
  main.addEventListener("click", (event) => {
    const control = event.target.closest("[data-store-action]");
    if (!control) return;
    const { storeAction: action, id } = control.dataset;
    if (["more", "less", "remove"].includes(action)) {
      const amount = (quantities.get(id) || 0) + (action === "more" ? 1 : -1);
      if (
        action === "more" &&
        (total() >= maxCases() ||
          (!quantities.has(id) && quantities.size >= 12))
      ) {
        toast(
          `Una solicitud admite 12 productos y ${maxCases()} cajas como máximo.`,
        );
        return;
      }
      if (action === "remove" || amount <= 0) quantities.delete(id);
      else quantities.set(id, amount);
      save();
      render(current, true);
      main
        .querySelector(
          `[data-store-action="${action}"][data-id="${CSS.escape(id)}"]`,
        )
        ?.focus({ preventScroll: true });
    } else if (action === "reset-filters") {
      delete filters[current];
      page = 1;
      render(current, true);
    } else if (action === "clear-cart") {
      quantities.clear();
      save();
      render(current, true);
    } else if (action === "next-page") {
      page = Math.min(page + 1, Number(id));
      render(current);
      main.scrollIntoView({ behavior: "smooth" });
    } else if (action === "previous-page") {
      page = Math.max(1, page - 1);
      render(current);
      main.scrollIntoView({ behavior: "smooth" });
    } else if (action === "load-more") {
      page++;
      render(current, true);
    } else if (action === "checkout") checkout();
  });
  function checkout() {
    const invalidQuantity = main.querySelector(
      '[data-store-quantity][aria-invalid="true"]',
    );
    if (invalidQuantity) {
      invalidQuantity.focus();
      toast(
        "Corrige la cantidad indicada antes de revisar la solicitud.",
        "error",
      );
      return;
    }
    if (!quantities.size) {
      toast("Añade al menos un producto a tu reposición.");
      return;
    }
    const invalid = [...quantities.keys()].some(
      (id) => !sku(id) || sku(id).active === false,
    );
    if (invalid) {
      toast(
        "Un producto de tu selección ya no está disponible. Retíralo antes de continuar.",
      );
      return;
    }
    let commandId = crypto.randomUUID();
    let lastSubmission = "";
    showDialog(
      "Revisa tu reposición",
      `<form id="store-checkout-form"><div class="store-checkout-destination">${icon("store")}<div><span>ENTREGA EN TU SUCURSAL</span><strong>${esc(branch().name)}</strong><small>${esc(branch().address || branch().district || "Lima")}</small></div></div><div class="store-checkout-lines">${[...quantities].map(([id, amount]) => `<div>${photo(sku(id), "store-basket-photo")}<span><strong>${esc(sku(id).name)}</strong><small>${num(sku(id).unitsPerCase)} unidades/caja · ${esc(sku(id).presentation || "")}</small></span><b>${num(amount)} cajas</b></div>`).join("")}</div><div class="form-grid"><label>Fecha requerida<input name="requestedByDate" type="date" min="${today()}" max="${addLimaDays(state().clock.now, 90)}"></label><label>Prioridad<select name="priority"><option value="NORMAL">Reposición normal</option><option value="HIGH">Prioritaria</option><option value="LOW">Flexible</option></select></label></div><label>Indicaciones para Operaciones<textarea name="notes" rows="3" maxlength="300" placeholder="Promoción, faltante o indicación de entrega (opcional)"></textarea></label><div class="store-checkout-total"><span>${quantities.size} productos</span><strong>${num(total())} cajas</strong></div><p class="form-error" id="store-checkout-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Seguir eligiendo</button><button class="btn primary" type="submit">Enviar solicitud ${icon("arrows")}</button></div></form>`,
      "TIENDA · NUEVA SOLICITUD",
    );
    const form = document.querySelector("#store-checkout-form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        const payload = {
          branchId: user().branchId,
          lines: [...quantities].map(([skuId, cases]) => ({ skuId, cases })),
          notes: form.elements.notes.value,
          requestedByDate: form.elements.requestedByDate.value || null,
          priority: form.elements.priority.value,
        };
        const submission = JSON.stringify(payload);
        if (lastSubmission && submission !== lastSubmission)
          commandId = crypto.randomUUID();
        lastSubmission = submission;
        await command(
          "order.create",
          { commandId, ...payload },
          "Solicitud enviada. Operaciones ya puede autorizar su preparación.",
        );
        quantities.clear();
        save();
        dialog.close();
        location.hash = "orders";
        render("orders");
      } catch (error) {
        formIssue(form, error.message, error.fieldErrors);
        document.querySelector("#store-checkout-error").textContent =
          error.message;
        submit.disabled = false;
      }
    };
  }
  return {
    nav,
    render,
    request(id) {
      if (
        id &&
        sku(id)?.active !== false &&
        sku(id) &&
        total() < maxCases() &&
        (quantities.has(id) || quantities.size < 12)
      ) {
        quantities.set(id, (quantities.get(id) || 0) + 1);
        save();
      }
      location.hash = "shop";
      render("shop");
    },
    refresh(view) {
      if (
        !dialog.open &&
        !main.contains(
          document.activeElement?.closest("input,select,textarea"),
        ) &&
        signature !== fingerprint()
      )
        render(view, true);
    },
  };
}
