// Pure visual helpers: they reconstruct only travel already reported by the
// server. They never dispatch equipment or extrapolate across an unseen turn.
const point = (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0, z: Number(p?.z) || 0 });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a, b, tolerance = 0.035) => distance(a, b) < tolerance;

// A changing polling delay must never move a displayed device backwards.
// Small clock corrections alter playback rate by at most 8%; visibility gaps
// restart at the new observed timeline instead of replaying unseen minutes.
export function playbackTime(previous, wallTime, elapsedMs, delayMs) {
  const ideal = wallTime - delayMs;
  if (!Number.isFinite(previous) || elapsedMs > 2500) return ideal;
  const elapsed = Math.max(0, elapsedMs), predicted = previous + elapsed;
  const correction = Math.max(-elapsed * 0.08, Math.min(elapsed * 0.08, ideal - predicted));
  return Math.max(previous, predicted + correction);
}

// Playback the internal simulation samples across the actual interval between
// two received snapshots. Fast-forward changes the scale, never the route.
export function historyWallTime(elapsed, previous, current) {
  if (!previous || current.elapsed <= previous.elapsed) return current.at;
  const ratio = Math.max(0, Math.min(1, (elapsed - previous.elapsed) / (current.elapsed - previous.elapsed)));
  return previous.at + (current.at - previous.at) * ratio;
}

// The presentation delay often exceeds one poll. Keep a bounded clock history
// and interpolate the pair surrounding playback, not just the latest pair.
// This reconstructs observed time only: a stalled connection cannot invent
// machine progress beyond the last confirmed snapshot.
export function observedSimulationTime(anchors, wallTime, paused = false) {
  if (!anchors?.length) return 0;
  if (paused) return anchors.at(-1).elapsed;
  let previous = anchors[0];
  if (wallTime <= previous.at) return previous.elapsed;
  for (let index = 1; index < anchors.length; index++) {
    const current = anchors[index];
    if (current.at >= wallTime) {
      const ratio = current.at <= previous.at ? 1 : Math.max(0, Math.min(1, (wallTime - previous.at) / (current.at - previous.at)));
      return previous.elapsed + (current.elapsed - previous.elapsed) * ratio;
    }
    previous = current;
  }
  return previous.elapsed;
}

export function observedUnitState(history, wallTime, firstObservedAt = -Infinity) {
  if (wallTime < firstObservedAt) return null;
  let selected = history?.[0]?.hu;
  for (const sample of history || []) {
    if (sample.at > wallTime) break;
    selected = sample.hu;
  }
  return selected;
}

function projectOnPath(position, route, cursor) {
  let travelled = 0, best = null;
  const segment = Number.isInteger(cursor) ? Math.max(1, Math.min(route.length - 1, cursor)) : null;
  for (let index = 1; index < route.length; index++) {
    const a = point(route[index - 1]), b = point(route[index]);
    const length = distance(a, b);
    if (!length) continue;
    if (segment !== null && index !== segment) { travelled += length; continue; }
    const ratio = Math.max(0, Math.min(1, ((position.x - a.x) * (b.x - a.x) + (position.y - a.y) * (b.y - a.y) + (position.z - a.z) * (b.z - a.z)) / (length * length)));
    const candidate = { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, z: a.z + (b.z - a.z) * ratio };
    const error = distance(position, candidate);
    if (!best || error < best.error) best = { error, length: travelled + length * ratio, index };
    travelled += length;
  }
  return best;
}

export function reportedTravelPath(previous, next) {
  const a = point(previous), b = point(next);
  if (same(a, b)) return [a, b];
  const routes = [previous.route, next.route].filter((r) => Array.isArray(r) && r.length > 1).map((r) => r.map(point));
  const sameRoute = (a, b) => a?.length === b?.length && a.every((p, i) => same(point(p), point(b[i]), .0001));
  // A loading/unloading boundary can replace the route between two polls. Join
  // its two reported legs at their shared transfer point instead of cutting a
  // diagonal through a rack, chamber wall or road corner.
  if (routes.length === 2 && same(routes[0].at(-1), routes[1][0])) routes.push([...routes[0], ...routes[1].slice(1)]);
  for (const route of routes) {
    // Road guides revisit the same junction when returning. Projecting onto
    // the nearest arbitrary segment can rewind through an entire earlier leg.
    // The witnessed guide cursor disambiguates that crossing without guessing.
    const joined = route === routes[2];
    const startCursor = sameRoute(route, previous.route) || joined ? previous.routeIndex : undefined;
    const endCursor = sameRoute(route, next.route) ? next.routeIndex : joined && Number.isInteger(next.routeIndex) ? routes[0].length - 1 + next.routeIndex : undefined;
    const start = projectOnPath(a, route, startCursor), end = projectOnPath(b, route, endCursor);
    if (!start || !end || start.error > 0.15 || end.error > 0.15 || end.length < start.length - 0.02) continue;
    const path = [a]; let travelled = 0;
    for (let index = 1; index < route.length; index++) {
      travelled += distance(route[index - 1], route[index]);
      if (travelled > start.length + 0.02 && travelled < end.length - 0.02) path.push(route[index]);
    }
    path.push(b); return path;
  }
  // A same-axis displacement is safe without an intermediate waypoint. An
  // unreported diagonal is deliberately not invented: the observer corrects
  // to the authoritative sample at the end of the interval.
  const changedAxes = ['x', 'y', 'z'].filter((axis) => Math.abs(a[axis] - b[axis]) > 0.04).length;
  return changedAxes <= 1 ? [a, b] : [a, { ...a, hold: true }, b];
}

