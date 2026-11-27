"use strict";

// Metres, seconds and radians. Motored warehouse equipment remains guided by
// the WMS; these contacts prevent a guided body from tunnelling through another
// body. No impact can create, destroy or reassign an inventory unit.
const EPS = 1e-8;
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const angleDelta = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;
const poseAt = (a, b, t) => ({ x: lerp(finite(a.x), finite(b.x), t), y: lerp(finite(a.y), finite(b.y), t), z: lerp(finite(a.z), finite(b.z), t), heading: finite(a.heading) + angleDelta(finite(a.heading), finite(b.heading)) * t });

const BODY_PROFILES = Object.freeze({
  AMR: Object.freeze({ width: .89, depth: 1.19, height: .18, acceleration: .9, braking: 1.3, turnRate: 2.2 }),
  FORKLIFT: Object.freeze({ width: 1.5, depth: 3.05, height: 2.8, offsetZ: .25, acceleration: .65, braking: 1, turnRate: 1.6 }),
  // Compound volumes use the actual scene model: the 14.5 m trailer, chassis,
  // shorter cab, projecting mirrors and six tyres. A selection envelope is
  // deliberately not a solid body spanning empty air around the vehicle.
  TRUCK: Object.freeze({ width: 3.42, depth: 17.125, height: 4.3, offsetZ: .9625, acceleration: .65, braking: 1, turnRate: .6,
    parts: Object.freeze([
      Object.freeze({ name: "trailer", width: 2.8, depth: 14.5, height: 3.06, offsetZ: -.05, offsetY: 1.15 }),
      Object.freeze({ name: "chassis", width: 2.6, depth: 16.6, height: .3, offsetZ: .7, offsetY: .7 }),
      Object.freeze({ name: "cab", width: 2.75, depth: 2.9, height: 2.8, offsetZ: 8.075, offsetY: .8 }),
      ...[-1, 1].map(side => Object.freeze({ name: side < 0 ? "mirror-left" : "mirror-right", width: .12, depth: .3, height: .5, offsetX: side * 1.65, offsetZ: 9, offsetY: 2.55 })),
      ...[-1, 1].flatMap(side => [-5.4, -3.9, 7.8].map(z => Object.freeze({ name: `tyre-${side}-${z}`, width: .32, depth: 1.1, height: 1.1, offsetX: side * 1.28, offsetZ: z }))),
    ]) }),
  STACKER: Object.freeze({ width: 2.2, depth: 1.4, height: 9, railGuided: true }),
  SHUTTLE: Object.freeze({ width: 2.4, depth: 2.4, height: .85, railGuided: true }),
  LOAD: Object.freeze({ width: 1.16, depth: .94, height: 1.9, acceleration: 0, braking: 0 }),
});

const amrProfiles = new Map();
function bodyProfile(type, carrying = false, configuration) {
  const name = String(type || "AMR").toUpperCase();
  const base = BODY_PROFILES[name] || (/STACK/.test(name) ? BODY_PROFILES.STACKER : /SHUTTLE/.test(name) ? BODY_PROFILES.SHUTTLE : BODY_PROFILES.AMR);
  if (name === "AMR" && configuration) {
    const cargoHeight = Math.ceil(clamp(finite(configuration.cargoHeight, .95), .18, .95) * 200) / 200;
    const key = `${cargoHeight}:${Boolean(carrying)}`;
    if (amrProfiles.has(key)) return amrProfiles.get(key);
    const rise = Math.max(0, cargoHeight - .18), parts = [{ name: "chassis", width: .89, depth: 1.19, height: .18 },
      { name: "lifting-deck", width: .78, depth: .68, height: .04, offsetY: cargoHeight - .04 }];
    if (rise > .005) for (const side of [-1, 1]) for (const sign of [-1, 1]) for (let index = 0; index < 4; index++) {
      const fraction = (index + .5) / 4;
      parts.push({ name: `scissor-${side}-${sign}-${index}`, width: .035, depth: .55 / 4 + .035, height: rise / 4 + .035,
        offsetX: side * .28, offsetZ: (fraction - .5) * .55, offsetY: .14 + (sign > 0 ? fraction : 1 - fraction) * rise - (rise / 4 + .035) / 2 });
    }
    if (carrying) parts.push({ name: "carried-pallet", width: 1.16, depth: .94, height: 1.836, offsetY: cargoHeight });
    const result = Object.freeze({ ...base, width: carrying ? 1.16 : base.width, height: carrying ? cargoHeight + 1.836 : Math.max(.18, cargoHeight), parts: Object.freeze(parts.map(part => Object.freeze(part))) });
    amrProfiles.set(key, result); return result;
  }
  // The low AMR fits under a pallet. Its transported pallet expands the swept
  // footprint, instead of colliding with the AMR which owns the load.
  return carrying && name === "AMR" ? { ...base, width: Math.max(base.width, 1.16), depth: Math.max(base.depth, .94), height: 2.1 } : base;
}

