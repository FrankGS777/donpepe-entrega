import { formatLima, limaDate } from "./time.js";

const key = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");
export function createViewFilters({ main, esc, icon, getState }) {
  const saved = new Map();
  const configs = {
    purchases: {
      selector: ".document-card",
      label: "recepciones",
      dates: true,
    },
    equipment: { selector: ".equipment-card", label: "equipos" },
    stores: { selector: ".branch-card", label: "tiendas" },
    incidents: { selector: ".incident-card", label: "incidencias" },
    inventory: {
      selector: ".panel:first-of-type tbody tr",
      label: "productos",
      existing: "#inventory-search",
    },
  };
  function mount(view) {
    const config = configs[view];
    if (!config || main.querySelector("[data-view-filters]")) return;
    const records = [
      ...(view === "inventory"
        ? main.querySelector(".panel")?.querySelectorAll("tbody tr") || []
        : main.querySelectorAll(config.selector)),
    ];
    if (!records.length) return;
    const f = saved.get(view) || { q: "", status: "", from: "", to: "" };
    saved.set(view, f);
    const toolbar = document.createElement("form");
    toolbar.className = "record-filter-bar";
    toolbar.dataset.viewFilters = view;
    toolbar.setAttribute("role", "search");
    toolbar.setAttribute("aria-label", `Filtrar ${config.label}`);
    const existing = config.existing && main.querySelector(config.existing);
    const source =
      view === "purchases"
        ? [...(getState().purchases || [])].sort(
            (a, b) =>
              Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
              String(b.id).localeCompare(String(a.id), "es", { numeric: true }),
          )
        : [];
    records.forEach((row, i) => {
      row.dataset.recordStatus =
        row.querySelector(".badge")?.textContent.trim() ||
        (view === "inventory" ? row.children[1]?.textContent.trim() : "");
      row.dataset.recordSearch = key(row.textContent);
      if (source[i]?.createdAt) {
        row.dataset.recordDate = limaDate(source[i].createdAt);
        const stamp = document.createElement("p");
        stamp.className = "record-local-date";
        stamp.textContent = `${formatLima(source[i].createdAt)}${source[i].createdByName ? ` · ${source[i].createdByName}` : ""}`;
        row.querySelector(".card-top")?.after(stamp);
      }
    });
    const statuses = [
      ...new Set(
        records.map((row) => row.dataset.recordStatus).filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
    toolbar.innerHTML = `${!existing ? `<label class="record-filter-search"><span>Buscar ${config.label}</span><div>${icon("search")}<input name="query" type="search" maxlength="160" value="${esc(f.q)}" placeholder="Nombre, producto o referencia…"></div></label>` : ""}${statuses.length > 1 ? `<label><span>${view === "inventory" ? "Conservación" : "Estado"}</span><select name="status"><option value="">${view === "inventory" ? "Todas" : "Todos"}</option>${statuses.map((value) => `<option value="${esc(value)}" ${value === f.status ? "selected" : ""}>${esc(value)}</option>`).join("")}</select></label>` : ""}${config.dates ? `<label><span>Desde · Lima</span><input name="from" type="date" value="${esc(f.from)}"></label><label><span>Hasta · Lima</span><input name="to" type="date" value="${esc(f.to)}"></label>` : ""}<button type="reset" class="btn secondary">Limpiar</button><span class="record-filter-count" role="status" aria-live="polite"></span><p class="form-error" role="alert" hidden></p>`;
    if (existing) {
      const label = existing.closest("label");
      label.classList.add("record-filter-search");
      const caption = document.createElement("span");
      caption.textContent = "Buscar producto";
      label.prepend(caption);
      toolbar.prepend(label);
      existing.value = f.q;
      existing.oninput = () => {
        f.q = existing.value;
        filter();
      };
    }
    main.querySelector(".page-heading")?.after(toolbar);
    const noResults = document.createElement("div");
    noResults.className = "record-filter-empty";
    noResults.hidden = true;
    noResults.innerHTML = `<h3>No hay ${config.label} con estos filtros</h3><p>Cambia el texto, el estado o el intervalo seleccionado.</p>`;
    toolbar.after(noResults);
    function filter() {
      const invalid = config.dates && f.from && f.to && f.from > f.to;
      const error = toolbar.querySelector(".form-error");
      error.hidden = !invalid;
      error.textContent = invalid
        ? "La fecha inicial debe ser anterior o igual a la final."
        : "";
      for (const name of ["from", "to"])
        toolbar.elements[name]?.setAttribute("aria-invalid", String(!!invalid));
      let found = 0;
      records.forEach((row) => {
        row.hidden =
          !!invalid ||
          !key(row.dataset.search || row.dataset.recordSearch).includes(
            key(f.q),
          ) ||
          (!!f.status && row.dataset.recordStatus !== f.status) ||
          (!!f.from && row.dataset.recordDate < f.from) ||
          (!!f.to && row.dataset.recordDate > f.to);
        if (!row.hidden) found++;
      });
      toolbar.querySelector(".record-filter-count").textContent =
        `${found} de ${records.length} ${config.label}${config.dates ? " · recientes primero" : ""}`;
      noResults.hidden = found > 0;
    }
    toolbar.onsubmit = (event) => {
      event.preventDefault();
      filter();
    };
    toolbar.oninput = (event) => {
      if (event.target === existing) return;
      const name = event.target.name === "query" ? "q" : event.target.name;
      if (name) f[name] = event.target.value;
      filter();
    };
    toolbar.onchange = toolbar.oninput;
    toolbar.onreset = (event) => {
      event.preventDefault();
      Object.assign(f, { q: "", status: "", from: "", to: "" });
      for (const input of toolbar.querySelectorAll("input,select"))
        input.value = "";
      filter();
    };
    filter();
  }
  return { mount };
}
