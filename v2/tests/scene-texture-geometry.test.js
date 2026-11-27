'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const THREE = require('three');

test('surface tiling preserves every position and normal and applies the exact UV scale', async () => {
  const { tiledGeometry } = await import('../frontend/scene-texture-geometry.js');
  const cache = new Map(), base = new THREE.BoxGeometry();
  const material = new THREE.MeshPhysicalMaterial(); material.userData.surfaceRepeat = [26, 29.25];
  const tiled = tiledGeometry(base, material, cache);
  assert.notEqual(tiled, base);
  for (const name of ['position', 'normal']) assert.deepEqual(tiled.attributes[name].array, base.attributes[name].array);
  assert.deepEqual(tiled.index.array, base.index.array);
  for (let i=0; i<base.attributes.uv.count; i++) {
    assert.equal(tiled.attributes.uv.getX(i), base.attributes.uv.getX(i)*26);
    assert.equal(tiled.attributes.uv.getY(i), base.attributes.uv.getY(i)*29.25);
  }
  assert.equal(tiledGeometry(base, material, cache), tiled);
  material.userData.surfaceRepeat = [3, 2];
  assert.notEqual(tiledGeometry(base, material, cache), tiled);
  assert.equal(base.attributes.uv.getX(0), 0);
  material.userData.surfaceRepeat = [1, 1]; assert.equal(tiledGeometry(base, material, cache), base);
  for (const g of cache.values()) g.dispose(); base.dispose(); material.dispose();
});