function box(pose, dimensions = {}, extra = {}) {
  const heading = finite(pose?.heading), sin = Math.sin(heading), cos = Math.cos(heading), offset = finite(dimensions.offsetZ), side = finite(dimensions.offsetX);
  const result = { ...extra, x: finite(pose?.x) + sin * offset + cos * side, y: finite(pose?.y) + finite(dimensions.offsetY) + finite(dimensions.height, 1) / 2, z: finite(pose?.z) + cos * offset - sin * side,
    heading, halfWidth: Math.max(EPS, finite(dimensions.width, 1) / 2), halfDepth: Math.max(EPS, finite(dimensions.depth, 1) / 2), halfHeight: Math.max(EPS, finite(dimensions.height, 1) / 2) };
  if (dimensions.parts?.length) result.children = dimensions.parts.map(part => box(pose, part, { id: result.id, ownerId: result.ownerId, ignoreIds: result.ignoreIds, partId: part.name, pivotRadius: Math.hypot(finite(part.offsetX), finite(part.offsetZ)) }));
  return result;
}

const axes = body => [{ x: Math.cos(body.heading), z: -Math.sin(body.heading) }, { x: Math.sin(body.heading), z: Math.cos(body.heading) }];
function radius(body, axis, padding = 0) {
  const [right, forward] = axes(body);
  return Math.abs(right.x * axis.x + right.z * axis.z) * body.halfWidth + Math.abs(forward.x * axis.x + forward.z * axis.z) * body.halfDepth + padding;
}
function separation(a, b, padding = 0) {
  if (a.children || b.children) return Math.min(...(a.children || [a]).flatMap(first => (b.children || [b]).map(other => separation(first, other, padding))));
  let greatest = Math.abs(a.y - b.y) - a.halfHeight - b.halfHeight;
  for (const axis of [...axes(a), ...axes(b)]) greatest = Math.max(greatest, Math.abs((b.x - a.x) * axis.x + (b.z - a.z) * axis.z) - radius(a, axis, padding) - radius(b, axis));
  return greatest;
}
function overlaps(a, b, padding = 0) { return separation(a, b, padding) < -EPS; }

function excluded(a, b) {
  if (!a || !b || a.id && a.id === b.id) return true;
  if (a.ownerId && (a.ownerId === b.id || a.ownerId === b.ownerId) || b.ownerId && b.ownerId === a.id) return true;
  if (a.ignoreIds?.includes(b.id) || b.ignoreIds?.includes(a.id)) return true;
  return false;
}

