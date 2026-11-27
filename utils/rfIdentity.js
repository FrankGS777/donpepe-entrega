const normalize = (value) => String(value || "").trim().toUpperCase();

function matchesTaskLoad(task, scanned) {
  const trace = [task.numero_lote, task.codigo_lote_wms, task.codigo_hu];
  const accepted = Number(task.control_lote) === 1
    ? trace
    : [...trace, task.sku, task.codigo_barras];
  return Boolean(normalize(scanned)) && accepted.filter(Boolean).map(normalize).includes(normalize(scanned));
}

module.exports = { matchesTaskLoad };
