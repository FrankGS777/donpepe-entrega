// Selection follows visible surfaces. Render-batched vehicle sources retain
// their CPU geometry but are deliberately hidden as individual draw calls.
export function selectionVisible(object, { batchedSource = false } = {}) {
  if (!object || object.material?.visible === false || object.userData?.selectable === false) return false;
  let item = batchedSource ? object.parent : object;
  while (item) { if (item.visible === false) return false; item = item.parent; }
  return true;
}

function contains(record, point) {
  if (!point || !record?.position || !record?.size) return false;
  const center = record.position;
  return ['x', 'y', 'z'].every((axis, index) => Math.abs(point[axis] - (center[axis] ?? center[index])) <= record.size[index] / 2 + .045);
}

export function selectionFromHits(hits, resolve, {preferLoads=false}={}) {
  const entries = hits.map(hit => ({ hit, record: resolve(hit) })).filter(entry => entry.record);
  const first = entries[0];
  if (!first) return null;
  // A rack/slot is a semantic volume with open bays, not an opaque block. A
  // visible carton genuinely inside that volume wins; a distant load does not.
  if (['rack', 'loc', 'zone'].includes(first.record.type)) {
    if(preferLoads){const load=entries.find(entry=>entry.record.type==='hu');if(load)return load.record;}
    const precise = entries.find(entry => ['hu', 'robot', 'truck', 'station', 'asset'].includes(entry.record.type)
      && contains(first.record, entry.hit.point));
    if (precise) return precise.record;
  }
  return first.record;
}

export function insideDepot(layout,point){
  if(!point)return false;
  const rear=layout?.bounds?.minZ ?? -33;
  return (Math.abs(point.x)<51 && point.z>rear-1 && point.z<35)
    || (Boolean(layout?.rearCleaning) && point.x>-84 && point.x<-50 && point.z>-83 && point.z<-28)
    || (Boolean(layout?.automation) && point.x>-84 && point.x<-50 && point.z>2 && point.z<35);
}