// Exact continuous SAT for translation, including vertical separation. Rotation
// is split into bounded angular intervals and enclosed by its actual arc length;
// unlike endpoint overlap tests, a 100 m/s body cannot tunnel through a wall.
function translationHit(a, aTo, b, bTo, padding = 0) {
  let enter = 0, exit = 1, normal = { x: 0, y: 0, z: 0 };
  const relative = { x: aTo.x - a.x - (bTo.x - b.x), y: aTo.y - a.y - (bTo.y - b.y), z: aTo.z - a.z - (bTo.z - b.z) };
  const checks = [...axes(a), ...axes(b)].map(axis => ({ axis, distance: (a.x - b.x) * axis.x + (a.z - b.z) * axis.z, speed: relative.x * axis.x + relative.z * axis.z, limit: radius(a, axis, padding) + radius(b, axis) }));
  checks.push({ axis: { x: 0, y: 1, z: 0 }, distance: a.y - b.y, speed: relative.y, limit: a.halfHeight + b.halfHeight });
  for (const { axis, distance, speed, limit } of checks) {
    if (Math.abs(speed) < EPS) { if (Math.abs(distance) >= limit - EPS) return null; continue; }
    const first = (-limit - distance) / speed, last = (limit - distance) / speed;
    const start = Math.min(first, last), end = Math.max(first, last);
    if (start > enter) { enter = start; const sign = speed > 0 ? -1 : 1; normal = { x: axis.x * sign, y: finite(axis.y) * sign, z: axis.z * sign }; }
    exit = Math.min(exit, end); if (enter > exit || exit < 0 || enter > 1) return null;
  }
  if (exit <= EPS) return null;
  return { fraction: Math.max(0, enter), normal };
}

function sweepAtomic(a, aTo, b, bTo = b, padding = 0) {
  if (excluded(a, b)) return null;
  // Recovery after an old saved geometry overlap may only reduce penetration.
  // It must not trap existing equipment forever or move it further inside.
  const before = separation(a, b), after = separation(aTo, bTo);
  if (before < -EPS && after > before + EPS) {
    const probe = (from, to) => ({ ...from, ...poseAt(from, to, .001) });
    if (separation(probe(a, aTo), probe(b, bTo)) > before + EPS) return null;
  }
  const turnA = angleDelta(a.heading, aTo.heading), turnB = angleDelta(b.heading, bTo.heading);
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(turnA), Math.abs(turnB)) / (Math.PI / 720)));
  const rA = Math.hypot(a.halfWidth, a.halfDepth) + finite(a.pivotRadius), rB = Math.hypot(b.halfWidth, b.halfDepth) + finite(b.pivotRadius);
  for (let step = 0; step < steps; step++) {
    const t0 = step / steps, t1 = (step + 1) / steps;
    const interpolate = (from, to, t) => ({ ...from, ...poseAt(from, to, t) });
    const startA = interpolate(a, aTo, t0), endA = interpolate(a, aTo, t1), startB = interpolate(b, bTo, t0), endB = interpolate(b, bTo, t1);
    const arc = rA * Math.abs(turnA) / steps + rB * Math.abs(turnB) / steps;
    const hit = translationHit(startA, endA, startB, endB, padding + arc);
    if (hit) return { ...hit, fraction: (step + hit.fraction) / steps, obstacleId: b.id || null };
  }
  return null;
}

