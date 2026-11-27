/* RF: lecturas físicas confirmadas, nunca escritura de identificadores. */
(() => {
  if (!document.body.classList.contains("rf-mode")) return;
  const engine = window.WmsScanner;
  if (!engine) return;
  const preference = "donpepe.wms.camera";
  const clean = (value) =>
    String(value || "")
      .trim()
      .toUpperCase();
  const confirmed = new WeakMap();
  const getPreferred = () => {
    try {
      return localStorage.getItem(preference) || "";
    } catch {
      return "";
    }
  };
  const setPreferred = (value) => {
    try {
      localStorage.setItem(preference, value);
    } catch {}
  };
  const icon = '<svg class="icon"><use href="/icons.svg#i-camera"></use></svg>';

  function cameraMessage(error) {
    if (error?.name === "NotAllowedError")
      return "La cámara no tiene permiso. Permítela en el navegador y pulsa Activar cámara otra vez.";
    if (error?.name === "NotFoundError")
      return "No se detectó una cámara. Conecta una cámara, actualiza la lista y vuelve a intentarlo.";
    if (error?.name === "NotReadableError")
      return "Otra aplicación puede estar usando la cámara. Ciérrala y vuelve a intentarlo.";
    return String(error?.message || "No se pudo abrir la cámara.")
      .replace(/o ingresa el código manualmente\./gi, "y vuelve a intentarlo.")
      .replace(/o ingrésalo manualmente\./gi, "y vuelve a escanear.");
  }
  function lockIdentifier(input) {
    input.readOnly = true;
    input.inputMode = "none";
    input.autocomplete = "off";
    input.dataset.rfScanOnly = "";
    input.setAttribute(
      "aria-label",
      input.getAttribute("aria-label") ||
        input.labels?.[0]?.textContent ||
        input.closest('[class*="col-"]')?.querySelector("label")?.textContent ||
        "Lectura confirmada",
    );
    ["beforeinput", "paste", "drop"].forEach((name) =>
      input.addEventListener(name, (event) => event.preventDefault()),
    );
    input.addEventListener("keydown", (event) => {
      if (event.key.length === 1 || ["Backspace", "Delete"].includes(event.key))
        event.preventDefault();
    });
  }
  function explain(error, target) {
    const output = target
      ?.closest("form")
      ?.querySelector("[data-rf-form-error]");
    if (output) {
      output.hidden = false;
      output.textContent = error;
    }
  }
  function applyReading(input, value, scan, item) {
    if (input.id === "countProduct" && clean(input.value) !== clean(value)) {
      const batch = document.querySelector("#countBatch");
      if (batch) {
        batch.value = "";
        confirmed.delete(batch);
        batch.classList.remove("rf-reading-confirmed");
      }
    }
    input.value = value;
    confirmed.set(input, value);
    input.classList.add("rf-reading-confirmed");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    document.dispatchEvent(
      new CustomEvent("wms:scan", {
        detail: { input, value: scan.raw, result: item },
      }),
    );
    // Recepción puede normalizar el contenido de la etiqueta al lote impreso.
    confirmed.set(input, input.value);
    input.closest(".rf-scan-step")?.classList.add("is-done");
    const button = document.querySelector(
      '[data-rf-scan-for="' + input.id + '"]',
    );
    if (button) {
      const label = button.querySelector("span");
      if (label) label.textContent = "Volver a escanear";
      else button.textContent = "Volver a escanear";
    }
  }
  function readingValue(input, scan, item) {
    const identity =
      input.dataset.scanIdentity ||
      (/codigo_loc|origen|destino/.test(input.name)
        ? "location"
        : input.classList.contains("lot")
          ? "receipt-lot"
          : "");
    if (identity === "location") {
      if (item.tipo !== "LOC")
        throw new Error(
          "Esta etiqueta no es una ubicación. Lee la etiqueta del lugar indicado.",
        );
      if (
        input.dataset.expectedCode &&
        clean(item.codigo) !== clean(input.dataset.expectedCode)
      )
        throw new Error(
          "Estás en otra posición. Dirígete a la ubicación indicada y escanea su etiqueta.",
        );
      if (input._rfLocationSelect) {
        const option = [...input._rfLocationSelect.options].find(
          (option) =>
            clean(
              option.dataset.location || option.textContent.split(" · ")[0],
            ) === clean(item.codigo),
        );
        if (!option?.value)
          throw new Error(
            "La ubicación leída no es compatible con esta mercancía. Escanea una posición de recepción de la condición indicada.",
          );
      }
      return item.codigo;
    }
    const expectedSku =
      input.dataset.expectedSku || input.closest(".receive-row")?.dataset.sku;
    if (expectedSku && item.sku && clean(item.sku) !== clean(expectedSku))
      throw new Error(
        "La etiqueta pertenece a otro producto. Escanea la carga asignada.",
      );
    if (identity === "logistic") {
      const trace = input.dataset.requireLot === "true";
      if (item.tipo === "HU") {
        if (
          input.dataset.expectedHu &&
          clean(item.codigo) !== clean(input.dataset.expectedHu)
        )
          throw new Error(
            "Esta unidad logística no es la asignada. Escanea el palé o caja indicado.",
          );
        if (clean(item.numero_lote) !== clean(input.dataset.expectedLot))
          throw new Error("El lote de esta carga no coincide con el asignado.");
        return item.codigo;
      }
      if (["LOTE", "ETIQUETA_RECEPCION"].includes(item.tipo)) {
        const lot = scan.lot || item.numero_lote;
        if (
          clean(lot) !== clean(input.dataset.expectedLot) &&
          clean(item.codigo) !== clean(input.dataset.expectedLotId)
        )
          throw new Error("Este no es el lote asignado. Revisa su etiqueta.");
        return lot || item.codigo;
      }
      if (trace)
        throw new Error(
          "El código del producto no identifica su lote. Escanea la etiqueta del lote o de la unidad logística asignada.",
        );
      if (item.tipo === "SKU") return item.sku || item.codigo;
      throw new Error(
        "Escanea la etiqueta del producto o de la carga asignada.",
      );
    }
    if (identity === "product") {
      if (!["SKU", "HU", "LOTE", "ETIQUETA_RECEPCION"].includes(item.tipo))
        throw new Error("Escanea la etiqueta del producto que estás contando.");
      return item.sku || item.codigo;
    }
    if (identity === "lot" || identity === "receipt-lot") {
      const row = input.closest(".receive-row");
      if (
        row &&
        ((scan.sku && clean(scan.sku) !== clean(row.dataset.sku)) ||
          (scan.ean && clean(scan.ean) !== clean(row.dataset.ean)))
      )
        throw new Error("La etiqueta pertenece a otro producto de la entrega.");
      const lot =
        scan.lot ||
        item.numero_lote ||
        (["LOTE", "LOTE_NUEVO"].includes(item.tipo) ? item.codigo : "");
      if (!lot)
        throw new Error(
          "Esta etiqueta solo identifica el producto. Escanea un lote o un QR que incluya el lote.",
        );
      const countSku = document.querySelector("#countProduct");
      if (
        identity === "lot" &&
        countSku?.value &&
        item.sku &&
        clean(item.sku) !== clean(countSku.value)
      )
        throw new Error(
          "El lote pertenece a otro producto. Verifica lo que estás contando.",
        );
      return identity === "receipt-lot" ? scan.raw : lot;
    }
    if (item.tipo === "NO_ENCONTRADO")
      throw new Error(
        "No se encontró el registro. Revisa la etiqueta y vuelve a escanear.",
      );
    return engine.fieldValue(scan, item, input.name || input.id);
  }

  let cameraDialog,
    cameraUi,
    session,
    activeInput,
    readToken = 0,
    openingReview = false;
  function stopCamera() {
    session?.stop();
    session = null;
    if (!cameraDialog) return;
    cameraDialog.querySelector("[data-rf-camera-start]").disabled = false;
    cameraDialog.querySelector("[data-rf-camera-stop]").disabled = true;
  }
  function dialogStatus(text, state = "") {
    const output = cameraDialog.querySelector("[data-rf-camera-status]");
    output.textContent = text;
    output.dataset.state = state;
  }
  async function processRead(raw) {
    const target = activeInput;
    const token = ++readToken;
    stopCamera();
    dialogStatus("Buscando la etiqueta…", "loading");
    try {
      const scan = engine.parseScan(raw);
      if (!scan.term)
        throw new Error("La etiqueta está vacía o no se puede interpretar.");
      let item = await engine.lookup(scan.raw);
      if (token !== readToken || cameraDialog.hidden) return;
      const row = target?.closest(".receive-row");
      if (
        item.tipo === "NO_ENCONTRADO" &&
        (row || target?.hasAttribute("data-rf-allow-new-lot"))
      ) {
        const candidate =
          scan.lot || (!Object.keys(scan.pairs || {}).length ? scan.term : "");
        if (candidate)
          item = {
            tipo: "LOTE_NUEVO",
            codigo: candidate,
            numero_lote: candidate,
            sku:
              row?.dataset.sku ||
              document.querySelector("#countProduct")?.value ||
              "",
            titulo: row?.dataset.product || "Lote físico no registrado",
            detalle:
              "Lote no encontrado. Confirma que coincide con la etiqueta física. El ingreso o conteo aún deberá superar la validación del servidor.",
          };
      }
      const value = readingValue(target, scan, item);
      openingReview = true;
      cameraUi.hide();
      const accepted = await window.WmsScanner.confirmReading(item);
      openingReview = false;
      if (!accepted || token !== readToken) return;
      if (target._rfLocationSelect) {
        const select = target._rfLocationSelect;
        const option = [...select.options].find(
          (option) =>
            clean(
              option.dataset.location || option.textContent.split(" · ")[0],
            ) === clean(item.codigo),
        );
        select.value = option.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      }
      applyReading(target, value, scan, item);
      updateGuides(target.closest("form"));
      const formError = target
        .closest("form")
        ?.querySelector("[data-rf-form-error]");
      if (formError) formError.hidden = true;
    } catch (error) {
      if (token !== readToken) return;
      dialogStatus(cameraMessage(error), "error");
      cameraDialog.querySelector("[data-rf-camera-start]").textContent =
        "Volver a escanear";
      cameraDialog.querySelector("[data-rf-camera-start]").focus();
    }
  }
  function startCamera() {
    stopCamera();
    ++readToken;
    dialogStatus("Solicitando acceso a la cámara…");
    const start = cameraDialog.querySelector("[data-rf-camera-start]");
    start.disabled = true;
    cameraDialog.querySelector("[data-rf-camera-stop]").disabled = false;
    const select = cameraDialog.querySelector("[data-rf-camera-select]");
    session = engine.cameraSession({
      video: cameraDialog.querySelector("video"),
      deviceId: select.value,
      onReady: () => {
        dialogStatus(
          "Cámara activa. Centra la etiqueta y mantenla estable.",
          "live",
        );
        engine.cameras(select, select.value || getPreferred()).catch(() => {});
      },
      onRead: processRead,
      onError: (error) => {
        stopCamera();
        dialogStatus(cameraMessage(error), "error");
      },
    });
  }
  function ensureCameraDialog() {
    if (cameraDialog) return;
    cameraDialog = document.createElement("div");
    cameraDialog.className = "modal rf-camera-modal";
    cameraDialog.setAttribute("aria-label", "Escanear y confirmar etiqueta");
    cameraDialog.innerHTML =
      '<div class="modal-dialog"><div class="modal-content"><header class="modal-header"><div><small>Lectura física</small><h2 data-rf-camera-title>Escanear etiqueta</h2></div><button type="button" class="btn-close" data-ui-dismiss="modal" aria-label="Cerrar cámara"></button></header><div class="modal-body"><div class="scanner-viewport"><video playsinline muted aria-label="Vista de cámara"></video><div class="scan-frame"></div><span class="rf-camera-tag">QR · CÓDIGO DE BARRAS</span></div><p class="rf-camera-status" data-rf-camera-status role="status" aria-live="polite">La cámara requiere permiso y una conexión HTTPS o localhost.</p><div class="rf-scanner-controls"><button class="btn btn-brand" type="button" data-rf-camera-start>Activar cámara</button><button class="btn btn-outline-light" type="button" data-rf-camera-stop disabled>Detener</button></div><details class="rf-camera-settings"><summary>Elegir cámara y permisos <span>+</span></summary><label for="rfCameraDialog">Cámara disponible</label><div class="input-group"><select id="rfCameraDialog" class="form-select" data-rf-camera-select><option value="">Automática · posterior</option></select><button type="button" class="btn btn-outline-light" data-rf-camera-refresh aria-label="Actualizar cámaras">↻</button></div><small>En el móvil, abre el sistema mediante HTTPS. Si denegaste el acceso, habilita la cámara en los permisos del navegador.</small></details></div><footer class="modal-footer"><span>Revisarás la lectura antes de aplicarla.</span><button type="button" class="btn btn-outline-light" data-ui-dismiss="modal">Cancelar</button></footer></div></div>';
    document.body.append(cameraDialog);
    cameraUi = window.WmsUi.modal(cameraDialog);
    cameraDialog
      .querySelector("[data-rf-camera-start]")
      .addEventListener("click", startCamera);
    cameraDialog
      .querySelector("[data-rf-camera-stop]")
      .addEventListener("click", () => {
        stopCamera();
        dialogStatus("Cámara detenida. Puedes activarla otra vez.");
      });
    const select = cameraDialog.querySelector("[data-rf-camera-select]");
    cameraDialog
      .querySelector("[data-rf-camera-refresh]")
      .addEventListener("click", () =>
        engine
          .cameras(select, select.value || getPreferred())
          .catch((error) => dialogStatus(cameraMessage(error), "error")),
      );
    select.addEventListener("change", () => {
      setPreferred(select.value);
      if (session) startCamera();
    });
    cameraDialog.addEventListener("ui:modal-hidden", () => {
      stopCamera();
      if (!openingReview) ++readToken;
    });
  }
  function openCamera(input) {
    if (
      document.querySelector('[data-rf-scan-for="' + input.id + '"]')?.disabled
    )
      return;
    ensureCameraDialog();
    activeInput = input;
    ++readToken;
    cameraDialog.querySelector("[data-rf-camera-title]").textContent =
      input.labels?.[0]?.textContent ||
      input.getAttribute("aria-label") ||
      "Escanear etiqueta";
    dialogStatus(
      "Pulsa Activar cámara y acerca la etiqueta. No se modifica nada sin confirmar.",
    );
    cameraUi.show();
    engine
      .cameras(
        cameraDialog.querySelector("[data-rf-camera-select]"),
        getPreferred(),
      )
      .catch(() => {});
  }

  function installScanButton(input) {
    lockIdentifier(input);
    if (!input.id) input.id = "rf-scan-" + Math.random().toString(36).slice(2);
    let button = document.querySelector(
      '[data-rf-scan-for="' + input.id + '"]',
    );
    const old = input
      .closest(".scan-input-group")
      ?.querySelector(".scan-input-btn");
    if (old) old.remove();
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.className = "rf-camera-action";
      button.dataset.rfScanFor = input.id;
      button.innerHTML = icon + "<span>Escanear etiqueta</span>";
      input.closest(".scan-input-group")
        ? input.closest(".scan-input-group").after(button)
        : input.after(button);
    }
    button.addEventListener("click", () => openCamera(input));
  }

  function updateGuides(form) {
    if (!form?.hasAttribute("data-rf-guided")) return;
    const fields = [...form.querySelectorAll("[data-rf-scan-only]")];
    const count = fields.filter(
      (field) => confirmed.get(field) === field.value && !!field.value,
    ).length;
    fields.forEach((field, index) => {
      const done = confirmed.get(field) === field.value && !!field.value;
      const available = fields
        .slice(0, index)
        .every(
          (previous) =>
            confirmed.get(previous) === previous.value && !!previous.value,
        );
      const step = field.closest("[data-rf-step]");
      step.classList.toggle("is-done", done);
      step.classList.toggle("is-active", !done && available);
      step.classList.toggle("is-locked", !available);
      form
        .querySelector('[data-rf-step-indicator="' + index + '"]')
        .classList.toggle("is-done", done);
      form
        .querySelector('[data-rf-step-indicator="' + index + '"]')
        .classList.toggle("is-active", !done && available);
      const button = form.querySelector(
        '[data-rf-scan-for="' + field.id + '"]',
      );
      button.disabled = !available;
    });
    form.querySelector("[data-rf-progress-label]").textContent =
      count + " de 3 lecturas confirmadas";
    form.querySelector("[data-rf-progress-number]").textContent =
      Math.round((count / 3) * 100) + "%";
    form
      .querySelector("[data-rf-progress]")
      .setAttribute("aria-valuenow", count);
    form.querySelector("[data-rf-progress] i").style.width =
      (count / 3) * 100 + "%";
    form.querySelector("[data-rf-complete]").disabled = count !== 3;
    form
      .querySelector(".rf-finish-card")
      .classList.toggle("is-ready", count === 3);
    form.querySelector("[data-rf-finish-message]").textContent =
      count === 3
        ? "Las etiquetas coinciden. Finaliza solo si ya entregaste físicamente la carga."
        : "Completa las lecturas en orden. El inventario todavía no ha cambiado.";
  }

  // Recepción comparte plantilla con administración; sus identificadores siguen siendo solo escaneables en RF.
  document.querySelectorAll(".receive-row .lot").forEach((input) => {
    input.dataset.scanIdentity = "receipt-lot";
    input.placeholder = "Pendiente de escanear";
    input
      .closest(".receive-row")
      .querySelectorAll(".select-modal-trigger")
      .forEach((button) => button.remove());
  });
  document.querySelectorAll(".receive-row .location").forEach((select) => {
    select.dataset.rfLocation = "";
    select.hidden = true;
    select.disabled = true;
    const input = document.createElement("input");
    input.className = "form-control";
    input.placeholder = "Escanea una ubicación compatible";
    input.dataset.scanIdentity = "location";
    input.dataset.rfScanOnly = "";
    input.dataset.rfOptional = "";
    input._rfLocationSelect = select;
    input.setAttribute("aria-label", "Ubicación de recepción compatible");
    select.after(input);
  });
  document
    .querySelectorAll("[data-rf-scan-only], .receive-row .lot")
    .forEach(installScanButton);
  if (document.querySelector("#receiveForm")) {
    const heading = document.querySelector(".page-head");
    const title = heading?.querySelector("h1");
    if (title) {
      const reference = document.createElement("span");
      reference.className = "rf-task-reference";
      reference.textContent = title.textContent.replace(/^RECIBIR\s*/i, "");
      title.before(reference);
      title.textContent = "Verifica la entrega";
    }
    const copy = heading?.querySelector("p");
    if (copy)
      copy.textContent =
        "Cuenta las unidades y confirma con la cámara el lote y la posición de recepción.";
    const taskLink = heading?.querySelector("a");
    if (taskLink) taskLink.textContent = "Ver mercancía por ubicar";
    const submit = document.querySelector("#receiveForm > .panel > button");
    if (submit) submit.textContent = "Confirmar recepción";
  }
  document.querySelectorAll("[data-rf-guided]").forEach(updateGuides);
  document
    .querySelectorAll("[data-rf-guided], [data-rf-count], #receiveForm")
    .forEach((form) => {
      if (!form.querySelector("[data-rf-form-error]")) {
        const feedback = document.createElement("div");
        feedback.className = "rf-inline-error";
        feedback.dataset.rfFormError = "";
        feedback.setAttribute("role", "alert");
        feedback.hidden = true;
        form.prepend(feedback);
      }
      form.addEventListener(
        "submit",
        (event) => {
          let fields = [...form.querySelectorAll("[data-rf-scan-only]")];
          if (form.id === "receiveForm")
            fields = fields.filter((field) => {
              const row = field.closest(".receive-row");
              return (
                Number(row?.querySelector(".received-qty")?.value) > 0 &&
                (field._rfLocationSelect || row?.dataset.controlLot === "1")
              );
            });
          const missing = fields.find(
            (field) => !field.value || confirmed.get(field) !== field.value,
          );
          if (missing) {
            event.preventDefault();
            event.stopImmediatePropagation();
            explain(
              "Confirma las etiquetas con el escáner antes de enviar.",
              missing,
            );
            document
              .querySelector('[data-rf-scan-for="' + missing.id + '"]')
              ?.focus();
            return;
          }
          if (!form.checkValidity()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            form.reportValidity();
          }
        },
        { capture: true },
      );
    });

  const scanner = document.querySelector("[data-scanner]");
  if (scanner) {
    const video = scanner.querySelector("video"),
      start = scanner.querySelector("[data-scan-start]"),
      stop = scanner.querySelector("[data-scan-stop]"),
      camera = scanner.querySelector("[data-scan-camera]"),
      live = scanner.querySelector("[data-scan-live]"),
      status = scanner.querySelector("[data-scan-status]");
    let standaloneSession,
      token = 0;
    function stopStandalone() {
      standaloneSession?.stop();
      standaloneSession = null;
      start.disabled = false;
      stop.disabled = true;
    }
    async function find(raw) {
      stopStandalone();
      const id = ++token;
      status.textContent = "Consultando el registro…";
      try {
        const item = await engine.lookup(raw);
        if (id !== token) return;
        const accepted = await window.WmsScanner.confirmReading(item);
        if (!accepted || id !== token) {
          status.textContent = "Lectura descartada. Puedes volver a escanear.";
          return;
        }
        const result = scanner.querySelector("[data-scan-result]");
        result.querySelector("span").textContent = item.tipo.replaceAll(
          "_",
          " ",
        );
        result.querySelector("strong").textContent = item.titulo || item.codigo;
        result.querySelector("small").textContent = [item.codigo, item.detalle]
          .filter(Boolean)
          .join(" · ");
        live.textContent = "Lectura confirmada";
        status.textContent =
          "Consulta completada. No se han modificado existencias.";
      } catch (error) {
        live.textContent = "No se pudo leer";
        status.textContent = cameraMessage(error);
      }
    }
    function startStandalone() {
      stopStandalone();
      ++token;
      start.disabled = true;
      stop.disabled = false;
      status.textContent = "Abriendo la cámara…";
      standaloneSession = engine.cameraSession({
        video,
        deviceId: camera.value,
        onReady: () => {
          live.textContent = "Cámara activa";
          status.textContent =
            "Centra el QR o código de barras y mantén la cámara estable.";
          engine
            .cameras(camera, camera.value || getPreferred())
            .catch(() => {});
        },
        onRead: find,
        onError: (error) => {
          stopStandalone();
          live.textContent = "Cámara no disponible";
          status.textContent = cameraMessage(error);
        },
      });
    }
    start.addEventListener("click", startStandalone);
    stop.addEventListener("click", () => {
      ++token;
      stopStandalone();
      live.textContent = "Cámara detenida";
    });
    scanner.querySelector("[data-scan-refresh]").addEventListener("click", () =>
      engine.cameras(camera, camera.value || getPreferred()).catch((error) => {
        status.textContent = cameraMessage(error);
      }),
    );
    camera.addEventListener("change", () => {
      setPreferred(camera.value);
      if (standaloneSession) startStandalone();
    });
    engine.cameras(camera, getPreferred()).catch(() => {});
    navigator.mediaDevices?.addEventListener?.("devicechange", () =>
      engine.cameras(camera, camera.value).catch(() => {}),
    );
    window.addEventListener("pagehide", () => {
      ++token;
      stopStandalone();
    });
  }
  window.addEventListener("pagehide", () => {
    ++readToken;
    stopCamera();
  });
})();
