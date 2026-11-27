"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createSimulation } = require("../core/engine");
const { AUTONOMY_ASSET_SCHEMAS } = require("../core/autonomy-config");
const ADMIN = { id: "A", role: "admin" }, OPS = { id: "O", role: "operations" }, STORE = { id: "S", role: "store", branchId: "TIENDA-1" };
// Preserve focused regression of the pre-existing mission/configuration engine.
// Production autonomy is tested separately without this fixture-only boundary.
function setup(t) { const sim = createSimulation({ academicLegacyFixture: true }); t.after(() => sim.close()); return sim; }
const view = sim => sim.snapshot(OPS);
const configure = (sim, id, settings, extra = {}) => sim.command("config.asset.configure", { id, settings, expectedRevision: view(sim).configuration.revision, ...extra }, ADMIN);
function until(sim, condition, max = 1600) { for (let i = 0; i < max; i++) { if (condition(view(sim))) return; sim.advance(1); } assert.fail("El equipo no alcanzó la condición esperada."); }

test("cada clase tiene parámetros operativos acotados y no recibe controles de PLC ni geometría", t => {
  const sim = setup(t), state = view(sim);
  assert.deepEqual(Object.keys(state.deviceSettingSchemas).sort(), ["AMR", "STACKER", "SHUTTLE", "FORKLIFT", "TRUCK", "CHARGER", ...Object.keys(AUTONOMY_ASSET_SCHEMAS)].sort());
  for (const type of Object.keys(AUTONOMY_ASSET_SCHEMAS)) assert.ok(state.deviceSettingSchemas[type].requiredInterlocks.length >= 2);
  assert.deepEqual(state.deviceSettingSchemas.CHARGER.fields.map(field => field.key), ["autoAssign", "priority"]);
  assert.ok(state.catalog.assets.every(asset => typeof asset.settings.autoAssign === "boolean"));
  assert.throws(() => configure(sim, "ASSET-AMR-1", { collisionAvoidance: false, maximumLoad: 99999, speedProfile: "TURBO", chargeBelowPercent: 100, resumeAtPercent: 20 }), error => ["collisionAvoidance", "maximumLoad", "speedProfile", "chargeBelowPercent", "resumeAtPercent"].every(key => error.fieldErrors[key]));
  assert.throws(() => configure(sim, "ASSET-CHARGE-1", { speedProfile: "ECO" }), error => !!error.fieldErrors.speedProfile);
});
test("configuración exige administración y revisión; permisos operativos no pueden suplantarla", t => {
  const sim = setup(t), revision = view(sim).configuration.revision;
  for (const actor of [OPS, STORE]) assert.throws(() => sim.command("config.asset.configure", { id: "ASSET-AMR-1", settings: { speedProfile: "ECO" }, expectedRevision: revision }, actor), { status: 403 });
  configure(sim, "ASSET-AMR-1", { speedProfile: "ECO" });
  assert.equal(view(sim).robots.find(robot => robot.id === "AMR-1").runtimeSettings.speedProfile, "ECO");
  assert.throws(() => configure(sim, "ASSET-AMR-2", { speedProfile: "ECO" }, { expectedRevision: revision }), { status: 409 });
  assert.throws(() => configure(sim, "ASSET-AMR-1", { speedProfile: "ECO" }), { status: 409 });
});
test("perfil Eco reduce el desplazamiento nominal del transelevador de manera real", t => {
  const normal = setup(t), eco = setup(t); configure(eco, "ASSET-STACKER-1", { speedProfile: "ECO" });
  for (const sim of [normal, eco]) { sim.command("order.release", { id: "PED-00001" }, OPS); sim.advance(2); }
  const a = view(normal).robots.find(robot => robot.id === "STACKER-1"), b = view(eco).robots.find(robot => robot.id === "STACKER-1");
  const origin = { x: -44, y: 0.8, z: -12 }; assert.ok(Math.hypot(a.x - origin.x, a.y - origin.y, a.z - origin.z) > Math.hypot(b.x - origin.x, b.y - origin.y, b.z - origin.z));
  assert.deepEqual(view(normal).layout.locations, view(eco).layout.locations);
});
test("un cambio con carga espera la entrega y la vuelta a la bahía antes de aplicarse", t => {
  const sim = setup(t); sim.command("order.release", { id: "PED-00001" }, OPS);
  until(sim, state => state.robots.some(robot => robot.type === "AMR" && robot.carryingHuId));
  const robot = view(sim).robots.find(robot => robot.type === "AMR" && robot.carryingHuId), cargo = robot.carryingHuId;
  configure(sim, `ASSET-${robot.id}`, { speedProfile: "ECO", autoAssign: false }, { commandId: "device-config-once" });
  let asset = view(sim).catalog.assets.find(asset => asset.deviceId === robot.id);
  assert.equal(asset.settings.speedProfile, "NORMAL"); assert.equal(asset.pendingSettings.settings.speedProfile, "ECO"); assert.equal(view(sim).robots.find(device => device.id === robot.id).carryingHuId, cargo);
  until(sim, state => !state.catalog.assets.find(asset => asset.deviceId === robot.id).pendingSettings, 500);
  const final = view(sim).robots.find(device => device.id === robot.id); asset = view(sim).catalog.assets.find(asset => asset.deviceId === robot.id);
  assert.equal(final.nodeId, final.parkingId); assert.equal(final.carryingHuId, null); assert.equal(asset.settings.autoAssign, false); assert.equal(final.runtimeSettings.speedProfile, "ECO");
  assert.equal(view(sim).metrics.warehouseCases, 360);
  const event = view(sim).events.findLast(event => event.type === "DEVICE_SETTINGS_APPLIED" && event.assetId === asset.id);
  assert.equal(event.before.speedProfile, "NORMAL"); assert.equal(event.after.speedProfile, "ECO"); assert.equal(event.correlationId, "device-config-once");
});
test("niveles de recarga y salida se aplican al cargador sin inventar batería", t => {
  const sim = setup(t); configure(sim, "ASSET-AMR-6", { chargeBelowPercent: 30, resumeAtPercent: 80 });
  until(sim, state => state.robots.find(robot => robot.id === "AMR-6").state === "CHARGING", 100);
  until(sim, state => state.robots.find(robot => robot.id === "AMR-6").state !== "CHARGING", 100);
  const robot = view(sim).robots.find(robot => robot.id === "AMR-6"); assert.ok(robot.battery >= 80 && robot.battery <= 82); assert.equal(robot.chargerId, null);
});
test("tareas permitidas limitan nuevas asignaciones y nunca eliminan la descarga de incidencias", t => {
  const sim = setup(t);
  assert.throws(() => configure(sim, "ASSET-FORKLIFT-1", { allowedTasks: ["TRUCK_LOAD"] }), error => !!error.fieldErrors.allowedTasks);
  assert.throws(() => configure(sim, "ASSET-AMR-1", { allowedTasks: ["PUTAWAY"] }), error => !!error.fieldErrors.allowedTasks);
  configure(sim, "ASSET-STACKER-1", { allowedTasks: ["PUTAWAY"] }); sim.command("order.release", { id: "PED-00001" }, OPS); sim.advance(5);
  assert.ok(view(sim).missions.some(mission => mission.requiredRobotId === "STACKER-1" && mission.state === "QUEUED"));
  assert.equal(view(sim).robots.find(robot => robot.id === "STACKER-1").missionId, null);
  configure(sim, "ASSET-STACKER-1", { allowedTasks: ["PUTAWAY", "PICK"] }); sim.advance(1); assert.ok(view(sim).robots.find(robot => robot.id === "STACKER-1").missionId);
});
test("prioridad de flota y trabajos del camión influyen realmente en el despacho", t => {
  const sim = setup(t); configure(sim, "ASSET-TRUCK-3", { priority: 100, speedProfile: "ECO" }); configure(sim, "ASSET-TRUCK-1", { allowedTasks: ["RETURN_PICKUP"] });
  sim.command("order.release", { id: "PED-00001" }, OPS); until(sim, state => state.orders[0].state === "READY");
  assert.throws(() => sim.command("order.dispatch", { id: "PED-00001", truckId: "TRUCK-1" }, OPS), { status: 409 });
  sim.command("order.dispatch", { id: "PED-00001" }, OPS); assert.equal(view(sim).orders[0].truckId, "TRUCK-3");
  until(sim, state => state.orders[0].state === "DISPATCHED"); const truck = view(sim).trucks.find(truck => truck.id === "TRUCK-3"); assert.equal(truck.trip.duration, 36 / 0.75);
});
test("deshabilitar trabajos nuevos conserva recarga y retorno; nunca se deshabilita el último cargador", t => {
  const sim = setup(t); configure(sim, "ASSET-AMR-6", { autoAssign: false });
  until(sim, state => state.robots.find(robot => robot.id === "AMR-6").state === "CHARGING", 100);
  assert.equal(view(sim).robots.find(robot => robot.id === "AMR-6").missionId, null);
  const other = setup(t); configure(other, "ASSET-CHARGE-1", { autoAssign: false }); configure(other, "ASSET-CHARGE-2", { autoAssign: false });
  assert.throws(() => configure(other, "ASSET-CHARGE-3", { autoAssign: false }), error => error.status === 409 && !!error.fieldErrors.autoAssign);
});
