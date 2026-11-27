'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),THREE=require('three');
const bytes=fs.readFileSync(path.join(__dirname,'../public/models/donpepe-industrial-v1.glb'));
const kit=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)));
function bounds(name) {
  const root=kit.nodes.findIndex(node=>node.name===name),box=new THREE.Box3();
  assert(root>=0,`Missing mechanical assembly ${name}`);
  function visit(index,parent) {
    const node=kit.nodes[index],matrix=new THREE.Matrix4();
    if(node.matrix)matrix.fromArray(node.matrix);
    else matrix.compose(new THREE.Vector3(...(node.translation||[0,0,0])),new THREE.Quaternion(...(node.rotation||[0,0,0,1])),new THREE.Vector3(...(node.scale||[1,1,1])));
    matrix.premultiply(parent);
    if(node.mesh!==undefined)for(const primitive of kit.meshes[node.mesh].primitives) {
      const positions=kit.accessors[primitive.attributes.POSITION];
      box.union(new THREE.Box3(new THREE.Vector3(...positions.min),new THREE.Vector3(...positions.max)).applyMatrix4(matrix));
    }
    for(const child of node.children||[])visit(child,matrix);
  }
  visit(root,new THREE.Matrix4());return box;
}
test('industrial GLB retains real texture coordinates and packed material channels',()=>{
  assert(kit.images.length>=5);
  for(const mesh of kit.meshes)for(const p of mesh.primitives){
    const material=kit.materials[p.material];
    if(material.normalTexture || material.pbrMetallicRoughness?.baseColorTexture || material.pbrMetallicRoughness?.metallicRoughnessTexture) {
      assert(p.attributes.TEXCOORD_0!==undefined,`${mesh.name}: textured material has no UV coordinates`);
      assert.equal(kit.accessors[p.attributes.TEXCOORD_0].count,kit.accessors[p.attributes.POSITION].count);
    }
    for(const value of [...kit.accessors[p.attributes.POSITION].min,...kit.accessors[p.attributes.POSITION].max])assert(Number.isFinite(value));
  }
  const wood=kit.materials.find(m=>/Madera/.test(m.name));
  assert(wood.pbrMetallicRoughness.baseColorTexture);
  assert(wood.normalTexture);
  for(const m of kit.materials.filter(m=>/Seguridad ocre|Esmalte/.test(m.name))) {
    assert.equal(m.pbrMetallicRoughness.metallicFactor,0,'paint is a dielectric coating');
    assert(m.normalTexture);assert(m.pbrMetallicRoughness.metallicRoughnessTexture);
  }
});
test('detailed under-pallet robot and pallet still fit the existing physical handoff',()=>{
  const amr=bounds('AMR');
  assert(amr.min.y>=-.001);assert(amr.max.y<=.18,'robot must fit under buffer support height');
  assert(amr.max.x<=.49&&amr.min.x>=-.49);assert(amr.max.z<=.63&&amr.min.z>=-.63);
  const pallet=bounds('PalletWood');
  assert(pallet.max.y<=.182);assert(pallet.min.y>=0);
  assert(pallet.max.x<=.581&&pallet.min.x>=-.581);
  assert(pallet.max.z<=.471&&pallet.min.z>=-.471);
});
test('machinery replacement retains fork reach and fixed mast travel',()=>{
  const fork=bounds('ForkCarriage');assert(Math.abs(fork.max.z-1.77)<.003);assert(fork.min.y>=-.101&&fork.min.y<=-.09);
  const mast=bounds('Stacker');assert(mast.max.y<=9.01&&mast.max.y>=8.9);
  const upright=bounds('RackUpright');assert(Math.abs(upright.max.y-1)<.0001);assert(Math.abs(upright.min.y)<.0001);
});
