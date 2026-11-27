"use strict";
const pad = n => String(n).padStart(2, "0");
const VERSION = 1;

function normalizeGraph(layout){
  const point=id=>layout.nodes.find(n=>n.id===id),edges=[...layout.edges];
  const between=(v,a,b)=>v>=Math.min(a,b)-1e-6 && v<=Math.max(a,b)+1e-6;
  for(const e of edges)for(const f of edges){
    const a=point(e.from),b=point(e.to),c=point(f.from),d=point(f.to);
    if(a.z!==b.z || c.x!==d.x || a.x===b.x || c.z===d.z)continue;
    if(!between(c.x,a.x,b.x) || !between(a.z,c.z,d.z))continue;
    if(!layout.nodes.some(n=>n.x===c.x && n.z===a.z))layout.nodes.push({id:`JUNCTION:${c.x}:${a.z}`,x:c.x,z:a.z});
  }
  const result=new Map();
  for(const e of edges){
    const a=point(e.from),b=point(e.to);
    const nodes=layout.nodes.filter(n=>(a.x===b.x ? n.x===a.x && between(n.z,a.z,b.z) : a.z===b.z ? n.z===a.z && between(n.x,a.x,b.x) : n.id===a.id || n.id===b.id))
      .sort((u,v)=>Math.hypot(u.x-a.x,u.z-a.z)-Math.hypot(v.x-a.x,v.z-a.z));
    for(let i=1;i<nodes.length;i++){const from=nodes[i-1].id,to=nodes[i].id,id=[from,to].sort().join("~");if(from!==to)result.set(id,{...e,id,from,to});}
  }
  layout.edges=[...result.values()];
}

