"use strict";

const { bodyProfile, box, constrainMotion } = require("./physical-contact");
const { physicalLayout } = require("./physical-layout");

// The common truck access has a single manoeuvring envelope. Reserve the
// complete delivery/return cycle: two shops receive on this same access road,
// so arrival at a shop is not evidence that the road has become available.
const ACTIVE = new Set(["DOCKING", "OPENING", "LOADING", "VERIFYING", "QUALITY_HOLD", "CLOSING", "UNDOCKING", "OUTBOUND", "AT_STORE", "RETURNING", "RETURN_PICKUP", "RETURN_CARGO"]);
const RETREATING = "RETREATING";
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clock = state => finite(state.clock?.elapsed);
const truckById = (state, id) => (state.trucks || []).find(truck => truck.id === id);
const pose = item => ({ x: finite(item.x), y: finite(item.y), z: finite(item.z), heading: finite(item.heading) });
const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const distance = (a, b) => Math.hypot(a.x - b.x, finite(a.y) - finite(b.y), a.z - b.z);
const routeOf = truck => truck.trip?.waypoints?.length ? truck.trip.waypoints : truck.route || [];
const routeIndexOf = truck => Number.isInteger(truck.trip?.guideIndex) ? truck.trip.guideIndex : Number.isInteger(truck.routeIndex) ? truck.routeIndex : 1;
const purposeOf = truck => truck.returnId ? "RETURN_PICKUP" : truck.orderId ? "DELIVERY" : truck.state || "ROAD_TRANSFER";

function parked(state, truck) {
  const park = truck.parkPose || (state.layout?.truckParking || []).find(item => item.id === truck.parkId || item.id === `PARK-${truck.id}`);
  return Boolean(park && distance(truck, park) < .35 && angleDistance(finite(truck.heading), finite(park.heading)) < .12);
}
function mayRelease(state, truck) {
  return Boolean(truck && truck.state === "AVAILABLE" && !truck.trip && !truck.orderId && !truck.returnId
    && !(truck.loadPositions || []).some(slot => slot.huId || slot.reservedHuId) && parked(state, truck));
}
function newReservation(state, truck, purpose, recovered = false) {
  return { truckId: truck.id, purpose, acquiredAt: state.clock?.now || null, acquiredElapsed: clock(state), recovered };
}
function requestRow(traffic, state, truck, purpose) {
  let row = traffic.queue.find(item => item.truckId === truck.id);
  if (!row) {
    row = { truckId: truck.id, purpose, ticket: ++traffic.nextTicket, requestedAt: state.clock?.now || null, requestedElapsed: clock(state) };
    traffic.queue.push(row);
  }
  return row;
}

// Test the guided turn and translation, including trailer corners, against a
// stationary body. This is a planning check only; advanceGuided still checks all
// contacts at every physical step while executing an admitted retreat.
function pathClear(points, obstacle, initial) {
  const body = { ...bodyProfile("TRUCK"), id: "TRAFFIC-PLANNER" };
  let from = pose(initial);
  for (const point of points) {
    const to = { ...pose(point), heading: point.heading === undefined ? (distance(from, point) > .001 ? Math.atan2(point.x - from.x, point.z - from.z) : from.heading) : point.heading };
    const turn = { ...from, heading: to.heading };
    if (constrainMotion(body, from, turn, [obstacle]).contact || constrainMotion(body, turn, to, [obstacle]).contact) return false;
    from = to;
  }
  return true;
}
function refugeClearsOwner(owner, refuge) {
  const remaining = routeOf(owner).slice(Math.max(0, routeIndexOf(owner)));
  return pathClear(remaining.length ? remaining : [pose(owner)], box(refuge, bodyProfile("TRUCK"), { id: "TRAFFIC-REFUGE" }), owner);
}
function reversePoints(from, points) {
  let previous = from;
  return points.filter(point => distance(previous, point) > .001).map(point => {
    const result = { ...pose(point), heading: Math.atan2(previous.x - point.x, previous.z - point.z) };
    previous = point;
    return result;
  });
}

