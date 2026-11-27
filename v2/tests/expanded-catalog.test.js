"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const catalog = require("../core/expanded-catalog.json");
const original = require("../core/catalog-assets.json");
const { validGtin } = require("../scripts/import-verified-catalog.cjs");
const normalize = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const canonicalGtin = (value) => value.padStart(14, "0");
const publicRoot = path.resolve(__dirname, "../public");

test("expanded masters add at least 100 real product identities without replacing original twelve", () => {
  assert.ok(catalog.products.length >= 100);
  const legacyIds = new Set(original.products.map((product) => product.id));
  const legacyCodes = new Set(
    original.products.map((product) => canonicalGtin(product.barcode)),
  );
  const ids = new Set(),
    codes = new Set(),
    barcodes = new Set(),
    sources = new Set();
  for (const product of catalog.products) {
    assert.ok(!legacyIds.has(product.id), product.id);
    assert.ok(!legacyCodes.has(canonicalGtin(product.barcode)), product.name);
    assert.ok(!ids.has(product.id), product.id);
    ids.add(product.id);
    assert.ok(!codes.has(product.code), product.code);
    codes.add(product.code);
    assert.ok(!sources.has(product.sourceProductId), product.sourceProductId);
    sources.add(product.sourceProductId);
    assert.ok(!barcodes.has(canonicalGtin(product.barcode)), product.barcode);
    barcodes.add(canonicalGtin(product.barcode));
    assert.ok(validGtin(product.barcode), product.barcode);
  }
});

test("brand and category masters have unique normalized identities and real representative images", () => {
  for (const records of [catalog.brands, catalog.categories]) {
    assert.equal(
      new Set(records.map((record) => record.id)).size,
      records.length,
    );
    assert.equal(
      new Set(records.map((record) => normalize(record.name))).size,
      records.length,
    );
    for (const record of records) {
      assert.ok(
        record.name && record.code && record.description && record.imageUrl,
      );
      assert.ok(record.imageUrl.startsWith("/images/expanded/"));
      assert.ok(fs.existsSync(path.join(publicRoot, record.imageUrl)));
    }
  }
  for (const brand of catalog.brands) {
    assert.equal(brand.imageKind, "REAL_PRODUCT_REFERENCE");
    assert.deepEqual(brand.supplierIds, ["PROV-1"]);
    const sample = catalog.products.find(
      (product) => product.brandId === brand.id,
    );
    assert.ok(sample);
    assert.equal(normalize(sample.brand), normalize(brand.name));
    assert.deepEqual(
      fs.readFileSync(path.join(publicRoot, sample.imageUrl)),
      fs.readFileSync(path.join(publicRoot, brand.imageUrl)),
    );
  }
});

test("every catalog relationship resolves and Vega's products fit their declared storage zone", () => {
  for (const product of catalog.products) {
    const brand = catalog.brands.find(
      (record) => record.id === product.brandId,
    );
    const category = catalog.categories.find(
      (record) => record.id === product.categoryId,
    );
    const supplier = catalog.suppliers.find(
      (record) => record.id === product.supplierId,
    );
    assert.ok(brand && category && supplier, product.id);
    assert.equal(normalize(product.brand), normalize(brand.name));
    assert.equal(normalize(product.category), normalize(category.name));
    assert.ok(category.zoneIds.includes(product.zoneId));
    assert.ok(supplier.zones.includes(product.zoneId));
    assert.equal(product.zoneId, "DRY");
    assert.equal(product.temperature, "AMBIENT");
    assert.equal(product.expiryControlled, true);
    assert.match(product.sourceSeller, /vega/i);
  }
});

test("each photograph is a valid local WebP with an intact supplier-source digest", () => {
  for (const product of catalog.products) {
    const filename = path.join(publicRoot, product.imageUrl);
    const binary = fs.readFileSync(filename);
    assert.equal(binary.toString("ascii", 0, 4), "RIFF", filename);
    assert.equal(binary.toString("ascii", 8, 12), "WEBP", filename);
    assert.equal(binary.length, product.imageBytes, filename);
    assert.equal(
      crypto.createHash("sha256").update(binary).digest("hex"),
      product.imageSha256,
      filename,
    );
    assert.ok(binary.length > 1000 && binary.length < 150000, filename);
    const source = new URL(product.sourceImageUrl);
    assert.match(
      source.hostname,
      /^(?:vegaperu\.vteximg\.com\.br|vegaperu\.vtexassets\.com)$/,
    );
  }
});

test("supplier evidence and GTIN provenance stay separate from fictional case-pack and stock settings", () => {
  for (const product of catalog.products) {
    const reference = new URL(product.referenceUrl),
      source = new URL(product.sourceApiUrl);
    assert.equal(reference.hostname, "www.vega.pe");
    assert.equal(source.hostname, "www.vega.pe");
    assert.equal(
      source.searchParams.get("fq"),
      `productId:${product.sourceProductId}`,
    );
    assert.ok(
      product.sourceItemId && product.sourceCategoryPath && product.verifiedOn,
    );
    assert.match(product.logisticsNote, /parámetros de simulación/);
    assert.ok(
      !("stock" in product) &&
        !("quantity" in product) &&
        !("available" in product),
    );
  }
  assert.equal(catalog.audit.initialStockCreated, false);
  assert.equal(catalog.audit.generatedCommercialPackaging, false);
  assert.equal(catalog.audit.imageSource, "REAL_SUPPLIER_PHOTOGRAPHS");
});

test("checksum validation rejects malformed, fabricated or typoed supplier codes", () => {
  for (const barcode of [
    "",
    "75E+12",
    "775024306800012",
    "7750243072367",
    "200192",
    " 7750243072366",
    "not-a-barcode",
  ])
    assert.equal(validGtin(barcode), false, barcode);
  for (const barcode of ["7750243072366", "737186755881"])
    assert.equal(validGtin(barcode), true, barcode);
});
