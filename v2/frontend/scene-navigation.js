// Camera input is independent from simulation time: pausing or accelerating the
// warehouse must not change how quickly a person can inspect it.
const DIRECTIONS = {
  KeyW: [0, 1, 0], ArrowUp: [0, 1, 0],
  KeyS: [0, -1, 0], ArrowDown: [0, -1, 0],
  KeyA: [-1, 0, 0], ArrowLeft: [-1, 0, 0],
  KeyD: [1, 0, 0], ArrowRight: [1, 0, 0],
  KeyQ: [0, 0, 1], KeyE: [0, 0, -1],
};

export function isNavigationKey(code) { return Object.hasOwn(DIRECTIONS, code); }

export function mapInputAllowed(event, canvas, { activeElement, blocked = false, hidden = false } = {}) {
  return !blocked && !hidden && activeElement === canvas && event.target === canvas &&
    !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing;
}

export function cameraPlaneDelta(right, forward, dx, dz) {
  const distance = Math.hypot(dx, dz);
  // A nearly vertical plan view still has a deterministic screen-up direction.
  const fx = distance > .00001 ? -dx / distance : 0;
  const fz = distance > .00001 ? -dz / distance : -1;
  return { x: (-fz * right + fx * forward) || 0, z: (fx * right + fz * forward) || 0 };
}

export function turnCameraTarget(eye, target, yawDelta, pitchDelta = 0) {
  const x = target.x - eye.x, y = target.y - eye.y, z = target.z - eye.z;
  const horizontal = Math.hypot(x, z);
  const distance = Math.hypot(horizontal, y) || 1;
  const yaw = Math.atan2(x, z) + yawDelta;
  const limit = Math.PI * .46;
  const pitch = Math.max(-limit, Math.min(limit, Math.atan2(y, horizontal) + pitchDelta));
  const radius = distance * Math.cos(pitch);
  target.set(eye.x + radius * Math.sin(yaw), eye.y + distance * Math.sin(pitch), eye.z + radius * Math.cos(yaw));
}

export default class MapNavigation {
  constructor() { this.keys = new Set(); this.velocity = [0, 0, 0]; }
  press(code) { if (!isNavigationKey(code)) return false; this.keys.add(code); return true; }
  release(code) { return this.keys.delete(code); }
  clear() { this.keys.clear(); this.velocity.fill(0); }
  get active() { return this.keys.size > 0 || this.velocity.some(value => Math.abs(value) > .0001); }

  step(seconds, speed, reducedMotion = false) {
    const dt = Math.min(.08, Math.max(0, Number(seconds) || 0));
    const wanted = [0, 0, 0], positive = [false, false, false], negative = [false, false, false];
    for (const code of this.keys) {
      const axis = DIRECTIONS[code];
      for (let i = 0; i < 3; i++) { if (axis[i] > 0) positive[i] = true; if (axis[i] < 0) negative[i] = true; }
    }
    for (let i = 0; i < 3; i++) wanted[i] = Number(positive[i]) - Number(negative[i]);
    const planar = Math.hypot(wanted[0], wanted[1]);
    if (planar > 1) { wanted[0] /= planar; wanted[1] /= planar; }
    const response = 16, decay = Math.exp(-response * dt), changes = [];
    for (let i = 0; i < 3; i++) {
      const before = this.velocity[i], target = wanted[i];
      // Integrating the exponential produces the same travel at 30 or 120 Hz.
      changes[i] = reducedMotion ? target * dt : target * dt + (before - target) * (1 - decay) / response;
      this.velocity[i] = reducedMotion ? target : target + (before - target) * decay;
      if (!target && Math.abs(this.velocity[i]) < .0001) this.velocity[i] = 0;
    }
    const safeSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    return { right: changes[0] * safeSpeed, forward: changes[1] * safeSpeed, yaw: changes[2] * 1.05, active: this.active };
  }
}
