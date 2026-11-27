import * as THREE from "three";

// A frontal inspection uses the actual aisle, not an orbit point behind the
// neighbouring rack. Camera focus is presentation only; it never hides or deforms geometry.
export function inspectionPose(record, rack, { aspect = 1.6, fov = 42, heading = 0 } = {}) {
  const p = record.position;
  const [width, height, depth] = record.size;
  // A shipping trailer needs a slight front quarter angle to show its cab
  // and cargo body together. Smaller equipment can be viewed head-on.
  const angle = record.type === "truck" ? 0.45 : 0;
  const span = width * Math.cos(angle) + depth * Math.sin(angle);
  const vertical = Math.max(height, span / Math.max(0.5, aspect));
  const fit = (vertical / (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)))) * 1.3;
  if (rack) {
    const railZ = rack.railZ ?? (rack.zoneId === "COLD" ? -16 : -12);
    const sign = Math.sign(railZ - rack.z) || 1;
    const clearance = (rack.depth ?? 3.5) / 2 + 0.5;
    const distance = Math.min(Math.abs(railZ - p.z) || clearance, Math.max(clearance, fit + depth / 2));
    return {
      position: new THREE.Vector3(p.x, p.y + 0.12, p.z + sign * distance),
      target: p.clone(),
    };
  }
  const distance = Math.max(record.type === "truck" ? 26 : 3.2, fit + depth / 2);
  const rise = Math.max(0.35, Math.min(distance * 0.3, height * 0.22 + depth * 0.22));
  return {
    position: new THREE.Vector3(
      p.x + Math.sin(heading + angle) * distance,
      p.y + rise,
      p.z + Math.cos(heading + angle) * distance,
    ),
    target: p.clone(),
  };
}
