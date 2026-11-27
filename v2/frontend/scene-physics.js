import contact from '../core/physical-contact.js';
import geometry from '../core/physical-layout.js';

const { bodyProfile, constrainMotion, stepSupport } = contact;
const { physicalLayout } = geometry;
const number = value => Number(value) || 0;
const MAX_TRUCK_YAW_PER_DRAW = .24;

function gradualTruckPose(from, to) {
  const turn = Math.atan2(Math.sin(to.heading - from.heading), Math.cos(to.heading - from.heading));
  if (Math.abs(turn) <= MAX_TRUCK_YAW_PER_DRAW) return to;
  const fraction = MAX_TRUCK_YAW_PER_DRAW / Math.abs(turn);
  return {
    ...to,
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
    z: from.z + (to.z - from.z) * fraction,
    heading: from.heading + turn * fraction,
  };
}

// An observer-side contact guard uses the same metre-scale geometry as the
// guided motor in the core. Rendering never advances a process or changes stock.
export class ScenePhysics {
  constructor(layout) {
    this.poses = new Map(); this.loads = new Map(); this.contacts = []; this.elapsed = null;
    this.fixedStep = 1 / 60; this.gravity = 9.81; this.setLayout(layout);
  }
  setLayout(layout) { this.layout = layout || {}; const world = physicalLayout(this.layout); this.solids = world.solids; this.surfaces = world.surfaces; }
  reset() { this.poses.clear(); this.loads.clear(); this.elapsed = null; this.contacts = []; }
  step(elapsed, movers, { paused = false } = {}) {
    const result = new Map(), inputs = [...movers].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (this.elapsed !== null && elapsed < this.elapsed) this.loads.clear();
    const discontinuity = this.elapsed === null || elapsed < this.elapsed || elapsed - this.elapsed > 2.5;
    const continuous = !discontinuity && !paused;
    this.contacts = [];
    this.catchingUp = false;
    const entries = inputs.map(entry => {
      const item = entry.item || entry, id = String(entry.id), type = entry.type === 'truck' ? 'TRUCK' : item.type || entry.type;
      const to = { ...entry.pose, x: number(entry.pose.x), y: number(entry.pose.y), z: number(entry.pose.z), heading: number(entry.pose.heading) };
      return { id, type, item, to, from: discontinuity ? to : this.poses.get(id) || to, body: { ...bodyProfile(type, Boolean(to.carryingHuId), { ...item, ...to }), id, ignoreIds: entry.ignoreIds || [] } };
    });
    for (const entry of entries) {
      let pose = { ...entry.to };
      // Rail cranes use their configured guide envelope rather than a solid
      // rack, whose bays are intentionally open for the telescopic forks.
      const { from, to } = entry;
      const changing = from.x !== to.x || from.y !== to.y || from.z !== to.z || from.heading !== to.heading;
      if (!entry.body.railGuided && continuous && changing) {
        // A still-current observation can be rendered several times. Every
        // draw must respect the same contact guard, including when no new
        // telemetry has arrived while a trailer is finishing a turn.
        const target = entry.type === 'TRUCK' ? gradualTruckPose(entry.from, entry.to) : entry.to;
        const observedOrder = candidate => Object.hasOwn(candidate.to, 'orderId') ? candidate.to.orderId : candidate.item.orderId;
        const orderId = observedOrder(entry);
        const inTransfer = entry.type === 'FORKLIFT' && ['TO_SOURCE', 'LOADING', 'MOVING', 'UNLOADING', 'RETURNING'].includes(entry.to.state);
        const ignoredTruck = inTransfer && orderId ? entries.find(other => other.type === 'TRUCK' && observedOrder(other) === orderId && ['LOADING', 'UNLOADING_REJECTION', 'QUALITY_HOLD'].includes(other.to.state))?.id : null;
        const staticObstacles = this.solids.filter(solid => solid.railOwnerId !== entry.id);
        const otherMovers = entries.filter(other => other.id !== entry.id && !other.body.railGuided && other.id !== ignoredTruck && !(entry.type === 'TRUCK' && ['LOADING', 'UNLOADING_REJECTION', 'QUALITY_HOLD'].includes(entry.to.state) && other.type === 'FORKLIFT' && observedOrder(other) && observedOrder(other) === orderId))
          .map(other => ({ ...other.body, ...other.from, pose: other.from, to: other.to }));
        const constrained = constrainMotion(entry.body, entry.from, target, [...staticObstacles, ...otherMovers], { skin: .035 });
        if (!constrained.contact && target !== entry.to) this.catchingUp = true;
        pose = constrained.pose;
        if (constrained.contact) this.contacts.push({ id: entry.id, obstacleId: constrained.contact.obstacleId, normal: constrained.contact.normal, fraction: constrained.fraction });
      }
      this.poses.set(entry.id, pose); result.set(entry.id, pose);
    }
    for (const id of this.poses.keys()) if (!entries.some(entry => entry.id === id)) this.poses.delete(id);
    this.elapsed = elapsed; return result;
  }
  // Call for a pallet only. A carried/conveyor load is rigidly attached to its
  // owning machine. A resting pallet resolves against the matching real shelf
  // or floor, with deterministic gravity at 60 fixed physics steps per second.
  supportLoad(id, desired, dt, { locationId, carrierId, mechanicallySupported = false, elapsed } = {}) {
    const previous = this.loads.get(String(id)) || { ...desired, velocityY: 0 };
    const surfaces = this.surfaces.filter(surface => !surface.ownerId || surface.ownerId === locationId);
    const repeated = Number.isFinite(elapsed) && previous.observedElapsed === elapsed;
    let state = previous, remaining = repeated ? 0 : Math.min(.25, Math.max(0, dt));
    if (carrierId || mechanicallySupported) state = stepSupport(previous, { ...desired, ownerId: carrierId || locationId }, 0, { attached: true });
    else while (remaining > 1e-8) { const step = Math.min(this.fixedStep, remaining); state = stepSupport(state, { ...desired, ownerId: locationId }, step, { surfaces, gravity: this.gravity }); remaining -= step; }
    state = { ...state, observedElapsed: elapsed }; this.loads.set(String(id), state); return { ...state };
  }
  diagnostics() { return { engine: 'continuous-guided-contacts', gravity: this.gravity, fixedStep: this.fixedStep, staticBodies: this.solids.length, movers: this.poses.size, contacts: this.contacts.map(contact => ({ ...contact })), supportedLoads: [...this.loads.values()].filter(load => load.supported).length }; }
  dispose() { this.reset(); this.solids = []; this.surfaces = []; }
}
