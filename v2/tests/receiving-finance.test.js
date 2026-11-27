const test=require('node:test'),assert=require('node:assert/strict');
const {financeCommand,financeReadModel}=require('../core/finance-domain');
const ctx={id:(s,p)=>`${p}-${++s.serial}`,event:()=>{}};
const state=()=>({serial:0,clock:{now:'2026-11-07T12:00:00Z'},purchases:[{id:'OC-1',supplierId:'SUP-1',state:'RECEIVED',lines:[{receivedCases:12}]}],orders:[{id:'PED-1',branchId:'S-1',createdAt:'2026-11-07',state:'RECEIVED',lines:[{skuId:'SKU-1',cases:4,receivedCases:4}]}]});
test('supplier bill, exact cents, partial payment, duplicate and overpayment checks',()=>{const s=state(),a={id:'a',role:'admin'};const b=financeCommand(s,'finance.bill.create',{purchaseId:'OC-1',reference:'F001-123',date:'2026-11-07',dueDate:'2026-11-30',subtotal:100,tax:18},a,ctx);assert.throws(()=>financeCommand(s,'finance.bill.create',{purchaseId:'OC-1',reference:'F001-123',date:'2026-11-07',dueDate:'2026-11-30',subtotal:100,tax:18},a,ctx));financeCommand(s,'finance.payment.create',{billId:b.id,amount:50,reference:'OP-123',method:'TRANSFER'},a,ctx);assert.equal(financeReadModel(s,a).bills[0].balanceCents,6800);assert.throws(()=>financeCommand(s,'finance.payment.create',{billId:b.id,amount:69,reference:'OP-124',method:'TRANSFER'},a,ctx));assert.throws(()=>financeCommand(s,'finance.payment.create',{billId:b.id,amount:10,reference:'OP-123',method:'TRANSFER'},a,ctx));assert.equal(financeReadModel(s,{role:'store',branchId:'OTHER'}).transfers.length,0);assert.equal(financeReadModel(s,{role:'store',branchId:'S-1'}).bills.length,0);assert.equal(financeReadModel(s,{role:'store',branchId:'S-1'}).transfers[0].paymentRequired,false);});
test('finance command boundary rejects operations and store roles',()=>{const {assertCommandAllowed}=require('../security/policy');for(const role of ['store','operations'])assert.throws(()=>assertCommandAllowed({id:'u',role},'finance.payment.create'));});
test('forklift keeps a supporting fork carriage below the pallet at all sampled phases',async()=>{const {inboundForkPose}=await import('../frontend/scene-automation-motion.js');for(let i=0;i<=100;i++){const m=inboundForkPose({x:-86.8,y:1.2,z:17},{x:-75,y:.85,z:17},i/100);assert.equal(m.cargo.y,m.surfaceY);assert.ok(Math.abs(Math.hypot(m.carrier.x-m.cargo.x,m.carrier.z-m.cargo.z)-1.65)<1e-8);assert.ok(m.cargo.y>=.85);}});
test('only the damaged cartons go to quarantine and the rest are stored under the same lot', () => {
 const {createSimulation}=require('../core/engine');
 const sim=createSimulation(), ops={id:'o',role:'operations'}, admin={id:'a',role:'admin'};
 const read=()=>sim.snapshot(ops);
 try {
  const initial=read();
  sim.command('config.settings.update',{expectedRevision:initial.configuration.revision,settings:{packagingDamagePercent:100}},admin);
  const sku=read().catalog.skus.find(r=>r.id==='SKU-ARROZ');
  const {id}=sim.command('purchase.create',{supplierId:sku.supplierId,lines:[{skuId:sku.id,cases:12}]},ops);
  const declared=read().autonomy.notices[0].loads[0];
  const damaged=declared.damagedCaseIndexes.length;
  assert.equal(declared.packagingDefect,'TORN_BAG');
  assert.ok(damaged>=1 && damaged<=3);
  for(let i=0;i<330;i++){
    if(i%5===0 && read().autonomy.jobs.find(j=>j.documentId===id)?.state==='COMPLETED') break;
    sim.advance(1);
  }
  const final=read(), loads=final.hus.filter(h=>h.purchaseId===id);
  const good=loads.find(h=>h.state==='STORED'), held=loads.find(h=>h.state==='QUARANTINE');
  assert.equal(held.locationId,'Q');
  assert.equal(held.cases,damaged);
  assert.equal(good.cases,12-damaged);
  assert.equal(held.lot,good.lot);
  assert.equal(held.sourceSscc,good.sscc);
  assert.notEqual(held.id,good.id);
  assert.equal(good.packagingDefect,undefined);
  assert.equal(final.metrics.availableCases-initial.metrics.availableCases,good.cases);
  assert.equal(final.purchases.find(p=>p.id===id).lines[0].receivedCases,12);
  assert.ok(final.missions.some(m=>m.huId===held.id && m.kind==='RETURN_TO_QUARANTINE' && m.state==='COMPLETED'));
  assert.equal(final.missions.some(m=>m.huId===good.id && m.kind==='RETURN_TO_QUARANTINE'),false);
  const reading=final.autonomy.evidence.find(e=>e.checkpoint==='PIE' && e.decision==='HOLD');
  assert.equal(reading.payload.vision.result,'REJECT');
  assert.deepEqual(reading.payload.damagedCaseIndexes,declared.damagedCaseIndexes);
  assert.equal(reading.payload.damagedCases,damaged);
  assert.equal(final.receipts[0].lines[0].qualityDecision,'PARTIAL_HOLD');
  assert.equal(final.autonomy.jobs.find(j=>j.documentId===id).state,'COMPLETED');
  assert.throws(()=>sim.command('inventory.releaseQuarantine',{huId:held.id},ops),/daño visual/);
 } finally {sim.close();}
});

