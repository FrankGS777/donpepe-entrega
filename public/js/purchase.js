(() => {
  const form = document.querySelector("#purchaseForm");
  if (!form) return;

  const product = form.querySelector("#purchaseProduct");
  const provider = form.querySelector("#purchaseProvider");
  const quantity = form.querySelector("#purchaseQty");
  const price = form.querySelector("#purchasePrice");
  const addButton = form.querySelector("#addPurchase");
  const rows = form.querySelector("#purchaseRows");
  const hiddenItems = form.querySelector("#purchaseItems");
  const submit = form.querySelector("#submitPurchase");
  const total = form.querySelector("#purchaseTotal");
  const lineCount = form.querySelector("#purchaseLineCount");
  const unitCount = form.querySelector("#purchaseUnitCount");
  const providerSummary = form.querySelector("#purchaseProviderSummary");
  const feedback = form.querySelector("#purchaseFeedback");
  const productOptions = new Map(
    [...product.options]
      .filter((option) => option.value)
      .map((option) => [Number(option.value), option.cloneNode(true)]),
  );
  let items = [];
  let previousProvider = provider.value;

  try {
    const initial = JSON.parse(hiddenItems.value || "[]");
    if (Array.isArray(initial)) {
      items = initial
        .map((item) => ({
          producto_id: Number(item.producto_id),
          cantidad: Number(item.cantidad),
          precio: Number(item.precio),
        }))
        .filter((item) => {
          const option = productOptions.get(item.producto_id);
          return (
            option &&
            option.dataset.providerId === provider.value &&
            Number.isInteger(item.cantidad) &&
            item.cantidad > 0 &&
            Number.isFinite(item.precio) &&
            item.precio >= 0
          );
        });
    }
  } catch {
    items = [];
  }

  const money = (value) =>
    new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency: "PEN",
    }).format(value);
  const setFeedback = (message, error = false) => {
    feedback.textContent = message;
    feedback.classList.toggle("invalid", error);
  };
  const optionFor = (id) => productOptions.get(Number(id));

  function syncProductControls() {
    const selected = product.selectedOptions[0];
    const hasProduct = Boolean(selected?.value);
    price.value = hasProduct ? selected.dataset.price || 0 : 0;
    price.disabled = !hasProduct;
    quantity.disabled = !hasProduct;
    addButton.disabled = !hasProduct;
  }

  function rebuildProductCatalog() {
    const providerId = provider.value;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = providerId
      ? "Selecciona un SKU de este proveedor"
      : "Primero selecciona un proveedor";
    product.replaceChildren(placeholder);
    if (providerId) {
      [...productOptions.values()]
        .filter((option) => option.dataset.providerId === providerId)
        .sort((a, b) =>
          a.dataset.name.localeCompare(b.dataset.name, "es", {
            sensitivity: "base",
          }),
        )
        .forEach((option) => product.append(option.cloneNode(true)));
    }
    product.disabled = !providerId;
    product.value = "";
    product.dispatchEvent(new Event("change", { bubbles: true }));
    syncProductControls();
    if (providerId && product.options.length === 1)
      setFeedback(
        "El proveedor seleccionado no tiene SKU activos homologados.",
        true,
      );
  }

  function appendText(parent, tag, value, className = "") {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function draw() {
    hiddenItems.value = JSON.stringify(items);
    rows.replaceChildren();
    if (!items.length) {
      appendText(rows, "div", "Aún no agregaste productos.", "empty");
    } else {
      items.forEach((item, index) => {
        const option = optionFor(item.producto_id);
        const row = document.createElement("article");
        row.className = "purchase-line";
        const identity = document.createElement("div");
        appendText(identity, "span", option.dataset.sku, "sku-chip");
        appendText(identity, "strong", option.dataset.name);
        appendText(
          identity,
          "small",
          `${item.cantidad} UND × ${money(item.precio)}`,
        );
        const lineTotal = appendText(
          row,
          "strong",
          money(item.cantidad * item.precio),
          "purchase-line-total",
        );
        const remove = appendText(
          row,
          "button",
          "Retirar",
          "btn btn-sm btn-outline-danger",
        );
        remove.type = "button";
        remove.dataset.remove = String(index);
        row.prepend(identity);
        lineTotal.setAttribute("aria-label", "Subtotal de línea");
        rows.append(row);
      });
    }
    const units = items.reduce((sum, item) => sum + item.cantidad, 0);
    const amount = items.reduce(
      (sum, item) => sum + item.cantidad * item.precio,
      0,
    );
    lineCount.textContent = String(items.length);
    unitCount.textContent = String(units);
    total.textContent = money(amount);
    providerSummary.textContent = provider.value
      ? provider.selectedOptions[0].textContent.split(" · RUC")[0]
      : "Pendiente";
    submit.disabled = !items.length || !provider.value;
  }

  product.addEventListener("change", syncProductControls);
  provider.addEventListener("change", () => {
    if (
      previousProvider &&
      previousProvider !== provider.value &&
      items.length
    ) {
      items = [];
      setFeedback(
        "Proveedor cambiado: se retiraron las líneas anteriores para evitar mezclar catálogos.",
      );
    } else if (provider.value) {
      setFeedback(
        "Proveedor definido. Ahora elige uno de sus SKU homologados.",
      );
    } else {
      items = [];
      setFeedback(
        "Selecciona primero un proveedor para habilitar sus productos.",
      );
    }
    previousProvider = provider.value;
    rebuildProductCatalog();
    draw();
  });
  addButton.addEventListener("click", () => {
    const id = Number(product.value);
    const selected = optionFor(id);
    const qty = Number(quantity.value);
    const unitPrice = Number(price.value);
    if (!provider.value || !selected) {
      setFeedback("Selecciona primero proveedor y producto.", true);
      return;
    }
    if (selected.dataset.providerId !== provider.value) {
      setFeedback("Ese SKU no pertenece al proveedor de la orden.", true);
      return;
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 100000) {
      setFeedback("La cantidad debe ser un entero entre 1 y 100 000.", true);
      quantity.focus();
      return;
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999.99) {
      setFeedback("Revisa el costo unitario del SKU.", true);
      price.focus();
      return;
    }
    const existing = items.find((item) => item.producto_id === id);
    if (existing && existing.precio !== unitPrice) {
      setFeedback(
        "Ese SKU ya está en el detalle con otro costo. Retíralo antes de cambiarlo.",
        true,
      );
      return;
    }
    if (existing) existing.cantidad += qty;
    else items.push({ producto_id: id, cantidad: qty, precio: unitPrice });
    quantity.value = "1";
    setFeedback(
      existing
        ? "Cantidad acumulada en la línea existente."
        : "SKU agregado al detalle.",
    );
    draw();
  });
  rows.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    items.splice(Number(button.dataset.remove), 1);
    setFeedback("Línea retirada; revisa nuevamente el total.");
    draw();
  });
  form.addEventListener("submit", (event) => {
    if (!items.length) {
      event.preventDefault();
      setFeedback("Agrega al menos un SKU antes de crear la orden.", true);
      return;
    }
    hiddenItems.value = JSON.stringify(items);
  });

  rebuildProductCatalog();
  draw();
})();
