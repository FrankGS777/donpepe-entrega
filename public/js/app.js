const sidebar = document.querySelector("#sidebar");
const menuToggle = document.querySelector("#menuToggle");
let sidebarBackdrop = null;
const closeSidebar = () => {
  sidebar?.classList.remove("open");
  sidebarBackdrop?.classList.remove("is-open");
  setTimeout(() => {
    sidebarBackdrop?.remove();
    sidebarBackdrop = null;
  }, 180);
};
menuToggle?.addEventListener("click", () => {
  if (sidebar?.classList.contains("open")) return closeSidebar();
  sidebar?.classList.add("open");
  sidebarBackdrop = document.createElement("button");
  sidebarBackdrop.type = "button";
  sidebarBackdrop.className = "sidebar-backdrop";
  sidebarBackdrop.setAttribute("aria-label", "Cerrar menú");
  sidebarBackdrop.addEventListener("click", closeSidebar);
  sidebar?.after(sidebarBackdrop);
  requestAnimationFrame(() => sidebarBackdrop?.classList.add("is-open"));
});
sidebar?.querySelectorAll("a").forEach((link) =>
  link.addEventListener("click", () => {
    if (window.matchMedia("(max-width: 991px)").matches) closeSidebar();
  }),
);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && sidebar?.classList.contains("open"))
    closeSidebar();
});
document.querySelectorAll("[data-confirm]").forEach((button) =>
  button.addEventListener("click", async (event) => {
    event.preventDefault();
    if (button.form && !button.form.reportValidity()) return;
    if (await window.WmsUi.confirm(button.dataset.confirm)) {
      if (button.form) button.form.requestSubmit(button);
      else if (button.href) window.location.assign(button.href);
    }
  }),
);
document
  .querySelector("[data-print]")
  ?.addEventListener("click", () => window.print());

const renderRoleChoices = () =>
  document.querySelectorAll(".role-choice").forEach((choice) => {
    choice.classList.toggle("selected", choice.querySelector("input").checked);
  });
document
  .querySelectorAll(".role-choice input")
  .forEach((input) => input.addEventListener("change", renderRoleChoices));
renderRoleChoices();

document.querySelectorAll("[data-table-filter]").forEach((input) => {
  const table = document.querySelector(input.dataset.tableFilter);
  if (!table) return;
  const rows = [...table.querySelectorAll("tbody tr")];
  const empty = table.closest("section")?.querySelector("[data-filter-empty]");
  input.addEventListener("input", () => {
    const term = input.value.trim().toLocaleLowerCase("es-PE");
    let visible = 0;
    rows.forEach((row) => {
      const matches = row.textContent.toLocaleLowerCase("es-PE").includes(term);
      row.classList.toggle("d-none", !matches);
      if (matches) visible += 1;
    });
    empty?.classList.toggle("d-none", visible !== 0);
  });
});

document.querySelectorAll("[data-copy-activation]").forEach((button) => {
  const card = button.closest("[data-activation-path]");
  const input = card?.querySelector("[data-activation-link]");
  if (!card || !input) return;
  input.value = /^https?:\/\//i.test(card.dataset.activationPath)
    ? card.dataset.activationPath
    : `${window.location.origin}${card.dataset.activationPath}`;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(input.value);
      button.textContent = "Enlace copiado";
      setTimeout(() => (button.textContent = "Copiar enlace"), 1800);
    } catch {
      input.select();
      document.execCommand("copy");
    }
  });
});

const peruClockFormatter = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const updatePeruClocks = () =>
  document.querySelectorAll("[data-peru-clock]").forEach((clock) => {
    clock.textContent = `${peruClockFormatter.format(new Date())} · PET`;
  });
updatePeruClocks();
setInterval(updatePeruClocks, 30000);