// Additive extension: existing addresses, buffers, missions and occupied bays
// remain at their original coordinates. Four new operating aisles per zone.
function extendWarehouse(layout) {
  if (layout.rearExpansionVersion === VERSION) return false;
  const node = (id, x, z) => { if (!layout.nodes.some(n => n.id === id)) layout.nodes.push({ id, x, z }); return id; };
  const edge = (a, b, extra = {}) => { const id = [a,b].sort().join("~"); if (!layout.edges.some(e => e.id === id)) layout.edges.push({ id, from:a, to:b, ...extra }); };
  const rails = [{ id:"STACKER-1", zoneId:"DRY", z:-12, left:-44, right:-2 }, { id:"STACKER-2", zoneId:"COLD", z:-16, left:0, right:26 }];
  layout.aisles = [];
  for (const [zoneId, oldAisle] of [["DRY",1],["COLD",2],["FROZEN",3],["CLEANING",4]]) layout.aisles.push({ id:`${zoneId}-A${pad(oldAisle)}`, zoneId, number:oldAisle, existing:true });
  for (const [zoneId, xs, oldAisle, spine, prefix] of [["DRY",[-37,-27,-17,-7],1,-44,"SEC"],["COLD",[6,14,22],2,0,"REF"]]) {
    let module = Math.max(0, ...layout.racks.filter(r => r.zoneId === zoneId).map(r => r.module));
    let previous = zoneId === "DRY" ? "DRY-IN" : "COLD-IN";
    for (let i=0;i<4;i++) {
      const number=oldAisle+i+1, z=-37-i*12, handoffId=`${zoneId}-REAR-A${pad(number)}`, stackerId=`${zoneId}-STACKER-A${pad(number)}`;
      node(handoffId,spine,z); edge(previous,handoffId); previous=handoffId;
      layout.stations.push({ id:handoffId, name:`Transferencia ${zoneId === "DRY" ? "seca" : "refrigerada"} · pasillo ${pad(number)}`, type:"HANDOFF", x:spine,z,zoneId });
      layout.aisles.push({ id:`${zoneId}-A${pad(number)}`,zoneId,number,z,handoffId,stackerId,added:true });
      rails.push({ id:stackerId,zoneId,z,left:spine,right:zoneId === "DRY" ? -2 : 26 });
      for (const rz of [z-4,z+4]) for (const x of xs) {
        const rackId=`${zoneId}-R${pad(++module)}`;
        layout.racks.push({ id:rackId,zoneId,aisle:number,module,x,z:rz,width:8,depth:3.5,levels:3,slots:2,stackerId,railZ:z });
        for (let level=1;level<=3;level++) for (let slot=1;slot<=2;slot++) {
          const code=`CD1-${prefix}-A${pad(number)}-R${pad(module)}-N${pad(level)}-P${pad(slot)}`;
          layout.locations.push({ id:code,code,zoneId,rackId,aisle:number,module,level,slot,depth:1,x:x+(slot===1?-1.9:1.9),y:.8+(level-1)*3.2,z:rz,kind:"RACK",stackerId,handoffId,capacityHus:1 });
        }
      }
    }
  }
  let previous="F-24";
  for (let i=0;i<4;i++) {
    const number=4+i,z=-37-i*12, spine=`FROZEN-REAR-${i+1}`;
    node(spine,38,z); edge(previous,spine,{temperature:"FROZEN"}); previous=spine;
    layout.aisles.push({ id:`FROZEN-A${pad(number)}`,zoneId:"FROZEN",number,z,added:true });
    for (const [slot,x] of [33,43].entries()) {
      const nodeId=`${spine}-${slot+1}`,code=`CD1-CON-A${pad(number)}-R01-N01-P${pad(slot+1)}`;
      node(nodeId,x,z);edge(spine,nodeId,{temperature:"FROZEN"});
      layout.locations.push({ id:code,code,zoneId:"FROZEN",rackId:null,aisle:number,module:1,level:1,slot:slot+1,x,y:.4,z,kind:"FLOOR",nodeId,handoffId:"FROZEN-IN",stackerId:"SHUTTLE-1",capacityHus:1 });
    }
  }
  node("REAR-CROSS-E",-2,-23);edge("CLEAN-IN","REAR-CROSS-E");
  node("REAR-CROSS-M",-46,-23);edge("REAR-CROSS-E","REAR-CROSS-M");
  node("REAR-CROSS-T",-46,-32);edge("REAR-CROSS-M","REAR-CROSS-T");
  node("REAR-CROSS-W",-56,-32);edge("REAR-CROSS-T","REAR-CROSS-W");
  node("Q-CLEANING",-76,-32);edge("REAR-CROSS-W","Q-CLEANING");
  layout.stations.push({id:"Q-CLEANING",name:"Retención segregada de limpieza",type:"QUARANTINE",zoneId:"CLEANING",temperature:"AMBIENT",x:-76,z:-32,capacityHus:4});
  previous="REAR-CROSS-W";
  for (let i=0;i<4;i++) {
    const number=5+i,z=-39-i*12,spine=`CLEAN-REAR-${i+1}`;
    node(spine,-56,z+3);edge(previous,spine);previous=spine;
    layout.aisles.push({ id:`CLEANING-A${pad(number)}`,zoneId:"CLEANING",number,z,added:true });
    let previousApproach=spine;
    for (const [slot,x] of [-62,-69,-76].entries()) {
      const approach=`${spine}-APP-${slot+1}`,nodeId=`${spine}-POS-${slot+1}`,code=`CD1-LIM-A${pad(number)}-R01-N01-P${pad(slot+1)}`;
      node(approach,x,z+3);edge(previousApproach,approach);previousApproach=approach;node(nodeId,x,z-2);edge(approach,nodeId);
      layout.locations.push({id:code,code,zoneId:"CLEANING",rackId:null,aisle:number,module:1,level:1,slot:slot+1,x,y:.4,z:z-2,kind:"FLOOR",nodeId,capacityHus:1});
    }
  }
  for (const zoneId of ["DRY","COLD","FROZEN"]) {
    const zone=layout.zones.find(z=>z.id===zoneId), front=zone.z+zone.depth/2;
    Object.assign(zone,{z:(front-81)/2,depth:front+81});
  }
  // Cleaning uses a physically separated rear wing, not food racking.
  layout.rearCleaning={x:-66.5,z:-55, width:33,depth:54,entryZ:-32};
  layout.rails=rails;
  layout.bounds={...layout.bounds,minZ:-82}; layout.depth=118;
  layout.rearExpansionVersion=VERSION;
  normalizeGraph(layout);
  return true;
}
function migrateWarehouseExpansion(s) {
  const oldEdges=structuredClone(s.layout.edges);
  let changed=extendWarehouse(s.layout);
  if(changed && s.routeLocks){
    for(const edge of oldEdges){
      const owner=s.routeLocks[edge.id];if(!owner)continue;
      const a=s.layout.nodes.find(n=>n.id===edge.from),b=s.layout.nodes.find(n=>n.id===edge.to);
      const on=n=>Math.abs(Math.hypot(n.x-a.x,n.z-a.z)+Math.hypot(n.x-b.x,n.z-b.z)-Math.hypot(b.x-a.x,b.z-a.z))<1e-6;
      const ids=new Set(s.layout.nodes.filter(on).map(n=>n.id));
      for(const id of ids)if(!s.routeLocks[`node:${id}`])s.routeLocks[`node:${id}`]=owner;
      for(const segment of s.layout.edges)if(ids.has(segment.from) && ids.has(segment.to) && !s.routeLocks[segment.id])s.routeLocks[segment.id]=owner;
    }
  }
  for (const rail of s.layout.rails || []) {
    let robot=s.robots.find(r=>r.id===rail.id);
    if (!robot && rail.id.includes("-STACKER-")) {
      const aisle=s.layout.aisles.find(a=>a.stackerId===rail.id);
      robot={id:rail.id,name:`Transelevador ${rail.zoneId === "DRY" ? "seco" : "refrigerado"} · pasillo ${pad(aisle.number)}`,type:"STACKER",zoneId:rail.zoneId,nodeId:aisle.handoffId,x:rail.left,y:.8,z:rail.z,state:"IDLE",battery:null,capacityCases:24,capacityKg:1500,carryingHuId:null,missionId:null,route:[],capabilities:[rail.zoneId === "DRY" ? "DRY_RACK" : "CHILLED_RACK"],model:"Transelevador de pasillo dedicado"};
      s.robots.push(robot);changed=true;
    }
    if(robot && robot.railZ!==rail.z){robot.railZ=rail.z;changed=true;}
  }
  return changed;
}
module.exports={extendWarehouse,migrateWarehouseExpansion};
