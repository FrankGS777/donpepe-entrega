"use strict";
const { box } = require("./physical-contact");

// Collision geometry follows structural dimensions, never selection hit boxes.
// Doors are gaps in the wall segments, not invisible walls over the apertures.
function physicalLayout(layout = {}) {
  const rear=layout.rearExpansionVersion ? -82 : -33, center=(rear+35)/2, depth=35-rear;
  const solids = [], surfaces = [{ id: "FOUNDATION", x: -12, z: (rear-10+127)/2, y: -.07, width: 238, depth: 127-(rear-10), foundation: true },
    { id: "WAREHOUSE-FLOOR", x: 0, z: center, y: .03, width: 104, depth: depth+2, foundation: true },
    { id: "PARKING-APRON", x: 20, z: 74, y: .06, width: 84, depth: 32, foundation: true }];
  for (const zone of layout.zones || []) surfaces.push({ id: `EPOXY:${zone.id}`, x: zone.x, z: zone.z, y: .0675, width: zone.width - .5, depth: zone.depth - .5, foundation: true });
  const road = (id, ax, az, bx, bz, width) => surfaces.push({ id, x: (ax + bx) / 2, z: (az + bz) / 2, y: .085, width: Math.abs(bx - ax) || width, depth: Math.abs(bz - az) || width, foundation: true });
  road("YARD-ROAD", -110, 60, 90, 60, 8);
  road("SUPPLIER-ROAD", -104, 18, -104, 60, 7);
  for (const branch of layout.branches || []) {
    const bayZ = branch.receivingPoint?.z ?? branch.z + 12, approachX = branch.x - 24;
    if (bayZ !== 60) road(`BRANCH-APPROACH:${branch.id}`, approachX, 60, approachX, bayZ, 6.5);
    road(`BRANCH-ROAD:${branch.id}`, approachX, bayZ, branch.x, bayZ, 6.5);
  }
  const solid = (id, x, z, width, depth, height, y = 0, extra = {}) => solids.push(box({ x, y, z, heading: 0 }, { width, depth, height }, { id, kind: "STRUCTURE", ...extra }));
  const horizontal = (id, z, from, to, openings = [], height = 11.4) => {
    let cursor = from;
    for (const opening of openings.sort((a, b) => a.x - b.x)) {
      const left = opening.x - opening.width / 2, right = opening.x + opening.width / 2;
      if (left > cursor) solid(`${id}-${cursor}`, (cursor + left) / 2, z, left - cursor, .4, height);
      cursor = right;
    }
    if (to > cursor) solid(`${id}-${cursor}`, (cursor + to) / 2, z, to - cursor, .4, height);
  };
  const vertical = (id, x, from, to, openings = [], height = 11.4) => {
    let cursor = from;
    for (const opening of openings.sort((a, b) => a.z - b.z)) {
      const left = opening.z - opening.width / 2, right = opening.z + opening.width / 2;
      if (left > cursor) solid(`${id}-${cursor}`, x, (cursor + left) / 2, .4, left - cursor, height);
      cursor = right;
    }
    if (to > cursor) solid(`${id}-${cursor}`, x, (cursor + to) / 2, .4, to - cursor, height);
  };
  horizontal("WAREHOUSE-NORTH", rear, -50.7, 50.7);
  horizontal("WAREHOUSE-SOUTH", 35, -50.7, 50.7, (layout.loadingDocks || []).map(dock => ({ x: dock.portal?.x ?? dock.x, width: dock.portal?.width || 4.4 })));
  vertical("WAREHOUSE-EAST", 50.7, rear, 35);
  vertical("WAREHOUSE-WEST", -50.7, rear, 35, [...(layout.automation ? [{ z: 17, width: 5 }] : []),...(layout.rearCleaning ? [{z:-32,width:6}] : [])]);
  if(layout.rearCleaning){
    surfaces.push({id:"REAR-CLEANING-FLOOR",x:-66.5,z:-55,y:.0675,width:33,depth:54,foundation:true});
    horizontal("REAR-CLEANING-NORTH",rear,-83,-50.7);horizontal("REAR-CLEANING-SOUTH",-28,-83,-50.7);
    vertical("REAR-CLEANING-WEST",-83,rear,-28);
  }
  if (layout.automation) {
    surfaces.push({ id: "ANNEX-FLOOR", x: -66.5, z: 18, y: .03, width: 33, depth: 32, foundation: true }, { id: "ANNEX-EPOXY", x: -66.5, z: 17, y: .0675, width: 31.5, depth: 9, foundation: true });
    // The conveyor and mounted cabinets are solid; portal apertures remain
    // open for their own supported loads. AMRs cannot drive across the line.
    for(const z of [15.9,18.1]) solid(`INBOUND-ROLLER-RAIL:${z}`,-59.5,z,31,.12,.68,.05);
    for(const [x,z] of [[-73,14.5],[-62.5,14.8],[-52,14.5],[-43,14.5]]) solid(`INBOUND-CABINET:${x}`,x,z,.9,.65,1.3);
    for(const x of [-64,-56,-52]) for(const z of [15.35,18.65]) solid(`INSPECTION-POST:${x}:${z}`,x,z,.2,.2,3.9);
    horizontal("ANNEX-NORTH", 2, -83, -50.7, [], 11.6); horizontal("ANNEX-SOUTH", 34, -83, -50.7, [], 11.6);
    vertical("ANNEX-WEST", -83, 2, 34, [{ z: 17, width: 5 }], 11.6);
  }
  for (const room of [{ id: "COLD", x: 14, width: 25.5 }, { id: "FROZEN", x: 38, width: 20.5 }]) {
    const left = room.x - room.width / 2, right = room.x + room.width / 2;
    const openings=room.id === "COLD" ? [{ z:-16,width:4 },...(layout.rails || []).filter(r=>r.zoneId==="COLD" && r.id!=="STACKER-2").map(r=>({z:r.z,width:4}))] : [];
    vertical(`${room.id}-WEST`, left, layout.rearExpansionVersion ? rear+1 : -30, -4, openings, 7.8);
    vertical(`${room.id}-EAST`, right, layout.rearExpansionVersion ? rear+1 : -30, -4, [], 7.8);
    horizontal(`${room.id}-FRONT`, -4, left, right, [{ x: room.x, width: 8 }], 7);
  }
  for (const rack of layout.racks || []) solid(`RACK:${rack.id}`, rack.x, rack.z, rack.width || 8, rack.depth || 3.5, 9.1, 0, { kind: "RACK", railOwnerId: rack.stackerId });
  for (const loc of layout.locations || []) surfaces.push({ id: `SUPPORT:${loc.id}`, ownerId: loc.id, x: loc.x, z: loc.z, y: loc.kind === "RACK" ? (loc.y || 0) + .0475 : 1.03, width: loc.kind === "RACK" ? 1.9 : 1.8, depth: loc.kind === "RACK" ? 3.2 : 1.8 });
  solid("OFFICE", -64, layout.automation ? -18 : 14, 18, 20, 4.8);
  for (const branch of layout.branches || []) {
    const x = branch.x, z = branch.z + 19;
    solid(`STORE:${branch.id}`, x, z, 14, 9, 5.1);
    solid(`PLANTER:${branch.id}`, x + 11, z + 2, 2.5, 2.5, .15);
    solid(`TREE:${branch.id}`, x + 11, z + 2, .28, .28, 3.6);
  }
  for (const [x, z] of [[-45, 55], [18, 83], [57, 83]]) {
    solid(`PLANTER:${x}:${z}`, x, z, 2.5, 2.5, .15); solid(`TREE:${x}:${z}`, x, z, .28, .28, 3.6);
  }
  return { solids, surfaces };
}

module.exports = { physicalLayout };