function recoveryFor(state, owner, truck) {
  const route = routeOf(truck), index = Math.min(route.length, Math.max(1, routeIndexOf(truck)));
  if (!route.length) return null;
  const backwards = route.slice(0, index).reverse().map(point => ({ ...point }));
  const candidates = [backwards];
  // An outbound trip starts after undocking. Its recorded document still names
  // the original dock, which provides a real refuge behind the traffic lane.
  const order = (state.orders || []).find(item => item.id === truck.orderId);
  const dock = (state.layout?.loadingDocks || []).find(item => item.id === (truck.dockId || order?.dockId));
  if (dock?.truckPose && backwards.length && Math.abs(backwards.at(-1).x - dock.truckPose.x) < .5)
    candidates.unshift([...backwards, { ...dock.truckPose }]);
  const ownerBody = box(owner, bodyProfile("TRUCK"), { id: owner.id });
  const structures = physicalLayout(state.layout || {}).solids;
  for (const points of candidates) {
    const retreat = reversePoints(truck, points);
    if (!retreat.length) continue;
    const refuge = retreat.at(-1);
    if (!refugeClearsOwner(owner, refuge) || !pathClear(retreat, ownerBody, truck)) continue;
    // Do not invent a refuge across a wall. Other mobile equipment continues to
    // be enforced by the execution motor, rather than being ignored here.
    if (structures.some(solid => !pathClear(retreat, solid, truck))) continue;
    return { truckId: truck.id, phase: RETREATING, route: [pose(truck), ...retreat], routeIndex: 1,
      originalRoute: structuredClone(route), originalTrip: Boolean(truck.trip?.waypoints?.length), createdElapsed: clock(state), refuge: { ...refuge } };
  }
  return null;
}
function existingPriority(truck) {
  // A loaded return already leaving a shop has priority over a departure that
  // can physically retreat toward its original loading dock.
  return ({ RETURN_CARGO: 0, RETURNING: 1, AT_STORE: 2, OUTBOUND: 3, RETURN_PICKUP: 4 })[truck.state] ?? 5;
}
function adoptExisting(state, traffic) {
  // A previously arrived truck may still await an old, explicit receipt. Its
  // body remains solid, but installing traffic control cannot receive its
  // stock or assign it an eternal reservation over every other destination.
  const active = (state.trucks || []).filter(truck => (ACTIVE.has(truck.state) && truck.state !== "AT_STORE") || (!parked(state, truck) && truck.state === "FAULT"))
    .sort((a, b) => existingPriority(a) - existingPriority(b) || String(a.id).localeCompare(String(b.id)));
  if (!active.length) return;
  // Prefer an owner whose existing peers have a real, verified retreat. When
  // no such arrangement exists, retain all bodies and expose the blockage.
  let chosen = null;
  for (const owner of active) {
    // A corrupt/unfinished travel record with no guide cannot be selected as
    // the vehicle that will clear the road. Its body stays a real obstruction
    // until a guide exists; choosing it solely because it has no future path
    // would reserve the access for a vehicle incapable of moving.
    if (["OUTBOUND", "RETURNING", "RETURN_PICKUP", "RETURN_CARGO"].includes(owner.state) && routeOf(owner).length < 2) continue;
    const recoveries = active.filter(truck => truck.id !== owner.id).map(truck => ({ truck, recovery: recoveryFor(state, owner, truck) }));
    if (recoveries.every(row => row.recovery || refugeClearsOwner(owner, row.truck))) { chosen = { owner, recoveries }; break; }
  }
  const owner = chosen?.owner || active[0];
  traffic.owner = newReservation(state, owner, purposeOf(owner), true);
  for (const truck of active.filter(item => item.id !== owner.id)) {
    requestRow(traffic, state, truck, purposeOf(truck));
    const recovery = chosen?.recoveries.find(row => row.truck.id === truck.id)?.recovery;
    if (recovery) traffic.recoveries.push(recovery);
    else if (!refugeClearsOwner(owner, truck)) traffic.blockedBy.push(truck.id);
  }
}

function reconcileTraffic(state) {
  let traffic = state.physicalTraffic;
  if (!traffic || traffic.version !== 1) {
    traffic = state.physicalTraffic = { version: 1, capacity: 1, owner: null, queue: [], recoveries: [], blockedBy: [], nextTicket: 0 };
    adoptExisting(state, traffic);
  }
  // A restart keeps the reservation and queue, including the exact retreat
  // cursor. There is deliberately no timeout that frees an occupied road.
  traffic.capacity = 1;
  traffic.queue = traffic.queue.filter(row => truckById(state, row.truckId) && row.truckId !== traffic.owner?.truckId);
  traffic.recoveries = traffic.recoveries.filter(row => truckById(state, row.truckId));
  traffic.blockedBy = traffic.blockedBy.filter(id => truckById(state, id));
  for (const recovery of traffic.recoveries) if (recovery.phase === RETREATING && recovery.routeIndex >= recovery.route.length) {
    recovery.phase = "WAITING";
    recovery.completedElapsed = clock(state);
  }
  const owner = truckById(state, traffic.owner?.truckId);
  traffic.blockedBy = traffic.blockedBy.filter(id => owner && !refugeClearsOwner(owner, truckById(state, id)));
  if (traffic.owner && (!owner || mayRelease(state, owner))) {
    traffic.lastReleased = { truckId: traffic.owner.truckId, releasedElapsed: clock(state), releasedAt: state.clock?.now || null };
    traffic.owner = null;
  }
  return traffic;
}

