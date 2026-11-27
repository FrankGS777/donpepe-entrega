"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createSimulation } = require("../core/engine");
const { limaDate, addLimaDays } = require("../core/time");

const OPERATIONS = { id: "OPS-TIME", role: "operations" };

test("los días hábiles y fechas límite se interpretan en la zona horaria de Lima", () => {
  const lateUtc = "2026-10-22T02:30:00.000Z";
  assert.equal(limaDate(lateUtc), "2026-10-21");
  assert.equal(addLimaDays(lateUtc, 90), "2027-01-19");
});

test("el servidor puede usar la hora real en operaciones sin perder el reloj determinista de pruebas", (t) => {
  const deterministic = createSimulation({ seed: false });
  t.after(() => deterministic.close());
  assert.equal(deterministic.snapshot(OPERATIONS).clock.now, "2026-10-17T13:00:00.000Z");

  const realtime = createSimulation({ realtimeClock: true });
  t.after(() => realtime.close());
  const startedAfter = Date.now();
  const opened = Date.parse(realtime.snapshot(OPERATIONS).clock.now);
  assert.ok(opened >= startedAfter - 1000 && opened <= Date.now() + 1000);

  const order = realtime.command(
    "order.create",
    { commandId: "real-lima-clock", lines: [{skuId:"SKU-ARROZ",cases:1}] },
    { id: "STORE-TIME", role: "store", branchId: "TIENDA-1" },
  );
  const snapshot = realtime.snapshot(OPERATIONS);
  const event = snapshot.events.find((row) => row.orderId === order.id);
  assert.ok(event);
  assert.ok(Math.abs(Date.now() - Date.parse(event.at)) < 5000);
  assert.equal(limaDate(event.at), limaDate(new Date()));
});