(() => {
  const ensureModal = (id, html) => {
    let modal = document.getElementById(id);
    if (modal) return modal;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = html.trim();
    modal = wrapper.firstElementChild;
    document.body.append(modal);
    return modal;
  };

  async function renderQr(canvas, value, options = {}) {
    if (!canvas || !value) return;
    if (window.QRCode?.toCanvas) {
      await window.QRCode.toCanvas(canvas, value, {
        width: options.width || 110,
        margin: 4,
        errorCorrectionLevel: "M",
      });
      return;
    }
    throw new Error(
      "El generador QR no está disponible. Recarga la página antes de imprimir.",
    );
  }

  window.WmsUi = { ...(window.WmsUi || {}), renderQr };

  function createResourceSelectModal() {
    return ensureModal(
      "resourceSelectModal",
      `<div class="modal fade resource-select-modal" id="resourceSelectModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content selector-modal-shell">
            <div class="modal-header">
              <div class="selector-modal-heading"><span class="selector-modal-icon" data-select-icon>⌁</span><div><h5 class="modal-title">Elegir registro</h5></div></div>
              <button type="button" class="btn-close btn-close-white" data-ui-dismiss="modal" aria-label="Cerrar"></button>
            </div>
            <div class="modal-body">
              <div class="selector-searchbar">
                <svg class="icon" aria-hidden="true"><use href="/icons.svg#i-search"></use></svg>
                <input data-select-search placeholder="Buscar por nombre, código o atributo…" autocomplete="off" aria-label="Buscar opciones">
                <span data-select-count>0 resultados</span>
              </div>
              <button type="button" class="selector-clear" data-select-clear hidden>Quitar selección actual</button>
              <div class="resource-select-list" data-select-list></div>
            </div>
          </div>
        </div>
      </div>`,
    );
  }

  function describeOption(option) {
    const text = option.textContent.trim();
    const data = option.dataset || {};
    const parts = text
      .split(" · ")
      .map((part) => part.trim())
      .filter(Boolean);
    const resource = option.closest("select")?.dataset.resource || "";
    let title = parts[0] || "Registro";
    let kicker = data.reference || "RECURSO WMS";
    let subtitle = parts.slice(1).join(" · ");
    if (["product", "stock"].includes(resource)) {
      title = data.name || data.product || parts[1] || parts[0] || "Producto";
      kicker = [data.sku || parts[0], resource === "stock" ? data.location : ""]
        .filter(Boolean)
        .join(" · ");
      subtitle =
        [data.brand, data.category, data.lot && `Lote ${data.lot}`]
          .filter(Boolean)
          .join(" · ") || parts.slice(2).join(" · ");
    } else if (resource === "location") {
      title = data.location || parts[0] || "LOC";
      kicker = data.type || parts[2] || "UBICACIÓN WMS";
      subtitle = [data.zone || parts[1], data.condition]
        .filter(Boolean)
        .join(" · ");
    } else if (resource === "zone") {
      title = data.name || parts[1] || parts[0] || "Zona";
      kicker = data.code || parts[0] || "ZONA WMS";
      subtitle = [data.condition, data.purpose || data.meta]
        .filter(Boolean)
        .join(" · ");
    } else if (resource === "provider") {
      title = parts[0] || "Proveedor";
      kicker = data.ruc ? `RUC ${data.ruc}` : "PROVEEDOR HOMOLOGADO";
      subtitle = [data.telefono, data.email]
        .filter((value) => value && !/no registrado/i.test(value))
        .join(" · ");
    } else if (resource === "brand") {
      kicker = "MARCA";
      subtitle = data.description || parts.slice(1).join(" · ");
    } else if (resource === "category") {
      kicker = "CATEGORÍA";
      subtitle = data.description || data.meta || parts.slice(1).join(" · ");
    }
    const chips = [
      data.quantity && `${data.quantity} UND`,
      data.available && `${data.available} libres`,
      data.capacity,
      data.occupancy && `${data.occupancy} ocupado`,
      data.status,
      data.barcode &&
        !/no registrado/i.test(data.barcode) &&
        `EAN ${data.barcode}`,
    ]
      .filter(Boolean)
      .slice(0, 3);
    return {
      title,
      kicker,
      subtitle,
      chips,
      search: `${text} ${Object.values(data).join(" ")}`.toLocaleLowerCase(
        "es",
      ),
    };
  }

  function resourceMedia(option, resource = "") {
    const data = option.dataset || {};
    if (data.image)
      return {
        image: data.image,
        href: data.referenceUrl || "",
        label: ["provider", "brand"].includes(resource)
          ? "Sitio oficial"
          : "Ficha de la presentación",
        logo: ["provider", "brand"].includes(resource),
      };
    // No se inventa una fotografía para un recurso sin evidencia visual.
    return { image: "", href: "", label: "" };
  }

  function enhanceResourceSelects() {
    const modal = createResourceSelectModal();
    const title = modal.querySelector(".modal-title");
    const icon = modal.querySelector("[data-select-icon]");
    const search = modal.querySelector("[data-select-search]");
    const list = modal.querySelector("[data-select-list]");
    const count = modal.querySelector("[data-select-count]");
    const clear = modal.querySelector("[data-select-clear]");
    const instance = window.WmsUi.modal(modal);
    let activeSelect = null;

    const resourceGlyph = (resource = "") => {
      const id =
        {
          provider: "truck",
          product: "package",
          location: "pin",
          zone: "grid",
          stock: "layers",
          brand: "tags",
          category: "tags",
        }[resource] || "search";
      return `<svg class="icon" aria-hidden="true"><use href="/icons.svg#i-${id}"></use></svg>`;
    };

    function syncButton(select) {
      const button = select.nextElementSibling;
      if (!button?.classList.contains("select-modal-trigger")) return;
      const selected = select.selectedOptions[0];
      const hasValue = Boolean(selected?.value);
      button.querySelector("strong").textContent = hasValue
        ? describeOption(selected).title
        : "Buscar y seleccionar";
      button.querySelector("small").textContent = hasValue
        ? describeOption(selected).kicker
        : "Sin selección";
      button.disabled = select.disabled;
    }

    function choose(value) {
      if (!activeSelect) return;
      activeSelect.value = value;
      activeSelect.dispatchEvent(new Event("change", { bubbles: true }));
      syncButton(activeSelect);
      instance.hide();
    }

    function drawList() {
      if (!activeSelect) return;
      const term = search.value.trim().toLocaleLowerCase("es");
      list.replaceChildren();
      const matches = [...activeSelect.options]
        .filter((option) => option.value)
        .filter((option) => describeOption(option).search.includes(term));
      count.textContent = `${matches.length} ${matches.length === 1 ? "resultado" : "resultados"}`;
      matches.forEach((option) => {
        const info = describeOption(option);
        const media = resourceMedia(option, activeSelect.dataset.resource);
        const card = document.createElement("article");
        card.className = "resource-choice";
        card.classList.toggle("selected", option.value === activeSelect.value);
        card.innerHTML = `<button type="button" class="resource-choice-main" data-select-choice>
            <span class="resource-choice-image"><span class="resource-image-placeholder"><b></b><small>Cargando imagen</small></span><img loading="lazy" referrerpolicy="no-referrer" data-resource-media><i>${resourceGlyph(activeSelect.dataset.resource)}</i></span>
            <span class="resource-choice-copy"><small class="resource-choice-kicker"></small><strong></strong><span class="resource-choice-subtitle"></span><span class="resource-choice-chips"></span></span>
            <span class="resource-choice-check" aria-hidden="true">✓</span>
          </button>`;
        const image = card.querySelector("img");
        const imageBox = card.querySelector(".resource-choice-image");
        const placeholder = card.querySelector(".resource-image-placeholder");
        placeholder.querySelector("b").textContent = info.title
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0] || "")
          .join("")
          .toLocaleUpperCase("es");
        const unavailable = () => {
          image.hidden = true;
          imageBox.classList.add("is-unavailable");
          placeholder.querySelector("small").textContent =
            "Imagen no disponible";
        };
        image.alt = `Referencia de ${info.title}`;
        image.classList.toggle("is-logo", Boolean(media.logo));
        image.addEventListener("load", () => {
          imageBox.classList.add("is-ready");
          placeholder.hidden = true;
          image.classList.add("is-ready");
        });
        image.addEventListener("error", unavailable);
        if (
          media.image &&
          !media.image.endsWith("/images/resource-fallback.svg")
        )
          image.src = media.image;
        else unavailable();
        card.querySelector(".resource-choice-kicker").textContent = info.kicker;
        card.querySelector("strong").textContent = info.title;
        card.querySelector(".resource-choice-subtitle").textContent =
          info.subtitle || "Información operativa disponible";
        const chipBox = card.querySelector(".resource-choice-chips");
        info.chips.forEach((value) => {
          const chip = document.createElement("b");
          chip.textContent = value;
          chipBox.append(chip);
        });
        card
          .querySelector("[data-select-choice]")
          .addEventListener("click", () => choose(option.value));
        if (media.href) {
          const link = document.createElement("a");
          link.className = "resource-choice-link";
          link.href = media.href;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = `${media.label} ↗`;
          link.setAttribute("aria-label", `${media.label}: ${info.title}`);
          card.append(link);
        }
        list.append(card);
      });
      if (!list.children.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "No hay coincidencias para la búsqueda.";
        list.append(empty);
      }
    }

    document
      .querySelectorAll("select.form-select[data-complex-select]")
      .forEach((select) => {
        if (
          select.dataset.nativeSelect === "true" ||
          select.dataset.enhancedSelect
        )
          return;
        select.dataset.enhancedSelect = "true";
        select.classList.add("select-modal-source");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "select-modal-trigger";
        button.innerHTML = `<span class="selector-trigger-icon">${resourceGlyph(select.dataset.resource)}</span><span class="selector-trigger-copy"><strong></strong><small></small></span><span class="selector-trigger-arrow">⌄</span>`;
        select.after(button);
        syncButton(select);
        button.addEventListener("click", () => {
          if (select.disabled) return;
          activeSelect = select;
          icon.innerHTML = resourceGlyph(select.dataset.resource);
          title.textContent =
            select
              .closest("div")
              ?.querySelector(".form-label")
              ?.textContent?.trim() ||
            select.getAttribute("aria-label") ||
            "Elegir registro";
          clear.hidden = select.required || !select.value;
          search.value = "";
          drawList();
          instance.show();
          setTimeout(() => search.focus(), 160);
        });
        select.addEventListener("change", () => {
          syncButton(select);
          if (select.id === "primaryLoc") {
            const reference = document.querySelector("[data-loc-reference]");
            if (reference)
              reference.textContent =
                select.selectedOptions[0]?.textContent.split(" · ")[0].trim() ||
                "MAPA GENERAL";
          }
        });
      });

    search.addEventListener("input", drawList);
    clear.addEventListener("click", () => choose(""));
  }

  function createScannerModal() {
    return ensureModal(
      "quickScanModal",
      `<div class="modal fade quick-scan-modal" id="quickScanModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content scanner-modal-shell">
            <div class="modal-header"><div class="modal-action-heading"><span class="modal-action-icon"><svg class="icon"><use href="/icons.svg#i-camera"></use></svg></span><div><h5 class="modal-title">Escanear QR o código</h5><p>Centra la etiqueta dentro del marco.</p></div></div><button type="button" class="btn-close btn-close-white" data-ui-dismiss="modal" aria-label="Cerrar"></button></div>
            <div class="modal-body">
              <div class="rf-scanner compact scanner-viewport"><video muted playsinline data-quick-video></video><div class="scan-frame"></div><span class="scanner-live" data-quick-live>LISTO</span></div>
              <div class="scanner-status" data-quick-status>En celular usa HTTPS o localhost para permitir cámara.</div>
              <div class="scanner-actions"><button class="btn btn-brand flex-grow-1" type="button" data-quick-start><svg class="icon"><use href="/icons.svg#i-camera"></use></svg> Activar cámara</button><button class="btn btn-outline-light" type="button" data-quick-stop disabled>Detener</button></div>
              <details class="scanner-options"><summary>Cámara e ingreso manual <span>⌄</span></summary><div class="scanner-options-body"><div class="camera-picker"><label>Cámara disponible</label><select class="form-select" data-native-select="true" data-quick-camera><option value="">Automática · posterior preferida</option></select><small>La Cámara de Continuidad del iPhone aparecerá aquí si macOS la ofrece al navegador.</small></div><label class="form-label mt-3" for="quickManualCode">Ingresar código manualmente</label><div class="input-group"><input id="quickManualCode" class="form-control" data-quick-manual placeholder="EAN, QR, SKU o lote"><button class="btn btn-outline-warning" type="button" data-quick-use>Aplicar</button></div></div></details>
            </div>
          </div>
        </div>
      </div>`,
    );
  }

  function enhanceScanInputs() {
    const modal = createScannerModal();
    const instance = window.WmsUi.modal(modal);
    const video = modal.querySelector("[data-quick-video]");
    const camera = modal.querySelector("[data-quick-camera]");
    const startButton = modal.querySelector("[data-quick-start]");
    const stopButton = modal.querySelector("[data-quick-stop]");
    const live = modal.querySelector("[data-quick-live]");
    const manual = modal.querySelector("[data-quick-manual]");
    const status = modal.querySelector("[data-quick-status]");
    const preview = document.createElement("article");
    preview.className = "scan-confirm-preview";
    preview.hidden = true;
    preview.setAttribute("aria-live", "polite");
    preview.innerHTML =
      '<span data-read-type></span><strong data-read-title></strong><code data-read-code></code><p data-read-detail></p><div class="scan-confirm-actions"><button class="btn btn-outline-light" type="button" data-read-again>Leer otro</button><button class="btn btn-brand" type="button" data-read-confirm>Confirmar y rellenar</button></div>';
    modal.querySelector(".scanner-status").after(preview);
    let activeInput,
      session,
      pending,
      resolveToken = 0;
    const preferenceKey = "donpepe.wms.camera";

    function stop() {
      session?.stop();
      session = null;
      startButton.disabled = false;
      stopButton.disabled = true;
      live.textContent = "LISTO";
      live.dataset.state = "ready";
    }
    function resetPreview() {
      pending = null;
      preview.hidden = true;
      modal.querySelector(".scanner-viewport").hidden = false;
      startButton.disabled = false;
    }
    async function review(raw) {
      if (!activeInput) return;
      const scan = window.WmsScanner.parseScan(raw);
      if (!scan.term) {
        status.textContent = "El código está vacío o es demasiado largo.";
        return;
      }
      stop();
      const token = ++resolveToken;
      status.textContent = "Buscando el registro…";
      try {
        let item = await window.WmsScanner.lookup(scan.raw);
        if (token !== resolveToken || modal.hidden) return;
        const row = activeInput.closest(".receive-row");
        if (
          (row && scan.sku && scan.sku !== row.dataset.sku) ||
          (row && scan.ean && scan.ean !== row.dataset.ean)
        )
          throw new Error(
            "Esta etiqueta pertenece a otro producto. Escanea en la línea correspondiente de la orden.",
          );
        // El lote del fabricante puede ser nuevo al recibir una compra.
        if (
          item.tipo === "NO_ENCONTRADO" &&
          row &&
          activeInput.classList.contains("lot")
        ) {
          item = {
            tipo: "LOTE_NUEVO",
            codigo: scan.lot || scan.term,
            numero_lote: scan.lot || scan.term,
            sku: row.dataset.sku,
            titulo: row.querySelector("strong")?.textContent || row.dataset.sku,
            detalle:
              "Lote de proveedor aún no recibido. Verifica la etiqueta antes de registrar el ingreso.",
          };
        }
        const value =
          row && activeInput.classList.contains("lot")
            ? scan.raw
            : window.WmsScanner.fieldValue(
                scan,
                item,
                activeInput.name || activeInput.id,
              );
        const compatible = item.tipo !== "NO_ENCONTRADO" && !!value;
        pending = compatible ? { scan, item, value } : null;
        preview.querySelector("[data-read-type]").textContent =
          item.tipo.replaceAll("_", " ");
        preview.querySelector("[data-read-title]").textContent =
          item.titulo || "Código sin coincidencias";
        preview.querySelector("[data-read-code]").textContent =
          item.codigo || scan.term;
        preview.querySelector("[data-read-detail]").textContent = compatible
          ? item.detalle || ""
          : item.tipo === "NO_ENCONTRADO"
            ? "No existe un registro con este código. Revisa la etiqueta e intenta de nuevo."
            : "El recurso encontrado no corresponde a este campo. Escanea la ubicación indicada.";
        preview.querySelector("[data-read-confirm]").disabled = !compatible;
        preview.hidden = false;
        modal.querySelector(".scanner-viewport").hidden = true;
        status.textContent = compatible
          ? "Registro encontrado. Confirma para aplicar los datos."
          : "Lectura válida, pero no se puede aplicar.";
        live.textContent = "LEÍDO";
        preview.querySelector("[data-read-confirm]").focus();
      } catch (error) {
        pending = null;
        preview.hidden = true;
        status.textContent = error.message;
      }
    }
    function start() {
      stop();
      resetPreview();
      ++resolveToken;
      status.textContent = "Abriendo cámara…";
      startButton.disabled = true;
      stopButton.disabled = false;
      session = window.WmsScanner.cameraSession({
        video,
        deviceId: camera.value,
        onReady: () => {
          live.textContent = "EN VIVO";
          live.dataset.state = "live";
          status.textContent =
            "Centra el QR o el código de barras y mantén la cámara estable.";
          window.WmsScanner.cameras(
            camera,
            camera.value || localStorage.getItem(preferenceKey) || "",
          ).catch(() => {});
        },
        onRead: review,
        onError: (error) => {
          stop();
          status.textContent = error.message;
        },
      });
    }
    preview
      .querySelector("[data-read-confirm]")
      .addEventListener("click", () => {
        if (!pending || !activeInput) return;
        activeInput.value = pending.value;
        activeInput.dispatchEvent(new Event("input", { bubbles: true }));
        activeInput.dispatchEvent(new Event("change", { bubbles: true }));
        document.dispatchEvent(
          new CustomEvent("wms:scan", {
            detail: {
              input: activeInput,
              value: pending.scan.raw,
              result: pending.item,
            },
          }),
        );
        instance.hide();
      });
    preview.querySelector("[data-read-again]").addEventListener("click", start);
    const candidates = [...document.querySelectorAll("input.form-control")]
      .filter((input) => !input.closest(".modal,.rf-scanner"))
      .filter(
        (input) =>
          !["password", "date", "number", "email"].includes(input.type),
      )
      .filter(
        (input) =>
          input.dataset.scanInput !== undefined ||
          /sku|lote|loc|codigo|barras/i.test(
            `${input.name} ${input.id} ${input.placeholder} ${input.className}`,
          ),
      );
    candidates.forEach((input) => {
      if (input.dataset.scanEnhanced || input.readOnly || input.disabled)
        return;
      input.dataset.scanEnhanced = "true";
      const wrap = document.createElement("div");
      wrap.className = "scan-input-group";
      input.before(wrap);
      wrap.append(input);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scan-input-btn";
      button.setAttribute("aria-label", "Escanear QR o código");
      button.innerHTML =
        '<svg class="icon"><use href="/icons.svg#i-camera"></use></svg>';
      wrap.append(button);
      button.addEventListener("click", () => {
        activeInput = input;
        manual.value = input.value || "";
        resetPreview();
        status.textContent = "Activa la cámara o ingresa el código.";
        instance.show();
        window.WmsScanner.cameras(
          camera,
          localStorage.getItem(preferenceKey) || "",
        ).catch(() => {});
      });
    });
    startButton.addEventListener("click", start);
    stopButton.addEventListener("click", stop);
    camera.addEventListener("change", () => {
      localStorage.setItem(preferenceKey, camera.value);
      if (session) start();
    });
    modal.querySelector("[data-quick-use]").textContent = "Buscar";
    modal
      .querySelector("[data-quick-use]")
      .addEventListener("click", () => review(manual.value));
    manual.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        review(manual.value);
      }
    });
    modal.addEventListener("ui:modal-hidden", () => {
      ++resolveToken;
      stop();
      pending = null;
    });
    window.addEventListener("pagehide", stop);
    navigator.mediaDevices?.addEventListener?.("devicechange", () =>
      window.WmsScanner.cameras(camera, camera.value).catch(() => {}),
    );
  }

  function enhanceLiveFilters() {
    document
      .querySelectorAll(".list-toolbar input[name='q'], form input[name='q']")
      .forEach((input) => {
        if (input.dataset.liveFilter) return;
        input.dataset.liveFilter = "true";
        const scope = input.closest(".panel") || document;
        input.addEventListener("input", () => {
          const term = input.value.trim().toLocaleLowerCase("es");
          scope
            .querySelectorAll(
              "tbody tr, .zone-card, .loc-card, .rf-task-card, .purchase-line",
            )
            .forEach((row) => {
              row.hidden =
                term && !row.textContent.toLocaleLowerCase("es").includes(term);
            });
        });
      });
  }

  function enhanceLotQr() {
    const modal = ensureModal(
      "lotQrModal",
      `<div class="modal fade lot-qr-modal" id="lotQrModal" tabindex="-1" aria-hidden="true">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content lot-label-modal-shell">
            <div class="modal-header"><div class="modal-action-heading"><span class="modal-action-icon"><svg class="icon"><use href="/icons.svg#i-qr"></use></svg></span><div><h5 class="modal-title" data-lot-title>Etiqueta de lote</h5></div></div><button type="button" class="btn-close btn-close-white" data-ui-dismiss="modal" aria-label="Cerrar"></button></div>
            <div class="modal-body">
              <article class="print-label single-label lot-label-preview"><div class="lot-label-brand"><span class="donpepe-logo" role="img" aria-label="DonPepe"><img class="donpepe-logo__art" src="/images/donpepe-logo-final-gold.png" width="2117" height="743" alt="" aria-hidden="true" data-brand-logo></span><span>WMS · TRAZABILIDAD</span></div><div class="lot-label-content"><canvas data-lot-canvas></canvas><div><small>LOTE</small><strong data-lot-code></strong><span data-lot-product></span><small data-lot-meta></small></div></div><footer>Escanea para identificar el lote durante la operación</footer></article>
            </div>
            <div class="modal-footer"><button class="btn btn-outline-light" data-ui-dismiss="modal">Cerrar</button><button class="btn btn-brand" type="button" data-print><svg class="icon"><use href="/icons.svg#i-print"></use></svg> Imprimir etiqueta</button></div>
          </div>
        </div>
      </div>`,
    );
    const instance = window.WmsUi.modal(modal);
    modal
      .querySelector("[data-print]")
      .addEventListener("click", () => window.print());
    document.querySelectorAll("[data-lot-qr]").forEach((button) => {
      button.addEventListener("click", async () => {
        const data = button.dataset;
        modal.querySelector("[data-lot-title]").textContent = data.lot;
        modal.querySelector("[data-lot-code]").textContent = data.lot;
        modal.querySelector("[data-lot-product]").textContent =
          `${data.sku} · ${data.product}`;
        modal.querySelector("[data-lot-meta]").textContent =
          `${data.loc} · ${data.qty} UND · ${data.expiry || "Sin vencimiento"}`;
        const payload = `SKU=${data.sku}|LOT=${data.lot}${data.expiry ? `|EXP=${data.expiry}` : ""}`;
        await renderQr(modal.querySelector("[data-lot-canvas]"), payload, {
          width: 140,
        });
        instance.show();
      });
    });
  }

  document.addEventListener(
    "error",
    (event) => {
      const image = event.target;
      if (
        image instanceof HTMLImageElement &&
        !image.hasAttribute("data-resource-media") &&
        !image.hasAttribute("data-brand-logo") &&
        !image.src.endsWith("/images/resource-fallback.svg")
      )
        image.src = "/images/resource-fallback.svg";
    },
    true,
  );

  enhanceResourceSelects();
  enhanceScanInputs();
  enhanceLiveFilters();
  enhanceLotQr();
})();
