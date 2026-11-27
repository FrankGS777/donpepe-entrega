"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs"), { join } = require("node:path"), { tmpdir } = require("node:os");
const { createSimulation } = require("../core/engine"), { createStore } = require("../core/store");
const { box, bodyProfile, overlaps, angleDelta } = require("../core/physical-contact");
const { planClearance } = require("../core/physical-planner");
const OPS = { id: "OPS", role: "operations" };
const pose = (x, z, heading = 0, y = 0) => ({ x, y, z, heading });
function fixture(t, change) {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-park-recovery-")), filename = join(folder, "scenario.sqlite");
  let sim = createSimulation({ filename, academicLegacyFixture: true }); sim.close();
  const db = createStore(filename), state = db.read(); change(state); db.write(state); db.close();
  sim = createSimulation({ filename, academicLegacyFixture: true });
  t.after(() => { sim.close(); rmSync(folder, { recursive: true, force: true }); });
  return { get sim() { return sim; }, restart() { sim.close(); sim = createSimulation({ filename, academicLegacyFixture: true }); } };
}
function stoppedReturn(state, index = 2) {
  const truck = state.trucks[index];
  Object.assign(truck, { ...pose(29, 60, 2.697143926394876), state: "RETURNING", orderId: "PED-00001", physicalSpeed: 0, progress: .788659793814433,
    trip: { physicalGuideVersion: 1, startedAt: 98936.83160200714, duration: 36, from: { x: -76, z: 60 }, to: { x: truck.parkPose.x, z: 75 },
      waypoints: [{ x: -76, z: 60 }, { x: -100, z: 60, heading: Math.PI / 2 }, { x: -100, z: 60 }, { x: 29, z: 60 }, { x: 29, z: 56 }, { x: truck.parkPose.x, z: 56 }, { x: truck.parkPose.x, z: 75 }], length: 194, guideIndex: 4 },
    contact: { obstacleId: "TRUCK-1", reason: "Esperando que se despeje el espacio de circulación.", at: state.clock.elapsed, normal: { x: 0, y: 0, z: 0 } } });
  state.physicalTraffic = { version: 1, capacity: 1, owner: { truckId: truck.id, purpose: "DELIVERY", acquiredElapsed: 0 }, queue: [], recoveries: [], blockedBy: [], nextTicket: 0 };
}
const inventory = state => ({ hus: state.hus.map(({ motionHistory, ...hu }) => hu), stock: state.storeStock, ledger: state.ledger, purchases: state.purchases, orders: state.orders });

test("compound truck body distinguishes empty space, trailer, mirrors and tyres at their real dimensions", () => {
  const shape = box(pose(0, 0), bodyProfile("TRUCK"), { id: "T" });
  assert.equal(shape.children.length, 11);
  assert.equal(shape.children.find(part => part.partId === "trailer").halfDepth * 2, 14.5);
  const probe = (x, y, z) => box(pose(x, z, 0, y), { width: .08, depth: .08, height: .08 }, { id: "PROBE" });
  assert.equal(overlaps(shape, probe(1.6, 2.7, 0)), false, "air beside the trailer is not a solid selection envelope");
  assert.equal(overlaps(shape, probe(1.65, 2.7, 9)), true, "projecting mirrors keep their full real width");
  assert.equal(overlaps(shape, probe(1.28, .4, -5.4)), true, "a wheel remains a real lower contact");
  assert.equal(overlaps(shape, probe(0, .15, 0)), false, "space below the chassis remains open");
});

