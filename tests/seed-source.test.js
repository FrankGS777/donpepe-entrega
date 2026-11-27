const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("los datos con apóstrofos se insertan mediante parámetros", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "database", "seed.js"),
    "utf8",
  );
  assert.match(source, /INSERT INTO marcas[\s\S]*?VALUES \(\?,\?,\?\)/);
  assert.match(source, /pool\.execute\([\s\S]*?brand/);
  assert.doesNotMatch(source, /\(20,'D'Onofrio'/);
});

test("Docker migra en cada arranque y solo siembra una base vacía", () => {
  const root = path.join(__dirname, "..");
  const compose = fs.readFileSync(
    path.join(root, "docker-compose.yml"),
    "utf8",
  );
  const startup = fs.readFileSync(
    path.join(root, "database", "startup.js"),
    "utf8",
  );
  assert.match(compose, /node database\/startup\.js/);
  assert.doesNotMatch(compose, /node database\/seed\.js/);
  assert.match(startup, /await ensureMigrations\(\)/);
  assert.match(startup, /Number\(state\.usuarios\) === 0/);
  assert.match(startup, /await seed\(\)/);
});

test("el escenario demo es variado, completo y coherente", () => {
  const {
    categories,
    brands,
    providers,
    zones,
    locations,
    products,
  } = require("../database/demoData");
  assert.ok(categories.length >= 10);
  assert.ok(brands.length >= 25);
  assert.ok(providers.length >= 6);
  assert.equal(zones.length, 15);
  assert.equal(locations.length, 19);
  assert.ok(products.length >= 40);
  assert.equal(new Set(products.map((item) => item.sku)).size, products.length);
  assert.equal(
    new Set(products.map((item) => item.barcode)).size,
    products.length,
  );
  for (const item of products) {
    assert.ok(item.sku && item.barcode && item.name);
    assert.match(item.imageUrl, /^https:\/\//);
    assert.match(item.referenceUrl, /^https:\/\//);
    assert.ok(item.cost >= 0 && item.price > item.cost);
    assert.ok(item.minimum >= 0 && item.weight > 0 && item.volume > 0);
    assert.ok(item.pickLocationId > 0 && item.pickTarget > 0);
    assert.ok(item.pickQty > 0 && item.reserveQty > 0);
    assert.ok(providers.some(([id]) => id === item.providerId));
  }
  for (const provider of providers) {
    assert.match(provider[5], /^https:\/\//);
    assert.match(provider[6], /^https:\/\//);
  }
  const bySku = new Map(products.map((item) => [item.sku, item]));
  assert.equal(bySku.get("SKU-ABA-0004").providerId, 3);
  assert.equal(bySku.get("SKU-BEB-0005").providerId, 1);
  assert.equal(bySku.get("SKU-MAS-0034").providerId, 5);
  assert.equal(bySku.get("SKU-MAS-0035").providerId, 5);
});

test("la orden de compra limita el catálogo al proveedor en cliente y servidor", () => {
  const template = fs.readFileSync(
    path.join(__dirname, "..", "views", "compras", "form.ejs"),
    "utf8",
  );
  const browser = fs.readFileSync(
    path.join(__dirname, "..", "public", "js", "purchase.js"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.join(__dirname, "..", "services", "purchaseService.js"),
    "utf8",
  );
  assert.match(template, /id="purchaseProduct"[\s\S]*?disabled/);
  assert.match(template, /data-provider-id/);
  assert.match(browser, /option\.dataset\.providerId === providerId/);
  assert.match(browser, /Ese SKU no pertenece al proveedor/);
  assert.match(service, /activo=1 AND proveedor_id=\?/);
  assert.match(service, /no pertenecen al proveedor seleccionado/);
});

test("la topología demo conserva solo zonas y LOC justificadas", () => {
  const { zones, locations, products } = require("../database/demoData");
  const {
    locationProfile,
    isTypeAllowedInZone,
  } = require("../config/warehouse");
  assert.deepEqual(
    zones.map((zone) => zone[1]),
    [
      "REC",
      "SEC-B",
      "VEN",
      "FRI",
      "CON",
      "QUA",
      "DSP",
      "SEC-A",
      "SEC-C",
      "DSP-F",
      "DSP-C",
      "REC-F",
      "REC-C",
      "QUA-F",
      "QUA-C",
    ],
  );
  assert.equal(
    locations.filter((location) => location[6] === "PICKING").length,
    3,
  );
  assert.equal(
    locations.filter((location) => location[6] === "DESPACHO").length,
    3,
  );
  assert.equal(
    locations.some((location) => [6, 7, 8, 9, 10].includes(location[0])),
    false,
  );
  const zoneById = new Map(zones.map((zone) => [zone[0], zone]));
  for (const location of locations) {
    const zone = zoneById.get(location[2]);
    const profile = locationProfile(location[6]);
    assert.ok(zone && profile);
    assert.equal(isTypeAllowedInZone(location[6], zone[1]), true);
    assert.deepEqual(location.slice(10, 14), [
      Number(profile.permite_recepcion),
      Number(profile.permite_almacenaje),
      Number(profile.permite_picking),
      Number(profile.permite_conteo),
    ]);
  }
  const activePickingIds = new Set(
    locations
      .filter((location) => location[6] === "PICKING" && location[14])
      .map((location) => location[0]),
  );
  for (const item of products)
    assert.ok(activePickingIds.has(item.pickLocationId));
  for (const item of products.filter((product) => product.categoryId === 11))
    assert.equal(item.pickLocationId, 12);
});
