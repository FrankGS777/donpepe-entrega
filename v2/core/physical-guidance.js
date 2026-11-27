"use strict";
const { bodyProfile, constrainMotion, advanceMotor } = require("./physical-contact");
const { physicalLayout } = require("./physical-layout");
const { requestTraffic } = require("./physical-traffic");
const { recoverGuidedRoute } = require("./physical-planner");
const worlds = new WeakMap();
const pathDistance = (a, b) => Math.hypot(a.x - b.x, (a.y || 0) - (b.y || 0), a.z - b.z);

function worldFor(layout) {
  let world = worlds.get(layout); if (!world) { world = physicalLayout(layout); worlds.set(layout, world); }
  return world;
}
function obstaclesFor(state, device, type) {
  const ownOrder = device.orderId;
  const transferContact = other => {
    if (!ownOrder || ownOrder !== other.orderId || type !== "FORKLIFT" && other.type !== "FORKLIFT") return false;
    const truck = type === "FORKLIFT" ? other : device, forklift = type === "FORKLIFT" ? device : other;
    return ["LOADING", "UNLOADING_REJECTION", "QUALITY_HOLD"].includes(truck.loadingState || truck.state) && ["TO_SOURCE", "PICKING", "TO_TRUCK", "TO_STAGING", "DEPOSITING", "RETURNING"].includes(forklift.loadingPhase);
  };
  const otherDevices = [...state.robots, ...state.trucks].filter(other => other.id !== device.id && !bodyProfile(other.type || "TRUCK").railGuided)
    .filter(other => !transferContact(other))
    .map(other => ({ ...bodyProfile(other.type || "TRUCK", Boolean(other.carryingHuId), other), id: other.id, pose: { x: other.x, y: other.y || 0, z: other.z, heading: other.heading || 0 } }));
  return [...worldFor(state.layout).solids, ...otherDevices];
}

// The same fixed integration quantum is used regardless of the HTTP refresh
// rate, browser frame rate or simulated clock multiplier.
function advanceGuided(state, device, seconds, { speed = 1.5, type = device.type || "TRUCK", route = device.route, indexField = "routeIndex", holder = device, trafficRecovery = false } = {}) {
  if (!route?.length || holder[indexField] >= route.length) { device.physicalSpeed = 0; delete device.contact; return true; }
  if (type === "TRUCK" && !trafficRecovery) {
    const admission = requestTraffic(state, device);
    if (!admission.granted) {
      if (admission.recovery) advanceGuided(state, device, seconds, { speed, type, trafficRecovery: true, route: admission.recovery.route, holder: admission.recovery, indexField: "routeIndex" });
      else { device.physicalSpeed = 0; device.contact = { obstacleId: admission.ownerId || "YARD-TRAFFIC", reason: admission.reason || "Esperando su turno de circulación en el patio.", at: state.clock.elapsed, normal: { x: 0, y: 0, z: 0 } }; }
      return false;
    }
  }
  const profile = bodyProfile(type, Boolean(device.carryingHuId), device);
  const body = { ...profile, id: device.id };
  const obstacles = profile.railGuided ? [] : obstaclesFor(state, device, type);
  let remaining = Math.max(0, seconds), activeContact = null;
  while (remaining > 1e-8 && holder[indexField] < route.length) {
    const step = Math.min(1 / 60, remaining); remaining -= step;
    const target = route[holder[indexField]];
    // Elevators and rail shuttles retain their approved mechanical envelope.
    // Their telescopic forks are expected to enter an open rack bay.
    if (profile.railGuided) {
      const distance = pathDistance(device, target), travel = Math.min(distance, speed * step), ratio = distance > 1e-8 ? travel / distance : 1;
      device.x += (target.x - device.x) * ratio; device.y = (device.y || 0) + ((target.y || 0) - (device.y || 0)) * ratio; device.z += (target.z - device.z) * ratio;
      if (distance - travel < .001) { Object.assign(device, { x: target.x, y: target.y || 0, z: target.z }); device.nodeId = target.nodeId || device.nodeId; holder[indexField]++; }
      continue;
    }
    const previous = { x: device.x, y: device.y || 0, z: device.z, heading: device.heading || 0, speed: device.physicalSpeed || 0 };
    const desired = advanceMotor(previous, target, step, { ...profile, speed });
    const constrained = constrainMotion(body, previous, desired, obstacles);
    Object.assign(device, { x: constrained.pose.x, y: constrained.pose.y, z: constrained.pose.z, heading: constrained.pose.heading, physicalSpeed: constrained.contact ? 0 : desired.speed });
    if (constrained.contact) {
      activeContact = { obstacleId: constrained.contact.obstacleId, bodyPartId: constrained.contact.bodyPartId || null, obstaclePartId: constrained.contact.obstaclePartId || null, reason: "Esperando que se despeje el espacio de circulación.", at: state.clock.elapsed, normal: constrained.contact.normal };
      if (type === "TRUCK" && !trafficRecovery && recoverGuidedRoute(state, device, route, holder, indexField, obstacles, constrained.contact)) {
        activeContact.recovering = true; activeContact.reason = "Reajustando automáticamente la maniobra para completar el aparcamiento.";
      }
      break;
    }
    if (desired.arrived) {
      Object.assign(device, { x: target.x, y: target.y || 0, z: target.z }); device.nodeId = target.nodeId || device.nodeId; holder[indexField]++; device.physicalSpeed = 0;
    }
  }
  if (activeContact) device.contact = activeContact; else delete device.contact;
  if (holder[indexField] >= route.length && device.clearanceManeuver?.status === "MANEUVERING") { device.clearanceManeuver.status = "COMPLETED"; device.clearanceManeuver.completedAt = state.clock.now; }
  return holder[indexField] >= route.length;
}

module.exports = { advanceGuided, obstaclesFor };