test("exact persisted vehicle3 parking deadlock self-recovers, survives restart and preserves all custody", t => {
  const f = fixture(t, state => stoppedReturn(state)), before = f.sim.snapshot(OPS), start = before.trucks[2];
  f.sim.advance(.001); const initial = f.sim.snapshot(OPS).trucks[2];
  assert.ok(Math.hypot(initial.x - start.x, initial.z - start.z) < .01, "installing the guide cannot teleport the vehicle");
  let restarted = false, completed = false, sawManeuver = false, previous = initial, previousProgress = initial.progress;
  for (let step = 0; step < 600; step++) {
    f.sim.advance(.25); const state = f.sim.snapshot(OPS), truck = state.trucks[2];
    const shapes = state.trucks.map(truck => box(truck, bodyProfile("TRUCK"), { id: truck.id }));
    for (let a = 0; a < shapes.length; a++) for (let b = a + 1; b < shapes.length; b++) assert.equal(overlaps(shapes[a], shapes[b]), false, `vehicle bodies intersect at quarter-step${step}`);
    assert.ok(Math.hypot(truck.x - previous.x, truck.z - previous.z) < 2, "recovery must be actual driven movement");
    assert.ok(Math.abs(angleDelta(previous.heading, truck.heading)) <= .6 * .25 + .001);
    if (truck.state !== "AVAILABLE") assert.ok(truck.progress >= previousProgress - .00001, "replanning preserves already completed journey progress");
    sawManeuver ||= truck.clearanceManeuver?.status === "MANEUVERING";
    if (!restarted && sawManeuver && Math.hypot(truck.x - start.x, truck.z - start.z) > .5) {
      const saved = { x: truck.x, z: truck.z, heading: truck.heading, trip: truck.trip, maneuver: truck.clearanceManeuver };
      f.restart(); const restored = f.sim.snapshot(OPS).trucks[2];
      assert.deepEqual({ x: restored.x, z: restored.z, heading: restored.heading, trip: restored.trip, maneuver: restored.clearanceManeuver }, saved); restarted = true;
    }
    if (truck.state === "AVAILABLE") {
      completed = true; assert.equal(truck.x, 47); assert.equal(truck.z, 75); assert.equal(truck.heading, 0); assert.equal(truck.clearanceManeuver.status, "COMPLETED");
      assert.deepEqual(inventory(state), inventory(before));
      for (let index = 0; index < 2; index++) assert.deepEqual({ x: state.trucks[index].x, z: state.trucks[index].z, heading: state.trucks[index].heading }, { x: before.trucks[index].x, z: before.trucks[index].z, heading: before.trucks[index].heading });
      break;
    }
    previous = truck; previousProgress = truck.progress;
  }
  assert.ok(sawManeuver && restarted && completed);
});

for (const index of [0, 1, 2]) test(`a persisted return to bay${index + 1} parks between both unchanged neighbours`, t => {
  const f = fixture(t, state => {
    const truck = state.trucks[index];
    Object.assign(truck, { ...pose(-20, 60, Math.PI / 2), state: "RETURNING", orderId: null, physicalSpeed: 0, progress: .4,
      trip: { physicalGuideVersion: 1, startedAt: 0, duration: 36, length: 140, from: { x: -76, z: 60 }, to: { x: truck.parkPose.x, z: 75 },
        waypoints: [{ x: -76, z: 60 }, { x: truck.parkPose.x - 18, z: 60 }, { x: truck.parkPose.x - 18, z: 56 }, { x: truck.parkPose.x, z: 56 }, { x: truck.parkPose.x, z: 75 }] } });
  });
  let completed = false;
  for (let step = 0; step < 250; step++) {
    f.sim.advance(1); const state = f.sim.snapshot(OPS), truck = state.trucks[index];
    for (const other of state.trucks.filter(item => item.id !== truck.id)) assert.equal(overlaps(box(truck, bodyProfile("TRUCK")), box(other, bodyProfile("TRUCK"))), false);
    if (truck.state === "AVAILABLE") { completed = true; assert.equal(truck.x, truck.parkPose.x); assert.equal(truck.z, 75); break; }
  }
  assert.equal(completed, true);
});

test("clearance planning retains collisions when the destination is physically obstructed", () => {
  const truck = { id: "T", ...pose(29, 60, 2.697143926394876) };
  const blocked = box(pose(47, 75), { width: 12, depth: 24, height: 5 }, { id: "OBSTRUCTION" });
  assert.equal(planClearance(truck, pose(47, 75), [blocked], { parking: true }), null);
});
