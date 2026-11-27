// A supplier's assortment is a catalogue, not a long list of opaque IDs.
// Selection is staged locally: closing this dialog never modifies the order.
export function createProductCatalogDialog({ getState, esc, photo, num }) {
  const modal = document.createElement("dialog");
  modal.className = "assortment-dialog";
  modal.setAttribute("aria-labelledby", "assortment-title");
  document.body.append(modal);
  let session;
  const clean = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  const brandOf = (item) =>
    getState().catalog.brands.find(
      (brand) => brand.id === item.brandId || brand.name === item.brand,
    );
  const sourceProducts = () =>
    getState().catalog.skus.filter(
      (item) =>
        item.active !== false &&
        (!session.supplierId ||
          (
            item.eligibleSupplierIds || [
              item.supplierId,
              ...(item.supplierIds || []),
            ]
          ).includes(session.supplierId)),
    );
  function open({
    supplierId,
    lines,
    maxCases = 500,
    maxTotal = Infinity,
    onApply,
    returnFocus,
  }) {
    session = {
      supplierId,
      lines: lines.map((line) => ({ ...line })),
      maxCases,
      maxTotal,
      onApply,
      returnFocus,
      query: "",
      brand: "",
      category: "",
      selectedOnly: false,
      page: 1,
    };
    const provider = getState().catalog.suppliers.find(
      (item) => item.id === supplierId,
    );
    const items = sourceProducts();
    const categories = [
      ...new Set(items.map((item) => item.category).filter(Boolean)),
    ].sort();
    modal.innerHTML = `<header class="assortment-head"><div class="assortment-provider">${provider ? photo(provider, "assortment-provider-logo", true) : ""}<div><span class="eyebrow">${supplierId ? "CATÁLOGO DEL PROVEEDOR" : "CATÁLOGO DE PRODUCTOS"}</span><h2 id="assortment-title">${esc(provider?.name || "Productos para tu tienda")}</h2><p>${num(items.length)} productos disponibles · Cajas cerradas</p></div></div><button type="button" class="icon-button" data-assortment-close aria-label="Volver sin aplicar la selección">×</button></header><div class="assortment-controls"><label class="assortment-search">Buscar producto<input type="search" id="assortment-search" autocomplete="off" placeholder="Nombre, marca o código de barras…"></label><label>Categoría<select id="assortment-category"><option value="">Todas las categorías</option>${categories.map((category) => `<option>${esc(category)}</option>`).join("")}</select></label><label class="assortment-selected-filter"><input type="checkbox" id="assortment-selected"> Sólo seleccionados</label></div><div id="assortment-brands" class="assortment-brands" aria-label="Filtrar por marca"></div><div class="assortment-results"><span id="assortment-count" role="status"></span><span id="assortment-selection-count" aria-live="polite"></span></div><p class="form-error assortment-error" id="assortment-error" role="alert" hidden></p><div id="assortment-grid" class="assortment-grid"></div><footer class="assortment-footer"><div class="assortment-pagination"><button type="button" class="btn secondary small" data-assortment-page="-1" aria-label="Página anterior">←</button><span id="assortment-page"></span><button type="button" class="btn secondary small" data-assortment-page="1" aria-label="Página siguiente">→</button></div><div><button type="button" class="btn secondary" data-assortment-close>Volver</button><button type="button" class="btn primary" id="assortment-apply">Aplicar selección</button></div></footer>`;
    modal.querySelector("#assortment-search").oninput = (event) => {
      session.query = event.target.value;
      session.page = 1;
      render();
    };
    modal.querySelector("#assortment-category").onchange = (event) => {
      session.category = event.target.value;
      session.page = 1;
      render();
    };
    modal.querySelector("#assortment-selected").onchange = (event) => {
      session.selectedOnly = event.target.checked;
      session.page = 1;
      render();
    };
    render();
    modal.showModal();
    modal.querySelector("#assortment-search").focus();
  }
  function error(message, input) {
    const box = modal.querySelector("#assortment-error");
    box.hidden = false;
    box.textContent = message;
    if (input) {
      input.setAttribute("aria-invalid", "true");
      input.focus({ preventScroll: true });
    }
  }
  function clearError() {
    const box = modal.querySelector("#assortment-error");
    box.hidden = true;
    box.textContent = "";
  }
  function updateQuantity(id, value, input) {
    const cases = Number(value),
      current = session.lines.find((line) => line.skuId === id);
    if (!Number.isInteger(cases) || cases < 0 || cases > session.maxCases) {
      error(
        `Escribe una cantidad entera de 0 a ${session.maxCases} cajas. Cero quita el producto de la selección.`,
        input,
      );
      return false;
    }
    if (!sourceProducts().some((item) => item.id === id)) {
      error(
        "El proveedor ya no ofrece este producto. Actualiza el catálogo antes de continuar.",
        input,
      );
      return false;
    }
    if (cases && !current && session.lines.length >= 12) {
      error(
        "Cada solicitud admite 12 productos diferentes. Divide la compra en otra solicitud para añadir más.",
        input,
      );
      return false;
    }
    const total =
      session.lines.reduce(
        (sum, line) => sum + (line.skuId === id ? 0 : line.cases),
        0,
      ) + cases;
    if (total > session.maxTotal) {
      error(
        `La solicitud admite ${session.maxTotal} cajas en total. Divide la entrega en dos pedidos.`,
        input,
      );
      return false;
    }
    session.lines = session.lines.filter((line) => line.skuId !== id);
    if (cases) session.lines.push({ skuId: id, cases });
    clearError();
    return true;
  }
  function render() {
    if (!session) return;
    const all = sourceProducts(),
      brands = [
        ...new Map(
          all.map((item) => [
            item.brandId || item.brand || "",
            brandOf(item) || {
              id: item.brandId || item.brand || "",
              name: item.brand || "Sin marca",
            },
          ]),
        ).values(),
      ].sort((a, b) => a.name.localeCompare(b.name, "es"));
    modal.querySelector("#assortment-brands").innerHTML =
      `<button type="button" class="assortment-brand ${!session.brand ? "selected" : ""}" data-assortment-brand="" aria-pressed="${!session.brand}"><strong>Todas las marcas</strong><small>${num(all.length)} productos</small></button>${brands.map((brand) => `<button type="button" class="assortment-brand ${session.brand === brand.id ? "selected" : ""}" data-assortment-brand="${esc(brand.id)}" aria-pressed="${session.brand === brand.id}">${brand.imageUrl || brand.logoUrl ? photo({ ...brand, logoUrl: brand.logoUrl || brand.imageUrl }, "assortment-brand-logo", true) : `<strong>${esc(brand.name)}</strong>`}<span>${esc(brand.name)}</span><small>${num(all.filter((item) => (item.brandId || item.brand || "") === brand.id).length)}</small></button>`).join("")}`;
    const query = clean(session.query);
    const list = all.filter(
      (item) =>
        (!session.brand ||
          (item.brandId || item.brand || "") === session.brand) &&
        (!session.category || item.category === session.category) &&
        (!session.selectedOnly ||
          session.lines.some((line) => line.skuId === item.id)) &&
        clean(
          `${item.name} ${item.brand || ""} ${item.barcode || ""} ${item.code || ""} ${item.category || ""}`,
        ).includes(query),
    );
    const pages = Math.max(1, Math.ceil(list.length / 12));
    session.page = Math.min(pages, Math.max(1, session.page));
    modal.querySelector("#assortment-count").textContent =
      `${num(list.length)} productos${session.brand ? " de esta marca" : ""}`;
    modal.querySelector("#assortment-selection-count").textContent =
      `${num(session.lines.length)} / 12 seleccionados · ${num(session.lines.reduce((sum, line) => sum + line.cases, 0))} cajas`;
    modal.querySelector("#assortment-page").textContent =
      `${session.page} / ${pages}`;
    modal.querySelectorAll("[data-assortment-page]").forEach((button) => {
      button.disabled =
        Number(button.dataset.assortmentPage) < 0
          ? session.page === 1
          : session.page === pages;
    });
    modal.querySelector("#assortment-grid").innerHTML =
      list
        .slice((session.page - 1) * 12, session.page * 12)
        .map((item) => {
          const cases =
            session.lines.find((line) => line.skuId === item.id)?.cases || 0;
          return `<article class="assortment-product ${cases ? "selected" : ""}" data-assortment-product="${esc(item.id)}">${cases ? '<span class="assortment-product-check" aria-label="Seleccionado">✓</span>' : ""}${photo(item, "assortment-product-photo")}<div class="assortment-product-body"><span class="brand-name">${esc(item.brand || "")}</span><h3>${esc(item.name)}</h3><p>${esc(item.presentation || item.category || "")}<br>${num(item.unitsPerCase)} unidades por caja${item.purchaseUnitNetCents?`<br><strong>S/ ${((item.purchaseUnitNetCents*item.unitsPerCase)/100).toFixed(2)} por caja sin IGV</strong>`:""}</p><div class="assortment-quantity"><button type="button" data-assortment-quantity="-1" data-sku="${esc(item.id)}" aria-label="Quitar una caja de ${esc(item.name)}" ${!cases ? "disabled" : ""}>−</button><label><span class="sr-only">Cajas de ${esc(item.name)}</span><input type="number" min="0" max="${session.maxCases}" step="1" value="${cases}" data-assortment-cases="${esc(item.id)}" inputmode="numeric"><small>cajas</small></label><button type="button" data-assortment-quantity="1" data-sku="${esc(item.id)}" aria-label="Añadir una caja de ${esc(item.name)}" ${cases >= session.maxCases ? "disabled" : ""}>+</button></div></div></article>`;
        })
        .join("") ||
      '<div class="assortment-empty"><strong>No hay productos con estos filtros</strong><p>Cambia de marca, categoría o texto de búsqueda.</p><button class="btn secondary small" type="button" data-assortment-reset>Limpiar filtros</button></div>';
  }
  modal.addEventListener("change", (event) => {
    const input = event.target.closest("[data-assortment-cases]");
    if (!input || !session) return;
    if (updateQuantity(input.dataset.assortmentCases, input.value, input)) {
      input.removeAttribute("aria-invalid");
      const card = input.closest(".assortment-product"),
        cases = Number(input.value);
      card.classList.toggle("selected", cases > 0);
      card.querySelector('[data-assortment-quantity="-1"]').disabled =
        cases === 0;
      card.querySelector('[data-assortment-quantity="1"]').disabled =
        cases >= session.maxCases;
      modal.querySelector("#assortment-selection-count").textContent =
        `${num(session.lines.length)} / 12 seleccionados · ${num(session.lines.reduce((sum, line) => sum + line.cases, 0))} cajas`;
    }
  });
  modal.addEventListener("click", (event) => {
    if (!session) return;
    const brand = event.target.closest("[data-assortment-brand]");
    if (brand) {
      session.brand = brand.dataset.assortmentBrand;
      session.page = 1;
      render();
      return;
    }
    const page = event.target.closest("[data-assortment-page]");
    if (page) {
      session.page += Number(page.dataset.assortmentPage);
      render();
      return;
    }
    const quantity = event.target.closest("[data-assortment-quantity]");
    if (quantity) {
      const input = modal.querySelector(
        `[data-assortment-cases="${CSS.escape(quantity.dataset.sku)}"]`,
      );
      const value =
        Number(input.value) + Number(quantity.dataset.assortmentQuantity);
      if (updateQuantity(quantity.dataset.sku, value, input)) {
        const id = quantity.dataset.sku,
          direction = quantity.dataset.assortmentQuantity;
        render();
        modal
          .querySelector(
            `[data-sku="${CSS.escape(id)}"][data-assortment-quantity="${direction}"]`,
          )
          ?.focus({ preventScroll: true });
      }
      return;
    }
    if (event.target.closest("[data-assortment-reset]")) {
      session.query = session.brand = session.category = "";
      session.selectedOnly = false;
      session.page = 1;
      modal.querySelector("#assortment-search").value = "";
      modal.querySelector("#assortment-category").value = "";
      modal.querySelector("#assortment-selected").checked = false;
      render();
      return;
    }
    if (event.target.closest("[data-assortment-close]")) {
      modal.close();
      return;
    }
    if (event.target.closest("#assortment-apply")) {
      // Commit visible text first: a still-focused number must not be ignored.
      for (const input of modal.querySelectorAll("[data-assortment-cases]"))
        if (!updateQuantity(input.dataset.assortmentCases, input.value, input))
          return;
      const eligible = sourceProducts();
      if (
        session.lines.some(
          (line) => !eligible.some((item) => item.id === line.skuId),
        )
      ) {
        error(
          "Un producto dejó de estar disponible. Vuelve a abrir el catálogo y revisa la selección.",
        );
        return;
      }
      session.onApply(session.lines.map((line) => ({ ...line })));
      modal.close();
    }
  });
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      modal.close();
    }
    if (event.key === "Enter" && event.target.matches("input")) {
      event.preventDefault();
      event.stopPropagation();
    }
  });
  modal.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    modal.close();
  });
  modal.addEventListener("close", () => {
    session?.returnFocus?.isConnected &&
      session.returnFocus.focus({ preventScroll: true });
    session = null;
  });
  return { open };
}
