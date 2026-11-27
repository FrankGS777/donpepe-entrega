"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { box, overlaps, sweep, constrainMotion, bodyProfile, advanceMotor, stepSupport } = require("../core/physical-contact");
const { physicalLayout } = require("../core/physical-layout");
const { advanceGuided, obstaclesFor } = require("../core/physical-guidance");
const { createBlueprint } = require("../core/blueprint");
const pose = (x, z, heading = 0, y = 0) => ({ x, y, z, heading });

test("continuous contact catches a fast crossing even when both endpoints are clear", () => {
  const body = { id: "AGV", width: 1, depth: 1, height: 1 }, wall = box(pose(0, 0), { width: .1, depth: 20, height: 3 }, { id: "WALL" });
  assert.equal(overlaps(box(pose(-50, 0), body), wall), false);
  assert.equal(overlaps(box(pose(50, 0), body), wall), false);
  const hit = constrainMotion(body, pose(-50, 0), pose(50, 0), [wall]);
  assert.ok(hit.fraction > .49 && hit.fraction < .5);
  assert.equal(hit.contact.obstacleId, "WALL"); assert.ok(hit.pose.x <= -.55);
  assert.equal(overlaps(box(hit.pose, body), wall), false);
});

test("continuous OBB contact catches perpendicular moving traffic, angled edges and rotating trailers", () => {
  const shape = { width: 1, depth: 2, height: 1 };
  const first = sweep(box(pose(-5, 0, Math.PI / 2), shape, { id: "A" }), box(pose(5, 0, Math.PI / 2), shape, { id: "A" }),
    box(pose(0, -5), shape, { id: "B" }), box(pose(0, 5), shape, { id: "B" }));
  assert.ok(first && first.fraction < .5);
  const diagonal = box(pose(0, 0, Math.PI / 4), { width: .1, depth: 8, height: 2 }, { id: "DIAGONAL" });
  assert.ok(constrainMotion({ ...shape, id: "A" }, pose(-5, 0), pose(5, 0), [diagonal]).contact);
  const trailer = bodyProfile("TRUCK"), bollard = box(pose(6, 0), { width: .3, depth: .3, height: 2 }, { id: "BOLLARD" });
  const turning = constrainMotion({ ...trailer, id: "T" }, pose(0, 0), pose(0, 0, Math.PI / 2), [bollard]);
  assert.ok(turning.contact); assert.ok(turning.fraction > 0 && turning.fraction < 1);
});

test("carried inventory cannot collide with its own carrier, but other freight is still solid", () => {
  const carrier = box(pose(0, 0), bodyProfile("AMR", true), { id: "AMR-1" });
  const load = { ...bodyProfile("LOAD"), id: "HU-1", ownerId: "AMR-1" };
  assert.equal(constrainMotion(load, pose(0, 0), pose(0, 2), [carrier]).contact, null);
  const foreign = { ...carrier, id: "AMR-2" };
  assert.ok(constrainMotion(load, pose(0, -4), pose(0, 2), [foreign]).contact);
});

test("an unloaded under-pallet robot fits below a supported pallet; a loaded robot cannot", () => {
  const pallet = box(pose(0, 0, 0, .18), bodyProfile("LOAD"), { id: "HU-WAITING" });
  assert.equal(constrainMotion({ ...bodyProfile("AMR"), id: "A" }, pose(0, -3), pose(0, 3), [pallet]).contact, null);
  assert.ok(constrainMotion({ ...bodyProfile("AMR", true), id: "A" }, pose(0, -3), pose(0, 3), [pallet]).contact);
});

