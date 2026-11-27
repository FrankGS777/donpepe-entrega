const array = value => Array.isArray(value) ? value : [];
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = value => Math.max(0, Math.min(1, number(value)));

// Fast playback may contain several witnessed stages in a single response.
// Select the stage on the delayed presentation clock, not the latest stage.
export function automationSample(record, elapsed) {
  const history = array(record?.motionHistory);
  if (!history.length) return record;
  if (number(history[0].elapsed) > elapsed) return null;
  let selected = history[0];
  for (let index = 1; index < history.length; index++) {
    if (number(history[index].elapsed, Infinity) > elapsed) break;
    selected = history[index];
  }
  return selected;
}

// Bounded interpolation is time-based and cannot invent a completed sensor
// reading, move a held device or outrun the latest received simulation clock.
export function automationProgress(record, elapsed, latestElapsed = elapsed) {
  if (!record) return 0;
  const duration = Math.max(0.001, number(record.phaseDuration, 1));
  const observed = number(record.phaseElapsed, number(record.progress) * duration);
  if (record.blocked || record.paused || record.moving === false) return clamp(observed / duration);
  const anchor = number(record.elapsed, number(record.observedElapsed,
    number(record.phaseStartedElapsed, latestElapsed - observed) + observed));
  const extra = Math.max(0, Math.min(elapsed, latestElapsed) - anchor);
  return clamp((observed + extra) / duration);
}

// Arc-length sampling preserves the physical roller route, including bends.
// An optional result object avoids frame-loop allocations.
export function automationPosition(record, progress, output = { x: 0, y: 0, z: 0 }) {
  const path = array(record?.phasePath).length > 1 ? record.phasePath
    : record?.from && record?.to ? [record.from, record.to] : null;
  if (!path) {
    const p = record?.position || record?.to || record?.from || {};
    output.x = number(p.x); output.y = number(p.y); output.z = number(p.z); return output;
  }
  let total = 0;
  for (let index = 1; index < path.length; index++) total += Math.hypot(path[index].x - path[index - 1].x,
    number(path[index].y) - number(path[index - 1].y), path[index].z - path[index - 1].z);
  let remaining = total * clamp(progress);
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index], length = Math.hypot(b.x - a.x, number(b.y) - number(a.y), b.z - a.z);
    if (remaining <= length || index === path.length - 1) {
      const t = length ? Math.min(1, remaining / length) : 1;
      output.x = a.x + (b.x - a.x) * t; output.y = number(a.y) + (number(b.y) - number(a.y)) * t;
      output.z = a.z + (b.z - a.z) * t; return output;
    }
    remaining -= length;
  }
  return output;
}

// The logical RECEIVE node denotes a station, not every physical waiting bay.
// Its internal distributor uses clear lanes between the marked buffer rows.
// This describes a route only; the caller supplies a witnessed process phase.
export function receivingBufferPath(handoff, pad, reverse = false) {
  const clear = { x: handoff.x, y: number(pad.y, .18), z: handoff.z + 2.6 };
  const aisle = { x: number(handoff.aisleX, -36), y: clear.y, z: clear.z };
  const rowLane = { x: aisle.x, y: aisle.y, z: pad.z + 1.1 };
  const behind = { x: pad.x, y: aisle.y, z: rowLane.z };
  const path = [{ x: handoff.x, y: number(handoff.y, .18), z: handoff.z }, clear, aisle, rowLane, behind, { ...pad }];
  return reverse ? path.reverse() : path;
}

export function packingBufferPath(robot, pad, reverse = false) {
  const side = pad.x < 12 ? 9.35 : 14.65;
  const path = [{ ...robot }, { x: side, y: number(robot.y, .95), z: robot.z },
    { x: side, y: number(robot.y, .95), z: pad.z }, { ...pad }];
  return reverse ? path.reverse() : path;
}

const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const copy = value => ({ x: number(value?.x), y: number(value?.y), z: number(value?.z) });
const between = (a, b, value) => ({ x: a.x + (b.x - a.x) * value, y: a.y + (b.y - a.y) * value, z: a.z + (b.z - a.z) * value });

