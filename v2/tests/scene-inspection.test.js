"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  THREE = require("three");
const library = import("../frontend/scene-inspection.js");
const target = (type = "hu", id = "H1") => ({
  type,
  id,
  position: new THREE.Vector3(0, 2, 0),
  size: [1.2, 1.8, 1],
});
test("frontal HU inspection faces the actual aisle at the selected shelf height", async () => {
  const { inspectionPose } = await library,
    r = target();
  r.position.set(14, 7.9, -77);
  const view = inspectionPose(r, { zoneId: "COLD", z: -77, railZ: -73 });
  assert.equal(view.position.x, 14);
  assert(view.position.z > -77 && view.position.z <= -73);
  assert(Math.abs(view.position.y - r.position.y) < 0.2);
  assert.deepEqual(view.target.toArray(), r.position.toArray());
  const back = inspectionPose(
    { ...r, position: new THREE.Vector3(-37, 4.8, -69) },
    { zoneId: "DRY", z: -69, railZ: -73 },
  );
  assert(back.position.z < -69);
});

test("cargo and moving machines are framed from their current front", async () => {
  const { inspectionPose } = await library;
  for (const type of ["hu", "robot", "truck", "asset"]) {
    for (const heading of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const record = target(type);
      const { position, target: center } = inspectionPose(record, null, { heading });
      const fromCenter = position.clone().sub(center);
      const front = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
      assert(fromCenter.dot(front) > 0.85 * Math.hypot(fromCenter.x, fromCenter.z));
    }
  }
});

test("floor cargo and racks retain finite frontal framing on narrow screens", async()=>{
  const {inspectionPose}=await library;
  for(const type of ['hu','rack','loc']) for(const aspect of [.45,1.6,2.2]) {
    const record=target(type); record.size=type==='rack'?[8,9,4]:[1.16,1.9,.94];
    const view=inspectionPose(record,null,{aspect});
    assert(view.position.toArray().every(Number.isFinite));
    assert.deepEqual(view.target.toArray(),record.position.toArray());
    assert(view.position.distanceTo(view.target)>record.size[2]/2);
  }
});
