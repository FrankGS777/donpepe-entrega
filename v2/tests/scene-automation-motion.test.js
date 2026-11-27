"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "../frontend/scene-automation-motion.js")).toString("base64")}`);

test("autonomous visual load cannot exist before its first witnessed observation", async () => {
  const { automationSample } = await helpers;
  const record = { motionHistory: [{ elapsed: 10, stage: "UNLOADING", visible: true }] };
  assert.equal(automationSample(record, 9.9), null);
  assert.equal(automationSample(record, 10).stage, "UNLOADING");
});

test("fast playback selects each witnessed stage without jumping directly to receipt", async () => {
  const { automationSample } = await helpers;
  const stages = ["UNLOADING", "IDENTIFYING", "INSPECTING", "RECEIVING", "RECEIVED"];
  const record = { motionHistory: stages.map((stage, index) => ({ elapsed: index * 2, stage, visible: stage !== "RECEIVED" })) };
  for (let i = 0; i < stages.length; i++) assert.equal(automationSample(record, i * 2 + .5).stage, stages[i]);
  assert.equal(automationSample(record, 9).visible, false);
});

test("offline, exceptional, paused and waiting phases retain their observed progress", async () => {
  const { automationProgress } = await helpers;
  const base = { elapsed: 12, phaseDuration: 10, phaseElapsed: 3, moving: true };
  for (const patch of [{ blocked: true }, { paused: true }, { moving: false }])
    assert.equal(automationProgress({ ...base, ...patch }, 100, 100), .3);
});

test("device interpolation does not outrun the latest authoritative clock or phase duration", async () => {
  const { automationProgress } = await helpers;
  const frame = { elapsed: 20, phaseDuration: 6, phaseElapsed: 2, moving: true };
  assert.equal(automationProgress(frame, 100, 21), .5);
  assert.equal(automationProgress(frame, 100, 100), 1);
  assert.equal(automationProgress(frame, 20.5, 21), 2.5 / 6);
});

test("the same witnessed timestamp gives the same machine pose at 30, 60 and 120 FPS", async () => {
  const { automationProgress, automationPosition } = await helpers;
  const record = { elapsed: 10, phaseElapsed: 0, phaseDuration: 6, moving: true,
    from: { x: -75, y: .85, z: 17 }, to: { x: -64, y: .85, z: 17 } };
  const run = (fps) => {
    const output = {};
    for (let i = 0; i <= fps * 2; i++) automationPosition(record, automationProgress(record, 10 + i / fps, 14), output);
    return output;
  };
  assert.deepEqual(run(30), run(60)); assert.deepEqual(run(60), run(120));
});

test("store transfer follows the guarded L bridge without cutting through the truck", async () => {
  const { automationPosition } = await helpers;
  const record = { phasePath: [{ x: -7.2, y: 1.2, z: 0 }, { x: -12, y: 1.2, z: 0 }, { x: -12, y: 1.2, z: 6 }] };
  const output = {};
  for (let i = 0; i <= 100; i++) {
    assert.equal(automationPosition(record, i / 100, output), output);
    assert.ok(Math.abs(output.z) < 1e-9 || Math.abs(output.x + 12) < 1e-9);
    assert.equal(output.y, 1.2);
  }
  assert.deepEqual(output, { x: -12, y: 1.2, z: 6 });
});

test("supplier pallet follows the reported leveler slope instead of floating above the rollers", async () => {
  const { automationPosition } = await helpers;
  const record = { from: { x: -86.8, y: 1.2, z: 17 }, to: { x: -75, y: .85, z: 17 } };
  const midpoint = automationPosition(record, .5);
  assert.ok(Math.abs(midpoint.x + 80.9) < 1e-9);
  assert.ok(Math.abs(midpoint.y - 1.025) < 1e-9);
  assert.equal(midpoint.z, 17);
});

test("receiving distributor meets the real buffer and AMR with reversible, non-crossing row paths", async () => {
  const { receivingBufferPath, automationPosition } = await helpers;
  const handoff = { x: -34, y: .18, z: 17 };
  const pads = Array.from({ length: 12 }, (_, i) => ({ x: -44 + i % 3 * 2.2, y: .18, z: 21 + Math.floor(i / 3) * 2.2 }));
  for (const pad of pads) {
    const route = receivingBufferPath(handoff, pad), reverse = receivingBufferPath(handoff, pad, true);
    assert.deepEqual(route[0], handoff); assert.deepEqual(route.at(-1), pad);
    assert.deepEqual(reverse[0], pad); assert.deepEqual(reverse.at(-1), handoff);
    assert.deepEqual(automationPosition({ phasePath: route }, 1), pad);
    for (let i = 0; i <= 200; i++) {
      const p = automationPosition({ phasePath: route }, i / 200);
      for (const other of pads) if (other !== pad)
        assert.ok(Math.abs(p.x - other.x) >= 1.16 || Math.abs(p.z - other.z) >= 1.03, "route cannot cut another occupied pallet footprint");
    }
  }
});

