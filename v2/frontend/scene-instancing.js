import { InstancedMesh } from 'three';

// Three r180 uses uniform matrices for allocations of up to 1000 instances.
// A WebGL 2 adapter may expose only a 16 KiB uniform block (256 mat4s).
// Allocating the attribute path avoids exceeding that limit, while mesh.count
// remains the genuine number of pieces. Extra capacity is never drawn/picked.
export function createInstances(geometry, material, count, backend) {
  const visibleCount = Math.max(0, Math.floor(count));
  const capacity = backend === 'webgl2' && visibleCount > 240
    ? Math.max(1001, visibleCount) : Math.max(1, visibleCount);
  const mesh = new InstancedMesh(geometry, material, capacity);
  mesh.count = visibleCount;
  return mesh;
}
