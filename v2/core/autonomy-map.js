"use strict";
const { automaticEquipmentStatus } = require("./autonomy-config");
const { damagedCaseCount } = require("./packaging-quality");
const { createAutomationBlueprint, INBOUND_STAGE_ASSET } = require("./automation-blueprint");
const { INBOUND_STAGE_MIN_SECONDS, INBOUND_TRANSFER_MIN_SECONDS, STORE_UNLOAD_MIN_SECONDS } = require("./mechanical-timing");

const CLOSED = new Set(["COMPLETED", "CANCELLED"]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const point = (p) => ({ x: p.x, y: p.y || 0, z: p.z });
const elapsedAt = (s, date) => s.clock.elapsed - Math.max(0, (Date.parse(s.clock.now) - Date.parse(date)) / 1000 || 0);

function stageDuration(s, job, stage = job.state) {
  const asset = s.catalog.assets.find((row) => row.id === INBOUND_STAGE_ASSET[stage]);
  const inboundMinimum = job.mechanicalTimingVersion >= 2 ? INBOUND_STAGE_MIN_SECONDS[stage] || 0 : 0;
  if (stage === "UNLOADING") return Math.max(asset?.settings?.cycleSeconds || 0, job.policy.unloadSeconds, inboundMinimum);
  if (stage === "IDENTIFYING") return Math.max(job.policy.identifySeconds, inboundMinimum);
  if (stage === "INSPECTING") return Math.max(asset?.settings?.inspectionSeconds || 0, job.policy.inspectionSeconds, inboundMinimum);
  if (stage === "RECEIVING") return Math.max(asset?.settings?.transferSeconds || 0, job.policy.conveyorSeconds,
    job.mechanicalTimingVersion >= 3 ? INBOUND_TRANSFER_MIN_SECONDS : job.mechanicalTimingVersion >= 1 ? 75 : 0);
  if (stage === "DESTINATION_RECEIVING") {
    const order = s.orders.find((row) => row.id === job.documentId);
    const station = s.catalog.assets.find((row) => row.id === `ASSET-STORE-RECEIVING-${job.branchId}`);
    return Math.max(station?.settings?.unloadSeconds || 0, job.policy.storeUnloadSeconds,
      job.storeHandlingVersion >= 1 ? STORE_UNLOAD_MIN_SECONDS : 0) * Math.max(1, order?.allocations.length || 0) + job.policy.storeIdentifySeconds;
  }
  return 0;
}

function samplePath(path, progress) {
  if (!path.length) return null;
  const lengths = path.slice(1).map((p, i) => Math.hypot(p.x - path[i].x, (p.y || 0) - (path[i].y || 0), p.z - path[i].z));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * clamp(progress, 0, 1);
  for (const [index, length] of lengths.entries()) {
    if (remaining <= length || index === lengths.length - 1) {
      const from = point(path[index]), to = point(path[index + 1]), t = length ? clamp(remaining / length, 0, 1) : 1;
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t };
    }
    remaining -= length;
  }
  return point(path.at(-1));
}

function jobPhase(s, job) {
  const retained = job.state === "EXCEPTION";
  const stage = retained ? job.blockedState || job.blockedStage || job.state : job.state;
  const phaseElapsed = Math.max(0, retained ? job.blockedStageElapsed || 0 : job.stageElapsed || 0);
  const phaseDuration = stageDuration(s, job, stage);
  const assetId = INBOUND_STAGE_ASSET[stage] || (stage === "DESTINATION_RECEIVING" ? `ASSET-STORE-RECEIVING-${job.branchId}` : null);
  const ready = assetId ? automaticEquipmentStatus(s, assetId, { processId: job.id }).ready : false;
  const owner = s.autonomyDevices.find((device) => device.processId === job.id && `ASSET-${device.id}` === assetId);
  const blocked = retained || Boolean(job.waitingReason) || Boolean(assetId && !ready);
  const moving = !s.clock.paused && !blocked && Boolean(owner) && phaseDuration > 0 && phaseElapsed < phaseDuration;
  return { id: job.id, jobId: job.id, documentId: job.documentId, kind: job.kind, branchId: job.branchId || null,
    state: job.state, stage, assetId, phaseElapsed, phaseDuration,
    phaseStartedElapsed: s.clock.elapsed - phaseElapsed,
    phaseEnteredAt: job.updatedAt,
    progress: phaseDuration ? clamp(phaseElapsed / phaseDuration, 0, 1) : 0,
    moving, blocked, paused: s.clock.paused, waitingReason: job.waitingReason || null,
    revision: job.revision, loadIndex: job.loadIndex || 0, noticeId: job.noticeId || null };
}

/** Read-only presentation contract. Pre-receipt ASN loads are not inventory HUs.
 * The renderer may interpolate a witnessed phase but may never create receipts,
 * move the simulation clock, resolve an interlock or transfer stock ownership. */