test("PACK transfer meets exactly the robot and assigned bay without cutting the front pallet row", async () => {
  const { packingBufferPath, automationPosition } = await helpers;
  const robot = { x: 12, y: .95, z: 18 };
  const pads = Array.from({ length: 4 }, (_, i) => ({ x: 12 + (i % 2 ? 1.05 : -1.05), y: .12, z: 20.4 + Math.floor(i / 2) * 1.95 }));
  for (const pad of pads) {
    const path = packingBufferPath(robot, pad);
    assert.deepEqual(automationPosition({ phasePath: path }, 0), robot);
    const endpoint = automationPosition({ phasePath: path }, 1);
    for (const key of ['x', 'y', 'z']) assert.ok(Math.abs(endpoint[key] - pad[key]) < 1e-10);
    assert.deepEqual(packingBufferPath(robot, pad, true)[0], pad);
    for (let i = 0; i <= 200; i++) {
      const p = automationPosition({ phasePath: path }, i / 200);
      for (const other of pads) if (other !== pad)
        assert.ok(Math.abs(p.x - other.x) >= 1.16 || Math.abs(p.z - other.z) >= .94);
    }
  }
});

test("a full pallet can be verified in place when all PACK bays are occupied; partial orders cannot overlap", async () => {
  const { packingDestinationSlot } = await helpers;
  const occupied = new Set([0, 1, 2, 3]);
  assert.deepEqual(packingDestinationSlot(occupied, 2, 24, 24), { index: 2, reusePallet: true });
  assert.deepEqual(packingDestinationSlot(occupied, 0, 6, 6), { index: 0, reusePallet: true });
  assert.equal(packingDestinationSlot(occupied, 2, 24, 6), null);
  assert.equal(packingDestinationSlot(occupied, undefined, 6, 6), null);
  assert.equal(packingDestinationSlot(occupied, 2, 0, 0), null);
  assert.deepEqual(packingDestinationSlot(new Set([0, 2, 3]), 2, 24, 6), { index: 1, reusePallet: false });
  assert.deepEqual(packingDestinationSlot(new Set([0, 2, 3]), 2, 24, 24), { index: 1, reusePallet: false });
  assert.deepEqual([...occupied], [0, 1, 2, 3], "visual selection must not alter operational occupancy");
});

test("every receiving pallet pose has continuous roller, carriage or buffer support", async () => {
  const { receivingMechanismPose } = await helpers;
  const path = [{ x: -54, y: .85, z: 17 }, { x: -43, y: .85, z: 17 }, { x: -34, y: .18, z: 17 }];
  for (const pad of [{ x: -44, y: .18, z: 21 }, { x: -39.6, y: .18, z: 27.6 }]) {
    let previous;
    const phases = new Set();
    for (let i = 0; i <= 1000; i++) {
      const pose = receivingMechanismPose(path, pad, i / 1000);
      phases.add(pose.phase);
      assert.ok(Math.abs(pose.cargo.y - pose.supportY) < 1e-10);
      if (pose.carrying) {
        assert.ok(Math.abs(pose.carrier.x - pose.cargo.x) < 1e-10);
        assert.ok(Math.abs(pose.carrier.z - pose.cargo.z) < 1e-10);
        assert.ok(Math.abs(pose.surfaceY - pose.cargo.y) < 1e-10);
      }
      if (previous) assert.ok(Math.hypot(pose.cargo.x - previous.x, pose.cargo.y - previous.y, pose.cargo.z - previous.z) < .12);
      previous = pose.cargo;
    }
    assert.deepEqual([...phases], ["CONVEYOR", "ALIGN", "TRANSFER", "SEATED"]);
    assert.deepEqual(receivingMechanismPose(path, pad, 1).cargo, { ...pad, heading: 0 });
  }
});