export function sampleTravelPath(path, progress) {
  const t = Math.max(0, Math.min(1, progress));
  if (path.some((p) => p.hold)) return { ...point(t < 1 ? path[0] : path.at(-1)), tangent: null, corrected: t >= 1 };
  const lengths = path.slice(1).map((p, i) => distance(path[i], p));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let remaining = total * t;
  for (let index = 1; index < path.length; index++) {
    const length = lengths[index - 1];
    if (remaining <= length || index === path.length - 1) {
      const a = point(path[index - 1]), b = point(path[index]);
      const ratio = length ? Math.min(1, remaining / length) : 1;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio, z: a.z + (b.z - a.z) * ratio,
        tangent: length ? { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z } : null };
    }
    remaining -= length;
  }
  return { ...point(path.at(-1)), tangent: null };
}

export const LOAD = Object.freeze({ width: 1.16, depth: 0.94, palletHeight: 0.18, boxWidth: 0.36, boxDepth: 0.425, boxHeight: 0.40, boxGap: 0.025, maxCases: 24 });

export function caseParts(cases, callback = (p) => p) {
  return Array.from({ length: Math.min(LOAD.maxCases, Math.max(1, Number(cases) || 1)) }, (_, index) => {
    const p = { x: ((index % 3) - 1) * (LOAD.boxWidth + LOAD.boxGap), z: (Math.floor(index / 3) % 2 ? 1 : -1) * (LOAD.boxDepth + LOAD.boxGap) / 2,
      y: LOAD.palletHeight + LOAD.boxHeight / 2 + Math.floor(index / 6) * (LOAD.boxHeight + 0.014), index };
    return callback(p);
  });
}

// A load keeps the same physical footprint in a rack, on a forklift and inside
// the trailer. Rotation and offsets follow the authoritative carrier heading.
export function carrierLoadPoint(carrier, offsetZ = 0, liftHeight = 0) {
  const heading = Number(carrier.heading) || 0;
  return { x: (Number(carrier.x) || 0) + Math.sin(heading) * offsetZ,
    y: (Number(carrier.y) || 0) + liftHeight,
    z: (Number(carrier.z) || 0) + Math.cos(heading) * offsetZ };
}

export function truckLoadPoint(truck, slot) {
  const heading = Number(truck.heading) || 0, cos = Math.cos(heading), sin = Math.sin(heading);
  return { x: (Number(truck.x) || 0) + (Number(slot.x) || 0) * cos + (Number(slot.z) || 0) * sin,
    y: (Number(truck.y) || 0) + (Number(slot.y) || 0),
    z: (Number(truck.z) || 0) + (Number(slot.z) || 0) * cos - (Number(slot.x) || 0) * sin };
}

export function stagingPoint(station, index = 0) {
  const slot = Math.max(0, index), stationId = station.id;
  if (stationId === 'RECEIVE') return { x: -42 + (slot % 3) * 2, y: 0.12, z: 17 + Math.floor(slot / 3) * 2.2 };
  if (stationId === 'PACK') return { x: 12 + (slot % 2 ? 1.05 : -1.05), y: 0.12, z: 20.4 + Math.floor(slot / 2) * 1.95 };
  if (/^DOCK-[12]$/.test(stationId)) return { x: (stationId === 'DOCK-1' ? 30 : 38) + (slot % 3) * 2, y: 0.12, z: 17 + Math.floor(slot / 3) * 1.75 };
  if (/^Q-(COLD|FROZEN)$/.test(stationId)) return { x: Number(station.x) + (slot % 2 ? 0.95 : -0.95), y: 0.55, z: 17.4 + Math.floor(slot / 2) * 1.75 };
  if (stationId === 'Q') return { x: -14 + (slot % 2 ? 0.95 : -0.95), y: 0.12, z: 23.4 + Math.floor(slot / 2) * 2 };
  return { x: Number(station.x) || 0, y: 1.15, z: Number(station.z) || 0 };
}
