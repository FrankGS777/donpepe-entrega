"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const moduleReady = import("../frontend/scene-physics.js");

test("repeated rendering of the same timestamp integrates pallet gravity once", async () => {
  const { ScenePhysics } = await moduleReady, physics = new ScenePhysics({});
  const desired = { x: 0, y: 3, z: 10 };
  const first = physics.supportLoad("HU", desired, 1 / 60, { elapsed: 10 });
  const repeated = physics.supportLoad("HU", desired, 1 / 60, { elapsed: 10 });
  assert.equal(repeated.y, first.y); assert.equal(repeated.velocityY, first.velocityY);
  const next = physics.supportLoad("HU", desired, 1 / 60, { elapsed: 10 + 1 / 60 });
  assert.ok(next.y < first.y);
  physics.step(12, []); physics.step(0, []);
  const restarted = physics.supportLoad("HU", { ...desired, y: 10 }, 1 / 60, { elapsed: 0 });
  assert.ok(restarted.y > 9.99); physics.dispose();
});

test("an explicitly cleared observed order never inherits trailer access from a later snapshot", async () => {
  const { ScenePhysics } = await moduleReady, physics = new ScenePhysics({});
  const input = (x, orderId) => [{ id: "F", type: "robot", item: { type: "FORKLIFT", orderId: "LATER" }, pose: { x, y: 0, z: 60, heading: Math.PI / 2, state: "MOVING", orderId } },
    { id: "T", type: "truck", item: { orderId: "LATER" }, pose: { x: 0, y: 0, z: 60, heading: 0, state: "LOADING", orderId: "LATER" } }];
  physics.step(0, input(-5, null));
  const next = physics.step(1, input(5, null));
  assert.ok(next.get("F").x < 0); assert.ok(physics.diagnostics().contacts.some(contact => contact.obstacleId === "T"));
  assert.ok(physics.step(1, input(5, null)).get("F").x < 0, "A second draw cannot bypass an observed collision.");
  physics.dispose();
});


test("a delayed truck pose finishes turning smoothly even before the next observation", async () => {
  const { ScenePhysics } = await moduleReady;
  const physics = new ScenePhysics({});
  const input = (heading) => [{ id: "TRUCK", type: "truck",
    pose: { x: 100, y: 0, z: 145, heading, state: "RETURNING" } }];
  physics.step(0, input(3.05));
  const settledHeading = -2.1;
  const shortTurn = (start, end) => Math.atan2(Math.sin(end - start), Math.cos(end - start));
  let heading = 3.05;
  for (let draw = 0; draw < 8; draw++) {
    const next = physics.step(1, input(settledHeading)).get("TRUCK").heading;
    assert.ok(Math.abs(shortTurn(heading, next)) <= .25);
    heading = next;
  }
  assert.ok(Math.abs(shortTurn(heading, settledHeading)) < .001);
  assert.equal(physics.catchingUp, false);
  physics.dispose();
});
