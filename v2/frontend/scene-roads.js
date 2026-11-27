// A single non-overlapping road surface removes coplanar asphalt at junctions.
// The layout is rectilinear; no visual tessellation changes vehicle routes.
export function roadRectangle(segment, extraWidth = 0) {
  const { ax, az, bx, bz } = segment, half = (segment.width + extraWidth) / 2;
  return Math.abs(bx - ax) >= Math.abs(bz - az)
    ? { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: az - half, maxZ: az + half }
    : { minX: ax - half, maxX: ax + half, minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
}

export function unionRoadRectangles(rectangles) {
  const xs = [...new Set(rectangles.flatMap(r => [r.minX, r.maxX]))].sort((a, b) => a - b);
  const zs = [...new Set(rectangles.flatMap(r => [r.minZ, r.maxZ]))].sort((a, b) => a - b);
  const rows = [];
  for (let zi = 1; zi < zs.length; zi++) {
    let current;
    for (let xi = 1; xi < xs.length; xi++) {
      const x = (xs[xi - 1] + xs[xi]) / 2, z = (zs[zi - 1] + zs[zi]) / 2;
      const covered = rectangles.some(r => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
      if (covered) {
        if (current && current.maxX === xs[xi - 1]) current.maxX = xs[xi];
        else { current = { minX: xs[xi - 1], maxX: xs[xi], minZ: zs[zi - 1], maxZ: zs[zi] }; rows.push(current); }
      } else current = null;
    }
  }
  const result = [];
  for (const row of rows) {
    const previous = result.find(r => r.minX === row.minX && r.maxX === row.maxX && r.maxZ === row.minZ);
    if (previous) previous.maxZ = row.maxZ;
    else result.push({ ...row });
  }
  return result;
}

// Clip edge/centre paint at a perpendicular junction instead of painting an
// impossible kerb across the route. Coordinates are authored in world metres.
export function clearRoadMarkings(mark, otherRoads) {
  let parts = [mark];
  for (const road of otherRoads) {
    const next = [];
    for (const p of parts) {
      const left = Math.max(p.minX, road.minX), right = Math.min(p.maxX, road.maxX);
      const top = Math.max(p.minZ, road.minZ), bottom = Math.min(p.maxZ, road.maxZ);
      if (left >= right || top >= bottom) { next.push(p); continue; }
      if (p.minX < left) next.push({ ...p, maxX: left });
      if (right < p.maxX) next.push({ ...p, minX: right });
      if (p.minZ < top) next.push({ minX: left, maxX: right, minZ: p.minZ, maxZ: top });
      if (bottom < p.maxZ) next.push({ minX: left, maxX: right, minZ: bottom, maxZ: p.maxZ });
    }
    parts = next;
  }
  return parts.filter(r => r.maxX - r.minX > .025 && r.maxZ - r.minZ > .025);
}
