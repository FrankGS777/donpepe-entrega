import { supplierClaimsMarkup, handleSupplierClaim, refreshSupplierClaimDialog } from "./supplier-claims-view.js";
import { renderFinance } from "./finance-view.js";
import { createGovernance } from "./governance.js";
import { renderAvatar } from "./avatar.js";
import {
  installExperience,
  formIssue,
  markFieldError,
  photo,
} from "./experience.js";
import { installEntityPickers } from "./entity-picker.js";
import { createReceiptWorkflow } from "./receipt-workflow.js";
import { showEquipmentRules } from "./equipo-reglas-readonly.js";
import { createProductCatalogDialog } from "./product-catalog-dialog.js";
import { createKardexView } from "./kardex-view.js";
import { createProductTraceability } from "./traceability-view.js";
import { createAutonomyView, autonomyProcessMessage } from "./autonomy-view.js";
import { mapReferenceMarkup, installMapReferenceFallback } from "./entity-media.js";
import { searchMapEntities } from "./map-search.js";
import { inspectionOrderId } from "./inspection-context.js";
import { limaDate, addLimaDays, formatLima, formatCalendarDate, newestFirst } from "./time.js";
import { createStorePortal } from "./store-portal.js";
import { createViewFilters } from "./view-filters.js";
import packagingQuality from "../core/packaging-quality.js";

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const renderedContent = new WeakMap();
const setContent = (selector, html) => {
  const element = $(selector);
  if (element && renderedContent.get(element) !== html) {
    renderedContent.set(element, html);
    element.innerHTML = html;
  }
};
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const num = (value) =>
  new Intl.NumberFormat("es-PE", { maximumFractionDigits: 1 }).format(
    Number(value) || 0,
  );
const icon = (name) =>
  `<svg class="icon" aria-hidden="true"><use href="/icons.svg#i-${name}"></use></svg>`;
const main = $("#main"),
  dialog = $("#dialog");
installExperience({ dialog });
installMapReferenceFallback();
let state,
  user,
  csrf,
  scene,
  view = "",
  selected = null,
  online = true,
  submitting = false,
  refreshTimer;
let retainedScene;
let requestedMapView = "overview";
let requestedMapTarget = null;
// Keep one GPU context for the operations session; no rendering in other modules.
function suspendMap() {
  if (!scene) return;
  scene.setActive(false);
  scene.host.remove();
  retainedScene = scene;
  scene = null;
}
let governance;
let receiptWorkflow;
let productCatalog;
let kardexView;
let autonomyView;
let storePortal;
let clockSync = { at: Date.now(), monotonic: performance.now() };
const viewFilters = createViewFilters({ main, esc, icon, getState: () => state });
installEntityPickers({ getState: () => state, photo, esc });
let lastViewSignature = "";
let resourceTab = "docks";
let trackedOrderId = null;
let orderFilters = { query: "", status: "all" };
let storeCatalogFilters = { query: "", category: "all", page: 1 };
const pendingCommands = new Map();
let resourcesVisible = false;
function viewSignature() {
  const equipment = () =>
    state.equipment.robots.map(({ id, status, battery, missionId }) => ({
      id,
      status,
      battery: Math.round((battery || 0) * 10) / 10,
      missionId,
    }));
  const missions = () =>
    state.missions.map(
      ({ id, status, label, type, skuId, cases, robotId, equipmentId }) => ({
        id,
        status,
        label,
        type,
        skuId,
        cases,
        robotId,
        equipmentId,
      }),
    );
  const byView = {
    finance: () => [state.supplierClaims,state.finance,state.purchases,state.catalog.suppliers,state.catalog.branches],
    orders: () => [
      state.catalog.branches,
      state.catalog.skus,
      state.orders,
      state.orderReadModels,
      state.fleetReadModels,
      state.autonomy,
    ],
    purchases: () => [
      state.catalog.suppliers,
      state.catalog.skus,
      state.purchases,
      state.supplierClaims,
      state.autonomy,
    ],
    inventory: () => [state.catalog.skus, state.inventory],
    equipment: () => [
      state.catalog.assets,
      state.maintenance,
      equipment(),
      missions(),
      state.fleetReadModels,
    ],
    stores: () => [
      state.catalog.branches,
      state.inventory.storeStock,
      state.orders,
    ],
    analytics: () => [
      state.metrics,
      state.catalog.skus,
      missions(),
      state.orders,
    ],
    incidents: () => [
      state.incidents,
      state.equipment.robots
        .filter((robot) => robot.status === "FAULT")
        .map(({ id }) => id),
    ],
    overview: () => [state.metrics, state.orders, state.catalog.branches],
  };
  return JSON.stringify((byView[view] || (() => []))());
}
const statuses = {
  PENDING: "Por liberar",
  DRAFT: "Borrador",
  RELEASED: "En preparación",
  PREPARING: "En preparación",
  READY: "Listo para salir",
  DISPATCHED: "En camino",
  IN_TRANSIT: "En camino",
  DELIVERED: "Recibido",
  RECEIVED: "Recibido",
  PARTIAL: "Con diferencias",
  CANCELLED: "Cancelado",
  EXPECTED: "En camino",
  ARRIVED: "En el muelle",
  PUTAWAY: "Almacenando",
  STORED: "Almacenado",
  COMPLETE: "Completado",
  COMPLETED: "Completada",
  QUEUED: "En espera",
  WAITING: "En espera",
  ASSIGNED: "Asignada",
  MOVING: "En movimiento",
  PICKING: "Recogiendo",
  LOADING: "Cargando",
  DROPPING: "Entregando",
  UNLOADING: "Descargando",
  IDLE: "Disponible",
  CHARGING: "Recargando",
  FAULT: "Fuera de servicio",
  BLOCKED: "Bloqueada",
  RESERVED: "Reservada",
  ON_ROBOT: "En transporte",
  AVAILABLE: "Disponible",
  QUARANTINE: "Cuarentena",
  WAITING_SUPPLIER_RETURN: "Espera traslado de devolución",
  SUPPLIER_RETURN_READY: "Devolución preparada",
  RETURNED_SUPPLIER: "Devuelta al proveedor",
  STAGING: "Consolidado",
  RUNNING: "En ejecución",
  WAITING_RESOURCE: "Esperando equipo",
  WAITING_TRAFFIC: "Esperando paso",
  TRAVELLING: "En ruta",
  RETURNING: "Regresando",
  TO_SOURCE: "Hacia origen",
  TO_DESTINATION: "Hacia destino",
  PICKED: "Carga recogida",
};
Object.assign(statuses, {
  REQUESTED: "Solicitado",
  APPROVED: "Autorizado",
  WAITING_SAFE: "Esperando parada segura",
  IN_PROGRESS: "En mantenimiento",
  MAINTENANCE: "En mantenimiento",
  OUT_OF_SERVICE: "Retirado de servicio",
  ACTIVE: "En ejecución",
  WAITING_ROUTE: "Esperando paso",
  TO_CHARGER: "Hacia el cargador",
  AT_STORE: "En la tienda",
  WAITING_PICKUP: "Esperando recogida",
  PICKUP_EN_ROUTE: "Vehículo hacia tienda",
  RETURN_PICKUP: "Recogiendo devolución",
  RETURN_CARGO: "Regresando con devolución",
  QUARANTINED: "Recibida en cuarentena",
  AT_TRANSFER: "En transferencia",
  WAITING_STAGING: "Por consolidar",
  PACKING: "En preparación",
  EMPTY: "Carga vacía",
  ORDERED: "Llegada programada",
  OUTBOUND: "Hacia la tienda",
  ARRIVED: "En destino",
  RECEIVED_WITH_DIFFERENCE: "Recibido con diferencias",
  WAITING_PUTAWAY: "Por almacenar",
  WAITING_SPACE: "Esperando espacio",
  STORED: "Almacenado",
  STAGED: "Consolidado",
  DISCREPANCY: "Diferencia por conciliar",
  PARKING: "Regresando a espera",
  WORKING: "En ejecución",
  TRANSFERRING: "Transfiriendo carga",
  WAITING_QUARANTINE: "Pendiente de traslado a cuarentena",
  CANCELLED_AFTER_PREPARATION: "Retenido tras preparar",
  WRITTEN_OFF: "Baja documentada",
  QUALITY_HOLD: "Retenido por calidad",
  DOCKING: "Acoplando al muelle",
  OPENING: "Abriendo acceso",
  VERIFYING: "Verificando carga",
  CLOSING: "Cerrando acceso",
  UNDOCKING: "Saliendo del muelle",
  RESERVED_LOADING: "Reservado para cargar",
  ON_TRUCK: "Cargado en camión",
  OPENING_REJECTION: "Preparando descarga",
  UNLOADING_REJECTION: "Descargando retención",
  REJECTED: "Carga retenida",
  DEPOSITING: "Colocando el palé",
  TO_TRUCK: "Hacia el camión",
  STAGING_APPROACH: "Colocando en expedición",
  STAGING_DEPOSIT: "Depositando el palé",
  STAGING_EXIT: "Liberando la maniobra",
});
function normalize(data) {
  if (Number.isFinite(Date.parse(data.meta?.serverTime))) clockSync = { at: Date.parse(data.meta.serverTime), monotonic: performance.now() };
  if (data.autonomy && data.autonomyConfiguration) {
    data.autonomy.configurationModel = data.autonomyConfiguration;
    data.autonomy.configurationSchema = data.autonomyConfiguration.configurationSchema;
    data.autonomy.configurationRevision = data.autonomyConfiguration.configurationRevision;
    data.autonomy.assets = data.autonomyConfiguration.assets;
  }
  for (const key of ["orders", "purchases", "missions", "returns"])
    for (const item of data[key] || []) item.status = item.state;
  data.inventory ||= { hus: [], storeStock: [] };
  data.equipment ||= { robots: [], trucks: [] };
  data.missions ||= [];
  data.orders ||= [];
  data.purchases ||= [];
  data.events ||= [];
  data.returns ||= [];
  data.metrics ||= {};
  data.clock ||= { now: new Date().toISOString(), paused: true, speed: 1 };
  for (const item of data.inventory.hus || []) item.status = item.state;
  for (const item of [...data.equipment.robots, ...data.equipment.trucks])
    item.status = item.state;
  const labels = {
    PICK_TO_PACK: "Llevar a preparación",
    TO_STAGING: "Llevar a expedición",
    PUTAWAY: "Almacenar recepción",
    PICK: "Extraer para pedido",
    TRANSFER: "Transferir carga",
    RETRIEVE: "Extraer de reserva",
    CONSOLIDATE: "Consolidar pedido",
    PACK: "Preparar cajas",
    STAGE: "Llevar a expedición",
    RETURN_TO_QUARANTINE: "Trasladar a cuarentena",
    TRUCK_LOAD: "Cargar el camión",
    TRUCK_UNLOAD: "Descargar retención",
  };
  for (const m of data.missions) {
    m.type = m.kind;
    m.label = labels[m.kind] || m.kind;
    m.skuId =
      m.skuId ||
      data.inventory.hus.find((h) => h.id === m.huId || h.id === m.sourceHuId)
        ?.skuId;
  }
  return data;
}
const status = (value) =>
  statuses[value] ||
  String(value || "Pendiente")
    .replaceAll("_", " ")
    .toLowerCase();
const requestOrigin = (order) =>
  order.source === "SIMULATION"
    ? "Prueba histórica"
    : order.source === "SCENARIO" ? "Registro inicial"
    : order.source === "STORE"
      ? "Solicitado por tienda"
      : "Solicitud existente";
const badge = (value) =>
  `<span class="badge ${["COMPLETE", "COMPLETED", "DELIVERED", "RECEIVED", "STORED", "READY", "AVAILABLE", "IDLE"].includes(value) ? "green" : ["FAULT", "BLOCKED", "CANCELLED", "QUARANTINE"].includes(value) ? "red" : ["PENDING", "QUEUED", "WAITING", "ARRIVED", "PARTIAL"].includes(value) ? "amber" : "purple"}">${esc(status(value))}</span>`;
const sku = (id) =>
  (state.catalog.skus || []).find((x) => x.id === id) || {
    id,
    name: id,
    unitsPerCase: 1,
  };
const branch = (id) =>
  state.catalog.branches.find((x) => x.id === id) || { name: id };
const supplier = (id) =>
  state.catalog.suppliers.find((x) => x.id === id) || { name: id };
const suppliedBy = (item, supplierId) =>
  (
    item.eligibleSupplierIds || [item.supplierId, ...(item.supplierIds || [])]
  ).includes(supplierId);
const skuName = (x) => x.name || x.nombre || x.id;
const qty = (x) => Number(x.cases ?? x.quantity ?? 0);
const allHus = () => state.inventory.hus || [];
const locationName = id => state.layout.locations?.find(row => row.id === id)?.description || state.layout.stations?.find(row => row.id === id)?.name || [...state.equipment.robots, ...state.equipment.trucks].find(row => row.id === id)?.name || state.catalog.branches.find(row => row.id === id)?.name || id || "Pendiente de asignación";
const activeMissions = () =>
  state.missions.filter(
    (x) => !["COMPLETED", "COMPLETE", "CANCELLED", "FAILED"].includes(x.status),
  );
const isOps = () => user.role === "operations";
const isAdmin = () => user.role === "admin";
const can = (permission) =>
  Array.isArray(user?.permissions) && user.permissions.includes(permission);
const canOrder = () => can("order.create");
const toast = (message, type = "success") => {
  const stack = $("#toasts");
  for (const previous of stack.children)
    if (previous.dataset.message === message) previous.remove();
  while (stack.children.length >= 3) stack.firstElementChild.remove();
  const el = document.createElement("div");
  el.dataset.message = message;
  el.className = `toast ${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span>${type === "error" ? "!" : "✓"}</span><p>${esc(message)}</p><button aria-label="Cerrar aviso">×</button>`;
  stack.append(el);
  $("button", el).onclick = () => el.remove();
  setTimeout(() => el.remove(), 7000);
};

async function api(url, body, method = "POST") {
  let response;
  try {
    response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf || "",
      },
      ...(body === undefined ? {} : { method, body: JSON.stringify(body) }),
    });
  } catch {
    throw Error(
      "No hay conexión con el servidor. Tus datos siguen en el formulario; comprueba la conexión y vuelve a intentarlo.",
    );
  }
  if (response.status === 401) {
    location.href = "/login";
    throw Error("La sesión terminó.");
  }
  const data = await response.json();
  if (!response.ok) {
    const error = Error(data.error || "No se pudo completar la operación.");
    error.status = response.status;
    error.fieldErrors = data.fieldErrors || {};
    throw error;
  }
  return data;
}
async function command(type, payload, message) {
  if (submitting) throw Error("Espera a que termine la operación anterior.");
  submitting = true;
  const trigger =
    document.activeElement?.tagName === "BUTTON"
      ? document.activeElement
      : null;
  const wasDisabled = trigger?.disabled;
  if (trigger) {
    trigger.disabled = true;
    trigger.setAttribute("aria-busy", "true");
  }
  const key = JSON.stringify([type, payload]);
  let commandId = pendingCommands.get(key);
  if (!commandId) {
    commandId = crypto.randomUUID();
    pendingCommands.set(key, commandId);
  }
  if (pendingCommands.size > 30)
    pendingCommands.delete(pendingCommands.keys().next().value);
  try {
    const result = await api("/api/commands", {
      type,
      payload: { commandId, ...payload },
    });
    const nextState = normalize(result.state);
    // A polling response and a command may cross on the network. An older
    // revision must not rewind equipment or restore an obsolete document.
    if (
      !state ||
      Number(nextState.meta?.revision || 0) >= Number(state.meta?.revision || 0)
    )
      state = nextState;
    if (message) toast(message);
    pendingCommands.delete(key);
    refreshCurrent();
    return result.result;
  } catch (error) {
    if (error.status && error.status < 500) pendingCommands.delete(key);
    showOperationError(error);
    throw error;
  } finally {
    submitting = false;
    if (trigger?.isConnected) {
      trigger.disabled = wasDisabled;
      trigger.removeAttribute("aria-busy");
    }
  }
}
function showOperationError(error) {
  const form = dialog.open ? $("#dialog-body form") : null;
  if (form?.hasAttribute("data-govern-validation")) return;
  if (form) {
    formIssue(form, error.message, error.fieldErrors);
    return;
  }
  const root = dialog.open ? $("#dialog-body") : main;
  $(".operation-error", root)?.remove();
  const box = document.createElement("div");
  box.className = "operation-error";
  box.setAttribute("role", "alert");
  box.tabIndex = -1;
  box.innerHTML = `<strong>No se pudo completar la acción</strong><p>${esc(error.message)}</p><button class="icon-button" type="button" aria-label="Cerrar aviso">×</button>`;
  $("button", box).onclick = () => box.remove();
  root.prepend(box);
  box.focus({ preventScroll: true });
}
function showDialog(title, content, eyebrow = "DONPEPE · OPERACIONES") {
  $("#dialog-title").textContent = title;
  $("#dialog-eyebrow").textContent = eyebrow;
  $("#dialog-body").innerHTML = content;
  decorateEntityMentions($("#dialog-body"));
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  enforceVisiblePermissions();
  if (
    document.activeElement === dialog ||
    !dialog.contains(document.activeElement)
  )
    $("input,select,button", $("#dialog-body"))?.focus({ preventScroll: true });
}
function decorateEntityMentions(root) {
  if (!state?.catalog) return;
  for (const target of $$(".line-items>div>span:first-child", root)) {
    if (target.querySelector("img")) continue;
    const value = target.textContent.trim(),
      item = state.catalog.skus.find((s) => s.name === value);
    if (item)
      target.insertAdjacentHTML(
        "afterbegin",
        photo(item, "document-product-image"),
      );
  }
}
const branchMedia = (id) =>
  `<div class="document-branch-media">${photo(branch(id))}</div>`;
const branchContext = (id) =>
  `<div class="document-context-entity">${photo(branch(id))}<div><strong>${esc(branch(id).name)}</strong><small>${esc(branch(id).district || "Red DonPepe")} · Sucursal de destino</small></div></div>`;
function fleetSummary() {
  const fleet = state.fleetReadModels || [];
  if (!isOps() || !fleet.length) return "";
  const available = fleet.filter((truck) => truck.available).length;
  const waiting = fleet.filter(
    (truck) => truck.nextAction === "CONFIRM_STORE_RECEIPT",
  ).length;
  return `<section class="fleet-overview ${available ? "" : "fleet-busy"}"><span class="fleet-overview-symbol">${icon("truck")}</span><div><strong>${available} de ${fleet.length} camiones disponibles</strong><p>${waiting ? `${waiting} ${waiting === 1 ? "espera la recepción de su tienda" : "esperan la recepción de sus tiendas"}. El regreso comienza después de confirmarla.` : available ? "Los vehículos libres se asignan al iniciar un despacho compatible." : "Los vehículos conservan su asignación hasta terminar la entrega y regresar al centro."}</p></div>${button("Ver disponibilidad", "fleet-status", "secondary small")}</section>`;
}
function showFleetStatus() {
  const fleet = state.fleetReadModels || [];
  showDialog(
    "Disponibilidad de transporte",
    `<div class="fleet-status-list">${
      fleet
        .map((truck) => {
          const asset = state.catalog.assets?.find(
            (item) => item.deviceId === truck.truckId,
          );
          return `<article class="fleet-status-card">${asset ? photo(asset, "fleet-truck-photo") : icon("truck")}<div><div class="card-top"><strong>${esc(truck.name || truck.truckId)}</strong><span class="badge ${truck.available ? "green" : "amber"}">${esc(truck.stateLabel)}</span></div><p>${esc(truck.reason)}</p>${truck.orderId ? `<small>${esc(truck.orderId)} · ${esc(branch(truck.branchId).name)}</small>` : ""}${truck.returnSecondsRemaining !== null && truck.returnSecondsRemaining !== undefined ? `<small>Regreso estimado: ${num(truck.returnSecondsRemaining)} segundos del reloj operativo</small>` : ""}<div>${truck.orderId ? button(truck.canConfirmReceipt ? "Revisar y confirmar recepción" : "Ver entrega vinculada", truck.canConfirmReceipt ? "receive-order" : "open-order", "secondary small", `data-id="${esc(truck.orderId)}"`) : ""}</div></div></article>`;
        })
        .join("") || "<p>No hay vehículos registrados para tu ámbito.</p>"
    }</div><div class="notice">La disponibilidad se recupera al terminar la recepción y el regreso físico. No se libera un camión borrando su pedido ni retirando una carga en tránsito.</div>`,
    "FLOTA · DISPONIBILIDAD Y DESTINO",
  );
}
$("#dialog-close").onclick = () => dialog.close();
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) {
    const r = dialog.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      dialog.close();
  }
});
const empty = (title, description, action = "") =>
  `<div class="empty-state"><span class="empty-symbol">↗</span><h3>${esc(title)}</h3><p>${esc(description)}</p>${action}</div>`;
