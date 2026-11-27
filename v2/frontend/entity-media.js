// References describe the selected product, registered asset, or relevant
// infrastructure class. They never stand in for a live photograph of a pose.
export const MAP_REFERENCE_TYPES = Object.freeze([
  "warehouse", "zone", "rack", "loc", "location", "station", "branch",
  "robot", "equipment", "truck", "asset", "hu", "mission", "component",
]);
const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const localReferenceImage = value => typeof value === "string" && /^\/images\/(?:[\w-]+\/)*[\w-]+\.(?:png|jpe?g|webp|avif|svg)$/i.test(value) ? value : "";
const equipmentImages = {
  AMR: ["amr", "Robot móvil autónomo"], STACKER: ["stacker", "Transelevador y almacenamiento automático"],
  SHUTTLE: ["shuttle", "Transferencia de cargas"], FORKLIFT: ["forklift", "Montacargas de expedición"],
  TRUCK: ["truck", "Camión de distribución"], CHARGER: ["charger", "Estación de carga"],
  AUTO_UNLOADER: ["auto_unloader", "Descargador automático"], AUTO_ID_GATE: ["auto_id_gate", "Portal de identificación"],
  PIE_STATION: ["pie_station", "Inspección de entrada"], INBOUND_CONVEYOR: ["inbound_conveyor", "Transportador de recepción"],
  CASE_PICKING_CELL: ["case_picking_cell", "Célula de preparación de cajas"], STORE_RECEIVING_STATION: ["store_receiving_station", "Recepción automática de tienda"],
};
const structureKinds = {
  DRY: "STACKER", COLD: "STACKER", FROZEN: "SHUTTLE", RECEIVING: "INBOUND_CONVEYOR", RECEIPT: "INBOUND_CONVEYOR",
  PACKING: "CASE_PICKING_CELL", PACK: "CASE_PICKING_CELL", DISPATCH: "FORKLIFT", DOCK: "FORKLIFT",
};
const equipmentReference = (kind, caption) => equipmentImages[kind] ? {
  imageUrl: `/images/representations/equipment-${equipmentImages[kind][0]}.webp`,
  caption: caption || `Referencia · ${equipmentImages[kind][1]}`, alt: equipmentImages[kind][1], kind: "equipment-class",
} : null;

