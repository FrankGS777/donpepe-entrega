// Contrato único de etiquetas para cámara, ingreso manual y resolución en MySQL.
function parseScan(raw) {
  const value = String(raw || "").trim();
  if (!value || value.length > 1000) return { raw: value, term: "", pairs: {} };
  let pairs = {};
  if (value.startsWith("{")) {
    try {
      pairs = Object.fromEntries(
        Object.entries(JSON.parse(value)).map(([k, v]) => [
          k.toUpperCase(),
          String(v),
        ]),
      );
    } catch {
      /* Un código de proveedor puede contener llaves. */
    }
  } else {
    pairs = Object.fromEntries(
      value
        .split(/[|;]/)
        .map((part) => {
          const match = part.match(/^\s*([A-Z_]+)\s*[:=]\s*(.+?)\s*$/i);
          return match ? [match[1].toUpperCase(), match[2]] : [];
        })
        .filter((pair) => pair.length === 2),
    );
  }
  const sku = pairs.SKU || pairs.PRODUCTO || "";
  const ean = pairs.EAN || pairs.BARCODE || pairs.CB || "";
  const lot = pairs.LOT || pairs.LOTE || pairs.NUMERO_LOTE || "";
  const loc = pairs.LOC || pairs.UBICACION || "";
  const expiryText = pairs.EXP || pairs.VENCE || pairs.VENCIMIENTO || "";
  const expiry = /^\d{8}$/.test(expiryText)
    ? `${expiryText.slice(0, 4)}-${expiryText.slice(4, 6)}-${expiryText.slice(6)}`
    : /^\d{4}-\d{2}-\d{2}$/.test(expiryText)
      ? expiryText
      : "";
  return {
    raw: value,
    term: loc || lot || sku || ean || pairs.HU || pairs.TAREA || value,
    sku,
    ean,
    lot,
    loc,
    expiry,
    pairs,
  };
}
function fieldValue(scan, item, fieldName = "") {
  if (/origen|destino|codigo_loc|ubicacion|\bloc\b/i.test(fieldName))
    return item.tipo === "LOC" ? item.codigo : "";
  if (/barras|barcode|ean/i.test(fieldName))
    return item.codigo_barras || scan.ean || "";
  if (/producto|sku|barras/i.test(fieldName))
    return (
      item.sku ||
      (item.tipo === "SKU" ? item.codigo : scan.sku || scan.ean || scan.term)
    );
  if (/lote|lot/i.test(fieldName))
    return (
      scan.lot ||
      item.numero_lote ||
      (item.tipo === "LOTE" ? item.codigo : scan.term)
    );
  return scan.term;
}
module.exports = { parseScan, fieldValue };
