"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { requestTraffic, releaseTraffic, reconcileTraffic, trafficStatus } = require("../core/physical-traffic");
const { bodyProfile, box, overlaps, advanceMotor, constrainMotion } = require("../core/physical-contact");

const point = (x, z, heading = 0) => ({ x, y: 0, z, heading });
const truck = (id, x, z, heading = 0) => ({ id, state: "AVAILABLE", ...point(x, z, heading), parkPose: point(x, z, heading), route: [], routeIndex: 0, orderId: null, returnId: null, trip: null, loadPositions: [] });
const fixture = () => {
  const a = truck("TRUCK-A", -40, 44), b = truck("TRUCK-B", 60, 75);
  return { clock: { elapsed: 0, now: "2026-10-18T15:00:00Z" }, layout: { branches: [], racks: [], locations: [], truckParking: [] }, trucks: [a, b], robots: [], orders: [], ledger: { initialCases: 40 }, hus: [{ id: "HU-1", cases: 40, locationId: "LOC-1" }] };
};
const ownBody = device => ({ ...bodyProfile("TRUCK"), id: device.id });
function move(state, device, route = device.route, holder = device, field = "routeIndex") {
  if (holder[field] >= route.length) return true;
  const from = { ...device, speed: device.physicalSpeed || 0 }, next = advanceMotor(from, route[holder[field]], 1 / 60, { ...bodyProfile("TRUCK"), speed: 4 });
  const obstacles = state.trucks.filter(other => other.id !== device.id).map(other => box(other, bodyProfile("TRUCK"), { id: other.id }));
  const bounded = constrainMotion(ownBody(device), from, next, obstacles);
  Object.assign(device, { x: bounded.pose.x, y: bounded.pose.y, z: bounded.pose.z, heading: bounded.pose.heading, physicalSpeed: bounded.contact ? 0 : next.speed });
  if (next.arrived && !bounded.contact) holder[field]++;
  return holder[field] >= route.length;
}

test("single-capacity admission prevents opposing departures and returns from meeting", () => {
  const state = fixture(), [a, b] = state.trucks, opening = structuredClone({ hus: state.hus, ledger: state.ledger });
  reconcileTraffic(state);
  a.state = "OUTBOUND"; a.orderId = "O-A"; a.parkPose = point(20, 44);
  a.route = [point(-40, 44), point(-40, 60, 0), point(20, 60, Math.PI / 2), point(20, 44, 0)]; a.routeIndex = 1;
  b.state = "RETURNING"; b.returnId = "R-B"; b.parkPose = point(-60, 44);
  b.route = [point(60, 75), point(60, 60, 0), point(-60, 60, -Math.PI / 2), point(-60, 44, 0)]; b.routeIndex = 1;
  const bInitial = point(b.x, b.z, b.heading); let firstFinished = false, secondFinished = false;
  for (let step = 0; step < 18000 && !secondFinished; step++) {
    state.clock.elapsed += 1 / 60;
    for (const device of state.trucks) {
      if (device.state === "AVAILABLE") continue;
      const permission = requestTraffic(state, device);
      if (!permission.granted) {
        if (device.id === b.id && !firstFinished) assert.deepEqual(point(b.x, b.z, b.heading), bInitial, "queued vehicle must wait in its original pocket");
        continue;
      }
      if (move(state, device)) {
        device.state = "AVAILABLE"; device.orderId = null; device.returnId = null; device.route = []; device.routeIndex = 0;
        assert.equal(releaseTraffic(state, device), true);
        if (device === a) firstFinished = true; else secondFinished = true;
      }
    }
    assert.equal(overlaps(box(a, bodyProfile("TRUCK")), box(b, bodyProfile("TRUCK"))), false, "road ownership never disables body contacts");
  }
  assert.equal(firstFinished, true); assert.equal(secondFinished, true);
  assert.equal(trafficStatus(state).owner, null);
  assert.deepEqual({ hus: state.hus, ledger: state.ledger }, opening, "traffic cannot move or duplicate inventory");
});

test("reservation persists through shop receipt, a restart and a blocking fault", () => {
  let state = fixture(); reconcileTraffic(state);
  const a = state.trucks[0]; a.state = "DOCKING"; a.orderId = "ORDER-A";
  assert.equal(requestTraffic(state, a).granted, true);
  a.state = "AT_STORE"; a.x = -76; a.z = 60; a.heading = Math.PI / 2;
  assert.equal(releaseTraffic(state, a), false);
  state = JSON.parse(JSON.stringify(state));
  const [restored, b] = state.trucks; b.state = "DOCKING"; b.orderId = "ORDER-B";
  assert.equal(requestTraffic(state, b).granted, false);
  restored.state = "FAULT"; state.clock.elapsed += 86400;
  assert.equal(requestTraffic(state, b).granted, false, "a timeout cannot free an occupied road");
  assert.equal(state.physicalTraffic.owner.truckId, a.id);
  restored.state = "RETURNING";
  assert.equal(requestTraffic(state, restored).granted, true);
  Object.assign(restored, restored.parkPose, { state: "AVAILABLE", orderId: null, trip: null });
  assert.equal(requestTraffic(state, b).granted, true);
  assert.deepEqual(point(restored.x, restored.z, restored.heading), restored.parkPose, "releasing ownership cannot teleport the former owner");
});

