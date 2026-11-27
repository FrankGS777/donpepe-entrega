"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createSimulation}=require("../core/engine"),{createStore}=require("../core/store");
const {mkdtempSync,rmSync}=require("node:fs"),{tmpdir}=require("node:os"),{join}=require("node:path");
const OPS={id:"ops",role:"operations"},ADMIN={id:"admin",role:"admin"},STORE={id:"store",role:"store",branchId:"TIENDA-1"};
function fixture(t){const folder=mkdtempSync(join(tmpdir(),"dp-expiry-")),filename=join(folder,"scenario.sqlite");let sim=createSimulation({filename,academicLegacyFixture:true});t.after(()=>{sim.close();rmSync(folder,{recursive:true,force:true});});return{get sim(){return sim;},mutate(fn){const db=createStore(filename),s=db.read();fn(s);db.write(s);db.close();},restart(){sim.close();sim=createSimulation({filename,academicLegacyFixture:true});}};}
function until(f,fn,max=900){for(let i=0;i<max;i++){f.sim.advance(1);const v=f.sim.snapshot(OPS);if(fn(v))return v;}assert.fail("Retiro físico no completado");}
test("expired rack stock is blocked, retrieved by stacker and AMR, then written off once with a ledger entry",t=>{
 const f=fixture(t);let id;
 f.mutate(s=>{const h=s.hus[0];id=h.id;h.expiry="2026-10-16";});
 f.sim.advance(1);let v=f.sim.snapshot(OPS);assert.equal(v.expiry.records.length,1);assert.equal(v.hus.find(h=>h.id===id).cases,12);assert.equal(v.expiry.records[0].state,"TRANSFERRING");
 assert.throws(()=>f.sim.command("incident.resolve",{id:`EXPIRY:${id}`,resolution:"WRITE_OFF",note:"Retiro por vencimiento verificado"},OPS));
 v=until(f,v=>v.hus.find(h=>h.id===id).state==="QUARANTINE");
 assert(v.missions.some(m=>m.expiryWithdrawalId && m.robotId==="STACKER-1" && m.state==="COMPLETED"));
 assert(v.missions.some(m=>m.expiryWithdrawalId && m.deviceType==="AMR" && m.state==="COMPLETED"));
 assert.equal(v.ledger.writtenOffCases,0);assert.equal(v.expiry.pendingDisposalCases,12);
 assert.throws(()=>f.sim.command("inventory.releaseQuarantine",{huId:id},OPS),/caducada/);
 const payload={id:`EXPIRY:${id}`,resolution:"WRITE_OFF",note:"Lote vencido verificado y retirado en cuarentena",commandId:"expiry-once"};
 const reply=f.sim.command("incident.resolve",payload,OPS);assert.deepEqual(f.sim.command("incident.resolve",payload,OPS),reply);
 v=f.sim.snapshot(OPS);assert.equal(v.ledger.writtenOffCases,12);assert.equal(v.hus.find(h=>h.id===id).cases,0);
 assert.equal(v.expiry.records[0].state,"WRITTEN_OFF");assert(f.sim.movements(OPS,{skuId:"SKU-ARROZ",type:"WRITE_OFF"}).items.some(r=>r.cases===12));
 for(const actor of [ADMIN,STORE])assert.throws(()=>f.sim.command("incident.resolve",payload,actor),{status:403});
});
test("same-day expiry is usable through the Lima business date; approaching expiry warns without destruction",t=>{
 const f=fixture(t);f.mutate(s=>{s.hus[0].expiry="2026-10-17";});f.sim.advance(1);const v=f.sim.snapshot(OPS);
 assert.equal(v.expiry.records.length,0);assert(v.expiry.expiringCases>=12);assert(v.inventory.availability.find(r=>r.skuId==="SKU-ARROZ").availableCases>=12);
});
test("full quarantine postpones unloading and restart never duplicates retirement missions",t=>{
 const f=fixture(t);let id;f.mutate(s=>{id=s.hus[0].id;s.hus[0].expiry="2026-10-16";for(const h of s.hus.slice(2,6))Object.assign(h,{state:"QUARANTINE",locationId:"Q"});});
 f.sim.advance(120);let v=f.sim.snapshot(OPS),before=v.missions.filter(m=>m.expiryWithdrawalId).length;assert.equal(v.hus.find(h=>h.id===id).cases,12);assert.notEqual(v.hus.find(h=>h.id===id).state,"QUARANTINE");
 f.restart();f.sim.advance(5);v=f.sim.snapshot(OPS);assert.equal(v.missions.filter(m=>m.expiryWithdrawalId).length,before);assert.equal(v.expiry.records.length,1);assert.equal(v.ledger.writtenOffCases,0);
});
test("store expiry automatically segregates an exact lot for reverse logistics without double counting or cross-tenant data",t=>{
 const f=fixture(t);f.mutate(s=>{const h=s.hus[0];h.cases-=3;s.storeStock.push({id:"ST-EXPIRED",skuId:h.skuId,branchId:"TIENDA-1",orderId:null,lot:"EXPIRED-STORE",expiry:"2026-10-16",cases:3,receivedAt:s.clock.now});});
 f.sim.advance(1);const v=f.sim.snapshot(OPS),ret=v.returns.find(r=>r.automatic);assert(ret);assert.equal(ret.cases,3);assert.equal(ret.loads[0].lot,"EXPIRED-STORE");assert.equal(v.storeStock.find(r=>r.id==="ST-EXPIRED").cases,0);
 assert.equal(v.hus.reduce((n,h)=>n+h.cases,0)+v.storeStock.reduce((n,h)=>n+h.cases,0)+v.returns.filter(r=>r.state!=="QUARANTINED").reduce((n,r)=>n+r.cases,0),360);
 const other=f.sim.snapshot({...STORE,branchId:"TIENDA-2"});assert.equal(other.expiry.automaticReturns.length,0);assert.equal(other.expiryWithdrawals,undefined);assert.deepEqual(other.expiry.records,[]);
});
test("cold, frozen and cleaning retirements use segregated buffers and never mix cleaning with food",t=>{
 const f=fixture(t);const targets=[];
 f.mutate(s=>{for(const [skuId,target] of [["SKU-YOGUR","Q-COLD"],["SKU-HELADO","Q-FROZEN"],["SKU-DETERGENTE","Q-CLEANING"]]){const h=s.hus.find(h=>h.skuId===skuId);h.expiry="2026-10-16";targets.push({id:h.id,target});}});
 const v=until(f,v=>targets.every(t=>v.hus.find(h=>h.id===t.id)?.state==="QUARANTINE"),1800);
 for(const target of targets)assert.equal(v.hus.find(h=>h.id===target.id).locationId,target.target);
 assert.equal(v.ledger.writtenOffCases,0);assert.equal(v.hus.reduce((n,h)=>n+h.cases,0),360);
});
test("expiry cancels untouched reservations safely; a restricted profile receives no retirement dossier",t=>{
 const f=fixture(t);f.sim.command("order.release",{id:"PED-00001"},OPS);f.mutate(s=>{const h=s.hus.find(h=>h.id===s.orders[0].allocations[0].sourceHuId);h.expiry="2026-10-16";});f.sim.advance(1);
 const v=f.sim.snapshot(OPS);assert.equal(v.orders[0].state,"CANCELLED");assert(v.orders[0].cancelReason.includes("venció"));assert(v.hus.every(h=>h.reservedCases===0));
 const restricted=f.sim.snapshot({...OPS,permissions:["overview.view"]});assert.equal(restricted.expiry,null);assert.equal(restricted.expiryWithdrawals,undefined);
});
