"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs"), { join } = require("node:path"), { tmpdir } = require("node:os");
const { createSimulation } = require("../core/engine"), { createStore } = require("../core/store");
const { stageDuration } = require("../core/autonomy-map");
const { MECHANICAL_TIMING_VERSION, INBOUND_TRANSFER_MIN_SECONDS, stationTransferSeconds } = require("../core/mechanical-timing");
const OPS = { id:"OPS",role:"operations" };
const view = sim => sim.snapshot(OPS);
function receiving(sim) {
  sim.command("purchase.create",{supplierId:"PROV-1",lines:[{skuId:"SKU-ARROZ",cases:12}]},OPS);
  for (let n=0;n<300;n++) { const s=view(sim); if(s.autonomy.jobs[0]?.state==="RECEIVING") return s; sim.advance(1); }
  assert.fail("No se llegó a la transferencia de recepción");
}

test("new receiving phases observe a mechanical minimum while old phases retain their witnessed clock", () => {
  const state={catalog:{assets:[{id:"ASSET-INBOUND-CONVEYOR-1",settings:{transferSeconds:3}}]}};
  const job={state:"RECEIVING",policy:{conveyorSeconds:3}};
  assert.equal(stageDuration(state,job),3);
  assert.equal(stageDuration(state,{...job,mechanicalTimingVersion:1}),75);
  assert.equal(stageDuration(state,{...job,mechanicalTimingVersion:1,policy:{conveyorSeconds:95}}),95);
  const intake = {catalog:{assets:[{id:"ASSET-AUTO-UNLOADER-IN-1",settings:{cycleSeconds:6}}]}};
  const policy = {unloadSeconds:6,identifySeconds:3,inspectionSeconds:4};
  const older = {mechanicalTimingVersion:1,policy};
  const newer = {mechanicalTimingVersion:MECHANICAL_TIMING_VERSION,policy};
  assert.deepEqual(["UNLOADING","IDENTIFYING","INSPECTING"].map(stage => stageDuration(intake,older,stage)),[6,3,4]);
  assert.deepEqual(["UNLOADING","IDENTIFYING","INSPECTING"].map(stage => stageDuration(intake,newer,stage)),[12,8,9]);
  intake.catalog.assets[0].settings.cycleSeconds = 18;
  assert.equal(stageDuration(intake,newer,"UNLOADING"),18);
  assert.equal(stationTransferSeconds("RECEIVE"),24); assert.equal(stationTransferSeconds("PACK"),14); assert.equal(stationTransferSeconds("DOCK-1"),2);
});

test("incoming cargo remains outside stock until its full conveyor/distributor cycle ends", t => {
  const sim=createSimulation({seed:false}); t.after(()=>sim.close());
  const start=receiving(sim),job=start.autonomy.jobs[0];
  assert.equal(job.mechanicalTimingVersion,MECHANICAL_TIMING_VERSION); assert.equal(job.stageElapsed,0); assert.equal(start.metrics.warehouseCases,0);
  sim.advance(INBOUND_TRANSFER_MIN_SECONDS-1); const before=view(sim);
  assert.equal(before.autonomy.jobs[0].state,"RECEIVING"); assert.equal(before.hus.length,0); assert.equal(before.ledger.receivedCases,0);
  sim.advance(1); const after=view(sim);
  assert.equal(after.ledger.receivedCases,12); assert.equal(after.hus.reduce((n,h)=>n+h.cases,0),12);
  assert.ok(after.autonomy.notices[0].loads[0].huIds.length>0);
});

test("restart preserves the remaining physical cycle; removing a legacy marker never restarts a phase", t => {
  const folder=mkdtempSync(join(tmpdir(),"donpepe-mechanical-clock-")),filename=join(folder,"scenario.sqlite");
  let sim=createSimulation({filename,seed:false});
  t.after(()=>{sim.close();rmSync(folder,{recursive:true,force:true});});
  receiving(sim); sim.advance(24); const before=view(sim);
  sim.close(); sim=createSimulation({filename,seed:false});
  assert.equal(view(sim).autonomy.jobs[0].stageElapsed,before.autonomy.jobs[0].stageElapsed);
  assert.equal(view(sim).autonomy.map.jobs[0].phaseDuration,INBOUND_TRANSFER_MIN_SECONDS);
  sim.advance(INBOUND_TRANSFER_MIN_SECONDS-25); assert.equal(view(sim).ledger.receivedCases,0);
  sim.advance(1); assert.equal(view(sim).ledger.receivedCases,12);
  // A separate historical scenario was already one second into its 3s phase.
  const oldFile=join(folder,"legacy.sqlite"),legacy=createSimulation({filename:oldFile,seed:false});
  receiving(legacy); legacy.close();
  const db=createStore(oldFile),raw=db.read(); delete raw.autonomy.jobs[0].mechanicalTimingVersion; raw.autonomy.jobs[0].stageElapsed=1; db.write(raw);db.close();
  const restored=createSimulation({filename:oldFile,seed:false});
  try { assert.equal(view(restored).autonomy.map.jobs[0].phaseDuration,3); restored.advance(2); assert.equal(view(restored).ledger.receivedCases,12); }
  finally {restored.close();}
});
