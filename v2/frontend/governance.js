import { renderAvatar, normalizePhoto } from "./avatar.js";
import { bindCatalogUpload } from "./catalog-upload.js";
import { createAdminAssets } from "./admin-assets.js";
import { cardImageSources } from "./experience.js";
import { formatLima, formatCalendarDate } from "./time.js";

// Governance is deliberately independent from the operational map.
export function createGovernance(ctx) {
  const {
    api,
    command,
    showDialog,
    dialog,
    main,
    esc,
    icon,
    toast,
    getState,
    getUser,
  } = ctx;
  const $ = (selector, root = document) => root.querySelector(selector);
  const zones = {
    DRY: "Reserva seca",
    COLD: "Refrigerado",
    FROZEN: "Congelado",
    CLEANING: "Limpieza",
  };
  let current = "",
    fingerprint = "",
    catalogTab = "sku",
    catalogQuery = "",
    catalogStatus = "active",
    catalogCategory = "",
    catalogSort = "recent",
    catalogPage = 1,
    catalogPageSize = 24,
    summaryQuery = "",
    summaryStatus = "all",
    cachedUsers = [],
    cachedRoles = [],
    rolesRevision,
    recoveryFingerprint = "",
    recoveryLoading = false;
  let auditFilters = {
      q: "",
      action: "",
      outcome: "",
      actorId: "",
      from: "",
      to: "",
      page: 1,
      limit: 50,
    },
    auditData = { events: [], total: 0, pages: 1 },
    auditSequence = 0,
    auditTimer;
  const heading = (eyebrow, title, detail, action = "") =>
    `<section class="page-heading"><h1>${esc(title)}</h1><div class="heading-actions">${action}</div></section>`;
  const btn = (label, action, id = "", cls = "secondary small", extra = "") =>
    `<button type="button" class="btn ${cls}" data-govern="${action}" data-id="${esc(id)}" ${extra}>${label}</button>`;
  const message = (text, type = "") =>
    `<div class="notice ${type}">${esc(text)}</div>`;
  const date = (value) => formatLima(value);
  const field = (name, title, value = "", attributes = "") =>
    `<label>${esc(title)}<input name="${name}" value="${esc(value)}" ${attributes}></label>`;
  const select = (name, title, values, value) =>
    `<label>${esc(title)}<select name="${name}">${values.map(([id, label]) => `<option value="${esc(id)}" ${id === value ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`;
  const errorField =
    '<p class="form-error" id="govern-error" role="alert"></p>';
  const number = (value) =>
    new Intl.NumberFormat("es-PE").format(Number(value) || 0);
  const imagePath = (value) =>
    /^\/images\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|avif|svg)$/.test(
      value || "",
    ) && value.length <= 180
      ? value
      : "";
  const image = (value, title, type = "product") =>
    imagePath(value)
      ? `<img src="${esc(value)}"${cardImageSources(value)} alt="${esc(title)}" loading="lazy" decoding="async" width="160" height="160" data-master-image class="${[...(getState()?.catalog?.brands || []), ...(getState()?.catalog?.suppliers || [])].some((item) => (item.imageUrl === value || item.logoUrl === value) && item.preferredBackground === "dark") ? "logo-contrast-dark" : ""}">`
      : `<span class="master-image-empty" aria-label="Sin imagen">${icon(type === "supplier" ? "store" : "package")}</span>`;
  const stockProducts = () => {
    const state = getState(),
      summary = state.inventorySummary || state.managementInventory || {};
    return (summary.products || []).map((row) => ({
      ...state.catalog.skus.find((sku) => sku.id === row.skuId),
      ...row,
    }));
  };
  function filteredStockProducts() {
    const query = summaryQuery.trim().toLocaleLowerCase("es");
    return stockProducts()
      .filter((p) =>
        `${p.name || ""} ${p.brand || ""} ${p.category || ""}`
          .toLocaleLowerCase("es")
          .includes(query),
      )
      .filter(
        (p) =>
          summaryStatus === "all" ||
          (summaryStatus === "low"
            ? p.lowStock
            : summaryStatus === "retained"
              ? (p.retainedCases ?? p.quarantineCases) > 0
              : p.inTransitCases > 0),
      );
  }
  function downloadCsv(filename, headers, rows) {
    const cell = (value) => {
      const text = String(value ?? "");
      return `"${(typeof value === "string" && /^\s*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
    };
    const blob = new Blob(
      [
        "\uFEFF",
        [headers, ...rows].map((row) => row.map(cell).join(";")).join("\r\n"),
      ],
      { type: "text/csv;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Exportación preparada con los filtros actuales.");
  }
  const catalogInfo = {
    sku: { title: "Productos", singular: "producto", key: "skus" },
    supplier: { title: "Proveedores", singular: "proveedor", key: "suppliers" },
    branch: { title: "Tiendas", singular: "tienda", key: "branches" },
  };
  const adminAssets = createAdminAssets({
    ...ctx,
    bindForm,
    heading,
    field,
    select,
    message,
    image,
    imagePath,
    downloadCsv,
  });
  try {
    const stored = JSON.parse(
      sessionStorage.getItem("donpepe:admin:catalog") || "null",
    );
    if (stored && catalogInfo[stored.tab]) {
      catalogTab = stored.tab;
      catalogQuery = String(stored.query || "");
      catalogStatus = ["all", "active", "inactive"].includes(stored.status)
        ? stored.status
        : "active";
      catalogCategory = String(stored.category || "");
      catalogSort =
        stored.version === 2 &&
        ["recent", "name", "name-desc", "brand"].includes(stored.sort)
          ? stored.sort
          : "recent";
      catalogPage = Math.max(1, Number(stored.page) || 1);
      catalogPageSize = stored.size === 48 ? 48 : 24;
    }
  } catch {}
  const persistCatalog = () => {
    try {
      sessionStorage.setItem(
        "donpepe:admin:catalog",
        JSON.stringify({
          version: 2,
          tab: catalogTab,
          query: catalogQuery,
          status: catalogStatus,
          category: catalogCategory,
          sort: catalogSort,
          page: catalogPage,
          size: catalogPageSize,
        }),
      );
    } catch {}
  };
  function loadPlaceholder() {
    main.innerHTML =
      '<div class="loading-screen"><span class="spinner"></span><h2>Preparando administración</h2></div>';
  }
  async function render(view) {
    current = view;
    fingerprint = "";
    loadPlaceholder();
    try {
      if (adminAssets.views.includes(view)) adminAssets.render(view);
      else if (view === "summary") summary();
      else if (view === "users") await users();
      else if (view === "roles") await roles();
      else if (view === "catalog") catalog();
      else if (view === "settings") await settings();
      else if (view === "recoveries") await recoveries();
      else if (view === "audit") await audit();
      if (current === view && !getUser().recoveryVerified)
        main.insertAdjacentHTML(
          "afterbegin",
          `<div class="admin-safety-banner"><span>${icon("shield")} Vincula y verifica tu Gmail antes de necesitar recuperar el acceso del administrador único.</span><button class="btn secondary small" data-action="profile">Configurar mi recuperación</button></div>`,
        );
    } catch (error) {
      if (current !== view) return;
      main.innerHTML =
        heading(
          "ADMINISTRACIÓN",
          "No se pudo cargar esta sección",
          error.message,
        ) + btn("Volver a intentar", "reload");
    }
  }
  function refresh(view) {
    if (current !== view || dialog.open) return;
    if (adminAssets.views.includes(view)) {
      adminAssets.refresh(view);
      return;
    }
    if (view === "summary") {
      const next = JSON.stringify([
        getState().inventorySummary || getState().managementInventory,
        getState().catalog,
      ]);
      if (fingerprint !== next && !main.contains(document.activeElement))
        summary();
    }
    if (view === "catalog") {
      const next = JSON.stringify(getState().catalog);
      if (fingerprint && fingerprint !== next) catalog();
    }
    if (
      view === "recoveries" &&
      !recoveryLoading &&
      recoveryFingerprint !== String(getState().metrics.pendingRecoveries)
    ) {
      recoveryLoading = true;
      recoveries()
        .catch((error) => toast(error.message, "error"))
        .finally(() => {
          recoveryLoading = false;
        });
    }
  }
  async function users() {
    const data = await api("/api/users");
    if (current !== "users") return;
    cachedUsers = data.users;
    main.innerHTML =
      heading(
        "IDENTIDAD Y ACCESO",
        "Usuarios",
        "Accesos y responsabilidades de tu equipo.",
        btn("+ Crear usuario", "new-user", "", "primary"),
      ) +
      `<div class="govern-summary"><article><span>Cuentas activas</span><b>${cachedUsers.filter((u) => u.active).length}</b></article><article><span>Administrador principal</span><b>1</b></article><article><span>Recuperación verificada</span><b>${cachedUsers.filter((u) => u.recoveryVerified).length}</b></article></div>` +
      `<section class="panel" id="users-panel"><div class="section-heading"><h2>Directorio de acceso</h2><label class="search-field">${icon("search")}<input type="search" id="people-search" aria-label="Buscar cuentas" placeholder="Nombre o correo"></label></div><div class="table-scroll"><table><thead><tr><th>Persona</th><th>Perfil y alcance</th><th>Recuperación</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>${cachedUsers.map((u) => `<tr data-person-search="${esc((u.name + " " + u.email).toLowerCase())}"><td><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></td><td>${esc(u.roleName)}<small>${u.branchId ? esc(getState().catalog.branches.find((b) => b.id === u.branchId)?.name || u.branchId) : u.role === "admin" ? "Gobierno · sin ejecución física" : "Centro de distribución"}</small></td><td>${u.recoveryEmail ? esc(u.recoveryEmail) : "No vinculada"}<small class="${u.recoveryVerified ? "text-success" : "text-warning"}">${u.recoveryVerified ? "Verificada por el propietario" : "Pendiente de vinculación"}</small></td><td><span class="badge ${u.archived ? "red" : u.active ? "green" : "amber"}">${u.active ? "Activa" : "Desactivada"}</span></td><td><div class="row-actions">${!u.archived ? btn("Editar", "edit-user", u.id) : ""}${u.role !== "admin" && !u.archived ? btn(u.active ? "Desactivar" : "Activar", "user-status", u.id, "secondary small", `data-active="${!u.active}"`) + btn("Eliminar", "delete-user", u.id, "danger-ghost small", u.active ? 'disabled title="Desactiva la cuenta antes de eliminarla"' : "") : '<span class="muted">Identidad protegida</span>'}</div></td></tr>`).join("")}</tbody></table></div></section>`;
    $("#people-search").oninput = (e) =>
      document
        .querySelectorAll("[data-person-search]")
        .forEach(
          (row) =>
            (row.hidden = !row.dataset.personSearch.includes(
              e.target.value.toLowerCase().trim(),
            )),
        );
    $("#users-panel tbody")
      .querySelectorAll("tr")
      .forEach((row, index) => {
        const user = cachedUsers[index],
          cell = row.cells[0];
        const details = document.createElement("div");
        details.innerHTML = cell.innerHTML;
        const avatar = document.createElement("span");
        avatar.className = "admin-directory-avatar profile-avatar";
        const person = document.createElement("div");
        person.className = "admin-person";
        person.append(avatar, details);
        cell.replaceChildren(person);
        renderAvatar(avatar, user, esc);
      });
  }
  function userForm(id) {
    const u = cachedUsers.find((item) => item.id === id);
    const editing = !!u;
    showDialog(
      editing ? "Editar cuenta" : "Crear cuenta",
      `<form id="govern-form"><div class="form-grid">${field("name", "Nombre completo", u?.name, 'required minlength="3" maxlength="100" autocomplete="name"')}${field("email", "Correo de acceso", u?.email, 'required type="email" maxlength="120" autocomplete="username"')}${
        u?.role === "admin"
          ? '<label>Perfil<input value="Administrador principal · único" disabled></label>'
          : select(
              "role",
              "Responsabilidad",
              [
                ["operations", "Jefe de operaciones"],
                ["store", "Gestor de tienda"],
              ],
              u?.role || "operations",
            )
      }${select(
        "branchId",
        "Tienda asignada",
        getState()
          .catalog.branches.filter(
            (b) => b.active !== false || b.id === u?.branchId,
          )
          .map((b) => [b.id, b.name]),
        u?.branchId,
      )}</div>${!editing ? field("recoveryEmail", "Gmail de recuperación (opcional)", "", 'type="email" placeholder="propietario@gmail.com" maxlength="120"') : message("La recuperación sólo la vincula el propietario desde Mi cuenta, confirmando el enlace recibido en su Gmail.")}${field("password", editing ? "Nueva contraseña (vacía para conservar)" : "Contraseña inicial", "", `type="password" ${editing ? "" : "required"} minlength="12" maxlength="72" autocomplete="new-password"`)}<p class="field-hint">12 caracteres o más, con mayúscula, minúscula y número. No puede coincidir con la actual ni con las cinco anteriores. Nunca se muestran contraseñas almacenadas.</p>${errorField}<div class="dialog-actions"><button type="button" class="btn secondary" data-govern="close">Cancelar</button><button class="btn primary">${editing ? "Guardar cambios" : "Crear acceso"}</button></div></form>`,
      "ADMINISTRACIÓN · CUENTAS",
    );
    const form = $("#govern-form"),
      roleField = form.elements.role,
      branchField = form.elements.branchId;
    if (editing) mountAdminAvatar(u, form);
    form.querySelector(".field-hint").textContent =
      "Al menos 12 caracteres, con mayúscula, minúscula, número y símbolo. No repitas la actual ni las cinco anteriores. Las contraseñas almacenadas nunca son visibles.";
    if (u?.id === getUser().id) {
      form.elements.password.closest("label").hidden = true;
      form.elements.password.disabled = true;
      form.querySelector(".field-hint").textContent =
        "Para cambiar tu propia contraseña, utiliza Mi cuenta y seguridad y confirma la contraseña actual.";
    }
    const toggle = () => {
      branchField.disabled = (roleField?.value || u?.role) !== "store";
    };
    roleField?.addEventListener("change", toggle);
    toggle();
    bindForm(form, async () => {
      const data = Object.fromEntries(new FormData(form));
      if (!data.password) delete data.password;
      await api(
        editing ? `/api/users/${encodeURIComponent(id)}` : "/api/users",
        data,
        editing ? "PATCH" : "POST",
      );
      dialog.close();
      toast(
        editing
          ? "Cuenta actualizada; los cambios de acceso se aplican en el servidor."
          : "Acceso creado.",
      );
      await users();
    });
  }
  function mountAdminAvatar(user, accountForm) {
    const section = document.createElement("section");
    section.className = "admin-account-photo";
    section.innerHTML = `<form id="admin-avatar-form"><div class="admin-photo-identity"><span class="profile-avatar admin-photo-preview"></span><div><h3>${esc(user.name)}</h3><p>${esc(user.roleName || "Cuenta del sistema")}</p><small>La fotografía se guarda de forma independiente a los datos de acceso.</small></div></div><div class="admin-photo-controls"><label class="avatar-upload-label btn secondary">Elegir fotografía<input type="file" class="avatar-file" id="admin-user-photo" accept="image/jpeg,image/png,image/webp"></label><button type="submit" class="btn primary small" disabled>Guardar fotografía</button><button type="button" class="btn danger-ghost small" id="admin-remove-photo" ${user.avatarUrl ? "" : "hidden"}>Quitar foto</button></div><p class="field-hint">JPG, PNG o WebP · máximo 10 MB · recorte central cuadrado.</p><p class="form-error" id="admin-avatar-error" role="alert"></p></form>`;
    accountForm.before(section);
    const form = section.querySelector("form"),
      preview = section.querySelector(".admin-photo-preview"),
      input = section.querySelector("input"),
      save = section.querySelector('[type="submit"]'),
      remove = section.querySelector("#admin-remove-photo");
    let photo = "",
      generation = 0,
      busy = false,
      model = user;
    renderAvatar(preview, user, esc);
    const setBusy = (value) => {
      busy = value;
      form.setAttribute("aria-busy", String(value));
      input.disabled = remove.disabled = value;
      save.disabled = value || !photo;
    };
    input.addEventListener("change", async () => {
      if (busy) return;
      const version = ++generation;
      photo = "";
      save.disabled = true;
      section.querySelector("#admin-avatar-error").textContent = "";
      input.removeAttribute("aria-invalid");
      if (!input.files?.[0]) return;
      try {
        const result = await normalizePhoto(input.files[0]);
        if (!form.isConnected || version !== generation) return;
        photo = result;
        const image = document.createElement("img");
        image.src = result;
        image.alt = "Vista previa de la fotografía del usuario";
        preview.replaceChildren(image);
        save.disabled = false;
      } catch (error) {
        if (form.isConnected && version === generation) {
          section.querySelector("#admin-avatar-error").textContent =
            error.message;
          input.setAttribute("aria-invalid", "true");
          delete preview.dataset.avatarSignature;
          renderAvatar(preview, model, esc);
        }
      }
    });
    const apply = async (data) => {
      model = data.user || { ...model, avatarUrl: "" };
      Object.assign(user, model);
      cachedUsers = cachedUsers.map((row) =>
        row.id === user.id ? { ...row, ...model } : row,
      );
      const directoryAvatar = main.querySelectorAll(
        "#users-panel tbody .admin-directory-avatar",
      )[cachedUsers.findIndex((row) => row.id === user.id)];
      if (directoryAvatar) {
        delete directoryAvatar.dataset.avatarSignature;
        renderAvatar(directoryAvatar, model, esc);
      }
      photo = "";
      input.value = "";
      delete preview.dataset.avatarSignature;
      renderAvatar(preview, model, esc);
      remove.hidden = !model.avatarUrl;
      if (user.id === getUser().id) await ctx.reloadIdentity();
    };
    bindForm(
      form,
      async () => {
        if (!photo || busy)
          throw Error("Elige una fotografía válida antes de guardarla.");
        setBusy(true);
        try {
          const response = await api(
            `/api/users/${encodeURIComponent(user.id)}/avatar`,
            { dataUrl: photo },
            "PUT",
          );
          await apply(response);
          toast("Fotografía del usuario actualizada.");
        } finally {
          if (form.isConnected) {
            setBusy(false);
            setTimeout(() => {
              if (form.isConnected) save.disabled = busy || !photo;
            }, 0);
          }
        }
      },
      "#admin-avatar-error",
    );
    remove.addEventListener("click", async () => {
      if (busy) return;
      setBusy(true);
      generation++;
      try {
        const response = await api(
          `/api/users/${encodeURIComponent(user.id)}/avatar`,
          {},
          "DELETE",
        );
        await apply(response);
        toast("Fotografía eliminada. La cuenta conserva su inicial.");
      } catch (error) {
        section.querySelector("#admin-avatar-error").textContent =
          error.message;
      } finally {
        if (form.isConnected) setBusy(false);
      }
    });
  }
  async function roles() {
    const data = await api("/api/roles");
    if (current !== "roles") return;
    cachedRoles = data.roles;
    rolesRevision = data.revision;
    main.innerHTML =
      heading(
        "CONTROL DE ACCESO",
        "Permisos por perfil",
        "Puedes retirar funciones dentro de cada perfil. Ninguna casilla convierte a Administración en operario ni permite a una tienda gestionar otra sucursal.",
      ) +
      `<div class="role-boundaries"><article>${icon("shield")}<h2 class="role-heading">Administración</h2><p>Usuarios, permisos, catálogos, reglas y seguridad. Sin cámara, flota ni movimientos.</p></article><article>${icon("arrows")}<h2 class="role-heading">Operaciones</h2><p>Planifica, libera pedidos y resuelve incidencias. No modifica accesos ni privilegios.</p></article><article>${icon("store")}<h2 class="role-heading">Tienda</h2><p>Solicita, recibe y devuelve sólo su mercancía. Sin acceso al inventario ajeno.</p></article></div>` +
      `<section class="panel"><div class="section-heading"><h2>Matriz de permisos</h2><span class="muted">El servidor verifica cada acción</span></div><div class="table-scroll"><table class="permission-table"><thead><tr><th>Función</th>${data.roles.map((r) => `<th>${esc(r.name || r.id)}</th>`).join("")}</tr></thead><tbody>${data.permissions
        .map(
          (p) =>
            `<tr><td><strong>${esc(p.label || p.id)}</strong><small>${esc(p.group || "Sistema")}</small></td>${data.roles
              .map((r) => {
                const within = r.ceiling.includes(p.id),
                  locked =
                    r.protected ||
                    [
                      "profile.manage",
                      "overview.view",
                      "catalog.read",
                    ].includes(p.id);
                return `<td><label class="permission-check"><input type="checkbox" data-role-permission="${esc(r.id)}" value="${esc(p.id)}" ${r.permissions.includes(p.id) ? "checked" : ""} ${within && !locked ? "" : "disabled"} aria-label="${esc((r.name || r.id) + ": " + (p.label || p.id))}"><span>${within ? (locked ? "Permiso esencial protegido" : "Permitido en este perfil") : "Fuera de su responsabilidad"}</span></label></td>`;
              })
              .join("")}</tr>`,
        )
        .join("")}</tbody></table></div><div class="govern-save">${data.roles
        .filter((r) => !r.protected)
        .map((r) =>
          btn(
            `Guardar ${esc(r.name || r.id)}`,
            "save-role",
            r.id,
            "primary small",
          ),
        )
        .join("")}</div></section>`;
  }
  function summary() {
    const state = getState(),
      data = state.inventorySummary || state.managementInventory || {},
      totals = data.totals || {};
    fingerprint = JSON.stringify([data, state.catalog]);
    const products = stockProducts(),
      low = products.filter((p) => p.lowStock),
      retained = products.filter(
        (p) => (p.retainedCases ?? p.quarantineCases) > 0,
      );
    main.innerHTML =
      heading(
        "ADMINISTRACIÓN",
        "Estado de la red",
        "Existencias, cobertura y calidad de los datos maestros.",
        btn("Exportar inventario", "export-stock") +
          '<a class="btn secondary" href="#catalog">Gestionar catálogos</a>',
      ) +
      `<div class="master-overview-metrics"><article><span>En el centro de distribución</span><strong>${number(totals.warehouseCases)}</strong><small>Cajas físicas · incluye reservas y retenciones</small></article><article><span>Disponibles para abastecer</span><strong>${number(totals.availableCases)}</strong><small>${number(totals.reservedCases)} cajas comprometidas</small></article><article><span>En tiendas</span><strong>${number(totals.branchCases)}</strong><small>Mercancía recibida y confirmada</small></article><article><span>En tránsito</span><strong>${number(totals.inTransitCases)}</strong><small>${number(totals.incomingCases)} cajas esperadas del proveedor</small></article></div>` +
      `<div class="master-summary-columns"><section class="panel master-health"><div class="section-heading"><h2>Atención de inventario</h2><span class="badge ${low.length || retained.length ? "amber" : "green"}">${low.length || retained.length ? "Requiere seguimiento" : "Sin alertas de cobertura"}</span></div><div class="master-health-list"><article><span class="master-health-icon">${icon("package")}</span><div><strong>${number(low.length)} productos con cobertura baja</strong><p>Disponibilidad por debajo del punto de reposición configurado.</p></div><a href="#catalog" class="btn secondary small">Ver umbrales</a></article><article><span class="master-health-icon">${icon("shield")}</span><div><strong>${number(totals.retainedCases ?? totals.quarantineCases)} cajas retenidas</strong><p>Incluye cuarentena, vencimiento o ubicación bloqueada. Se excluyen del disponible.</p></div></article></div></section><section class="panel master-data-health"><div class="section-heading"><h2>Calidad del catálogo</h2></div><dl><div><dt>Productos activos</dt><dd>${number(state.catalog.skus.filter((p) => p.active !== false).length)}</dd></div><div><dt>Fotografía vinculada</dt><dd>${number(state.catalog.skus.filter((p) => imagePath(p.imageUrl)).length)} / ${number(state.catalog.skus.length)}</dd></div><div><dt>Marca y categoría</dt><dd>${number(state.catalog.skus.filter((p) => p.brand && p.category).length)} / ${number(state.catalog.skus.length)}</dd></div><div><dt>Proveedores activos</dt><dd>${number(state.catalog.suppliers.filter((p) => p.active !== false).length)}</dd></div></dl></section></div>` +
      `<section class="panel master-stock-panel"><div class="section-heading"><div><h2>Inventario por producto</h2><p class="muted">Todas las cantidades se expresan en cajas. Consulta de administración.</p></div><span class="badge purple">Sólo consulta</span></div><div class="master-filter-row"><label class="master-search">${icon("search")}<input id="summary-search" type="search" value="${esc(summaryQuery)}" placeholder="Producto, marca o categoría" aria-label="Buscar inventario"></label><label>Mostrar<select id="summary-status"><option value="all">Todos los productos</option><option value="low">Cobertura baja</option><option value="retained">Con retención</option><option value="transit">En tránsito</option></select></label><span id="summary-count" class="muted"></span></div><div class="table-scroll"><table class="master-stock-table"><thead><tr><th>Producto</th><th>Disponible</th><th>Reservado</th><th>Retenido</th><th>En tránsito</th><th>En tiendas</th><th>Próximo vencimiento</th><th>Cobertura</th></tr></thead><tbody id="summary-rows"></tbody></table></div></section>` +
      `<section class="panel master-branch-summary"><div class="section-heading"><h2>Sucursales</h2><span class="muted">Inventario confirmado en cada tienda</span></div><div class="master-branch-grid">${
        (data.branches || [])
          .map((b) => {
            const branch = state.catalog.branches.find(
              (item) => item.id === (b.branchId || b.id),
            );
            return `<article>${icon("store")}<h3>${esc(branch?.name || b.name || "Tienda")}</h3><strong>${number(b.branchCases ?? b.totalCases ?? b.cases)}</strong><small>Cajas confirmadas · ${number(b.productCount)} productos</small><p>${number(b.pendingRequests)} solicitudes por liberar · ${number(b.inTransitCases)} cajas en camino</p>${b.awaitingReceipt ? `<span class="badge amber">${number(b.awaitingReceipt)} entregas por confirmar</span>` : ""}</article>`;
          })
          .join("") ||
        '<p class="muted">Las existencias por tienda aparecerán al recibir mercancía.</p>'
      }</div></section>`;
    const custodyNotes = [
      totals.returnCases > 0
        ? `${number(totals.returnCases)} cajas en devolución hacia el centro.`
        : "",
      totals.discrepancyCases > 0
        ? `${number(totals.discrepancyCases)} cajas pendientes de conciliar por diferencias de entrega.`
        : "",
    ].filter(Boolean);
    if (custodyNotes.length)
      $(".master-overview-metrics").insertAdjacentHTML(
        "afterend",
        message(custodyNotes.join(" "), "warning"),
      );
    $("#summary-status").value = summaryStatus;
    $("#summary-search").oninput = (e) => {
      summaryQuery = e.target.value;
      summaryRows();
    };
    $("#summary-status").onchange = (e) => {
      summaryStatus = e.target.value;
      summaryRows();
    };
    summaryRows();
  }
  function summaryRows() {
    const rows = filteredStockProducts();
    $("#summary-count").textContent = `${rows.length} productos`;
    $("#summary-rows").innerHTML =
      rows
        .map(
          (p) =>
            `<tr><td><div class="master-table-product"><span class="master-table-photo">${image(p.imageUrl, p.name)}</span><div><strong>${esc(p.name || "Producto")}</strong><small>${esc([p.brand, p.presentation].filter(Boolean).join(" · "))}</small><small>${esc(p.category || zones[p.zoneId] || "")}</small></div></div></td><td><strong>${number(p.availableCases)}</strong></td><td>${number(p.reservedCases)}</td><td>${number(p.retainedCases ?? p.quarantineCases)}</td><td>${number(p.inTransitCases)}</td><td>${number(p.branchCases)}</td><td>${p.nextExpiry ? esc(formatCalendarDate(p.nextExpiry)) : "Sin fecha próxima"}</td><td><span class="badge ${p.active === false || p.lowStock ? "amber" : "green"}">${p.active === false ? "Desactivado" : p.lowStock ? "Bajo umbral" : "Sobre el umbral"}</span><small>Reposición: ${number(p.reorderPoint)} cajas</small></td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="8"><div class="master-empty"><h3>No hay productos para este filtro</h3><p>Prueba otro nombre o cambia el estado de cobertura.</p></div></td></tr>';
  }
  function catalog() {
    const state = getState(),
      info = catalogInfo[catalogTab],
      items = (state.catalog[info.key] || []).filter(item => !item.deletedAt);
    fingerprint = JSON.stringify(state.catalog);
    const categories = [
      ...new Set(
        catalogTab === "sku"
          ? items.map((p) => p.category).filter(Boolean)
          : Object.values(zones),
      ),
    ].sort((a, b) => a.localeCompare(b, "es"));
    if (catalogCategory && !categories.includes(catalogCategory))
      catalogCategory = "";
    main.innerHTML =
      heading(
        "DATOS MAESTROS",
        "Catálogos",
        "Productos, proveedores y sucursales conectados con marcas y categorías verificadas.",
        btn("Exportar catálogo", "export-catalog") +
          btn(`+ Crear ${info.singular}`, "new-catalog", "", "primary"),
      ) +
      `<div class="catalog-tabs" role="tablist" aria-label="Catálogos">${Object.entries(
        catalogInfo,
      )
        .map(([id, value]) =>
          btn(
            `${value.title} <span class="master-tab-count">${number(state.catalog[value.key]?.length)}</span>`,
            "catalog-tab",
            id,
            id === catalogTab ? "primary" : "secondary",
            `role="tab" aria-selected="${id === catalogTab}"`,
          ),
        )
        .join(
          "",
        )}</div><section class="master-catalog" aria-label="${info.title}"><div class="master-filter-row"><label class="master-search">${icon("search")}<input type="search" id="catalog-search" placeholder="${catalogTab === "sku" ? "Producto, marca, categoría o código de barras" : "Nombre, contacto o código"}" value="${esc(catalogQuery)}" aria-label="Buscar ${info.title.toLowerCase()}"></label><label>Estado<select id="catalog-status"><option value="active">Activos</option><option value="inactive">Desactivados</option><option value="all">Todos</option></select></label><label>${catalogTab === "sku" ? "Categoría" : "Conservación"}<select id="catalog-category"><option value="">Todas</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></label><label>Ordenar<select id="catalog-sort"><option value="recent">Registros recientes primero</option><option value="name">Nombre A–Z</option><option value="name-desc">Nombre Z–A</option><option value="brand">Marca / categoría</option></select></label></div><div class="master-catalog-caption"><h2>${info.title}</h2><span id="catalog-result-count" class="muted" role="status" aria-live="polite"></span></div><div class="master-catalog-grid ${catalogTab === "supplier" ? "master-supplier-grid" : ""}" id="catalog-results"></div><div id="catalog-pagination" class="master-pagination"></div></section>`;
    $("#catalog-status").value = catalogStatus;
    $("#catalog-category").value = catalogCategory;
    $("#catalog-sort").value = catalogSort;
    $("#catalog-search").oninput = (e) => {
      catalogQuery = e.target.value;
      catalogPage = 1;
      catalogResults();
    };
    $("#catalog-status").onchange = (e) => {
      catalogStatus = e.target.value;
      catalogPage = 1;
      catalogResults();
    };
    $("#catalog-category").onchange = (e) => {
      catalogCategory = e.target.value;
      catalogPage = 1;
      catalogResults();
    };
    $("#catalog-sort").onchange = (e) => {
      catalogSort = e.target.value;
      catalogPage = 1;
      catalogResults();
    };
    $("#catalog-category").closest("label").hidden = catalogTab === "branch";
    catalogResults();
  }
  function catalogResults() {
    const state = getState(),
      info = catalogInfo[catalogTab],
      items = filteredCatalogItems();
    $("#catalog-result-count").textContent =
      `${items.length} de ${state.catalog[info.key].filter(item => !item.deletedAt).length} registros`;
    const pages = Math.max(1, Math.ceil(items.length / catalogPageSize));
    catalogPage = Math.max(1, Math.min(catalogPage, pages));
    persistCatalog();
    $("#catalog-results").innerHTML =
      items
        .slice(
          (catalogPage - 1) * catalogPageSize,
          catalogPage * catalogPageSize,
        )
        .map((item) => {
          const supplier = state.catalog.suppliers.find(
            (p) => p.id === item.supplierId,
          );
          return `<article class="master-record ${item.active === false ? "is-inactive" : ""}"><div class="master-record-media ${catalogTab !== "sku" ? "is-logo" : ""}">${catalogTab === "branch" ? `<span class="master-branch-icon">${icon("store")}</span>` : image(item[catalogTab === "supplier" ? "logoUrl" : "imageUrl"], item.name, catalogTab)}<span class="badge ${item.active === false ? "amber" : "green"}">${item.active === false ? "Desactivado" : "Activo"}</span></div><div class="master-record-content"><span class="master-record-kicker">${esc(catalogTab === "sku" ? [item.brand, item.category].filter(Boolean).join(" · ") || zones[item.zoneId] : catalogTab === "supplier" ? "Proveedor" : "Sucursal DonPepe")}</span><h3>${esc(item.name)}</h3>${catalogTab === "sku" ? `<p class="master-record-subtitle">${esc(item.presentation || "Presentación no indicada")}</p><div class="master-record-tags"><span>${esc(zones[item.zoneId])}</span><span>${number(item.unitsPerCase)} unidades / caja</span></div><dl class="master-record-facts"><div><dt>Proveedor</dt><dd>${esc(supplier?.name || "Sin asignar")}</dd></div><div><dt>Punto de reposición</dt><dd>${number(item.reorderPoint)} cajas</dd></div><div><dt>Código de barras</dt><dd>${esc(item.barcode || "Sin vincular")}</dd></div></dl>` : catalogTab === "supplier" ? `<div class="master-record-tags">${(item.zones || []).map((z) => `<span>${esc(zones[z])}</span>`).join("")}</div><dl class="master-record-facts"><div><dt>Contacto</dt><dd>${esc(item.contact || "No registrado")}</dd></div><div><dt>Correo</dt><dd>${esc(item.email || "No registrado")}</dd></div><div><dt>Teléfono</dt><dd>${esc(item.phone || "No registrado")}</dd></div><div><dt>Plazo de suministro</dt><dd>${item.leadDays === undefined ? "Por acordar" : `${number(item.leadDays)} días`}</dd></div></dl>` : `<p class="master-record-subtitle">Centro de venta y recepción de abastecimiento.</p><dl class="master-record-facts"><div><dt>Traslado simulado</dt><dd>${number(item.travelSeconds)} segundos</dd></div><div><dt>Ubicación de red</dt><dd>X ${number(item.x)} · Z ${number(item.z)}</dd></div></dl>`}<div class="master-record-footer"><small>${esc(item.code || item.id)}</small><div class="row-actions">${btn("Editar", "edit-catalog", item.id)}${btn(item.active !== false ? "Desactivar" : "Activar", item.active !== false ? "deactivate-catalog" : "activate-catalog", item.id)}${btn("Eliminar", "delete-catalog", item.id, "danger-ghost small", item.active !== false ? 'disabled title="Desactiva el registro antes de eliminarlo"' : "")}</div></div></div></article>`;
        })
        .join("") ||
      `<div class="master-empty"><h3>No hay coincidencias</h3><p>Prueba otro nombre o restablece los filtros.</p>${btn("Restablecer filtros", "reset-catalog")}</div>`;
    $("#catalog-pagination").innerHTML =
      `<span>${items.length ? (catalogPage - 1) * catalogPageSize + 1 : 0}–${Math.min(catalogPage * catalogPageSize, items.length)} de ${items.length}</span><label>Por página<select id="catalog-page-size" aria-label="Productos por página"><option value="24">24</option><option value="48">48</option></select></label><div>${btn("← Anterior", "catalog-page", catalogPage - 1, "secondary small", catalogPage <= 1 ? "disabled" : "")}<span>${catalogPage} / ${pages}</span>${btn("Siguiente →", "catalog-page", catalogPage + 1, "secondary small", catalogPage >= pages ? "disabled" : "")}</div>`;
    $("#catalog-page-size").value = String(catalogPageSize);
    $("#catalog-page-size").onchange = (event) => {
      catalogPageSize = Number(event.target.value);
      catalogPage = 1;
      catalogResults();
    };
    const pageItems = items.slice(
      (catalogPage - 1) * catalogPageSize,
      catalogPage * catalogPageSize,
    );
    $("#catalog-results")
      .querySelectorAll(".master-record")
      .forEach((card, index) => {
        const item = pageItems[index];
        if (catalogTab === "branch") {
          card
            .querySelector(".master-record-media")
            .classList.add("is-branch-photo");
          card
            .querySelector(".master-record-media")
            .insertAdjacentHTML(
              "afterbegin",
              image(item.imageUrl, item.name, "branch"),
            );
          card.querySelector(".master-branch-icon")?.remove();
          card.querySelector(".master-record-subtitle").textContent =
            [item.district, item.address].filter(Boolean).join(" · ") ||
            "Sucursal de la red DonPepe";
        }
        if (catalogTab === "supplier" && imagePath(item.imageUrl)) {
          card
            .querySelector(".master-record-media")
            .insertAdjacentHTML(
              "afterbegin",
              `<div class="master-supplier-cover">${image(item.imageUrl, `Representación de ${item.name}`, "supplier")}</div>`,
            );
        }
      });
  }
  function filteredCatalogItems() {
    const state = getState(),
      info = catalogInfo[catalogTab],
      query = catalogQuery.toLocaleLowerCase("es").trim();
    return (state.catalog[info.key] || [])
      .filter(item => !item.deletedAt)
      .filter((item) =>
        `${item.name} ${item.brand || ""} ${item.category || ""} ${item.barcode || ""} ${item.code || ""} ${item.contact || ""}`
          .toLocaleLowerCase("es")
          .includes(query),
      )
      .filter(
        (item) =>
          catalogStatus === "all" ||
          (catalogStatus === "active"
            ? item.active !== false
            : item.active === false),
      )
      .filter(
        (item) =>
          !catalogCategory ||
          (catalogTab === "sku"
            ? item.category === catalogCategory
            : catalogTab === "branch" ||
              (item.zones || []).some((z) => zones[z] === catalogCategory)),
      )
      .sort((a, b) =>
        catalogSort === "recent"
          ? (Date.parse(b.updatedAt || b.createdAt || "") || 0) -
              (Date.parse(a.updatedAt || a.createdAt || "") || 0) ||
            a.name.localeCompare(b.name, "es")
          : catalogSort === "brand"
            ? `${a.brand || a.category || ""} ${a.name}`.localeCompare(
                `${b.brand || b.category || ""} ${b.name}`,
                "es",
              )
            : a.name.localeCompare(b.name, "es") *
              (catalogSort === "name-desc" ? -1 : 1),
      );
  }
  function catalogForm(id) {
    const state = getState(),
      info = catalogInfo[catalogTab],
      item = state.catalog[info.key].find((x) => x.id === id);
    const revision = state.configuration.revision;
    let content =
      field(
        "code",
        "Código único",
        item?.code,
        'required maxlength="40" pattern="[A-Za-z0-9_-]+"',
      ) +
      field(
        "name",
        "Nombre",
        item?.name,
        'required minlength="3" maxlength="100"',
      );
    if (catalogTab === "sku")
      content +=
        field(
          "brand",
          "Marca",
          item?.brand,
          'required maxlength="80" placeholder="Ej. Gloria"',
        ) +
        field(
          "category",
          "Categoría comercial",
          item?.category,
          'required maxlength="80" list="master-categories" placeholder="Ej. Lácteos"',
        ) +
        `<datalist id="master-categories">${[...new Set(state.catalog.skus.map((p) => p.category).filter(Boolean))].map((category) => `<option value="${esc(category)}"></option>`).join("")}</datalist>` +
        field(
          "presentation",
          "Presentación",
          item?.presentation,
          'required maxlength="100" placeholder="Ej. Leche evaporada · lata 390 g"',
        ) +
        field(
          "barcode",
          "Código de barras GTIN / EAN (opcional)",
          item?.barcode,
          'inputmode="numeric" pattern="[0-9]{8}|[0-9]{12,14}" maxlength="14" placeholder="8, 12, 13 o 14 dígitos"',
        ) +
        field(
          "reorderPoint",
          "Punto de reposición (cajas)",
          item?.reorderPoint ?? 24,
          'required type="number" min="0" max="10000" step="1"',
        ) +
        `<label class="master-image-field">Fotografía del producto<input name="imageUrl" value="${esc(item?.imageUrl || "")}" list="master-image-assets" maxlength="180" placeholder="/images/products/archivo.webp"><small class="field-hint">Selecciona una fotografía real del catálogo o una imagen local autorizada.</small></label>` +
        select(
          "zoneId",
          "Conservación / zona compatible",
          Object.entries(zones),
          item?.zoneId || "DRY",
        ) +
        select(
          "supplierId",
          "Proveedor",
          state.catalog.suppliers
            .filter((s) => s.active !== false || s.id === item?.supplierId)
            .map((s) => [s.id, s.name]),
          item?.supplierId,
        ) +
        field("purchaseUnitPrice", "Compra por unidad sin IGV (S/)", (item?.purchaseUnitNetCents ?? 390)/100, 'required type="number" min="0.01" max="100000" step="0.01"') +
        field("purchaseTaxPercent", "Impuesto de compra (%)", (item?.purchaseTaxRateBps ?? 1800)/100, 'required type="number" min="0" max="100" step="0.01"') +
        field(
          "unitsPerCase",
          "Unidades por caja",
          item?.unitsPerCase || 12,
          'required type="number" min="1" max="240" step="1"',
        ) +
        field(
          "maxCasesPerHu",
          "Máximo de cajas por carga",
          item?.maxCasesPerHu || 24,
          'required type="number" min="1" max="24" step="1"',
        ) +
        `<label class="form-check"><input type="checkbox" name="expiryControlled" ${item?.expiryControlled !== false ? "checked" : ""}>Control obligatorio de vencimiento</label>`;
    if (catalogTab === "supplier")
      content +=
        field("legalName","Razón social",item?.legalName || item?.name || '', 'required maxlength="200"') +
        field("taxId","RUC (si está verificado)",item?.taxId || '', 'maxlength="11" pattern="[0-9]{11}" inputmode="numeric"') +
        field("billingAddress","Dirección comercial",item?.billingAddress || 'Lima, Perú', 'required maxlength="200"') +
        field("paymentTermDays","Crédito del proveedor (días)",item?.paymentTermDays ?? 30, 'required type="number" min="0" max="180" step="1"') +
        field("invoiceSeries","Serie de facturas",item?.invoiceSeries || 'F001', 'required pattern="F[A-Za-z0-9]{3}" maxlength="4"') +
        field(
          "contact",
          "Persona o área de contacto",
          item?.contact,
          'maxlength="100" placeholder="Área comercial"',
        ) +
        field(
          "email",
          "Correo comercial",
          item?.email,
          'type="email" maxlength="120" placeholder="ventas@proveedor.com"',
        ) +
        field(
          "phone",
          "Teléfono de contacto",
          item?.phone,
          'type="tel" maxlength="30" placeholder="+51 …"',
        ) +
        field(
          "site",
          "Sitio web oficial",
          item?.site,
          'type="url" maxlength="220" pattern="https://.*" placeholder="https://…"',
        ) +
        field(
          "leadDays",
          "Plazo habitual de suministro (días)",
          item?.leadDays ?? 2,
          'required type="number" min="0" max="90" step="1"',
        ) +
        `<label class="master-image-field">Logotipo del proveedor<input name="logoUrl" value="${esc(item?.logoUrl || "")}" list="master-image-assets" maxlength="180" placeholder="/images/suppliers/archivo.svg"><small class="field-hint">Utiliza el logotipo oficial, sin sustituirlo por una ilustración.</small></label>` +
        `<fieldset class="zones-fieldset"><legend>Familias de mercancía admitidas</legend>${Object.entries(
          zones,
        )
          .map(
            ([zone, label]) =>
              `<label class="form-check"><input type="checkbox" name="zones" value="${zone}" ${item?.zones?.includes(zone) ? "checked" : ""}>${label}</label>`,
          )
          .join("")}</fieldset>`;
    if (catalogTab === "branch")
      content +=
        field(
          "x",
          "Red de reparto · coordenada X",
          item?.x ?? -76,
          'required type="number" min="-160" max="160" step="1"',
        ) +
        field(
          "z",
          "Red de reparto · coordenada Z",
          item?.z ?? 83,
          'required type="number" min="-100" max="160" step="1"',
        ) +
        field(
          "travelSeconds",
          "Duración de viaje simulado (segundos)",
          item?.travelSeconds || 45,
          'required type="number" min="15" max="600" step="1"',
        );
    showDialog(
      `${item ? "Editar" : "Crear"} ${info.singular}`,
      `<form id="govern-form" class="master-edit-form"><div class="form-grid">${content}</div>${catalogTab !== "branch" ? `<datalist id="master-image-assets">${[...new Set(state.catalog[info.key].map((record) => record[catalogTab === "sku" ? "imageUrl" : "logoUrl"]).filter((url) => imagePath(url)))].map((url) => `<option value="${esc(url)}"></option>`).join("")}</datalist><div class="master-asset-preview"><div class="master-preview-image" id="master-preview-image">${image(item?.[catalogTab === "sku" ? "imageUrl" : "logoUrl"], item?.name || "Vista previa", catalogTab)}</div><div><strong>Vista previa ${catalogTab === "sku" ? "del producto" : "del logotipo"}</strong><p>La imagen se conserva en su proporción original.</p><span id="master-preview-status" class="muted">${imagePath(item?.[catalogTab === "sku" ? "imageUrl" : "logoUrl"]) ? "Imagen local vinculada" : "Aún no has vinculado una imagen"}</span></div></div>` : ""}${message(catalogTab === "branch" ? "La tienda debe quedar fuera de la nave y separada de las existentes. Con stock o pedidos pendientes no se modifica su posición." : "La conservación, el proveedor y las capacidades deben ser compatibles. Los datos con movimientos no se reescriben de forma retroactiva.")}${errorField}<div class="dialog-actions"><button type="button" class="btn secondary" data-govern="close">Cancelar</button><button class="btn primary">Guardar ${info.singular}</button></div></form>`,
      "ADMINISTRACIÓN · CATÁLOGOS",
    );
    const form = $("#govern-form");
    if (
      catalogTab === "sku" &&
      state.catalog.brands?.length &&
      state.catalog.categories?.length
    ) {
      const brandId =
        item?.brandId ||
        state.catalog.brands.find((row) => row.name === item?.brand)?.id;
      const categoryId =
        item?.categoryId ||
        state.catalog.categories.find((row) => row.name === item?.category)?.id;
      form.elements.brand.closest("label").outerHTML = select(
        "brandId",
        "Marca registrada",
        [
          ["", "Selecciona una marca"],
          ...state.catalog.brands
            .filter((row) => row.active !== false || row.id === brandId)
            .map((row) => [row.id, row.name]),
        ],
        brandId || "",
      );
      form.elements.category.closest("label").outerHTML = select(
        "categoryId",
        "Categoría registrada",
        [
          ["", "Selecciona una categoría"],
          ...state.catalog.categories
            .filter((row) => row.active !== false || row.id === categoryId)
            .map((row) => [row.id, row.name]),
        ],
        categoryId || "",
      );
      form.elements.brandId.required = true;
      form.elements.categoryId.required = true;
    }
    if (catalogTab === "branch") {
      form
        .querySelector(".form-grid")
        .insertAdjacentHTML(
          "beforeend",
          field(
            "district",
            "Distrito",
            item?.district,
            'required minlength="3" maxlength="100"',
          ) +
            field(
              "address",
              "Dirección de la sucursal",
              item?.address,
              'required minlength="5" maxlength="200"',
            ) +
            field(
              "manager",
              "Responsable de la tienda",
              item?.manager,
              'maxlength="100"',
            ) +
            field(
              "phone",
              "Teléfono",
              item?.phone,
              'type="tel" maxlength="30"',
            ) +
            `<label class="master-image-field">Fotografía de la sucursal<input name="imageUrl" value="${esc(item?.imageUrl || "")}" maxlength="180" placeholder="/images/representations/tienda.webp"></label>`,
        );
      form
        .querySelector(".form-grid")
        .insertAdjacentHTML(
          "afterend",
          `<div class="master-asset-preview"><div class="master-preview-image" id="master-preview-image">${image(item?.imageUrl, item?.name || "Sucursal")}</div><div><strong>Vista previa de la sucursal</strong><p>Comprueba el encuadre antes de guardar.</p><span class="muted" id="master-preview-status">${imagePath(item?.imageUrl) ? "Imagen vinculada" : "Selecciona una fotografía"}</span></div></div>`,
        );
    }
    if (catalogTab === "supplier")
      form
        .querySelector(".form-grid")
        .insertAdjacentHTML(
          "beforeend",
          `<label class="master-image-field">Imagen representativa de instalaciones<input name="imageUrl" value="${esc(item?.imageUrl || "")}" maxlength="180" placeholder="/images/representations/proveedor.webp"><small class="field-hint">Representación separada del logotipo oficial. No certifica una instalación real del proveedor.</small></label>`,
        );
    form
      .querySelector(".form-grid")
      .insertAdjacentHTML(
        "beforeend",
        `<p class="field-hint">Estado: ${item?.active === false ? "Desactivado" : "Activo"}. Usa las acciones del registro para cambiar su disponibilidad.</p>`,
      );
    if (catalogTab === "sku") {
      const updateSuppliers = () => {
        const selected = form.elements.supplierId.value;
        const suppliers = state.catalog.suppliers.filter(
          (supplier) =>
            supplier.active !== false &&
            supplier.zones.includes(form.elements.zoneId.value),
        );
        form.elements.supplierId.innerHTML =
          suppliers
            .map(
              (supplier) =>
                `<option value="${esc(supplier.id)}" ${supplier.id === selected ? "selected" : ""}>${esc(supplier.name)}</option>`,
            )
            .join("") ||
          '<option value="">No hay proveedores compatibles</option>';
        form.elements.supplierId.required = true;
        if (form.elements.categoryId) {
          const selected = form.elements.categoryId.value;
          form.elements.categoryId.innerHTML =
            '<option value="">Selecciona una categoría compatible</option>' +
            state.catalog.categories
              .filter(
                (row) =>
                  row.active !== false &&
                  row.zoneIds?.includes(form.elements.zoneId.value),
              )
              .map(
                (row) =>
                  `<option value="${esc(row.id)}" ${selected === row.id ? "selected" : ""}>${esc(row.name)}</option>`,
              )
              .join("");
        }
        updateBrands();
      };
      const updateBrands = () => {
        if (!form.elements.brandId) return;
        const selected = form.elements.brandId.value;
        form.elements.brandId.innerHTML =
          '<option value="">Selecciona una marca del proveedor</option>' +
          state.catalog.brands
            .filter(
              (row) =>
                row.active !== false &&
                row.supplierIds?.includes(form.elements.supplierId.value),
            )
            .map(
              (row) =>
                `<option value="${esc(row.id)}" ${selected === row.id ? "selected" : ""}>${esc(row.name)}</option>`,
            )
            .join("");
      };
      form.elements.zoneId.addEventListener("change", updateSuppliers);
      form.elements.supplierId.addEventListener("change", updateBrands);
      updateSuppliers();
    }
    const imageInput =
      form.elements[catalogTab === "supplier" ? "logoUrl" : "imageUrl"];
    if (catalogTab === "branch" && imageInput) {
      imageInput.required = true;
      if (!item && !imageInput.value)
        imageInput.value = "/images/representations/branch-san-miguel.webp";
    }
    if (imageInput) {
      const picker = document.createElement("label"),
        key = catalogTab === "supplier" ? "logoUrl" : "imageUrl";
      picker.className = "master-asset-picker";
      picker.innerHTML = `Biblioteca de imágenes<select aria-label="Elegir imagen del catálogo"><option value="">Seleccionar fotografía o logotipo…</option>${state.catalog[
        info.key
      ]
        .filter((record) => imagePath(record[key]))
        .map(
          (record) =>
            `<option value="${esc(record[key])}" ${record[key] === imageInput.value ? "selected" : ""}>${esc(record.name)}</option>`,
        )
        .join("")}</select>`;
      imageInput.closest("label").before(picker);
      picker.querySelector("select").addEventListener("change", (event) => {
        imageInput.value = event.target.value;
        imageInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    imageInput?.addEventListener("input", () => {
      $("#master-preview-image").innerHTML = image(
        imageInput.value.trim(),
        form.elements.name.value || "Vista previa",
        catalogTab,
      );
      $("#master-preview-status").textContent = imagePath(
        imageInput.value.trim(),
      )
        ? "Imagen local vinculada"
        : imageInput.value
          ? "Selecciona una imagen local autorizada"
          : "Aún no has vinculado una imagen";
    });
    if (imageInput)
      bindCatalogUpload({
        form,
        api,
        kind: catalogTab,
        fieldName: catalogTab === "supplier" ? "logoUrl" : "imageUrl",
      });
    bindForm(form, async () => {
      const data = Object.fromEntries(new FormData(form));
      if (catalogTab === "sku") {
        if (data.brandId)
          data.brand = state.catalog.brands.find(
            (row) => row.id === data.brandId,
          )?.name;
        if (data.categoryId)
          data.category = state.catalog.categories.find(
            (row) => row.id === data.categoryId,
          )?.name;
        data.purchaseUnitPrice=Number(data.purchaseUnitPrice);
        data.purchaseTaxPercent=Number(data.purchaseTaxPercent);
        data.unitsPerCase = Number(data.unitsPerCase);
        data.maxCasesPerHu = Number(data.maxCasesPerHu);
        data.reorderPoint = Number(data.reorderPoint);
        data.expiryControlled = form.elements.expiryControlled.checked;
      }
      if (catalogTab === "supplier") {
        data.zones = new FormData(form).getAll("zones");
        data.leadDays = Number(data.leadDays);
        data.paymentTermDays=Number(data.paymentTermDays);
      }
      if (catalogTab === "branch")
        for (const key of ["x", "z", "travelSeconds"])
          data[key] = Number(data[key]);
      await command(
        `config.${catalogTab}.${item ? "update" : "create"}`,
        {
          ...data,
          ...(item ? { id: item.id } : {}),
          expectedRevision: revision,
        },
        "Catálogo guardado.",
      );
      dialog.close();
      catalog();
    });
  }
  async function settings() {
    const data = await api("/api/settings");
    if (current !== "settings") return;
    const settings = data.settings || getState().configuration.settings,
      revision = data.revision ?? getState().configuration.revision;
    main.innerHTML =
      heading(
        "REGLAS DEL SISTEMA",
        "Configuración",
        "Los cambios respetan las capacidades físicas del escenario. No trasladan existencias ni detienen equipos.",
      ) +
      `<div class="govern-columns"><section class="panel"><div class="section-heading"><h2>Políticas logísticas</h2></div><form id="settings-form" class="pad"><div class="form-grid">${field("packagingDamagePercent", "Probabilidad de daño por palé (%)", settings.packagingDamagePercent ?? 12, 'type="number" required min="0" max="100" step="1"')}${field("maxOrderCases", "Cajas máximas por pedido", settings.maxOrderCases, 'type="number" required min="1" max="120" step="1"')}${field("minShelfLifeDays", "Vida útil mínima al liberar (días)", settings.minShelfLifeDays, 'type="number" required min="0" max="30" step="1"')}${field("maxOpenOrdersPerBranch", "Pedidos abiertos máximos por tienda", settings.maxOpenOrdersPerBranch, 'type="number" required min="1" max="50" step="1"')}</div><p class="field-hint">Una actualización concurrente requiere recargar las reglas. Los documentos anteriores conservan su trazabilidad.</p><p id="settings-error" class="form-error" role="alert"></p><button class="btn primary">Guardar reglas</button></form></section><section class="panel"><div class="section-heading"><h2>Entrega de recuperación</h2><span class="badge ${data.mail?.configured ? "green" : "amber"}">${data.mail?.configured ? "Configurado" : "Requiere configuración"}</span></div><div class="pad"><h3>Gmail individual y verificado</h3><p>Cada usuario vincula su propio correo. Administración aprueba la solicitud; el sistema entrega el enlace de un uso a ese Gmail.</p><dl class="security-facts"><div><dt>Servidor</dt><dd>${esc(data.mail?.host || "Sin configurar")}</dd></div><div><dt>Remitente</dt><dd>${esc(data.mail?.from || "Sin configurar")}</dd></div><div><dt>Secretos</dt><dd>Protegidos en el servidor, nunca visibles en esta interfaz.</dd></div></dl>${message("Los datos SMTP se conservan en las variables protegidas del servidor. Un indicador configurado no garantiza la entrega ni sustituye un envío real.")}</div></section></div>`;
    const company=getState().configuration.company || {};
    main.insertAdjacentHTML("beforeend",`<section class="panel"><div class="section-heading"><h2>Datos de facturación de DonPepe</h2></div><form id="company-billing-form" class="pad"><div class="form-grid">${field("legalName","Razón social",company.legalName,'required maxlength="200"')}${field("taxId","RUC verificado (opcional)",company.taxId,'maxlength="11" pattern="[0-9]{11}" inputmode="numeric"')}${field("address","Dirección de facturación",company.address,'required maxlength="200"')}${field("email","Correo de compras",company.email,'type="email" maxlength="120"')}</div><p id="company-error" class="form-error" role="alert"></p><button class="btn primary">Guardar datos</button></form></section>`);
    bindForm($("#company-billing-form"),async()=>{await command("config.company.update",{data:Object.fromEntries(new FormData($("#company-billing-form"))),expectedRevision:getState().configuration.revision},"Datos de facturación guardados.");},"#company-error");
    bindForm(
      $("#settings-form"),
      async () => {
        const form = $("#settings-form"),
          values = Object.fromEntries(
            [...new FormData(form)].map(([key, value]) => [key, Number(value)]),
          );
        await command(
          "config.settings.update",
          { settings: values, expectedRevision: revision },
          "Reglas actualizadas.",
        );
        await settingsReload();
      },
      "#settings-error",
    );
  }
  async function settingsReload() {
    await settings();
  }
  async function recoveries() {
    const data = await api("/api/recoveries");
    if (current !== "recoveries") return;
    recoveryFingerprint = String(getState().metrics.pendingRecoveries);
    const labels = {
      PENDING: "Pendiente de aprobación",
      APPROVED: "Aprobada",
      REJECTED: "Rechazada",
      COMPLETED: "Completada",
      EXPIRED: "Caducada",
    };
    main.innerHTML =
      heading(
        "SEGURIDAD DE CUENTAS",
        "Recuperación de acceso",
        "No se muestran enlaces de recuperación al administrador. Cada enlace caduca y sólo puede utilizarse una vez.",
        btn("Actualizar solicitudes", "reload"),
      ) +
      `<div class="govern-summary"><article><span>Pendientes</span><b>${data.stats.pending}</b></article><article><span>Enlaces activos</span><b>${data.stats.active}</b></article><article><span>Errores de entrega</span><b>${data.stats.errors}</b></article></div><section class="panel"><div class="section-heading"><h2>Solicitudes recibidas</h2><span class="muted">${data.requests.length} solicitudes</span></div><div class="recovery-list">${data.requests.map((r) => `<article class="recovery-card"><div><span class="badge ${r.status === "PENDING" ? "amber" : r.status === "REJECTED" ? "red" : "purple"}">${esc(labels[r.status] || r.status)}</span><h3>${esc(r.userName)}</h3><p>${esc(r.email)}</p><small>Destino verificado: ${esc(r.recoveryEmail || "No disponible")}</small><small>Solicitada ${date(r.createdAt)} · ${esc(r.id)}</small>${r.reason ? `<p>${esc(r.reason)}</p>` : ""}${r.deliveryStatus === "ERROR" ? message(r.deliveryError || "No se pudo entregar el correo. Puedes reintentar sin aprobar otra solicitud.", "warning") : r.deliveryStatus === "SENT" ? '<p class="text-success">Correo entregado al servidor de envío.</p>' : ""}</div><div class="row-actions">${r.status === "PENDING" ? btn("Aprobar y enviar", "approve-recovery", r.id, "primary small") + btn("Rechazar", "reject-recovery", r.id, "danger-ghost small") : r.status === "APPROVED" && r.deliveryStatus === "ERROR" ? btn("Reintentar entrega", "resend-recovery", r.id) : ""}</div></article>`).join("") || '<div class="empty-state"><h3>No hay solicitudes pendientes</h3><p>Las solicitudes reales aparecerán aquí sin revelar contraseñas ni tokens.</p></div>'}</div></section>`;
    for (const request of data.requests.filter((r) => !r.recoveryVerified)) {
      const approve = main.querySelector(
        `[data-govern="approve-recovery"][data-id="${request.id}"]`,
      );
      if (approve) {
        approve.disabled = true;
        approve.textContent = "Falta verificar el Gmail";
      }
      const card = approve?.closest(".recovery-card");
      if (card)
        card.querySelector("small").textContent =
          "El propietario aún no ha verificado su Gmail; no se puede enviar un enlace.";
    }
  }
  async function audit(keepForm = false) {
    const sequence = ++auditSequence;
    const query = new URLSearchParams(
      Object.entries(auditFilters).filter(([, value]) => value !== ""),
    );
    const data = await api(`/api/audit?${query}`);
    if (current !== "audit") return;
    if (sequence !== auditSequence) return;
    auditData = data;
    if (!keepForm || !$("#audit-filter-form")) {
      main.innerHTML =
        heading(
          "TRAZABILIDAD DE GOBIERNO",
          "Auditoría",
          "Cada cambio conserva su responsable, resultado y detalle de la decisión.",
          btn("Exportar página", "audit-export") +
            btn("Actualizar historial", "reload"),
        ) +
        `<section class="panel audit-panel"><form id="audit-filter-form" class="audit-filter-form"><label class="master-search">${icon("search")}<input name="q" type="search" maxlength="150" value="${esc(auditFilters.q)}" placeholder="Persona, recurso o acción" aria-label="Buscar en auditoría"></label>${select("action", "Acción", [["", "Todas"], ...(data.filters?.actions || []).map((action) => [action, auditAction(action)])], auditFilters.action)}${select("outcome", "Resultado", [["", "Todos"], ...(data.filters?.outcomes || ["SUCCESS", "DENIED", "ERROR"]).map((value) => [value, auditOutcome(value)])], auditFilters.outcome)}${select("actorId", "Responsable", [["", "Todos"], ...(data.filters?.actors || []).map((actor) => [actor.id, actor.name || "Sistema"])], auditFilters.actorId)}${field("from", "Desde", auditFilters.from, 'type="date"')}${field("to", "Hasta", auditFilters.to, 'type="date"')}<div class="row-actions">${btn("Limpiar", "audit-reset")}</div><p class="form-error admin-wide-field" id="audit-filter-error" role="alert"></p></form><div class="section-heading"><h2>Registro de actividad</h2><span id="audit-count" class="muted" role="status" aria-live="polite"></span></div><div class="table-scroll"><table class="audit-table"><thead><tr><th>Fecha</th><th>Acción y recurso</th><th>Responsable</th><th>Resultado</th><th></th></tr></thead><tbody id="audit-rows"></tbody></table></div><div class="master-pagination" id="audit-pagination"></div></section>`;
      const form = $("#audit-filter-form");
      form.onsubmit = (event) => event.preventDefault();
      const updateFilters = (event) => {
        if (!event.target.name) return;
        if (event.type === "input" && event.target.tagName === "SELECT") return;
        clearTimeout(auditTimer);
        auditSequence++;
        const values = Object.fromEntries(new FormData(form));
        values.q = values.q.trim();
        auditFilters = { ...auditFilters, ...values, page: 1 };
        const invalid = values.from && values.to && values.from > values.to;
        $("#audit-filter-error").textContent = invalid
          ? "La fecha final debe ser igual o posterior a la inicial."
          : "";
        for (const name of ["from", "to"]) {
          if (invalid) form.elements[name].setAttribute("aria-invalid", "true");
          else form.elements[name].removeAttribute("aria-invalid");
        }
        if (invalid) return;
        const run = () => {
          if (current !== "audit" || !form.isConnected) return;
          const pending = auditSequence;
          audit(true).catch((error) => {
            if (
              current === "audit" &&
              form.isConnected &&
              auditSequence === pending + 1
            )
              $("#audit-filter-error").textContent = error.message;
          });
        };
        if (event.target.type === "search") auditTimer = setTimeout(run, 120);
        else run();
      };
      form.oninput = updateFilters;
      form.onchange = updateFilters;
    }
    auditRows();
  }
  function auditAction(value = "") {
    const labels = {
      LOGIN_SUCCEEDED: "Ingreso correcto",
      LOGIN_FAILED: "Ingreso rechazado",
      USER_CREATED: "Cuenta creada",
      USER_UPDATED: "Cuenta actualizada",
      USER_ARCHIVED: "Cuenta eliminada (registro anterior)",
      USER_DELETED: "Cuenta eliminada",
      USER_STATUS_CHANGED: "Estado de acceso actualizado",
      USER_AVATAR_UPDATED: "Fotografía de usuario actualizada",
      USER_AVATAR_REMOVED: "Fotografía de usuario eliminada",
      PROFILE_AVATAR_UPDATED: "Fotografía de perfil actualizada",
      ROLE_PERMISSIONS_UPDATED: "Permisos actualizados",
      CONFIGURATION_CHANGED: "Configuración modificada",
      COMMAND_ACCEPTED: "Acción confirmada",
      COMMAND_EXECUTED: "Acción ejecutada",
      COMMAND_REJECTED: "Acción rechazada",
      COMMAND_FAILED: "Acción con error",
      COMMAND_DENIED: "Acción bloqueada",
      REQUEST_DENIED: "Solicitud bloqueada",
      REQUEST_REJECTED: "Solicitud rechazada",
      REQUEST_FAILED: "Solicitud con error",
      ACCESS_DENIED: "Acceso denegado",
      DEVICE_SETTINGS_APPLIED: "Reglas de equipo aplicadas",
      AUTONOMOUS_PROCESS_EVENT: "Hito de proceso autónomo",
      CONFIG_SETTINGS_UPDATED: "Reglas generales actualizadas",
      LOGOUT: "Sesión cerrada",
      USER_ACTIVATED: "Cuenta reactivada",
      USER_DEACTIVATED: "Cuenta desactivada",
      USER_PHOTO_UPDATED: "Fotografía de usuario actualizada",
      USER_PHOTO_REMOVED: "Fotografía de usuario eliminada",
      PROFILE_PHOTO_UPDATED: "Fotografía de perfil actualizada",
      PROFILE_PHOTO_REMOVED: "Fotografía de perfil eliminada",
      PROFILE_UPDATED: "Datos personales actualizados",
      PASSWORD_CHANGED: "Contraseña cambiada",
      PASSWORD_RECOVERED: "Acceso recuperado",
      RECOVERY_REQUESTED: "Recuperación solicitada",
      RECOVERY_EMAIL_SENT: "Correo de recuperación enviado",
      RECOVERY_EMAIL_FAILED: "Error de entrega de recuperación",
      RECOVERY_EMAIL_VERIFIED: "Correo de recuperación verificado",
      RECOVERY_VERIFICATION_SENT: "Verificación de correo enviada",
      RECOVERY_VERIFICATION_DELIVERY_FAILED: "Error de entrega de verificación",
      ADMIN_SELF_SERVICE_RECOVERY: "Recuperación del administrador",
      PASSWORD_RECOVERY_REQUESTED: "Recuperación solicitada",
      RECOVERY_APPROVED: "Recuperación aprobada",
      RECOVERY_REJECTED: "Recuperación rechazada",
      PASSWORD_RESET_COMPLETED: "Contraseña restablecida",
      CATALOG_MEDIA_UPLOADED: "Imagen de catálogo guardada",
    };
    return (
      labels[value] ||
      String(value)
        .replaceAll("_", " ")
        .toLocaleLowerCase("es")
        .replace(/^./, (letter) => letter.toLocaleUpperCase("es"))
    );
  }
  function auditOutcome(value) {
    return (
      {
        SUCCESS: "Correcto",
        OK: "Correcto",
        ALLOWED: "Permitido",
        DENIED: "Bloqueado",
        ERROR: "Error",
        FAILED: "Fallido",
      }[value] ||
      value ||
      "Registrado"
    );
  }
  function auditRedact(value, key = "") {
    if (/password|token|secret|credential|smtp|dataurl|hash|blob/i.test(key))
      return "[Protegido]";
    if (Array.isArray(value)) return value.map((item) => auditRedact(item));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([name, item]) => [
          name,
          auditRedact(item, name),
        ]),
      );
    return value;
  }
  function auditValue(value) {
    const safe = auditRedact(value);
    return safe === undefined || safe === null || safe === ""
      ? "Sin valor"
      : typeof safe === "boolean"
        ? safe
          ? "Sí"
          : "No"
        : Array.isArray(safe)
          ? safe.length
            ? safe
                .slice(0, 30)
                .map((item, index) => `${index + 1}. ${auditValue(item)}`)
                .join("\n\n") +
              (safe.length > 30
                ? `\n\n${safe.length - 30} registros adicionales`
                : "")
            : "Sin elementos"
          : typeof safe === "object"
            ? Object.entries(safe)
                .map(
                  ([key, item]) =>
                    `${auditFieldLabel(key)}: ${auditFieldValue(item, key)}`,
                )
                .join("\n")
            : String(safe);
  }
  function auditFieldLabel(field) {
    const labels = {
      name: "Nombre",
      email: "Correo",
      active: "Registro activo",
      role: "Perfil",
      branchId: "Sucursal",
      autoAssign: "Asignación automática",
      priority: "Preferencia de asignación",
      speedProfile: "Perfil de desplazamiento",
      allowedTasks: "Trabajos autorizados",
      chargeBelowPercent: "Umbral de recarga (%)",
      resumeAtPercent: "Reanudación tras recarga (%)",
      avatarUrl: "Fotografía",
      imageUrl: "Imagen",
      settings: "Reglas del equipo",
      permissions: "Permisos",
      status: "Estado",
      state: "Estado",
      code: "Referencia",
      description: "Descripción",
      notes: "Observaciones",
      supplierIds: "Proveedores",
      zoneIds: "Conservación",
      expectedRevision: "Versión esperada",
      revision: "Versión del registro",
      configurationRevision: "Versión de las reglas",
      settingsRevision: "Versión de configuración del equipo",
      settingsAppliedAt: "Configuración aplicada el",
      settingsAppliedBy: "Configuración aplicada por",
      type: "Acción",
      actorName: "Responsable",
      targetLabel: "Recurso",
      reason: "Motivo",
      correlationId: "Referencia de seguimiento",
      jobId: "Proceso autónomo",
      purchaseId: "Compra de origen",
      orderId: "Pedido de tienda",
      exceptionId: "Excepción vinculada",
      evidenceIds: "Evidencias vinculadas",
      eventType: "Tipo de hito",
      sourceMode: "Origen de ejecución",
      requestIp: "Origen de la solicitud",
      requestPath: "Recurso solicitado",
      method: "Método de la solicitud",
      actorRole: "Perfil responsable",
      atLocal: "Fecha y hora de Lima",
      localDate: "Día de la operación en Lima",
      timeZone: "Zona horaria",
      createdBy: "Creado por",
      updatedBy: "Última modificación por",
      createdAt: "Fecha de creación",
      updatedAt: "Fecha de actualización",
      activatedAt: "Fecha de activación",
      deactivatedAt: "Fecha de desactivación",
      deletedAt: "Fecha de eliminación",
      statusReason: "Motivo del cambio de estado",
      stock: "Existencias por lote",
      locationLabel: "Ubicación descriptiva",
      sourceLabel: "Origen descriptivo",
      destinationLabel: "Destino descriptivo",
      skuId: "Producto",
      skuCode: "Referencia del producto",
      skuName: "Nombre del producto",
      cases: "Cajas",
      receivedCases: "Cajas recibidas",
      lines: "Productos del documento",
      lot: "Lote de proveedor",
      expiry: "Vencimiento",
      receivedAt: "Fecha de recepción",
      locationId: "Ubicación",
      sourceId: "Punto de origen",
      destinationId: "Punto de destino",
      externalReference: "Referencia de venta o salida",
    };
    const final = String(field).split(".").at(-1);
    return (
      labels[final] ||
      String(final)
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replaceAll("_", " ")
        .replace(/^./, (letter) => letter.toLocaleUpperCase("es"))
    );
  }
  function auditFieldValue(value, field) {
    const final = String(field).split(".").at(-1);
    if (value === null || value === undefined || value === "")
      return "Sin valor";
    if (/At$|AtLocal$|^at$|^atLocal$/.test(final)) return date(value);
    if (
      [
        "expiry",
        "localDate",
        "requestedByDate",
        "scheduledDate",
        "performedDate",
      ].includes(final)
    )
      return formatCalendarDate(value);
    if (final === "skuId")
      return (
        getState().catalog.skus.find((row) => row.id === value)?.name ||
        String(value)
      );
    if (final === "branchId")
      return (
        getState().catalog.branches.find((row) => row.id === value)?.name ||
        String(value)
      );
    if (
      ["locationId", "sourceId", "destinationId"].includes(final) &&
      typeof value === "string"
    ) {
      const location = value.match(
        /^CD(\d+)-(SEC|REF|CON|LIM)-A(\d+)-R(\d+)-N(\d+)-P(\d+)$/,
      );
      if (location)
        return `Centro ${location[1]} · ${{ SEC: "Reserva seca", REF: "Refrigerado", CON: "Congelado", LIM: "Limpieza" }[location[2]]} · Pasillo ${location[3]} · Rack ${location[4]} · Nivel ${location[5]} · Posición ${location[6]} (${value})`;
    }
    if (/AppliedBy$|actorId$|requestedBy$|createdBy$|updatedBy$/.test(final))
      return (
        (value === getUser().id
          ? getUser().name
          : cachedUsers.find((user) => user.id === value)?.name ||
            auditData.filters?.actors?.find((actor) => actor.id === value)
              ?.name) || "Cuenta del sistema"
      );
    if (final === "speedProfile")
      return (
        { NORMAL: "Normal", ECO: "Eco · 75 % de la velocidad normal" }[value] ||
        auditValue(value)
      );
    if (final === "role" || final === "actorRole")
      return (
        {
          admin: "Administrador del sistema",
          operations: "Jefe de operaciones",
          store: "Gestor de tienda",
          automation: "Orquestador automático",
          public: "Acceso público",
        }[value] || auditValue(value)
      );
    if (final === "type" && typeof value === "string") {
      const [, kind, action] = value.split(".");
      const verbs = { deactivate: "Desactivar", activate: "Activar", delete: "Eliminar" };
      const nouns = { sku: "producto", supplier: "proveedor", branch: "sucursal", brand: "marca", category: "categoría", asset: "equipo" };
      if (value.startsWith("config.") && verbs[action] && nouns[kind]) return `${verbs[action]} ${nouns[kind]}`;
    }
    if (final === "type")
      return (
        {
          "config.asset.configure": "Configurar reglas de un equipo",
          "config.asset.update": "Actualizar ficha técnica",
          "config.sku.update": "Actualizar producto",
          "config.brand.update": "Actualizar marca",
          "config.category.update": "Actualizar categoría",
          "config.supplier.update": "Actualizar proveedor",
          "config.branch.update": "Actualizar sucursal",
          "config.settings.update": "Actualizar reglas del centro",
        }[value] || auditAction(String(value).replaceAll(".", "_"))
      );
    if (final === "allowedTasks" && Array.isArray(value))
      return value
        .map(
          (task) =>
            ({
              PUTAWAY: "Almacenar mercancía recibida",
              PICK: "Recoger mercancía",
              PICK_TO_PACK: "Llevar a preparación",
              TO_STAGING: "Llevar a consolidación",
              RETURN_TO_QUARANTINE: "Retorno seguro a cuarentena",
              TRUCK_LOAD: "Cargar camión",
              TRUCK_UNLOAD: "Descargar carga",
              DELIVERY: "Repartir a sucursales",
              RETURN_PICKUP: "Recoger devoluciones",
            })[task] || task,
        )
        .join(" · ");
    return auditValue(auditRedact(value, field));
  }
  function auditRows() {
    const rows = auditData.events || auditData.audit || [],
      page = auditData.page || auditFilters.page,
      pages = Math.max(1, auditData.pages || 1),
      total = auditData.total ?? rows.length;
    $("#audit-count").textContent =
      `${number(total)} eventos · página ${page} de ${pages}`;
    $("#audit-rows").innerHTML =
      rows
        .map(
          (row, index) =>
            `<tr><td><time>${esc(date(row.createdAt || row.at))}</time></td><td><strong>${esc(auditAction(row.action || row.type))}</strong><small>${esc(row.targetLabel || row.details?.targetLabel || row.summary || "Registro del sistema")}</small></td><td>${esc(row.actorName || "Sistema")}</td><td><span class="badge ${["DENIED", "ERROR", "FAILED"].includes(row.outcome) ? "red" : "green"}">${esc(auditOutcome(row.outcome))}</span></td><td>${btn("Ver detalle", "audit-detail", index)}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="5"><div class="master-empty"><h3>No hay eventos para estos filtros</h3><p>Amplía las fechas o cambia la acción seleccionada.</p></div></td></tr>';
    $("#audit-pagination").innerHTML =
      `<span>${number(total)} eventos encontrados</span><div>${btn("← Anterior", "audit-page", page - 1, "secondary small", page <= 1 ? "disabled" : "")}<span>${page} / ${pages}</span>${btn("Siguiente →", "audit-page", page + 1, "secondary small", page >= pages ? "disabled" : "")}</div>`;
  }
  function auditDetail(index) {
    const row = (auditData.events || auditData.audit || [])[Number(index)];
    if (!row) return;
    const before = auditRedact(row.before || row.details?.before || {}),
      after = auditRedact(row.after || row.details?.after || {});
    const changes =
      row.changes ||
      row.details?.changes ||
      [...new Set([...Object.keys(before), ...Object.keys(after)])]
        .filter(
          (field) =>
            JSON.stringify(before[field]) !== JSON.stringify(after[field]),
        )
        .map((field) => ({
          field,
          before: before[field],
          after: after[field],
        }));
    const details = auditRedact(row.details || {});
    for (const key of [
      "before",
      "after",
      "changes",
      "targetLabel",
      "correlationId",
      "actorName",
    ])
      delete details[key];
    showDialog(
      auditAction(row.action || row.type),
      `<section class="audit-inspection"><div class="audit-detail-heading"><span class="audit-detail-icon">${icon("clipboard")}</span><div><h3>${esc(row.targetLabel || row.details?.targetLabel || "Registro del sistema")}</h3><p>${esc(row.actorName || "Sistema")} · ${esc(date(row.createdAt || row.at))}</p></div><span class="badge ${["DENIED", "ERROR", "FAILED"].includes(row.outcome) ? "red" : "green"}">${esc(auditOutcome(row.outcome))}</span></div>${changes.length ? `<h3>Comparación del cambio</h3><div class="table-scroll"><table class="audit-change-table"><thead><tr><th>Campo</th><th>Antes</th><th>Después</th></tr></thead><tbody>${changes.map((change) => `<tr><td><strong>${esc(auditFieldLabel(change.field) || change.label)}</strong></td><td><pre>${esc(auditFieldValue(change.before, change.field))}</pre></td><td><pre>${esc(auditFieldValue(change.after, change.field))}</pre></td></tr>`).join("")}</tbody></table></div>` : message("Este evento registra una decisión o un acceso; no contiene cambios de datos para comparar.")}${
        Object.keys(details).length
          ? `<h3>Contexto del evento</h3><dl class="audit-context">${Object.entries(
              details,
            )
              .map(
                ([key, value]) =>
                  `<div><dt>${esc(auditFieldLabel(key))}</dt><dd><pre>${esc(auditFieldValue(value, key))}</pre></dd></div>`,
              )
              .join("")}</dl>`
          : ""
      }${row.correlationId || row.details?.correlationId ? `<details class="audit-technical"><summary>Referencia de seguimiento</summary><code>${esc(row.correlationId || row.details.correlationId)}</code></details>` : ""}<p class="field-hint">Las credenciales y enlaces privados se protegen en el servidor. Esta consulta no modifica el historial.</p></section><div class="dialog-actions">${btn("Cerrar", "close")}</div>`,
      "AUDITORÍA · DETALLE DEL EVENTO",
    );
  }
  async function profile() {
    const data = await api("/api/profile"),
      u = data.user;
    showDialog(
      "Mi cuenta y seguridad",
      `<div class="profile-summary"><span class="profile-avatar">${esc(u.name.charAt(0))}</span><div><h3>${esc(u.name)}</h3><p>${esc(u.email)} · ${esc(u.roleName)}</p></div></div><section class="profile-section"><h3>Datos personales</h3><form id="profile-name-form">${field("name", "Nombre", u.name, 'required minlength="3" maxlength="100"')}<p class="form-error" id="profile-name-error" role="alert"></p><button class="btn secondary">Guardar nombre</button></form></section><section class="profile-section"><h3>Gmail de recuperación</h3><p>${u.recoveryVerified ? `Verificado: ${esc(u.recoveryEmail)}` : "Aún no tienes un correo verificado."}</p>${u.pendingRecoveryEmail ? message(`Pendiente de confirmar en ${u.pendingRecoveryEmail}. El correo anterior sigue vinculado.`) : ""}<form id="profile-mail-form"><div class="form-grid">${field("email", "Tu Gmail", "", 'required type="email" placeholder="usuario@gmail.com"')}${field("currentPassword", "Contraseña actual", "", 'required type="password" autocomplete="current-password"')}</div><p class="form-error" id="profile-mail-error" role="alert"></p><button class="btn secondary">Enviar enlace de verificación</button></form></section><section class="profile-section"><h3>Cambiar contraseña</h3><form id="profile-password-form">${field("currentPassword", "Contraseña actual", "", 'required type="password" autocomplete="current-password"')}<div class="form-grid">${field("password", "Nueva contraseña", "", 'required type="password" minlength="12" maxlength="72" autocomplete="new-password"')}${field("confirmation", "Repetir nueva contraseña", "", 'required type="password" minlength="12" maxlength="72" autocomplete="new-password"')}</div><p class="field-hint">No repitas la actual ni las cinco anteriores. Cambiarla revoca las sesiones abiertas.</p><p class="form-error" id="profile-password-error" role="alert"></p><button class="btn primary">Cambiar contraseña</button></form></section>`,
      "MI CUENTA · PROPIETARIO",
    );
    renderAvatar($(".profile-avatar"), u, esc);
    const photoSection = document.createElement("section");
    photoSection.className = "profile-section avatar-editor";
    photoSection.innerHTML = `<h3>Foto de perfil</h3><form id="profile-avatar-form"><div class="avatar-upload-row"><span class="avatar-preview profile-avatar" aria-hidden="true"></span><div><label class="avatar-upload-label btn secondary" for="profile-photo">Elegir foto<input class="avatar-file" type="file" id="profile-photo" name="photo" accept="image/jpeg,image/png,image/webp"></label><p class="field-hint">JPG, PNG o WebP · hasta 10 MB · recorte central cuadrado.</p></div></div><p class="form-error" id="profile-avatar-error" role="alert"></p><div class="row-actions"><button type="submit" class="btn primary" disabled>Guardar foto</button>${u.avatarUrl ? '<button type="button" class="btn secondary" id="remove-avatar">Quitar foto</button>' : ""}</div></form>`;
    $(".profile-summary").after(photoSection);
    renderAvatar($(".avatar-preview"), u, esc);
    const photoForm = $("#profile-avatar-form"),
      photoError = $("#profile-avatar-error"),
      photoSave = photoForm.querySelector('[type="submit"]');
    let normalizedPhoto = null,
      photoRevision = 0,
      photoBusy = false;
    function setPhotoBusy(busy) {
      photoBusy = busy;
      if (busy) photoRevision++;
      photoForm.querySelectorAll("input,button").forEach((control) => {
        control.disabled = busy;
      });
      photoSave.disabled = busy || !normalizedPhoto;
      photoForm.setAttribute("aria-busy", String(busy));
    }
    $("#profile-photo").addEventListener("change", async (event) => {
      if (photoBusy) return;
      const revision = ++photoRevision;
      photoSave.disabled = true;
      normalizedPhoto = null;
      photoError.textContent = "";
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const image = await normalizePhoto(file);
        if (revision !== photoRevision || !photoForm.isConnected) return;
        normalizedPhoto = image;
        const preview = document.createElement("img");
        preview.src = image;
        preview.alt = "Vista previa de tu foto";
        $(".avatar-preview").replaceChildren(preview);
        photoSave.disabled = false;
      } catch (error) {
        if (revision === photoRevision) photoError.textContent = error.message;
      }
    });
    bindForm(
      photoForm,
      async () => {
        if (photoBusy) return;
        if (!normalizedPhoto)
          throw Error("Selecciona una foto válida antes de guardarla.");
        setPhotoBusy(true);
        try {
          await api("/api/profile/avatar", { dataUrl: normalizedPhoto }, "PUT");
          await ctx.reloadIdentity();
          toast("Foto de perfil actualizada.");
          await profile();
        } finally {
          if (photoForm.isConnected) setPhotoBusy(false);
        }
      },
      "#profile-avatar-error",
    );
    $("#remove-avatar")?.addEventListener("click", async (event) => {
      const remove = event.currentTarget;
      if (photoBusy) return;
      setPhotoBusy(true);
      try {
        await api("/api/profile/avatar", {}, "DELETE");
        await ctx.reloadIdentity();
        toast("Foto eliminada. Se mostrarán tus iniciales.");
        await profile();
      } catch (error) {
        photoError.textContent = error.message;
      } finally {
        if (photoForm.isConnected) setPhotoBusy(false);
      }
    });
    bindForm(
      $("#profile-name-form"),
      async (form) => {
        await api(
          "/api/profile",
          Object.fromEntries(new FormData(form)),
          "PATCH",
        );
        toast("Nombre actualizado.");
        await ctx.reloadIdentity();
        dialog.close();
      },
      "#profile-name-error",
    );
    $("#profile-password-form .field-hint").textContent =
      "Mínimo 12 caracteres, con mayúscula, minúscula, número y símbolo. No repitas la actual ni las cinco anteriores. Cambiarla revoca las sesiones abiertas.";
    bindForm(
      $("#profile-mail-form"),
      async (form) => {
        await api(
          "/api/profile/recovery-email",
          Object.fromEntries(new FormData(form)),
        );
        form.reset();
        toast("Revisa tu Gmail para confirmar la vinculación.");
      },
      "#profile-mail-error",
    );
    bindForm(
      $("#profile-password-form"),
      async (form) => {
        const values = Object.fromEntries(new FormData(form));
        if (values.password !== values.confirmation)
          throw Error("Las contraseñas nuevas no coinciden.");
        await api("/api/profile/password", values);
        toast("Contraseña cambiada. Vuelve a iniciar sesión.");
        location.href = "/login";
      },
      "#profile-password-error",
    );
  }
  function bindForm(form, handler, selector = "#govern-error") {
    form.noValidate = true;
    form.dataset.governValidation = "true";
    const clearField = (control) => {
      if (!control?.name) return;
      control.removeAttribute("aria-invalid");
      const id = `${form.id}-${control.name}-error`;
      form.querySelector(`[id="${id}"]`)?.remove();
      const described = (control.getAttribute("aria-describedby") || "")
        .split(" ")
        .filter((item) => item && item !== id);
      if (described.length)
        control.setAttribute("aria-describedby", described.join(" "));
      else control.removeAttribute("aria-describedby");
    };
    const markField = (name, message) => {
      const entry = form.elements.namedItem(name),
        control = entry?.tagName ? entry : entry?.[0];
      if (!control || control.disabled) return null;
      clearField(control);
      const feedback = document.createElement("span");
      feedback.className = "master-field-error";
      feedback.id = `${form.id}-${name}-error`;
      feedback.textContent = message;
      control.setAttribute("aria-invalid", "true");
      control.setAttribute(
        "aria-describedby",
        [control.getAttribute("aria-describedby"), feedback.id]
          .filter(Boolean)
          .join(" "),
      );
      (control.closest("label") || control.parentElement).append(feedback);
      return control;
    };
    const report = (text, fields = {}) => {
      const error = $(selector);
      if (!error?.isConnected) return;
      error.classList.add("master-error-summary");
      error.tabIndex = -1;
      error.innerHTML = `<strong>${icon("shield")} Revisa la información</strong><span>${esc(text)}</span>`;
      let first;
      for (const [name, message] of Object.entries(fields)) {
        const control = markField(
          name,
          Array.isArray(message) ? message.join(". ") : String(message),
        );
        first ||= control;
      }
      (first || error).focus({ preventScroll: true });
      (first || error).scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
      });
      error.getAnimations?.().forEach((animation) => animation.cancel());
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches)
        error.animate(
          [
            { transform: "translateY(-4px)", opacity: 0.4 },
            { transform: "translateY(0)", opacity: 1 },
          ],
          { duration: 220, easing: "ease-out" },
        );
    };
    form.addEventListener("input", (event) => clearField(event.target));
    form.addEventListener("change", (event) => clearField(event.target));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submit = form.querySelector('button:not([type="button"])');
      if (!submit || submit.disabled) return;
      const error = $(selector);
      form.querySelectorAll("[aria-invalid]").forEach(clearField);
      if (error) {
        error.textContent = "";
        error.classList.remove("master-error-summary");
      }
      const invalid = [...form.elements].filter(
        (control) => control.willValidate && !control.validity.valid,
      );
      if (invalid.length) {
        report(
          "Corrige los campos resaltados antes de guardar.",
          Object.fromEntries(
            invalid.map((control) => [
              control.name,
              control.validity.valueMissing
                ? "Completa este campo."
                : control.validity.typeMismatch
                  ? "Introduce un formato válido."
                  : control.validity.rangeUnderflow ||
                      control.validity.rangeOverflow
                    ? `Usa un valor entre ${control.min} y ${control.max}.`
                    : control.validity.patternMismatch
                      ? control.name === "barcode"
                        ? "Usa 8, 12, 13 o 14 dígitos numéricos."
                        : "Comprueba el formato indicado."
                      : control.validity.tooShort
                        ? `Escribe al menos ${control.minLength} caracteres.`
                        : "Revisa el valor introducido.",
            ]),
          ),
        );
        return;
      }
      const label = submit.innerHTML;
      submit.disabled = true;
      submit.classList.add("is-saving");
      submit.setAttribute("aria-busy", "true");
      form.setAttribute("aria-busy", "true");
      submit.innerHTML =
        '<span class="master-save-spinner" aria-hidden="true"></span> Guardando…';
      try {
        await handler(form);
      } catch (err) {
        if (form.isConnected) report(err.message, err.fieldErrors || {});
      } finally {
        if (submit.isConnected) {
          submit.disabled = false;
          submit.innerHTML = label;
          submit.classList.remove("is-saving");
          submit.removeAttribute("aria-busy");
        }
        if (form.isConnected) form.removeAttribute("aria-busy");
      }
    });
  }
  function confirmAction(title, detail, execute, destructive = false) {
    showDialog(
      title,
      `<form id="govern-form">${message(detail, destructive ? "warning" : "")}<label>Motivo (opcional)<input name="reason" maxlength="250"></label>${errorField}<div class="dialog-actions"><button type="button" class="btn secondary" data-govern="close">Volver</button><button class="btn ${destructive ? "danger-ghost" : "primary"}">Confirmar</button></div></form>`,
      "ADMINISTRACIÓN · CONFIRMACIÓN",
    );
    bindForm($("#govern-form"), async (form) => {
      await execute(form.elements.reason.value);
      dialog.close();
      await render(current);
    });
  }
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-govern]");
    if (!el) return;
    const { govern, id } = el.dataset;
    try {
      if (govern === "close") dialog.close();
      if (govern === "audit-detail") auditDetail(id);
      if (govern === "audit-page") {
        auditFilters.page = Math.max(1, Number(id) || 1);
        await audit();
      }
      if (govern === "audit-reset") {
        auditFilters = {
          q: "",
          action: "",
          outcome: "",
          actorId: "",
          from: "",
          to: "",
          page: 1,
          limit: 50,
        };
        await audit();
      }
      if (govern === "audit-export")
        downloadCsv(
          "DonPepe-auditoria.csv",
          [
            "Fecha",
            "Acción",
            "Recurso",
            "Responsable",
            "Resultado",
            "Antes",
            "Después",
          ],
          (auditData.events || []).map((row) => [
            date(row.createdAt || row.at),
            auditAction(row.action || row.type),
            row.targetLabel ||
              row.details?.targetLabel ||
              "Registro del sistema",
            row.actorName || "Sistema",
            auditOutcome(row.outcome),
            auditValue(row.before || row.details?.before),
            auditValue(row.after || row.details?.after),
          ]),
        );
      if (govern === "export-stock") {
        downloadCsv(
          "DonPepe-inventario.csv",
          [
            "Producto",
            "Marca",
            "Categoría",
            "Presentación",
            "Disponible (cajas)",
            "Reservado (cajas)",
            "Retenido (cajas)",
            "En tránsito (cajas)",
            "En tiendas (cajas)",
            "Entradas pendientes (cajas)",
            "En devolución al centro (cajas)",
            "Diferencias de entrega pendientes (cajas)",
            "Próximo vencimiento",
            "Punto de reposición (cajas)",
          ],
          filteredStockProducts().map((p) => [
            p.name,
            p.brand,
            p.category,
            p.presentation,
            p.availableCases,
            p.reservedCases,
            p.retainedCases ?? p.quarantineCases,
            p.inTransitCases,
            p.branchCases,
            p.incomingCases,
            p.returnCases || 0,
            p.discrepancyCases || 0,
            p.nextExpiry,
            p.reorderPoint,
          ]),
        );
      }
      if (govern === "export-catalog") {
        const items = filteredCatalogItems();
        if (catalogTab === "sku")
          downloadCsv(
            "DonPepe-productos.csv",
            [
              "Producto",
              "Marca",
              "Categoría",
              "Presentación",
              "Código de barras",
              "Conservación",
              "Proveedor",
              "Unidades por caja",
              "Cajas por carga",
              "Punto de reposición",
              "Estado",
            ],
            items.map((p) => [
              p.name,
              p.brand,
              p.category,
              p.presentation,
              p.barcode,
              zones[p.zoneId],
              getState().catalog.suppliers.find((s) => s.id === p.supplierId)
                ?.name || "",
              p.unitsPerCase,
              p.maxCasesPerHu,
              p.reorderPoint,
              p.active === false ? "Desactivado" : "Activo",
            ]),
          );
        else if (catalogTab === "supplier")
          downloadCsv(
            "DonPepe-proveedores.csv",
            [
              "Proveedor",
              "Contacto",
              "Correo",
              "Teléfono",
              "Web",
              "Plazo de suministro (días)",
              "Conservación",
              "Estado",
            ],
            items.map((p) => [
              p.name,
              p.contact,
              p.email,
              p.phone,
              p.site,
              p.leadDays,
              (p.zones || []).map((z) => zones[z]).join(" / "),
              p.active === false ? "Desactivado" : "Activo",
            ]),
          );
        else
          downloadCsv(
            "DonPepe-sucursales.csv",
            ["Sucursal", "Duración del traslado simulado (segundos)", "Estado"],
            items.map((p) => [
              p.name,
              p.travelSeconds,
              p.active === false ? "Desactivado" : "Activo",
            ]),
          );
      }
      if (govern === "reload") await render(current);
      if (govern === "new-user") userForm();
      if (govern === "edit-user") userForm(id);
      if (govern === "catalog-tab") {
        catalogTab = id;
        catalogQuery = "";
        catalogCategory = "";
        catalogPage = 1;
        catalog();
      }
      if (govern === "reset-catalog") {
        catalogQuery = "";
        catalogCategory = "";
        catalogStatus = "active";
        catalogSort = "recent";
        catalogPage = 1;
        catalog();
      }
      if (govern === "catalog-page") {
        catalogPage = Number(id);
        catalogResults();
        $("#catalog-results").scrollIntoView({
          block: "start",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches
            ? "instant"
            : "smooth",
        });
      }
      if (govern === "new-catalog") catalogForm();
      if (govern === "edit-catalog") catalogForm(id);
      if (govern === "user-status")
        confirmAction(
          "Cambiar estado de acceso",
          "Al desactivar se cierran las sesiones y se bloquea el acceso. Puedes activar la cuenta posteriormente; sus operaciones conservan su historial.",
          (reason) =>
            api(`/api/users/${encodeURIComponent(id)}/status`, {
              active: el.dataset.active === "true",
              reason,
            }),
          true,
        );
      if (govern === "delete-user")
        confirmAction(
          "Eliminar esta cuenta",
          "La cuenta se retirará del directorio y no podrá recuperarse. Sus operaciones conservarán la identidad histórica. Debe estar desactivada antes de eliminarse.",
          (reason) =>
            api(`/api/users/${encodeURIComponent(id)}`, { reason }, "DELETE"),
          true,
        );
      if (["deactivate-catalog", "activate-catalog", "delete-catalog"].includes(govern)) {
        const action = govern.split("-")[0], revision = getState().configuration.revision;
        const labels = { deactivate: "Desactivar", activate: "Activar", delete: "Eliminar" };
        const detail = action === "delete"
          ? "El registro desaparecerá de los catálogos y no podrá reactivarse. Sus referencias históricas se conservan. Primero debe estar desactivado y sin dependencias pendientes."
          : action === "deactivate" ? "Dejará de estar disponible para nuevas operaciones. Puede activarse después. Se comprobarán las existencias y dependencias antes de confirmar."
          : "Volverá a estar disponible si conserva sus referencias y compatibilidades.";
        confirmAction(`${labels[action]} registro maestro`, detail, reason => command(`config.${catalogTab}.${action}`, { id, expectedRevision: revision, reason }, action === "delete" ? "Registro eliminado." : action === "activate" ? "Registro activado." : "Registro desactivado."), action !== "activate");
      }
      if (govern === "save-role") {
        const permissions = [
          ...document.querySelectorAll(
            `[data-role-permission="${id}"]:checked`,
          ),
        ].map((input) => input.value);
        el.disabled = true;
        try {
          await api(
            `/api/roles/${encodeURIComponent(id)}`,
            { permissions, expectedRevision: rolesRevision },
            "PUT",
          );
          toast("Permisos guardados. Las sesiones aplicarán el nuevo alcance.");
          await ctx.reloadIdentity();
          await roles();
        } finally {
          if (el.isConnected) el.disabled = false;
        }
      }
      if (
        ["approve-recovery", "reject-recovery", "resend-recovery"].includes(
          govern,
        )
      ) {
        const operation = govern.split("-")[0];
        confirmAction(
          operation === "approve"
            ? "Aprobar recuperación y enviar correo"
            : operation === "reject"
              ? "Rechazar recuperación"
              : "Reintentar entrega del enlace",
          operation === "approve"
            ? "Confirma la identidad del solicitante. El enlace se enviará únicamente a su Gmail previamente verificado."
            : "Se conservará el registro de esta decisión. Ningún enlace se muestra en la interfaz.",
          (reason) =>
            api(`/api/recoveries/${encodeURIComponent(id)}/${operation}`, {
              reason,
            }),
          operation === "reject",
        );
      }
    } catch (error) {
      toast(error.message, "error");
    }
  });
  document.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!target?.matches?.("img[data-master-image]")) return;
      const fallback = document.createElement("span");
      fallback.className = "master-image-empty";
      fallback.setAttribute("aria-label", "Imagen no disponible");
      fallback.innerHTML = icon("package");
      target.replaceWith(fallback);
      const status = $("#master-preview-status");
      if (status && dialog.open)
        status.textContent =
          "No se encontró la imagen. Comprueba la ruta antes de guardar.";
    },
    true,
  );
  return { render, refresh, profile };
}
