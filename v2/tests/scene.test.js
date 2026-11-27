"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "../frontend/scene-motion.js")).toString("base64")}`);

test("new HU waits for witnessed birth while initial inventory is immediately visible", async () => {
  const { observedUnitState } = await helpers;
  const hu = { id: 'HU-1', cases: 12 }, history = [{ at: 1000, hu }];
  assert.equal(observedUnitState(history, 700, 1000), null);
  assert.equal(observedUnitState(history, 1000, 1000), hu);
  assert.equal(observedUnitState(history, 700), hu);
  const later = { ...hu, cases: 6 };
  history.push({ at: 1250, hu: later });
  assert.equal(observedUnitState(history, 1200, 1000), hu);
  assert.equal(observedUnitState(history, 1250, 1000), later);
  assert.equal(observedUnitState(history.slice(1), 1200, 1000), later);
});

test("automation clock interpolates history when visual delay exceeds a poll", async () => {
  const { observedSimulationTime } = await helpers;
  const anchors = [0, 250, 500, 750, 1000, 1250].map(at => ({ at, elapsed: at / 1000 * 3 }));
  const times = Array.from({ length: 15 }, (_, index) => observedSimulationTime(anchors, 700 + index * 16));
  assert.equal(new Set(times).size, 15);
  for (let index = 1; index < times.length; index++) assert.ok(Math.abs(times[index] - times[index - 1] - .048) < 1e-9);
  assert.equal(observedSimulationTime(anchors, 700), 2.1);
});

test("automation clock clamps missing telemetry, respects pause and speed changes", async () => {
  const { observedSimulationTime } = await helpers;
  const anchors = [{ at: 0, elapsed: 2 }, { at: 1000, elapsed: 3 }, { at: 2000, elapsed: 6 }, { at: 3000, elapsed: 6 }];
  assert.equal(observedSimulationTime([], 1), 0);
  assert.equal(observedSimulationTime(anchors, -50), 2);
  assert.equal(observedSimulationTime(anchors, 500), 2.5);
  assert.equal(observedSimulationTime(anchors, 1500), 4.5);
  assert.equal(observedSimulationTime(anchors, 2500), 6);
  assert.equal(observedSimulationTime(anchors, 99999), 6);
  assert.equal(observedSimulationTime(anchors, 500, true), 6);
});

test("visual interpolation follows reported right-angle route instead of cutting a corner", async () => {
  const { reportedTravelPath, sampleTravelPath } = await helpers;
  const route = [{ x: -2, z: 6 }, { x: 0, z: 6 }, { x: 0, z: -16 }];
  const travel = reportedTravelPath({ x: -2, z: 6, route }, { x: 0, z: 2, route });
  assert.equal(travel.length, 3);
  for (let step = 0; step <= 100; step++) {
    const p = sampleTravelPath(travel, step / 100);
    assert.ok(Math.abs(p.z - 6) < 0.00001 || Math.abs(p.x) < 0.00001);
  }
});

test("visual interpolation joins two reported mission legs at a transfer point", async () => {
  const { reportedTravelPath, sampleTravelPath } = await helpers;
  const previous = { x: 1, z: 0, route: [{ x: 0, z: 0 }, { x: 4, z: 0 }] };
  const next = { x: 4, z: 2, route: [{ x: 4, z: 0 }, { x: 4, z: 5 }] };
  const travel = reportedTravelPath(previous, next);
  assert.deepEqual(travel[1], { x: 4, y: 0, z: 0 });
  assert.deepEqual(sampleTravelPath(travel, 1), { x: 4, y: 0, z: 2, tangent: { x: 0, y: 0, z: 2 } });
});

test("a missing diagonal route is not invented through warehouse geometry", async () => {
  const { reportedTravelPath, sampleTravelPath } = await helpers;
  const travel = reportedTravelPath({ x: 2, z: 1 }, { x: 6, z: 5 });
  assert.equal(sampleTravelPath(travel, 0.8).x, 2);
  assert.equal(sampleTravelPath(travel, 1).x, 6);
});

test("all 24 carton representations stay inside the same transferable pallet footprint", async () => {
  const { caseParts, LOAD } = await helpers;
  const boxes = caseParts(24);
  for (const box of boxes) {
    assert.ok(Math.abs(box.x) + LOAD.boxWidth / 2 <= LOAD.width / 2);
    assert.ok(Math.abs(box.z) + LOAD.boxDepth / 2 <= LOAD.depth / 2);
    assert.ok(box.y - LOAD.boxHeight / 2 >= LOAD.palletHeight);
    assert.ok(box.y + LOAD.boxHeight / 2 < 1.9);
  }
  assert.ok(LOAD.width <= 1.16 && LOAD.depth <= 0.94);
  for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
    const dx = Math.abs(boxes[a].x - boxes[b].x), dy = Math.abs(boxes[a].y - boxes[b].y), dz = Math.abs(boxes[a].z - boxes[b].z);
    assert.ok(dx >= LOAD.boxWidth || dy >= LOAD.boxHeight || dz >= LOAD.boxDepth);
  }
});

