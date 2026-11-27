"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../frontend/scene-roads.js"), "utf8");
const helpers = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const area = r => (r.maxX - r.minX) * (r.maxZ - r.minZ);
const overlap = (a, b) => Math.max(0, Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)) * Math.max(0, Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ));
test("crossing and repeated roads have one surface per ground point without gaps", async () => {
  const { roadRectangle, unionRoadRectangles } = await helpers;
  const horizontal = roadRectangle({ ax: -12, az: 0, bx: 12, bz: 0, width: 6 });
  const vertical = roadRectangle({ ax: 0, az: -12, bx: 0, bz: 12, width: 6 });
  const cells = unionRoadRectangles([horizontal, vertical, horizontal]);
  assert.equal(cells.reduce((sum, r) => sum + area(r), 0), area(horizontal) + area(vertical) - overlap(horizontal, vertical));
  for (let a = 0; a < cells.length; a++) for (let b = a + 1; b < cells.length; b++) assert.equal(overlap(cells[a], cells[b]), 0);
  for (let x = -11.7; x < 12; x += .7) for (let z = -11.7; z < 12; z += .7) {
    const inside = r => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ;
    assert.equal(cells.some(inside), [horizontal, vertical].some(inside));
  }
});
test("junction paint is removed only inside the crossing road", async () => {
  const { clearRoadMarkings } = await helpers;
  const mark = { minX: -12, maxX: 12, minZ: 2.7, maxZ: 2.81 };
  const crossing = { minX: -3, maxX: 3, minZ: -12, maxZ: 12 };
  const parts = clearRoadMarkings(mark, [crossing]);
  assert.equal(parts.length, 2);
  assert.ok(Math.abs(parts.reduce((sum, p) => sum + area(p), 0) - 18 * .11) < 1e-9);
  assert.ok(parts.every(p => overlap(p, crossing) === 0));
});
