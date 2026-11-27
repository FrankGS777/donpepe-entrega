"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../frontend/inspection-context.js"), "utf8");
const library = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("a selected truck, robot or load follows its own existing order, not the last unrelated delivery", async () => {
  const { inspectionOrderId } = await library;
  const state = { orders: [{ id: "PED3" }, { id: "PED5" }], equipment: { trucks: [{ id: "TRUCK3", orderId: "PED3", status: "RETURNING", loadingState: "COMPLETED" }], robots: [{ id: "ROBOT1", orderId: "PED3" }, { id: "ROBOT2", missionId: "M1" }] }, inventory: { hus: [{ id: "HU1", orderId: "PED3" }] }, missions: [{ id: "M1", orderId: "PED3" }] }, before = JSON.stringify(state);
  for (const [type, id] of [["truck", "TRUCK3"], ["robot", "ROBOT1"], ["equipment", "ROBOT2"], ["hu", "HU1"], ["mission", "M1"]]) assert.equal(inspectionOrderId(state, { type, id }, "PED5"), "PED3");
  assert.equal(JSON.stringify(state), before, "selecting a document cannot mutate a process or route");
});

test("unassigned, missing and unrelated infrastructure selections preserve the previous tracking", async () => {
  const { inspectionOrderId } = await library;
  const state = { orders: [{ id: "PED5" }], equipment: { trucks: [{ id: "FREE" }, { id: "ORPHAN", orderId: "NO-ORDER" }], robots: [] }, hus: [{ id: "HU", orderId: "NO-ORDER" }] };
  for (const selection of [null, { type: "truck", id: "FREE" }, { type: "truck", id: "ORPHAN" }, { type: "hu", id: "HU" }, { type: "warehouse", id: "CD1" }, { type: "robot", id: "MISSING" }]) assert.equal(inspectionOrderId(state, selection, "PED5"), "PED5");
  assert.equal(inspectionOrderId(state, null), null);
});
