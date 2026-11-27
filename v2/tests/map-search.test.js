"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSimulation } = require("../core/engine");
const source = fs.readFileSync(path.join(__dirname, "../frontend/map-search.js"), "utf8");
const library = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("exact warehouse, rack, LOC and station identifiers outrank broad prefixes", async t => {
  const { searchMapEntities } = await library;
  const simulation = createSimulation({ filename: ":memory:" }); t.after(() => simulation.close());
  const state = simulation.snapshot({ id: "SEARCH-REVIEW", role: "operations" });
  assert.equal(searchMapEntities(state, "CD1")[0].type, "warehouse");
  for (const [type, collection] of [["rack", "racks"], ["loc", "locations"], ["station", "stations"]]) {
    for (const item of state.layout[collection]) {
      const first = searchMapEntities(state, item.code || item.id)[0];
      assert.deepEqual([first.type, first.id], [type, item.id]);
    }
  }
  assert.deepEqual(searchMapEntities(state, "dock1")[0].id, "DOCK-1");
  assert.ok(searchMapEntities(state, "cd1").length <= 8);
});

test("existing live entities remain searchable and product formatting is preserved", async () => {
  const { searchMapEntities } = await library;
  const state = { equipment: { robots: [{ id: "R1", name: "Robot activo", status: "IDLE" }], trucks: [{ id: "T1", name: "Camión de reparto", status: "AVAILABLE" }] }, catalog: { branches: [{ id: "B1", name: "DonPepe Magdalena" }], skus: [{ id: "S1", name: "Arroz" }] }, autonomyConfiguration: { assets: [{ id: "A1", name: "Portal RFID", readiness: { ready: true } }] }, inventory: { hus: [{ id: "HU1", skuId: "S1", lot: "LOTE1", cases: 3, status: "STORED" }, { id: "HU2", cases: 1, status: "DELIVERED" }] }, missions: [{ id: "M1", label: "Traslado a reserva", status: "RUNNING" }] };
  for (const [id, type] of [["R1", "robot"], ["T1", "truck"], ["A1", "asset"], ["B1", "branch"], ["HU1", "hu"], ["M1", "mission"]]) assert.equal(searchMapEntities(state, id)[0].type, type);
  assert.equal(searchMapEntities(state, "arroz", { productName: sku => `${sku.name} 750 g` })[0].title, "Arroz 750 g");
  assert.equal(searchMapEntities(state, "camion")[0].id, "T1");
  assert.equal(searchMapEntities(state, "HU2").length, 0);
  assert.deepEqual(searchMapEntities(state, "  "), []);
});