const pageHeading = (label, title, subtitle, actions = "") =>
  `<section class="page-heading"><h1>${esc(title)}</h1><div class="heading-actions">${actions}</div></section>`;
const button = (label, action, cls = "primary", extra = "") =>
  `<button class="btn ${cls}" data-action="${action}" ${extra}>${label === "Simular incidencia" ? "Registrar incidencia" : label}</button>`;
const infoRow = (label, value) =>
  `<div class="info-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
const operationMeta = record => `<div class="operation-meta"><div><span>Registrado · hora de Lima</span><strong>${esc(formatLima(record.createdAt || record.requestedAt))}</strong></div><div><span>Responsable del registro</span><strong>${esc(record.createdByName || (record.createdBy === "AUTOMATION" || record.kind ? "Orquestador automático" : record.createdBy === "SCENARIO" ? "Carga inicial del sistema" : record.createdBy ? "Cuenta identificada en auditoría" : "Autor no registrado"))}</strong></div>${record.updatedAt ? `<div><span>Última actualización · Lima</span><strong>${esc(formatLima(record.updatedAt))}</strong></div>` : ""}${record.startedAt || record.completedAt ? `<div><span>${record.completedAt ? "Completado" : "Iniciado"} · Lima</span><strong>${esc(formatLima(record.completedAt || record.startedAt))}</strong></div>` : ""}</div>`;

const views = {
  finance: ["clipboard", "Documentos y pagos", "Comprobantes, pagos y traslados internos"],
  shop: ["package", "Reposición de mi tienda", "Catálogo y selección de productos"],
  summary: [
    "chart",
    "Resumen de existencias",
    "Estado del centro y sus tiendas",
  ],
  overview: ["grid", "Centro de control", "La operación, en tus manos."],
  orders: ["truck", "Pedidos de tiendas", "De una necesidad a una entrega."],
  purchases: [
    "package",
    "Abastecimiento",
    "Todo lo que llega, bien conectado.",
  ],
  inventory: ["layers", "Inventario", "Cada carga tiene su lugar."],
  kardex: ["clipboard", "Movimientos", "Movimientos y custodia de cada caja"],
  equipment: [
    "arrows",
    "Equipos y misiones",
    "La fuerza detrás de cada movimiento.",
  ],
  stores: ["store", "Red de tiendas", "Cerca de cada barrio."],
  users: ["users", "Usuarios", "Identidades y estado de acceso"],
  roles: ["shield", "Permisos", "Separación de responsabilidades"],
  catalog: ["package", "Catálogos", "Productos, proveedores y tiendas"],
  categories: ["layers", "Categorías", "Familias comerciales"],
  brands: ["tags", "Marcas", "Identidad y suministro"],
  assets: ["arrows", "Activos y equipos", "Registro técnico"],
  maintenance: ["clipboard", "Mantenimiento", "Intervenciones y seguridad"],
  settings: ["tags", "Configuración", "Reglas y entrega de correo"],
  recoveries: ["bell", "Recuperaciones", "Solicitudes de recuperación"],
  audit: ["clipboard", "Auditoría", "Historial de gobierno"],
  incidents: ["shield", "Incidencias", "Excepciones que requieren atención"],
};
const adminViews = [
  "summary",
  "kardex",
  "users",
  "roles",
  "catalog",
  "categories",
  "brands",
  "assets",
  "maintenance",
  "settings",
  "recoveries",
  "audit",
];
const operationNavLabels = {
  overview: "Mapa",
  orders: "Pedidos",
  purchases: "Recepción",
  inventory: "Inventario",
  kardex: "Movimientos",
  equipment: "Equipos",
  stores: "Tiendas",
  incidents: "Incidencias",
};
function allowedView(id) {
  if(id === "finance") return true;
  if (["autonomy", "analytics"].includes(id)) return false;
  if (id === "shop") return user.role === "store";
  if (id === "autonomy") return can("autonomy.read");
  if (id === "kardex")
    return can("inventory.read") || can("inventory.summary.read");
  if (isAdmin()) return adminViews.includes(id);
  if (id === "inventory") return can("inventory.read");
  if (user.role === "store")
    return ["overview", "orders", "stores"].includes(id);
  if (id === "analytics") return can("analytics.read");
  if (id === "equipment") return can("map.view");
  return !adminViews.includes(id);
}
function nav() {
  if (user.role === "store" && storePortal) { storePortal.nav(view); return; }
  $("#store-navigation")?.remove();
  const entries = Object.entries(views).filter(([id]) => allowedView(id));
  let links =
    entries
      .map(
        ([id, [ic, label]]) =>
          `<a href="#${id}" class="nav-item ${view === id ? "active" : ""}" ${view === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${isOps() ? operationNavLabels[id] || label : user.role === "store" ? { overview: "Mi tienda", orders: "Mis solicitudes", inventory: "Mis existencias", stores: "Recepciones y devoluciones" }[id] || label : label}</span>${id === "orders" ? `<small>${state.orders.filter((o) => !["DELIVERED", "RECEIVED", "CANCELLED", "CANCELLED_AFTER_PREPARATION"].includes(o.status)).length}</small>` : id === "recoveries" && state.metrics.pendingRecoveries ? `<small aria-label="${state.metrics.pendingRecoveries} solicitudes pendientes">${state.metrics.pendingRecoveries}</small>` : ""}</a>`,
      )
      .join("") +
    (isOps() && view === "overview"
      ? `<div class="console-shortcuts"><button class="btn secondary" data-action="new-purchase">Solicitar a proveedor</button><button class="btn secondary" data-action="toggle-live-panel" aria-expanded="${!$("#live-panel")?.hidden && !!$("#live-panel")}">${icon("arrows")} Misiones <span id="mission-count">${activeMissions().length}</span></button></div>`
      : "");
  if (isAdmin()) {
    const groups = [
      ["Supervisión", ["summary", "kardex", "finance"]],
      ["Catálogos", ["catalog", "categories", "brands"]],
      ["Infraestructura", ["assets", "maintenance"]],
      [
        "Gobierno y seguridad",
        ["users", "roles", "recoveries", "audit", "settings"],
      ],
    ];
    links = groups
      .map(
        ([label, ids]) =>
          `<section class="nav-group"><h2>${label}</h2>${ids
            .map((id) => {
              const [ic, title] = views[id];
              return `<a href="#${id}" class="nav-item ${view === id ? "active" : ""}" ${view === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${title}</span>${id === "recoveries" && state.metrics.pendingRecoveries ? `<small>${num(state.metrics.pendingRecoveries)}</small>` : ""}</a>`;
            })
            .join("")}</section>`,
      )
      .join("");
  }
  const target = isOps() ? $("#workspace-nav") : $("#navigation");
  if (target.innerHTML !== links) target.innerHTML = links;
  if (isOps()) $("#navigation").innerHTML = "";
}
function navigate() {
  if (!state || !user || !governance || !storePortal) return;
  let next = location.hash.slice(1) || (isAdmin() ? "summary" : "overview");
  if (next === "autonomy") next = isAdmin() ? "assets" : isOps() ? "equipment" : "overview";
  if (next === "analytics") next = isAdmin() ? "summary" : "overview";
  if (!views[next] || !allowedView(next))
    next = isAdmin() ? "summary" : "overview";
  if (location.hash.slice(1) !== next)
    history.replaceState(null, "", `#${next}`);
  if (view === next) {
    refreshCurrent();
    return;
  }
  suspendMap();
  view = next;
  document.body.dataset.view = view;
  selected = null;
  requestedMapTarget = null;
  nav();
  $("#breadcrumb").textContent = user.roleName;
  $("#page-title").textContent = views[view][1];
  $("#sidebar").classList.remove("mobile-open");
  render();
  window.scrollTo({ top: 0, behavior: "instant" });
}
function render(quiet = false) {
  main.toggleAttribute("data-refresh", quiet);
  lastViewSignature = viewSignature();
  suspendMap();
  $("#console-header-center")?.remove();
  $("#console-navigation-toggle")?.remove();
  $("#workspace-nav").removeAttribute("data-console-open");
  if (user.role === "store" && storePortal?.render(view, quiet)) return;
  if(view === "finance") { renderFinance({main,state,user,command,dialog:showDialog}); if(user.role!=="store") main.querySelector(".page-heading")?.insertAdjacentHTML("afterend",supplierClaimsMarkup(state,true)); return; }
  if (adminViews.includes(view) && !["kardex", "autonomy"].includes(view)) {
    governance.render(view);
    return;
  }
  ({
    overview: renderOverview,
    orders: renderOrders,
    purchases: renderPurchases,
    inventory: renderInventory,
    kardex: renderKardex,
    autonomy: renderAutonomy,
    equipment: renderEquipment,
    stores: renderStores,
    analytics: renderAnalytics,
    incidents: renderIncidents,
  })[view]();
  enforceVisiblePermissions();
  viewFilters.mount(view);
}
const actionPermissions = {
  "edit-order": "order.edit",
  "cancel-purchase": "purchase.cancel",
  "request-maintenance": "maintenance.request",
  "new-order": "order.create",
  "new-purchase": "purchase.create",
  "release-order": "order.release",
  "dispatch-order": "order.dispatch",
  "receive-order": "order.receive",
  "new-return": "return.create",
  "cancel-order": "order.cancel",
  "confirm-cancel": "order.cancel",
  "arrive-purchase": "purchase.arrive",
  "receive-purchase": "purchase.receive",
  "release-quarantine": "inventory.releaseQuarantine",
  "block-location": "location.block",
  "fault-equipment": "equipment.fault",
  "confirm-fault": "equipment.fault",
  "recover-equipment": "equipment.recover",
  consume: "store.consume",
  "resolve-incident": "incident.resolve",
  "reject-prepared": "order.rejectPrepared",
  "view-autonomy-job": "autonomy.read",
  "authorize-autonomy": "autonomy.authorize",
};
function enforceVisiblePermissions() {
  for (const button of $$("[data-action]")) {
    const permission = actionPermissions[button.dataset.action];
    if (permission) button.hidden = !can(permission);
    if (state?.autonomy && ["arrive-purchase", "receive-purchase", "receive-order"].includes(button.dataset.action)) button.hidden = true;
    if (button.dataset.action === "dispatch-order" && autonomousJob("ORDER", button.dataset.id)) button.hidden = true;
  }
  if ($("#simulation-toggle"))
    $("#simulation-toggle").disabled = !can("simulation.pause");
  if ($("#simulation-speed"))
    $("#simulation-speed").disabled = !can("simulation.speed");
}
function refreshCurrent() {
  if(state) refreshSupplierClaimDialog({getState:()=>state,user,command,dialog:showDialog});
  if(view === "finance") { if(viewSignature() !== lastViewSignature) render(true); return; }
  nav();
  updateClock();
  // The ledger has explicit filters and its own refresh button. Polling must
  // not replace a user's selected period or interrupt an open movement.
  if (view === "kardex") return;
  if (view === "autonomy") { autonomyView?.refresh(); return; }
  if (user.role === "store") { storePortal?.refresh(view); return; }
  if (isAdmin()) {
    governance.refresh(view);
    return;
  }
  if (view === "overview") {
    if ($("#map-host")) {
      updateOverview();
      scene?.update(state);
    } else if (!dialog.open && lastViewSignature !== viewSignature()) {
      render(true);
    }
    enforceVisiblePermissions();
    return;
  }
  if (
    !dialog.open &&
    !["INPUT", "SELECT", "TEXTAREA"].includes(
      document.activeElement?.tagName,
    ) &&
    lastViewSignature !== viewSignature()
  ) {
    const y = scrollY;
    const searches = $$("input[type=search]", main).map((input) => [
      input.id,
      input.value,
    ]);
    const active = document.activeElement;
    const focusKey =
      main.contains(active) && active.matches("button,a")
        ? [
            active.tagName,
            active.dataset.action || "",
            active.dataset.id || "",
            active.getAttribute("href") || "",
            active.textContent,
          ]
        : null;
    render(true);
    for (const [id, value] of searches) {
      const input = id && document.getElementById(id);
      if (input && value) {
        input.value = value;
        input.dispatchEvent(new Event("input"));
      }
    }
    if (focusKey) {
      const restored = $$("button,a", main).find(
        (element) =>
          JSON.stringify([
            element.tagName,
            element.dataset.action || "",
            element.dataset.id || "",
            element.getAttribute("href") || "",
            element.textContent,
          ]) === JSON.stringify(focusKey),
      );
      (restored || main).focus({ preventScroll: true });
    }
    scrollTo(0, y);
  }
}
function updateClock() {
  const clock = $("#sim-time");
  const now = new Date(clockSync.at + performance.now() - clockSync.monotonic);
  clock.dateTime = now.toISOString();
  clock.title = `${formatLima(now, { timeStyle: "medium" })} · America/Lima (UTC−5)`;
  clock.setAttribute("aria-label", clock.title);
  clock.textContent = `${new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "America/Lima",
  }).format(now)} PET`;
}
function syncCameraTabs() {
  $$("[data-camera]").forEach((button) => {
    const active = button.dataset.camera === scene?.view;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
function setConsoleNavigation(open, restoreFocus = false) {
  const toggle = $("#console-navigation-toggle");
  if (!toggle) return;
  $("#workspace-nav").toggleAttribute("data-console-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  if (restoreFocus) toggle.focus({ preventScroll: true });
}
function mountConsoleHeader() {
  const center = document.createElement("div");
  center.id = "console-header-center";
  center.innerHTML = `<div class="map-find"><label>${icon("search")}<input id="map-find" type="search" autocomplete="off" placeholder="Buscar cargas, equipos, tiendas…" aria-label="Buscar en el mapa"><kbd>/</kbd></label><div id="map-results" hidden></div></div><button class="console-site" data-inspect="warehouse" data-id="CD1" title="Inspeccionar centro de distribución"><span class="site-code">CD1</span><span><strong>Centro DonPepe</strong><small><span id="console-site-occupancy"></span> · Lima</small></span><span aria-hidden="true">⌄</span></button>`;
  $(".workspace-brand").after(center);
  const toggle = document.createElement("button");
  toggle.id = "console-navigation-toggle";
  toggle.className = "icon-button console-navigation-toggle";
  toggle.setAttribute("aria-label", "Abrir herramientas de operaciones");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "workspace-nav");
  toggle.innerHTML = `${icon("grid")}<span>Herramientas</span><span aria-hidden="true">⌄</span>`;
  toggle.onclick = () =>
    setConsoleNavigation(toggle.getAttribute("aria-expanded") !== "true");
  $("#workspace-nav").before(toggle);
}
function renderOverview() {
  if (!can("map.view")) {
    renderStoreOverview();
    return;
  }
  const operations = isOps();
  main.innerHTML =
    (operations
      ? `<h1 class="console-accessible-title">Centro de distribución DonPepe</h1>`
      : pageHeading(
          "TU CENTRO DE DISTRIBUCIÓN",
          "Abastecimiento de tu tienda",
          "Pedidos, entregas y existencias de tu sucursal.",
          `${canOrder() ? button("+ Pedido de tienda", "new-order") : ""}`,
        )) +
    `
    <section class="control-stage diorama-stage" aria-label="Centro de distribución interactivo">
      <div class="map-host" id="map-host"><div class="map-preview"><img src="/images/auth/donpepe-lima-exterior-v2-1440.webp" alt="" fetchpriority="high" width="1440" height="810"><div class="map-preview-action"><button type="button" class="btn primary" data-action="activate-map">Abrir mapa 3D</button></div></div></div>
      <div class="map-hud"><div class="metric-row" id="overview-metrics"></div></div>
      <div class="map-camera-tools">
        <div class="view-tabs" role="group" aria-label="Vista del mapa"><button class="active" data-camera="overview" title="Exterior isométrico">${icon("grid")}<span>Exterior</span></button><button data-camera="interior" title="Ver el interior">${icon("layers")}<span>Interior</span></button><button data-camera="aisle" title="Recorrer pasillos">${icon("arrows")}<span>Pasillo</span></button><button data-camera="network" title="Red de tiendas">${icon("store")}<span>Tiendas</span></button></div>
        <button class="map-panels-toggle" data-action="map-focus" aria-label="Ocultar paneles del mapa" aria-pressed="false" title="Mostrar u ocultar paneles">${icon("grid")}</button>
      </div>
      <aside class="map-inspector" id="map-inspector" hidden></aside>
      <section class="shipment-tracking" aria-label="Seguimiento del envío"><div id="shipment-tracking"></div><div id="next-action"></div></section>
      <section class="map-resources" id="map-resources" aria-label="Recursos del centro">
        <div class="resource-tabs" role="tablist" aria-label="Recursos"><button id="resource-tab-docks" data-resource-tab="docks" role="tab" aria-controls="resource-list">Muelles</button><button id="resource-tab-robots" data-resource-tab="robots" role="tab" aria-controls="resource-list">Equipos</button><button id="resource-tab-trucks" data-resource-tab="trucks" role="tab" aria-controls="resource-list">Camiones</button><button class="resource-close" data-action="toggle-resources" aria-label="Ocultar recursos">×</button></div><div id="resource-list" role="tabpanel"></div>
      </section>
      <div class="map-bottom"><span class="map-sim-tag">SIMULACIÓN</span><div class="simulation-controls"><button id="simulation-toggle" class="btn small secondary" ${!isOps() ? "disabled" : ""}></button><label class="speed-control"><span>Ritmo</span><select id="simulation-speed" aria-label="Ritmo de simulación" ${!isOps() ? "disabled" : ""}><option value="1">1×</option><option value="5">5×</option><option value="20">20×</option><option value="60">60×</option></select></label></div><button class="btn small secondary resource-toggle" data-action="toggle-resources" aria-expanded="true" title="Mostrar recursos">${icon("truck")}<span>Recursos</span></button><a href="#incidents" class="map-alert-link" id="map-alert-link" title="Ver incidencias">${icon("shield")} <span>Sin incidencias</span></a></div>
    </section>
    <div class="operations-bottom ${operations ? "live-panel" : ""}" id="live-panel" ${operations ? "hidden" : ""}><section class="panel"><div class="section-heading"><h2>Trabajo en curso ${!operations ? '<span id="mission-count" class="count-pill"></span>' : ""}</h2><a href="#equipment">Ver equipos ↗</a>${operations ? '<button class="icon-button" data-action="toggle-live-panel" aria-label="Cerrar misiones">×</button>' : ""}</div><div id="mission-list"></div></section><section class="panel"><div class="section-heading"><h2>Últimos eventos</h2><span class="live-label"><i class="live-dot"></i> Registro del motor</span></div><div id="event-list"></div></section></div>`;
  mountConsoleHeader();
  const reusableScene = retainedScene && !retainedScene.disposed && !retainedScene.failed;
  if (reusableScene) {
    scene = retainedScene;
    $("#map-host").replaceWith(scene.host);
    scene.clearSelection();
    scene.setTheme?.(window.DonPepeTheme?.get() || "dark");
    scene.update(state);
    scene.setActive(true);
  } else {
    retainedScene?.dispose();
  }
  retainedScene = null;
  $("#map-resources").hidden = !resourcesVisible;
  $(".resource-toggle").setAttribute(
    "aria-expanded",
    String(!$("#map-resources").hidden),
  );
  updateOverview();
  syncCameraTabs();
  $$("[data-camera]").forEach(
    (b) =>
      (b.onclick = () => {
        openWarehouseScene(b.dataset.camera, null);
      }),
  );
  $("#simulation-toggle").onclick = () =>
    command(
      "simulation.pause",
      { paused: !state.clock.paused },
      state.clock.paused ? "Operación reanudada." : "Simulación en pausa.",
    ).catch(() => {});
  $("#simulation-speed").onchange = (e) =>
    command(
      "simulation.speed",
      { speed: Number(e.target.value) },
      "Ritmo de simulación actualizado.",
    ).catch(() => {});
  $("#map-find").oninput = (event) => searchMap(event.target.value);
  const openMapButton = $("#map-host [data-action=activate-map]");
  const preloadMap = () => import("./scene.js").catch(() => {});
  openMapButton?.addEventListener("pointerenter", preloadMap, { once: true });
  openMapButton?.addEventListener("focus", preloadMap, { once: true });
}
async function openWarehouseScene(camera = requestedMapView, target = requestedMapTarget) {
  requestedMapView = camera;
  requestedMapTarget = target;
  const host = $("#map-host");
  if (!host || !can("map.view")) return;
  if (scene) {
    if (scene.initialized) {
      if (scene.view !== camera) scene.setView(camera);
      if (target) scene.focus(target.type, target.id);
      syncCameraTabs();
    }
    return;
  }
  const activation = host.querySelector('[data-action="activate-map"]');
  if (!activation || host.getAttribute("aria-busy") === "true") return;
  host.setAttribute("aria-busy", "true");
  activation.disabled = true;
  activation.textContent = "Abriendo mapa 3D…";
  try {
    const { default: WarehouseScene } = await import("./scene.js");
    if (!host.isConnected || view !== "overview" || !can("map.view")) return;
    const activeScene = new WarehouseScene(host, {
      onSelect: (item) => {
        selected = item;
        revealInspection();
        syncCameraTabs();
        $("#map-inspector").hidden = false;
        renderLogisticsPanels();
        renderInspector();
      },
    });
    scene = activeScene;
    host.addEventListener("scene-ready", () => host.querySelector(".map-preview")?.remove(), { once: true });
    scene.setTheme?.(window.DonPepeTheme?.get() || "dark");
    scene.update(state);
    scene.setActive(true);
    scene.setQuality("high");
    await activeScene.ready;
    if (activeScene.failed) host.querySelector(".map-preview")?.remove();
    if (scene === activeScene && host.isConnected && !activeScene.failed) {
      openWarehouseScene();
    }
  } catch {
    if (host.isConnected) {
      host.innerHTML = '<p class="map-load-status" role="status">No se pudo abrir el mapa. <button type="button" class="btn secondary">Volver a cargar</button></p>';
      host.querySelector("button").onclick = () => location.reload();
    }
  } finally {
    if (!scene || scene.failed) host.removeAttribute("aria-busy");
  }
}
function renderStoreOverview() {
  const pending = state.orders.filter(
    (o) =>
      ![
        "RECEIVED",
        "RECEIVED_WITH_DIFFERENCE",
        "CANCELLED",
        "CANCELLED_AFTER_PREPARATION",
      ].includes(o.status),
  );
  main.innerHTML =
    `<section class="store-welcome">${branch(user.branchId).imageUrl ? photo(branch(user.branchId), "store-cover") : ""}<div><span class="eyebrow">${user.role === "store" ? "MI TIENDA" : "RESUMEN AUTORIZADO"}</span><h1>${esc(user.role === "store" ? branch(user.branchId).name : "Resumen de operaciones")}</h1><p>Solicitudes, entregas y productos recibidos en tu sucursal.</p></div><div class="heading-actions">${canOrder() ? button("Solicitar productos +", "new-order") : ""}<a class="btn secondary" href="#inventory">Ver mis existencias</a></div></section>` +
    `<div class="metric-row">${metric("Cajas recibidas", state.metrics.storeCases, "Existencias confirmadas", "package")}${metric("Pedidos abiertos", pending.length, "En preparación o entrega", "truck")}${metric("Por recibir", state.orders.filter((o) => o.status === "ARRIVED").length, "Vehículos en destino", "store")}</div><section class="panel"><div class="section-heading"><h2>Seguimiento de entregas</h2><a href="#orders">Todos los pedidos →</a></div><div class="order-grid">${
      pending
        .slice(-6)
        .reverse()
        .map(
          (o) =>
            `<article class="document-card"><div class="card-top"><span>${esc(o.id)}</span>${badge(o.status)}</div>${branchMedia(o.branchId)}<h2>${esc(branch(o.branchId).name)}</h2><p>${o.lines.reduce((n, l) => n + l.cases, 0)} cajas</p>${button(o.status === "ARRIVED" ? "Revisar recepción" : "Seguir entrega", "open-order", "secondary wide", `data-id="${esc(o.id)}"`)}</article>`,
        )
        .join("") ||
      empty(
        "No tienes entregas pendientes",
        "Crea un pedido para abastecer tu sucursal.",
      )
    }</div></section><div class="store-quick-actions"><a href="#orders">${icon("truck")}<span><strong>Mis solicitudes</strong><small>Consulta cada etapa de entrega</small></span></a><a href="#inventory">${icon("package")}<span><strong>Mis existencias</strong><small>Solo mercancía ya recibida</small></span></a><a href="#stores">${icon("store")}<span><strong>Recepciones y devoluciones</strong><small>Confirma cantidades y diferencias</small></span></a></div><section class="panel store-catalog-panel"><div class="section-heading"><h2>Productos para mi tienda</h2><span class="muted" id="store-catalog-count"></span></div><div class="document-toolbar"><label class="search-field">${icon("search")}<input id="store-catalog-search" type="search" value="${esc(storeCatalogFilters.query)}" placeholder="Producto, marca o código de barras…" aria-label="Buscar productos"></label><select id="store-catalog-category" aria-label="Filtrar por categoría"><option value="all">Todas las categorías</option>${[
      ...new Set(
        state.catalog.skus
          .filter((s) => s.active !== false)
          .map((s) => s.category)
          .filter(Boolean),
      ),
    ]
      .sort()
      .map(
        (c) =>
          `<option ${storeCatalogFilters.category === c ? "selected" : ""}>${esc(c)}</option>`,
      )
      .join(
        "",
      )}</select></div><div class="store-grid" id="store-product-grid"></div><div class="catalog-pagination" id="store-catalog-pagination"></div></section>`;
  function catalogPage() {
    const query = storeCatalogFilters.query.trim().toLocaleLowerCase("es");
    const list = state.catalog.skus.filter(
      (s) =>
        s.active !== false &&
        (storeCatalogFilters.category === "all" ||
          s.category === storeCatalogFilters.category) &&
        `${s.name} ${s.brand} ${s.barcode || ""}`
          .toLocaleLowerCase("es")
          .includes(query),
    );
    const pages = Math.max(1, Math.ceil(list.length / 12));
    storeCatalogFilters.page = Math.min(
      pages,
      Math.max(1, storeCatalogFilters.page),
    );
    $("#store-catalog-count").textContent = `${list.length} productos`;
    $("#store-product-grid").innerHTML =
      list
        .slice(
          (storeCatalogFilters.page - 1) * 12,
          storeCatalogFilters.page * 12,
        )
        .map((s) => {
          const stock = state.inventory.storeStock
            .filter((x) => x.skuId === s.id)
            .reduce((n, x) => n + x.cases, 0);
          const requested = pending.reduce(
            (n, o) =>
              n +
              o.lines
                .filter((l) => l.skuId === s.id)
                .reduce((a, l) => a + l.cases, 0),
            0,
          );
          return `<article class="store-product">${photo(s)}<span class="eyebrow">${esc(s.brand || s.category || "Producto")}</span><h3>${esc(skuName(s))}</h3><small>${esc(s.presentation || s.caseLabel || "")} · ${num(s.unitsPerCase)} un./caja</small><div class="stock-amount"><strong>${num(stock)}</strong><small>cajas en tienda</small></div>${requested ? `<small>${num(requested)} cajas solicitadas en curso</small>` : ""}${canOrder() ? button("Solicitar", "new-order", "secondary small", `data-sku="${esc(s.id)}"`) : ""}</article>`;
        })
        .join("") ||
      empty("No hay coincidencias", "Prueba otra marca, categoría o nombre.");
    $("#store-catalog-pagination").innerHTML =
      `<button class="btn secondary small" id="store-page-prev" ${storeCatalogFilters.page === 1 ? "disabled" : ""}>← Anterior</button><span aria-live="polite">Página ${storeCatalogFilters.page} de ${pages}</span><button class="btn secondary small" id="store-page-next" ${storeCatalogFilters.page === pages ? "disabled" : ""}>Siguiente →</button>`;
    $("#store-page-prev").onclick = () => {
      storeCatalogFilters.page--;
      catalogPage();
      $("#store-catalog-search").focus({ preventScroll: true });
    };
    $("#store-page-next").onclick = () => {
      storeCatalogFilters.page++;
      catalogPage();
      $("#store-catalog-search").focus({ preventScroll: true });
    };
  }
  $("#store-catalog-search").oninput = (e) => {
    storeCatalogFilters.query = e.target.value;
    storeCatalogFilters.page = 1;
    catalogPage();
  };
  $("#store-catalog-category").onchange = (e) => {
    storeCatalogFilters.category = e.target.value;
    storeCatalogFilters.page = 1;
    catalogPage();
  };
  catalogPage();
}
function searchMap(value) {
  const target = $("#map-results"),
    query = value.trim().toLowerCase();
  if (!query) {
    target.hidden = true;
    return;
  }
  const items = searchMapEntities(state, query, {
    statusLabel: status,
    productName: item => skuName(item || {}),
  });
  target.hidden = false;
  target.innerHTML =
    items
      .map(
        (item) =>
          `<button data-inspect="${item.type}" data-id="${esc(item.id)}"><strong>${esc(item.title)}</strong><small>${esc(item.detail)}</small></button>`,
      )
      .join("") || "<p>No se encontraron elementos con esa referencia.</p>";
}
function metric(label, value, note, ic = "layers", cls = "") {
  return `<article class="metric ${cls}"><span class="metric-icon">${icon(ic)}</span><div><span>${esc(label)}</span><strong>${num(value)}</strong><small>${esc(note)}</small></div></article>`;
}
function orderPhase(order) {
  if (!order) return -1;
  return (
    {
      PENDING: 0,
      PREPARING: 1,
      READY: 2,
      LOADING: 3,
      DISPATCHED: 4,
      IN_TRANSIT: 4,
      ARRIVED: 4,
      RECEIVED: 5,
      RECEIVED_WITH_DIFFERENCE: 5,
    }[order.status] ?? -1
  );
}
function loadingSummary(order) {
  const load = order?.loading;
  if (!load) return "";
  const completed = Number(load.loadedLoads) || 0;
  const total = Number(load.totalLoads) || 0;
  return `${completed}/${total} palés a bordo · ${status(load.phase)}`;
}
function loadingHeadline(order) {
  if (order?.loading?.blockedReason) return "La carga requiere atención";
  if (order?.loading?.rejecting) return "Recuperando la mercancía retenida";
  if (
    ["OPENING_REJECTION", "UNLOADING_REJECTION"].includes(order?.loading?.phase)
  )
    return "Descarga de retención en curso";
  return "Carga automática en curso";
}
function watchOrder(id) {
  trackedOrderId = id;
  dialog.close();
  if (!can("map.view")) {
    render();
    return;
  }
  if (view !== "overview") {
    location.hash = "overview";
    navigate();
  }
  const order = state.orders.find((o) => o.id === id);
  if (order?.truckId) selected = { type: "truck", id: order.truckId };
  openWarehouseScene(requestedMapView, selected);
  updateOverview();
}
function renderLogisticsPanels() {
  trackedOrderId = inspectionOrderId(state, selected, trackedOrderId);
  const current =
    state.orders.find((o) => o.id === trackedOrderId) ||
    state.orders.find((o) => o.status === "LOADING") ||
    state.orders.find((o) =>
      ["DISPATCHED", "ARRIVED", "READY", "PREPARING"].includes(o.status),
    ) ||
    state.orders.find((o) => o.status === "PENDING") ||
    state.orders.at(-1);
  const phase = orderPhase(current);
  setContent(
    "#shipment-tracking",
    current
      ? `<div class="shipment-head"><span class="shipment-symbol">${icon("truck")}</span><strong>Seguimiento del envío</strong><small>${esc(current.truckId || current.id)}</small><button class="icon-button" data-action="open-order" data-id="${esc(current.id)}" aria-label="Revisar ${esc(current.id)}">↗</button></div><div class="shipment-track-body"><ol class="shipment-steps">${["Pedido", "Preparación", "Muelle", "Carga", "En ruta", "Recibido"].map((label, index) => `<li class="${index < phase ? "complete" : index === phase ? "current" : ""}" ${index === phase ? 'aria-current="step"' : ""}><b>${index < phase ? "✓" : icon(["clipboard", "package", "layers", "arrows", "truck", "store"][index])}</b><span>${label}</span></li>`).join("")}</ol><button class="shipment-destination" data-action="open-order" data-id="${esc(current.id)}"><span class="shipment-destination-icon">${icon("truck")}</span><span><strong>${esc(current.id)}</strong><small>A ${esc(branch(current.branchId).name)}</small>${badge(current.status)}<small>${num(current.lines.reduce((n, line) => n + line.cases, 0))} cajas${current.loading && current.status === "LOADING" ? ` · ${num(current.loading.loadedLoads)} / ${num(current.loading.totalLoads)} palés` : ""}</small></span></button></div>${current.loading && current.status === "LOADING" ? `<div class="loading-meter"><span>${esc(loadingSummary(current))}</span><progress max="${Math.max(1, current.loading.totalLoads || 0)}" value="${current.loading.loadedLoads || 0}" aria-label="Palés cargados"></progress></div>` : ""}`
      : `<div class="shipment-head"><span class="shipment-symbol">${icon("truck")}</span><strong>Seguimiento de envíos</strong></div><div class="shipment-empty">Sin pedidos activos.</div>`,
  );
  $$("[data-resource-tab]").forEach((tab) => {
    const active = tab.dataset.resourceTab === resourceTab;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  $("#resource-list")?.setAttribute(
    "aria-labelledby",
    `resource-tab-${resourceTab}`,
  );
  const row = (type, id, title, detail, value, symbol, progress = null) =>
    `<button class="resource-row" data-inspect="${type}" data-id="${esc(id)}"><span class="resource-symbol">${icon(symbol)}</span><span class="resource-description"><strong>${esc(title)}</strong><small>${esc(detail)}</small></span><span class="resource-state">${badge(value)}${progress == null ? "" : `<progress max="1" value="${Math.min(1, Math.max(0, progress))}" aria-label="Progreso de ${esc(title)}"></progress>`}</span><span class="resource-arrow">›</span></button>`;
  let html;
  if (resourceTab === "docks")
    html = ["DOCK-1", "DOCK-2"]
      .map((id, index) => {
        const truck = state.equipment.trucks.find(
          (t) =>
            t.dockId === id &&
            !["AVAILABLE", "OUTBOUND", "AT_STORE", "RETURNING"].includes(
              t.status,
            ),
        );
        const order = state.orders.find((o) => o.id === truck?.orderId);
        const staged = allHus().filter(
          (h) => h.locationId === id && h.cases > 0,
        );
        return row(
          "station",
          id,
          `Muelle ${index + 1}`,
          truck
            ? `${truck.id} · ${order?.id || "Carga"}`
            : `${staged.length} palés en espera`,
          truck?.status || "AVAILABLE",
          "package",
          order?.loading
            ? order.loading.loadedLoads / Math.max(1, order.loading.totalLoads)
            : null,
        );
      })
      .join("");
  else if (resourceTab === "robots")
    html = state.equipment.robots
      .map((r) =>
        row(
          "robot",
          r.id,
          r.name || r.id,
          r.type === "FORKLIFT"
            ? `Montacargas · ${r.dockId || "Patio"}`
            : r.type === "AMR"
              ? "Transporte autónomo"
              : r.type === "STACKER"
                ? "Transelevador de racks"
                : "Transferencia automática",
          r.status,
          "arrows",
        ),
      )
      .join("") + (state.autonomyConfiguration?.assets || []).map((asset) => {
        const device = state.autonomy?.map?.devices?.find(item => item.assetId === asset.id);
        return row("asset", asset.id, asset.name,
          asset.branchId ? branch(asset.branchId).name : "Línea automática",
          device?.blocked ? "BLOCKED" : device?.moving ? "WORKING" : device?.processId ? "WAITING" : asset.readiness?.ready ? "AVAILABLE" : "BLOCKED", "layers");
      }).join("");
  else
    html = state.equipment.trucks
      .map((t) =>
        row(
          "truck",
          t.id,
          t.name || t.id,
          t.branchId ? branch(t.branchId).name : "Centro de distribución",
          t.status,
          "truck",
          t.trip &&
            ["OUTBOUND", "RETURNING", "RETURN_PICKUP", "RETURN_CARGO"].includes(
              t.status,
            )
            ? t.progress
            : null,
        ),
      )
      .join("");
  setContent(
    "#resource-list",
    html || '<p class="resource-empty">Sin recursos registrados.</p>',
  );
}
function updateOverview() {
  const active = activeMissions(),
    ready = state.orders.filter((x) => x.status === "READY"),
    moving = state.equipment.robots.filter(
      (x) => !["IDLE", "CHARGING", "FAULT"].includes(x.status),
    );
  const automatic = (state.autonomy?.map?.devices || []).filter(device => device.processId && !device.blocked && device.phaseDuration > 0);
  const next =
    state.orders.find((o) => o.status === "LOADING") ||
    state.orders.find((o) => o.status === "READY") ||
    state.orders.find((o) => o.status === "PENDING");
  const occupiedIds = new Set(
    allHus()
      .filter((hu) => hu.cases > 0)
      .map((hu) => hu.locationId),
  );
  const occupied = state.layout.locations.filter((location) =>
    occupiedIds.has(location.id),
  ).length;
  if ($("#console-site-occupancy"))
    $("#console-site-occupancy").textContent =
      `${num(state.layout.locations.length ? (occupied / state.layout.locations.length) * 100 : 0)} % ocupado`;
  setContent(
    "#next-action",
    next
      ? `<div class="next-action"><span class="next-action-icon">${next.loading?.blockedReason ? "!" : next.status === "LOADING" ? "↑" : "↗"}</span><div><strong>${next.status === "LOADING" ? esc(loadingHeadline(next)) : next.status === "READY" ? "Preparado para cargar el camión" : "Autoriza el siguiente pedido"}</strong><span>${next.status === "LOADING" ? esc(loadingSummary(next)) : esc(branch(next.branchId).name)}</span></div>${button(next.status === "PENDING" && isOps() ? "Revisar" : next.status === "READY" ? "Despachar" : "Ver carga", "open-order", "small secondary", `data-id="${esc(next.id)}"`)}</div>`
      : "",
  );
  setContent(
    "#overview-metrics",
    metric(
      "Stock en el centro",
      state.metrics.warehouseCases,
      "Cajas registradas",
      "package",
    ) +
      metric(
        "Trabajo en curso",
        active.length + automatic.length,
        `${moving.length + automatic.filter(device => device.moving).length} equipos trabajando`,
        "arrows",
        "purple",
      ) +
      metric(
        "Listos para salir",
        ready.length,
        "Pedidos en muelle",
        "truck",
        "gold",
      ),
  );
  $("#simulation-toggle").textContent = state.clock.paused
    ? "▶ Reanudar"
    : "Ⅱ Pausar";
  $("#simulation-speed").value = String(state.clock.speed);
  const alerts =
    state.incidents?.length ||
    state.equipment.robots.filter((r) => r.status === "FAULT").length;
  $("#map-alert-link span").textContent = alerts
    ? `${alerts} incidencias`
    : "Sin incidencias";
  $("#map-alert-link").classList.toggle("has-alerts", alerts > 0);
  $("#map-alert-link").hidden = !isOps();
  $("#mission-count").textContent = active.length;
  setContent(
    "#mission-list",
    active
      .slice(0, 4)
      .map(
        (m) =>
          `<button class="mission-row" data-inspect="mission" data-id="${esc(m.id)}"><span class="mission-symbol">${icon("arrows")}</span><div><strong>${esc(m.label || m.type || "Traslado automático")}</strong><small>${esc(skuName(sku(m.skuId)))} · ${num(m.cases)} cajas</small><div class="progress-line"><i style="width:${Math.max(4, Math.min(100, Number(m.progress || 0) * 100))}%"></i></div></div><span>${badge(m.status)}<small>${esc(m.robotId || m.equipmentId || "Buscando equipo")}</small></span></button>`,
      )
      .join("") ||
      empty(
        "Todo está en orden",
        "Las operaciones liberadas aparecerán aquí.",
        canOrder()
          ? button("Crear un pedido", "new-order", "secondary small")
          : "",
      ),
  );
  setContent(
    "#event-list",
    state.events
      .slice(-5)
      .reverse()
      .map(
        (e) =>
          `<div class="event-row"><span class="event-dot"></span><div><strong>${esc(e.message || e.label || e.type)}</strong><small>${esc(e.actorName || e.actor || "Motor de simulación")}</small></div><time>${esc(eventTime(e.at ?? e.time ?? e.timestamp))}</time></div>`,
      )
      .join("") ||
      '<p class="muted pad">Tu operación todavía no tiene eventos.</p>',
  );
  renderLogisticsPanels();
  renderInspector();
}
function eventTime(value) {
  if (value == null) return "";
  if (typeof value === "number" && value < 1e11)
    return `${num(Math.floor(value / 60))} min`;
  const d = new Date(value);
  return Number.isNaN(+d)
    ? ""
    : new Intl.DateTimeFormat("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Lima",
      }).format(d);
}
function renderInspector() {
  const el = $("#map-inspector");
  if (!el || !selected) return;
  el.hidden = false;
  const { type, id } = selected;
  const inspectionKey=`${type}:${id}`;
  if(el.dataset.inspectedKey!==inspectionKey){el.dataset.inspectedKey=inspectionKey;el.dataset.expanded="false";}
  let title = id,
    subtitle = "",
    details = "",
    actions = "";
  if (type === "warehouse") {
    title = "Centro de distribución";
    subtitle = "DONPEPE · CD1";
    details =
      infoRow("Zonas", num(state.layout.zones.length)) +
      infoRow("Ubicaciones", num(state.layout.locations.length)) +
      infoRow("Cajas registradas", num(state.metrics.warehouseCases)) +
      infoRow("Destinos", `${state.catalog.branches.length} minimarkets`);
    actions =
      '<button class="btn primary small" data-action="enter-warehouse">Explorar interior</button>';
  } else if (["robot", "equipment"].includes(type)) {
    const r = state.equipment.robots.find((x) => x.id === id);
    if (!r) return;
    title = r.name || r.id;
    subtitle = ({ FORKLIFT:"Montacargas autónomo",AMR:"Robot móvil autónomo",STACKER:"Transelevador automático",SHUTTLE:"Carro de transferencia" })[r.type] || "Equipo automático";
    details =
      infoRow("Estado", status(r.status)) +
      infoRow(
        r.battery == null ? "Alimentación" : "Batería",
        r.battery == null ? "Red eléctrica" : `${num(r.battery)} %`,
      ) +
      infoRow("Misión", r.missionId || "Disponible") +
      infoRow("Carga", r.carryingHuId || r.huId || r.loadId || "Sin carga") +
      (r.dockId ? infoRow("Muelle", r.dockId) : "") +
      (r.orderId ? infoRow("Pedido", r.orderId) : "");
    if (r.contact?.reason) details += `<div class="notice warning">${esc(r.contact.reason)}</div>`;
    actions = isOps()
      ? button(
          r.status === "FAULT" ? "Recuperar equipo" : "Simular incidencia",
          r.status === "FAULT" ? "recover-equipment" : "fault-equipment",
          "secondary small",
          `data-id="${esc(id)}"`,
        )
      : "";
  } else if (type === "asset") {
    const asset = state.catalog.assets?.find((item) => item.id === id);
    const operational = state.autonomyConfiguration?.assets?.find((item) => item.id === id);
    if (!asset || !operational) return;
    title = asset.name;
    subtitle = asset.model || "Equipo de automatización";
    const device = state.autonomy?.map?.devices?.find((item) => item.assetId === id);
    const processLabels = { UNLOADING: "Descargando proveedor", IDENTIFYING: "Verificando identidad", INSPECTING: "Inspeccionando carga", RECEIVING: "Transfiriendo a recepción", CASE_PICKING: "Preparando cajas", DESTINATION_RECEIVING: "Recibiendo en tienda" };
    const functions = {
      AUTO_UNLOADER: "Descarga de remolques compatibles con control del muelle",
      AUTO_ID_GATE: "Lectura de etiqueta logística, producto, lote y vencimiento",
      PIE_STATION: "Comprobación de peso, dimensiones, embalaje y evidencia de temperatura",
      INBOUND_CONVEYOR: "Transferencia y acumulación de cargas con destino reservado",
      CASE_PICKING_CELL: "Selección de cajas cerradas, separación de carga y etiquetado",
      STORE_RECEIVING_STATION: "Descarga, identificación y conciliación de la entrega",
    };
    const readiness = device?.blocked ? device.reason || "Proceso retenido" : device?.moving ? (state.clock.paused ? "En pausa" : processLabels[device.stage] || "En proceso") : operational.readiness?.ready ? "Disponible" : operational.readiness?.reason || "Retenido";
    details = infoRow("Estado", readiness) +
      infoRow("Asignación", asset.branchId ? branch(asset.branchId).name : "Centro de distribución") +
      infoRow("Identificación", asset.deviceId) +
      infoRow("Funciones", functions[asset.type] || "Automatización configurada según las reglas del equipo");
    if (asset.type === "INBOUND_CONVEYOR") details += infoRow("Recorrido de recepción", device?.stage === "RECEIVING" && device.phaseDuration ? `${num(device.phaseDuration)} segundos en este proceso` : "Mínimo mecánico de 75 segundos en nuevas autorizaciones");
    actions = can("maintenance.read") ? button("Consultar reglas", "equipment-rules", "secondary small", `data-id="${esc(id)}"`) : "";
    const visualJob = state.autonomy?.map?.jobs?.find((job) => job.assetId === id || job.activeAssetId === id);
    if (visualJob) actions += button("Ver proceso", "view-autonomy-job", "primary small", `data-id="${esc(visualJob.id)}"`);
  } else if (type === "branch") {
    const b = branch(id);
    title = b.name;
    subtitle = b.address || "Minimarket DonPepe";
    const own = state.inventory.storeStock.filter((x) => x.branchId === id);
    details =
      infoRow("Cajas registradas", num(own.reduce((n, x) => n + qty(x), 0))) +
      infoRow(
        "Pedidos",
        num(state.orders.filter((o) => o.branchId === id).length),
      );
    actions = canOrder()
      ? button(
          "Abastecer tienda",
          "new-order",
          "primary small",
          `data-branch="${esc(id)}"`,
        )
      : "";
  } else if (type === "mission") {
    const m = state.missions.find((x) => x.id === id);
    if (!m) return;
    title = m.label || m.type;
    subtitle = m.id;
    details =
      infoRow("Estado", status(m.status)) +
      infoRow("Producto", skuName(sku(m.skuId))) +
      infoRow("Cajas", num(m.cases)) +
      infoRow(
        "Equipo",
        m.robotId || m.equipmentId || "Esperando disponibilidad",
      );
  } else if (type === "hu") {
    const h = allHus().find((x) => x.id === id);
    if (!h) return;
    title = skuName(sku(h.skuId));
    subtitle = h.id;
    details =
      infoRow("Cajas", num(h.cases)) +
      infoRow("Lote", h.lot) +
      infoRow("Vencimiento", h.expiry || "No aplica") +
      infoRow("Estado", status(h.status)) +
      (h.packagingDefect ? infoRow("Daño detectado", packagingQuality.defectLabel(h.packagingDefect)) : "") +
      infoRow("Ubicación", h.locationLabel || locationName(h.locationId || h.robotId));
  } else if (type === "truck") {
    const t = state.equipment.trucks.find((x) => x.id === id);
    if (!t) return;
    title = t.name || id;
    subtitle = "Transporte a tiendas";
    details =
      infoRow("Estado", status(t.status)) +
      infoRow("Pedido", t.orderId || "Sin carga") +
      infoRow(
        "Destino",
        t.branchId ? branch(t.branchId).name : "Centro de distribución",
      ) +
      (t.dockId ? infoRow("Muelle", t.dockId) : "") +
      (t.orderId
        ? infoRow(
            "Palés cargados",
            String((t.loadPositions || []).filter((p) => p.huId).length),
          )
        : "") +
      (t.loadingState ? infoRow("Carga del remolque", status(t.loadingState)) : "");
    if (t.contact?.reason) details += `<div class="notice warning">${esc(t.contact.reason)}</div>`;
    const availability = state.fleetReadModels?.find(
      (truck) => truck.truckId === id,
    );
    if (availability?.reason)
      details += `<div class="notice ${availability.available ? "success" : "warning"}">${esc(availability.reason)}</div>`;
    if (t.orderId)
      actions = button(
        "Seguir pedido",
        "open-order",
        "secondary small",
        `data-id="${esc(t.orderId)}"`,
      );
  } else {
    const collections = {
      zone: state.layout.zones,
      rack: state.layout.racks,
      loc: state.layout.locations,
      location: state.layout.locations,
      station: state.layout.stations,
    };
    const item = collections[type]?.find((x) => x.id === id);
    if (item) {
      title = item.name || item.label || item.code || id;
      subtitle =
        type === "zone"
          ? "Zona del almacén"
          : type === "rack"
            ? "Almacenamiento automático"
            : "Infraestructura operativa";
      details =
        infoRow("Referencia", item.code || item.id) +
        (item.description ? infoRow("Ubicación completa", item.description) : "") +
        infoRow("Uso", item.type || item.zoneId || "Logística") +
        (item.temperature !== undefined
          ? infoRow(
              "Temperatura",
              typeof item.temperature === "number"
                ? `${item.temperature} °C`
                : item.temperature,
            )
          : "");
      if (type === "station" && id.startsWith("DOCK-")) {
        const truck = state.equipment.trucks.find(
          (t) =>
            t.dockId === id &&
            !["AVAILABLE", "OUTBOUND", "AT_STORE", "RETURNING"].includes(
              t.status,
            ),
        );
        const loader = state.equipment.robots.find(
          (r) => r.type === "FORKLIFT" && r.dockId === id,
        );
        subtitle = "Muelle de carga";
        title = `Muelle ${id.split("-").at(-1)}`;
        details =
          infoRow("Estado", truck ? status(truck.status) : "Disponible") +
          infoRow("Camión", truck?.id || "Sin asignar") +
          infoRow("Montacargas", loader?.id || "No disponible") +
          infoRow("Pedido", truck?.orderId || "Sin asignar");
        if (truck?.orderId)
          actions = button(
            "Ver carga del pedido",
            "open-order",
            "secondary small",
            `data-id="${esc(truck.orderId)}"`,
          );
      }
      if (["loc", "location"].includes(type) && isOps())
        actions = button(
          item.blocked ? "Habilitar ubicación" : "Bloquear ubicación",
          "block-location",
          "secondary small",
          `data-id="${esc(id)}" data-blocked="${!item.blocked}"`,
        );
    }
  }
  setContent(
    "#map-inspector",
    `<div class="inspector-head"><span class="inspector-symbol">${icon(type === "truck" ? "truck" : type === "warehouse" ? "grid" : type === "branch" ? "store" : type === "robot" || type === "equipment" ? "arrows" : "package")}</span><div><span class="eyebrow">${esc(subtitle)}</span><h2>${esc(title)}</h2></div><button type="button" class="text-button inspection-toggle" data-action="toggle-inspection-details" aria-expanded="${el.dataset.expanded==="true"}">${el.dataset.expanded==="true" ? "Ocultar" : "Detalles"}</button><button class="icon-button" data-action="close-inspector" aria-label="Cerrar inspección">×</button></div>${mapReferenceMarkup(state, selected)}<div class="inspector-details">${details}</div>${actions}`,
  );
}
function revealInspection() {
  const stage = $(".diorama-stage");
  if (stage?.classList.contains("map-focus")) {
    stage.classList.remove("map-focus");
    $("[data-action=map-focus]")?.setAttribute("aria-pressed", "false");
    $("[data-action=map-focus]")?.setAttribute("aria-label", "Despejar mapa");
  }
}

function renderOrders() {
  main.innerHTML =
    pageHeading(
      "ABASTECIMIENTO DE TIENDAS",
      "Pedidos de abastecimiento",
      isOps()
        ? "Revisa las solicitudes de cada tienda y autoriza su preparación."
        : "Solicita productos y consulta la preparación, el transporte y la recepción.",
      canOrder()
        ? button("+ Solicitar productos", "new-order")
        : "",
    ) +
    `${fleetSummary()}<div class="document-toolbar"><label class="search-field">${icon("search")}<input id="orders-search" type="search" value="${esc(orderFilters.query)}" placeholder="Buscar tienda o producto…" aria-label="Buscar solicitudes"></label><select id="orders-status" aria-label="Estado de solicitud">${[
      ["all", "Todos los estados"],
      ["PENDING", "Por revisar"],
      ["PREPARING", "Preparación"],
      ["READY", "Listos para cargar"],
      ["LOADING", "Cargando"],
      ["DISPATCHED", "En camino"],
      ["ARRIVED", "Por recibir"],
      ["RECEIVED", "Recibidos"],
      ["CANCELLED", "Cancelados"],
    ]
      .map(
        ([value, label]) =>
          `<option value="${value}" ${orderFilters.status === value ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></div><section class="panel"><div class="section-heading"><h2>${isOps() ? "Solicitudes de las tiendas" : "Mis solicitudes"}</h2><span class="muted" id="orders-count">${state.orders.length} solicitudes</span></div><div class="order-grid">${
    newestFirst(state.orders)
        .map(
          (o) =>
            `<article class="document-card" data-order-state="${esc(o.status)}" data-order-search="${esc((branch(o.branchId).name + " " + o.id + " " + o.lines.map((l) => skuName(sku(l.skuId))).join(" ")).toLowerCase())}"><div class="card-top"><span class="document-code">${esc(o.code || o.id)}</span>${badge(o.status)}</div>${branchMedia(o.branchId)}<h2>${esc(branch(o.branchId).name)}</h2><span class="source-tag">${requestOrigin(o)}</span><p>${num(o.lines.reduce((n, l) => n + l.cases, 0))} cajas · ${o.lines.length} productos</p><div class="document-products">${o.lines
              .slice(0, 3)
              .map(
                (l) =>
                  `<span>${photo(sku(l.skuId), "document-product-image")}${esc(skuName(sku(l.skuId)))} <b>${num(l.cases)}</b></span>`,
              )
              .join(
                "",
              )}</div><button class="btn secondary wide" data-action="open-order" data-id="${esc(o.id)}">Seguir pedido <span>↗</span></button></article>`,
        )
        .join("") ||
      empty(
        "No hay solicitudes pendientes",
        isOps()
          ? "Las solicitudes aparecerán cuando una tienda las envíe. También puedes generar una solicitud de simulación."
          : "Solicita los productos que necesita tu sucursal.",
      )
    }</div><div class="empty-state" id="orders-filter-empty" hidden><h3>No se encontraron solicitudes</h3><p>Cambia el texto o el estado seleccionado.</p></div></section>`;
  function filter() {
    const q = orderFilters.query.trim().toLowerCase();
    let count = 0;
    $$("[data-order-state]").forEach((card) => {
      const matchState =
        orderFilters.status === "all" ||
        card.dataset.orderState === orderFilters.status ||
        (orderFilters.status === "RECEIVED" &&
          card.dataset.orderState === "RECEIVED_WITH_DIFFERENCE") ||
        (orderFilters.status === "CANCELLED" &&
          card.dataset.orderState === "CANCELLED_AFTER_PREPARATION");
      card.hidden = !(matchState && card.dataset.orderSearch.includes(q));
      if (!card.hidden) count++;
    });
    $("#orders-count").textContent = `${count} solicitudes`;
    $("#orders-filter-empty").hidden = count > 0 || !state.orders.length;
  }
  $("#orders-search").oninput = (e) => {
    orderFilters.query = e.target.value;
    filter();
  };
  $("#orders-status").onchange = (e) => {
    orderFilters.status = e.target.value;
    filter();
  };
  filter();
}
function orderDialog(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return;
  const dispatch = state.orderReadModels?.find(
    (model) => model.orderId === id,
  )?.dispatch;
  const index = orderPhase(o);
  const loading =
    o.loading && o.status === "LOADING"
      ? `<div class="notice"><strong>${esc(loadingSummary(o))}</strong><p>${o.loading.rejecting ? "La mercancía vuelve físicamente al muelle y después a cuarentena. Este pedido no viajará a la tienda." : o.loading.phase === "QUALITY_HOLD" ? "La salida está bloqueada. Revisa la incidencia y retén la preparación para descargar la mercancía de forma segura." : `El camión espera en ${esc(o.loading.dockId)}. La salida se autoriza automáticamente cuando todos los palés estén cargados y el acceso esté cerrado.`}</p><progress class="order-load-progress" value="${o.loading.loadedLoads || 0}" max="${Math.max(1, o.loading.totalLoads || 0)}" aria-label="Palés a bordo"></progress>${button("Ver carga en el mapa", "watch-order", "primary small", `data-id="${esc(id)}"`)}</div>`
      : "";
  showDialog(
    branch(o.branchId).name,
    `${branchContext(o.branchId)}<div class="dialog-summary">${badge(o.status)}<span>${esc(o.code || o.id)}</span><span class="source-tag">${requestOrigin(o)}</span></div>${operationMeta(o)}
    ${loading}
    ${o.loading?.blockedReason ? `<div class="notice warning" role="status">${esc(o.loading.blockedReason)}</div>` : ""}
    <div class="line-items">${o.lines.map((l) => `<div><span>${photo(sku(l.skuId), "document-product-image")}${esc(skuName(sku(l.skuId)))}</span><strong>${num(l.cases)} cajas</strong></div>`).join("")}</div>
    ${o.blockedReason || o.cancelReason || o.reason ? `<div class="notice warning">${esc(o.blockedReason || o.cancelReason || o.reason)}</div>` : ""}
    ${o.notes ? `<div class="notice"><strong>Nota de la tienda</strong><p>${esc(o.notes)}</p></div>` : ""}
    ${o.requestedByDate ? infoRow("Fecha requerida", formatCalendarDate(o.requestedByDate)) : ""}
    ${autonomyDocument("ORDER", id)}
    ${orderInsight(o)}
    ${isOps() && o.status === "READY" && dispatch?.blockedReason ? `<div class="notice warning"><strong>Despacho pendiente</strong><p>${esc(dispatch.blockedReason)}</p>${button("Consultar vehículos", "fleet-status", "secondary small")}</div>` : ""}
    ${can("order.priority") && ["PENDING", "PREPARING"].includes(o.status) ? `<label>Prioridad de preparación<select id="order-priority" data-order="${esc(id)}"><option value="LOW" ${o.priority === "LOW" ? "selected" : ""}>Baja</option><option value="NORMAL" ${o.priority === "NORMAL" ? "selected" : ""}>Normal</option><option value="HIGH" ${o.priority === "HIGH" ? "selected" : ""}>Alta</option></select></label><p class="field-hint">Reordena misiones pendientes; no interrumpe una carga ya recogida.</p>` : ""}
    <p class="muted">${state.autonomy ? "La autorización inicia preparación, carga, transporte y recepción automática. Una excepción detiene el proceso sin aceptar mercancía no verificada." : o.status === "READY" ? "Despachar inicia el acoplamiento y la carga automática. El camión no sale hasta completar la verificación." : "La salida del centro y la recepción en tienda son hechos distintos."}</p>
    <div class="dialog-actions">
      ${can("order.release") && o.status === "PENDING" ? button(state.autonomy ? "Autorizar abastecimiento autónomo" : "Liberar preparación", "release-order", "primary", `data-id="${esc(id)}"`) : ""}
      ${can("order.edit") && o.status === "PENDING" ? button("Modificar solicitud", "edit-order", "secondary", `data-id="${esc(id)}"`) : ""}
      ${can("order.create") ? button("Volver a solicitar", "repeat-order", "secondary", `data-id="${esc(id)}"`) : ""}
      ${!state.autonomy && can("order.dispatch") && o.status === "READY" ? button("Despachar a tienda", "dispatch-order", "primary", `data-id="${esc(id)}" ${dispatch?.canDispatch === false ? 'disabled aria-disabled="true"' : ""}`) : ""}
      ${!state.autonomy && o.status === "ARRIVED" && can("order.receive") ? button("Confirmar recepción", "receive-order", "primary", `data-id="${esc(id)}"`) : ""}
      ${can("order.cancel") && ((isOps() && ["PENDING", "PREPARING"].includes(o.status)) || (user.role === "store" && o.status === "PENDING")) ? button("Cancelar pedido", "cancel-order", "danger-ghost", `data-id="${esc(id)}"`) : ""}
      ${["RECEIVED", "RECEIVED_WITH_DIFFERENCE"].includes(o.status) && can("return.create") ? button("Registrar devolución", "new-return", "secondary", `data-id="${esc(id)}"`) : ""}
      ${(o.status === "READY" || (o.status === "LOADING" && o.loading?.phase === "QUALITY_HOLD")) && can("order.rejectPrepared") ? button("Retener preparación", "reject-prepared", "danger-ghost", `data-id="${esc(id)}"`) : ""}
      ${can("map.view") && ["PREPARING", "READY", "DISPATCHED", "ARRIVED"].includes(o.status) ? button("Seguir en el mapa", "watch-order", "secondary", `data-id="${esc(id)}"`) : ""}
    </div>`,
    `PEDIDO · ${o.code || o.id}`,
  );
  $("#order-priority")?.addEventListener("change", async (event) => {
    try {
      await command(
        "order.priority",
        { id, priority: event.target.value },
        "Prioridad actualizada sin interrumpir cargas en curso.",
      );
    } catch {
      event.target.value = o.priority;
    }
  });
}
function orderInsight(order) {
  const model = state.orderReadModels?.find((x) => x.orderId === order.id);
  if (!model) return "";
  const shortages = (model.availability || []).filter(
    (x) => x.shortfallCases > 0,
  );
  const providers = [...new Set(shortages.map((x) => sku(x.skuId).supplierId))];
  return `${isOps() && order.status === "PENDING" ? `<section class="fulfillment-preview"><div class="section-heading"><h3>Comprobación antes de preparar</h3><span class="badge ${model.canRelease ? "green" : "amber"}">${model.canRelease ? "Stock suficiente" : "Requiere reabastecimiento"}</span></div>${(model.availability || []).map((x) => `<div class="availability-line"><span>${photo(sku(x.skuId), "document-product-image")}<strong>${esc(skuName(sku(x.skuId)))}</strong></span><span>${num(x.availableCases)} disponibles / ${num(x.requestedCases)} solicitadas</span>${x.shortfallCases ? `<b class="shortfall">Faltan ${num(x.shortfallCases)}</b>` : '<b class="available-ok">✓ Cubierto</b>'}${x.fefo?.length ? `<details><summary>Ver lotes por vencimiento</summary><ul>${x.fefo.map((l) => `<li>${esc(l.lot)} · ${esc(l.expiry || "Sin vencimiento")} · ${num(l.cases)} cajas</li>`).join("")}</ul></details>` : ""}</div>`).join("")}<p class="field-hint">Se reservan los lotes que vencen primero (FEFO). Esta consulta no reserva stock: la disponibilidad vuelve a comprobarse al liberar.</p>${can("purchase.create") ? providers.map((p) => button(`Solicitar faltantes a ${esc(supplier(p).name)}`, "purchase-shortage", "secondary small", `data-order="${esc(order.id)}" data-provider="${esc(p)}"`)).join("") : ""}</section>` : ""}${model.milestones?.length ? `<details class="order-history" open><summary>Historial del pedido</summary><ol class="lifecycle-timeline">${model.milestones.map((m) => `<li class="${m.at ? "done" : ""}"><span class="timeline-dot"></span><div><strong>${esc(m.label)}</strong><small>${m.at ? esc(new Intl.DateTimeFormat("es-PE", { dateStyle: "short", timeStyle: "short", timeZone: "America/Lima" }).format(new Date(m.at))) : "Pendiente"}</small></div></li>`).join("")}</ol></details>` : ""}`;
}
function renderPurchases() {
  const receivedByPurchase = new Map();
  for (const receipt of state.receipts || []) {
    const totals = receivedByPurchase.get(receipt.purchaseId) || { accepted: 0, held: 0 };
    for (const line of receipt.lines || []) {
      totals.accepted += Number(line.acceptedCases || 0);
      totals.held += Number(line.quarantineCases || 0);
    }
    receivedByPurchase.set(receipt.purchaseId, totals);
  }
  const historyOpen = main.querySelector("#purchase-history")?.open;
  const qualityOpen = main.querySelector("#purchase-quality")?.open;
  const billsByPurchase = new Map((state.finance?.bills || []).map(bill => [bill.purchaseId, bill]));
  const renderCard = (p) => {
    const quality = receivedByPurchase.get(p.id);
    const bill = billsByPurchase.get(p.id);
    return `<article class="document-card"><div class="card-top"><span class="document-code">${esc(p.code || p.id)}</span>${badge(p.status)}</div><div class="entity-card-media is-logo">${photo(supplier(p.supplierId), "supplier-document-logo", true)}</div><h2>${esc(supplier(p.supplierId).name)}</h2><p>${p.lines.length} productos · ${num(p.lines.reduce((n, l) => n + l.cases, 0))} cajas solicitadas</p><div class="document-products">${p.lines
      .slice(0, 3)
      .map(
        (l) =>
          `<span>${photo(sku(l.skuId), "document-product-image")}${esc(skuName(sku(l.skuId)))} <b>${num(l.cases)}</b></span>`,
      )
      .join(
        "",
      )}</div>${quality?.held ? `<p class="muted">${num(quality.accepted)} aceptadas · ${num(quality.held)} retenidas</p>` : ""}${bill?.pdfUrl ? `<a class="btn secondary wide" target="_blank" rel="noopener" href="${esc(bill.pdfUrl)}">Factura ${esc(bill.reference)} · S/ ${(bill.totalCents/100).toFixed(2)} ↗</a>` : ""}${autonomyDocument("PURCHASE", p.id)}${!state.autonomy && isOps() && ["EXPECTED", "ORDERED", "PENDING"].includes(p.status) ? button("Registrar llegada simulada", "arrive-purchase", "secondary wide", `data-id="${esc(p.id)}"`) : ""}${p.canCancel ? button("Cancelar solicitud", "cancel-purchase", "danger-ghost small", `data-id="${esc(p.id)}"`) : ""}${!state.autonomy && isOps() && ["ARRIVED", "PARTIAL"].includes(p.status) ? button("Revisar recepción", "receive-purchase", "primary wide", `data-id="${esc(p.id)}"`) : ""}${p.status === "CANCELLED" ? `<div class="notice">${esc(p.cancelReason || "Solicitud cancelada.")}</div>` : !["EXPECTED", "ORDERED", "PENDING", "ARRIVED", "PARTIAL"].includes(p.status) ? '<div class="notice success">Recepción registrada · Consulta su trazabilidad.</div>' : ""}</article>`;
  };
  const arrivals = [], history = [];
  for (const purchase of newestFirst(state.purchases)) {
    (["RECEIVED", "CANCELLED"].includes(purchase.status) ? history : arrivals).push(purchase);
  }
  const claims = supplierClaimsMarkup(state);
  const observed = (state.supplierClaims?.candidates?.length || 0) + (state.supplierClaims?.claims || []).filter(claim => claim.state !== "CLOSED").length;
  main.innerHTML =
    pageHeading(
      "ENTRADAS AL CENTRO",
      "Recepción de proveedores",
      "Compras, llegada de mercancía, control de calidad y almacenamiento.",
      isOps() ? button("+ Solicitar mercancía", "new-purchase") : "",
    ) +
    `<section class="panel"><div class="section-heading"><h2>Llegadas pendientes</h2></div><div class="order-grid">${arrivals.map(renderCard).join("") || empty("Sin llegadas pendientes", "Crea una solicitud de mercancía a un proveedor.")}</div></section>` +
    (claims ? `<details class="panel receiving-disclosure" id="purchase-quality"${qualityOpen ? " open" : ""}><summary>Cajas observadas <span class="muted">· ${num(observed)} pendientes</span></summary>${claims}</details>` : "") +
    (history.length ? `<details class="panel receiving-disclosure" id="purchase-history"${historyOpen ? " open" : ""}><summary>Historial de recepciones <span class="muted">· ${num(history.length)}</span></summary><div class="order-grid">${historyOpen ? history.map(renderCard).join("") : ""}</div></details>` : "");
  const historyPanel = main.querySelector("#purchase-history");
  historyPanel?.addEventListener("toggle", () => {
    const grid = historyPanel.querySelector(".order-grid");
    grid.innerHTML = historyPanel.open ? history.map(renderCard).join("") : "";
  });
}
function openDocumentForm(kind, branchId, initialSku, options = {}) {
  const purchase = kind === "purchase";
  const editing = options.editOrder;
  if (
    !can(editing ? "order.edit" : purchase ? "purchase.create" : "order.create")
  ) {
    showOperationError(
      Error("Tu perfil no puede crear o editar esta solicitud."),
    );
    return;
  }
  const maxCases = purchase
    ? 500
    : state.configuration?.settings?.maxOrderCases || 120;
  let lines = [];
  const draftKey = `donpepe.draft.${user.id}.${kind}${editing ? `.${editing.id}` : ""}`;
  let restored = false;
  let restoredMetadata = {};
  let savedOrderRevision;
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || "null");
    if (saved?.version === 1 && Array.isArray(saved.lines)) {
      lines = saved.lines
        .filter(
          (l) =>
            state.catalog.skus.some(
              (s) => s.id === l.skuId && s.active !== false,
            ) &&
            Number.isInteger(l.cases) &&
            l.cases > 0 &&
            l.cases <= maxCases,
        )
        .slice(0, 30);
      if (
        !purchase ||
        state.catalog.suppliers.some(
          (s) => s.id === saved.destination && s.active !== false,
        )
      )
        branchId ||= saved.destination;
      restored = !!lines.length;
      restoredMetadata = {
        notes: typeof saved.notes === "string" ? saved.notes.slice(0, 300) : "",
        requestedByDate: /^\d{4}-\d{2}-\d{2}$/.test(saved.requestedByDate || "")
          ? saved.requestedByDate
          : "",
      };
      savedOrderRevision = saved.orderRevision;
    }
  } catch {}
  if (editing || options.lines) {
    const restoreEdit =
      !!editing && restored && savedOrderRevision === (editing.revision || 1);
    if (!restoreEdit)
      lines = (editing?.lines || options.lines).map(({ skuId, cases }) => ({
        skuId,
        cases,
      }));
    branchId = editing?.branchId || branchId;
    restored = restoreEdit;
    if (!restoreEdit) restoredMetadata = {};
  }
  if (
    initialSku &&
    state.catalog.skus.some((s) => s.id === initialSku && s.active !== false) &&
    !lines.some((l) => l.skuId === initialSku)
  )
    lines.push({ skuId: initialSku, cases: 1 });
  showDialog(
    editing
      ? "Modificar solicitud pendiente"
      : purchase
        ? "Solicitar mercancía al proveedor"
        : "Solicitar productos para mi tienda",
    `<form id="document-form"><label>${purchase ? "Proveedor" : "Tienda"}<select name="destination" id="document-destination" ${purchase ? 'data-entity-force="true"' : ""}>${(purchase ? state.catalog.suppliers : state.catalog.branches).map((x) => `<option value="${esc(x.id)}" ${branchId === x.id || user.branchId === x.id ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>${purchase ? '<div id="document-supplier-context"></div><div class="assortment-launch"><div><h3>Productos del proveedor</h3><p id="document-assortment-count"></p></div><button type="button" class="btn primary" id="open-supplier-catalog">Explorar catálogo</button></div>' : `<div class="product-entry"><label>Producto<select id="line-sku"></select></label><label>Cajas<input id="line-quantity" type="number" value="1" min="1" max="${maxCases}" step="1"></label><button type="button" id="add-line" class="btn secondary">Agregar +</button></div>`}<p class="field-hint">Se trabaja con cajas cerradas. ${purchase ? "Selecciona los productos por marca y ajusta las cajas en cada tarjeta." : "Hasta 120 cajas por pedido: capacidad de un vehículo de reparto."}</p><h3 class="document-basket-heading">Productos de la solicitud</h3><div id="draft-lines" class="draft-lines"></div>${purchase ? '<div id="purchase-commercial-summary" class="notice"></div>' : ""}<div class="notice">${purchase ? "La solicitud no crea stock. La entrada se registra después de comprobar la mercancía recibida." : "Operaciones revisará el pedido antes de liberar su preparación."}</div><p class="form-error" id="document-error" role="alert"></p><div class="dialog-actions"><button class="btn secondary" type="button" data-action="close-dialog">Volver</button><button class="btn primary" id="document-submit" disabled>${purchase ? "Crear solicitud" : "Crear pedido"} ↗</button></div></form>`,
  );
  const destination = $("#document-destination");
  if (!purchase)
    $("#document-error").insertAdjacentHTML(
      "beforebegin",
      `<div class="form-grid"><label>Observaciones para Operaciones<textarea name="notes" maxlength="300" rows="2" placeholder="Opcional: motivo o indicación útil">${esc(restoredMetadata.notes ?? editing?.notes ?? "")}</textarea></label><label>Fecha requerida<input type="date" name="requestedByDate" value="${esc(restoredMetadata.requestedByDate ?? editing?.requestedByDate ?? "")}" min="${esc(limaDate(state.clock.now))}" max="${esc(addLimaDays(state.clock.now, 90))}"></label></div>`,
    );
  if (!purchase)
    $(".product-entry").insertAdjacentHTML(
      "beforebegin",
      '<label class="product-search-label">Buscar producto<input id="document-product-search" type="search" placeholder="Nombre, marca o código de barras…" autocomplete="off"></label>',
    );
  $("#document-form").insertAdjacentHTML(
    "afterbegin",
    `<div class="draft-note"><span id="draft-status">${restored ? "Borrador recuperado en este navegador" : "Tu borrador se conserva al cerrar esta ventana"}</span><button type="button" id="discard-draft">Vaciar borrador</button></div>`,
  );
  if (!purchase)
    $(".product-entry").insertAdjacentHTML(
      "beforebegin",
      '<div id="product-preview"></div>',
    );
  function saveDraft() {
    const form = $("#document-form");
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({
          version: 1,
          destination: destination.value,
          lines,
          notes: form.elements.notes?.value || "",
          requestedByDate: form.elements.requestedByDate?.value || "",
          orderRevision: editing?.revision || 1,
        }),
      );
    } catch {}
    $("#draft-status").textContent = lines.length
      ? "Borrador guardado en este navegador"
      : "Tu borrador se conserva al cerrar esta ventana";
  }
  for (const option of [...destination.options]) {
    const item = (
      purchase ? state.catalog.suppliers : state.catalog.branches
    ).find((item) => item.id === option.value);
    if (item?.active === false) option.remove();
  }
  if (!purchase)
    $("#document-form .field-hint").textContent =
      `Cajas cerradas. Máximo ${maxCases} cajas por pedido según la política vigente.`;
  if (user.role === "store") destination.disabled = true;
  function preview() {
    const s = sku($("#line-sku").value);
    $("#product-preview").innerHTML = s.id
      ? `<div class="product-spotlight">${photo(s)}<div><span class="brand-name">${esc(s.brand || "Producto")}</span><strong>${esc(skuName(s))}</strong><small>${esc(s.category || "")} · ${esc(s.presentation || "")}<br>${num(s.unitsPerCase)} unidades por caja · ${esc(temperature(s))}</small></div></div>`
      : "";
  }
  function products() {
    if (purchase) {
      const provider = supplier(destination.value);
      const eligible = state.catalog.skus.filter(
        (s) => s.active !== false && suppliedBy(s, provider.id),
      );
      const brands = [...new Set(eligible.map((s) => s.brand).filter(Boolean))];
      $("#document-supplier-context").innerHTML =
        `<div class="supplier-assortment-context">${photo(provider, "supplier-document-logo", true)}<div><strong>${esc(provider.name)}</strong><small>${esc(provider.description || provider.businessName || "Proveedor de mercancía")}</small><span>${brands
          .slice(0, 5)
          .map((brand) => esc(brand))
          .join(
            " · ",
          )}${brands.length > 5 ? ` · +${brands.length - 5} marcas` : ""}</span></div></div>`;
      $("#document-assortment-count").textContent =
        `${num(eligible.length)} productos · ${num(brands.length)} marcas`;
      $("#open-supplier-catalog").disabled = !eligible.length;
      return;
    }
    const query = $("#document-product-search")
      .value.trim()
      .toLocaleLowerCase("es");
    const list = purchase
      ? state.catalog.skus.filter(
          (s) =>
            s.active !== false &&
            `${s.name} ${s.brand} ${s.barcode || ""}`
              .toLocaleLowerCase("es")
              .includes(query) &&
            suppliedBy(s, destination.value),
        )
      : state.catalog.skus.filter(
          (s) =>
            s.active !== false &&
            `${s.name} ${s.brand} ${s.barcode || ""}`
              .toLocaleLowerCase("es")
              .includes(query),
        );
    $("#line-sku").innerHTML = list
      .map(
        (s) =>
          `<option value="${esc(s.id)}">${esc(skuName(s))} · ${num(s.unitsPerCase)} un./caja</option>`,
      )
      .join("");
    $("#add-line").disabled = !list.length;
    if (initialSku && list.some((s) => s.id === initialSku))
      $("#line-sku").value = initialSku;
    preview();
  }
  function syncDraftQuantities() {
    const inputs = $$("[data-line-count]", $("#document-form"));
    const next = lines.map((line, i) => ({
      ...line,
      cases: Number(
        inputs.find((input) => Number(input.dataset.lineCount) === i)?.value ??
          line.cases,
      ),
    }));
    const invalid = next
      .map((line, i) =>
        !Number.isInteger(line.cases) || line.cases < 1 || line.cases > maxCases
          ? i
          : -1,
      )
      .filter((i) => i >= 0);
    const total = next.reduce((n, l) => n + l.cases, 0);
    const overTotal = !purchase && total > maxCases;
    const count = $(".basket-count", $("#draft-lines"));
    if (count)
      count.textContent = `${next.length} de 12 productos · ${Number.isFinite(total) ? num(total) : "Revisa las cantidades"} cajas${!purchase ? ` de ${maxCases}` : ""}`;
    if (invalid.length || overTotal) {
      const message = overTotal
        ? `Las cantidades escritas suman más de ${maxCases} cajas. Corrígelas antes de continuar.`
        : `Escribe cantidades enteras entre 1 y ${maxCases} cajas.`;
      for (const input of inputs)
        if (overTotal || invalid.includes(Number(input.dataset.lineCount)))
          markFieldError(
            input,
            overTotal ? "Total excedido." : "Cantidad inválida.",
          );
      formIssue($("#document-form"), message);
      return false;
    }
    lines = next;
    return true;
  }
  function draft() {
    if(purchase){const net=lines.reduce((n,l)=>n+(sku(l.skuId).purchaseUnitNetCents||0)*sku(l.skuId).unitsPerCase*l.cases,0),tax=lines.reduce((n,l)=>n+Math.round((sku(l.skuId).purchaseUnitNetCents||0)*sku(l.skuId).unitsPerCase*l.cases*(sku(l.skuId).purchaseTaxRateBps||0)/10000),0);
      $("#purchase-commercial-summary").innerHTML=`<strong>Total: S/ ${((net+tax)/100).toFixed(2)}</strong><p>Base S/ ${(net/100).toFixed(2)} · IGV S/ ${(tax/100).toFixed(2)}. El proveedor emitirá su factura automáticamente.</p>`;
    }
    $("#draft-lines").innerHTML = lines.length
      ? lines
          .map(
            (l, i) =>
              `<div><span>${photo(sku(l.skuId), "document-product-image")}${esc(skuName(sku(l.skuId)))}</span><label class="draft-quantity"><input type="number" data-line-count="${i}" value="${l.cases}" min="1" max="${maxCases}" step="1" aria-label="Cajas de ${esc(skuName(sku(l.skuId)))}"><small>${num(l.cases * sku(l.skuId).unitsPerCase)} un.</small></label><button type="button" class="icon-button" data-remove="${i}" aria-label="Quitar producto">×</button></div>`,
          )
          .join("")
      : "<p>Agrega los productos de esta operación.</p>";
    $("#document-submit").disabled = !lines.length;
    $("#document-submit").textContent = editing
      ? "Guardar cambios ↗"
      : purchase
        ? "Crear solicitud ↗"
        : "Crear pedido ↗";
    $("#draft-lines").insertAdjacentHTML(
      "beforeend",
      `<p class="basket-count" aria-live="polite">${lines.length} de 12 productos · ${num(lines.reduce((n, l) => n + l.cases, 0))} cajas${!purchase ? ` de ${maxCases}` : ""}</p>`,
    );
    $$("[data-line-count]").forEach(
      (input) =>
        (input.onchange = () => {
          if (!syncDraftQuantities()) return;
          draft();
          saveDraft();
        }),
    );
    $$("[data-remove]").forEach(
      (b) =>
        (b.onclick = () => {
          lines.splice(Number(b.dataset.remove), 1);
          draft();
          saveDraft();
        }),
    );
  }
  const supplierBaskets = new Map();
  let currentDestination = destination.value;
  destination.onchange = () => {
    if (purchase) {
      supplierBaskets.set(
        currentDestination,
        lines.map((line) => ({ ...line })),
      );
      lines = (supplierBaskets.get(destination.value) || []).map((line) => ({
        ...line,
      }));
      currentDestination = destination.value;
    } else lines = [];
    products();
    draft();
    saveDraft();
  };
  if (!purchase) {
    $("#line-sku").onchange = preview;
    $("#document-product-search").oninput = products;
  } else
    $("#open-supplier-catalog").onclick = () => {
      if (!syncDraftQuantities()) return;
      productCatalog ||= createProductCatalogDialog({
        getState: () => state,
        esc,
        photo,
        num,
      });
      productCatalog.open({
        supplierId: destination.value,
        lines,
        maxCases,
        returnFocus: $("#open-supplier-catalog"),
        onApply: (selectedLines) => {
          lines = selectedLines;
          draft();
          saveDraft();
        },
      });
    };
  $("#discard-draft").onclick = () => {
    lines = [];
    for (const field of $$(
      "[name=notes],[name=requestedByDate]",
      $("#document-form"),
    ))
      field.value = "";
    draft();
    saveDraft();
  };
  for (const field of $$(
    "[name=notes],[name=requestedByDate]",
    $("#document-form"),
  ))
    field.addEventListener("input", saveDraft);
  products();
  if (purchase)
    lines = lines.filter((l) => suppliedBy(sku(l.skuId), destination.value));
  draft();
  if (!purchase)
    $("#add-line").onclick = () => {
      if (!syncDraftQuantities()) return;
      const id = $("#line-sku").value,
        count = Number($("#line-quantity").value);
      if (!id || !Number.isInteger(count) || count < 1 || count > maxCases) {
        $("#document-error").textContent =
          `Indica entre 1 y ${maxCases} cajas.`;
        markFieldError(
          $("#line-quantity"),
          `Escribe una cantidad entera entre 1 y ${maxCases}.`,
        );
        return;
      }
      if (
        !purchase &&
        lines.reduce((total, line) => total + line.cases, 0) + count > maxCases
      ) {
        $("#document-error").textContent =
          `El pedido admite ${maxCases} cajas en total. Divide la solicitud en dos pedidos.`;
        return;
      }
      const item = lines.find((x) => x.skuId === id);
      if (!item && lines.length >= 12) {
        formIssue(
          $("#document-form"),
          "Cada solicitud admite 12 productos diferentes. Crea otra solicitud para el resto.",
        );
        return;
      }
      if (item && item.cases + count > 500) {
        $("#document-error").textContent =
          "El máximo de la línea es 500 cajas.";
        return;
      }
      if (item) item.cases += count;
      else lines.push({ skuId: id, cases: count });
      $("#document-error").textContent = "";
      draft();
      saveDraft();
    };
  $("#document-form").onsubmit = async (e) => {
    e.preventDefault();
    if (!syncDraftQuantities()) return;
    if (!lines.length) return;
    if (
      !purchase &&
      lines.reduce((total, line) => total + line.cases, 0) > maxCases
    ) {
      $("#document-error").textContent =
        `El pedido admite ${maxCases} cajas en total.`;
      return;
    }
    const submit = $("#document-submit");
    submit.disabled = true;
    try {
      await command(
        editing ? "order.edit" : purchase ? "purchase.create" : "order.create",
        editing
          ? {
              id: editing.id,
              expectedOrderRevision: editing.revision || 1,
              lines,
              notes: e.currentTarget.notes.value,
              requestedByDate: e.currentTarget.requestedByDate.value || null,
            }
          : {
              [purchase ? "supplierId" : "branchId"]: destination.value,
              lines,
              ...(!purchase
                ? {
                    notes: e.currentTarget.notes.value,
                    requestedByDate:
                      e.currentTarget.requestedByDate.value || null,
                  }
                : {}),
            },
        purchase
          ? "Solicitud creada. Sigue su llegada en Abastecimiento."
          : editing
            ? "Solicitud actualizada. Aún no se ha movido mercancía."
            : "Pedido creado. Ya puede revisarse para preparación.",
      );
      dialog.close();
      try {
        sessionStorage.removeItem(draftKey);
      } catch {}
      location.hash = purchase ? "purchases" : "orders";
      render();
    } catch (error) {
      $("#document-error").textContent = error.message;
      submit.disabled = false;
    }
  };
}
function receivePurchase(id) {
  receiptWorkflow ||= createReceiptWorkflow({
    getState: () => state,
    showDialog,
    command,
    render,
    esc,
    photo,
    formIssue,
    sku,
    supplier,
    num,
    dialog,
  });
  receiptWorkflow.open(id);
}
function receiveOrder(id) {
  const o = state.orders.find((x) => x.id === id);
  showDialog(
    "Confirmar lo que llegó a tienda",
    `<form id="store-receipt"><div class="notice">${esc(branch(o.branchId).name)} · Confirma las cajas realmente recibidas. Una diferencia no se convierte en stock de tienda.</div><div class="line-items">${o.lines.map((l, i) => `<label class="receipt-row"><span>${esc(skuName(sku(l.skuId)))}<small>Enviadas ${l.cases} cajas</small></span><input type="number" min="0" max="${l.cases}" name="received-${i}" value="${l.cases}" required></label>`).join("")}</div><p id="store-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn primary">Confirmar recepción ✓</button></div></form>`,
  );
  $("#store-receipt").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await command(
        "order.receive",
        {
          id,
          lines: o.lines.map((l, i) => ({
            skuId: l.skuId,
            receivedCases: Number(form.elements[`received-${i}`].value),
          })),
        },
        "Recepción registrada. Inventario de tienda actualizado.",
      );
      dialog.close();
      render();
    } catch (error) {
      $("#store-error").textContent = error.message;
    }
  };
}
function newReturn(id) {
  const order = state.orders.find((o) => o.id === id);
  showDialog(
    "Devolver mercancía al centro",
    `<form id="return-form"><p class="muted">La mercancía saldrá del inventario de tienda y viajará a cuarentena. No volverá directamente a stock disponible.</p><label>Producto<select name="skuId">${order.lines
      .filter((l) => l.receivedCases > 0)
      .map(
        (l) =>
          `<option value="${esc(l.skuId)}">${esc(skuName(sku(l.skuId)))}</option>`,
      )
      .join(
        "",
      )}</select></label><div class="form-grid"><label>Cajas<input name="cases" type="number" min="1" value="1" required></label><label>Motivo<input name="reason" minlength="4" maxlength="250" required placeholder="Describe la incidencia"></label></div><p id="return-error" class="form-error" role="alert"></p><div class="dialog-actions"><button class="btn primary">Registrar devolución ↗</button></div></form>`,
    "LOGÍSTICA INVERSA",
  );
  $("#return-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await command(
        "return.create",
        {
          orderId: id,
          skuId: form.skuId.value,
          cases: Number(form.cases.value),
          reason: form.reason.value,
        },
        "Devolución en tránsito hacia cuarentena.",
      );
      dialog.close();
      render();
    } catch (error) {
      $("#return-error").textContent = error.message;
    }
  };
}

