"use strict";
const { TRUCK_GUIDE_VERSION } = require("./motion-guide");
const { constrainMotion, bodyProfile, angleDelta } = require("./physical-contact");
const finite = value => Number(value) || 0;
const pose = item => ({ x: finite(item.x), y: finite(item.y), z: finite(item.z), heading: finite(item.heading) });
const distance = (a, b) => Math.hypot(a.x - b.x, finite(a.y) - finite(b.y), a.z - b.z);

// Validate both the turn and translation of every proposed manoeuvre against
// the same compound vehicle volumes used by the running motor. A route is
// accepted as a whole before modifying the pending guided journey.
function guideClear(body, initial, points, obstacles) {
  let from = pose(initial);
  for (const point of points) {
    const heading = point.heading === undefined ? (distance(from, point) > .004 ? Math.atan2(point.x - from.x, point.z - from.z) : from.heading) : point.heading;
    const turned = { ...from, heading }, to = { ...pose(point), heading };
    if (Math.abs(angleDelta(from.heading, heading)) > .00001 && constrainMotion(body, from, turned, obstacles).contact) return false;
    if (distance(turned, to) > .00001 && constrainMotion(body, turned, to, obstacles).contact) return false;
    from = to;
  }
  return true;
}

function parkingGuide(from, destination) {
  // One shared, clear turning pocket is west of all three parked trailers.
  // A pocket at parkingX-18 put vehicle3's turn directly in front of vehicle1.
  return [{ ...pose(from) }, { x: 10, y: 0, z: 60 }, { x: 10, y: 0, z: 54 },
    { x: destination.x, y: 0, z: 54 }, { ...pose(destination), heading: finite(destination.heading) }];
}

function planClearance(initial, destination, obstacles, { preferredRoute, parking = false } = {}) {
  const body = { ...bodyProfile("TRUCK"), id: initial.id }, start = pose(initial), target = pose(destination);
  const direct = preferredRoute || (parking ? parkingGuide(start, target) : [start, target]);
  if (guideClear(body, start, direct, obstacles)) return { route: direct, clearanceDistance: 0, direction: "GUIDED" };
  // A blocked turn must first gain clearance by driving or reversing along its
  // present heading. No lateral displacement, teleport or collision exemption
  // is used; even the short escape segment must pass the continuous sweep.
  for (const length of [1.5, 3, 5, 8, 12, -1.5, -3, -5, -8, -12]) {
    const escape = { x: start.x + Math.sin(start.heading) * length, y: start.y, z: start.z + Math.cos(start.heading) * length, heading: start.heading };
    for (const alignmentZ of [54, 56, 52]) {
      const verticalHeading = alignmentZ < escape.z ? Math.PI : 0;
      const horizontalHeading = target.x < escape.x ? -Math.PI / 2 : Math.PI / 2;
      const candidates = [
        [escape, { x: escape.x, y: 0, z: alignmentZ, heading: verticalHeading }, { x: target.x, y: 0, z: alignmentZ, heading: horizontalHeading }, target],
        [escape, { x: 10, y: 0, z: escape.z, heading: escape.x > 10 ? -Math.PI / 2 : Math.PI / 2 }, { x: 10, y: 0, z: alignmentZ, heading: verticalHeading }, { x: target.x, y: 0, z: alignmentZ, heading: target.x > 10 ? Math.PI / 2 : -Math.PI / 2 }, target],
      ];
      for (const route of candidates) if (guideClear(body, start, route, obstacles)) return { route: [start, ...route], clearanceDistance: Math.abs(length), direction: length > 0 ? "FORWARD" : "REVERSE" };
    }
  }
  return null;
}

function recoverGuidedRoute(state, device, route, holder, indexField, obstacles, contact) {
  if (!route?.length || device.clearanceManeuver?.retryAfter > state.clock.elapsed) return false;
  const destination = route.at(-1), park = device.parkPose;
  const parking = Boolean(park && distance(destination, park) < .01);
  if (!parking && !["DOCKING", "UNDOCKING", "REDOCKING_HOLD"].includes(device.loadingState)) return false;
  const planned = planClearance(device, { ...destination, heading: destination.heading ?? (parking ? park.heading : device.heading) }, obstacles, { parking });
  if (!planned) { device.clearanceManeuver = { ...(device.clearanceManeuver || {}), status: "WAITING_SPACE", obstacleId: contact.obstacleId, retryAfter: state.clock.elapsed + 5 }; return false; }
  const oldLength = route.slice(1).reduce((total, point, index) => total + distance(route[index], point), 0);
  const oldProgress = Math.max(0, Math.min(.999999, device.progress || 0));
  const original = structuredClone(route);
  route.splice(0, route.length, ...planned.route); holder[indexField] = 1; device.physicalSpeed = 0;
  if (holder === device.trip) {
    const nominalSpeed = oldLength / Math.max(.001, holder.duration), remainingDuration = holder.duration * (1 - oldProgress);
    holder.length = route.slice(1).reduce((total, point, index) => total + distance(route[index], point), 0);
    holder.duration = Math.max(remainingDuration, holder.length / Math.max(.1, nominalSpeed));
    holder.completedFraction = oldProgress; holder.physicalGuideVersion = TRUCK_GUIDE_VERSION;
    holder.previousWaypoints = original; holder.replannedAt = state.clock.now;
  }
  device.clearanceManeuver = { status: "MANEUVERING", obstacleId: contact.obstacleId, direction: planned.direction, clearanceDistance: planned.clearanceDistance, startedAt: state.clock.now, startedElapsed: state.clock.elapsed, retryAfter: state.clock.elapsed + 2 };
  return true;
}

module.exports = { guideClear, parkingGuide, planClearance, recoverGuidedRoute };