// The carriage moves on the clear station lanes. Vertical movement occurs
// before its telescopic forks cross the parked AMR, never over its chassis.
// These are poses inside a witnessed handoff, not a new inventory operation.
export function bufferMechanismPose({ stationId = 'RECEIVE', robot, pad, unloading = false }, progress) {
  const p = clamp(progress), target = copy(robot), bay = copy(pad);
  const base = { x: stationId === 'RECEIVE' ? target.x - 2 : bay.x < target.x ? target.x - 2.65 : target.x + 2.65,
    y: Math.max(bay.y, .18) + .055, z: target.z + (stationId === 'RECEIVE' ? 2.6 : 0) };
  const forkVector = { x: target.x - base.x, z: target.z - base.z }, forkLength = Math.hypot(forkVector.x, forkVector.z);
  const forkHeading = -Math.atan2(forkVector.z, forkVector.x);
  const travelBay = { ...bay, y: base.y }, dock = { ...base, y: target.y + (unloading ? .035 : 0) };
  const route = stationId === 'RECEIVE'
    ? receivingBufferPath({ ...target, y: base.y }, travelBay, true).slice(0, -2)
    : [{ ...travelBay }, { x: base.x, y: base.y, z: bay.z }, { ...base }];
  let cargo, carrier, phase, surfaceY, extension = 0, carrying = true;
  if (!unloading) {
    if (p < .08) {
      phase = 'PICKUP'; cargo = between(bay, travelBay, smooth(p / .08)); carrier = { ...bay };
    } else if (p < .72) {
      phase = 'TRANSFER'; cargo = automationPosition({ phasePath: route }, smooth((p - .08) / .64)); carrier = { ...cargo };
    } else if (p < .82) {
      phase = 'LIFT'; cargo = between(base, { ...base, y: target.y }, smooth((p - .72) / .1)); carrier = { ...base };
    } else if (p < .92) {
      phase = 'EXTEND'; cargo = between({ ...base, y: target.y }, target, smooth((p - .82) / .1)); carrier = { ...base };
      extension = Math.hypot(cargo.x - base.x, cargo.z - base.z);
    } else {
      phase = p < .95 ? 'SEATED' : 'RETRACT'; cargo = { ...target }; carrier = { ...base };
      carrying = false;
      extension = forkLength * (p < .95 ? 1 : 1 - smooth((p - .95) / .05));
    }
    surfaceY = carrying ? cargo.y : target.y - .025 * smooth((p - .92) / .03);
  } else {
    if (p < .1) {
      phase = 'EXTEND'; cargo = { ...target }; carrier = { ...base };
      extension = forkLength * smooth(p / .1); surfaceY = target.y - .035; carrying = false;
    } else if (p < .16) {
      phase = 'PICKUP'; carrier = { ...base }; extension = forkLength;
      if (p < .13) { cargo = { ...target }; surfaceY = target.y - .035 * (1 - smooth((p - .1) / .03)); carrying = false; }
      else { cargo = between(target, { ...target, y: dock.y }, smooth((p - .13) / .03)); surfaceY = cargo.y; }
    } else if (p < .28) {
      phase = 'RETRACT'; cargo = between({ ...target, y: dock.y }, dock, smooth((p - .16) / .12)); carrier = { ...base };
      extension = Math.hypot(cargo.x - base.x, cargo.z - base.z); surfaceY = cargo.y;
    } else if (p < .38) {
      phase = 'LOWER'; cargo = between(dock, base, smooth((p - .28) / .1)); carrier = { ...base }; surfaceY = cargo.y;
    } else if (p < .9) {
      phase = 'TRANSFER'; cargo = automationPosition({ phasePath: route.slice().reverse() }, smooth((p - .38) / .52)); carrier = { ...cargo }; surfaceY = cargo.y;
    } else if (p < .96) {
      phase = 'DEPOSIT'; cargo = between(travelBay, bay, smooth((p - .9) / .06)); carrier = { ...bay }; surfaceY = cargo.y;
    } else {
      phase = 'SEATED'; cargo = { ...bay }; carrier = { ...bay }; surfaceY = bay.y - .025 * smooth((p - .96) / .04); carrying = false;
    }
  }
  return { cargo: { ...cargo, heading: 0 }, carrier: { x: carrier.x, y: 0, z: carrier.z, heading: forkHeading }, phase, carrying,
    surfaceY, liftHeight: Math.max(0, surfaceY - .12), extension, supportY: carrying ? surfaceY : unloading && p >= .96 ? bay.y : target.y,
    supportKind: carrying ? Math.abs(extension) > .01 ? 'TELESCOPIC_FORKS' : 'LIFT_CARRIAGE' : unloading && p >= .96 ? 'BUFFER_PAD' : 'AMR_DECK' };
}