function sweep(a, aTo, b, bTo = b, padding = 0) {
  if (excluded(a, b)) return null;
  if (!a.children && !b.children) return sweepAtomic(a, aTo, b, bTo, padding);
  const firsts = a.children || [a], others = b.children || [b], endFirsts = aTo.children || [aTo], endOthers = bTo.children || [bTo];
  let earliest = null;
  const bounds = (from, to) => {
    const turn = Math.abs(angleDelta(from.heading, to.heading));
    const extra = Math.hypot(from.halfWidth, from.halfDepth) * turn + finite(from.pivotRadius) * (1 - Math.cos(turn / 2)) + padding;
    const extent = body => ({ x: Math.abs(Math.cos(body.heading)) * body.halfWidth + Math.abs(Math.sin(body.heading)) * body.halfDepth, z: Math.abs(Math.sin(body.heading)) * body.halfWidth + Math.abs(Math.cos(body.heading)) * body.halfDepth });
    const first = extent(from), last = extent(to), x = Math.max(first.x, last.x) + extra, z = Math.max(first.z, last.z) + extra;
    return { minX: Math.min(from.x, to.x) - x, maxX: Math.max(from.x, to.x) + x, minZ: Math.min(from.z, to.z) - z, maxZ: Math.max(from.z, to.z) + z };
  };
  const firstBounds = firsts.map((part, index) => bounds(part, endFirsts[index])), otherBounds = others.map((part, index) => bounds(part, endOthers[index]));
  for (let first = 0; first < firsts.length; first++) for (let other = 0; other < others.length; other++) {
    const startA = firsts[first], endA = endFirsts[first], startB = others[other], endB = endOthers[other];
    if (Math.min(startA.y, endA.y) - startA.halfHeight >= Math.max(startB.y, endB.y) + startB.halfHeight || Math.max(startA.y, endA.y) + startA.halfHeight <= Math.min(startB.y, endB.y) - startB.halfHeight) continue;
    const aBounds = firstBounds[first], bBounds = otherBounds[other];
    if (aBounds.maxX < bBounds.minX || aBounds.minX > bBounds.maxX || aBounds.maxZ < bBounds.minZ || aBounds.minZ > bBounds.maxZ) continue;
    const hit = sweepAtomic(startA, endA, startB, endB, padding);
    if (hit && (!earliest || hit.fraction < earliest.fraction)) earliest = { ...hit, obstacleId: b.id || null, bodyPartId: startA.partId || null, obstaclePartId: startB.partId || null };
  }
  return earliest;
}

function constrainMotion(body, from, to, obstacles, { skin = .035, padding = 0 } = {}) {
  const start = box(from, body, body), end = box(to, body, body);
  const spanRadius = Math.hypot(start.halfWidth, start.halfDepth) + padding;
  const minimumX = Math.min(start.x, end.x) - spanRadius, maximumX = Math.max(start.x, end.x) + spanRadius;
  const minimumZ = Math.min(start.z, end.z) - spanRadius, maximumZ = Math.max(start.z, end.z) + spanRadius;
  let contact = null;
  for (const obstacle of obstacles || []) {
    const other = obstacle.halfWidth ? obstacle : box(obstacle.pose || obstacle, obstacle, obstacle);
    const otherEnd = obstacle.to ? box(obstacle.to, obstacle, obstacle) : other;
    const extentX = Math.abs(Math.cos(other.heading)) * other.halfWidth + Math.abs(Math.sin(other.heading)) * other.halfDepth;
    const extentZ = Math.abs(Math.sin(other.heading)) * other.halfWidth + Math.abs(Math.cos(other.heading)) * other.halfDepth;
    const changingHeading = Math.abs(angleDelta(other.heading, otherEnd.heading)) > EPS;
    const otherRadius = Math.hypot(other.halfWidth, other.halfDepth);
    const broadX = changingHeading ? otherRadius : extentX, broadZ = changingHeading ? otherRadius : extentZ;
    if (maximumX < Math.min(other.x, otherEnd.x) - broadX || minimumX > Math.max(other.x, otherEnd.x) + broadX || maximumZ < Math.min(other.z, otherEnd.z) - broadZ || minimumZ > Math.max(other.z, otherEnd.z) + broadZ) continue;
    const hit = sweep(start, end, other, otherEnd, padding);
    if (hit && (!contact || hit.fraction < contact.fraction)) contact = hit;
  }
  if (!contact) return { pose: { ...to }, fraction: 1, contact: null };
  const length = Math.hypot(to.x - from.x, finite(to.y) - finite(from.y), to.z - from.z) + Math.hypot(body.width || 0, body.depth || 0) * Math.abs(angleDelta(finite(from.heading), finite(to.heading))) / 2;
  const fraction = Math.max(0, contact.fraction - skin / Math.max(length, skin));
  return { pose: { ...to, ...poseAt(from, to, fraction) }, fraction, contact };
}

