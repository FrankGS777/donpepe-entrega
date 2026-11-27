process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";
const test = require("node:test");
const assert = require("node:assert/strict");
const { can, permissions } = require("../config/permissions");
const {
  requireActorPermission,
  requireAssignedOperator,
} = require("../services/accessPolicy");
const User = require("../models/User");
const { permit } = require("../middleware/auth");
const db = require("../config/db");

test("RBAC tiene exactamente tres roles inmutables y deniega roles desconocidos", () => {
  assert.deepEqual(Object.keys(permissions), [
    "administrador_wms",
    "jefe_operaciones",
    "operador_rf",
  ]);
  for (const role of Object.keys(permissions))
    assert(Object.isFrozen(permissions[role]));
  assert.equal(can("vendedor", "users.view"), false);
  assert.equal(can("toString", "users.view"), false);
  assert.throws(() => permissions.operador_rf.push("users.update"));
});

test("segregación: gobierno, delegación y ejecución no se heredan entre sí", () => {
  for (const action of [
    "users.update",
    "requests.manage",
    "purchases.create",
    "audits.approve",
    "reports.export",
  ])
    assert.deepEqual(
      Object.keys(permissions).filter((r) => can(r, action)),
      ["administrador_wms"],
    );
  for (const action of [
    "wms.tasks.create",
    "wms.tasks.assign",
    "wms.tasks.manage",
    "distribution.plan",
    "distribution.dispatch",
  ])
    assert.deepEqual(
      Object.keys(permissions).filter((r) => can(r, action)),
      ["jefe_operaciones"],
    );
  for (const action of ["rf.receive", "wms.tasks.execute"])
    assert.deepEqual(
      Object.keys(permissions).filter((r) => can(r, action)),
      ["operador_rf"],
    );
});

test("política del servicio usa el rol persistido y rechaza cuentas inactivas", async () => {
  for (const actor of [
    null,
    { activo: 0, rol: "administrador_wms" },
    { activo: 1, rol: "jefe_operaciones" },
  ]) {
    const conn = { execute: async () => [[actor]] };
    await assert.rejects(requireActorPermission(conn, 4, "audits.approve"), {
      status: 403,
    });
  }
  assert.equal(
    (
      await requireActorPermission(
        { execute: async () => [[{ activo: 1, rol: "operador_rf" }]] },
        4,
        "rf.receive",
      )
    ).rol,
    "operador_rf",
  );
});

test("RF no toma trabajo sin asignar ni tareas de otro operador", () => {
  for (const task of [{ asignado_a: null }, { asignado_a: 9 }])
    assert.throws(() => requireAssignedOperator(task, 4), { status: 403 });
  assert.doesNotThrow(() => requireAssignedOperator({ asignado_a: "4" }, 4));
});

test("middleware refresca el rol: una sesión admin degradada no conserva privilegios", async () => {
  const previous = User.findSessionIdentity;
  User.findSessionIdentity = async () => ({
    id: 4,
    nombre: "Operador",
    correo: "test@example.com",
    activo: 1,
    rol: "operador_rf",
  });
  try {
    const req = { session: { user: { id: 4, rol: "administrador_wms" } } };
    const res = {
      locals: {},
      status(n) {
        this.code = n;
        return this;
      },
      render(view, data) {
        this.layout = data.layout;
      },
    };
    let passed = false;
    await permit("users.update")(req, res, () => {
      passed = true;
    });
    assert.equal(res.code, 403);
    assert.equal(res.layout, "layouts/rf");
    assert.equal(passed, false);
    assert.equal(req.session.user.rol, "operador_rf");
  } finally {
    User.findSessionIdentity = previous;
  }
});

test("servicios deniegan acciones cruzadas antes de leer o escribir inventario", async () => {
  let conn;
  const previous = db.transaction;
  db.transaction = (work) => work(conn);
  // Cargar después de sustituir el límite transaccional: no se conecta a MySQL.
  const wms = require("../services/wmsService");
  const audit = require("../services/auditService");
  const purchase = require("../services/purchaseService");
  const distribution = require("../services/distributionService");
  try {
    for (const [role, operation] of [
      [
        "administrador_wms",
        () => wms.startWarehouseTask({ taskId: 2, userId: 4 }),
      ],
      [
        "administrador_wms",
        () =>
          wms.completeWarehouseTask({
            taskId: 2,
            userId: 4,
            role: "operador_rf",
          }),
      ],
      [
        "administrador_wms",
        () => wms.assignWarehouseTask({ taskId: 2, operatorId: 9, userId: 4 }),
      ],
      ["jefe_operaciones", () => audit.approveAudit({ auditId: 2, userId: 4 })],
      [
        "administrador_wms",
        () => purchase.receivePurchase({ orderId: 2, userId: 4, items: [] }),
      ],
      [
        "administrador_wms",
        () => distribution.planBranchOrder({ orderId: 2, userId: 4 }),
      ],
    ]) {
      let reads = 0;
      conn = {
        execute: async (sql) => {
          assert.match(sql, /FROM usuarios/);
          reads++;
          return [[{ id: 4, activo: 1, rol: role }]];
        },
      };
      await assert.rejects(operation(), { status: 403 });
      assert.equal(reads, 1);
    }
    // Un operador autorizado tampoco puede saltarse la asignación ni los escaneos.
    for (const assigned of [null, 9]) {
      conn = {
        execute: async (sql) => {
          if (sql.includes("FROM usuarios"))
            return [[{ id: 4, activo: 1, rol: "operador_rf" }]];
          assert.match(sql, /SELECT \* FROM tareas_almacen/);
          return [[{ id: 2, estado: "PENDIENTE", asignado_a: assigned }]];
        },
      };
      await assert.rejects(wms.startWarehouseTask({ taskId: 2, userId: 4 }), {
        status: 403,
      });
    }
    conn = {
      execute: async (sql) => {
        if (sql.includes("FROM usuarios"))
          return [[{ id: 4, activo: 1, rol: "operador_rf" }]];
        assert.match(sql, /SELECT t\.\*/);
        return [
          [
            {
              id: 2,
              tipo: "REUBICACION",
              estado: "EN_PROCESO",
              asignado_a: 4,
              loc_origen: "LOC-A",
              loc_destino: "LOC-B",
              sku: "SKU-A",
            },
          ],
        ];
      },
    };
    await assert.rejects(
      wms.completeWarehouseTask({
        taskId: 2,
        userId: 4,
        role: "administrador_wms",
      }),
      { status: 409 },
    );
    conn = {
      execute: async (sql) => {
        if (sql.includes("FROM usuarios"))
          return [[{ id: 4, activo: 1, rol: "administrador_wms" }]];
        assert.match(sql, /SELECT \* FROM inventarios_auditoria/);
        return [[{ id: 2, estado: "PENDIENTE", usuario_id: 4 }]];
      },
    };
    await assert.rejects(audit.approveAudit({ auditId: 2, userId: 4 }), {
      status: 409,
    });
  } finally {
    db.transaction = previous;
  }
});