// A turntable at the conveyor exit aligns the pallet before the guided
// distributor takes it through the clear buffer lanes. Its deck remains under
// the entire footprint, including at the two previously unsupported turns.
export function receivingMechanismPose(path, pad, progress) {
  const p = clamp(progress), terminal = copy(array(path).at(-1));
  let cargo, carrier = { x: terminal.x, y: 0, z: terminal.z }, phase, surfaceY = terminal.y, carrying = false;
  let heading = Math.PI / 2;
  if (p < .48) {
    phase = 'CONVEYOR'; cargo = automationPosition({ phasePath: path }, p / .48);
  } else if (p < .55) {
    phase = 'ALIGN'; cargo = { ...terminal }; heading *= 1 - smooth((p - .48) / .07); carrying = true;
  } else if (p < .95) {
    phase = 'TRANSFER'; cargo = automationPosition({ phasePath: receivingBufferPath(terminal, pad) }, smooth((p - .55) / .4));
    carrier = { x: cargo.x, y: 0, z: cargo.z }; surfaceY = cargo.y; carrying = true; heading = 0;
  } else {
    phase = 'SEATED'; cargo = copy(pad); carrier = { x: cargo.x, y: 0, z: cargo.z }; surfaceY = cargo.y - .025; heading = 0;
  }
  return { cargo: { ...cargo, heading }, carrier, phase, carrying, surfaceY, extension: 0,
    liftHeight: Math.max(0, surfaceY - .12), supportY: phase === 'CONVEYOR' ? cargo.y : carrying ? surfaceY : cargo.y,
    supportKind: phase === 'CONVEYOR' ? 'ROLLER_DECK' : carrying ? 'LIFT_CARRIAGE' : 'BUFFER_PAD' };
}

// A complete receipt reserves its final identification interval for seated
// loads and closing the doors. No box is still crossing when the truck leaves.
export function storeReceiptCycle(duration, progress, count, identifySeconds = 3, doorSeconds = 1.2) {
  const elapsed = clamp(progress) * Math.max(1, duration);
  const perLoad = Math.max(.1, duration - doorSeconds - Math.max(doorSeconds, identifySeconds)) / Math.max(1, count);
  return { doorProgress: Math.min(smooth(elapsed / doorSeconds), smooth((duration - elapsed) / doorSeconds)),
    loads: Array.from({ length: count }, (_, index) => clamp((elapsed - doorSeconds - index * perLoad) / perLoad)) };
}