// A semi-implicit fixed-step motor respects acceleration, braking distance and
// maximum angular velocity. It never steers away from the approved guide path.
function advanceMotor(motor, target, dt, settings = {}) {
  const maxSpeed = Math.max(0, finite(settings.speed, 1.5)), acceleration = Math.max(.05, finite(settings.acceleration, .9)), braking = Math.max(.05, finite(settings.braking, 1.3));
  const dx = target.x - motor.x, dy = finite(target.y) - finite(motor.y), dz = target.z - motor.z, distance = Math.hypot(dx, dy, dz);
  const requestedHeading = target.heading === undefined ? (Math.hypot(dx, dz) > EPS ? Math.atan2(dx, dz) : finite(motor.heading)) : finite(target.heading);
  const turn = angleDelta(finite(motor.heading), requestedHeading), turnRate = Math.max(.05, finite(settings.turnRate, 2.2));
  const heading = finite(motor.heading) + clamp(turn, -turnRate * dt, turnRate * dt);
  const desired = Math.min(maxSpeed, Math.sqrt(2 * braking * Math.max(0, distance - .001)));
  const previousSpeed = Math.max(0, finite(motor.speed));
  let speed = previousSpeed < desired ? Math.min(desired, previousSpeed + acceleration * dt) : Math.max(desired, previousSpeed - braking * dt);
  if (Math.abs(turn) > .14 && settings.rotateBeforeTravel !== false) speed = Math.max(0, previousSpeed - braking * dt);
  const travel = Math.min(distance, (previousSpeed + speed) * .5 * dt);
  const ratio = distance > EPS ? travel / distance : 1;
  return { ...motor, x: motor.x + dx * ratio, y: finite(motor.y) + dy * ratio, z: motor.z + dz * ratio, heading, speed: distance <= .004 ? 0 : speed, arrived: distance - travel <= .004 && Math.abs(angleDelta(heading, requestedHeading)) < .025 };
}

// A load base rests on a horizontal or sloped support. Free unsupported loads
// accelerate at 9.81 m/s²; a contact cancels inward velocity with no bounce or
// penetration. A carrier attachment is an explicit rigid constraint, not a
// collision against the vehicle carrying the same inventory unit.
function stepSupport(state, desired, dt, { surfaces = [], attached = false, gravity = 9.81 } = {}) {
  if (attached) return { ...desired, velocityY: 0, supported: true, supportId: desired.ownerId || "carrier", contactImpulse: 0 };
  const footprint = bodyProfile("LOAD"), bottom = finite(state?.y, finite(desired.y));
  let support = null;
  for (const surface of surfaces) {
    if (surface.ownerId && desired.ownerId && surface.ownerId !== desired.ownerId) continue;
    const y = typeof surface.heightAt === "function" ? surface.heightAt(desired.x, desired.z) : finite(surface.y);
    const inside = Math.abs(desired.x - surface.x) <= surface.width / 2 - footprint.width / 2 + EPS && Math.abs(desired.z - surface.z) <= surface.depth / 2 - footprint.depth / 2 + EPS;
    if (inside && (y <= bottom + .12 || surface.foundation) && (!support || y > support.y)) support = { id: surface.id, y };
  }
  const beforeVelocity = finite(state?.velocityY), velocityY = beforeVelocity - Math.max(0, gravity) * dt;
  const nextY = bottom + beforeVelocity * dt - .5 * Math.max(0, gravity) * dt * dt;
  if (support && nextY <= support.y) return { ...desired, y: support.y, velocityY: 0, supported: true, supportId: support.id, contactImpulse: Math.max(0, -velocityY) };
  return { ...desired, y: nextY, velocityY, supported: false, supportId: null, contactImpulse: 0 };
}

module.exports = { BODY_PROFILES, bodyProfile, box, overlaps, separation, sweep, constrainMotion, advanceMotor, stepSupport, poseAt, angleDelta };