function resumeRetreated(truck, recovery) {
  // Route cursors may rewind; the body never does. A truck first drives back
  // through the witnessed origin before resuming its pending journey.
  if (recovery.originalTrip && truck.trip) {
    truck.trip.waypoints = structuredClone(recovery.originalRoute);
    truck.trip.guideIndex = 0;
    truck.progress = 0;
  } else truck.routeIndex = 0;
  truck.physicalSpeed = 0;
}
function occupiedDestination(state, truck) {
  const order = (state.orders || []).find(item => item.id === truck.orderId),
    branchId = truck.branchId || order?.branchId;
  if (!branchId || ["RETURNING", "RETURN_CARGO"].includes(truck.state)) return null;
  return (state.trucks || []).find(other => other.id !== truck.id && other.state === "AT_STORE"
    && (other.branchId || (state.orders || []).find(item => item.id === other.orderId)?.branchId) === branchId) || null;
}
function requestTraffic(state, truck, { purpose = purposeOf(truck) } = {}) {
  const traffic = reconcileTraffic(state);
  if (!truckById(state, truck.id)) return { granted: false, ownerId: traffic.owner?.truckId || null, reason: "El vehículo no está registrado en el circuito de transporte." };
  const retreat = traffic.recoveries.find(row => row.phase === RETREATING);
  if (retreat) return { granted: false, ownerId: traffic.owner?.truckId || null,
    reason: truck.id === retreat.truckId ? "El vehículo retrocede hacia un bolsillo seguro antes de ceder el paso." : "Esperando que finalice una maniobra de cesión en el acceso compartido.",
    ...(truck.id === retreat.truckId ? { recovery: retreat } : {}) };
  if (traffic.blockedBy.length) return { granted: false, ownerId: traffic.owner?.truckId || null, reason: "El acceso conserva vehículos anteriores sin un bolsillo de retirada seguro. Se mantiene la detención física.", blockedBy: [...traffic.blockedBy] };
  if (traffic.owner?.truckId === truck.id) return { granted: true, ownerId: truck.id, capacity: 1 };
  requestRow(traffic, state, truck, purpose);
  const stationary = occupiedDestination(state, truck);
  if (stationary) return { granted: false, ownerId: traffic.owner?.truckId || null, blockedBy: [stationary.id],
    reason: "La recepción de destino aún conserva otro vehículo. Espera su salida antes de ocupar ese mismo punto." };
  const nextEligible = traffic.queue.find(row => !occupiedDestination(state, truckById(state, row.truckId)));
  if (!traffic.owner && nextEligible?.truckId === truck.id) {
    traffic.owner = newReservation(state, truck, purpose);
    traffic.queue = traffic.queue.filter(row => row.truckId !== truck.id);
    const recovered = traffic.recoveries.find(row => row.truckId === truck.id && row.phase === "WAITING");
    if (recovered) { resumeRetreated(truck, recovered); traffic.recoveries = traffic.recoveries.filter(row => row !== recovered); }
    return { granted: true, ownerId: truck.id, capacity: 1 };
  }
  return { granted: false, ownerId: traffic.owner?.truckId || null, position: traffic.queue.findIndex(row => row.truckId === truck.id) + 1,
    reason: "Esperando en su bolsillo de maniobra: el acceso está reservado para otro vehículo hasta completar su retorno." };
}

function releaseTraffic(state, truck) {
  const traffic = reconcileTraffic(state);
  if (traffic.owner?.truckId !== truck.id) return !traffic.owner;
  if (!mayRelease(state, truck)) return false;
  traffic.lastReleased = { truckId: truck.id, releasedElapsed: clock(state), releasedAt: state.clock?.now || null };
  traffic.owner = null;
  return true;
}
function trafficStatus(state) {
  const traffic = state.physicalTraffic;
  return traffic ? structuredClone({ capacity: 1, owner: traffic.owner, queue: traffic.queue, recoveries: traffic.recoveries, blockedBy: traffic.blockedBy }) : { capacity: 1, owner: null, queue: [], recoveries: [], blockedBy: [] };
}

module.exports = { requestTraffic, releaseTraffic, reconcileTraffic, trafficStatus, parked };
