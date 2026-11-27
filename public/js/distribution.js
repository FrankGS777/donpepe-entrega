(() => {
  const form = document.querySelector("#branchOrderForm");
  if (!form) return;
  const product = form.querySelector("#branchProduct");
  const qty = form.querySelector("#branchQty");
  const hidden = form.querySelector("#branchOrderItems");
  const lines = form.querySelector("#branchLines");
  const submit = form.querySelector("#branchSubmit");
  const destination = form.querySelector("#branchDestination");
  const review = form.querySelector("#branchReview");
  let items = [];
  try {
    items = JSON.parse(hidden.value || "[]");
    if (!Array.isArray(items)) items = [];
    items = items.filter(item => [...product.options].some(option=>Number(option.value)===Number(item.producto_id)) && Number.isInteger(Number(item.cantidad)) && Number(item.cantidad)>0);
  } catch {
    items = [];
  }
  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );
  function render() {
    hidden.value = JSON.stringify(items);
    lines.innerHTML = items.length
      ? items
          .map((item, index) => {
            const option = [...product.options].find(
              (entry) => Number(entry.value) === Number(item.producto_id),
            );
            if (!option) return "";
            return `<article><img src="${escape(option.dataset.image || "/images/resource-fallback.svg")}" alt=""><span><small>${escape(option.dataset.sku)}</small><strong>${escape(option.dataset.name)}</strong><em>${escape(item.cantidad)} unidades base</em></span><button type="button" data-remove="${index}" aria-label="Quitar ${escape(option.dataset.name)}">Quitar</button></article>`;
          })
          .join("")
      : "<div class='empty'>Agrega al menos un SKU.</div>";
    submit.disabled =
      !items.length || !destination.value;
    if (review) { review.innerHTML = lines.innerHTML; review.querySelectorAll('[data-remove]').forEach(button=>button.remove()); }
    const selected = destination.selectedOptions[0];
    const values = {
      branchSummaryName: selected?.dataset.name || 'Elige una sucursal',
      branchSummaryAddress: selected?.dataset.address || '',
      branchSummaryLines: items.length,
      branchSummaryUnits: items.reduce((sum,item)=>sum+Number(item.cantidad),0),
    };
    for(const [id,value] of Object.entries(values)) { const element = form.querySelector('#'+id); if(element) element.textContent = value; }
    form.querySelectorAll('[data-branch-choice]').forEach(button=>{ const active=button.dataset.branchChoice===destination.value; button.classList.toggle('selected',active); button.setAttribute('aria-pressed',String(active)); });
  }
  form.querySelector("#branchAdd").addEventListener("click", () => {
    const productId = Number(product.value),
      quantity = Number(qty.value);
    if (
      !productId ||
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 100000
    ) {
      qty.setCustomValidity("Selecciona un SKU y cantidad positiva");
      qty.reportValidity();
      return;
    }
    qty.setCustomValidity("");
    const existing = items.find(
      (item) => Number(item.producto_id) === productId,
    );
    if (existing && Number(existing.cantidad)+quantity>100000) {
      qty.setCustomValidity('El máximo por producto es 100 000 unidades.'); qty.reportValidity(); return;
    }
    if (existing) existing.cantidad = Number(existing.cantidad) + quantity;
    else items.push({ producto_id: productId, cantidad: quantity });
    product.value = "";
    qty.value = "1";
    render();
    const feedback = form.querySelector('#branchFeedback');
    if(feedback) feedback.textContent='Producto agregado a la lista. Puedes añadir otro o revisar el pedido.';
  });
  lines.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    if (!button) return;
    items.splice(Number(button.dataset.remove), 1);
    render();
  });
  destination.addEventListener("change", render);
  form.querySelectorAll('[data-branch-choice]').forEach(button=>button.addEventListener('click',()=>{ destination.value=button.dataset.branchChoice; destination.dispatchEvent(new Event('change',{bubbles:true})); }));
  form.addEventListener("submit", (event) => {
    if (!items.length) {
      event.preventDefault();
      render();
    }
  });
  render();
})();
