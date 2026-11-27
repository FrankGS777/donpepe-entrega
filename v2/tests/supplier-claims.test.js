"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { createSimulation } = require("../core/engine");
const {
  createSupplierClaimsMail,
} = require("../security/supplier-claims-mail");
const { mkdtempSync, rmSync } = require("node:fs"),
  { join } = require("node:path"),
  { tmpdir } = require("node:os");
const OPS = { id: "ops", role: "operations" },
  ADMIN = { id: "admin", role: "admin" },
  STORE = { id: "store", role: "store", branchId: "TIENDA-1" };
const view = (s) => s.snapshot(OPS),
  claim = (s, id) => view(s).supplierClaims.claims.find((c) => c.id === id);
function action(s, type, id, p = {}, actor = OPS) {
  return s.command(
    `supplierClaim.${type}`,
    { id, revision: claim(s, id).revision, ...p },
    actor,
  );
}
function damaged(s, skuId = "SKU-ARROZ", cases = 8) {
  s.command(
    "config.settings.update",
    {
      settings: { packagingDamagePercent: 100 },
      expectedRevision: s.snapshot(ADMIN).configuration.revision,
    },
    ADMIN,
  );
  const sku = view(s).catalog.skus.find((k) => k.id === skuId),
    purchase = s.command(
      "purchase.create",
      { supplierId: sku.supplierId, lines: [{ skuId, cases }] },
      OPS,
    );
  for (let i = 0; i < 100; i++) {
    s.advance(10);
    const c = view(s).supplierClaims.candidates.find(
      (c) => c.purchaseId === purchase.id && c.huState === "QUARANTINE",
    );
    if (c) return c;
  }
  throw Error("La recepción dañada no terminó en cuarentena");
}
function fixture(t) {
  const s = createSimulation();
  t.after(() => s.close());
  return s;
}
function report(s, c) {
  return s.command(
    "supplierClaim.report",
    { huId: c.huId, cases: c.cases },
    OPS,
  ).id;
}
test("damaged subset is reported once, with immutable evidence and store/admin separation", (t) => {
  const s = fixture(t),
    c = damaged(s),
    before = view(s),
    id = report(s, c),
    r = claim(s, id);
  assert.ok(c.cases > 0 && c.cases < 8);
  assert.equal(r.cases, c.cases);
  assert.equal(r.defectLabel, "Bolsa o envoltura rasgada");
  assert.equal(r.notification.status, "QUEUED");
  assert.equal(view(s).metrics.warehouseCases, before.metrics.warehouseCases);
  assert.deepEqual(s.snapshot(STORE).supplierClaims, {
    claims: [],
    candidates: [],
  });
  assert.throws(() => report(s, c), { status: 409 });
  assert.throws(
    () => s.command("supplierClaim.report", { huId: c.huId, cases: 8 }, ADMIN),
    { status: 403 },
  );
  assert.throws(
    () =>
      s.command(
        "supplierClaim.report",
        { huId: before.hus.find((h) => h.state === "STORED").id, cases: 12 },
        OPS,
      ),
    { status: 409 },
  );
  assert.throws(
    () =>
      s.command(
        "supplierClaim.respond",
        { id, revision: 0, decision: "RETURN", reference: "CORREO-01" },
        OPS,
      ),
    { status: 409 },
  );
  assert.throws(() =>
    s.command("inventory.releaseQuarantine", { huId: c.huId, id: c.huId }, OPS),
  );
  assert.throws(
    () =>
      s.command(
        "incident.resolve",
        {
          id: `HOLD:${c.huId}`,
          resolution: "WRITE_OFF",
          note: "Baja sin reclamar al proveedor",
        },
        OPS,
      ),
    { status: 409 },
  );
});
test("authorized return uses an actual AMR mission then documented collection, with exact stock conservation", (t) => {
  const s = fixture(t),
    c = damaged(s),
    id = report(s, c),
    before = view(s),
    invoice = JSON.stringify(before.finance.bills[0].lines);
  assert.throws(() => action(s, "prepareReturn", id), { status: 409 });
  action(s, "respond", id, { decision: "RETURN", reference: "AUT-DEV-01" });
  action(s, "prepareReturn", id);
  assert.throws(
    () =>
      action(s, "handover", id, {
        reference: "GUIA-DEV-01",
        party: "Transportes del proveedor",
        confirm: true,
      }),
    { status: 409 },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    s.advance(10);
    if (claim(s, id).huState === "SUPPLIER_RETURN_READY") {
      ready = true;
      break;
    }
  }
  assert.ok(ready, "El AMR debe completar físicamente la devolución");
  assert.ok(
    view(s).missions.some(
      (m) => m.kind === "SUPPLIER_RETURN" && m.state === "COMPLETED",
    ),
  );
  action(s, "handover", id, {
    reference: "GUIA-DEV-01",
    party: "Transportes del proveedor",
    confirm: true,
  });
  const after = view(s);
  assert.equal(after.ledger.supplierReturnedCases, c.cases);
  assert.equal(after.ledger.writtenOffCases, 0);
  assert.equal(
    after.metrics.warehouseCases,
    before.metrics.warehouseCases - c.cases,
  );
  assert.equal(JSON.stringify(after.finance.bills[0].lines), invoice);
  assert.equal(claim(s, id).state, "AWAITING_SETTLEMENT");
  assert.throws(
    () =>
      action(s, "handover", id, {
        reference: "DUPLICADA",
        party: "Transportes",
        confirm: true,
      }),
    { status: 409 },
  );
  const movements = s.movements(OPS, { documentId: id, pageSize: 100 });
  assert.ok(
    movements.items.some(
      (m) => m.type === "SUPPLIER_RETURN" && m.to.label === c.supplierName,
    ),
  );
  assert.ok(
    !s
      .movements(OPS, { huId: c.huId, pageSize: 100 })
      .items.some((m) => m.type === "QUALITY_RELEASE"),
  );
  action(
    s,
    "settle",
    id,
    { kind: "CREDIT", reference: "FC01-000001", amountCents: c.claimableCents },
    ADMIN,
  );
  assert.equal(claim(s, id).state, "CLOSED");
  assert.equal(view(s).finance.bills[0].creditedCents, c.claimableCents);
});
test("disposal requires authorization, physical evidence and a separate financial decision", (t) => {
  const s = fixture(t),
    c = damaged(s),
    id = report(s, c);
  assert.throws(
    () =>
      action(s, "dispose", id, {
        confirm: true,
        reference: "ACTA-001",
        party: "Gestor autorizado",
      }),
    { status: 409 },
  );
  action(s, "respond", id, {
    decision: "DISPOSE",
    reference: "CORREO-BAJA-001",
  });
  assert.throws(
    () =>
      action(s, "dispose", id, {
        confirm: false,
        reference: "ACTA-001",
        party: "Gestor autorizado",
      }),
    { status: 422 },
  );
  action(s, "dispose", id, {
    confirm: true,
    reference: "ACTA-001",
    party: "Gestor de residuos",
  });
  assert.equal(view(s).ledger.writtenOffCases, c.cases);
  assert.equal(view(s).ledger.supplierReturnedCases, 0);
  assert.equal(claim(s, id).state, "AWAITING_SETTLEMENT");
  assert.throws(
    () =>
      action(
        s,
        "settle",
        id,
        {
          kind: "LOSS",
          reference: "Pérdida asumida tras revisión comercial",
          confirm: true,
        },
        OPS,
      ),
    { status: 403 },
  );
  action(
    s,
    "settle",
    id,
    {
      kind: "LOSS",
      reference: "Pérdida asumida tras revisión comercial",
      confirm: true,
    },
    ADMIN,
  );
  assert.equal(claim(s, id).state, "CLOSED");
});
test("supplier rejection does not release stock and needs administrative acceptance before disposal", (t) => {
  const s = fixture(t),
    c = damaged(s),
    id = report(s, c);
  action(s, "respond", id, {
    decision: "REJECTED",
    reference: "CORREO-RECHAZO",
  });
  assert.throws(
    () =>
      action(s, "dispose", id, {
        confirm: true,
        reference: "ACTA-001",
        party: "Gestor autorizado",
      }),
    { status: 409 },
  );
  action(
    s,
    "settle",
    id,
    {
      kind: "LOSS",
      reference: "Reclamación rechazada tras revisión de compras",
      confirm: true,
    },
    ADMIN,
  );
  assert.equal(claim(s, id).state, "AWAITING_DISPOSITION");
  action(s, "dispose", id, {
    confirm: true,
    reference: "ACTA-001",
    party: "Gestor de residuos",
  });
  assert.equal(claim(s, id).state, "CLOSED");
});
test("credits reduce future payments, preserve invoice and expose recoverable supplier balances when already paid", (t) => {
  const s = fixture(t),
    c = damaged(s),
    id = report(s, c),
    bill = view(s).finance.bills[0],
    hash = bill.documentHash;
  s.command(
    "finance.payment.create",
    {
      billId: bill.id,
      amount: bill.totalCents / 100,
      method: "TRANSFER",
      reference: "BANCO-PAGO-001",
    },
    ADMIN,
  );
  action(s, "respond", id, { decision: "DISPOSE", reference: "AUT-BAJA-001" });
  assert.throws(
    () =>
      action(
        s,
        "settle",
        id,
        {
          kind: "CREDIT",
          reference: "NC-000001",
          amountCents: c.claimableCents + 1,
        },
        ADMIN,
      ),
    { status: 422 },
  );
  if (c.claimableCents > 1)
    assert.throws(
      () =>
        action(
          s,
          "settle",
          id,
          {
            kind: "CREDIT",
            reference: "NC-000001",
            amountCents: c.claimableCents - 1,
          },
          ADMIN,
        ),
      { status: 422 },
    );
  action(
    s,
    "settle",
    id,
    { kind: "CREDIT", reference: "NC-000001", amountCents: c.claimableCents },
    ADMIN,
  );
  const b = view(s).finance.bills[0];
  assert.equal(b.documentHash, hash);
  assert.equal(b.totalCents, bill.totalCents);
  assert.equal(b.balanceCents, 0);
  assert.equal(b.supplierReceivableCents, c.claimableCents);
  assert.throws(
    () =>
      s.command(
        "finance.payment.create",
        {
          billId: b.id,
          amount: 1,
          method: "TRANSFER",
          reference: "BANCO-PAGO-002",
        },
        ADMIN,
      ),
    { status: 409 },
  );
  assert.throws(
    () =>
      action(
        s,
        "settle",
        id,
        { kind: "CREDIT", reference: "NC-000002", amountCents: 1 },
        ADMIN,
      ),
    { status: 409 },
  );
});
test("liquid leaks cannot circulate as ordinary returns; cold returns retain compatible quarantine", (t) => {
  for (const [skuId, leak] of [
    ["SKU-ACEITE", true],
    ["SKU-HELADO", false],
  ]) {
    const s = fixture(t),
      c = damaged(s, skuId),
      id = report(s, c);
    if (leak) {
      assert.throws(
        () =>
          action(s, "respond", id, {
            decision: "RETURN",
            reference: "AUT-DEV-001",
          }),
        { status: 409 },
      );
      continue;
    }
    action(s, "respond", id, { decision: "RETURN", reference: "AUT-DEV-001" });
    action(s, "prepareReturn", id);
    assert.equal(claim(s, id).huState, "SUPPLIER_RETURN_READY");
    assert.equal(claim(s, id).locationId, "Q-FROZEN");
    assert.throws(
      () =>
        action(s, "handover", id, {
          confirm: true,
          reference: "GUIA-DEV-001",
          party: "Transporte congelado",
        }),
      { status: 422 },
    );
    action(s, "handover", id, {
      confirm: true,
      confirmConservation: true,
      reference: "GUIA-DEV-001",
      party: "Transporte congelado",
    });
    assert.equal(view(s).ledger.supplierReturnedCases, c.cases);
  }
});
test("notification outbox records failures, prevents concurrent sends and preserves uncertain delivery after restart", async (t) => {
  const folder = mkdtempSync(join(tmpdir(), "dp-claims-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = join(folder, "s.sqlite");
  let s = createSimulation({ filename: file });
  try {
    const c = damaged(s),
      id = report(s, c),
      a = s.claimNotificationNext();
    assert.equal(s.claimNotificationNext(), null);
    assert.equal(a.id, id);
    assert.equal(s.claimNotificationFinish(id, "other", "SENT"), false);
    s.close();
    s = createSimulation({ filename: file });
    assert.equal(claim(s, id).notification.status, "UNKNOWN");
    assert.throws(() => action(s, "retry", id), { status: 422 });
    action(s, "retry", id, { confirmDuplicateRisk: true });
    const next = s.claimNotificationNext();
    assert.equal(next.notification.attempts, 2);
    s.claimNotificationFinish(
      id,
      next.notification.attemptId,
      "FAILED",
      "Canal no disponible",
    );
    assert.equal(claim(s, id).notification.status, "FAILED");
    const sent = [];
    const mail = createSupplierClaimsMail({
      transport: {
        sendMail: async (msg) => {
          sent.push(msg);
          return { accepted: [c.recipient] };
        },
      },
    });
    assert.equal(await mail.send({ ...next, recipient: c.recipient }), "SENT");
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Cajas afectadas/);
    assert.equal(sent[0].to, c.recipient);
    assert.equal(
      await createSupplierClaimsMail({ env: {}, mode: "demo" }).send(next),
      "SIMULATED",
    );
    await assert.rejects(
      createSupplierClaimsMail({ env: {}, mode: "cloud" }).send(next),
    );
  } finally {
    s.close();
  }
});
