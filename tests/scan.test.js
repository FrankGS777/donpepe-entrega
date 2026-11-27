const test = require("node:test");
const assert = require("node:assert/strict");
const { parseScan, fieldValue } = require("../utils/scanCode");
test("QR estructurado y JSON conservan SKU, lote y vencimiento", () => {
  for (const raw of [
    "SKU=SKU-01|LOT=FAB-12|EXP=20261231",
    '{"SKU":"SKU-01","LOT":"FAB-12","EXP":"2026-12-31"}',
  ]) {
    const scan = parseScan(raw);
    assert.equal(scan.sku, "SKU-01");
    assert.equal(scan.lot, "FAB-12");
    assert.equal(scan.term, "FAB-12");
    assert.equal(scan.expiry, "2026-12-31");
  }
});
test("EAN y LOC sin estructura se buscan literalmente; lecturas excesivas se rechazan", () => {
  assert.equal(parseScan(" 7751234567890 ").term, "7751234567890");
  assert.equal(
    parseScan("CD1-SEC-A-A01-R01-N01-C01-D01").term,
    "CD1-SEC-A-A01-R01-N01-C01-D01",
  );
  assert.equal(parseScan("a".repeat(1001)).term, "");
  assert.equal(parseScan("").term, "");
});
test("la confirmación solo aplica tipos compatibles en campos LOC y SKU", () => {
  const scan = parseScan("LOT=FAB-12|SKU=SKU-01");
  assert.equal(
    fieldValue(
      scan,
      {
        tipo: "LOTE",
        codigo: "L-000012",
        sku: "SKU-01",
        numero_lote: "FAB-12",
      },
      "lote",
    ),
    "FAB-12",
  );
  assert.equal(
    fieldValue(
      scan,
      { tipo: "LOTE", codigo: "L-000012", sku: "SKU-01" },
      "origen_loc",
    ),
    "",
  );
  assert.equal(
    fieldValue(scan, { tipo: "LOC", codigo: "CD1-LOC" }, "destino_loc"),
    "CD1-LOC",
  );
  assert.equal(
    fieldValue(
      scan,
      { tipo: "SKU", codigo: "SKU-01", sku: "SKU-01" },
      "producto",
    ),
    "SKU-01",
  );
});
