const normalize = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const compact = value => normalize(value).replace(/[^a-z0-9]/g, "");

// Exact identifiers are ranked before broad location prefixes, so CD1 opens
// the building rather than disappearing behind dozens of storage positions.
export function searchMapEntities(snapshot, value, { statusLabel = value => value || "", productName, limit = 8 } = {}) {
  const query = normalize(value), token = compact(value);
  if (!query || !token) return [];
  const layout = snapshot?.layout || {}, catalog = snapshot?.catalog || {},
    zoneName = id => (layout.zones || []).find(zone => zone.id === id)?.name || id || "",
    skuName = id => {
      const sku = (catalog.skus || []).find(item => item.id === id);
      return productName ? productName(sku) : sku?.name || id || "Carga";
    },
    infrastructure = (type, records, detail) => (records || []).map(item => ({
      type, id: item.id, code: item.code, title: item.name || item.label || item.code || item.id,
      detail: typeof detail === "function" ? detail(item) : detail,
    }));
  const items = [
    { type: "warehouse", id: "CD1", title: "Centro de distribución DonPepe", detail: "Centro de distribución", aliases: ["almacén", "centro donpepe", "warehouse"] },
    ...(snapshot?.equipment?.robots || []).map(item => ({ type: "robot", id: item.id, title: item.name || item.id, detail: statusLabel(item.status) })),
    ...(snapshot?.equipment?.trucks || []).map(item => ({ type: "truck", id: item.id, title: item.name || item.id, detail: statusLabel(item.status) })),
    ...(snapshot?.autonomyConfiguration?.assets || []).map(item => ({ type: "asset", id: item.id, title: item.name || item.id, detail: item.readiness?.ready ? "Automatización disponible" : item.readiness?.reason || "Equipo automático" })),
    ...infrastructure("branch", catalog.branches, "Tienda"),
    ...infrastructure("zone", layout.zones, "Zona de almacén"),
    ...infrastructure("rack", layout.racks, item => `Rack · ${zoneName(item.zoneId)}`),
    ...infrastructure("loc", layout.locations, item => `Ubicación · ${zoneName(item.zoneId)}${item.level ? ` · Nivel ${item.level}` : ""}`),
    ...infrastructure("station", layout.stations, item => /^DOCK-/.test(item.id) ? `Muelle ${item.id.split("-").at(-1)} · Estación operativa` : "Estación operativa"),
    ...(snapshot?.inventory?.hus || snapshot?.hus || []).filter(item => item.cases > 0 && !["DELIVERED", "DISCREPANCY"].includes(item.status)).map(item => ({
      type: "hu", id: item.id, title: skuName(item.skuId), detail: `${item.id} · ${item.lot || "Sin lote"} · ${item.cases} cajas`,
    })),
    ...(snapshot?.missions || []).map(item => ({ type: "mission", id: item.id, title: item.label || item.type || item.id, detail: `Misión · ${statusLabel(item.status)}` })),
  ];
  return items.map((item, index) => {
    const identifiers = [item.id, item.code, ...(item.aliases || [])].filter(Boolean),
      title = normalize(item.title), haystack = normalize(`${item.title} ${item.id} ${item.code || ""} ${item.detail} ${(item.aliases || []).join(" ")}`),
      exact = identifiers.some(id => compact(id) === token),
      score = exact ? 0 : compact(item.title) === token ? 1 : identifiers.some(id => compact(id).startsWith(token)) ? 2 : title.startsWith(query) ? 3 : 4;
    return { item, index, score, match: exact || haystack.includes(query) || compact(haystack).includes(token) };
  }).filter(result => result.match).sort((a, b) => a.score - b.score || a.index - b.index).slice(0, limit).map(result => result.item);
}
