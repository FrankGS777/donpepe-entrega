'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),THREE=require('three');
const moduleReady=import('../frontend/scene-floor-occlusion.js');
test('baked floor shadows are rejected when a rack moves or the building changes',async()=>{
  const {floorOcclusionMatches}=await moduleReady;
  const layout={rearExpansionVersion:1,racks:[{id:'R1',x:10,z:-20,width:7,depth:3.8}]};
  const metadata={rear:-82,width:104,depth:117,racks:[['R1',10,-20,7,3.8]]};
  assert(floorOcclusionMatches(layout,metadata));
  assert(!floorOcclusionMatches({...layout,racks:[{...layout.racks[0],x:11}]},metadata));
  assert(!floorOcclusionMatches({...layout,rearExpansionVersion:0},metadata));
  assert(!floorOcclusionMatches({...layout,racks:[]},metadata));
});
test('floor patches address the same world-space shadow without changing tiled surface UVs',async()=>{
  const {floorOcclusionGeometry}=await moduleReady,geometry=new THREE.BoxGeometry(),cache=new Map();
  const metadata={rear:-82,width:104,depth:117};
  const before=Array.from(geometry.attributes.uv.array);
  for(const [position,scale,rotation] of [[[0,0,-23.5],[104,.3,117],[0,0,0]],[[14,.055,-42],[24,.025,75],[0,0,0]],[[0,.05,0],[7,.025,4],[0,Math.PI/2,0]]]) {
    const result=floorOcclusionGeometry(geometry,position,scale,rotation,metadata,cache);
    assert.deepEqual(Array.from(result.attributes.uv.array),before);
    const matrix=new THREE.Matrix4().compose(new THREE.Vector3(...position),new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation)),new THREE.Vector3(...scale));
    for(let i=0;i<geometry.attributes.position.count;i++){
      const point=new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(matrix);
      assert(Math.abs(result.attributes.uv1.getX(i)-(point.x/104+.5))<1e-7);
      assert(Math.abs(result.attributes.uv1.getY(i)-(35-point.z)/117)<1e-7);
    }
    assert.equal(result,floorOcclusionGeometry(geometry,position,scale,rotation,metadata,cache));
  }
  assert(!geometry.attributes.uv1);
  for(const item of cache.values())item.dispose();geometry.dispose();
});
