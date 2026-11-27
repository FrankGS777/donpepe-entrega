"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const source = fs.readFileSync(path.join(__dirname, "../frontend/scene-materials.js"), "utf8")
  .replace("'three'", JSON.stringify(pathToFileURL(path.join(__dirname, "../../node_modules/three/build/three.module.js")).href));
const library = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const renderer = { capabilities: { getMaxAnisotropy: () => 16 } };

test("industrial surfaces separate colour maps from linear physical data and retain authored finishes", async () => {
  const { default: Materials } = await library;
  const materials = new Materials(renderer, { resolveColor: () => 0x123456 });
  const painted = materials.material(0x999999, { texture: "epoxy" });
  assert.equal(painted.type, "MeshPhysicalMaterial");
  assert.equal(painted.color.getHex(), 0x123456);
  assert.equal(painted.userData.baseColor, 0x999999);
  assert.equal(painted.map.colorSpace, "srgb");
  assert.equal(painted.normalMap.colorSpace, "");
  assert.equal(painted.roughnessMap.colorSpace, "");
  assert.equal(painted.roughness, .46, "the material scalar owns the authored finish");
  assert.equal(painted.userData.style, "industrial-pbr");
  const roughness = painted.roughnessMap.image.data;
  for (let i = 0; i < roughness.length; i += 4 * 83)
    assert.ok(roughness[i] >= 240, "the detail map must not multiply the intended roughness twice");
  assert.ok(painted.map.anisotropy <= 16);
  assert.notEqual(materials.material(0x999999, { texture: "epoxy", roughness: .7 }), painted);
  materials.dispose();
});

test("different floor sizes share image storage without changing each other's UV scale", async () => {
  const { default: Materials } = await library;
  const materials = new Materials(renderer);
  const base = materials.maps("concrete"), large = materials.maps("concrete", [26, 18]);
  const small = materials.maps("concrete", [3, 2]);
  for (const channel of ["map", "normalMap", "roughnessMap"]) {
    assert.equal(large[channel].source, base[channel].source);
    assert.equal(small[channel].source, base[channel].source);
    assert.deepEqual(base[channel].repeat.toArray(), [1, 1]);
    assert.deepEqual(large[channel].repeat.toArray(), [26, 18]);
    assert.deepEqual(small[channel].repeat.toArray(), [3, 2]);
  }
  assert.equal(materials.maps("concrete", [26, 18]), large);
  assert.equal(materials.diagnostics().variants, 2);
  materials.dispose();
});

test("all physical material buffers remain bounded and their normals stay normalized", async () => {
  const { default: Materials } = await library;
  const materials = new Materials(renderer);
  for (const kind of ["concrete", "concrete-jointed", "epoxy", "carton", "wood", "metal", "roof", "wall", "asphalt", "rubber", "tape"]) {
    const maps = materials.maps(kind), bytes = maps.normalMap.image.data;
    assert.ok(maps.size <= 1024);
    let varying = false;
    for (let i = 0; i < bytes.length; i += 4 * 83) {
      const x = bytes[i] / 255 * 2 - 1, y = bytes[i + 1] / 255 * 2 - 1, z = bytes[i + 2] / 255 * 2 - 1;
      assert.ok(Math.abs(Math.hypot(x, y, z) - 1) < .015);
      assert.ok(z > .65, "surface relief must not resemble distorted geometry");
      varying ||= Math.abs(x) > .006 || Math.abs(y) > .006;
    }
    assert.ok(varying, `${kind} needs actual physical surface detail`);
  }
  assert.ok(materials.diagnostics().pixelBufferBytes <= 50 * 1024 * 1024);
  materials.dispose();
});

test("clean albedos and rounded surface relief remain smooth across texture seams", async () => {
  const { default: Materials } = await library;
  const materials = new Materials(renderer);
  for (const kind of ["concrete", "concrete-jointed", "epoxy", "carton", "wood", "metal", "roof", "wall", "asphalt", "rubber", "tape"]) {
    const maps = materials.maps(kind), { size } = maps;
    const colour = maps.map.image.data, normals = maps.normalMap.image.data;
    let darkest = 255, brightest = 0, colourStep = 0, normalStep = 0;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = (y * size + x) * 4;
      darkest = Math.min(darkest, colour[p]); brightest = Math.max(brightest, colour[p]);
      assert.equal(colour[p], colour[p + 1], `${kind} must preserve the paint hue`);
      assert.equal(colour[p], colour[p + 2], `${kind} must preserve the paint hue`);
      for (const q of [(y * size + ((x + 1) % size)) * 4, (((y + 1) % size) * size + x) * 4]) {
        colourStep = Math.max(colourStep, Math.abs(colour[p] - colour[q]));
        normalStep = Math.max(normalStep, Math.abs(normals[p] - normals[q]), Math.abs(normals[p + 1] - normals[q + 1]));
      }
    }
    assert.ok(brightest - darkest <= 25, `${kind}: surface albedo remains controlled`);
    assert.ok(colourStep <= 6, `${kind}: no granular pixels or hard tile seams (${colourStep})`);
    assert.ok(normalStep <= 32, `${kind}: broad normals must not introduce sharp reflection jumps (${normalStep})`);
    assert.equal(maps.map.generateMipmaps, true);
    assert.equal(maps.normalMap.generateMipmaps, true);
    assert.equal(maps.roughnessMap.generateMipmaps, true);
  }
  materials.dispose();
});