function renderInventory() {
  const summaries = state.catalog.skus.filter(s => !s.deletedAt).map((s) => {
    const hs = allHus().filter(
      (h) =>
        h.skuId === s.id &&
        !["SHIPPED", "DELIVERED", "IN_TRANSIT", "DISCREPANCY"].includes(
          h.status,
        ),
    );
    const store = state.inventory.storeStock.filter((x) => x.skuId === s.id);
    return {
      s,
      hs,
      cd: hs.reduce((n, h) => n + qty(h), 0),
      store: store.reduce((n, h) => n + qty(h), 0),
      reserved: hs.reduce((n, h) => n + Number(h.reservedCases || 0), 0),
    };
  });
  main.innerHTML =
    pageHeading(
      "EXISTENCIAS Y TRAZABILIDAD",
      "Inventario y trazabilidad",
      "Existencias, reservas, lotes y cargas identificadas por ubicación.",
      '<a class="btn secondary" href="#kardex">Consultar movimientos</a>',
    ) +
    `<section class="panel"><div class="section-heading"><h2>Existencias por producto</h2><label class="search-field">${icon("search")}<input id="inventory-search" type="search" placeholder="Buscar producto o categoría…" aria-label="Buscar inventario"></label></div><div class="table-scroll"><table><thead><tr><th>Producto</th><th>Conservación</th>${user.role !== "store" ? "<th>Cajas en CD</th><th>Reservadas</th>" : ""}<th>Cajas en tiendas</th><th scope="col" aria-label="Acción">Acción</th></tr></thead><tbody>${summaries.map(({ s, hs, cd, store, reserved }) => `<tr data-search="${esc((skuName(s) + " " + (s.category || "")).toLowerCase())}"><td><div class="product-cell"><span class="product-tile ${s.temperature === "frozen" ? "blue" : s.temperature === "chilled" ? "mint" : ""}">${esc(s.emoji || "▣")}</span><div><strong>${esc(skuName(s))}</strong><small>Contenido de 1 caja: ${num(s.unitsPerCase)} unidades · ${esc(s.category || s.code || s.id)}</small></div></div></td><td>${esc(temperature(s))}</td>${user.role !== "store" ? `<td><strong>${num(cd)}</strong><small>${num(cd * s.unitsPerCase)} unidades de producto</small></td><td>${num(reserved)}</td>` : ""}<td><strong>${num(store)}</strong><small>${num(store * s.unitsPerCase)} unidades de producto</small></td><td><button class="btn small secondary" data-action="sku-detail" data-id="${esc(s.id)}">Trazabilidad ↗</button></td></tr>`).join("")}</tbody></table></div></section>`;
  main.querySelector(".section-heading").insertAdjacentHTML("afterend", '<details class="inventory-reading-guide"><summary>Cómo leer estas cantidades</summary><p>Las cantidades principales son cajas cerradas. Cada producto indica cuántas unidades contiene una caja. Las cajas reservadas ya forman parte del stock del centro: no deben sumarse nuevamente. En Trazabilidad puedes consultar los lotes, las cargas agrupadas y sus movimientos.</p></details>');
  $("#inventory-search").oninput = (e) => {
    $$("[data-search]").forEach(
      (tr) =>
        (tr.hidden = !tr.dataset.search.includes(
          e.target.value.trim().toLowerCase(),
        )),
    );
  };
  $$("tbody tr", main)
    .slice(0, summaries.length)
    .forEach((row, index) => {
      const s = summaries[index].s;
      $(".product-tile", row)?.insertAdjacentHTML("afterend", photo(s));
      $(".product-tile", row)?.remove();
      row.dataset.search =
        `${skuName(s)} ${s.brand || ""} ${s.category || ""} ${s.barcode || ""}`.toLowerCase();
    });
  if (user.role !== "store") {
    const held = allHus().filter(
      (h) =>
        h.cases > 0 &&
        ["QUARANTINE", "DISCREPANCY", "WAITING_SPACE"].includes(h.status),
    );
    main.insertAdjacentHTML(
      "beforeend",
      `<section class="panel"><div class="section-heading"><h2>Control de calidad y excepciones</h2><span class="muted">${held.length} cargas retenidas</span></div>${held.length ? `<div class="table-scroll"><table><thead><tr><th>Carga y producto</th><th>Cajas</th><th>Estado</th><th scope="col" aria-label="Acción">Acción</th></tr></thead><tbody>${held.map((h) => `<tr><td><strong>${esc(skuName(sku(h.skuId)))}</strong><small>${esc(h.id)} · Lote ${esc(h.lot)}</small></td><td>${h.cases}</td><td>${badge(h.status)}</td><td>${isOps() && h.status === "QUARANTINE" && !h.packagingDefect ? button("Aprobar y almacenar", "release-quarantine", "secondary small", `data-id="${esc(h.id)}"`) : '<span class="muted">Requiere revisión</span>'}</td></tr>`).join("")}</tbody></table></div>` : empty("Sin mercancía retenida", "Las recepciones observadas y las diferencias se mostrarán aquí.")}</section>`,
    );
  }
}
function ensureKardexView() {
  kardexView ||= createKardexView({
    api,
    getState: () => state,
    getUser: () => user,
    esc,
    photo,
    num,
    showDialog,
    pageHeading,
    icon,
    onProduct: id => skuDetail(id, { tab: "history" }),
  });
  return kardexView;
}
function renderKardex() { ensureKardexView().mount(main); }
function ensureAutonomyView() {
  autonomyView ||= createAutonomyView({ getState: () => state, getUser: () => user, can, command, esc, showDialog, dialog, pageHeading, formIssue });
  return autonomyView;
}
function renderAutonomy() { ensureAutonomyView().mount(main); }
function autonomousJob(kind, id) { return state?.autonomy?.jobs?.find(job => job.kind === kind && job.documentId === id); }
function autonomyDocument(kind, id) {
  const job = autonomousJob(kind, id);
  if (job) return `<div class="autonomy-document-context"><strong>Proceso autónomo</strong><p>${esc(autonomyProcessMessage(job, state))}</p>${button("Ver expediente de autonomía", "view-autonomy-job", "secondary small", `data-id="${esc(job.id)}"`)}</div>`;
  const candidate = state?.autonomy?.legacyCandidates?.find(item => item.kind === kind && item.id === id);
  return candidate ? `<div class="autonomy-document-context"><strong>Pendiente de incorporar al flujo autónomo</strong><p>El documento conserva su estado. Operaciones debe autorizar una verificación nueva de las cargas pendientes.</p>${can("autonomy.authorize") ? button("Autorizar proceso autónomo", "authorize-autonomy", "primary small", `data-id="${esc(id)}" data-kind="${esc(kind)}"`) : ""}</div>` : "";
}
function temperature(s) {
  const t = s.temperature || s.zoneType || "ambient";
  return /frozen|congel/i.test(t)
    ? "Congelado"
    : /cold|chill|refrig/i.test(t)
      ? "Refrigerado"
      : "Ambiente";
}
function skuDetail(id, options = {}) {
  const trace = createProductTraceability({
    api, getState: () => state, getUser: () => user, esc, photo, num,
    showDialog, getHus: allHus, locationName, status,
    onMovement: row => ensureKardexView().detail(row),
  });
  return trace.open(id, options);
}
function renderEquipment() {
  main.innerHTML =
    pageHeading(
      "AUTOMATIZACIÓN",
      "Equipos y misiones",
      "Transporte horizontal, almacenamiento vertical y puntos de transferencia coordinados.",
    ) +
    `<div class="equipment-grid">${[
      ...state.equipment.robots,
      ...state.equipment.trucks,
    ]
      .map((r) => {
        const asset = state.catalog.assets?.find((a) => a.deviceId === r.id);
        const openMaintenance = state.maintenance?.find(
          (m) =>
            m.assetId === asset?.id &&
            !["COMPLETED", "REJECTED", "CANCELLED"].includes(m.state),
        );
        return `<article class="equipment-card ${r.status === "FAULT" ? "fault" : ""}">${asset?.imageUrl ? photo(asset, "equipment-photo") : ""}<div class="card-top"><span class="equipment-glyph">${r.type === "AMR" ? icon("package") : icon("layers")}</span>${badge(r.status)}</div><h2>${esc(r.name || r.id)}</h2><p>${esc(asset?.model || (r.type === "AMR" ? "Transporte autónomo" : r.type === "SHUTTLE" ? "Transferencia de congelados" : r.type === "FORKLIFT" ? "Carga automática de camiones" : "Equipo del centro"))}</p>${r.battery == null ? '<div class="battery"><span>Alimentación</span><b>Red eléctrica / vehículo</b><div><i style="width:100%"></i></div></div>' : `<div class="battery"><span>Batería</span><b>${num(r.battery)} %</b><div><i style="width:${Math.min(100, Math.max(0, r.battery || 0))}%"></i></div></div>`}<div class="equipment-job">${esc(r.missionId || "Sin misión asignada")}</div>${openMaintenance ? `<div class="notice warning">Intervención ${esc(openMaintenance.id)} · ${esc(status(openMaintenance.state))}</div>` : ""}<div class="equipment-actions">${isOps() && !["MAINTENANCE", "OUT_OF_SERVICE"].includes(r.status) ? button(r.status === "FAULT" ? "Recuperar equipo" : "Registrar incidencia", r.status === "FAULT" ? "recover-equipment" : "fault-equipment", "secondary wide small", `data-id="${esc(r.id)}"`) : ""}${asset && can("maintenance.request") && !openMaintenance ? button("Solicitar revisión técnica", "request-maintenance", "secondary small", `data-id="${esc(asset.id)}"`) : ""}</div></article>`;
      })
      .join(
        "",
      )}</div><section class="panel"><div class="section-heading"><h2>Misiones de transporte</h2><span class="muted">Asignación y ejecución coordinadas</span></div><div class="table-scroll"><table><thead><tr><th>Misión</th><th>Producto</th><th>Cajas</th><th>Equipo</th><th>Estado</th><th scope="col" aria-label="Acción">Acción</th></tr></thead><tbody>${
      newestFirst(state.missions)
        .slice(0, 50)
        .map(
          (m) =>
            `<tr><td><strong>${esc(m.label || m.type)}</strong><small>${esc(m.id)}</small></td><td>${esc(skuName(sku(m.skuId)))}</td><td>${num(m.cases)}</td><td>${esc(m.robotId || m.equipmentId || "Por asignar")}</td><td>${badge(m.status)}</td><td>${button("Inspeccionar", "mission-detail", "secondary small", `data-id="${esc(m.id)}"`)}</td></tr>`,
        )
        .join("") ||
      '<tr><td colspan="6">Aún no hay misiones. Libera un pedido o acepta una recepción.</td></tr>'
    }</tbody></table></div></section>`;
  const devices = [...state.equipment.robots, ...state.equipment.trucks];
  $$(".equipment-card", main).forEach((card, index) => {
    const asset = state.catalog.assets?.find(
      (item) => item.deviceId === devices[index]?.id,
    );
    if (!asset || !isOps() || !can("maintenance.read")) return;
    $(".equipment-actions", card)?.insertAdjacentHTML(
      "afterbegin",
      button(
        "Consultar reglas",
        "equipment-rules",
        "secondary small",
        `data-id="${esc(asset.id)}"`,
      ),
    );
    const summary = document.createElement("div");
    summary.className = "equipment-rule-summary";
    summary.innerHTML = `<span>${asset.settings?.autoAssign === false ? "Nuevas asignaciones pausadas" : "Asignación automática"}</span><b>${asset.pendingSettings ? "Cambio pendiente" : asset.settings?.speedProfile === "ECO" ? "Perfil Eco" : "Reglas activas"}</b>`;
    $(".equipment-actions", card)?.before(summary);
    const availability = state.fleetReadModels?.find(
      (truck) => truck.truckId === devices[index]?.id,
    );
    if (availability) {
      const explanation = document.createElement("div");
      explanation.className = "equipment-availability";
      explanation.innerHTML = `<strong>${esc(availability.stateLabel)}</strong><p>${esc(availability.reason)}</p>${availability.orderId ? button("Ver entrega", "open-order", "secondary small", `data-id="${esc(availability.orderId)}"`) : ""}`;
      $(".equipment-job", card)?.replaceWith(explanation);
    }
  });
  if (isOps() && can("maintenance.read")) {
    const auxiliaries = (state.catalog.assets || []).filter(
      (asset) => !devices.some((device) => device.id === asset.deviceId),
    );
    $(".equipment-grid", main)?.insertAdjacentHTML(
      "beforeend",
      auxiliaries
        .map((asset) => {
          const openMaintenance = state.maintenance?.find(
            (record) => record.assetId === asset.id &&
              !["COMPLETED", "REJECTED", "CANCELLED"].includes(record.state),
          );
          return `<article class="equipment-card" data-readonly-asset="${esc(asset.id)}">${photo(asset, "equipment-photo")}<div class="card-top"><span class="equipment-glyph">${icon("layers")}</span>${asset.status === "PLANNED" ? '<span class="badge purple">Planificado</span>' : asset.active === false ? '<span class="badge red">Archivado</span>' : badge(asset.status)}</div><h2>${esc(asset.name)}</h2><p>${esc([asset.manufacturer, asset.model].filter(Boolean).join(" · "))}</p><div class="equipment-job">${asset.deviceId ? "Estación vinculada al circuito" : "Activo planificado · sin conexión a la simulación"}</div><div class="equipment-rule-summary"><span>${asset.active === false ? "Fuera de servicio administrativo" : asset.settings?.autoAssign === false ? "Nuevas asignaciones pausadas" : "Asignación según disponibilidad"}</span><b>${asset.pendingSettings ? "Cambio pendiente" : "Reglas registradas"}</b></div>${openMaintenance ? `<div class="notice warning">Intervención ${esc(openMaintenance.id)} · ${esc(status(openMaintenance.state))}</div>` : ""}<div class="equipment-actions">${button("Consultar reglas", "equipment-rules", "secondary small", `data-id="${esc(asset.id)}"`)}${asset.active !== false && can("maintenance.request") && !openMaintenance ? button("Solicitar revisión técnica", "request-maintenance", "secondary small", `data-id="${esc(asset.id)}"`) : ""}</div></article>`;
        })
        .join(""),
    );
  }
}
function maintenanceRequest(assetId) {
  const asset = state.catalog.assets?.find((a) => a.id === assetId);
  if (!asset || !can("maintenance.request")) return;
  showDialog(
    `Revisión de ${asset.name}`,
    `<form id="maintenance-request-form">${photo(asset, "equipment-photo")}<div class="notice">Administración revisa la solicitud. El equipo sólo se retirará cuando no tenga carga, ruta ni una maniobra activa. Un fallo inmediato se registra como incidencia operativa.</div><label>Tipo de intervención<select name="type"><option value="INSPECTION">Inspección técnica</option><option value="PREVENTIVE">Mantenimiento preventivo</option><option value="CORRECTIVE">Reparación correctiva</option></select></label><label>Qué observaste<textarea name="reason" required minlength="10" maxlength="500" rows="3" placeholder="Síntoma, frecuencia y condición de funcionamiento"></textarea></label><label>Información adicional<textarea name="notes" maxlength="500" rows="2"></textarea></label><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Volver</button><button class="btn primary">Enviar a Administración</button></div></form>`,
    "OPERACIONES · SOLICITUD TÉCNICA",
  );
  $("#maintenance-request-form").onsubmit = async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      await command(
        "maintenance.request",
        {
          assetId,
          type: form.type.value,
          reason: form.reason.value,
          notes: form.notes.value,
        },
        "Solicitud técnica enviada. El equipo no se ha retirado de forma insegura.",
      );
      dialog.close();
      render();
    } catch (error) {
      formIssue(form, error.message, error.fieldErrors);
    }
  };
}
function missionDetail(id) {
  const m = state.missions.find((x) => x.id === id);
  if (!m) return;
  const hu = allHus().find((x) => x.id === m.huId || x.id === m.sourceHuId);
  const dependency = state.missions.find((x) => x.id === m.dependsOn);
  const pointName = locationName;
  showDialog(
    m.label || m.type,
    operationMeta(m) +
    `<div class="dialog-summary">${badge(m.status)}<span>${esc(m.id)}</span></div>${m.skuId ? `<div class="product-spotlight">${photo(sku(m.skuId))}<div><strong>${esc(skuName(sku(m.skuId)))}</strong><small>${num(m.cases)} cajas · ${esc(hu?.lot || "Lote vinculado a la carga")}</small></div></div>` : ""}${infoRow("Equipo asignado", m.robotId || m.equipmentId || "Esperando recurso compatible")}${infoRow("Pedido vinculado", m.orderId || "Recepción / movimiento interno")}${infoRow("Origen", pointName(m.sourceId || m.originLocationId || m.sourceLocationId || m.fromId))}${infoRow("Destino", pointName(m.destinationId || m.finalLocationId || m.targetLocationId || m.destinationLocationId || m.toId))}${dependency ? infoRow("Paso anterior", `${dependency.label || dependency.kind} · ${status(dependency.status)}`) : ""}${m.blockedReason ? `<div class="notice warning">${esc(m.blockedReason)}</div>` : ""}<div class="notice">El motor conserva la reserva y la custodia de la carga durante cada transferencia. Una misión no completada no se considera una entrega.</div>${m.orderId ? button("Abrir pedido", "open-order", "secondary", `data-id="${esc(m.orderId)}"`) : ""}`,
    "TRAZABILIDAD DE LA MISIÓN",
  );
}
function renderIncidents() {
  const incidents = state.incidents || [];
  const expiry = state.expiry;
  const expiryLabels = { BLOCKED:"Bloqueado", WAITING_SAFE_TRANSFER:"Espera una transferencia segura", TRANSFERRING:"En traslado a cuarentena", AWAITING_DISPOSAL:"Listo para baja documentada", WRITTEN_OFF:"Baja registrada" };
  const expiryPanel = expiry ? `<section class="panel expiry-control"><div class="section-heading"><h2>Vencimientos y retiros</h2><span class="badge amber">FEFO · hora de Lima</span></div><div class="expiry-counters"><span><b>${num(expiry.expiringCases)}</b> cajas vencen en 7 días</span><span><b>${num(expiry.expiredCases)}</b> cajas vencidas bajo control</span><span><b>${num(expiry.pendingDisposalCases)}</b> pendientes de baja</span></div><p class="muted">Los lotes vencidos se bloquean y retiran automáticamente a cuarentena. Las cargas en movimiento completan una transferencia segura. La baja necesita una confirmación y conserva el historial.</p>${expiry.records.length ? `<details><summary>Seguimiento de retiros (${expiry.records.length})</summary><div class="expiry-list">${[...expiry.records].reverse().map(row=>`<article><div><strong>${esc(skuName(sku(row.skuId)))}</strong><small>${esc(row.huId)} · lote ${esc(row.lot)} · ${row.cases} cajas</small></div><span>${esc(expiryLabels[row.state] || row.state)}</span>${row.state==="AWAITING_DISPOSAL" ? button("Confirmar baja", "resolve-incident", "danger-ghost small", `data-id="EXPIRY:${esc(row.huId)}"`) : ""}</article>`).join("")}</div></details>` : ""}</section>` : "";
  const types = {
    EQUIPMENT_FAULT: "Equipo detenido",
    DELIVERY_DIFFERENCE: "Diferencia de entrega",
    SHELF_LIFE: "Vida útil insuficiente",
    NO_COMPATIBLE_SPACE: "Sin plaza compatible",
    QUALITY_HOLD: "Retención de calidad",
    BUFFER_FULL: "Estación sin espacio",
  };
  main.innerHTML =
    pageHeading(
      "CONTROL DE EXCEPCIONES",
      "Incidencias",
      "Cada acción conserva las cargas y documenta la resolución. No es posible omitir un control de calidad por cambiar de pantalla.",
    ) +
    expiryPanel + `<div class="govern-summary"><article><span>Requieren revisión</span><b>${incidents.length}</b></article><article><span>Severidad alta</span><b>${incidents.filter((i) => i.severity === "HIGH").length}</b></article><article><span>Equipos detenidos</span><b>${state.equipment.robots.filter((r) => r.status === "FAULT").length}</b></article></div><div class="incident-grid">${incidents.map((i) => `<article class="incident-card"><span class="badge ${i.severity === "HIGH" ? "red" : "amber"}">${esc(types[i.type] || i.type)}</span><h3>${esc(i.message)}</h3><p>${esc([i.huId, i.orderId, i.robotId, i.missionId].filter(Boolean).join(" · "))}${i.cases ? ` · ${i.cases} cajas` : ""}</p><div class="row-actions">${i.resolutions.includes("RECOVER_EQUIPMENT") ? button("Recuperar equipo", "recover-equipment", "secondary small", `data-id="${esc(i.robotId)}"`) : ""}${i.resolutions.includes("RELEASE_QUARANTINE") ? button("Revisar y liberar", "release-quarantine", "secondary small", `data-id="${esc(i.huId)}"`) : ""}${i.resolutions.includes("SUPPLIER_CLAIM") && can("supplierClaim.manage") ? button("Reclamar al proveedor", "claim-for-hu", "primary small", `data-id="${esc(i.huId)}"`) : ""}${i.resolutions.includes("WRITE_OFF") ? button("Documentar baja", "resolve-incident", "danger-ghost small", `data-id="${esc(i.id)}"`) : ""}${i.resolutions.includes("REJECT_PREPARED") ? button("Retener preparación", "reject-prepared", "secondary small", `data-id="${esc(i.orderId)}"`) : ""}${i.huId && can("inventory.read") ? button("Ver trazabilidad", "sku-detail", "secondary small", `data-id="${esc(allHus().find((h) => h.id === i.huId)?.skuId)}"`) : ""}</div>${!i.resolutions.length ? '<small class="muted">Requiere liberar capacidad o completar el paso anterior. La mercancía sigue identificada.</small>' : ""}</article>`).join("") || empty("Sin incidencias pendientes", "Las excepciones de calidad, espacio, entrega y equipos se concentrarán aquí.")}</div>`;
}
function resolveIncident(id, rejectPrepared = false) {
  const incident=state.incidents.find(row=>row.id===id), hu=allHus().find(row=>row.id===incident?.huId);
  const expiryNote=!rejectPrepared && id.startsWith("EXPIRY:") && hu ? `Baja por vencimiento: lote ${hu.lot}; caducidad ${hu.expiry}; ${hu.cases} cajas retiradas y verificadas en cuarentena.` : "";
  showDialog(
    rejectPrepared
      ? "Retener preparación y trasladar a cuarentena"
      : "Documentar baja de mercancía",
    `<form id="incident-form"><div class="notice warning">${rejectPrepared ? "Se cancelará la expedición de este pedido y se crearán movimientos físicos a cuarentena. No se elimina ni se teletransporta ninguna carga." : "La baja retira de disponibilidad una diferencia o carga retenida después de su investigación. Esta decisión afecta al balance y queda registrada con tu identidad."}</div><label>Motivo documentado<textarea name="note" required minlength="8" maxlength="300" rows="3" placeholder="Describe qué se verificó y por qué se aplica esta medida">${esc(expiryNote)}</textarea></label><label class="form-check"><input name="confirmed" type="checkbox" required>He revisado el caso y confirmo esta resolución.</label><p class="form-error" id="incident-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Volver</button><button class="btn danger-ghost">Confirmar resolución</button></div></form>`,
    "OPERACIONES · CONTROL DOCUMENTADO",
  );
  $("#incident-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
      submit = form.querySelector("button:not([type=button])");
    if (submit.disabled) return;
    submit.disabled = true;
    try {
      await command(
        rejectPrepared ? "order.rejectPrepared" : "incident.resolve",
        rejectPrepared
          ? { id, reason: form.note.value }
          : { id, resolution: "WRITE_OFF", note: form.note.value },
        "Resolución documentada. Sigue las cargas en su trazabilidad.",
      );
      dialog.close();
      render();
    } catch (error) {
      $("#incident-error").textContent = error.message;
      submit.disabled = false;
    }
  };
}
function renderStores() {
  main.innerHTML =
    pageHeading(
      "RED DONPEPE",
      "Red de tiendas",
      "Pedidos, recepciones y existencias conectados con el centro de distribución.",
    ) +
    `<div class="branch-grid">${state.catalog.branches.filter(b => !b.deletedAt)
      .map((b, i) => {
        const items = state.inventory.storeStock.filter(
          (x) => x.branchId === b.id,
        );
        return `<article class="branch-card"><div class="branch-art art-${i}">${b.imageUrl ? photo(b, "branch-photo") : '<div class="mini-store"><span>DONPEPE</span><i></i><i></i><i></i></div>'}<span class="branch-number">0${i + 1}</span><span class="representation-caption">Representación del escenario</span></div><div class="branch-body"><span class="eyebrow">${esc(b.district || "RED DONPEPE")}</span><h2>${esc(b.name)}</h2><p>${esc(b.address || "Lima · Sucursal ficticia del escenario")}</p><div class="branch-stats"><span><b>${num(items.reduce((n, x) => n + x.cases, 0))}</b>Cajas en tienda</span><span><b>${num(state.orders.filter((o) => o.branchId === b.id && !["DELIVERED", "RECEIVED", "RECEIVED_WITH_DIFFERENCE", "CANCELLED", "CANCELLED_AFTER_PREPARATION"].includes(o.status)).length)}</b>Pedidos abiertos</span></div>${canOrder() ? button("Solicitar abastecimiento", "new-order", "secondary wide", `data-branch="${esc(b.id)}"`) : ""}<button class="text-button" data-action="store-stock" data-id="${esc(b.id)}">Ver existencias y movimientos ↗</button></div></article>`;
      })
      .join("")}</div>`;
}
function storeStock(id) {
  const items = state.inventory.storeStock.filter((x) => x.branchId === id);
  showDialog(
    branch(id).name,
    `<div class="line-items">${items.map((x) => `<div><span>${esc(skuName(sku(x.skuId)))}</span><strong>${num(x.cases)} cajas</strong>${user.role === "store" && user.branchId === id && x.cases > 0 ? `<button class="btn small secondary" data-action="consume" data-branch="${esc(id)}" data-sku="${esc(x.skuId)}">Simular venta</button>` : ""}</div>`).join("") || "<p>Esta tienda todavía no tiene mercancía recibida.</p>"}</div>`,
    "INVENTARIO DE TIENDA",
  );
}
function renderAnalytics() {
  const completed = state.missions.filter((m) =>
    ["COMPLETED", "COMPLETE"].includes(m.status),
  );
  const done = state.orders.filter((o) =>
    ["DELIVERED", "RECEIVED"].includes(o.status),
  );
  const used = state.layout.locations.filter((l) => l.huId).length;
  const locs = state.layout.locations.length;
  const counts = state.catalog.skus
    .map((s) => ({
      s,
      total: state.orders.reduce(
        (n, o) =>
          n +
          o.lines
            .filter((l) => l.skuId === s.id)
            .reduce((a, l) => a + l.cases, 0),
        0,
      ),
    }))
    .sort((a, b) => b.total - a.total);
  const max = Math.max(1, ...counts.map((x) => x.total));
  main.innerHTML =
    pageHeading(
      "ANALÍTICA OPERATIVA",
      "Indicadores de la operación",
      "Indicadores calculados a partir de documentos y movimientos registrados.",
    ) +
    `<div class="metric-row">${metric("Misiones completadas", completed.length, "Ejecuciones confirmadas", "arrows")}${metric("Pedidos recibidos", done.length, "Confirmados por tienda", "truck", "green")}${metric("Ocupación de posiciones", locs ? (used / locs) * 100 : 0, `${used} de ${locs} posiciones · porcentaje`, "layers", "purple")}${metric("Equipos con incidencia", state.equipment.robots.filter((r) => r.status === "FAULT").length, "Requieren intervención", "shield", "gold")}</div><div class="analytics-grid"><section class="panel"><div class="section-heading"><h2>Productos más solicitados</h2><span class="muted">Cajas pedidas</span></div><div class="bar-chart">${counts
      .slice(0, 8)
      .map(
        (x) =>
          `<div><span>${esc(skuName(x.s))}</span><div><i style="width:${(x.total / max) * 100}%"></i></div><b>${num(x.total)}</b></div>`,
      )
      .join(
        "",
      )}</div></section><section class="panel"><div class="section-heading"><h2>Lectura de la operación</h2></div><div class="insight-card"><span>↗</span><h3>${activeMissions().length ? `${activeMissions().length} misiones coordinándose` : "Capacidad disponible para trabajar"}</h3><p>${state.equipment.robots.filter((r) => r.status === "FAULT").length ? "Hay equipos fuera de servicio. Revisa sus cargas y recupera el equipo para reanudar las misiones." : "La asignación considera el equipo compatible y su disponibilidad. Las esperas también forman parte de la operación."}</p><a href="#equipment">Revisar equipos →</a></div></section></div>`;
}
function about() {
  showDialog(
    "Una operación conectada, de principio a fin.",
    `<div class="about-hero">Proveedores <b>→</b> Centro DonPepe <b>→</b> Minimarkets</div><p>Esta versión reconstruye el negocio como un centro automatizado: gestionas documentos, liberas trabajo y supervisas equipos. El servidor conserva la operación; el mapa muestra lo que está ocurriendo.</p><div class="about-grid"><article><h3>Datos conectados</h3><p>Producto, lote, carga, reserva, ubicación y mercancía en tránsito conservan su identidad.</p></article><article><h3>Equipos compatibles</h3><p>Los AMR transportan por corredores; los equipos verticales atienden los racks. Las cámaras usan puntos de transferencia.</p></article><article><h3>Simulación, no telemetría</h3><p>Pedidos, viajes y recepciones pertenecen a este entorno ficticio. No hay conexión con robots ni GPS reales.</p></article></div><h3>Inspiración documentada</h3><p>Diseño propio DonPepe basado en categorías públicas de Mecalux. No es una instalación certificada ni una integración con sus productos.</p><div class="source-links"><a target="_blank" rel="noopener" href="https://www.mecalux.es/software/sga-software-gestion-almacenes">Gestión del almacén ↗</a><a target="_blank" rel="noopener" href="https://www.mecalux.es/software/wes-sistema-ejecucion-almacenes">Coordinación de equipos ↗</a><a target="_blank" rel="noopener" href="https://www.mecalux.es/almacenes-automaticos/amr-robots-moviles-autonomos">Robots móviles ↗</a><a target="_blank" rel="noopener" href="https://www.mecalux.es/software/store-fulfillment">Abastecimiento de tiendas ↗</a></div>`,
    "DONPEPE · NUEVA GENERACIÓN",
  );
}

