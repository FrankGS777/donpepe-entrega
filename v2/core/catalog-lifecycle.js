"use strict";
const { Fields, problem } = require("./validation");
const COLLECTIONS = Object.freeze({
  sku: "skus",
  supplier: "suppliers",
  branch: "branches",
  brand: "brands",
  category: "categories",
  asset: "assets",
});
const OPEN_MAINTENANCE = new Set([
  "REQUESTED",
  "APPROVED",
  "WAITING_SAFE",
  "IN_PROGRESS",
]);
const openOrder = (row) =>
  ![
    "RECEIVED",
    "RECEIVED_WITH_DIFFERENCE",
    "CANCELLED",
    "CANCELLED_AFTER_PREPARATION",
  ].includes(row.state);
const openPurchase = (row) => !["RECEIVED", "CANCELLED"].includes(row.state);

function migrateCatalogLifecycle(s) {
  let changed = false;
  for (const key of Object.values(COLLECTIONS))
    for (const row of s.catalog[key] || []) {
      if (row.archivedAt) {
        row.deactivatedAt ||= row.archivedAt;
        delete row.archivedAt;
        changed = true;
      }
      if (row.status === "ARCHIVED") {
        row.status = "INACTIVE";
        changed = true;
      }
    }
  return changed;
}

function changeCatalogStatus(s, kind, action, payload, { safeToService } = {}) {
  const key = COLLECTIONS[kind];
  if (!key || !["deactivate", "activate", "delete"].includes(action))
    problem("Acción de estado desconocida.", 404);
  const row = s.catalog[key]?.find((item) => item.id === payload.id);
  if (!row || row.deletedAt)
    problem("El registro no existe o fue eliminado.", 404);
  const fields = new Fields();
  const reason = fields.string(payload.reason ?? "", "reason", "Motivo", {
    max: 250,
    multiline: true,
  });
  fields.assert();
  const live = (item) => !item.deletedAt;
  if (action === "activate") {
    if (row.active !== false) problem("El registro ya está activo.", 409);
    if (kind === "sku") {
      const supplier = s.catalog.suppliers.find(
        (item) => item.id === row.supplierId && item.active && live(item),
      );
      const brand = s.catalog.brands.find(
        (item) => item.id === row.brandId && item.active && live(item),
      );
      const category = s.catalog.categories.find(
        (item) => item.id === row.categoryId && item.active && live(item),
      );
      if (
        !supplier ||
        !brand ||
        !category ||
        !supplier.zones.includes(row.zoneId) ||
        !brand.supplierIds.includes(supplier.id) ||
        !category.zoneIds.includes(row.zoneId)
      )
        problem(
          "El producto necesita un proveedor, una marca y una categoría activos y compatibles. Revisa sus estados antes de activarlo.",
          409,
        );
    }
    if (
      kind === "brand" &&
      !row.supplierIds?.every((id) =>
        s.catalog.suppliers.some(
          (item) => item.id === id && item.active && live(item),
        ),
      )
    )
      problem(
        "Activa o reemplaza los proveedores vinculados antes de activar la marca.",
        409,
      );
  } else {
    if (action === "deactivate" && row.active === false)
      problem("El registro ya está desactivado.", 409);
    if (action === "delete" && row.active !== false)
      problem("Desactiva el registro antes de eliminarlo.", 409);
    if (
      kind === "sku" &&
      (s.hus.some((item) => item.skuId === row.id && item.cases > 0) ||
        s.storeStock.some((item) => item.skuId === row.id && item.cases > 0) ||
        s.orders.some(
          (item) =>
            openOrder(item) && item.lines.some((line) => line.skuId === row.id),
        ) ||
        s.purchases.some(
          (item) =>
            openPurchase(item) &&
            item.lines.some((line) => line.skuId === row.id),
        ) ||
        s.returns.some(
          (item) => item.skuId === row.id && item.state !== "QUARANTINED",
        ))
    )
      problem(
        "Hay existencias o documentos pendientes de este producto. Resuélvelos antes de cambiar su disponibilidad.",
        409,
      );
    if (kind === "supplier") {
      if (
        s.purchases.some(
          (item) => item.supplierId === row.id && openPurchase(item),
        )
      )
        problem("El proveedor tiene compras pendientes.", 409);
      if (
        s.catalog.skus.some(
          (item) =>
            live(item) &&
            (action === "delete" || item.active) &&
            item.supplierId === row.id,
        )
      )
        problem(
          action === "delete"
            ? "Hay productos vinculados, incluso desactivados. Reasígnalos o elimínalos primero."
            : "El proveedor tiene productos activos vinculados.",
          409,
        );
      if (
        action === "delete" &&
        s.catalog.brands.some(
          (item) => live(item) && item.supplierIds?.includes(row.id),
        )
      )
        problem(
          "Hay marcas vinculadas a este proveedor. Retira esa relación antes de eliminarlo.",
          409,
        );
    }
    if (
      ["brand", "category"].includes(kind) &&
      s.catalog.skus.some(
        (item) =>
          live(item) &&
          (action === "delete" || item.active) &&
          item[`${kind}Id`] === row.id,
      )
    )
      problem(
        action === "delete"
          ? "Hay productos vinculados, incluso desactivados. Reasígnalos o elimínalos primero."
          : "Hay productos activos vinculados. Reasigna o desactiva esos productos antes de continuar.",
        409,
      );
    if (kind === "branch") {
      if (
        s.storeStock.some(
          (item) => item.branchId === row.id && item.cases > 0,
        ) ||
        s.orders.some((item) => item.branchId === row.id && openOrder(item)) ||
        s.returns.some(
          (item) => item.branchId === row.id && item.state !== "QUARANTINED",
        ) ||
        s.trucks.some(
          (item) => item.branchId === row.id && item.state !== "AVAILABLE",
        )
      )
        problem(
          "La sucursal tiene existencias, pedidos, devoluciones o un vehículo en curso.",
          409,
        );
      if (
        action === "delete" &&
        s.catalog.assets.some(
          (item) => item.branchId === row.id && item.active && live(item),
        )
      )
        problem(
          "Desactiva primero los equipos vinculados a esta sucursal.",
          409,
        );
    }
  }
  if (kind === "asset") {
    if (row.pendingSettings)
      problem(
        "Espera a que se aplique la configuración pendiente del equipo.",
        409,
      );
    if (
      s.maintenance.some(
        (item) => item.assetId === row.id && OPEN_MAINTENANCE.has(item.state),
      )
    )
      problem(
        "Finaliza o cancela el mantenimiento abierto antes de cambiar el estado del equipo.",
        409,
      );
    if (!safeToService?.(s, row))
      problem(
        "El equipo tiene carga, un recorrido o una reserva. Espera a que finalice de forma segura.",
        409,
      );
    if (action === "delete" && row.deviceId)
      problem(
        "Este equipo está integrado al circuito físico. Su ficha debe conservarse; puede permanecer desactivado sin recibir trabajos.",
        409,
      );
    if (
      action !== "activate" &&
      row.type === "CHARGER" &&
      s.catalog.assets.some(
        (item) => item.type === "AMR" && item.active && live(item),
      ) &&
      !s.catalog.assets.some(
        (item) =>
          item.id !== row.id &&
          item.type === "CHARGER" &&
          item.active &&
          item.status === "AVAILABLE" &&
          item.settings?.autoAssign !== false &&
          live(item),
      )
    )
      problem(
        "No se puede desactivar el último cargador disponible mientras existan robots activos.",
        409,
      );
    row.status =
      action === "activate"
        ? row.deviceId
          ? "AVAILABLE"
          : "PLANNED"
        : action === "delete"
          ? "DELETED"
          : "INACTIVE";
  }
  row.active = action === "activate";
  row.updatedAt = s.clock.now;
  row[
    `${action === "activate" ? "activated" : action === "delete" ? "deleted" : "deactivated"}At`
  ] = s.clock.now;
  row.statusReason = reason;
  // Tombstones retain immutable IDs, names and document references. They cannot
  // be edited or revived and never re-enter a current catalog or new operation.
  return row.id;
}
module.exports = { COLLECTIONS, changeCatalogStatus, migrateCatalogLifecycle };