test("receiving, packing, quarantine and dispatch have non-overlapping visible buffer slots", async () => {
  const { stagingPoint, LOAD } = await helpers;
  const buffers = [
    [{ id: "RECEIVE" }, 12], [{ id: "PACK" }, 4], [{ id: "Q" }, 4],
    [{ id: "Q-COLD", x: -18 }, 4], [{ id: "Q-FROZEN", x: -10 }, 4],
    [{ id: "DOCK-1" }, 24], [{ id: "DOCK-2" }, 24],
  ];
  const positions = buffers.flatMap(([station, capacity]) => Array.from({ length: capacity }, (_, i) => ({ ...stagingPoint(station, i), stationId: station.id })));
  for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++) {
    const p = positions[a], q = positions[b];
    assert.ok(Math.abs(p.x - q.x) >= LOAD.width || Math.abs(p.z - q.z) >= LOAD.depth,
      `Overlapping buffers: ${p.stationId} and ${q.stationId}`);
  }
});

test("dispatch buffer slots remain inside the dispatch area and clear of AMR approach lines", async () => {
  const { stagingPoint, LOAD } = await helpers;
  for (const id of ["DOCK-1", "DOCK-2"]) for (let i = 0; i < 24; i++) {
    const p = stagingPoint({ id }, i);
    assert.ok(p.x - LOAD.width / 2 >= 26 && p.x + LOAD.width / 2 <= 48);
    assert.ok(p.z - LOAD.depth / 2 >= 15.5 && p.z + LOAD.depth / 2 <= 30.5);
    const approachX = id === "DOCK-1" ? 28 : 44;
    assert.ok(Math.abs(p.x - approachX) > LOAD.width / 2 + 0.9);
  }
});

test("the visual playback clock never reverses when network delay rises", async () => {
  const { playbackTime } = await helpers;
  let previous = playbackTime(undefined, 1000, 16, 500);
  for (let time = 1016; time < 3000; time += 16) {
    const next = playbackTime(previous, time, 16, time < 1500 ? 500 : 1100);
    assert.ok(next >= previous);
    assert.ok(next - previous <= 16 * 1.08 + 0.0001);
    previous = next;
  }
});

test("playback clock correction is time-based rather than tied to a frame rate", async () => {
  const { playbackTime } = await helpers;
  const run = (frameMs) => {
    let previous = 500;
    for (let elapsed = frameMs; elapsed <= 1200 + 0.001; elapsed += frameMs) previous = playbackTime(previous, 1000 + elapsed, frameMs, 550);
    return previous;
  };
  assert.ok(Math.abs(run(10) - run(40)) < 5);
});

test("a long visibility gap restarts at the observed time instead of replaying stale movement", async () => {
  const { playbackTime } = await helpers;
  assert.equal(playbackTime(1000, 60000, 59000, 500), 59500);
});

test("forklift load stays on the forward forks and follows the ramp height", async () => {
  const { carrierLoadPoint } = await helpers;
  assert.deepEqual(carrierLoadPoint({ x: 28, y: 1.2, z: 36, heading: 0 }, 1.35, 0.3), { x: 28, y: 1.5, z: 37.35 });
  const turned = carrierLoadPoint({ x: 28, y: 0, z: 28.5, heading: Math.PI / 2 }, 1.35, 0.18);
  assert.ok(Math.abs(turned.x - 29.35) < 1e-9 && Math.abs(turned.z - 28.5) < 1e-9);
});

test("all 24 loaded pallets fit the authoritative trailer without overlap", async () => {
  const { LOAD, truckLoadPoint } = await helpers;
  const { createLoadingDocks } = require("../core/blueprint");
  const dock = createLoadingDocks()[0], slots = Array.from({ length: 24 }, (_, i) => ({ x: i % 2 ? .62 : -.62, y: 1.2, z: 5.5 - Math.floor(i / 2) * 1.02 }));
  for (const slot of slots) {
    assert.ok(Math.abs(slot.x) + LOAD.width / 2 <= dock.trailer.width / 2);
    assert.ok(slot.z - LOAD.depth / 2 >= dock.trailer.rearLocalZ && slot.z + LOAD.depth / 2 <= dock.trailer.frontLocalZ);
    const p = truckLoadPoint({ x: 28, y: 0, z: 41.7, heading: 0 }, slot);
    assert.equal(p.y, 1.2);
  }
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) assert.ok(Math.abs(slots[a].x - slots[b].x) >= LOAD.width || Math.abs(slots[a].z - slots[b].z) >= LOAD.depth);
});

test("dock floor slots match the pallet footprint and never overlap", async () => {
  const { LOAD } = await helpers;
  const { createLoadingDocks } = require("../core/blueprint");
  const slots = createLoadingDocks().flatMap(dock => dock.stagingSlots);
  for (let a = 0; a < slots.length; a++) for (let b = a + 1; b < slots.length; b++) assert.ok(Math.abs(slots[a].x - slots[b].x) >= LOAD.width || Math.abs(slots[a].z - slots[b].z) >= LOAD.depth);
});

test("60x history playback preserves event order inside one received snapshot interval", async () => {
  const { historyWallTime } = await helpers;
  const previous = { elapsed: 100, at: 1000 }, current = { elapsed: 115, at: 1250 };
  const phases = [101, 104, 106, 109, 113, 115].map(elapsed => historyWallTime(elapsed, previous, current));
  for (let i = 1; i < phases.length; i++) assert.ok(phases[i] > phases[i - 1]);
  assert.equal(phases.at(-1), 1250);
  assert.equal(historyWallTime(200, previous, current), 1250);
  assert.equal(historyWallTime(90, previous, current), 1000);
});