document.addEventListener("click", async (e) => {
  const resource = e.target.closest("[data-resource-tab]");
  if (resource) {
    resourceTab = resource.dataset.resourceTab;
    renderLogisticsPanels();
    return;
  }
  const inspect = e.target.closest("[data-inspect]");
  if (inspect) {
    selected = { type: inspect.dataset.inspect, id: inspect.dataset.id };
    revealInspection();
    openWarehouseScene(requestedMapView, selected);
    syncCameraTabs();
    if ($("#map-results")) $("#map-results").hidden = true;
    renderLogisticsPanels();
    renderInspector();
    return;
  }
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const { action, id } = el.dataset;
  if (el.closest("#workspace-nav")) setConsoleNavigation(false);
  try {
    if(action.startsWith("claim-")){await handleSupplierClaim(action,id,{getState:()=>state,user,command,dialog:showDialog});return;}
    switch (action) {
      case "activate-map":
        openWarehouseScene();
        break;
      case "fleet-status":
        showFleetStatus();
        break;
      case "profile":
        $("#account-menu").hidden = true;
        $("#user-menu").setAttribute("aria-expanded", "false");
        await governance.profile();
        break;
      case "toggle-live-panel": {
        const panel = $("#live-panel");
        panel.hidden = !panel.hidden;
        $$("[data-action=toggle-live-panel]").forEach((button) =>
          button.setAttribute("aria-expanded", String(!panel.hidden)),
        );
        break;
      }
      case "map-focus": {
        const active = $(".diorama-stage").classList.toggle("map-focus");
        el.setAttribute("aria-pressed", String(active));
        el.setAttribute(
          "aria-label",
          active ? "Mostrar paneles del mapa" : "Ocultar paneles del mapa",
        );
        break;
      }
      case "enter-warehouse":
        selected = null;
        openWarehouseScene("interior", null);
        break;
      case "toggle-resources": {
        const panel = $("#map-resources");
        panel.hidden = !panel.hidden;
        resourcesVisible = !panel.hidden;
        $(".resource-toggle").setAttribute(
          "aria-expanded",
          String(!panel.hidden),
        );
        if (panel.hidden && panel.contains(document.activeElement))
          $(".resource-toggle").focus({ preventScroll: true });
        break;
      }
      case "new-order":
        if (user.role === "store") storePortal.request(el.dataset.sku);
        else openDocumentForm("order", el.dataset.branch, el.dataset.sku);
        break;
      case "new-purchase":
        openDocumentForm("purchase");
        break;
      case "purchase-shortage": {
        const model = state.orderReadModels?.find(
          (x) => x.orderId === el.dataset.order,
        );
        const lines = (model?.availability || [])
          .filter(
            (x) =>
              x.shortfallCases > 0 &&
              sku(x.skuId).supplierId === el.dataset.provider,
          )
          .map((x) => ({ skuId: x.skuId, cases: x.shortfallCases }));
        if (!lines.length) {
          toast("Ya no hay faltantes para este proveedor.");
          break;
        }
        openDocumentForm("purchase", el.dataset.provider, undefined, { lines });
        break;
      }
      case "edit-order": {
        const order = state.orders.find((o) => o.id === id);
        if (order?.status !== "PENDING")
          throw Error(
            "La solicitud ya entró en preparación. Actualiza su seguimiento.",
          );
        openDocumentForm("order", order.branchId, undefined, {
          editOrder: order,
        });
        break;
      }
      case "repeat-order": {
        const order = state.orders.find((o) => o.id === id);
        const lines = (order?.lines || [])
          .filter((l) => sku(l.skuId).active !== false)
          .map(({ skuId, cases }) => ({ skuId, cases }));
        if (!lines.length)
          throw Error("Los productos de esta solicitud ya no están activos.");
        openDocumentForm("order", user.branchId, undefined, { lines });
        break;
      }
      case "request-maintenance":
        maintenanceRequest(id);
        break;
      case "mission-detail":
        missionDetail(id);
        break;
      case "cancel-purchase":
        showDialog(
          "Cancelar solicitud al proveedor",
          `<form id="cancel-purchase-form"><div class="notice warning">Se cerrará la solicitud sin incorporar mercancía al inventario. La compra y su factura se conservarán en el historial.</div><label>Motivo<textarea name="reason" required minlength="10" maxlength="500" rows="3"></textarea></label><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Conservar solicitud</button><button class="btn danger-ghost">Confirmar cancelación</button></div></form>`,
          "CONTROL DE ENTRADAS",
        );
        $("#cancel-purchase-form").onsubmit = async (e) => {
          e.preventDefault();
          try {
            await command(
              "purchase.cancel",
              { id, reason: e.currentTarget.reason.value, expectedRevision: state.purchases.find(p => p.id === id)?.revision },
              "Solicitud cancelada.",
            );
            dialog.close();
            render();
          } catch (error) {
            formIssue(e.currentTarget, error.message, error.fieldErrors);
          }
        };
        break;
      case "open-order":
        orderDialog(id);
        break;
      case "view-autonomy-job":
        ensureAutonomyView().detail(id);
        break;
      case "authorize-autonomy":
        ensureAutonomyView().authorize(el.dataset.kind, id);
        break;
      case "watch-order":
        watchOrder(id);
        break;
      case "release-order":
        await command(
          "order.release",
          { id },
          "Abastecimiento autorizado. El controlador coordinará los equipos y las verificaciones.",
        );
        dialog.close();
        if (!scene) render();
        break;
      case "dispatch-order":
        await command(
          "order.dispatch",
          { id },
          "Carga autorizada. El montacargas preparará el camión antes de salir.",
        );
        watchOrder(id);
        break;
      case "receive-order":
        receiveOrder(id);
        break;
      case "new-return":
        newReturn(id);
        break;
      case "release-quarantine":
        showDialog(
          "Confirmar control de calidad",
          `<form id="quality-form"><p>Verifica lote, fecha y condiciones antes de liberar la carga ${esc(id)}. El sistema volverá a validar conservación y vida útil.</p><label>Observación de control<textarea name="note" minlength="8" maxlength="300" required rows="3"></textarea></label><p class="form-error" id="quality-error" role="alert"></p><div class="dialog-actions"><button class="btn primary">Aprobar y almacenar</button></div></form>`,
          "CONTROL DE CALIDAD",
        );
        $("#quality-form").onsubmit = async (event) => {
          event.preventDefault();
          try {
            await command(
              "inventory.releaseQuarantine",
              { huId: id, note: event.currentTarget.note.value },
              "Control aprobado; el sistema planifica el almacenamiento.",
            );
            dialog.close();
            render();
          } catch (error) {
            $("#quality-error").textContent = error.message;
          }
        };
        break;
      case "resolve-incident":
        resolveIncident(id);
        break;
      case "reject-prepared":
        resolveIncident(id, true);
        break;
      case "block-location":
        await command(
          "location.block",
          { id, blocked: el.dataset.blocked === "true" },
          "Estado de ubicación actualizado.",
        );
        break;
      case "cancel-order":
        showDialog(
          "¿Cancelar este pedido?",
          `<form id="cancel-order-form"><div class="notice warning">Las cargas ya recogidas requieren recuperación antes de liberar sus existencias. El sistema comprobará si la cancelación es posible.</div><label>Motivo de cancelación<textarea name="reason" required minlength="8" maxlength="300" rows="3" placeholder="Describe por qué ya no debe prepararse esta solicitud"></textarea></label><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Conservar pedido</button><button class="btn danger-ghost">Confirmar cancelación</button></div></form>`,
        );
        $("#cancel-order-form").onsubmit = async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          try {
            await command(
              "order.cancel",
              { id, reason: form.reason.value },
              "Cancelación registrada con su motivo.",
            );
            dialog.close();
            render();
          } catch (error) {
            formIssue(form, error.message, error.fieldErrors);
          }
        };
        break;
      case "arrive-purchase":
        await command(
          "purchase.arrive",
          { id },
          "Llegada registrada. Revisa lo recibido.",
        );
        render();
        break;
      case "receive-purchase":
        receivePurchase(id);
        break;
      case "sku-detail":
        skuDetail(id);
        break;
      case "equipment-rules":
        if (!isOps() || !can("maintenance.read"))
          throw Error(
            "Tu perfil no permite consultar la ficha técnica de los equipos.",
          );
        {
          const asset = state.catalog.assets?.find((item) => item.id === id);
          showEquipmentRules({
            asset,
            schema: state.deviceSettingSchemas?.[asset?.type],
            showDialog,
            esc,
            photo,
            icon,
          });
        }
        break;
      case "fault-equipment":
        showDialog(
          "Registrar incidencia de equipo",
          `<p>El equipo ${esc(id)} se detendrá y conservará su carga y las reservas. No se modifica ni se pierde su misión.</p><label>Motivo de la detención<input id="fault-reason" minlength="8" maxlength="150" required placeholder="Describe la incidencia observada"></label><p id="fault-error" class="form-error" role="alert"></p><div class="dialog-actions">${button("Volver", "close-dialog", "secondary")}${button("Retirar de servicio", "confirm-fault", "danger-ghost", `data-id="${esc(id)}"`)}</div>`,
        );
        break;
      case "confirm-fault":
        if ($("#fault-reason").value.trim().length < 8) {
          $("#fault-error").textContent =
            "Describe el motivo con al menos ocho caracteres.";
          markFieldError(
            $("#fault-reason"),
            "Indica el síntoma observado con al menos ocho caracteres.",
          );
          $("#fault-reason").focus();
          break;
        }
        await command(
          "equipment.fault",
          { id, reason: $("#fault-reason").value },
          "Incidencia simulada. La mercancía conserva su trazabilidad.",
        );
        dialog.close();
        break;
      case "recover-equipment":
        await command("equipment.recover", { id }, "Equipo recuperado.");
        break;
      case "store-stock":
        storeStock(id);
        break;
      case "consume":
        showDialog(
          "Registrar salida de tienda",
          `<form id="consume-form"><div class="product-spotlight">${photo(sku(el.dataset.sku))}<div><strong>${esc(skuName(sku(el.dataset.sku)))}</strong><small>${esc(branch(el.dataset.branch).name)} · ${num(sku(el.dataset.sku).unitsPerCase)} unidades por caja</small></div></div><div class="notice">Se descontarán cajas de los lotes vigentes con vencimiento más próximo. El movimiento conservará tu identidad y la hora de Lima.</div><div class="form-grid"><label>Cajas que salen<input type="number" name="cases" value="1" min="1" step="1" max="${state.inventory.storeStock.filter(row => row.branchId === el.dataset.branch && row.skuId === el.dataset.sku && (!row.expiry || row.expiry >= limaDate(state.clock.now))).reduce((n, row) => n + row.cases, 0)}" required></label><label>Referencia de venta o salida<input name="reference" maxlength="60" placeholder="Comprobante o referencia interna (opcional)"></label></div><label>Observaciones<textarea name="reason" rows="2" maxlength="300" placeholder="Información útil para identificar la salida (opcional)"></textarea></label><p id="consume-error" class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="btn secondary" data-action="close-dialog">Volver</button><button class="btn primary">Confirmar salida</button></div></form>`,
        );
        $("#consume-form").onsubmit = async (ev) => {
          ev.preventDefault();
          try {
            await command(
              "store.consume",
              {
                branchId: el.dataset.branch,
                skuId: el.dataset.sku,
                cases: Number(ev.currentTarget.cases.value),
                reference: ev.currentTarget.reference.value,
                reason: ev.currentTarget.reason.value,
              },
              "Salida registrada en los movimientos de tu tienda.",
            );
            dialog.close();
            render();
          } catch (error) {
            $("#consume-error").textContent = error.message;
          }
        };
        break;
      case "close-dialog":
        dialog.close();
        break;
      case "close-inspector":
        selected = null;
        scene?.clearSelection?.();
        $("#map-inspector").hidden = true;
        break;
      case "toggle-inspection-details":
        $("#map-inspector").dataset.expanded=String($("#map-inspector").dataset.expanded!=="true");
        renderInspector();
        break;
      case "about":
        about();
        break;
    }
  } catch (error) {
    showOperationError(error);
  }
});
$("#open-about").onclick = about;
$("#mobile-menu").onclick = () => $("#sidebar").classList.toggle("mobile-open");
$("#user-menu").onclick = () => {
  const open = $("#account-menu").hidden;
  $("#account-menu").hidden = !open;
  $("#user-menu").setAttribute("aria-expanded", String(open));
};
document.addEventListener("click", (event) => {
  if (!event.target.closest("#console-navigation-toggle, #workspace-nav"))
    setConsoleNavigation(false);
  if (!event.target.closest("#user-menu, #account-menu")) {
    $("#account-menu").hidden = true;
    $("#user-menu").setAttribute("aria-expanded", "false");
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#workspace-nav[data-console-open]"))
    setConsoleNavigation(false, true);
  const resource = event.target.closest("[data-resource-tab]");
  if (
    resource &&
    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
  ) {
    event.preventDefault();
    const tabs = $$("[data-resource-tab]");
    const index = tabs.indexOf(resource);
    const target =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs.at(-1)
          : tabs[
              (index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) %
                tabs.length
            ];
    resourceTab = target.dataset.resourceTab;
    renderLogisticsPanels();
    target.focus();
  }
  if (event.key === "Escape" && !$("#account-menu").hidden) {
    $("#account-menu").hidden = true;
    $("#user-menu").setAttribute("aria-expanded", "false");
    $("#user-menu").focus();
  }
});
window.addEventListener("donpepe:themechange", (event) => {
  scene?.setTheme?.(event.detail.theme);
});
$("#logout").onclick = async () => {
  await api("/api/logout", {});
  location.href = "/login";
};
window.addEventListener("hashchange", navigate);
window.addEventListener("beforeunload", () => { scene?.dispose(); retainedScene?.dispose(); });
document.addEventListener(
  "invalid",
  (event) => {
    event.target.setAttribute("aria-invalid", "true");
  },
  true,
);
document.addEventListener("keydown", (event) => {
  const searchShortcut =
    event.key === "/" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.target.closest("input, textarea, select, [contenteditable=true]");
  if (
    (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") ||
      searchShortcut) &&
    $("#map-find") &&
    !dialog.open
  ) {
    event.preventDefault();
    $("#map-find").focus();
  }
  if (event.key === "Escape" && $("#map-results"))
    $("#map-results").hidden = true;
});
let identityRefreshedAt = 0;
async function reloadIdentity() {
  const me = await api("/api/me");
  const previous = user;
  user = me.user;
  csrf = me.csrf;
  $("#user-name").textContent = user.name;
  $("#user-role").textContent = user.roleName;
  renderAvatar($("#user-avatar"), user, esc);
  $("#account-email").textContent = user.email;
  document.body.dataset.role = user.role;
  identityRefreshedAt = Date.now();
  if (previous && previous.role !== user.role) {
    view = "";
    navigate();
  } else if (
    previous &&
    JSON.stringify(previous.permissions) !== JSON.stringify(user.permissions)
  ) {
    view = "";
    navigate();
  }
}
async function refresh() {
  try {
    if (Date.now() - identityRefreshedAt > 5000) await reloadIdentity();
    const layout = state?.layout;
    const layoutTag = state?.meta?.layoutTag || "include";
    const response = await api(`/api/state?layout=${layoutTag}`);
    response.layout ??= layout;
    const nextState = normalize(response);
    if (
      Number(nextState.meta?.revision || 0) < Number(state?.meta?.revision || 0)
    )
      return;
    if (isOps() && state) {
      const known = new Set(state.orders.map((order) => order.id));
      const incoming = nextState.orders.filter(
        (order) => !known.has(order.id) && order.status === "PENDING",
      );
      if (incoming.length)
        toast(
          incoming.length === 1
            ? `Nueva solicitud de ${branch(incoming[0].branchId).name}. Revísala en Pedidos.`
            : `${incoming.length} nuevas solicitudes de tiendas por revisar.`,
        );
    }
    state = nextState;
    let warning = $("#system-warning");
    if (state.meta?.engineFault) {
      if (!warning) {
        warning = document.createElement("div");
        warning.id = "system-warning";
        warning.setAttribute("role", "alert");
        document.body.append(warning);
      }
      warning.textContent =
        "La simulación se detuvo para proteger la consistencia de los datos. Revisa la incidencia antes de reanudar; no se ha confirmado ningún movimiento incompleto.";
    } else warning?.remove();
    if (!online) {
      toast("Conexión recuperada. Estado sincronizado.");
      online = true;
    }
    $("#connection").textContent = "";
    $("#connection").hidden = true;
    $("#connection").classList.remove("offline");
    refreshCurrent();
  } catch (error) {
    if (online) toast("No pudimos actualizar los datos. Reintentaremos automáticamente.", "error");
    online = false;
    $("#connection").hidden = false;
    $("#connection").textContent = "Sin conexión · Reintentando";
    $("#connection").classList.add("offline");
  } finally {
    refreshTimer = setTimeout(
      refresh,
      document.hidden
        ? 5000
        : view === "overview" && isOps()
          ? !state.clock.paused &&
            (activeMissions().length > 0 ||
              state.autonomy?.map?.devices?.some((device) => device.moving) ||
              state.equipment.trucks.some((truck) =>
                [
                  "DOCKING",
                  "OPENING",
                  "LOADING",
                  "VERIFYING",
                  "CLOSING",
                  "UNDOCKING",
                  "OUTBOUND",
                  "RETURNING",
                  "RETURN_PICKUP",
                  "RETURN_CARGO",
                  "UNLOADING_REJECTION",
                  "OPENING_REJECTION",
                ].includes(truck.status),
              ))
            ? 250
            : 1000
          : 2500,
    );
  }
}
async function boot() {
  try {
    const [, initialState] = await Promise.all([reloadIdentity(), api("/api/state?layout=include")]);
    state = normalize(initialState);
    updateClock();
    governance = createGovernance({
      api,
      command,
      showDialog,
      dialog,
      main,
      esc,
      icon,
      toast,
      getState: () => state,
      getUser: () => user,
      reloadIdentity,
    });
    storePortal = createStorePortal({ main, getState: () => state, getUser: () => user, esc, icon, photo, num, badge, showDialog, command, dialog, formIssue, toast });
    if (isAdmin()) {
      $(".sidebar-caption").textContent = "ADMINISTRACIÓN DEL SISTEMA";
      $(".brand").href = "#summary";
    }
    navigate();
    try {
      const sidebar = $("#sidebar");
      sidebar.scrollTop =
        Number(sessionStorage.getItem(`donpepe.sidebar.${user.role}`)) || 0;
      sidebar.addEventListener(
        "scroll",
        () => {
          try {
            sessionStorage.setItem(
              `donpepe.sidebar.${user.role}`,
              String(sidebar.scrollTop),
            );
          } catch {}
        },
        { passive: true },
      );
    } catch {}
    refreshTimer = setTimeout(refresh, 1200);
  } catch (error) {
    main.innerHTML = empty(
      "No pudimos conectar",
      error.message,
      button("Reintentar", "retry"),
    );
    $('[data-action="retry"]')?.addEventListener("click", () =>
      location.reload(),
    );
  }
}
boot();
