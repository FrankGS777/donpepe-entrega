"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { explainMovement } = require("../core/movement-presentation");
const { createSimulation } = require("../core/engine");
const { readMovements } = require("../core/inventory-kardex");

const origin = {
  id: "RECEIVE",
  label: "Recepción del centro",
  scope: "WAREHOUSE",
};
const device = { id: "AMR-1", label: "Robot móvil 1", scope: "DEVICE" };
const truck = { id: "TRUCK-1", label: "Unidad 1", scope: "TRANSPORT" };
const branch = {
  id: "TIENDA-1",
  label: "DonPepe · San Miguel",
  scope: "STORE",
  branchId: "TIENDA-1",
};
const explain = (type, from = origin, to = device, extra = {}) =>
  explainMovement({ type, cases: 4, from, to, ...extra });

test("la explicación distingue entrada de proveedor y traslado o recepción de las mismas cajas", () => {
  assert.equal(explain("RECEIPT").effect, "ENTRY");
  for (const type of [
    "TRANSFER",
    "SPLIT",
    "DISPATCH",
    "STORE_RECEIPT",
    "RETURN",
  ])
    assert.equal(explain(type).effect, "MOVE", type);
  assert.equal(explain("OPENING").effect, "BASELINE");
  for (const type of [
    "QUALITY_HOLD",
    "QUALITY_RELEASE",
    "DIFFERENCE",
    "STATUS",
  ])
    assert.equal(explain(type).effect, "STATE", type);
  assert.match(
    explain("STORE_RECEIPT", truck, branch).summary,
    /no es una entrada nueva/,
  );
  assert.match(explain("SPLIT").summary, /carga de origen.*lote/);
  assert.match(explain("OPENING").summary, /No es una compra nueva/);
});

test("cada transferencia muestra la acción física sin confundir carga, descarga o almacenamiento", () => {
  assert.equal(explain("TRANSFER", origin, truck).title, "Carga en el camión");
  assert.equal(explain("TRANSFER", truck, device).title, "Descarga del camión");
  assert.equal(
    explain("TRANSFER", device, { id: "DOCK-1" }).title,
    "Traslado al muelle",
  );
  assert.equal(
    explain("TRANSFER", device, { id: "PACK" }).title,
    "Llegada a preparación",
  );
  assert.equal(
    explain("TRANSFER", device, origin, { targetState: "STORED" }).title,
    "Almacenamiento confirmado",
  );
  assert.equal(
    explain("TRANSFER", origin, device).title,
    "Recogida por un equipo",
  );
  assert.equal(
    explain("TRANSFER", device, device).title,
    "Posición de la carga actualizada",
  );
  assert.match(explain("TRANSFER", device, device).summary, /misma custodia/);
});

test("el saldo de una venta o baja pertenece al origen y se explica como histórico, no stock actual", () => {
  for (const type of ["STORE_SALE", "WRITE_OFF"]) {
    const result = explain(type, branch, { id: "SALE", label: "Venta" });
    assert.equal(result.effect, "EXIT");
    assert.equal(result.balanceLocation, branch.label);
    assert.match(result.balanceMeaning, /justo después.*no es el stock actual/);
  }
  assert.equal(
    explain("TRANSFER", origin, device).balanceLocation,
    device.label,
  );
});

test("la explicación se deriva después de aislar la sucursal y no filtra direcciones internas", () => {
  const row = {
    id: "MOV-1",
    type: "STORE_RECEIPT",
    cases: 4,
    at: "2026-10-27T10:00:00Z",
    from: {
      id: "PRIVATE-CD",
      label: "Ubicación interna confidencial",
      scope: "WAREHOUSE",
    },
    to: branch,
    networkBalanceCases: 90,
  };
  const storage = {
    queryMovements: () => ({
      items: [structuredClone(row)],
      total: 1,
      types: ["STORE_RECEIPT"],
    }),
    kardexMetadata: () => ({}),
  };
  const result = readMovements(storage, {
    id: "STORE",
    role: "store",
    branchId: branch.id,
  });
  assert.equal(result.items[0].networkBalanceCases, null);
  assert.match(result.items[0].explanation.summary, /Centro de distribución/);
  assert(!JSON.stringify(result).includes("confidencial"));
  assert(!JSON.stringify(result).includes("PRIVATE-CD"));
});

test("explicar movimientos conserva cantidades y evidencia originales", (t) => {
  const simulation = createSimulation();
  t.after(() => simulation.close());
  const actor = { id: "OPS", role: "operations" };
  const before = simulation.snapshot(actor);
  const report = simulation.movements(actor, { skuId: "SKU-ARROZ" });
  assert(report.items.every((row) => row.explanation.effect === "BASELINE"));
  assert.equal(
    report.items.reduce((n, row) => n + row.cases, 0),
    30,
  );
  assert.deepEqual(simulation.snapshot(actor).hus, before.hus);
  assert.deepEqual(simulation.snapshot(actor).orders, before.orders);
});
