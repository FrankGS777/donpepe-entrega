// Bake only the UV transform into shared geometry variants. Repeated surfaces
// keep one GPU texture per channel instead of uploading a 2K image for every
// floor, wall and roof size. Positions, normals and instance transforms stay exact.
export function tiledGeometry(geometry, material, cache) {
  const repeat = material?.userData?.surfaceRepeat;
  if (!repeat || (repeat[0] === 1 && repeat[1] === 1) || !geometry.attributes.uv) return geometry;
  const key = `uv:${geometry.uuid}:${repeat[0]}:${repeat[1]}`;
  if (!cache.has(key)) {
    const tiled = geometry.clone(), uv = tiled.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * repeat[0], uv.getY(i) * repeat[1]);
    uv.needsUpdate = true;
    cache.set(key, tiled);
  }
  return cache.get(key);
}