function autonomyMapFrame(s) {
  const layout = s.layout.automation || createAutomationBlueprint(s.layout);
  const recentJobs = s.autonomy.jobs.filter((job) => !CLOSED.has(job.state) || elapsedAt(s, job.updatedAt) >= s.clock.elapsed - 120);
  const jobs = recentJobs.map((job) => jobPhase(s, job));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const loads = [];
  for (const job of recentJobs.filter((row) => row.kind === "PURCHASE")) {
    const notice = s.autonomy.notices.find((row) => row.id === job.noticeId);
    if (!notice) continue;
    const visual = jobsById.get(job.id);
    for (const [index, load] of notice.loads.entries()) {
      const current = index === job.loadIndex;
      const received = load.state === "RECEIVED";
      const phasePaths = job.mechanicalTimingVersion >= 1 ? layout.mechanicalPhasePaths || layout.phasePaths : layout.phasePaths;
      const path = current && phasePaths[visual.stage]
        ? phasePaths[visual.stage].map(point) : [point(layout.supplierDock.rearPoint)];
      const progress = current ? visual.progress : 0;
      const visible = current && !(job.handlingVersion >= 2 && s.clock.elapsed - job.arrivalStartedElapsed < job.arrivalDuration) && !received && !CLOSED.has(job.state) && !["WAITING_ARRIVAL", "PUTAWAY"].includes(visual.stage) &&
        (visual.stage !== "WAITING_DOCK" || job.inboundDockAcquiredAt != null);
      loads.push({ id: load.id, jobId: job.id, documentId: job.documentId, noticeId: notice.id,
        kind: "INBOUND_LOGISTIC_LOAD", supplierId: notice.supplierId, skuId: load.skuId, sscc: load.sscc,
        lot: load.lot, expiry: load.expiry, cases: load.cases, status: load.state,
        stage: visual.stage, assetId: visual.assetId, phaseElapsed: visual.phaseElapsed, phaseDuration: visual.phaseDuration,
        phaseStartedElapsed: visual.phaseStartedElapsed, phasePath: path, from: path[0], to: path.at(-1),
        position: samplePath(path, progress), progress, moving: visible && visual.moving, blocked: visual.blocked,
        paused: s.clock.paused, visible, current, received, huIds: [...(load.huIds || [])],
        packagingDefect: load.packagingDefect || null, damagedCases: damagedCaseCount(load),
        ...(load.damagedCaseIndexes && { damagedCaseIndexes: [...load.damagedCaseIndexes] }),
        qualityHeld: Boolean(load.qualityHeld), inventoryRecognized: received, profile: structuredClone(load.profile || null) });
    }
  }
  const devices = layout.stations.map((station) => {
    const device = s.autonomyDevices.find((row) => row.id === station.deviceId);
    const job = jobsById.get(device?.processId);
    const availability = automaticEquipmentStatus(s, station.assetId, { processId: device?.processId });
    const result = { assetId: station.assetId, deviceId: station.deviceId, type: station.type, branchId: station.branchId || null,
      state: device?.state || "UNREGISTERED", online: device?.online === true, ready: availability.ready,
      safetyState: device?.safetyState || "UNKNOWN", reason: availability.reason,
      processId: device?.processId || null, carryingHuId: device?.carryingHuId || null,
      stage: job?.stage || "IDLE", phaseElapsed: job?.phaseElapsed || 0, phaseDuration: job?.phaseDuration || 0,
      phaseStartedElapsed: job?.phaseStartedElapsed ?? s.clock.elapsed, progress: job?.progress || 0,
      moving: Boolean(job?.assetId === station.assetId && job.moving),
      blocked: Boolean(job?.blocked || !availability.ready), paused: s.clock.paused,
      handoffPoint: station.handoffPoint ? point(station.handoffPoint) : null,
      position: point(station), loadIds: loads.filter((load) => load.current && load.assetId === station.assetId && load.jobId === device?.processId).map((load) => load.id),
      observedElapsed: s.clock.elapsed };
    if (station.type === "CASE_PICKING_CELL" && device?.carryingHuId) {
      const hu = s.hus.find((row) => row.id === device.carryingHuId);
      if (hu?.casePickingStartedAt) {
        const phaseDuration = Math.max(0, hu.casePickingDuration || (hu.packReadyAt - elapsedAt(s, hu.casePickingStartedAt)));
        const start = hu.casePickingStartedElapsed ?? elapsedAt(s, hu.casePickingStartedAt);
        const end = hu.casePickingHeldAt ?? (job?.state === "EXCEPTION" ? elapsedAt(s, job.phaseEnteredAt) : s.clock.elapsed);
        const phaseElapsed = clamp(end - start, 0, phaseDuration);
        Object.assign(result, { stage: "CASE_PICKING", phaseDuration, phaseElapsed, phaseStartedElapsed: s.clock.elapsed - phaseElapsed,
          progress: phaseDuration ? phaseElapsed / phaseDuration : 0, blocked: Boolean(result.blocked || hu.packingBlockedReason),
          moving: !s.clock.paused && !result.blocked && !hu.packingBlockedReason && phaseElapsed < phaseDuration,
          cases: hu.packContext?.cases || hu.cases, skuId: hu.skuId, lot: hu.lot });
      }
    }
    if (station.type === "STORE_RECEIVING_STATION" && job) {
      const order = s.orders.find((row) => row.id === job.documentId);
      result.truckId = order?.truckId || null;
      result.storeIdentifySeconds = s.autonomy.jobs.find(row => row.id === job.id)?.policy.storeIdentifySeconds ?? 3;
      result.transferPath = station.transferPath.map(point);
      result.huIds = (order?.allocations || []).map((row) => row.huId);
    }
    return result;
  });
  const dockOwner = s.autonomy.jobs.find((job) => job.kind === "PURCHASE" && !CLOSED.has(job.state) &&
    ((job.inboundDockAcquiredAt != null && job.inboundDockReleasedAt == null) ||
      (job.inboundDockAcquiredAt == null && Boolean(INBOUND_STAGE_ASSET[job.state === "EXCEPTION" ? job.blockedState : job.state]))));
  const bufferTransfers = s.missions.filter((mission) => (mission.sourceId === "RECEIVE" || mission.sourceId === "PACK" || mission.destinationId === "PACK") && mission.robotId &&
    (mission.state === "ACTIVE" || (mission.completedAt && elapsedAt(s, mission.completedAt) >= s.clock.elapsed - 120)))
    .map((mission) => {
      const robot = s.robots.find((row) => row.id === mission.robotId);
      const inbound = mission.destinationId === "PACK";
      const transferring = mission.state === "ACTIVE" && mission.phase === (inbound ? "UNLOADING" : "LOADING");
      const completed = inbound ? Boolean(mission.completedAt) : !["WAITING", "TO_SOURCE", "LOADING"].includes(mission.phase);
      // A legacy handoff already in progress keeps its original two-second
      // timer; new missions carry the explicit witnessed mechanical duration.
      const phaseDuration = mission.transferDuration || 2;
      const phaseElapsed = transferring ? clamp(phaseDuration - (mission.timer ?? phaseDuration), 0, phaseDuration) : completed ? phaseDuration : 0;
      const bufferFull = inbound && s.hus.filter((hu) => hu.locationId === "PACK" && hu.cases > 0).length >= 4;
      const blocked = !robot || ["FAULT", "MAINTENANCE"].includes(robot.state) || (transferring && bufferFull);
      const pose = robot ? { x: robot.x, y: robot.cargoHeight ?? 0.95, z: robot.z } : null;
      return { id: mission.id, missionId: mission.id, huId: mission.huId, robotId: mission.robotId,
        stage: inbound ? "HANDOFF_FROM_AMR" : "HANDOFF_TO_AMR", missionPhase: mission.phase, state: mission.state,
        phaseDuration, phaseElapsed, phaseStartedElapsed: s.clock.elapsed - phaseElapsed,
        progress: phaseElapsed / phaseDuration, visible: transferring, moving: transferring && !blocked && !s.clock.paused,
        blocked, paused: s.clock.paused,
        fromStationId: inbound ? null : mission.sourceId, toStationId: inbound ? "PACK" : null,
        fromRobotId: inbound ? mission.robotId : null, toRobotId: inbound ? null : mission.robotId,
        position: pose, from: inbound ? pose : null, to: inbound ? null : pose };
    });
  return { version: 1, mode: "SIMULATED", clockElapsed: s.clock.elapsed, observedAt: s.clock.now,
    paused: s.clock.paused, speed: s.clock.speed, jobs, loads, devices, bufferTransfers,
    supplierDock: { id: layout.supplierDock.id, jobId: dockOwner?.id || null, documentId: dockOwner?.documentId || null,
      supplierId: dockOwner ? s.purchases.find((row) => row.id === dockOwner.documentId)?.supplierId || null : null,
      arrivalProgress: dockOwner?.handlingVersion >= 2 ? clamp((s.clock.elapsed - dockOwner.arrivalStartedElapsed) / dockOwner.arrivalDuration, 0, 1) : 1,
      departureProgress: dockOwner?.departureStartedElapsed != null ? clamp((s.clock.elapsed - dockOwner.departureStartedElapsed) / 5, 0, 1) : 0,
      approach: structuredClone(layout.supplierDock.approach),
      occupied: Boolean(dockOwner), blocked: dockOwner?.state === "EXCEPTION", pose: structuredClone(layout.supplierDock.truckPose),
      queue: s.autonomy.jobs.filter((job) => job.kind === "PURCHASE" && job.state === "WAITING_DOCK" && job.id !== dockOwner?.id).map((job) => job.id) },
  };
}

module.exports = { autonomyMapFrame, stageDuration, samplePath };