test("AMR contacts follow its actual raised platform, scissor bars and carried pallet", () => {
  const waiting = box(pose(0, 0, 0, .18), bodyProfile("LOAD"), { id: "WAITING" });
  const raised = bodyProfile("AMR", false, { cargoHeight: .95 }), lowered = bodyProfile("AMR", false, { cargoHeight: .18 });
  assert.equal(raised.height, .95); assert.ok(raised.parts.some(part => part.name === "lifting-deck"));
  assert.ok(raised.parts.some(part => part.name.startsWith("scissor-")));
  assert.ok(constrainMotion({ ...raised, id: "AMR" }, pose(0, -3), pose(0, 3), [waiting]).contact);
  assert.equal(constrainMotion({ ...lowered, id: "AMR" }, pose(0, -3), pose(0, 3), [waiting]).contact, null);
  const loaded = bodyProfile("AMR", true, { cargoHeight: .95 });
  assert.ok(Math.abs(loaded.height - 2.786) < .00001); assert.ok(loaded.parts.some(part => part.name === "carried-pallet"));
});

test("existing penetration may only be escaped, never increased", () => {
  const wall = box(pose(0, 0), { width: 1, depth: 10, height: 2 }, { id: "W" }), body = { width: 1, depth: 1, height: 1, id: "A" };
  assert.equal(constrainMotion(body, pose(.75, 0), pose(2, 0), [wall]).contact, null);
  assert.ok(constrainMotion(body, pose(.75, 0), pose(.5, 0), [wall]).contact);
  assert.ok(constrainMotion(body, pose(.75, 0), pose(-2, 0), [wall]).contact, "an escape cannot cross the whole obstacle to reach its far side");
});

test("a motor accelerates, brakes before a stop, and limits its turning rate", () => {
  let motor = { ...pose(0, 0), speed: 0 }; const target = pose(0, 5);
  motor = advanceMotor(motor, target, .1, { speed: 2, acceleration: 1, braking: 1 });
  assert.ok(Math.abs(motor.speed - .1) < 1e-9); assert.ok(motor.z < .011);
  let peak = 0, decelerated = false;
  for (let index = 0; index < 1200 && !motor.arrived; index++) {
    const previous = motor.speed; motor = advanceMotor(motor, target, 1 / 60, { speed: 2, acceleration: 1, braking: 1 });
    peak = Math.max(peak, motor.speed); decelerated ||= motor.speed < previous && motor.z < 4.99;
    assert.ok(motor.z <= 5 + 1e-9);
  }
  assert.ok(peak > 1.5); assert.ok(decelerated); assert.ok(motor.arrived);
  const turning = advanceMotor({ ...pose(0, 0), speed: 0 }, pose(5, 0, Math.PI / 2), .1, { turnRate: .6 });
  assert.ok(Math.abs(turning.heading - .06) < 1e-9);
});

test("gravity, shelf contact and carrier constraints use physical support heights", () => {
  const floor = { id: "FLOOR", x: 0, z: 0, y: 0, width: 20, depth: 20 };
  const shelf = { id: "SHELF", ownerId: "LOC-1", x: 0, z: 0, y: 3.2475, width: 2, depth: 3 };
  let load = { ...pose(0, 0, 0, 5), velocityY: 0 };
  const falling = stepSupport(load, load, .1, { surfaces: [floor] });
  assert.ok(Math.abs(falling.y - (5 - 9.81 * .01 / 2)) < 1e-9);
  for (let frame = 0; frame < 180; frame++) load = stepSupport(load, { ...load, ownerId: "LOC-1" }, 1 / 60, { surfaces: [floor, shelf] });
  assert.equal(load.y, shelf.y); assert.equal(load.supportId, "SHELF"); assert.equal(load.velocityY, 0); assert.equal(load.supported, true);
  const carried = stepSupport(load, { ...pose(3, 8, 0, 1.5), ownerId: "FORKLIFT-1" }, .1, { attached: true, surfaces: [floor] });
  assert.equal(carried.y, 1.5); assert.equal(carried.supportId, "FORKLIFT-1");
});