test('damage depends on the product and its packaging rather than its storage zone alone', () => {
 const {defectForProduct, caseDamageKind, damagedCaseCount}=require('../core/packaging-quality');
 const dry={zoneId:'DRY'};
 const examples=[
   [{...dry,name:'Harina de maíz',presentation:'Bolsa 1 kg',category:'Harinas'},'TORN_BAG'],
   [{...dry,name:'Atún en aceite',presentation:'Lata 140 g',category:'Conservas'},'DENTED'],
   [{...dry,name:'Leche UHT',presentation:'Caja 946 ml'},'LIQUID_LEAK'],
   [{...dry,name:'Aceite de oliva',presentation:'Botella 500 ml'},'LIQUID_LEAK'],
   [{...dry,name:'Mayonesa',presentation:'Doypack 850 g'},'OPEN_SEAL'],
   [{...dry,name:'Café instantáneo',presentation:'Frasco 170 g'},'DENTED'],
   [{zoneId:'FROZEN',name:'Helado',presentation:'Pote 900 ml'},'OPEN_SEAL'],
   [{zoneId:'CLEANING',name:'Detergente en polvo',presentation:'Bolsa 730 g'},'TORN_BAG'],
 ];
 for(const [sku,defect] of examples) assert.equal(defectForProduct(sku),defect);
 const partial={packagingDefect:'TORN_BAG',cases:6,damagedCaseIndexes:[4,5]};
 assert.deepEqual([0,1,2,3,4,5].map(index=>caseDamageKind(partial,index)),[null,null,null,null,'torn','torn']);
 assert.equal(damagedCaseCount(partial),2);
 assert.equal(damagedCaseCount({packagingDefect:'WET_LEAK',cases:6}),6);
 assert.equal(caseDamageKind({packagingDefect:'WET_LEAK',cases:6},0),'liquid');
});
test('the supplier truck finishes docking before the slower unload and conveyor run', () => {
 const {createSimulation}=require('../core/engine');
 const sim=createSimulation(), ops={id:'o',role:'operations'};
 const read=()=>sim.snapshot(ops);
 try {
  const sku=read().catalog.skus.find(r=>r.id==='SKU-ARROZ');
  sim.command('purchase.create',{supplierId:sku.supplierId,lines:[{skuId:sku.id,cases:1}]},ops);
  let view=read();
  for(let i=0;i<30 && !view.autonomy.map.supplierDock.occupied;i++) {
    sim.advance(1);
    view=read();
  }
  assert.equal(view.autonomy.map.supplierDock.arrivalProgress,0);
  assert.ok(view.autonomy.map.loads.every(load=>!load.visible));
  sim.advance(6);
  view=read();
  assert.equal(view.autonomy.map.supplierDock.arrivalProgress,.5);
  assert.ok(view.autonomy.map.loads.every(load=>!load.visible));
  sim.advance(6);
  view=read();
  assert.equal(view.autonomy.map.supplierDock.arrivalProgress,1);
  assert.equal(view.autonomy.jobs[0].state,'UNLOADING');
  assert.equal(view.autonomy.map.loads[0].progress,0);
  sim.advance(6);
  view=read();
  assert.equal(view.autonomy.map.loads[0].progress,.5);
  assert.equal(view.autonomy.evidence.length,0);
  sim.advance(6);
  assert.equal(read().autonomy.jobs[0].state,'IDENTIFYING');
  sim.advance(8);
  view=read();
  assert.equal(view.autonomy.jobs[0].state,'INSPECTING');
  assert.equal(view.autonomy.evidence.find(row=>row.checkpoint==='AUTO_ID').payload.acquisitionSeconds,3);
  sim.advance(9);
  assert.equal(read().autonomy.jobs[0].state,'RECEIVING');
 } finally {
  sim.close();
 }
});