export function illustratedReference(type = "warehouse") {
  const rack = ["rack", "loc", "location", "zone"].includes(type),
    load = ["hu", "mission"].includes(type),
    drawing = rack ? '<path d="M176 290V92m144 198V92m144 198V92M171 110h298M171 188h298M171 266h298" stroke-width="11"/><path d="M198 172v-43h78v43Zm143 0v-43h78v43ZM198 250v-43h78v43Zm143 0v-43h78v43Z" fill="#d5b978" fill-opacity=".3" stroke-width="4"/>'
      : load ? '<path d="m320 92 112 57-112 57-112-57Zm-112 57v114l112 57V206m112-57v114l-112 57M274 115l112 57v47M190 280l130 65 130-65" stroke-width="6"/>'
        : '<path d="m145 165 175-77 175 77v137H145Zm0 0h350M185 302V190h104v112m39 0V190h125v112M215 212h44m-44 26h44m-44 26h44m96-50h70m-70 28h70m-70 28h70" stroke-width="7"/><path d="m145 165 175-77 175 77" stroke="#ebd6a8" stroke-width="10"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#1b2730"/><stop offset="1" stop-color="#0c1218"/></linearGradient></defs><rect width="640" height="400" fill="url(#bg)"/><path d="M80 334h480M110 350h420" stroke="#6b7a85" stroke-opacity=".28"/><g fill="none" stroke="#d5b978" stroke-linecap="round" stroke-linejoin="round">${drawing}</g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function resolveMapReference(snapshot, selection = {}) {
  const { type = "warehouse", id } = selection, catalog = snapshot?.catalog || {},
    assets = catalog.assets || [], layout = snapshot?.layout || {},
    devices = [...(snapshot?.equipment?.robots || snapshot?.robots || []), ...(snapshot?.equipment?.trucks || snapshot?.trucks || [])],
    units = snapshot?.inventory?.hus || snapshot?.hus || [],
    photo = (record, caption, kind = "record") => localReferenceImage(record?.imageUrl) ? { imageUrl: record.imageUrl, caption, alt: record.name || caption, kind } : null,
    assetFor = deviceId => deviceId ? assets.find(asset => asset.id === deviceId || asset.deviceId === deviceId) : undefined,
    assetPhoto = (asset, device) => photo(asset, asset?.name || "Equipo registrado", "asset") || equipmentReference(asset?.type || device?.type),
    productPhoto = skuId => photo((catalog.skus || []).find(sku => sku.id === skuId), "Producto de la carga", "product"),
    structure = (item = {}) => {
      const zone = item.zoneId || item.type || item.id;
      return photo(item, item.name || "Infraestructura del centro", "infrastructure")
        || equipmentReference(structureKinds[zone], ["rack", "loc", "location"].includes(type) ? "Referencia del sistema de almacenamiento" : "Referencia del equipo de esta zona");
    };
  let reference;
  if (type === "warehouse") reference = photo(layout, "Centro de distribución DonPepe", "warehouse") || { imageUrl: "/images/auth/donpepe-lima-exterior-v2-1920.webp", caption: "Centro de distribución DonPepe · vista exterior", alt: "Exterior del centro de distribución DonPepe", kind: "warehouse" };
  else if (type === "branch") reference = photo((catalog.branches || []).find(branch => branch.id === id) || (layout.branches || []).find(branch => branch.id === id), "Sucursal DonPepe", "branch");
  else if (["robot", "equipment", "truck", "asset"].includes(type)) {
    const device = devices.find(item => item.id === id), asset = assetFor(id);
    reference = assetPhoto(asset, device || (type === "truck" ? { type: "TRUCK" } : null));
  } else if (type === "hu") reference = productPhoto(units.find(unit => unit.id === id)?.skuId);
  else if (type === "mission") {
    const mission = (snapshot?.missions || []).find(item => item.id === id), hu = units.find(unit => unit.id === mission?.huId);
    reference = productPhoto(mission?.skuId || hu?.skuId) || assetPhoto(assetFor(mission?.robotId || mission?.equipmentId));
  } else if (["loc", "location", "rack", "zone"].includes(type)) {
    const key = type === "zone" ? "zones" : type === "rack" ? "racks" : "locations";
    reference = structure((layout[key] || []).find(item => item.id === id));
  } else if (type === "station") {
    const station = (layout.stations || []).find(item => item.id === id),
      fixed = (layout.automation?.stations || []).find(item => item.id === id || item.handoffStationId === id),
      registered = assets.find(asset => station?.deviceId && asset.deviceId === station.deviceId || fixed?.assetId && asset.id === fixed.assetId),
      kind = id === "RECEIVE" ? "INBOUND_CONVEYOR" : id === "PACK" ? "CASE_PICKING_CELL" : /^DOCK-/.test(id) ? "FORKLIFT" : /^CHARGE-/.test(id) ? "CHARGER" : id === "DRY-IN" || id === "COLD-IN" ? "STACKER" : id === "FROZEN-IN" ? "SHUTTLE" : null;
    reference = assetPhoto(registered) || photo(station, station?.name || "Estación operativa", "station") || equipmentReference(kind) || structure(station);
  } else if (type === "component") reference = assetPhoto(assetFor(selection.assetId || selection.ownerId));
  return reference || { imageUrl: illustratedReference(type), caption: ["hu", "mission"].includes(type) ? "Esquema de una unidad de carga" : ["rack", "loc", "location", "zone"].includes(type) ? "Esquema del sistema de almacenamiento" : "Esquema de la infraestructura", alt: "Esquema ilustrado del elemento seleccionado", kind: "illustration" };
}

export function mapReferenceMarkup(snapshot, selection) {
  const reference = resolveMapReference(snapshot, selection);
  return `<figure class="map-reference" data-reference-kind="${escape(reference.kind)}"><img data-map-reference data-map-reference-type="${escape(selection?.type || "warehouse")}" class="map-reference-photo" src="${escape(reference.imageUrl)}" alt="${escape(reference.alt)}" decoding="async" width="640" height="400"><figcaption>${escape(reference.caption)}</figcaption></figure>`;
}

export function installMapReferenceFallback(root = document) {
  root.addEventListener("error", event => {
    const image = event.target;
    if (!image?.matches?.("img[data-map-reference]") || image.dataset.mapReferenceFailed) return;
    image.dataset.mapReferenceFailed = "true";
    image.src = illustratedReference(image.dataset.mapReferenceType);
    image.alt = "Esquema ilustrado del elemento seleccionado";
    const figure = image.closest(".map-reference");
    if (figure) { figure.dataset.referenceKind = "illustration"; figure.querySelector("figcaption").textContent = "Representación del elemento seleccionado"; }
  }, true);
}
