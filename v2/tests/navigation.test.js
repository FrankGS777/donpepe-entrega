"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const helpers = import(`data:text/javascript;base64,${fs.readFileSync(path.join(__dirname, "../frontend/scene-navigation.js")).toString("base64")}`);

test("map shortcuts never consume typing, modifiers, hidden tabs or modal input", async () => {
  const { mapInputAllowed, isNavigationKey } = await helpers;
  const canvas = {}, field = {}, event = { target: canvas };
  assert(mapInputAllowed(event, canvas, { activeElement: canvas }));
  for (const options of [{ activeElement: field }, { activeElement: canvas, blocked: true }, { activeElement: canvas, hidden: true }]) assert.equal(mapInputAllowed(event, canvas, options), false);
  assert.equal(mapInputAllowed({ target: field }, canvas, { activeElement: canvas }), false);
  for (const modifier of ["ctrlKey", "metaKey", "altKey", "isComposing"]) assert.equal(mapInputAllowed({ ...event, [modifier]: true }, canvas, { activeElement: canvas }), false);
  assert(isNavigationKey("KeyW")); assert(isNavigationKey("ArrowDown")); assert.equal(isNavigationKey("KeyP"), false);
});

test("camera-relative forward and right follow the viewing direction", async () => {
  const { cameraPlaneDelta } = await helpers;
  assert.deepEqual(cameraPlaneDelta(0, 1, 0, 10), { x: 0, z: -1 });
  assert.deepEqual(cameraPlaneDelta(1, 0, 0, 10), { x: 1, z: 0 });
  assert.deepEqual(cameraPlaneDelta(0, 1, 10, 0), { x: -1, z: 0 });
  assert.deepEqual(cameraPlaneDelta(0, 1, 0, 0), { x: 0, z: -1 });
});

test("continuous camera travel is the same at 30, 60 and 120 refreshes per second", async () => {
  const { default: Navigation } = await helpers;
  const travel = hz => {
    const control = new Navigation(); control.press("KeyW");
    let moved = 0;
    for (let i = 0; i < hz * 2; i++) moved += control.step(1 / hz, 20).forward;
    return moved;
  };
  assert(Math.abs(travel(30) - travel(60)) < 1e-8);
  assert(Math.abs(travel(60) - travel(120)) < 1e-8);
});

test("diagonal movement is normalized and aliases/opposing keys cannot accelerate it", async () => {
  const { default: Navigation } = await helpers;
  const control = new Navigation(); control.press("KeyW"); control.press("KeyD");
  let delta = control.step(.05, 20, true);
  assert(Math.abs(Math.hypot(delta.right, delta.forward) - 1) < 1e-10);
  control.press("ArrowUp"); delta = control.step(.05, 20, true);
  assert(Math.abs(Math.hypot(delta.right, delta.forward) - 1) < 1e-10);
  control.press("KeyS"); delta = control.step(.05, 20, true);
  assert.equal(delta.forward, 0);
});

test("release eases to a complete stop; blur/visibility reset cancels all movement immediately", async () => {
  const { default: Navigation } = await helpers;
  const control = new Navigation(); control.press("KeyW");
  for (let i = 0; i < 60; i++) control.step(1 / 60, 20);
  control.release("KeyW");
  let travelled = 0;
  for (let i = 0; i < 90; i++) travelled += control.step(1 / 60, 20).forward;
  assert(travelled < 1.3); assert.equal(control.active, false);
  assert.equal(control.step(1 / 60, 20).forward, 0);
  control.press("KeyE"); control.step(1 / 60, 20); control.clear();
  assert.equal(control.active, false); assert.deepEqual(control.step(1 / 60, 20), { right: 0, forward: 0, yaw: 0, active: false });
});
