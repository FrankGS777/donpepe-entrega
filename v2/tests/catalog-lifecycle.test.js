"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createSimulation } = require("../core/engine");
const { createApp } = require("../server");
const { migrateCatalogLifecycle } = require("../core/catalog-lifecycle");
const ADMIN = { id: "ADMIN", role: "admin" },
  OPS = { id: "OPS", role: "operations" },
  STORE = { id: "STORE", role: "store", branchId: "TIENDA-1" };
const state = (sim) => sim.snapshot(OPS);
const cfg = (sim, type, payload) =>
  sim.command(
    type,
    { expectedRevision: state(sim).configuration.revision, ...payload },
    ADMIN,
  );
const imageUrl = "/images/catalog/sku-arroz.webp";
function masters(sim) {
  const supplier = cfg(sim, "config.supplier.create", {
    data: {
      code: "STATUS-SUP",
      name: "Proveedor de prueba de estados",
      zones: ["DRY"],
    },
  });
  const brand = cfg(sim, "config.brand.create", {
    data: {
      code: "STATUS-BRAND",
      name: "Marca de prueba de estados",
      imageUrl,
      supplierIds: [supplier.id],
    },
  });
  const category = cfg(sim, "config.category.create", {
    data: {
      code: "STATUS-CAT",
      name: "Categoría de prueba de estados",
      imageUrl,
      zoneIds: ["DRY"],
    },
  });
  const sku = cfg(sim, "config.sku.create", {
    data: {
      code: "STATUS-SKU",
      name: "Producto de prueba de estados",
      supplierId: supplier.id,
      brandId: brand.id,
      categoryId: category.id,
      imageUrl,
      zoneId: "DRY",
      unitsPerCase: 12,
      expiryControlled: true,
    },
  });
  const branch = cfg(sim, "config.branch.create", {
    data: {
      code: "STATUS-BRANCH",
      name: "Sucursal de prueba de estados",
      imageUrl,
      x: 110,
      z: 90,
      travelSeconds: 80,
    },
  });
  const asset = cfg(sim, "config.asset.create", {
    data: {
      code: "STATUS-ASSET",
      name: "Equipo planificado de prueba",
      type: "AMR",
      manufacturer: "Fabricante de prueba",
      model: "Modelo de prueba",
      serialNumber: "STATUS-SERIAL-001",
      commissionDate: "2026-10-17",
      imageUrl,
    },
  });
  return { supplier, brand, category, sku, branch, asset };
}

test("los seis maestros comparten desactivación, activación y eliminación irreversible sin borrar historia", (t) => {
  const sim = createSimulation();
  t.after(() => sim.close());
  const entities = masters(sim);
  const initial = state(sim),
    movements = sim.movements(OPS).total;
  const collections = {
    sku: "skus",
    brand: "brands",
    category: "categories",
    branch: "branches",
    supplier: "suppliers",
    asset: "assets",
  };
  for (const kind of [
    "sku",
    "brand",
    "category",
    "asset",
    "branch",
    "supplier",
  ]) {
    const { id } = entities[kind],
      command = `config.${kind}`;
    assert.throws(
      () => cfg(sim, `${command}.delete`, { id }),
      { status: 409 },
      kind,
    );
    cfg(sim, `${command}.deactivate`, {
      id,
      reason: "Fuera de uso temporalmente",
    });
    assert.equal(
      state(sim).catalog[collections[kind]].find((row) => row.id === id).active,
      false,
    );
    cfg(sim, `${command}.activate`, { id });
    cfg(sim, `${command}.deactivate`, { id });
    if (kind === "branch") {
      const receiving = state(sim).catalog.assets.find(
        (row) => row.branchId === id,
      );
      assert.throws(
        () => cfg(sim, `${command}.delete`, { id }),
        /equipos vinculados/,
      );
      cfg(sim, "config.asset.deactivate", { id: receiving.id });
    }
    cfg(sim, `${command}.delete`, { id, reason: "Retiro definitivo" });
    const deleted = state(sim).catalog[collections[kind]].find(
      (row) => row.id === id,
    );
    assert(deleted.deletedAt);
    assert.equal(deleted.active, false);
    for (const action of ["update", "activate", "delete", "deactivate"])
      assert.throws(
        () => cfg(sim, `${command}.${action}`, { id, data: { active: true } }),
        { status: 404 },
        `${kind}.${action}`,
      );
    assert.throws(() => cfg(sim, `${command}.archive`, { id }), {
      status: 403,
    });
  }
  assert.deepEqual(state(sim).hus, initial.hus);
  assert.deepEqual(state(sim).orders, initial.orders);
  assert.equal(sim.movements(OPS).total, movements);
});