test("an AVAILABLE label alone cannot release a loaded or misplaced vehicle", () => {
  const state = fixture(); reconcileTraffic(state);
  const [a, b] = state.trucks; a.state = "DOCKING";
  assert.equal(requestTraffic(state, a).granted, true);
  a.state = "AVAILABLE"; a.x += 8;
  assert.equal(releaseTraffic(state, a), false);
  Object.assign(a, a.parkPose); a.loadPositions = [{ huId: "HU-1" }];
  assert.equal(releaseTraffic(state, a), false);
  a.loadPositions = []; a.orderId = null;
  assert.equal(releaseTraffic(state, a), true);
  b.state = "DOCKING";
  assert.equal(requestTraffic(state, b).granted, true);
});

test("queued requests keep FIFO order and remain idempotent after serialization", () => {
  let state = fixture(); const c = truck("TRUCK-C", 80, 75); state.trucks.push(c); reconcileTraffic(state);
  const [a, b] = state.trucks; a.state = "DOCKING"; b.state = "DOCKING"; c.state = "DOCKING";
  assert.equal(requestTraffic(state, a).granted, true);
  for (let n = 0; n < 20; n++) { assert.equal(requestTraffic(state, b).granted, false); assert.equal(requestTraffic(state, c).granted, false); }
  assert.equal(state.physicalTraffic.queue.length, 2);
  state = JSON.parse(JSON.stringify(state));
  const [ra, rb, rc] = state.trucks; ra.state = "AVAILABLE";
  assert.equal(requestTraffic(state, rc).granted, false, "a later caller cannot jump the queue after restart");
  assert.equal(requestTraffic(state, rb).granted, true);
  assert.deepEqual(state.physicalTraffic.queue.map(row => row.truckId), [rc.id]);
});

test("legacy head-on uses a persisted physical retreat and never teleports a body", () => {
  let state = fixture(); const [a, b] = state.trucks;
  Object.assign(a, point(-20, 60, Math.PI / 2), { state: "RETURNING", orderId: "O-A", parkPose: point(29, 75), trip: { waypoints: [point(-76, 60), { x: 29, z: 60 }, { x: 29, z: 56 }, { x: 29, z: 75 }], guideIndex: 1 } });
  Object.assign(b, point(20, 60, -Math.PI / 2), { state: "OUTBOUND", orderId: "O-B", trip: { waypoints: [{ x: 44, z: 54 }, { x: 44, z: 60 }, { x: -100, z: 60 }, { x: -76, z: 60 }], guideIndex: 2 } });
  state.orders = [{ id: "O-B", dockId: "D-2" }];
  state.layout.loadingDocks = [{ id: "D-2", truckPose: point(44, 41.7) }];
  const before = state.trucks.map(pose => point(pose.x, pose.z, pose.heading));
  reconcileTraffic(state);
  assert.deepEqual(state.trucks.map(pose => point(pose.x, pose.z, pose.heading)), before);
  assert.equal(state.physicalTraffic.owner.truckId, a.id);
  assert.equal(requestTraffic(state, a).granted, false, "owner must wait until the other vehicle reaches its refuge");
  let permission = requestTraffic(state, b);
  assert.ok(permission.recovery, JSON.stringify(state.physicalTraffic));
  for (let frame = 0; frame < 12000 && permission.recovery; frame++) {
    state.clock.elapsed += 1 / 60;
    const previous = point(b.x, b.z, b.heading);
    move(state, b, permission.recovery.route, permission.recovery);
    assert.ok(Math.hypot(b.x - previous.x, b.z - previous.z) < .08, "recovery is motor-driven rather than a position correction");
    assert.equal(overlaps(box(a, bodyProfile("TRUCK")), box(b, bodyProfile("TRUCK"))), false);
    if (frame === 70) {
      state = JSON.parse(JSON.stringify(state));
      // The helper keeps the exact persisted retreat cursor; no new route is
      // generated on restart and no body is snapped to the pocket.
      assert.equal(state.physicalTraffic.recoveries[0].routeIndex, permission.recovery.routeIndex);
      state.trucks[0] = a; state.trucks[1] = b;
    }
    permission = requestTraffic(state, b);
  }
  assert.equal(state.physicalTraffic.recoveries[0].phase, "WAITING");
  assert.equal(requestTraffic(state, a).granted, true);
  Object.assign(a, a.parkPose, { state: "AVAILABLE", orderId: null, trip: null });
  const bBefore = point(b.x, b.z, b.heading);
  assert.equal(requestTraffic(state, b).granted, true);
  assert.deepEqual(point(b.x, b.z, b.heading), bBefore);
  assert.equal(b.trip.guideIndex, 0, "only the route cursor rewinds; the body drives back through its recorded origin");
});

