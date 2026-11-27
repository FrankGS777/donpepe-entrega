"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { motionGuide } = require("../core/motion-guide");
const { createSimulation } = require("../core/engine");
const { stageDuration } = require("../core/autonomy-map");
const { STORE_UNLOAD_MIN_SECONDS } = require("../core/mechanical-timing");
const motion = import("../frontend/scene-motion.js");
const mechanics = import("../frontend/scene-automation-motion.js");
const OPS = { id: "OPS", role: "operations" };

test("a road trip overrides the previous dock route and preserves its witnessed cursor", () => {
  const dock = [
      { x: 0, z: 0 },
      { x: 0, z: 20 },
    ],
    road = [
      { x: 0, z: 20 },
      { x: 15, z: 20 },
      { x: 15, z: 80 },
    ];
  const truck = {
    route: dock,
    routeIndex: 2,
    trip: { waypoints: road, guideIndex: 1 },
  };
  assert.equal(motionGuide(truck).route, road);
  assert.equal(motionGuide(truck).index, 1);
  assert.equal(motionGuide({ route: dock, routeIndex: 2 }).route, dock);
});

test("return interpolation never replays the earlier loop at a revisited road junction", async () => {
  const { reportedTravelPath, sampleTravelPath } = await motion;
  const route = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
    { x: 0, z: 10 },
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: -10 },
  ];
  const path = reportedTravelPath(
    { x: 8, z: 0, route, routeIndex: 5 },
    { x: 10, z: -1, route, routeIndex: 6 },
  );
  assert.equal(path.length, 3);
  for (let i = 0; i <= 120; i++) {
    const point = sampleTravelPath(path, i / 120);
    assert(point.x >= 8 && point.x <= 10 && point.z >= -1 && point.z <= 0);
  }
});

test("store unload pacing retains legacy receipts and honors slower configured machinery", () => {
  const state = {
    orders: [{ id: "O", allocations: [{}, {}] }],
    catalog: {
      assets: [
        { id: "ASSET-STORE-RECEIVING-B", settings: { unloadSeconds: 6 } },
      ],
    },
  };
  const job = {
    documentId: "O",
    branchId: "B",
    state: "DESTINATION_RECEIVING",
    policy: { storeUnloadSeconds: 6, storeIdentifySeconds: 3 },
  };
  assert.equal(stageDuration(state, job), 15);
  assert.equal(
    stageDuration(state, { ...job, storeHandlingVersion: 1 }),
    STORE_UNLOAD_MIN_SECONDS * 2 + 3,
  );
  state.catalog.assets[0].settings.unloadSeconds = 25;
  assert.equal(stageDuration(state, { ...job, storeHandlingVersion: 1 }), 53);
});

test("store boxes finish their transfers before gradual door closing and departure", async () => {
  const { storeReceiptCycle } = await mechanics;
  const duration = 23,
    count = 2;
  let previous = storeReceiptCycle(duration, 0, count);
  for (let frame = 1; frame <= duration * 60; frame++) {
    const cycle = storeReceiptCycle(duration, frame / (duration * 60), count);
    assert(Math.abs(cycle.doorProgress - previous.doorProgress) < 0.04);
    for (let i = 0; i < count; i++) assert(cycle.loads[i] >= previous.loads[i]);
    if (frame / 60 > duration - 1.2)
      assert(cycle.loads.every((value) => value === 1));
    previous = cycle;
  }
  assert.equal(previous.doorProgress, 0);
  assert(previous.loads.every((value) => value === 1));
});

test("a complete autonomous delivery reports the active guide for outbound and return, then conserves all cases", (t) => {
  const sim = createSimulation();
  t.after(() => sim.close());
  sim.command("order.release", { id: "PED-00001" }, OPS);
  let outbound = false,
    returning = false,
    receipt = false,
    done = false;
  for (let tick = 0; tick < 5000; tick++) {
    sim.advance(0.5);
    const state = sim.snapshot(OPS),
      job = state.autonomy.jobs[0];
    const truck = state.trucks.find((truck) => truck.orderId === "PED-00001");
    if (truck && ["OUTBOUND", "RETURNING"].includes(truck.state)) {
      if (truck.state === "RETURNING" && !returning)
        assert(
          truck.trip.waypoints[1].x >= truck.x,
          "La salida despejada hacia el centro no debe retroceder para repetir el mismo tramo",
        );
      outbound ||= truck.state === "OUTBOUND";
      returning ||= truck.state === "RETURNING";
      const frames = truck.motionHistory,
        last = frames.at(-1);
      const routeFrame = frames.findLast(
        (frame) => frame.routeId === last.routeId && frame.route,
      );
      assert.deepEqual(routeFrame.route, truck.trip.waypoints);
      assert.equal(last.routeIndex, truck.trip.guideIndex ?? 1);
    }
    if (job.state === "DESTINATION_RECEIVING") {
      receipt = true;
      assert.equal(job.storeHandlingVersion, 1);
      assert.equal(state.storeStock.length, 0);
    }
    if (job.state === "COMPLETED") {
      done = true;
      assert.equal(state.metrics.storeCases, 6);
      assert.equal(
        state.metrics.warehouseCases + state.metrics.storeCases,
        360,
      );
      break;
    }
  }
  assert(outbound && returning && receipt && done);
});