test("desactivar no borra dependencias: productos desactivados también protegen a sus maestros al eliminar", (t) => {
  const sim = createSimulation();
  t.after(() => sim.close());
  const entities = masters(sim);
  cfg(sim, "config.sku.deactivate", { id: entities.sku.id });
  for (const kind of ["brand", "category", "supplier"]) {
    cfg(sim, `config.${kind}.deactivate`, { id: entities[kind].id });
    assert.throws(
      () => cfg(sim, `config.${kind}.delete`, { id: entities[kind].id }),
      /productos vinculados/i,
    );
  }
  assert.throws(
    () => cfg(sim, "config.sku.activate", { id: entities.sku.id }),
    { status: 409 },
  );
  assert.throws(
    () =>
      cfg(sim, "config.sku.update", {
        id: entities.sku.id,
        data: { active: true },
      }),
    { status: 422 },
  );
});

test("equipos integrados conservan la ficha y el último cargador disponible está protegido", (t) => {
  const sim = createSimulation();
  t.after(() => sim.close());
  cfg(sim, "config.asset.deactivate", { id: "ASSET-AMR-1" });
  assert.throws(
    () => cfg(sim, "config.asset.delete", { id: "ASSET-AMR-1" }),
    /circuito físico/,
  );
  cfg(sim, "config.asset.activate", { id: "ASSET-AMR-1" });
  const chargers = state(sim).catalog.assets.filter(
    (row) => row.type === "CHARGER",
  );
  for (const charger of chargers.slice(0, -1))
    cfg(sim, "config.asset.deactivate", { id: charger.id });
  assert.throws(
    () => cfg(sim, "config.asset.deactivate", { id: chargers.at(-1).id }),
    /último cargador/,
  );
});

test("el estado sólo lo administra el perfil autorizado y una revisión antigua no cambia registros", (t) => {
  const sim = createSimulation();
  t.after(() => sim.close());
  const { asset } = masters(sim);
  for (const role of [
    OPS,
    STORE,
    { ...OPS, permissions: ["config.asset.manage"] },
  ])
    for (const action of ["activate", "deactivate", "delete"])
      assert.throws(
        () =>
          sim.command(
            `config.asset.${action}`,
            {
              id: asset.id,
              expectedRevision: state(sim).configuration.revision,
            },
            role,
          ),
        { status: 403 },
      );
  const rev = state(sim).configuration.revision;
  cfg(sim, "config.asset.deactivate", { id: asset.id });
  assert.throws(
    () =>
      sim.command(
        "config.asset.delete",
        { id: asset.id, expectedRevision: rev },
        ADMIN,
      ),
    { status: 409 },
  );
  assert(
    !state(sim).catalog.assets.find((row) => row.id === asset.id).deletedAt,
  );
});

test("los estados antiguos se convierten en desactivados conservando fecha, identidad y referencias", () => {
  const s = {
    catalog: {
      assets: [
        {
          id: "OLD",
          active: false,
          status: "ARCHIVED",
          archivedAt: "2026-10-20T10:00:00Z",
        },
      ],
      skus: [
        { id: "SKU-OLD", active: false, archivedAt: "2026-10-21T10:00:00Z" },
      ],
    },
  };
  assert(migrateCatalogLifecycle(s));
  assert.equal(s.catalog.assets[0].status, "INACTIVE");
  assert.equal(s.catalog.skus[0].deactivatedAt, "2026-10-21T10:00:00Z");
  assert.equal(s.catalog.assets[0].id, "OLD");
  assert(!s.catalog.assets[0].archivedAt);
  assert.equal(migrateCatalogLifecycle(s), false);
});

test("API protege cuentas vinculadas a sucursal y audita los cambios de estado", async (t) => {
  const runtime = createApp({
    identityFile: ":memory:",
    simulationFile: ":memory:",
    startClock: false,
  });
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    runtime.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "admin@donpepe.local",
      password: "DonPepe2026!",
    }),
  });
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const me = await (
    await fetch(base + "/api/me", { headers: { cookie } })
  ).json();
  const post = async (type, id) => {
    const res = await fetch(base + "/api/commands", {
      method: "POST",
      headers: {
        cookie,
        "content-type": "application/json",
        "x-csrf-token": me.csrf,
      },
      body: JSON.stringify({
        type,
        payload: {
          id,
          expectedRevision: state(runtime.simulation).configuration.revision,
          reason: "Revisión administrativa de prueba",
        },
      }),
    });
    return { status: res.status, data: await res.json() };
  };
  assert.equal(
    (await post("config.branch.deactivate", "TIENDA-1")).status,
    409,
  );
  assert.equal((await post("config.branch.delete", "TIENDA-1")).status, 409);
  const { asset } = masters(runtime.simulation);
  assert.equal((await post("config.asset.deactivate", asset.id)).status, 200);
  assert.equal((await post("config.asset.delete", asset.id)).status, 200);
  const audit = await (
    await fetch(base + "/api/audit", { headers: { cookie } })
  ).json();
  assert(
    audit.events.some(
      (row) =>
        row.action === "COMMAND_EXECUTED" &&
        row.details.type === "config.asset.delete",
    ),
  );
  const check = await post("config.asset.activate", asset.id);
  assert.equal(check.status, 404);
});
