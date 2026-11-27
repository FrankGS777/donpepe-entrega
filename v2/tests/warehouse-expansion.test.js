"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {createBlueprint}=require("../core/blueprint"),{migrateWarehouseExpansion}=require("../core/warehouse-expansion");
const {physicalLayout}=require("../core/physical-layout"),{constrainMotion,bodyProfile}=require("../core/physical-contact");
const {createSimulation}=require("../core/engine"),{createStore}=require("../core/store");
const {mkdtempSync,rmSync}=require("node:fs"),{tmpdir}=require("node:os"),{join}=require("node:path");
const OPS={id:"ops",role:"operations"};
function fixture(t){const folder=mkdtempSync(join(tmpdir(),"dp-expansion-")),filename=join(folder,"scenario.sqlite"),sim=createSimulation({filename,academicLegacyFixture:true});t.after(()=>{sim.close();rmSync(folder,{recursive:true,force:true});});return{sim,filename,mutate(fn){const db=createStore(filename),s=db.read();fn(s);db.write(s);db.close();}};}
test("four additional aisles in each storage zone provide 448 unique physical addresses",()=>{
  const l=createBlueprint();assert.equal(l.locations.length,448);assert.equal(l.racks.length,70);
  for(const zoneId of ["DRY","COLD","FROZEN","CLEANING"])assert.equal(l.aisles.filter(a=>a.zoneId===zoneId && a.added).length,4);
  assert.equal(new Set(l.locations.map(p=>p.id)).size,448);
  for(const loc of l.locations){assert(loc.z>-82 && loc.z<35);if(loc.stackerId)assert(l.stations.some(s=>s.id===loc.handoffId));else assert(l.nodes.some(n=>n.id===loc.nodeId));}
  const dry=l.locations.find(p=>p.id==="CD1-SEC-A01-R01-N01-P01");assert.deepEqual([dry.x,dry.y,dry.z],[-38.9,.8,-17]);
});
test("extension migration is additive and idempotent; occupied bays, routes, balances and locks survive",t=>{
  const f=fixture(t);const db=createStore(f.filename),s=db.read();db.close();
  const before=structuredClone({hus:s.hus,orders:s.orders,ledger:s.ledger,missions:s.missions,locks:s.routeLocks,old:s.layout.locations.filter(l=>l.z>=-28)});
  assert.equal(migrateWarehouseExpansion(s),false);
  assert.deepEqual({hus:s.hus,orders:s.orders,ledger:s.ledger,missions:s.missions,locks:s.routeLocks,old:s.layout.locations.filter(l=>l.z>=-28)},before);
  assert.equal(s.robots.filter(r=>r.id.includes("-STACKER-")).length,8);
  for(const rail of s.layout.rails)assert.equal(s.robots.find(r=>r.id===rail.id).railZ,rail.z);
});
test("legacy route locks extend to new junctions without changing an in-flight device or its cargo",t=>{
 const f=fixture(t),db=createStore(f.filename),s=db.read();db.close();
 delete s.layout.rearExpansionVersion;delete s.layout.rearCleaning;delete s.layout.aisles;delete s.layout.rails;
 s.layout.racks=s.layout.racks.filter(r=>r.z>=-28);s.layout.locations=s.layout.locations.filter(l=>l.z>=-28);
 s.layout.nodes=s.layout.nodes.filter(n=>!n.id.includes("REAR") && !n.id.startsWith("JUNCTION:") && n.id!=="Q-CLEANING");
 const ids=new Set(s.layout.nodes.map(n=>n.id));s.layout.edges=s.layout.edges.filter(e=>ids.has(e.from) && ids.has(e.to));
 const key=["C-2","CLEAN-IN"].sort().join("~");s.layout.edges.push({id:key,from:"C-2",to:"CLEAN-IN"});s.routeLocks={[key]:"MIS-LEGACY"};
 s.robots=s.robots.filter(r=>!r.id.includes("-STACKER-"));const robot=s.robots.find(r=>r.id==="AMR-1");Object.assign(robot,{x:-2,z:-10,state:"MOVING",carryingHuId:s.hus[0].id});
 const before=structuredClone({robot,hus:s.hus,ledger:s.ledger});
 assert(migrateWarehouseExpansion(s));assert.deepEqual(robot,before.robot);assert.deepEqual(s.hus,before.hus);assert.deepEqual(s.ledger,before.ledger);
 assert.equal(s.routeLocks[key],"MIS-LEGACY");assert.equal(s.routeLocks["node:REAR-CROSS-E"],"MIS-LEGACY");
 assert.equal(s.layout.locations.length,448);
});
test("new AMR access paths and rear cleaning doorway have swept collision clearance",()=>{
  const l=createBlueprint(),world=physicalLayout(l),body={...bodyProfile("AMR"),id:"test"};
  for(const edge of l.edges.filter(e=>e.from.includes("REAR") || e.to.includes("REAR"))){
    if(edge.temperature)continue;
    const a=l.nodes.find(n=>n.id===edge.from),b=l.nodes.find(n=>n.id===edge.to),heading=Math.atan2(b.x-a.x,b.z-a.z);
    const result=constrainMotion(body,{...a,y:0,heading},{...b,y:0,heading},world.solids);
    assert.equal(result.contact,null,`${edge.id}: ${result.contact?.obstacleId}`);
  }
});
test("a load from the last new refrigerated aisle is picked, split and staged by its real devices",t=>{
  const f=fixture(t);let target,huId;
  f.mutate(s=>{const h=s.hus.find(h=>h.skuId==="SKU-YOGUR"),p=s.layout.locations.find(l=>l.zoneId==="COLD" && l.aisle===6 && l.level===3);h.locationId=p.id;target=p;huId=h.id;s.orders[0].lines=[{id:"LINE-1",skuId:h.skuId,cases:2}];});
  f.sim.command("order.release",{id:"PED-00001"},OPS);
  let v;
  for(let i=0;i<1300;i++){f.sim.advance(1);v=f.sim.snapshot(OPS);if(v.orders[0].state==="READY")break;}
  assert.equal(v.orders[0].state,"READY");assert(v.missions.some(m=>m.robotId===target.stackerId && m.state==="COMPLETED"));
  assert.equal(v.ledger.initialCases,360);assert.equal(v.hus.filter(h=>h.parentId===huId).reduce((n,h)=>n+h.cases,0),2);
});
