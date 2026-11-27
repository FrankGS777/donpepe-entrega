"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server");
const { createSimulation } = require("../core/engine");
const { limaTimestamp, timeFields } = require("../core/time");
const { describeLocation } = require("../core/location-description");
const { enrichRecordPresentation } = require("../core/record-presentation");
const { validateTelemetry } = require("../core/autonomy-domain");

test("la fecha local conserva el mismo instante y cambia de día a medianoche de Lima", () => {
  for (const [utc, local] of [
    ["2026-10-27T04:59:59.999Z", "2026-10-26T23:59:59.999-05:00"],
    ["2026-10-27T05:00:00.000Z", "2026-10-27T00:00:00.000-05:00"],
  ]) {
    assert.equal(limaTimestamp(utc), local);
    assert.equal(Date.parse(local), Date.parse(utc));
    assert.equal(timeFields(utc).timeZone, "America/Lima");
  }
  assert.equal(limaTimestamp("invalid"), "");
});

test("la recepción acelerada conserva hora real sin rechazar lecturas frescas por usar segundos simulados", (t) => {
  const simulation = createSimulation({ realtimeClock: true });
  t.after(() => simulation.close());
  const operator = { id: "QA-LIMA-OPS", role: "operations" };
  const purchase = simulation.command(
    "purchase.create",
    { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] },
    operator,
  );
  let completed = false;
  for (let elapsed = 0; elapsed < 360; elapsed += 5) {
    simulation.advance(5);
    const current = simulation.snapshot(operator);
    assert.ok(
      !current.autonomy.exceptions.some(
        (row) => row.state === "OPEN" && row.code === "STALE_EVENT",
      ),
    );
    if (
      current.purchases.find((row) => row.id === purchase.id).state ===
      "RECEIVED"
    ) {
      completed = true;
      break;
    }
  }
  assert.ok(
    completed,
    "La compra debe recibirse con evidencia fresca, aunque el equipo se simule más rápido que el reloj real.",
  );
  const readings = simulation.snapshot(operator).autonomy.evidence;
  assert.ok(readings.length > 0);
  assert.ok(
    readings.every(
      (row) => Math.abs(Date.now() - Date.parse(row.observedAt)) < 30000,
    ),
  );
  const snapshot = simulation.snapshot(operator),
    reading = readings[0];
  const job = snapshot.autonomy.jobs.find((row) => row.id === reading.jobId);
  const load = snapshot.autonomy.notices
    .flatMap((row) => row.loads)
    .find((row) => row.id === reading.loadId);
  const asset = snapshot.catalog.assets.find(
    (row) => row.id === reading.assetId,
  );
  const old = {
    ...reading,
    observedAt: new Date(
      Date.parse(snapshot.clock.now) -
        (job.policy.eventTimeoutSeconds + 1) * 1000,
    ).toISOString(),
  };
  assert.ok(
    validateTelemetry(
      snapshot,
      job,
      load,
      old,
      asset,
      reading.checkpoint,
    ).includes("STALE_EVENT"),
    "Una lectura realmente vencida sigue rechazada con reloj real.",
  );
});

test("ubicaciones y movimientos tienen zona, pasillo, rack, nivel y posición legibles", (t) => {
  const simulation = createSimulation();
  t.after(() => simulation.close());
  const snapshot = enrichRecordPresentation(
    simulation.snapshot({ id: "qa", role: "operations" }),
  );
  const location = snapshot.layout.locations.find((row) => row.kind === "RACK");
  const description = describeLocation(snapshot, location.id);
  assert.match(description.label, /Centro de distribución/);
  assert.match(description.label, /Pasillo 01.*Rack 01.*Nivel 01.*Posición 01/);
  assert.equal(description.components.zone, "Reserva seca automática");
  assert.equal(location.description, description.label);
  const movement = simulation
    .movements({ id: "qa", role: "operations" })
    .items.find((row) => row.to.id === location.id);
  assert.equal(movement.to.label, description.label);
  assert.match(movement.atLocal, /-05:00$/);
});

test("tienda registra su solicitud con hora real, autor y ámbito; auditoría y CSV entregan Lima", async (t) => {
  const runtime = createApp({
    identityFile: ":memory:",
    simulationFile: ":memory:",
    startClock: false,
    realtimeClock: true,
  });
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    runtime.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function login(email) {
    const response = await fetch(`${base}/api/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "DonPepe2026!" }),
    });
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const me = await (
      await fetch(`${base}/api/me`, { headers: { cookie } })
    ).json();
    return {
      cookie,
      "content-type": "application/json",
      "x-csrf-token": me.csrf,
    };
  }
  const store = await login("tienda@donpepe.local");
  const response = await fetch(`${base}/api/commands`, {
    method: "POST",
    headers: store,
    body: JSON.stringify({
      type: "order.create",
      payload: {
        commandId: "lima-store-request",
        lines: [{ skuId: "SKU-ARROZ", cases: 2 }],
        notes: "Reposición documentada de la tienda",
      },
    }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  const order = body.state.orders.find((row) => row.id === body.result.id);
  assert.equal(order.createdByName, "Lucía · Tienda");
  assert.equal(body.state.storePolicy.maxLines, 12);
  assert.ok(Math.abs(Date.now() - Date.parse(order.createdAt)) < 5000);
  assert.equal(Date.parse(order.createdAtLocal), Date.parse(order.createdAt));
  assert.equal(
    Date.parse(body.state.clock.localNow),
    Date.parse(body.state.clock.now),
  );
  assert.deepEqual(
    body.state.catalog.branches.map((row) => row.id),
    ["TIENDA-1"],
  );
  assert.ok(body.state.events.every((row) => row.atLocal.endsWith("-05:00")));
  const forbidden = await fetch(`${base}/api/commands`, {
    method: "POST",
    headers: store,
    body: JSON.stringify({
      type: "order.create",
      payload: {
        branchId: "TIENDA-2",
        lines: [{ skuId: "SKU-ARROZ", cases: 1 }],
      },
    }),
  });
  assert.equal(forbidden.status, 403);
  const admin = await login("admin@donpepe.local");
  const audit = await (
    await fetch(`${base}/api/audit?action=COMMAND_EXECUTED`, { headers: admin })
  ).json();
  const entry = audit.events.find((row) => row.targetId === order.id);
  assert.equal(entry.details.actorRole, "store");
  assert.equal(entry.details.branchId, "TIENDA-1");
  assert.equal(entry.details.method, "POST");
  assert.equal(entry.details.requestPath, "/api/commands");
  assert.equal(entry.atLocal, limaTimestamp(entry.at));
  assert.equal(entry.details.timeZone, "America/Lima");
  const csv = await (
    await fetch(`${base}/api/inventory/movements/export.csv`, {
      headers: admin,
    })
  ).text();
  assert.match(csv, /Fecha y hora de Lima/);
  assert.match(csv, /-05:00/);
  assert.match(csv, /Pasillo 01/);
});
