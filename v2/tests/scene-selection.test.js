"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), THREE = require("three");
const library = import("../frontend/scene-selection.js");

test("batched model picking respects articulated parent visibility without redrawing sources", async () => {
  const { selectionVisible } = await library;
  const truck = new THREE.Group(), roof = new THREE.Group(), source = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  truck.add(roof); roof.add(source); source.visible = false;
  assert.equal(selectionVisible(source), false);
  assert.equal(selectionVisible(source, { batchedSource:true }), true);
  roof.visible = false; assert.equal(selectionVisible(source, { batchedSource:true }), false);
  roof.visible = true; truck.visible = false; assert.equal(selectionVisible(source, { batchedSource:true }), false);
  source.geometry.dispose(); source.material.dispose();
});

test("pointer rays hit real separated cab and trailer, not the empty surrounding envelope", async () => {
  const { selectionVisible, selectionFromHits } = await library;
  const group = new THREE.Group(), record = { type:"truck", id:"TRUCK", position:new THREE.Vector3(), size:[3.2,4.3,18.7] };
  const part = (z, depth) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2.8, 3, depth)); mesh.position.set(0,2,z);
    mesh.userData.entity = record; mesh.visible = false; group.add(mesh); return mesh;
  };
  const trailer = part(-2, 6), cab = part(5, 2); group.updateMatrixWorld(true);
  const sources = [trailer,cab].filter(mesh => selectionVisible(mesh, {batchedSource:true}));
  const pick = z => {
    const ray = new THREE.Raycaster(new THREE.Vector3(8,2,z), new THREE.Vector3(-1,0,0));
    return selectionFromHits(ray.intersectObjects(sources,false), hit => hit.object.userData.entity);
  };
  assert.equal(pick(-2),record); assert.equal(pick(5),record); assert.equal(pick(2),null);
  for (const mesh of sources) {mesh.geometry.dispose(); mesh.material.dispose();}
});

test("pallet contact shadows and hidden surfaces are never selectable cargo", async () => {
  const { selectionVisible } = await library;
  const shadow = { visible:true, material:{visible:true}, userData:{selectable:false},parent:null };
  assert.equal(selectionVisible(shadow),false);
  const carton = {...shadow,userData:{selectable:true}};
  assert.equal(selectionVisible(carton),true);
  carton.material = {visible:false}; assert.equal(selectionVisible(carton),false);
});

test("a rack bay resolves its own visible load, never an unrelated pallet behind the rack", async () => {
  const { selectionFromHits } = await library;
  const rack = {type:"rack",id:"RACK",position:{x:0,y:4,z:0},size:[8,8,3.5]};
  const own = {type:"hu",id:"HU-OWN"}, remote = {type:"hu",id:"HU-REMOTE"};
  const make = (record,point) => ({point,object:{userData:{entity:record}}});
  const hitRack = make(rack,{x:0,y:2,z:1.75});
  assert.equal(selectionFromHits([hitRack,make(own,{x:1,y:2,z:1})],h=>h.object.userData.entity),own);
  assert.equal(selectionFromHits([hitRack,make(remote,{x:0,y:2,z:-6})],h=>h.object.userData.entity),rack);
  assert.equal(selectionFromHits([hitRack,make(remote,{x:0,y:2,z:-6})],h=>h.object.userData.entity,{preferLoads:true}),remote);
  assert.equal(selectionFromHits([],h=>h.object.userData.entity),null);
});
