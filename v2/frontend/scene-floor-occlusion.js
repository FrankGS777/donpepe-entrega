import * as THREE from 'three';

export function floorOcclusionMatches(layout, metadata) {
  if (!metadata?.racks || !Array.isArray(layout?.racks)) return false;
  if (metadata.rear !== (layout.rearExpansionVersion ? -82 : -33) || metadata.racks.length !== layout.racks.length) return false;
  const baked = new Map(metadata.racks.map(row => [row[0],row]));
  return layout.racks.every(rack => {
    const row=baked.get(rack.id);
    return row && [rack.x,rack.z,rack.width || 7,rack.depth || 3.8].every((value,index)=>Math.abs(value-row[index+1])<.0001);
  });
}

// Surface UV0 still tiles at material scale. UV1 addresses a single world-space
// bake, so each floor patch receives the shadow at its real position.
export function floorOcclusionGeometry(geometry, position, scale, rotation, metadata, cache) {
  const key=`floorAO:${geometry.uuid}:${position.join(',')}:${scale.join(',')}:${rotation.join(',')}:${metadata.rear}`;
  if (cache.has(key)) return cache.get(key);
  const result=geometry.clone(), positions=result.attributes.position;
  const values=new Float32Array(positions.count*2);
  const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));
  const point=new THREE.Vector3();
  for (let i=0;i<positions.count;i++) {
    point.fromBufferAttribute(positions,i).applyMatrix4(matrix);
    values[i*2]=point.x/metadata.width+.5;
    values[i*2+1]=(35-point.z)/metadata.depth;
  }
  result.setAttribute('uv1',new THREE.BufferAttribute(values,2));
  cache.set(key,result); return result;
}
