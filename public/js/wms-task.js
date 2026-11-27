(() => {
  const form = document.querySelector("#wmsTaskForm");
  if (!form) return;
  const data = JSON.parse(form.dataset.wms);
  const $ = (selector) => form.querySelector(selector);
  const sourceInput = $("#taskSource");
  const destinationSelect = $("#taskDestination");
  const quantityInput = $("#taskQuantity");
  const searchInput = $("#positionSearch");
  const zoneSelect = $("#originZone");
  const sourceCards = $("#sourceCards");
  const createButton = $("#createTaskButton");
  const number = (value) => Number(value || 0);
  const text = (value) => String(value ?? "");
  const normalized = (value) =>
    text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase("es");
  const format = (value) => number(value).toLocaleString("es-PE");
  const type = () =>
    $('input[name="tipo"]:checked')?.value || "REABASTECIMIENTO";
  const selectedSource = () =>
    data.positions.find((item) => text(item.id) === sourceInput.value);
  const selectedDestination = () =>
    data.destinations.find((item) => text(item.id) === destinationSelect.value);
  let step = 1;
  let visibleCount = 24;
  let suggestedQuantity = 0;
  let mappedLoc = "";
  const destinationCache = new Map();

  // These labels are presentation only. The posted source is the exact stock-position ID.
  function friendlyLocation(item) {
    const match = text(item.codigo_loc).match(
      /-A([\w]+)-R([\w]+)-N([\w]+)-C([\w]+)(?:-D([\w]+))?$/,
    );
    if (match)
      return `Pasillo ${Number(match[1]) || match[1]} · estante ${Number(match[2]) || match[2]} · nivel ${Number(match[3]) || match[3]} · espacio ${Number(match[4]) || match[4]}${match[5] && number(match[5]) > 1 ? ` · fondo ${Number(match[5])}` : ""}`;
    if (item.pasillo || item.estante)
      return `Pasillo ${item.pasillo || "—"} · estante ${item.estante || "—"}${item.nivel ? ` · nivel ${item.nivel}` : ""}${item.posicion ? ` · espacio ${item.posicion}` : ""}`;
    return item.tipo === "PICKING"
      ? "Área de preparación"
      : "Espacio de reserva";
  }
  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (content !== undefined) element.textContent = content;
    return element;
  }
  function media(item) {
    const holder = node("span", "tp-product-media");
    if (item.imagen_url && /^(?:https?:\/\/|\/[^/])/i.test(item.imagen_url)) {
      const image = document.createElement("img");
      image.src = item.imagen_url;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener(
        "error",
        () => {
          image.remove();
          holder.classList.add("tp-media-missing");
          holder.textContent = "▦";
        },
        { once: true },
      );
      holder.append(image);
    } else {
      holder.classList.add("tp-media-missing");
      holder.textContent = "▦";
    }
    return holder;
  }
  function typeCompatible(item, intention = type()) {
    if (intention === "REABASTECIMIENTO" && number(item.control_vencimiento) &&
      (item.fecha_vencimiento == null || number(item.vencido))) return false;
    if (
      number(item.disponible_planificable) < 1 ||
      item.estado_inventario !== "DISPONIBLE"
    )
      return false;
    return intention === "REUBICACION"
      ? ["RESERVA", "PICKING"].includes(item.tipo)
      : item.tipo === "RESERVA" &&
          number(item.ubicacion_picking_id) > 0 &&
          number(item.deficit_pick) > 0;
  }
  function compatibleDestinations(source) {
    if (!source) return [];
    const cacheKey = `${type()}:${source.id}`;
    if (destinationCache.has(cacheKey)) return destinationCache.get(cacheKey);
    const matches = data.destinations
      .filter((location) => {
        if (
          number(location.id) === number(source.ubicacion_id) ||
          number(location.capacidad_libre) < 1
        )
          return false;
        if (
          number(location.permite_picking) &&
          location.picking_owner_id &&
          number(location.picking_owner_id) !== number(source.producto_id)
        )
          return false;
        if (
          location.tipo === "RESERVA" &&
          location.clase_abc &&
          location.clase_abc !== source.clase_abc
        )
          return false;
        if (
          source.condicion_requerida &&
          location.condicion_almacenamiento !== source.condicion_requerida
        )
          return false;
        return type() === "REABASTECIMIENTO"
          ? Boolean(number(location.permite_picking))
          : ["RESERVA", "PICKING"].includes(location.tipo);
      })
      .sort((a, b) => {
        // Prefer configured primary face; otherwise preserve the warehouse sequence, not a fictional route.
        const primary =
          Number(number(b.id) === number(source.ubicacion_picking_id)) -
          Number(number(a.id) === number(source.ubicacion_picking_id));
        const sameZone =
          Number(b.zona === source.zona) - Number(a.zona === source.zona);
        return (
          primary ||
          (type() === "REUBICACION" ? sameZone : 0) ||
          number(a.secuencia_putaway) - number(b.secuencia_putaway) ||
          text(a.codigo_loc).localeCompare(text(b.codigo_loc), "es")
        );
      });
    destinationCache.set(cacheKey, matches);
    return matches;
  }
  function eligiblePositions() {
    const term = normalized(searchInput.value.trim());
    return data.positions
      .filter(
        (item) =>
          typeCompatible(item) &&
          (!zoneSelect.value || item.zona === zoneSelect.value) &&
          (!mappedLoc || item.codigo_loc === mappedLoc) &&
          normalized(
            [
              item.producto,
              item.marca,
              item.sku,
              item.numero_lote,
              item.codigo_loc,
            ].join(" "),
          ).includes(term),
      )
      .map((item, order) => ({
        item,
        order,
        compatible: compatibleDestinations(item).length > 0,
      }))
      .sort(
        (a, b) =>
          Number(b.compatible) - Number(a.compatible) ||
          (type() === "REABASTECIMIENTO"
            ? number(b.item.deficit_pick) - number(a.item.deficit_pick)
            : 0) ||
          a.order - b.order,
      )
      .map(({ item }) => item);
  }
  function renderZones() {
    const previous = zoneSelect.value;
    const zones = [
      ...new Set(
        data.positions
          .filter((item) => typeCompatible(item))
          .map((item) => item.zona),
      ),
    ]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, "es"));
    zoneSelect.replaceChildren(new Option("Todas las zonas", ""));
    zones.forEach((zone) => zoneSelect.append(new Option(zone, zone)));
    if (zones.includes(previous)) zoneSelect.value = previous;
  }
  function setError(selector, message) {
    const element = $(selector);
    element.textContent = message;
    element.hidden = !message;
  }
  function goTo(next, { focus = true } = {}) {
    step = Math.min(3, Math.max(1, next));
    form.querySelectorAll("[data-task-step]").forEach((panel) => {
      panel.hidden = number(panel.dataset.taskStep) !== step;
    });
    form.querySelectorAll("[data-step-link]").forEach((button) => {
      const target = number(button.dataset.stepLink);
      button.disabled = target === 3 && !selectedSource();
      button.classList.toggle("is-complete", target < step);
      if (target === step) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    $("#taskLiveStatus").textContent =
      `Paso ${step} de 3. ${["Intención del movimiento.", "Selección del producto y su existencia física.", "Destino, cantidad y confirmación."][step - 1]}`;
    if (focus)
      $(`[data-task-step="${step}"] h2`)?.focus({ preventScroll: true });
  }
  function renderSources() {
    const positions = eligiblePositions();
    sourceCards.replaceChildren();
    $("#sourceCount").textContent =
      `${positions.length} ${positions.length === 1 ? "existencia disponible" : "existencias disponibles"}${mappedLoc ? " en la ubicación del mapa" : ""}`;
    $("#clearSourceFilters").hidden =
      !searchInput.value && !zoneSelect.value && !mappedLoc;
    if (!positions.length) {
      const empty = node("div", "tp-source-empty");
      empty.append(
        node("span", "tp-empty-symbol", "⌕"),
        node("h3", "", "No hay existencias para esta selección."),
        node(
          "p",
          "",
          searchInput.value || zoneSelect.value || mappedLoc
            ? "Prueba otro producto o quita los filtros. Tu selección anterior no se pierde."
            : type() === "REABASTECIMIENTO"
              ? "No hay reserva disponible con necesidad de reposición configurada. Puedes revisar el inventario o elegir reorganizar."
              : "No hay inventario disponible en reserva o preparación.",
        ),
      );
      sourceCards.append(empty);
    }
    positions.slice(0, visibleCount).forEach((item) => {
      const card = node("button", "tp-source-card");
      card.type = "button";
      card.dataset.positionId = item.id;
      const selected = text(item.id) === sourceInput.value;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", text(selected));
      const content = node("span", "tp-source-content");
      content.append(
        node("strong", "", item.producto),
        node("span", "tp-source-zone", item.zona),
        node(
          "small",
          "tp-source-position",
          `${friendlyLocation(item)} · lote ${item.numero_lote}`,
        ),
      );
      const bottom = node("span", "tp-source-bottom");
      const hasDestination = compatibleDestinations(item).length > 0;
      bottom.append(
        node("b", "", `${format(item.disponible_planificable)} disponibles`),
        node(
          "span",
          hasDestination ? "tp-compatible-tag" : "tp-unavailable-tag",
          hasDestination
            ? type() === "REABASTECIMIENTO"
              ? `Faltan ${format(item.deficit_pick)} en preparación`
              : "Destino disponible"
            : "Sin destino libre",
        ),
      );
      content.append(bottom);
      card.append(
        media(item),
        content,
        node("span", "tp-source-check", selected ? "✓" : "+"),
      );
      card.addEventListener("click", () => {
        selectSource(item);
        [...sourceCards.querySelectorAll("[data-position-id]")]
          .find((button) => button.dataset.positionId === text(item.id))
          ?.focus({ preventScroll: true });
      });
      sourceCards.append(card);
    });
    $("#showMoreSources").hidden = positions.length <= visibleCount;
    $("#continueWithSource").disabled = !selectedSource();
    renderSelectedSource();
  }
  function renderSelectedSource() {
    const source = selectedSource();
    const insight = $("#sourceInsight");
    insight.hidden = !source;
    insight.replaceChildren();
    if (!source) return;
    insight.append(
      node("span", "tp-selected-label", "Selección conservada"),
      node("strong", "", source.producto),
      node("small", "", `${source.zona} · lote ${source.numero_lote}`),
    );
  }
  function selectSource(
    item,
    { restoreQuantity = false, restoreDestination = "" } = {},
  ) {
    const changed = sourceInput.value !== text(item.id);
    sourceInput.value = text(item.id);
    renderDestinations(
      restoreDestination || (!changed ? destinationSelect.value : ""),
    );
    renderQuantity({ useSuggested: changed && !restoreQuantity });
    renderSources();
    $("#taskLiveStatus").textContent =
      `Seleccionado: ${item.producto}, lote ${item.numero_lote}, en ${item.zona}.`;
    setError("#sourceError", "");
  }
  function renderDestinations(previous = destinationSelect.value) {
    const source = selectedSource();
    const destinations = compatibleDestinations(source);
    destinationSelect.replaceChildren();
    if (!destinations.length)
      destinationSelect.append(
        new Option("No hay un destino compatible libre", ""),
      );
    destinations.forEach((item, index) =>
      destinationSelect.append(
        new Option(
          `${index === 0 ? "Sugerido · " : ""}${item.zona} — ${friendlyLocation(item)}`,
          text(item.id),
        ),
      ),
    );
    if (destinations.some((item) => text(item.id) === text(previous)))
      destinationSelect.value = text(previous);
    destinationSelect.disabled = !destinations.length;
    $("#destinationReason").textContent = !destinations.length
      ? "Ninguna ubicación cumple espacio libre, condición de conservación y tipo de movimiento. No se creará una tarea incompatible."
      : `${destinations.length} destinos compatibles. Ordenados por ubicación configurada y secuencia del almacén.`;
    $("#destinationGuidance").textContent =
      type() === "REABASTECIMIENTO"
        ? "De reserva a preparación, sin mezclar existencias en un espacio ocupado."
        : "Un espacio libre compatible, sin cambiar el estado del inventario.";
  }
  function renderQuantity({ useSuggested = false } = {}) {
    const source = selectedSource();
    const destination = selectedDestination();
    // capacidad_libre counts handling-unit slots, NOT product units. It filters destinations only.
    suggestedQuantity =
      source && destination
        ? Math.min(
            number(source.disponible_planificable),
            type() === "REABASTECIMIENTO"
              ? number(source.deficit_pick)
              : Number.MAX_SAFE_INTEGER,
            10000000,
          )
        : 0;
    quantityInput.max = text(suggestedQuantity);
    quantityInput.disabled = suggestedQuantity < 1;
    $("#useSuggested").disabled = suggestedQuantity < 1;
    if (useSuggested)
      quantityInput.value = text(Math.max(suggestedQuantity, 1));
    $("#quantityRule").textContent = suggestedQuantity
      ? `${format(suggestedQuantity)} unidades como máximo${type() === "REABASTECIMIENTO" ? ", según reserva disponible y necesidad de preparación" : ", según existencias libres del origen"}.`
      : "No se puede planificar este movimiento sin un destino compatible libre.";
    renderPreview();
  }
  function renderPreview() {
    const source = selectedSource();
    const destination = selectedDestination();
    const quantity = number(quantityInput.value);
    const valid = Boolean(
      source &&
        destination &&
        Number.isInteger(quantity) &&
        quantity >= 1 &&
        quantity <= suggestedQuantity,
    );
    const operator = $("#taskOperator");
    const assigned = Boolean(operator?.value);
    createButton.disabled = !valid;
    createButton.textContent = assigned ? "Crear y asignar ✓" : "Crear tarea ✓";
    $("#taskNextActionTitle").textContent = assigned
      ? `Ejecuta: ${operator.selectedOptions[0].textContent}`
      : "Pendiente de asignación";
    $("#taskNextActionNote").textContent = assigned
      ? "Aparecerá en su bandeja RF al guardar. El inventario cambia cuando el operador confirma físicamente."
      : "Queda en el tablero para asignarla. El inventario no se mueve al crear la tarea.";
    quantityInput.setAttribute(
      "aria-invalid",
      text(Boolean(source && destination && !valid)),
    );
    const preview = $("#taskPreview");
    preview.querySelector(".preview-state").hidden = Boolean(destination);
    preview.querySelector(".preview-route").hidden = !source || !destination;
    preview.querySelector(".preview-product").hidden = !source;
    const summary = $("#confirmProduct");
    const trace = $("#taskTraceability");
    summary.replaceChildren();
    trace.replaceChildren();
    if (!source) return;
    const content = node("div", "");
    content.append(
      node("strong", "", source.producto),
      node(
        "small",
        "",
        `${format(source.disponible_planificable)} unidades disponibles · lote ${source.numero_lote}`,
      ),
    );
    summary.append(media(source), content);
    preview.querySelector('[data-preview="product"]').textContent =
      source.producto;
    preview.querySelector('[data-preview="quantity"]').textContent =
      `${format(quantity)} unidades · ${$("#taskPriority").selectedOptions[0].textContent.split(" · ")[0]}`;
    if (destination) {
      for (const [key, value] of Object.entries({
        origin: friendlyLocation(source),
        originZone: source.zona,
        destination: friendlyLocation(destination),
        destinationZone: destination.zona,
      }))
        preview.querySelector(`[data-preview="${key}"]`).textContent = value;
    }
    for (const [key, value] of [
      ["Producto", source.sku],
      ["Lote de origen", source.numero_lote],
      ["Ubicación exacta de origen", source.codigo_loc],
      ["Ubicación exacta de destino", destination?.codigo_loc || "Pendiente"],
      ["Existencia física", `#${source.id}`],
    ])
      trace.append(node("dt", "", key), node("dd", "", value));
    setError(
      "#confirmError",
      source && destination && !valid
        ? `Ingresa una cantidad entera entre 1 y ${format(suggestedQuantity)}.`
        : "",
    );
  }
  function renderPurpose() {
    form
      .querySelectorAll(".tp-purpose")
      .forEach((card) =>
        card.classList.toggle(
          "is-selected",
          card.querySelector("input").checked,
        ),
      );
    for (const intention of ["REABASTECIMIENTO", "REUBICACION"]) {
      const count = data.positions.filter((item) =>
        typeCompatible(item, intention),
      ).length;
      $(`[data-intent-count="${intention}"]`).textContent =
        `${count} ${count === 1 ? "existencia elegible" : "existencias elegibles"}`;
    }
    const source = selectedSource();
    if (source && !typeCompatible(source)) {
      sourceInput.value = "";
      destinationSelect.value = "";
    }
    $("#sourceHelp").textContent =
      type() === "REABASTECIMIENTO"
        ? "Reserva disponible para productos cuya preparación está por debajo del objetivo. Selecciona una existencia concreta."
        : "Inventario disponible en reserva o preparación. Elige el producto y el lote físico que quieres reorganizar.";
    renderZones();
    renderSources();
    renderDestinations();
    renderQuantity();
  }
  form
    .querySelectorAll('input[name="tipo"]')
    .forEach((input) => input.addEventListener("change", renderPurpose));
  form.querySelectorAll("[data-task-next]").forEach((button) =>
    button.addEventListener("click", () => {
      if (step === 2 && !selectedSource()) {
        setError("#sourceError", "Selecciona una existencia para continuar.");
        return;
      }
      goTo(step + 1);
    }),
  );
  form
    .querySelectorAll("[data-task-back]")
    .forEach((button) =>
      button.addEventListener("click", () => goTo(step - 1)),
    );
  form
    .querySelectorAll("[data-step-link]")
    .forEach((button) =>
      button.addEventListener("click", () =>
        goTo(number(button.dataset.stepLink)),
      ),
    );
  searchInput.addEventListener("input", () => {
    visibleCount = 24;
    renderSources();
  });
  zoneSelect.addEventListener("change", () => {
    visibleCount = 24;
    renderSources();
  });
  $("#clearSourceFilters").addEventListener("click", () => {
    searchInput.value = "";
    zoneSelect.value = "";
    mappedLoc = "";
    visibleCount = 24;
    renderSources();
  });
  $("#showMoreSources").addEventListener("click", () => {
    visibleCount += 24;
    renderSources();
  });
  destinationSelect.addEventListener("change", () => renderQuantity());
  quantityInput.addEventListener("input", renderPreview);
  $("#taskPriority").addEventListener("change", renderPreview);
  $("#taskOperator")?.addEventListener("change", renderPreview);
  $("#useSuggested").addEventListener("click", () =>
    renderQuantity({ useSuggested: true }),
  );
  form.addEventListener("submit", (event) => {
    if (step !== 3) {
      event.preventDefault();
      if (step === 1 || selectedSource()) goTo(step + 1);
      return;
    }
    renderPreview();
    if (createButton.disabled) {
      event.preventDefault();
      goTo(selectedSource() ? 3 : 2);
      return;
    }
    // ui.js owns the submitting state. Setting aria-busy here would cancel the
    // first legitimate submit in its delegated duplicate-submission guard.
  });
  window.addEventListener("pageshow", () => {
    form.removeAttribute("aria-busy");
    renderPreview();
  });
  const parameters = new URLSearchParams(location.search);
  mappedLoc = parameters.get("loc") || parameters.get("origen") || "";
  const restoredSource = data.positions.find(
    (item) => text(item.id) === text(data.initial?.lote_origen_id),
  );
  if (
    mappedLoc &&
    !restoredSource &&
    !data.positions.some(
      (item) => item.codigo_loc === mappedLoc && typeCompatible(item),
    )
  )
    $('input[name="tipo"][value="REUBICACION"]').checked = true;
  renderPurpose();
  const initialPosition =
    restoredSource ||
    (mappedLoc
      ? data.positions.find(
          (item) => item.codigo_loc === mappedLoc && typeCompatible(item),
        )
      : null);
  if (initialPosition && typeCompatible(initialPosition)) {
    selectSource(initialPosition, {
      restoreQuantity: Boolean(data.initial?.cantidad),
      restoreDestination: data.initial?.ubicacion_destino_id,
    });
    if (data.initial?.cantidad) {
      quantityInput.value = text(data.initial.cantidad);
      renderPreview();
    }
  }
  const serverErrors = document.querySelector(
    "#taskServerErrors [data-validation-summary]",
  );
  goTo(
    serverErrors
      ? selectedSource()
        ? 3
        : 2
      : initialPosition || mappedLoc
        ? 2
        : 1,
    { focus: false },
  );
  if (serverErrors) {
    const panel = $(`[data-task-step="${step}"]`);
    panel.insertBefore(serverErrors, panel.children[1]);
  }
})();
