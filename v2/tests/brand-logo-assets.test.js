"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const official = require("../core/brand-logo-assets.json");
const expanded = require("../core/expanded-catalog.json");
const original = require("../core/catalog-assets.json");
const generated = require("../core/brand-illustration-assets.json");
const categoryScenes = require("../core/category-scene-assets.json");
const { createSimulation } = require("../core/engine");
const { migrateRepresentations } = require("../core/catalog-domain");
const publicRoot = path.resolve(__dirname, "../public");
const fallbackRequests = [
  require("../core/brand-logo-fallback-requests.json"),
  require("../core/brand-logo-fallback-requests-2.json"),
  require("../core/brand-logo-fallback-requests-3.json"),
].flatMap(group => group.requests);

function localImage(record) {
  const binary = fs.readFileSync(path.join(publicRoot, record.imageUrl));
  assert.equal(binary.toString("ascii", 0, 4), "RIFF", record.id);
  assert.equal(binary.toString("ascii", 8, 12), "WEBP", record.id);
  assert.equal(binary.readUInt32LE(4) + 8, binary.length, record.id);
  assert.ok(binary.length > 500 && binary.length < 1000000, record.id);
  return binary;
}

test("official logos and researched missing identities cover all 89 brand masters exactly once", () => {
  const sim = createSimulation();
  try {
    const brands = sim.snapshot({ id: "brand-media-audit", role: "admin" }).catalog.brands;
    const brandIds = new Set(brands.map(brand => brand.id));
    assert.equal(brandIds.size, 89);
    assert.equal(official.audit.expectedBrands, brands.length);
    assert.equal(official.audit.obtainedOfficialLogos, official.brands.length);
    assert.equal(official.audit.missingOfficialAssets, official.missing.length);
    const officialIds = new Set(official.brands.map(brand => brand.id));
    assert.equal(officialIds.size, official.brands.length);
    const missingIds = new Set(official.missing.map(brand => brand.id));
    assert.equal(missingIds.size, official.missing.length);
    assert.equal(officialIds.size + missingIds.size, brands.length);
    for (const id of brandIds) assert.notEqual(officialIds.has(id), missingIds.has(id), id);
    assert.deepEqual(new Set(fallbackRequests.map(request => request.id)), missingIds);
    assert.equal(fallbackRequests.length, missingIds.size);
    for (const brand of official.brands) {
      assert.ok(brandIds.has(brand.id), brand.id);
      const actual = brands.find(record => record.id === brand.id);
      assert.equal(actual.imageUrl, brand.imageUrl);
      assert.equal(actual.imageKind, "OFFICIAL_BRAND_LOGO");
      assert.equal(actual.preferredBackground, brand.preferredBackground);
    }
  } finally { sim.close(); }
});

