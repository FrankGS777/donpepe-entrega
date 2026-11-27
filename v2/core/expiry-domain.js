"use strict";
const {limaDate,addLimaDays}=require("./time");
const closed=new Set(["COMPLETED","CANCELLED"]);
const expired=(s,row)=>Boolean(row.expiry && row.expiry<limaDate(s.clock.now));

// Dates block availability immediately; physical custody changes only through
// existing transport missions. Disposal remains a witnessed operational act.
function tickExpiry(s,context){
  const {id,event,newMission,quarantineId,cancelOrder,rejectPrepared,buffered,reservedReturns,inboundBuffers,capacity}=context;
  s.expiryWithdrawals ||= [];
  for(const hu of s.hus.filter(h=>h.cases>0 && expired(s,h) && !["DELIVERED","DISCREPANCY"].includes(h.state))){
    let record=s.expiryWithdrawals.find(r=>r.huId===hu.id);
    if(!record){record={id:id(s,"RET"),huId:hu.id,skuId:hu.skuId,lot:hu.lot,expiry:hu.expiry,cases:hu.cases,detectedAt:s.clock.now,state:"BLOCKED",reason:"Vencimiento de lote"};s.expiryWithdrawals.push(record);hu.expiryHoldAt=s.clock.now;event(s,"EXPIRY_BLOCKED",`${hu.id}: lote vencido; bloqueado para reservas, venta y expedición.`,{huId:hu.id,withdrawalId:record.id});}
    if(hu.state==="QUARANTINE"){record.state="AWAITING_DISPOSAL";record.arrivedAt ||= s.clock.now;continue;}
    const occupied=s.robots.some(r=>r.carryingHuId===hu.id) || ["IN_TRANSIT","ON_TRUCK","LOADING","PACKING","RESERVED_LOADING"].includes(hu.state);
    // Cancel untouched reservations only before any fork has started loading.
    const orders=s.orders.filter(o=>["PREPARING","READY","LOADING"].includes(o.state) && o.allocations.some(a=>a.sourceHuId===hu.id || a.huId===hu.id));
    for(const order of orders){
      if(order.state==="PREPARING" && !order.allocations.some(a=>a.picked) && s.missions.filter(m=>m.orderId===order.id && !closed.has(m.state)).every(m=>["WAITING","TO_SOURCE"].includes(m.phase) && s.robots.find(r=>r.id===m.robotId)?.state!=="FAULT")){
        cancelOrder(s,order);order.cancelReason="Cancelación automática: el lote reservado venció antes de su recogida.";order.cancelledAt=s.clock.now;order.cancelledBy="AUTOMATION";
      }else if(order.state==="READY" && order.allocations.every(a=>s.hus.find(h=>h.id===a.huId)?.state==="STAGED")) rejectPrepared(s,order);
      else if(order.state==="LOADING" && order.loading?.phase==="QUALITY_HOLD"){
        const truck=s.trucks.find(t=>t.id===order.truckId),robot=s.robots.find(r=>r.id===s.layout.loadingDocks.find(d=>d.id===truck?.dockId)?.forkliftId);
        if(robot && !robot.missionId && !robot.carryingHuId && robot.state!=="FAULT" && truck.loadPositions.filter(slot=>slot.huId).length===order.allocations.length) rejectPrepared(s,order);
      }
    }
    if(occupied){record.state="WAITING_SAFE_TRANSFER";continue;}
    const active=s.missions.find(m=>m.huId===hu.id && !closed.has(m.state));
    if(active){record.state=active.expiryWithdrawalId || active.kind==="RETURN_TO_QUARANTINE" ? "TRANSFERRING" : "WAITING_SAFE_TRANSFER";continue;}
    if(hu.reservedCases || orders.some(o=>o.state==="PREPARING") || !["STORED","RECEIVED","WAITING_SPACE","AT_TRANSFER","WAITING_QUARANTINE","WAITING_PUTAWAY"].includes(hu.state))continue;
    const sku=s.catalog.skus.find(row=>row.id===hu.skuId),destinationId=quarantineId(sku),loc=s.layout.locations.find(l=>l.id===hu.locationId);
    // Queued putaway reservations can be relinquished without moving cargo.
    for(const [key,status] of Object.entries(s.locationStatus))if(status.reservedFor===hu.id)delete status.reservedFor;
    hu.state="WAITING_QUARANTINE";
    const common={huId:hu.id,cases:hu.cases,sourceId:hu.locationId,zoneId:sku.zoneId,priority:"HIGH",expiryWithdrawalId:record.id,expiryDestinationId:destinationId};
    if(loc?.stackerId)newMission(s,{...common,kind:"PICK",deviceType:loc.zoneId==="FROZEN"?"SHUTTLE":"STACKER",requiredRobotId:loc.stackerId,destinationId:loc.handoffId});
    else if(s.layout.nodes.some(n=>n.id===(loc?.nodeId || hu.locationId)))newMission(s,{...common,kind:"RETURN_TO_QUARANTINE",deviceType:"AMR",destinationId});
    else {record.state="WAITING_SAFE_TRANSFER";continue;}
    record.state="TRANSFERRING";event(s,"EXPIRY_WITHDRAWAL_STARTED",`${hu.id}: retiro automático hacia cuarentena compatible con su conservación.`,{huId:hu.id,withdrawalId:record.id});
  }
  // A store's expired balances are never sold. Reverse logistics uses the
  // registered fleet and reserves segregated quarantine capacity before pickup.
  for(const stock of s.storeStock.filter(row=>row.cases>0 && expired(s,row))){
    if(!stock.expiryHoldAt){stock.expiryHoldAt=s.clock.now;event(s,"STORE_EXPIRY_BLOCKED",`${stock.lot}: lote vencido apartado de venta; pendiente de recogida automática.`,{branchId:stock.branchId,skuId:stock.skuId,lot:stock.lot,cases:stock.cases});}
    const sku=s.catalog.skus.find(row=>row.id===stock.skuId),station=quarantineId(sku);
    if(buffered(s,station)+reservedReturns(s,station)+inboundBuffers(s,station)>=capacity[station])continue;
    if(!s.catalog.branches.some(b=>b.id===stock.branchId))continue;
    const cases=Math.min(stock.cases,sku.maxCasesPerHu,120);
    const ret={id:id(s,"DEV"),orderId:stock.orderId || null,branchId:stock.branchId,skuId:stock.skuId,cases,reason:"Retiro automático por vencimiento del lote",reasonCode:"EXPIRY",automatic:true,sourceStockId:stock.id,state:"WAITING_PICKUP",createdAt:s.clock.now,createdBy:"AUTOMATION",truckId:null,loads:[{lot:stock.lot,expiry:stock.expiry,cases}]};
    stock.cases-=cases;s.returns.push(ret);event(s,"RETURN_CREATED",`${ret.id}: ${cases} cajas vencidas apartadas para recogida automática.`,{returnId:ret.id,branchId:stock.branchId});
  }
  for(const record of s.expiryWithdrawals){const hu=s.hus.find(h=>h.id===record.huId);if(hu?.state==="WRITTEN_OFF"){record.state="WRITTEN_OFF";record.completedAt=hu.writtenOffAt;}}
}
function expiryReadModel(s,actor){
  const today=limaDate(s.clock.now),limit=addLimaDays(s.clock.now,7),isStore=actor.role==="store";
  const records=(s.expiryWithdrawals || []).map(row=>({...row}));
  const loads=isStore?[]:s.hus.filter(h=>h.cases>0 && !["DELIVERED","DISCREPANCY"].includes(h.state));
  const store=s.storeStock.filter(row=>row.cases>0 && (!isStore || row.branchId===actor.branchId));
  const returns=s.returns.filter(r=>r.state!=="QUARANTINED" && (!isStore || r.branchId===actor.branchId)).flatMap(r=>r.loads);
  return {asOf:s.clock.now,timeZone:"America/Lima",warningDays:7,policy:"FEFO",records:isStore?[]:records,
    expiredCases:[...loads,...store,...returns].filter(row=>row.expiry && row.expiry<today).reduce((n,row)=>n+row.cases,0),
    expiringCases:[...loads,...store].filter(row=>row.expiry && row.expiry>=today && row.expiry<=limit).reduce((n,row)=>n+row.cases,0),
    pendingDisposalCases:isStore?0:records.filter(r=>r.state==="AWAITING_DISPOSAL").reduce((n,row)=>n+row.cases,0),
    automaticReturns:s.returns.filter(r=>r.automatic && (!isStore || r.branchId===actor.branchId)).map(r=>({id:r.id,branchId:r.branchId,state:r.state,cases:r.cases,createdAt:r.createdAt}))};
}
module.exports={tickExpiry,expiryReadModel,expired};
