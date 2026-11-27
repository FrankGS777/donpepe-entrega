"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { mkdtempSync,rmSync } = require("node:fs"),{ join } = require("node:path"),{ tmpdir } = require("node:os");
const { DatabaseSync } = require("node:sqlite"), { once } = require("node:events");
const { createSimulation } = require("../core/engine"), { createStore } = require("../core/store"),{ createApp } = require("../server");
const { captureInventory,inventoryChanges } = require("../core/inventory-kardex");
const OPS={id:"OPS",role:"operations"},ADMIN={id:"ADMIN",role:"admin"},STORE={id:"STORE",role:"store",branchId:"TIENDA-1"},OTHER={id:"OTHER",role:"store",branchId:"TIENDA-2"};
// Sólo los casos de regresión que descomponen la recepción usan este modo:
// mantiene expediente/revisión obligatorios, sin ejecutar procesos autónomos.
function setup(t,options={}) { const sim=createSimulation({controlledReceivingFixture:true,...options}); t.after(()=>sim.close()); return sim; }
function view(sim){ return sim.snapshot(OPS); }
function until(sim,condition,max=1600) { for(let i=0;i<max;i++){ if(condition(view(sim)))return; sim.advance(1); } assert.fail("No alcanzó el estado esperado"); }
function all(sim,actor=OPS,filters={}) { const first=sim.movements(actor,{...filters,pageSize:100}); const rows=[...first.items]; for(let page=2;page<=first.pages;page++)rows.push(...sim.movements(actor,{...filters,pageSize:100,page}).items); return rows; }
function receivePurchase(sim,cases=5) {
  const sku=view(sim).catalog.skus.find(s=>s.id==="SKU-ARROZ"),id=sim.command("purchase.create",{supplierId:sku.supplierId,lines:[{skuId:sku.id,cases}]},OPS).id;
  sim.command("purchase.arrive",{id},OPS); const p=view(sim).purchases.find(p=>p.id===id);
  const inspection=sim.command("purchase.inspect",{id,expectedPurchaseRevision:p.revision,mode:"MANUAL",documentNumber:"GUIA-KARDEX-001",lines:[{lineId:"LINE-1",barcode:sku.barcode,lot:"LOTE-KARDEX-001",expiry:"2027-06-01",acceptedCases:cases,quarantineCases:0,packaging:"OK",label:"OK",qualityDecision:"ACCEPT"}]},OPS);
  return {id,payload:{id,inspectionId:inspection.inspectionId,expectedPurchaseRevision:inspection.purchaseRevision,commandId:"receipt-kardex"}};
}
test("kardex abre saldos identificados sin fabricar historial y no se duplica al reabrir",t=>{
  const folder=mkdtempSync(join(tmpdir(),"dp-kardex-")),filename=join(folder,"test.sqlite"); t.after(()=>rmSync(folder,{recursive:true,force:true}));
  let sim=createSimulation({filename}),report=sim.movements(OPS,{pageSize:100});
  assert.equal(report.total,24); assert.ok(report.items.every(r=>r.type==="OPENING")); assert.equal(report.items.reduce((n,r)=>n+r.cases,0),360); assert.equal(report.coverage.kind,"OBSERVED_FROM_ACTIVATION"); assert.match(report.coverage.note,/no se reconstruyen/);
  const ids=report.items.map(r=>r.id);sim.close();sim=createSimulation({filename});report=sim.movements(OPS,{pageSize:100});assert.deepEqual(report.items.map(r=>r.id),ids);sim.close();
});
test("tabla de movimientos prohíbe actualizar/borrar y revierte anexados en transacción fallida",t=>{
  const folder=mkdtempSync(join(tmpdir(),"dp-kardex-guard-")),filename=join(folder,"test.sqlite");t.after(()=>rmSync(folder,{recursive:true,force:true}));const sim=createSimulation({filename});sim.close();
  const db=new DatabaseSync(filename);assert.throws(()=>db.exec("DELETE FROM inventory_movements"),/solo anexado/);assert.throws(()=>db.exec("UPDATE inventory_movements SET type='INVALID'"),/solo anexado/);db.close();
  const store=createStore(filename),before=store.queryMovements({}).total;assert.throws(()=>store.transaction(()=>{store.appendMovements([{at:"2026-10-18T00:00:00Z",skuId:"TEST",lot:"TEST",type:"RECEIPT"}]);throw Error("rollback");}),/rollback/);assert.equal(store.queryMovements({}).total,before);store.close();
});
test("inspección no mueve stock; recepción confirmada registra lote, responsable y reintento único",t=>{
  const sim=setup(t),receipt=receivePurchase(sim),before=all(sim).length;assert.equal(before,24);
  sim.command("purchase.receive",receipt.payload,OPS); const rows=all(sim,{...OPS},{type:"RECEIPT"});assert.equal(rows.length,1);const row=rows[0];assert.equal(row.cases,5);assert.equal(row.lot,"LOTE-KARDEX-001");assert.equal(row.actorId,OPS.id);assert.equal(row.documentId,receipt.id);assert.equal(row.to.id,"RECEIVE");assert.equal(row.networkBalanceCases,5);assert.ok(row.huId);assert.equal(row.from.scope,"EXTERNAL");
  sim.command("purchase.receive",receipt.payload,OPS);assert.equal(all(sim).length,before+1);
});
test("rechazos y movimientos visuales sin cambio de posición no inventan asientos",t=>{
  const sim=setup(t),before=all(sim);assert.throws(()=>sim.command("order.dispatch",{id:"PED-00001"},OPS),{status:422});assert.deepEqual(all(sim),before);sim.advance(0.1);assert.deepEqual(all(sim),before);
});
test("separación conserva lote y enlaza padre/hijo sin convertirla en entrada de proveedor",t=>{
  const sim=setup(t),state=view(sim),hu=state.hus[0];hu.locationId="PACK";const before=captureInventory(state);hu.cases-=4;state.hus.push({...hu,id:"NEW-CHILD",parentId:hu.id,cases:4});const rows=inventoryChanges(state,before,captureInventory(state),{type:"automation"});assert.equal(rows.length,1);assert.equal(rows[0].type,"SPLIT");assert.equal(rows[0].cases,4);assert.equal(rows[0].sourceHuId,hu.id);assert.equal(rows[0].huId,"NEW-CHILD");assert.equal(rows[0].networkBalanceCases,12);
});
test("filtros del kardex validan fechas/paginación y escapar comodines evita coincidencias engañosas",t=>{
  const sim=setup(t);for(const filter of [{page:0},{pageSize:101},{fromDate:"2026-02-30"},{toDate:"INVALID"},{fromDate:"2026-11-01",toDate:"2026-10-01"},{type:"FAKE"},{skuId:[]},{query:"x".repeat(161)}])assert.throws(()=>sim.movements(OPS,filter),{status:422});
  assert.equal(sim.movements(OPS,{query:"%"}).total,0);assert.equal(sim.movements(OPS,{query:"_"}).total,0);const report=sim.movements(OPS,{skuId:"SKU-ARROZ",pageSize:1});assert.equal(report.total,2);assert.equal(report.pages,2);assert.equal(report.items.length,1);assert.equal(sim.movements(OPS,{lot:report.items[0].lot}).total,1);
});
test("fechas del kardex respetan la medianoche de Lima y no el cambio de día UTC",()=>{
  const store=createStore(":memory:");
  try{
    store.appendMovements([
      {at:"2026-10-18T03:00:00.000Z",skuId:"TEST",lot:"PERU-17",type:"RECEIPT"},
      {at:"2026-10-18T04:59:59.999Z",skuId:"TEST",lot:"PERU-17-END",type:"RECEIPT"},
      {at:"2026-10-18T05:00:00.000Z",skuId:"TEST",lot:"PERU-18",type:"RECEIPT"},
      {at:"2026-10-19T04:59:59.999Z",skuId:"TEST",lot:"PERU-18-END",type:"RECEIPT"},
      {at:"2026-10-19T05:00:00.000Z",skuId:"TEST",lot:"PERU-19",type:"RECEIPT"},
    ]);
    assert.deepEqual(store.queryMovements({fromDate:"2026-10-17",toDate:"2026-10-17"}).items.map(row=>row.lot),["PERU-17-END","PERU-17"]);
    assert.deepEqual(store.queryMovements({fromDate:"2026-10-18",toDate:"2026-10-18"}).items.map(row=>row.lot),["PERU-18-END","PERU-18"]);
    assert.deepEqual(store.queryMovements({fromDate:"2026-10-19",toDate:"2026-10-19"}).items.map(row=>row.lot),["PERU-19"]);
  }finally{store.close();}
});
test("ubicación heredada nula queda explícita sin inventar una LOC ni modificar la carga",t=>{
  const sim=setup(t),v=view(sim);v.hus[0].locationId=null;const captured=captureInventory(v),row=captured.find(r=>r.huId===v.hus[0].id);assert.equal(row.position.id,"UNRECORDED");assert.equal(row.position.label,"Ubicación no registrada");assert.equal(row.position.scope,"UNKNOWN");assert.equal(v.hus[0].locationId,null);
});
test("gobierno consulta sin operar y permisos restringidos no pueden consultar kardex",t=>{
  const sim=setup(t);assert.equal(sim.movements(ADMIN).total,24);assert.equal(sim.movements(STORE).total,0);for(const actor of [{...OPS,permissions:["overview.view"]},{...ADMIN,permissions:["overview.view"]},{id:"X",role:"store"}])assert.throws(()=>sim.movements(actor),{status:403});assert.throws(()=>sim.command("order.receive",{id:"PED-00001"},OPS),{status:403});
});
test("camión ocupado muestra causa y sólo la tienda libera la entrega; retorno es físico",t=>{
  const sim=setup(t);sim.command("order.release",{id:"PED-00001"},OPS);until(sim,s=>s.orders[0].state==="READY");sim.command("order.dispatch",{id:"PED-00001"},OPS);until(sim,s=>s.orders[0].state==="ARRIVED");
  let fleet=view(sim).fleetReadModels.find(t=>t.orderId==="PED-00001");assert.equal(fleet.state,"AT_STORE");assert.equal(fleet.available,false);assert.match(fleet.reason,/no confirmó/);assert.equal(fleet.nextAction,"CONFIRM_STORE_RECEIPT");assert.equal(fleet.canConfirmReceipt,false);assert.equal(sim.snapshot(STORE).fleetReadModels.find(t=>t.truckId===fleet.truckId).canConfirmReceipt,true);assert.equal(sim.snapshot(OTHER).fleetReadModels.length,0);
  const rowsBefore=all(sim),returned=sim.command("order.receive",{id:"PED-00001",commandId:"receive-store"},STORE);assert.ok(returned.id);fleet=view(sim).fleetReadModels.find(t=>t.orderId==="PED-00001");assert.equal(fleet.state,"RETURNING");assert.ok(fleet.returnSecondsRemaining>0);until(sim,s=>s.trucks.find(t=>t.id===fleet.truckId).state==="AVAILABLE",100);assert.equal(view(sim).fleetReadModels.find(t=>t.truckId===fleet.truckId).available,true);
  const own=all(sim,STORE);assert.ok(own.some(r=>r.type==="STORE_RECEIPT"));assert.ok(own.every(r=>r.from.branchId===STORE.branchId||r.to.branchId===STORE.branchId));assert.ok(own.every(r=>r.networkBalanceCases===null));assert.equal(sim.movements(OTHER).total,0);assert.ok(all(sim).length>rowsBefore.length);
  const receiptRows=all(sim,OPS,{type:"STORE_RECEIPT"});assert.equal(receiptRows.reduce((n,r)=>n+r.cases,0),6);
  sim.command("store.consume",{skuId:"SKU-ARROZ",cases:1},STORE);assert.equal(all(sim,STORE,{type:"STORE_SALE"})[0].cases,1);
  sim.command("return.create",{orderId:"PED-00001",skuId:"SKU-ARROZ",cases:1,reason:"Caja dañada para revisión"},STORE);assert.equal(all(sim,STORE,{type:"RETURN"})[0].cases,1);
  until(sim,s=>s.returns[0].state==="QUARANTINED",150);assert.ok(all(sim,OPS,{type:"RETURN"}).some(r=>r.to.id==="Q"));assert.ok(all(sim,STORE).every(r=>r.to.branchId===STORE.branchId||r.locationBalanceCases===null));
});
test("API y CSV respetan sesión, ámbito y permisos sin habilitar edición del kardex",async t=>{
  const runtime=createApp({identityFile:":memory:",simulationFile:":memory:",startClock:false,mailTransport:{sendMail:async()=>({})}}),server=runtime.app.listen(0,"127.0.0.1");await once(server,"listening");t.after(async()=>{await new Promise(resolve=>server.close(resolve));runtime.close();});const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+"/api/inventory/movements")).status,401);
  for(const [email,expected]of [["admin@donpepe.local",24],["operaciones@donpepe.local",24],["tienda@donpepe.local",0]]){
    const response=await fetch(base+"/api/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password:"DonPepe2026!"})}),cookie=response.headers.get("set-cookie").split(";")[0];assert.equal(response.status,200);const headers={cookie},report=await(await fetch(base+"/api/inventory/movements",{headers})).json();assert.equal(report.total,expected);const csv=await fetch(base+"/api/inventory/movements/export.csv",{headers});assert.equal(csv.status,200);assert.match(csv.headers.get("content-type"),/text\/csv/);assert.match(await csv.text(),/Lote proveedor/);assert.equal((await fetch(base+"/api/inventory/movements?pageSize=1000",{headers})).status,422);
  }
});