test("material reuse and disposal leave no allocations outside the renderer registries", async () => {
  const { default: Materials } = await library;
  const cache = new Map(), textures = new Set();
  const materials = new Materials(renderer, { materialCache: cache, textureRegistry: textures });
  const first = materials.material(0xb78848, { texture: "wood", repeat: [2, 1] });
  for (let i = 0; i < 100; i++) assert.equal(materials.material(0xb78848, { texture: "wood", repeat: [2, 1] }), first);
  assert.equal(cache.size, 1);
  assert.equal(textures.size, 3, "tiled materials reuse all three source textures");
  materials.dispose();
  assert.equal(cache.size, 0);
  assert.equal(textures.size, 0);
  assert.equal(materials.diagnostics().pixelBufferBytes, 0);
});


test("photographic resources use colour, linear normals and roughness; tiling shares source data", async()=>{
  const {default:Materials}=await library;
  const materials=new Materials(renderer);
  const THREE=await import('three');
  const urls=[];
  await materials.loadPhotographic({loadAsync:async url=>{urls.push(url);return new THREE.Texture({width:2048,height:2048});}});
  assert.equal(urls.length,11);
  assert(urls.every(url=>url.startsWith('/textures/industrial/')));
  for(const kind of ['concrete','wood','metal','asphalt']) {
    const base=materials.maps(kind),tiled=materials.maps(kind,[3,7]);
    assert.equal(base.size,2048);assert.equal(base.photographic,true);
    assert.equal(base.map.colorSpace,'srgb');
    assert.equal(base.normalMap.colorSpace,'');
    assert.equal(base.roughnessMap.colorSpace,'');
    assert.equal(tiled.normalMap.source,base.normalMap.source);
  }
  assert.deepEqual(materials.diagnostics().missingAssets,[]);
  materials.dispose();
});

test("bundled CC0 surface files are complete, native assets with recorded provenance",()=>{
  const crypto=require('node:crypto'),root=path.join(__dirname,'../public/textures/industrial');
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.equal(manifest.assets.length,15);
  for(const asset of manifest.assets) {
    const bytes=fs.readFileSync(path.join(root,asset.file));
    assert.equal(bytes.length,asset.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),asset.sha256);
    assert.equal(asset.license,'CC0-1.0');assert(asset.assetPage.startsWith('https://polyhaven.com/a/'));
  }
});


test('WebP delivery assets retain provenance and reduce the total transfer size',()=>{
  const root=path.join(__dirname,'../public/textures/industrial'),crypto=require('node:crypto');
  const original=JSON.parse(fs.readFileSync(path.join(root,'manifest.json')));
  const delivery=JSON.parse(fs.readFileSync(path.join(root,'delivery-manifest.json')));
  assert.equal(delivery.assets.length,12);
  for(const entry of delivery.assets){
    const bytes=fs.readFileSync(path.join(root,entry.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),entry.sha256);
    assert(original.assets.some(source=>source.file===entry.sourceFile));
  }
  const before=original.assets.filter(a=>a.file.endsWith('.jpg')).reduce((s,a)=>s+a.bytes,0);
  const after=delivery.assets.reduce((s,a)=>s+a.bytes,0);
  assert(after<before*.6);
});

test('tiled PBR materials share the exact texture objects on the GPU without changing their finish', async () => {
  const { default: Materials } = await library;
  const materials = new Materials(renderer);
  const a = materials.material(0xb5b2a5, {texture:'concrete', repeat:[26,29.25], roughness:.92});
  const b = materials.material(0xb5b2a5, {texture:'concrete', repeat:[8,8], roughness:.92});
  for (const channel of ['map','normalMap','roughnessMap']) {
    assert.equal(a[channel], b[channel], 'GPU upload must be shared, not only the decoded Source');
    assert.deepEqual(a[channel].repeat.toArray(), [1,1]);
  }
  assert.deepEqual(a.userData.surfaceRepeat,[26,29.25]);
  assert.deepEqual(b.userData.surfaceRepeat,[8,8]);
  assert.equal(a.roughness,b.roughness);
  assert.equal(materials.diagnostics().variants,0);
  materials.dispose();
});
