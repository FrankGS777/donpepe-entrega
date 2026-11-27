// Long entity lists use a searchable, photographic dialog. The original select
// remains the form source of truth, preserving existing validation and events.
export function installEntityPickers({ getState, photo, esc }) {
  const enhanced = new Map();
  let sequence = 0,
    scheduled = false,
    current;
  const picker = document.createElement("dialog");
  picker.className = "entity-picker-dialog";
  picker.setAttribute("aria-labelledby", "entity-picker-title");
  picker.innerHTML = `<header><div><span class="eyebrow">SELECCIÓN VISUAL</span><h2 id="entity-picker-title">Seleccionar</h2></div><button type="button" class="icon-button" data-picker-close aria-label="Volver al formulario">×</button></header><div class="entity-picker-controls"><label>Buscar<input type="search" id="entity-picker-query" autocomplete="off" placeholder="Nombre, marca o código…"></label><label id="entity-picker-category-wrap" hidden>Categoría<select id="entity-picker-category"><option value="">Todas</option></select></label></div><div class="entity-picker-caption"><span id="entity-picker-count" role="status" aria-live="polite"></span><small>Selecciona una tarjeta para continuar</small></div><div class="entity-picker-utilities" id="entity-picker-utilities" hidden></div><div class="entity-picker-grid" id="entity-picker-grid"></div><footer><button type="button" class="btn secondary small" data-picker-page="-1">← Anterior</button><span id="entity-picker-page" aria-live="polite"></span><button type="button" class="btn secondary small" data-picker-page="1">Siguiente →</button></footer>`;
  document.body.append(picker);
  const query = picker.querySelector("#entity-picker-query"),
    category = picker.querySelector("#entity-picker-category");
  const normalize = (value) =>
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  const selectableOptions = (select) =>
    [...select.options].filter(
      (option) =>
        !option.disabled &&
        (option.value || (!select.required && option.textContent.trim())),
    );
  const withUtilities = (select, data) => ({
    ...data,
    utilities: selectableOptions(select).filter(
      (option) => !data.items.some((row) => row.option === option),
    ),
  });
  function model(select, allowShort = false) {
    const catalog = getState()?.catalog;
    if (
      !catalog ||
      select.multiple ||
      select.closest(".entity-picker-dialog,.assortment-dialog")
    )
      return;
    const options = [...select.options].filter((o) => o.value && !o.disabled);
    const threshold =
      allowShort || select.dataset.entityForce === "true" ? 1 : 8;
    if (options.length < threshold) return;
    const groups = [
      ["skus", "productos"],
      ["brands", "marcas"],
      ["categories", "categorías"],
      ["assets", "equipos"],
      ["suppliers", "proveedores"],
      ["branches", "sucursales"],
    ];
    for (const [key, name] of groups) {
      const records = catalog[key] || [];
      const match = options.filter((o) =>
        records.some((r) => r.id === o.value || r.name === o.value),
      );
      if (match.length >= Math.max(threshold, options.length * 0.85))
        return withUtilities(select, {
          key,
          name,
          items: options
            .map((option) => ({
              option,
              item: records.find(
                (r) => r.id === option.value || r.name === option.value,
              ),
            }))
            .filter((row) => row.item),
        });
    }
    const imageOptions = options.filter(
      (option) =>
        /^\/images\/[\w/.-]+\.(png|jpe?g|webp|avif|svg)$/i.test(option.value) &&
        !option.value.includes(".."),
    );
    if (imageOptions.length >= Math.max(threshold, options.length * 0.85))
      return withUtilities(select, {
        key: "images",
        name: "imágenes",
        items: imageOptions.map((option) => ({
          option,
          item: {
            id: option.value,
            name: option.textContent,
            imageUrl: option.value,
          },
        })),
      });
  }
  function update(select, entry) {
    const item =
      entry.kind === "images"
        ? {
            name: select.selectedOptions[0]?.textContent,
            imageUrl: select.value,
          }
        : (getState()?.catalog?.[entry.kind] || []).find(
            (x) => x.id === select.value || x.name === select.value,
          );
    const label =
      select.selectedOptions[0]?.textContent || "Buscar y seleccionar";
    const empty = !selectableOptions(select).length;
    const signature = JSON.stringify([
      select.value,
      label,
      item?.imageUrl,
      item?.logoUrl,
      select.disabled,
      empty,
      select.getAttribute("aria-invalid"),
    ]);
    if (entry.signature === signature) return;
    entry.signature = signature;
    entry.button.disabled = select.disabled || empty;
    entry.button.setAttribute(
      "aria-invalid",
      select.getAttribute("aria-invalid") || "false",
    );
    entry.button.innerHTML = `${item ? photo(item, "entity-picker-selected-image", entry.kind === "suppliers") : '<span class="entity-picker-placeholder">⌕</span>'}<span><strong>${esc(label)}</strong><small>Buscar y seleccionar ${entry.name}</small></span><span aria-hidden="true">⌕</span>`;
  }
  function scan() {
    scheduled = false;
    for (const [select] of enhanced)
      if (!select.isConnected) enhanced.delete(select);
    for (const select of document.querySelectorAll("select")) {
      const existing = enhanced.get(select);
      if (existing) {
        update(select, existing);
        continue;
      }
      const data = model(select);
      if (!data) continue;
      const wrapper = document.createElement("div"),
        button = document.createElement("button");
      wrapper.className = "entity-select-wrapper";
      button.type = "button";
      button.className = "entity-picker-trigger";
      button.id = `entity-picker-trigger-${++sequence}`;
      button.setAttribute("aria-haspopup", "dialog");
      button.setAttribute("aria-controls", "entity-picker-grid");
      select.before(wrapper);
      wrapper.append(select, button);
      select.classList.add("entity-original-select");
      select.tabIndex = -1;
      select.dataset.entityFocus = button.id;
      const entry = { button, kind: data.key, name: data.name, signature: "" };
      enhanced.set(select, entry);
      button.onclick = () => open(select, entry);
      select.addEventListener("change", () => update(select, entry));
      select.addEventListener("focus", () =>
        button.focus({ preventScroll: true }),
      );
      update(select, entry);
    }
  }
  const schedule = () => {
    if (!scheduled) {
      scheduled = true;
      requestAnimationFrame(scan);
    }
  };
  new MutationObserver(schedule).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-invalid", "selected"],
  });
  document.addEventListener("change", schedule);
  schedule();
  function open(select, entry) {
    if (select.disabled) return;
    const data =
      model(select, true) ||
      withUtilities(select, { key: entry.kind, name: entry.name, items: [] });
    if (!data.items.length && !data.utilities.length) return;
    current = { select, entry, data, page: 1 };
    query.value = "";
    category.value = "";
    picker.querySelector("#entity-picker-title").textContent =
      `Seleccionar ${entry.name}`;
    const categories =
      entry.kind === "skus"
        ? [
            ...new Set(
              data.items.map(({ item }) => item.category).filter(Boolean),
            ),
          ].sort()
        : [];
    picker.querySelector("#entity-picker-category-wrap").hidden =
      !categories.length;
    category.replaceChildren(
      new Option("Todas", ""),
      ...categories.map((c) => new Option(c, c)),
    );
    render();
    picker.showModal();
    query.focus();
  }
  function render() {
    if (!current) return;
    const q = normalize(query.value),
      list = current.data.items.filter(
        ({ item, option }) =>
          !option.disabled &&
          (!category.value || item.category === category.value) &&
          normalize(
            `${item.name} ${item.brand || ""} ${item.barcode || ""} ${item.code || ""} ${item.model || ""} ${item.type || ""}`,
          ).includes(q),
      );
    const pages = Math.max(1, Math.ceil(list.length / 12));
    current.page = Math.min(pages, Math.max(1, current.page));
    picker.querySelector("#entity-picker-count").textContent =
      `${list.length} resultados`;
    picker.querySelector("#entity-picker-page").textContent =
      `${current.page} / ${pages}`;
    for (const button of picker.querySelectorAll("[data-picker-page]"))
      button.disabled =
        Number(button.dataset.pickerPage) < 0
          ? current.page === 1
          : current.page === pages;
    const grid = picker.querySelector("#entity-picker-grid");
    const utilities = picker.querySelector("#entity-picker-utilities");
    utilities.hidden = !current.data.utilities?.length;
    utilities.innerHTML = (current.data.utilities || [])
      .map(
        (option) =>
          `<button type="button" class="btn secondary small" data-picker-value="${esc(option.value)}" aria-pressed="${option.value === current.select.value}">${esc(option.textContent)}</button>`,
      )
      .join("");
    grid.innerHTML =
      list
        .slice((current.page - 1) * 12, current.page * 12)
        .map(
          ({ item, option }) =>
            `<button type="button" class="entity-picker-card ${option.value === current.select.value ? "selected" : ""}" data-picker-value="${esc(option.value)}" aria-pressed="${option.value === current.select.value}">${photo(item, "entity-picker-photo", current.entry.kind === "suppliers")}<span class="entity-picker-card-body"><strong>${esc(item.name)}</strong><small>${esc(current.entry.kind === "skus" ? `${item.brand || ""} · ${item.presentation || item.category || ""}` : item.model || item.description || item.type || "")}</small>${current.entry.kind === "skus" ? `<b>${esc(item.unitsPerCase)} unidades / caja</b>` : ""}</span><span class="entity-picker-check" aria-hidden="true">✓</span></button>`,
        )
        .join("") ||
      '<div class="entity-picker-empty"><strong>No hay coincidencias</strong><p>Prueba otro nombre, marca o código.</p></div>';
  }
  query.oninput = () => {
    current.page = 1;
    render();
  };
  category.onchange = () => {
    current.page = 1;
    render();
  };
  picker.addEventListener("click", (event) => {
    const choice = event.target.closest("[data-picker-value]");
    if (choice && current) {
      const { select, entry } = current;
      const option = [...select.options].find(
        (o) => o.value === choice.dataset.pickerValue && !o.disabled,
      );
      if (!select.isConnected || select.disabled || !option) {
        picker.close();
        return;
      }
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
      update(select, entry);
      picker.close();
      return;
    }
    const nav = event.target.closest("[data-picker-page]");
    if (nav) {
      current.page += Number(nav.dataset.pickerPage);
      render();
      return;
    }
    if (event.target.closest("[data-picker-close]")) picker.close();
  });
  picker.addEventListener("close", () => {
    current?.entry.button.isConnected &&
      current.entry.button.focus({ preventScroll: true });
    current = null;
  });
  // Search inputs may consume Escape to clear their query before the dialog's
  // native cancel event. Closing explicitly also keeps a parent form open.
  picker.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    picker.close();
  });
  picker.addEventListener("cancel", (event) => {
    event.preventDefault();
    event.stopPropagation();
    picker.close();
  });
  return { refresh: schedule };
}