test("a legacy truck at a shop keeps its pallet without blocking an unrelated return", () => {
  const state = fixture(), [available, returning] = state.trucks,
    legacy = truck("TRUCK-3", -76, 60, Math.PI / 2);
  Object.assign(available, point(29, 75), { id: "TRUCK-1", parkPose: point(29, 75) });
  Object.assign(returning, point(37.669, 60, Math.PI / 2), { id: "TRUCK-2", state: "RETURNING", parkPose: point(38, 75), orderId: "PED-2", trip: { waypoints: [{ x: -76, z: 60 }, { x: 38, z: 60 }, { x: 38, z: 56 }, { x: 38, z: 75 }], guideIndex: 1 } });
  Object.assign(legacy, { state: "AT_STORE", branchId: "SHOP-1", orderId: "PED-3", loadPositions: [{ huId: "LEGACY-HU" }] });
  state.trucks.push(legacy);
  state.orders = [{ id: "PED-3", branchId: "SHOP-1", state: "ARRIVED" }];
  state.hus = [{ id: "LEGACY-HU", cases: 12, locationId: legacy.id, state: "IN_TRANSIT" }];
  const preserved = structuredClone({ legacy, orders: state.orders, hus: state.hus });
  reconcileTraffic(state);
  assert.equal(state.physicalTraffic.owner.truckId, returning.id);
  assert.equal(requestTraffic(state, returning).granted, true);
  assert.deepEqual(state.physicalTraffic.queue, []);
  assert.deepEqual(state.physicalTraffic.blockedBy, []);
  Object.assign(returning, returning.parkPose, { state: "AVAILABLE", orderId: null, trip: null });
  assert.equal(releaseTraffic(state, returning), true);
  available.state = "DOCKING"; available.orderId = "NEW-ORDER"; available.branchId = "SHOP-1";
  assert.equal(requestTraffic(state, available).granted, false, "same occupied destination must wait");
  returning.state = "DOCKING"; returning.orderId = "OTHER-ORDER"; returning.branchId = "SHOP-2";
  assert.equal(requestTraffic(state, returning).granted, true, "another destination may pass a physically unavailable request in the queue");
  assert.deepEqual({ legacy, orders: state.orders, hus: state.hus }, preserved);
});

test("an initial physical blockage is rechecked when a vehicle withdraws", () => {
  const state = fixture(), [a, b] = state.trucks;
  Object.assign(a, point(-20, 60, Math.PI / 2), { state: "RETURNING", trip: { waypoints: [point(-30, 60), { x: 30, z: 60 }], guideIndex: 1 } });
  Object.assign(b, point(0, 60, -Math.PI / 2), { state: "OUTBOUND", route: [], routeIndex: 0 });
  reconcileTraffic(state);
  assert.ok(state.physicalTraffic.blockedBy.includes(b.id));
  assert.equal(requestTraffic(state, a).granted, false);
  Object.assign(b, point(60, 75), { state: "AVAILABLE" });
  assert.equal(requestTraffic(state, a).granted, true);
  assert.deepEqual(state.physicalTraffic.blockedBy, []);
});

test("the authoritative guided motor executes legacy yielding and then both journeys", () => {
  const { advanceGuided } = require("../core/physical-guidance");
  const state = fixture(), [a, b] = state.trucks;
  Object.assign(a, point(-20, 60, Math.PI / 2), { state: "RETURNING", orderId: "O-A", parkPose: point(29, 75), trip: { waypoints: [point(-76, 60), { x: 29, z: 60 }, { x: 29, z: 56 }, { x: 29, z: 75 }], guideIndex: 1 } });
  Object.assign(b, point(20, 60, -Math.PI / 2), { state: "OUTBOUND", orderId: "O-B", trip: { waypoints: [{ x: 44, z: 54 }, { x: 44, z: 60 }, { x: -100, z: 60 }, { x: -76, z: 60 }], guideIndex: 2 } });
  state.orders = [{ id: "O-B", dockId: "D-2" }];
  state.layout.loadingDocks = [{ id: "D-2", truckPose: point(44, 41.7) }];
  const inventoryBefore = structuredClone({ hus: state.hus, ledger: state.ledger });
  let firstFinished = false, secondFinished = false;
  for (let second = 0; second < 1000 && !secondFinished; second++) {
    state.clock.elapsed++;
    for (const device of state.trucks) {
      if (!device.trip) continue;
      const before = point(device.x, device.z, device.heading);
      const completed = advanceGuided(state, device, 1, { type: "TRUCK", speed: 4, route: device.trip.waypoints, holder: device.trip, indexField: "guideIndex" });
      assert.ok(Math.hypot(device.x - before.x, device.z - before.z) < 4.01);
      if (completed && device === a) { firstFinished = true; device.state = "AVAILABLE"; device.orderId = null; device.trip = null; }
      else if (completed && device === b) secondFinished = true;
    }
    assert.equal(overlaps(box(a, bodyProfile("TRUCK")), box(b, bodyProfile("TRUCK"))), false);
  }
  assert.equal(firstFinished, true);
  assert.equal(secondFinished, true);
  assert.deepEqual({ hus: state.hus, ledger: state.ledger }, inventoryBefore);
});