test("AMR handoff raises on the external carriage before telescopic extension and retracts after seating", async () => {
  const { bufferMechanismPose } = await helpers;
  for (const stationId of ["RECEIVE", "PACK"]) {
    const robot = stationId === "RECEIVE" ? { x: -34, y: .95, z: 17 } : { x: 12, y: .95, z: 18 };
    const pad = stationId === "RECEIVE" ? { x: -44, y: .18, z: 27.6 } : { x: 10.95, y: .12, z: 22.35 };
    let previous;
    for (let i = 0; i <= 1000; i++) {
      const pose = bufferMechanismPose({ stationId, robot, pad }, i / 1000);
      assert.ok(Math.abs(pose.cargo.y - pose.supportY) < 1e-10, "pallet bottom meets the witnessed support");
      if (["LIFT", "EXTEND", "SEATED", "RETRACT"].includes(pose.phase))
        assert.ok(Math.abs(pose.carrier.x - robot.x) >= 1.99, "carriage base stays outside AMR hull");
      if (pose.phase === "LIFT") assert.equal(pose.extension, 0);
      if (pose.phase === "EXTEND") assert.equal(pose.cargo.y, robot.y);
      if (pose.carrying) assert.ok(Math.abs(Math.hypot(pose.cargo.x - pose.carrier.x, pose.cargo.z - pose.carrier.z) - pose.extension) < 1e-10);
      if (previous) assert.ok(Math.hypot(pose.cargo.x - previous.x, pose.cargo.y - previous.y, pose.cargo.z - previous.z) < .12);
      previous = pose.cargo;
    }
    const seated = bufferMechanismPose({ stationId, robot, pad }, .96);
    assert.equal(seated.supportKind, "AMR_DECK");
    assert.deepEqual(seated.cargo, { ...robot, heading: 0 });
    const end = bufferMechanismPose({ stationId, robot, pad }, 1);
    assert.equal(end.extension, 0); assert.ok(end.surfaceY < end.cargo.y);
  }
});

test("PACK unloading keeps AMR support until fork contact, lowers outside the AMR and deposits without levitation", async () => {
  const { bufferMechanismPose } = await helpers;
  const robot = { x: 12, y: .95, z: 18 }, pad = { x: 13.05, y: .12, z: 22.35 };
  let previous;
  for (let i = 0; i <= 1000; i++) {
    const pose = bufferMechanismPose({ stationId: "PACK", robot, pad, unloading: true }, i / 1000);
    assert.ok(Math.abs(pose.cargo.y - pose.supportY) < 1e-10);
    if (pose.phase === "LOWER") {
      assert.equal(pose.extension, 0);
      assert.ok(Math.abs(pose.carrier.x - robot.x) > 2.6);
    }
    if (previous) assert.ok(Math.hypot(pose.cargo.x - previous.x, pose.cargo.y - previous.y, pose.cargo.z - previous.z) < .12);
    previous = pose.cargo;
  }
  assert.deepEqual(bufferMechanismPose({ stationId: "PACK", robot, pad, unloading: true }, 1).cargo, { ...pad, heading: 0 });
});

test("guided geometry merges duplicate rails and supports the entire buffer route", async () => {
  const { mechanicalGuideSegments, receivingBufferPath } = await helpers;
  const handoff = { x: -34, y: .18, z: 17 };
  const pads = Array.from({ length: 12 }, (_, i) => ({ x: -44 + i % 3 * 2.2, y: .18, z: 21 + Math.floor(i / 3) * 2.2 }));
  const paths = pads.map(pad => receivingBufferPath(handoff, pad)), guides = mechanicalGuideSegments(paths);
  assert.ok(guides.length < pads.length * 4);
  assert.deepEqual(mechanicalGuideSegments([...paths, ...paths]), guides);
  for (const route of paths) for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], axis = Math.abs(a.x - b.x) > .001 ? 'x' : 'z';
    assert.ok(guides.some(guide => guide.axis === axis && Math.abs(guide.fixed - (axis === 'x' ? a.z : a.x)) < .001 &&
      guide.from <= Math.min(a[axis], b[axis]) && guide.to >= Math.max(a[axis], b[axis])));
  }
});

test("pause, missed frames and restart reconstruct the exact same supported machine pose", async () => {
  const { automationSample, automationProgress, bufferMechanismPose } = await helpers;
  const transfer = { elapsed: 10, phaseElapsed: 10, phaseDuration: 24, moving: false, paused: true };
  const config = { robot: { x: -34, y: .95, z: 17 }, pad: { x: -44, y: .18, z: 27.6 } };
  const progress = automationProgress(transfer, 100, 100);
  const paused = bufferMechanismPose(config, progress);
  assert.deepEqual(bufferMechanismPose(config, automationProgress(transfer, 1000, 1000)), paused);
  const restarted = { ...transfer, motionHistory: [{ ...transfer }] };
  assert.deepEqual(bufferMechanismPose(config, automationProgress(automationSample(restarted, 1000), 1000, 1000)), paused);
});
