"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { lotOverview, packaging } = require("../core/inventory-identification");
const { compactLocationLabel } = require("../core/location-description");
test("12 cajas de 12 unidades son 144 unidades y no generan seriales ficticios", () => {
  const input = [
    {
      id: "HU-1",
      lot: "FAB-1",
      expiry: "2027-01-01",
      state: "STORED",
      cases: 12,
    },
  ];
  const before = structuredClone(input),
    [lot] = lotOverview(input, [], 12);
  assert.equal(lot.units, 144);
  assert.equal(lot.cases, 12);
  assert.equal(lot.loadCount, 1);
  assert.equal(lot.records[0].id, "HU-1");
  assert.equal(lot.records.length, 1);
  assert(!lot.records[0].serials);
  assert.deepEqual(input, before);
});
test("separar una carga conserva lote y cantidad sin sumar nuevamente el grupo de origen", () => {
  const [lot] = lotOverview(
    [
      { id: "HU-1", lot: "A", state: "STORED", cases: 8 },
      { id: "HU-2", parentId: "HU-1", lot: "A", state: "IN_TRANSIT", cases: 4 },
    ],
    [],
    12,
  );
  assert.equal(lot.cases, 12);
  assert.equal(lot.centerCases, 8);
  assert.equal(lot.transitCases, 4);
  assert.equal(lot.loadCount, 2);
  assert.equal(lot.records[1].parentId, "HU-1");
});
test("recepción de tienda no duplica las cargas ya entregadas y mantiene separados lote y vencimiento", () => {
  const lots = lotOverview(
    [
      {
        id: "HU-1",
        lot: "A",
        expiry: "2027-01-01",
        state: "DELIVERED",
        cases: 12,
      },
    ],
    [
      {
        id: "STOCK-1",
        branchId: "TIENDA-1",
        lot: "A",
        expiry: "2027-01-01",
        cases: 12,
      },
      {
        id: "STOCK-2",
        branchId: "TIENDA-1",
        lot: "A",
        expiry: "2027-02-01",
        cases: 2,
      },
    ],
    12,
  );
  assert.equal(lots.length, 2);
  assert.equal(lots[0].cases, 12);
  assert.equal(lots[0].loadCount, 0);
  assert.equal(lots[0].records[0].kind, "stock");
});
test("las diferencias pendientes se muestran aparte y nunca se cuentan como stock recibido", () => {
  const [lot] = lotOverview(
    [{ id: "HU-X", lot: "A", state: "DISCREPANCY", cases: 2 }],
    [],
    6,
  );
  assert.equal(lot.discrepancyCases, 2);
  assert.equal(lot.storeCases, 0);
  assert.equal(lot.centerCases, 0);
  assert.equal(
    lotOverview([{ cases: 0 }, { cases: -1 }, { cases: NaN }], [], 12).length,
    0,
  );
  assert.equal(packaging(2, undefined).units, null);
});
test("las ubicaciones eliminan la sede repetida conservando el detalle de pasillo, rack y nivel", () => {
  assert.equal(
    compactLocationLabel("DonPepe · San Miguel · San Miguel"),
    "DonPepe · San Miguel",
  );
  assert.equal(
    compactLocationLabel(
      "DonPepe · Centro · Reserva seca · Pasillo 01 · Rack 01 · Nivel 02",
    ),
    "DonPepe · Centro · Reserva seca · Pasillo 01 · Rack 01 · Nivel 02",
  );
});
