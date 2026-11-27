(() => {
  const form = document.querySelector("#auditForm");
  if (!form) return;
  const counts = JSON.parse(form.dataset.counts || "[]");
  const products = JSON.parse(form.dataset.products || "[]");
  const product = form.querySelector("#auditProduct");
  const location = form.querySelector("#auditLocation");
  const batch = form.querySelector("#auditBatch");
  const batchList = form.querySelector("#auditBatches");
  const physical = form.querySelector("#auditPhysical");
  const expiry = form.querySelector("#auditExpiry");
  const expiryHelp = form.querySelector("#auditExpiryHelp");
  const notes = form.querySelector("#auditNotes");
  const preview = form.querySelector("#auditPreview");
  const empty = preview.querySelector(".audit-preview-empty");
  const result = preview.querySelector(".audit-preview-result");
  const submit = form.querySelector("#submitAudit");

  const selectedProduct = () =>
    products.find((item) => Number(item.id) === Number(product.value));
  const systemStock = () =>
    Number(
      counts.find(
        (item) =>
          Number(item.producto_id) === Number(product.value) &&
          Number(item.ubicacion_id) === Number(location.value) &&
          String(item.codigo_lote).toLowerCase() === batch.value.trim().toLowerCase(),
      )?.stock_sistema || 0,
    );

  function render() {
    batchList.replaceChildren(...counts.filter(item =>
      Number(item.producto_id) === Number(product.value) &&
      Number(item.ubicacion_id) === Number(location.value),
    ).map(item => {
      const option = document.createElement("option");
      option.value = item.codigo_lote;
      return option;
    }));
    const complete = Boolean(
      product.value &&
        location.value &&
        batch.value.trim() &&
        physical.value !== "" &&
        Number.isInteger(Number(physical.value)) &&
        Number(physical.value) >= 0,
    );
    empty.hidden = complete;
    result.hidden = !complete;
    submit.disabled = !complete;
    if (!complete) return;
    const system = systemStock();
    const counted = Number(physical.value);
    const difference = counted - system;
    result.querySelector('[data-audit="system"]').textContent = String(system);
    result.querySelector('[data-audit="physical"]').textContent =
      String(counted);
    const differenceNode = result.querySelector('[data-audit="difference"]');
    differenceNode.textContent = `${difference > 0 ? "+" : ""}${difference}`;
    differenceNode.className = difference === 0 ? "ok" : "warning";
    result.querySelector('[data-audit="decision"]').textContent =
      difference === 0
        ? "Cuadre perfecto: se registra sin ajuste."
        : "Diferencia detectada: quedará pendiente para otro responsable.";
    const expiryRequired =
      difference > 0 && Boolean(Number(selectedProduct()?.control_vencimiento));
    expiry.required = expiryRequired;
    expiryHelp.textContent = expiryRequired
      ? "Obligatorio: el stock adicional de este SKU necesita vencimiento."
      : "No se necesita para este resultado.";
    notes.required = difference !== 0;
    notes.minLength = difference !== 0 ? 10 : 0;
  }

  [product, location, batch, physical, expiry, notes].forEach((element) =>
    element.addEventListener("input", render),
  );
  render();
})();
