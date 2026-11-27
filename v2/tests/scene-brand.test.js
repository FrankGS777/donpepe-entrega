'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),THREE=require('three');
test('architectural mark has real depth, finite surfaces and open letter counters',async()=>{
  const {dimensionalBrandGeometry}=await import('../frontend/scene-brand.js');
  const {default:contours}=await import('../frontend/brand-contours.js');
  const geometry=dimensionalBrandGeometry(),box=geometry.boundingBox;
  assert(box.max.z-box.min.z>.004);
  assert(box.max.x-box.min.x>.9&&box.max.x-box.min.x<1.01);
  assert(box.max.y-box.min.y>.30&&box.max.y-box.min.y<.40);
  assert([...geometry.attributes.position.array].every(Number.isFinite));
  const area=p=>p.reduce((s,v,i)=>s+p[(i+p.length-1)%p.length][0]*v[1]-v[0]*p[(i+p.length-1)%p.length][1],0)/2;
  const hole=contours.filter(p=>area(p)>0&&p.every(v=>v[0]>-.13)).sort((a,b)=>area(b)-area(a))[0];
  const center=hole.reduce((sum,p)=>sum.add(new THREE.Vector2(...p)),new THREE.Vector2()).divideScalar(hole.length);
  const material=new THREE.MeshStandardMaterial({side:THREE.DoubleSide}),mesh=new THREE.Mesh(geometry,material);
  mesh.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(new THREE.Vector3(center.x,center.y,1),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(mesh).length,0,'The letter opening must not be filled by a billboard');
  material.dispose();geometry.dispose();
});
