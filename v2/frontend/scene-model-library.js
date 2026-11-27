import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const origin = new THREE.Vector3();
const scale = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const axis = new THREE.Vector3(0, 1, 0);
const instanceMatrix = new THREE.Matrix4();

export default class WarehouseModels {
  constructor(gltf, lightAtlas, floorOcclusion, floorOcclusionLayout) {
    this.parts = new Map();
    this.batches = new Map();
    this.lightAtlas = lightAtlas;
    this.floorOcclusion = floorOcclusion || null;
    this.floorOcclusionLayout = floorOcclusionLayout || null;
    if (this.floorOcclusion) {
      this.floorOcclusion.channel = 1;
      this.floorOcclusion.colorSpace = THREE.NoColorSpace;
      this.floorOcclusion.anisotropy = 8;
    }
    gltf.scene.updateMatrixWorld(true);
    for (const template of gltf.scene.children) {
      const meshes = [];
      const inverse = new THREE.Matrix4().copy(template.matrixWorld).invert();
      template.traverse((mesh) => {
        if (!mesh.isMesh) return;
        const upright=template.name==='RackUpright';
        const beam=['RackBeam','RackConnector'].includes(template.name) && /bermellón/.test(mesh.material.name);
        if(template.name==='Clerestory' && /Iluminación detrás/.test(mesh.material.name)) {
          mesh.material=mesh.material.clone();
          mesh.material.color.setHex(0xb1c9d9);
          mesh.material.emissive.setHex(0x8eacc4);
          mesh.material.emissiveIntensity=.45;
          mesh.material.metalness=.05;
          mesh.material.roughness=.22;
        }
        if (upright || beam) {
          mesh.material=mesh.material.clone();
          mesh.material.vertexColors=false;
          mesh.material.color.setHex(upright ? 0x194b7b : 0xc99b32);
          mesh.material.metalness=.04;
          mesh.material.roughness=.43;
        }
        mesh.userData.blender = true;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) {
            if (texture) texture.anisotropy = 8;
          }
        }
        mesh.castShadow = mesh.receiveShadow = true;
        const matrix = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        meshes.push({ mesh, matrix });
      });
      if (meshes.length) this.parts.set(template.name, { template, meshes });
    }
    lightAtlas.colorSpace = THREE.SRGBColorSpace;
    lightAtlas.anisotropy = 4;
  }

  static async load() {
    const loader = new GLTFLoader();
    const results = await Promise.allSettled([
      loader.loadAsync('/models/donpepe-industrial-v1.glb?v=7f8c173a1221'),
      new THREE.TextureLoader().loadAsync('/textures/industrial/dock-spill.png'),
      new THREE.TextureLoader().loadAsync('/textures/industrial/floor-occlusion.png?v=20261122'),
      fetch('/textures/industrial/floor-occlusion-layout.json?v=20261122').then(response=>response.ok?response.json():null),
    ]);
    if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
      return new WarehouseModels(results[0].value, results[1].value, results[2].value, results[3].value);
    }
    results[0].value?.scene.traverse((mesh) => {
      if (mesh.isMesh) { mesh.geometry.dispose(); mesh.material.dispose(); }
    });
    results[1].value?.dispose();
    results[2].value?.dispose();
    console.warn('DonPepe: recursos de Blender no disponibles. Se usará el mapa integrado.');
    return null;
  }

  attach(parent, name, position = [0, 0, 0], dimensions = [1, 1, 1], angle = 0) {
    const part = this.parts.get(name);
    if (!part) return false;
    const object = new THREE.Group();
    object.position.set(...position);
    object.scale.set(...dimensions);
    object.rotation.y = angle;
    // Preserve Blender's relative transforms even after a mesh optimizer
    // encodes dequantization as a mesh-node transform.
    for (const { mesh, matrix } of part.meshes) {
      const clone = mesh.clone(false);
      clone.matrix.copy(matrix);
      clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
      object.add(clone);
    }
    parent.add(object);
    return true;
  }

  place(parent, name, position, dimensions = [1, 1, 1], angle = 0, shadows = true) {
    if (!this.parts.has(name)) return false;
    let groups = this.batches.get(parent);
    if (!groups) this.batches.set(parent, groups = new Map());
    const key = `${name}:${shadows}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = { name, shadows, transforms: [] });
    origin.set(...position);
    scale.set(...dimensions);
    quaternion.setFromAxisAngle(axis, angle);
    group.transforms.push(new THREE.Matrix4().compose(origin, quaternion, scale));
    return true;
  }

  finish(parent, scene) {
    const groups = this.batches.get(parent);
    if (!groups) return;
    for (const { name, shadows, transforms } of groups.values()) {
      for (const { mesh, matrix } of this.parts.get(name).meshes) {
        const batch = scene._instances(mesh.geometry, mesh.material, transforms.length);
        batch.userData.blender = true;
        batch.castShadow = shadows;
        batch.receiveShadow = true;
        transforms.forEach((transform, index) => batch.setMatrixAt(index, instanceMatrix.multiplyMatrices(transform, matrix)));
        batch.computeBoundingSphere();
        parent.add(batch);
      }
    }
    this.batches.delete(parent);
  }

  dispose() {
    const geometries = new Set(), materials = new Set(), textures = new Set();
    for (const { meshes } of this.parts.values()) {
      for (const { mesh } of meshes) {
        geometries.add(mesh.geometry);
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
        }
      }
    }
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    textures.forEach(texture => texture.dispose());
    this.lightAtlas.dispose();
    this.floorOcclusion?.dispose();
    this.batches.clear();
    this.parts.clear();
  }
}
