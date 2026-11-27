'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const THREE=require('three');
const policy=import('../frontend/scene-instancing.js');
test('WebGL2 batches cannot create a matrix uniform block beyond the minimum adapter limit',async()=>{
  const {createInstances}=await policy;
  const geometry=new THREE.BoxGeometry(1,1,1),material=new THREE.MeshStandardMaterial();
  for(const count of [1,240,241,256,257,800,1001,5000]){
    const mesh=createInstances(geometry,material,count,'webgl2');
    const allocated=mesh.instanceMatrix.count;
    assert.equal(mesh.count,count);
    assert(allocated<=240 || allocated>1000);
    assert(allocated<=Math.max(count,1001));
    const matrix=new THREE.Matrix4().makeTranslation(1,2,3);
    mesh.setMatrixAt(count-1,matrix);
    const actual=new THREE.Matrix4();mesh.getMatrixAt(count-1,actual);
    assert.deepEqual(actual.elements,matrix.elements);
    mesh.dispose();
  }
  geometry.dispose();material.dispose();
});
test('WebGPU keeps exact batch allocations and empty batches never draw spare capacity',async()=>{
  const {createInstances}=await policy;
  const geometry=new THREE.BoxGeometry(),material=new THREE.MeshStandardMaterial();
  for(const count of [0,241,1000,5000]){
    const mesh=createInstances(geometry,material,count,'webgpu');
    assert.equal(mesh.count,count);assert.equal(mesh.instanceMatrix.count,Math.max(1,count));mesh.dispose();
  }
  geometry.dispose();material.dispose();
});