test("gravity has identical free-fall position at 30, 60 and 120 Hz", () => {
  const run = fps => { let load = { ...pose(0, 0, 0, 20), velocityY: 0 }; for (let i = 0; i < fps; i++) load = stepSupport(load, load, 1 / fps); return load; };
  for (const fps of [30, 60, 120]) { const load = run(fps); assert.ok(Math.abs(load.y - (20 - 9.81 / 2)) < 1e-9); assert.ok(Math.abs(load.velocityY + 9.81) < 1e-9); }
});

test("structural gaps are real: receiving and dock doors pass while the adjacent wall blocks", () => {
  const layout = createBlueprint(), { solids, surfaces } = physicalLayout(layout), robot = { ...bodyProfile("AMR", true), id: "A" };
  assert.equal(constrainMotion(robot, pose(-54, 17), pose(-48, 17), solids).contact, null);
  assert.ok(constrainMotion(robot, pose(-54, 12), pose(-48, 12), solids).contact);
  const truck = { ...bodyProfile("TRUCK"), id: "T" };
  assert.equal(constrainMotion(truck, pose(28, 48), pose(28, 41.7), solids).contact, null);
  assert.ok(constrainMotion(truck, pose(20, 48), pose(20, 38), solids).contact);
  const loc = layout.locations.find(loc => loc.kind === "RACK");
  assert.equal(surfaces.find(surface => surface.ownerId === loc.id).y, loc.y + .0475);
});

test("guided control stops for a real obstacle and resumes the same route when clear", () => {
  const robot = { id: "AMR-1", type: "AMR", ...pose(-5, 6, Math.PI / 2), route: [pose(-5, 6), pose(5, 6, Math.PI / 2)], routeIndex: 1 };
  const blocker = { id: "AMR-2", type: "AMR", ...pose(0, 6), state: "FAULT" };
  const state = { clock: { elapsed: 10 }, layout: { branches: [], racks: [], locations: [] }, robots: [robot, blocker], trucks: [] };
  for (let i = 0; i < 10; i++) advanceGuided(state, robot, 1, { speed: 1.5 });
  assert.ok(robot.x < -.9); assert.equal(robot.routeIndex, 1); assert.equal(robot.contact.obstacleId, blocker.id);
  blocker.z = 10;
  for (let i = 0; i < 20 && robot.routeIndex < 2; i++) advanceGuided(state, robot, 1, { speed: 1.5 });
  assert.equal(robot.routeIndex, 2); assert.equal(robot.contact, undefined); assert.equal(robot.x, 5);
});

test("a common order only exempts the owned trailer during a real transfer", () => {
  const forklift = { id: "F", type: "FORKLIFT", orderId: "ORDER", loadingPhase: "TO_TRUCK", ...pose(0, 0) };
  const truck = { id: "T", orderId: "ORDER", loadingState: "LOADING", ...pose(0, 0) };
  const state = { layout: createBlueprint(), robots: [forklift], trucks: [truck] };
  assert.equal(obstaclesFor(state, forklift, "FORKLIFT").some(body => body.id === "T"), false);
  truck.loadingState = "UNDOCKING";
  assert.equal(obstaclesFor(state, forklift, "FORKLIFT").some(body => body.id === "T"), true);
  truck.loadingState = "LOADING"; forklift.loadingPhase = "IDLE";
  assert.equal(obstaclesFor(state, forklift, "FORKLIFT").some(body => body.id === "T"), true);
});

test("legacy load below the foundation recovers to the real surface, not a high rack", () => {
  const floor = { id: "F", x: 0, z: 0, y: .0675, width: 20, depth: 20, foundation: true };
  const shelf = { id: "HIGH", x: 0, z: 0, y: 8, width: 2, depth: 2 };
  const load = stepSupport({ ...pose(0, 0, 0, -.3), velocityY: -3 }, pose(0, 0, 0, -.3), 1 / 60, { surfaces: [floor, shelf] });
  assert.equal(load.y, .0675); assert.equal(load.supportId, "F"); assert.equal(load.velocityY, 0);
});
