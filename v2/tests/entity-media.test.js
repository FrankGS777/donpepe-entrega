"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSimulation } = require("../core/engine");
const source = fs.readFileSync(path.join(__dirname, "../frontend/entity-media.js"), "utf8");
const library = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const root = path.resolve(__dirname, "../..");
const existing = url => [path.join(root, "v2/public", url), path.join(root, "public", url)].some(file => fs.existsSync(file));

test("every currently selectable entity resolves a valid local reference or an explicit illustration", async t => {
  const { resolveMapReference, MAP_REFERENCE_TYPES } = await library;
  const simulation = createSimulation({ filename: ":memory:" }); t.after(() => simulation.close());
  const state = simulation.snapshot({ id: "MEDIA-REVIEW", role: "operations" });
  const cases = [
    { type: "warehouse", id: "CD1" },
    ...state.layout.zones.map(item => ({ type: "zone", id: item.id })),
    ...state.layout.racks.map(item => ({ type: "rack", id: item.id })),
    ...state.layout.locations.map(item => ({ type: "loc", id: item.id })),
    ...state.layout.stations.map(item => ({ type: "station", id: item.id })),
    ...state.catalog.branches.map(item => ({ type: "branch", id: item.id })),
    ...state.equipment.robots.map(item => ({ type: "robot", id: item.id })),
    ...state.equipment.trucks.map(item => ({ type: "truck", id: item.id })),
    ...state.catalog.assets.map(item => ({ type: "asset", id: item.id })),
    ...state.hus.map(item => ({ type: "hu", id: item.id })),
  ];
  assert.ok(cases.length > 150, "coverage includes every seeded rack, position, asset and load");
  for (const selection of cases) {
    assert.ok(MAP_REFERENCE_TYPES.includes(selection.type));
    const reference = resolveMapReference(state, selection);
    assert.ok(reference.alt && reference.caption);
    if (reference.kind === "illustration") assert.match(reference.imageUrl, /^data:image\/svg\+xml,/);
    else assert.ok(existing(reference.imageUrl), `${selection.type}:${selection.id} -> ${reference.imageUrl}`);
  }
});

test("loads, mobile equipment, fixed assets and shops use their own registered subject", async t => {
  const { resolveMapReference } = await library;
  const simulation = createSimulation({ filename: ":memory:" }); t.after(() => simulation.close());
  const state = simulation.snapshot({ id: "MEDIA-REVIEW", role: "operations" }), hu = state.hus[0],
    sku = state.catalog.skus.find(item => item.id === hu.skuId), robot = state.equipment.robots[0],
    asset = state.catalog.assets.find(item => item.deviceId === robot.id), branch = state.catalog.branches[0];
  assert.equal(resolveMapReference(state, { type: "hu", id: hu.id }).imageUrl, sku.imageUrl);
  assert.equal(resolveMapReference(state, { type: "robot", id: robot.id }).imageUrl, asset.imageUrl);
  assert.equal(resolveMapReference(state, { type: "equipment", id: robot.id }).imageUrl, asset.imageUrl);
  assert.equal(resolveMapReference(state, { type: "asset", id: asset.id }).imageUrl, asset.imageUrl);
  assert.equal(resolveMapReference(state, { type: "branch", id: branch.id }).imageUrl, branch.imageUrl);
  assert.match(resolveMapReference(state, { type: "rack", id: state.layout.racks[0].id }).caption, /Referencia del sistema/);
  state.missions = [{ id: "MISSION-1", huId: hu.id }];
  assert.equal(resolveMapReference(state, { type: "mission", id: "MISSION-1" }).imageUrl, sku.imageUrl);
  assert.equal(resolveMapReference(state, { type: "component", id: "PART-1", assetId: asset.id }).imageUrl, asset.imageUrl);
});

test("a missing reference is illustrated without borrowing another product or phantom asset", async () => {
  const { resolveMapReference } = await library;
  const snapshot = { catalog: { skus: [{ id: "OTHER", imageUrl: "/images/catalog/sku-arroz.webp" }], assets: [{ id: "UNRELATED", name: "Unrelated machine", imageUrl: "/images/representations/equipment-amr.webp" }] }, hus: [{ id: "HU", skuId: "MISSING" }] };
  assert.equal(resolveMapReference(snapshot, { type: "hu", id: "HU" }).kind, "illustration");
  assert.equal(resolveMapReference(snapshot, { type: "station", id: "NO-STATION" }).kind, "illustration");
  assert.equal(resolveMapReference(snapshot, { type: "component", id: "NO-ASSET" }).kind, "illustration");
  assert.equal(resolveMapReference(snapshot, { type: "new-future-selection", id: "anything" }).kind, "illustration");
});

test("reference paths and captions reject traversal and escape editable entity names", async () => {
  const { localReferenceImage, mapReferenceMarkup } = await library;
  for (const unsafe of ["https://example.com/photo.png", "/images/../private.png", "/images/%2e%2e/private.png", "data:text/html,hello", "/images/a.png?value=1", "/images/a.png\" onerror=\"bad"])
    assert.equal(localReferenceImage(unsafe), "");
  const html = mapReferenceMarkup({ catalog: { branches: [{ id: "B", name: '<script>alert("x")</script>', imageUrl: "/images/representations/branch-san-miguel.webp" }] } }, { type: "branch", id: "B" });
  assert.doesNotMatch(html, /<script>|onerror=/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /data-map-reference/);
});

test("a failed photograph switches once to a labelled inline illustration", async () => {
  const { installMapReferenceFallback } = await library;
  let listener;
  installMapReferenceFallback({ addEventListener(type, callback, capture) { assert.equal(type, "error"); assert.equal(capture, true); listener = callback; } });
  const caption = { textContent: "Photo" }, figure = { dataset: {}, querySelector: () => caption },
    image = { dataset: { mapReferenceType: "rack" }, matches: () => true, closest: () => figure, src: "/images/missing.jpg", alt: "Photo" };
  listener({ target: image });
  assert.match(image.src, /^data:image\/svg\+xml,/);
  assert.equal(figure.dataset.referenceKind, "illustration");
  assert.equal(caption.textContent, "Representación del elemento seleccionado");
  const first = image.src; listener({ target: image }); assert.equal(image.src, first);
});