export function storeMechanismPose(bridgePath, buffer, sideAisle, progress) {
  const p = clamp(progress), terminal = copy(array(bridgePath).at(-1)), bay = copy(buffer);
  let cargo, carrier = { x: terminal.x, y: 0, z: terminal.z }, phase, carrying = false, surfaceY = terminal.y;
  if (p < .46) {
    phase = 'CONVEYOR'; cargo = automationPosition({ phasePath: bridgePath }, p / .46);
  } else if (p < .58) {
    phase = 'LOWER'; cargo = between(terminal, { ...terminal, y: bay.y + .055 }, smooth((p - .46) / .12));
    surfaceY = cargo.y; carrying = true;
  } else if (p < .92) {
    phase = 'TRANSFER';
    cargo = automationPosition({ phasePath: [{ ...terminal, y: bay.y + .055 },
      { x: sideAisle, y: bay.y + .055, z: terminal.z }, { x: sideAisle, y: bay.y + .055, z: bay.z }, { ...bay, y: bay.y + .055 }] },
    smooth((p - .58) / .34));
    carrier = { x: cargo.x, y: 0, z: cargo.z }; surfaceY = cargo.y; carrying = true;
  } else if (p < .97) {
    phase = 'DEPOSIT'; cargo = between({ ...bay, y: bay.y + .055 }, bay, smooth((p - .92) / .05));
    carrier = { x: bay.x, y: 0, z: bay.z }; surfaceY = cargo.y; carrying = true;
  } else {
    phase = 'SEATED'; cargo = { ...bay }; carrier = { x: bay.x, y: 0, z: bay.z }; surfaceY = bay.y - .025;
  }
  return { cargo: { ...cargo, heading: Math.PI / 2 }, carrier, phase, carrying, surfaceY, extension: 0,
    liftHeight: Math.max(0, surfaceY - .12), supportY: phase === 'CONVEYOR' ? cargo.y : carrying ? surfaceY : cargo.y,
    supportKind: phase === 'CONVEYOR' ? 'ROLLER_DECK' : carrying ? 'LIFT_CARRIAGE' : 'BUFFER_PAD' };
}

// Merge overlapping straight guides so the station does not draw coincident
// rails for every waiting position (which causes flicker and wasted geometry).
export function mechanicalGuideSegments(paths) {
  const lines = new Map();
  for (const path of array(paths)) for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], alongX = Math.abs(b.x - a.x) > .001;
    if (alongX && Math.abs(b.z - a.z) > .001 || !alongX && Math.abs(b.z - a.z) < .001) continue;
    const fixed = alongX ? a.z : a.x, key = `${alongX ? 'x' : 'z'}:${fixed.toFixed(4)}`;
    if (!lines.has(key)) lines.set(key, { axis: alongX ? 'x' : 'z', fixed, intervals: [] });
    lines.get(key).intervals.push([Math.min(alongX ? a.x : a.z, alongX ? b.x : b.z), Math.max(alongX ? a.x : a.z, alongX ? b.x : b.z)]);
  }
  const result = [];
  for (const { axis, fixed, intervals } of lines.values()) {
    const merged = [];
    for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
      const previous = merged.at(-1);
      if (previous && interval[0] <= previous[1] + .001) previous[1] = Math.max(previous[1], interval[1]);
      else merged.push(interval.slice());
    }
    for (const [from, to] of merged) result.push({ axis, fixed, from, to });
  }
  return result;
}

// A complete pallet can be checked and relabelled in place when all four
// preparation bays are occupied. Partial orders still require a separate bay.
export function packingDestinationSlot(occupied, sourceIndex, sourceCases, requestedCases, capacity = 4) {
  let index = 0;
  while (occupied.has(index) && index < capacity) index++;
  if (index < capacity) return { index, reusePallet: false };
  if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < capacity &&
    number(requestedCases) > 0 && number(requestedCases) === number(sourceCases))
    return { index: sourceIndex, reusePallet: true };
  return null;
}

// Forks enter the rear pallet, lift clear, carry horizontally and lower onto
// the first roller deck. Coordinates are pallet undersides, not box centers.
export function inboundForkPose(from, to, progress) {
  const p=clamp(progress), lift=Math.max(from.y,to.y)+.08;
  let cargo;
  if(p<.18) cargo=between(from,{...from,y:lift},smooth(p/.18));
  else if(p<.82) cargo=between({...from,y:lift},{...to,y:lift},smooth((p-.18)/.64));
  else cargo=between({...to,y:lift},to,smooth((p-.82)/.18));
  const heading=Math.PI-(Math.PI/2)*smooth(clamp((p-.3)/.4));
  return {cargo,carrier:{x:cargo.x-Math.cos(heading)*1.65,y:0,z:cargo.z+Math.sin(heading)*1.65,heading},surfaceY:cargo.y,carrying:p<.97,phase:p<.18?'LIFT':p<.82?'CARRY':'DEPOSIT'};
}
