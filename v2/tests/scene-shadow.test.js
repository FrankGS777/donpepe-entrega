'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),THREE=require('three');
test('sun depth projection covers the actual warehouse instead of the default ten-metre box',async()=>{
  const {configureIndustrialSun}=await import('../frontend/scene-lighting.js');
  const sun=new THREE.DirectionalLight();sun.position.set(-65,95,32);configureIndustrialSun(sun);
  sun.updateMatrixWorld(true);sun.target.updateMatrixWorld(true);sun.shadow.updateMatrices(sun);
  for(const point of [[-45,0,25],[45,0,-75],[0,5,-15],[28,0,33]]){
    const projected=new THREE.Vector3(...point).project(sun.shadow.camera);
    assert(Math.abs(projected.x)<1&&Math.abs(projected.y)<1&&Math.abs(projected.z)<1,`Missing shadow coverage at ${point}`);
  }
  assert.equal(sun.shadow.camera.projectionMatrix.elements[0],.01);
  assert.equal(sun.shadow.mapSize.x,4096);sun.dispose();
});
