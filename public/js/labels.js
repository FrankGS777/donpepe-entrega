(() => {
  const root = document.querySelector("[data-labels]");
  if (!root) return;

  const data = JSON.parse(root.dataset.labels || "{}");
  const type = root.querySelector("[data-label-type]");
  const search = root.querySelector("[data-label-search]");
  const grid = root.querySelector("[data-label-grid]");

  const payloads = {
    products: (item) => ({
      code: item.sku,
      title: item.nombre,
      meta: [`EAN ${item.codigo_barras || "N/D"}`, item.categoria, item.marca],
    }),
    lots: (item) => ({
      code: item.codigo_lote_wms,
      title: item.producto,
      meta: [
        item.sku,
        `Fabricante ${item.numero_lote}`,
        item.codigo_loc,
        `${item.cantidad_actual} UND`,
        item.fecha_vencimiento ? `Vence ${item.fecha_vencimiento}` : "Sin vencimiento",
      ],
    }),
    locations: (item) => ({
      code: item.codigo_loc,
      title: item.zona,
      meta: [item.tipo, `Casillero ${item.capacidad_hu || 1} HU`],
    }),
  };

  function makeLabel(item) {
    const value = payloads[type.value](item);
    const article = document.createElement("article");
    article.className = "print-label";
    const canvas = document.createElement("canvas");
    const text = document.createElement("div");
    const code = document.createElement("strong");
    const title = document.createElement("span");
    const meta = document.createElement("small");
    code.textContent = value.code;
    title.textContent = value.title;
    meta.textContent = value.meta.filter(Boolean).join(" · ");
    text.append(code, title, meta);
    article.append(canvas, text);
    grid.append(article);
    if (window.WmsUi?.renderQr) window.WmsUi.renderQr(canvas, value.code, { width: 92 });
    else if (window.QRCode) QRCode.toCanvas(canvas, value.code, { width: 92, margin: 1 });
  }

  function render() {
    const term = search.value.trim().toLocaleLowerCase("es");
    const items = (data[type.value] || []).filter((item) =>
      JSON.stringify(item).toLocaleLowerCase("es").includes(term),
    );
    grid.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No hay etiquetas para ese filtro.";
      grid.append(empty);
      return;
    }
    items.slice(0, 60).forEach(makeLabel);
  }

  type.addEventListener("change", render);
  search.addEventListener("input", render);
  render();
})();
