"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { once } = require("node:events");
const { createApp } = require("../server");
const OPS = { id: "u-operations", role: "operations" },
  ADMIN = { id: "u-admin", role: "admin" };
test("supplier claim API persists report on mail failure, isolates store, retries once and audits decisions", async (t) => {
  let fail = true,
    messages = [];
  const runtime = createApp({
    identityFile: ":memory:",
    simulationFile: ":memory:",
    startClock: false,
    supplierMailTransport: {
      sendMail: async (msg) => {
        messages.push(msg);
        if (fail) {
          const e = Error("PRIVATE SMTP");
          e.code = "EAUTH";
          throw e;
        }
        return { accepted: [msg.to] };
      },
    },
  });
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((r) => server.close(r));
    runtime.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, data, session) {
    const r = await fetch(base + url, {
      method: data ? "POST" : "GET",
      headers: {
        ...(data ? { "content-type": "application/json" } : {}),
        ...(session
          ? { cookie: session.cookie, "x-csrf-token": session.csrf }
          : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return {
      status: r.status,
      body: await r.json(),
      cookie: r.headers.get("set-cookie")?.split(";")[0],
    };
  }
  async function login(email) {
    const l = await request("/api/login", { email, password: "DonPepe2026!" });
    assert.equal(l.status, 200);
    const me = await request("/api/me", null, { cookie: l.cookie });
    return { cookie: l.cookie, csrf: me.body.csrf };
  }
  const ops = await login("operaciones@donpepe.local"),
    admin = await login("admin@donpepe.local"),
    store = await login("tienda@donpepe.local");
  const s = runtime.simulation;
  s.command(
    "config.settings.update",
    {
      expectedRevision: s.snapshot(ADMIN).configuration.revision,
      settings: { packagingDamagePercent: 100 },
    },
    ADMIN,
  );
  const sku = s.snapshot(OPS).catalog.skus[0];
  s.command(
    "purchase.create",
    { supplierId: sku.supplierId, lines: [{ skuId: sku.id, cases: 8 }] },
    OPS,
  );
  let c;
  for (let i = 0; i < 100; i++) {
    s.advance(10);
    c = s
      .snapshot(OPS)
      .supplierClaims.candidates.find((c) => c.huState === "QUARANTINE");
    if (c) break;
  }
  assert.ok(c);
  const payload = { huId: c.huId, cases: c.cases, commandId: "http-claim-001" };
  const denied = await request(
    "/api/commands",
    { type: "supplierClaim.report", payload },
    admin,
  );
  assert.equal(denied.status, 403);
  const created = await request(
    "/api/commands",
    { type: "supplierClaim.report", payload },
    ops,
  );
  assert.equal(created.status, 200, JSON.stringify(created.body));
  let claim = created.body.state.supplierClaims.claims[0];
  assert.equal(claim.notification.status, "FAILED");
  assert.doesNotMatch(JSON.stringify(claim), /PRIVATE SMTP/);
  assert.equal(messages.length, 1);
  assert.equal(
    (
      await request(
        "/api/commands",
        { type: "supplierClaim.report", payload },
        ops,
      )
    ).status,
    200,
  );
  assert.equal(messages.length, 1);
  fail = false;
  const retry = await request(
    "/api/commands",
    {
      type: "supplierClaim.retry",
      payload: {
        id: claim.id,
        revision: claim.revision,
        commandId: "retry-001",
      },
    },
    ops,
  );
  assert.equal(retry.status, 200);
  claim = retry.body.state.supplierClaims.claims[0];
  assert.equal(claim.notification.status, "SENT");
  assert.equal(messages.length, 2);
  const a = await request("/api/state", null, admin),
    b = await request("/api/state", null, store);
  assert.equal(a.body.supplierClaims.claims.length, 1);
  assert.equal(a.body.hus.length, 0);
  assert.deepEqual(b.body.supplierClaims, { claims: [], candidates: [] });
  const audit = runtime.identity.db
    .prepare(
      "SELECT details FROM security_audit WHERE action='COMMAND_EXECUTED'",
    )
    .all();
  assert.ok(
    audit.some(
      (row) => JSON.parse(row.details).type === "supplierClaim.report",
    ),
  );
});