test("each official logo is a local raster with an intact hash, not a source SVG or executable", () => {
  const urls = new Set();
  for (const brand of official.brands) {
    assert.match(brand.imageUrl, /^\/images\/brands\/[a-z0-9-]+\.webp$/);
    assert.ok(!urls.has(brand.imageUrl), brand.imageUrl);
    urls.add(brand.imageUrl);
    const binary = fs.readFileSync(path.join(publicRoot, brand.imageUrl));
    assert.equal(binary.toString("ascii", 0, 4), "RIFF", brand.id);
    assert.equal(binary.toString("ascii", 8, 12), "WEBP", brand.id);
    assert.equal(binary.length, brand.imageBytes, brand.id);
    assert.ok(binary.length > 500 && binary.length < 1000000, brand.id);
    assert.equal(crypto.createHash("sha256").update(binary).digest("hex"), brand.imageSha256, brand.id);
    assert.match(brand.sourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(brand.imageKind, "OFFICIAL_BRAND_LOGO");
  }
});

test("official source provenance and complete-logo normalization are explicit", () => {
  assert.equal(official.audit.productPackshotsUsedAsLogos, false);
  assert.equal(official.audit.fullLogoContainWithoutCrop, true);
  assert.equal(official.audit.generatedRepresentations, 0);
  for (const brand of official.brands) {
    assert.equal(new URL(brand.imageSourceUrl).protocol, "https:");
    assert.equal(new URL(brand.referenceUrl).protocol, "https:");
    assert.ok(brand.sourceOrganization && brand.verifiedOn);
    assert.equal(brand.sourceType, "OFFICIAL_BRAND_OR_MANUFACTURER");
    assert.match(brand.normalization, /Full logo, contain/);
    assert.match(brand.normalization, /no cropping, product packaging or AI recreation/);
    assert.ok(["dark", "light"].includes(brand.preferredBackground), brand.id);
  }
  const inline = official.brands.find(brand => brand.id === "BRAND-TRIDENT");
  assert.equal(inline.extractionSelector, "svg.styles_logo__i2qid");
  assert.match(inline.extractionMethod, /Complete official header SVG/);
});

test("brand logos do not reuse the original or imported product packshot bytes", () => {
  const productDigests = new Set([...original.products, ...expanded.products].map(product => {
    const binary = fs.readFileSync(path.join(publicRoot, product.imageUrl));
    return crypto.createHash("sha256").update(binary).digest("hex");
  }));
  for (const brand of official.brands) assert.ok(!productDigests.has(brand.imageSha256), brand.id);
});

test("homonymous brands resolve to their correct primary organizations and current market", () => {
  const byId = Object.fromEntries(official.brands.map(brand => [brand.id, brand]));
  assert.match(byId["BRAND-DEL-VALLE"].referenceUrl, /delvallehuyro\.com/);
  assert.match(byId["BRAND-FRUGOS"].referenceUrl, /coca-cola\.com/);
  assert.match(byId["BRAND-CARTAVIO"].referenceUrl, /coazucar\.com/);
  assert.match(byId["BRAND-SAN-MATEO"].referenceUrl, /gloria\.com\.pe/);
  assert.match(byId["BRAND-DULFINA"].referenceUrl, /agroparamonga\.com/);
  assert.match(byId["BRAND-ROMEX"].referenceUrl, /romex\.pe/);
  assert.match(byId["BRAND-RITZ"].imageSourceUrl, /RITZ_Logo_US_2023-09_100\.png/);
  assert.ok(!/ISLAND/i.test(byId["BRAND-RITZ"].imageSourceUrl));
});

test("white official logos have a dark contrast preference without recoloring", () => {
  const dark = official.brands.filter(brand => brand.preferredBackground === "dark").map(brand => brand.id).sort();
  assert.deepEqual(dark, ["BRAND-B-D", "BRAND-FLORIDA", "BRAND-INKA-CHIPS", "BRAND-SAN-FERNANDO"]);
});

test("fallback decisions disclose searches and limitations without asserting official identity", () => {
  for (const request of fallbackRequests) {
    assert.ok(request.name && request.category && request.reason, request.id);
    assert.ok(request.searches.length >= 2, request.id);
    assert.ok(request.attemptedReferences.length >= 1, request.id);
    assert.ok(request.suggestedColors.length >= 1, request.id);
    for (const url of request.attemptedReferences) assert.equal(new URL(url).protocol, "https:");
  }
  const researchedIds = new Set(fallbackRequests.map(request => request.id));
  const generatedIds = new Set(generated.brands.map(brand => brand.id));
  assert.equal(generated.brands.length, 27);
  assert.equal(generatedIds.size, generated.brands.length);
  assert.deepEqual(generatedIds, researchedIds);
  assert.deepEqual(generatedIds, new Set(official.missing.map(brand => brand.id)));
  for (const brand of generated.brands) {
    assert.equal(brand.imageKind, "GENERATED_BRAND_REPRESENTATION");
    assert.match(brand.imageUrl, /^\/images\/brands\/illustration-[a-z0-9-]+\.webp$/);
    localImage(brand);
  }
});

test("effective snapshot has all 89 logos and all 18 category scenes with no remaining product references", () => {
  const sim = createSimulation();
  try {
    const catalog = sim.snapshot({ id: "complete-media-audit", role: "admin" }).catalog;
    const byId = new Map([...official.brands, ...generated.brands].map(brand => [brand.id, brand]));
    assert.equal(byId.size, 89);
    assert.equal(catalog.brands.length, 89);
    assert.equal(catalog.categories.length, 18);
    const productPaths = new Set(catalog.skus.map(sku => sku.imageUrl));
    const productDigests = new Set(catalog.skus.map(sku => crypto.createHash("sha256").update(fs.readFileSync(path.join(publicRoot, sku.imageUrl))).digest("hex")));
    const paths = new Set();
    for (const brand of catalog.brands) {
      const source = byId.get(brand.id);
      assert.ok(source, brand.id);
      assert.equal(brand.imageUrl, source.imageUrl, brand.id);
      assert.equal(brand.imageKind, source.imageKind, brand.id);
      assert.ok(!productPaths.has(brand.imageUrl), brand.id);
      assert.ok(!productDigests.has(crypto.createHash("sha256").update(localImage(brand)).digest("hex")), brand.id);
      assert.ok(!paths.has(brand.imageUrl), brand.id);
      paths.add(brand.imageUrl);
    }
    const scenesById = new Map(categoryScenes.categories.map(category => [category.id, category]));
    assert.equal(scenesById.size, 18);
    assert.equal(categoryScenes.categories.length, 18);
    for (const category of catalog.categories) {
      const source = scenesById.get(category.id);
      assert.ok(source, category.id);
      assert.equal(category.imageKind, "GENERATED_CATEGORY_SCENE");
      assert.equal(category.imageUrl, source.imageUrl, category.id);
      assert.match(category.imageUrl, /^\/images\/categories\/[a-z0-9-]+\.webp$/);
      assert.ok(category.imageGeneratedOn, category.id);
      assert.ok(!productPaths.has(category.imageUrl), category.id);
      assert.ok(!productDigests.has(crypto.createHash("sha256").update(localImage(category)).digest("hex")), category.id);
      assert.ok(!paths.has(category.imageUrl), category.id);
      paths.add(category.imageUrl);
    }
  } finally { sim.close(); }
});

test("media migration upgrades old packshots idempotently but preserves administrator uploads and edited images", () => {
  const untouchedOfficial = { id: official.brands[0].id, name: "Nombre intacto", imageUrl: "/images/catalog/old-packshot.webp", imageKind: "REAL_PRODUCT_REFERENCE" };
  const untouchedGenerated = { id: generated.brands[0].id, name: "Nombre generado intacto", imageUrl: "/images/expanded/old-packshot.webp", imageKind: "REAL_PRODUCT_REFERENCE" };
  const brandUpload = { id: official.brands[1].id, imageUrl: `/images/catalog/uploads/${"a".repeat(64)}.png`, imageKind: "USER_IMAGE", updatedAt: "2026-10-18T12:00:00Z", description: "Imagen elegida por el usuario" };
  const editedReference = { id: official.brands[2].id, imageUrl: "/images/expanded/chosen-image.webp", imageKind: "USER_IMAGE", updatedAt: "2026-10-18T12:00:00Z", referenceUrl: "https://example.com/custom-source" };
  const externalCustom = { id: generated.brands[1].id, imageUrl: "https://example.com/my-brand.png", imageKind: "USER_IMAGE", name: "Identidad propia" };
  const categoryUpload = { id: categoryScenes.categories[0].id, imageUrl: `/images/catalog/uploads/${"b".repeat(64)}.png`, imageKind: "USER_IMAGE", updatedAt: "2026-10-18T12:00:00Z" };
  const untouchedCategory = { id: categoryScenes.categories[1].id, imageUrl: "/images/catalog/old-category-packshot.webp", imageKind: "REAL_PRODUCT_REFERENCE" };
  const preserved = [brandUpload, editedReference, externalCustom, categoryUpload].map(record => structuredClone(record));
  const state = { catalog: { brands: [untouchedOfficial, untouchedGenerated, brandUpload, editedReference, externalCustom], categories: [categoryUpload, untouchedCategory] } };
  assert.equal(migrateRepresentations(state), true);
  assert.equal(untouchedOfficial.imageKind, "OFFICIAL_BRAND_LOGO");
  assert.equal(untouchedOfficial.imageUrl, official.brands[0].imageUrl);
  assert.equal(untouchedOfficial.name, "Nombre intacto");
  assert.equal(untouchedGenerated.imageKind, "GENERATED_BRAND_REPRESENTATION");
  assert.equal(untouchedGenerated.imageUrl, generated.brands[0].imageUrl);
  assert.equal(untouchedCategory.imageKind, "GENERATED_CATEGORY_SCENE");
  assert.equal(untouchedCategory.imageUrl, categoryScenes.categories[1].imageUrl);
  for (const [index, actual] of [brandUpload, editedReference, externalCustom, categoryUpload].entries()) assert.deepEqual(actual, preserved[index]);
  const after = structuredClone(state);
  assert.equal(migrateRepresentations(state), false);
  assert.deepEqual(state, after);
});
