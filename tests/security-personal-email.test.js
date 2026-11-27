process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-long-enough-for-session";
const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const db = require("../config/db");
const mail = require("../services/emailService");
const originalTransaction = db.transaction;
const originalExecute = db.pool.execute;
const originalReset = mail.sendPasswordReset;
const originalVerification = mail.sendRecoveryVerification;
let conn,
  sent = [],
  mailFailure = false;
db.transaction = (work) => work(conn);
db.pool.execute = async () => [{ affectedRows: 1 }];
mail.sendPasswordReset = async (data) => {
  sent.push(data);
};
mail.sendRecoveryVerification = async (data) => {
  if (mailFailure) throw new Error("SMTP mock no disponible");
  sent.push(data);
};
const reset = require("../services/userRequestService");
const recovery = require("../services/recoveryEmailService");
const { saveRole } = require("../services/roleService");
test.after(() => {
  db.transaction = originalTransaction;
  db.pool.execute = originalExecute;
  mail.sendPasswordReset = originalReset;
  mail.sendRecoveryVerification = originalVerification;
});
const admin = {
  id: 1,
  activo: 1,
  rol: "administrador_wms",
  perfil: "administrador_wms",
  permisos: ["requests.manage", "roles.manage"],
};

test("la aprobación envía sólo al correo personal vigente, sin receptor global", async () => {
  sent = [];
  conn = {
    execute: async (sql) => {
      if (sql.includes("FROM usuarios u")) return [[admin]];
      if (sql.includes("SELECT * FROM solicitudes"))
        return [
          [
            {
              id: 7,
              usuario_id: 4,
              tipo: "RESET_PASSWORD",
              estado: "PENDIENTE",
            },
          ],
        ];
      if (sql.includes("SELECT id,nombre,correo"))
        return [
          [
            {
              id: 4,
              nombre: "Renzo",
              correo: "renzo@donpepe.example",
              correo_recuperacion: "renzo.personal@example.org",
            },
          ],
        ];
      return [{ affectedRows: 1 }];
    },
  };
  const result = await reset.approveRequest({ requestId: 7, actorId: 1 });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "renzo.personal@example.org");
  assert.equal(result.delivery.to, sent[0].to);
  assert.match(sent[0].url, /\/cuenta\/activar\/[a-f0-9]{64}$/);
});

test("ni el jefe ni un permiso revocado aprueban o renuevan recuperaciones", async () => {
  for (const actor of [
    { ...admin, permisos: [] },
    { id: 2, activo: 1, rol: "jefe_operaciones", permisos: ["wms.tasks"] },
  ]) {
    let reads = 0;
    conn = {
      execute: async (sql) => {
        reads++;
        assert.match(sql, /FROM usuarios u/);
        return [[actor]];
      },
    };
    for (const action of [
      reset.approveRequest,
      reset.rejectRequest,
      reset.regenerateLink,
    ]) {
      await assert.rejects(action({ requestId: 7, actorId: actor.id }), {
        status: 403,
      });
    }
    assert.equal(reads, 3);
  }
});

test("vincular correo exige contraseña; enviar verificación no cambia el correo", async () => {
  sent = [];
  mailFailure = false;
  const hash = await bcrypt.hash("PersonalSegura123", 4),
    writes = [];
  conn = {
    execute: async (sql, params) => {
      if (sql.includes("SELECT id,nombre,password"))
        return [
          [
            {
              id: 4,
              nombre: "Renzo",
              password: hash,
              correo_recuperacion: "anterior@example.org",
              activo: 1,
            },
          ],
        ];
      writes.push({ sql, params });
      return [{ insertId: 1 }];
    },
  };
  await assert.rejects(
    recovery.requestEmailChange({
      userId: 4,
      email: "nuevo@example.org",
      currentPassword: "incorrecta",
    }),
    { status: 422 },
  );
  assert.equal(writes.length, 0);
  assert.equal(sent.length, 0);
  await recovery.requestEmailChange({
    userId: 4,
    email: " NUEVO@EXAMPLE.ORG ",
    currentPassword: "PersonalSegura123",
  });
  assert.equal(sent[0].to, "nuevo@example.org");
  assert(!writes.some((q) => q.sql.startsWith("UPDATE usuarios")));
  const insert = writes.find((q) => q.sql.startsWith("INSERT INTO cambios"));
  assert.match(insert.params[2], /^[a-f0-9]{64}$/);
  assert(
    !sent[0].url.endsWith(insert.params[2]),
    "la base guarda hash, no el token del enlace",
  );
});

test("un error SMTP conserva el correo anterior y cancela la verificación", async () => {
  mailFailure = true;
  const hash = await bcrypt.hash("PersonalSegura123", 4),
    writes = [];
  conn = {
    execute: async (sql) => {
      if (sql.startsWith("SELECT"))
        return [
          [
            {
              id: 4,
              nombre: "Renzo",
              password: hash,
              correo_recuperacion: "anterior@example.org",
              activo: 1,
            },
          ],
        ];
      writes.push(sql);
      return [{ affectedRows: 1 }];
    },
  };
  await assert.rejects(
    recovery.requestEmailChange({
      userId: 4,
      email: "nuevo@example.org",
      currentPassword: "PersonalSegura123",
    }),
    { status: 503 },
  );
  assert(!writes.some((sql) => sql.startsWith("UPDATE usuarios")));
  assert(writes.some((sql) => sql.includes("WHERE token_hash=?")));
  mailFailure = false;
});

test("verificar correo vincula al propietario y revoca los enlaces anteriores", async () => {
  const writes = [];
  conn = {
    execute: async (sql, params) => {
      if (sql.includes("SELECT id,activo")) return [[{ id: 4, activo: 1 }]];
      if (sql.includes("SELECT id,correo FROM cambios")) {
        assert.match(
          sql,
          /usuario_id=\? AND token_hash=\? AND usado_en IS NULL AND expira_en>NOW\(\)/,
        );
        assert.equal(params[0], 4);
        return [[{ id: 9, correo: "nuevo@example.org" }]];
      }
      writes.push(sql);
      return [{ affectedRows: 1 }];
    },
  };
  assert.equal(
    await recovery.confirmEmailChange({ userId: 4, token: "a".repeat(64) }),
    "nuevo@example.org",
  );
  assert(
    writes.some((sql) =>
      sql.startsWith("UPDATE usuarios SET correo_recuperacion"),
    ),
  );
  assert(
    writes.some((sql) =>
      sql.includes("solicitudes_usuario SET estado='EXPIRADA'"),
    ),
  );
  assert(writes.some((sql) => sql.includes("seguridad_eventos")));
  conn = {
    execute: async (sql) =>
      sql.includes("SELECT id,activo") ? [[{ id: 4, activo: 1 }]] : [[]],
  };
  await assert.rejects(
    recovery.confirmEmailChange({ userId: 4, token: "a".repeat(64) }),
    { status: 409 },
  );
});

test("la pantalla de confirmación sólo consulta el correo pendiente del propietario", async () => {
  let valid = true;
  conn = {
    execute: async (sql, params) => {
      assert(
        sql.startsWith("SELECT correo"),
        "abrir el enlace no modifica datos",
      );
      assert.match(
        sql,
        /usuario_id=\? AND token_hash=\? AND usado_en IS NULL AND expira_en>NOW\(\)/,
      );
      assert.equal(params[0], 4);
      assert.match(params[1], /^[a-f0-9]{64}$/);
      return valid ? [[{ correo: "nuevo@example.org" }]] : [[]];
    },
  };
  assert.equal(
    await recovery.pendingEmailChange({ userId: 4, token: "b".repeat(64) }),
    "nuevo@example.org",
  );
  valid = false;
  await assert.rejects(
    recovery.pendingEmailChange({ userId: 4, token: "b".repeat(64) }),
    { status: 409 },
  );
});

test("el enlace de contraseña nunca reactiva una cuenta bloqueada", async () => {
  conn = {
    execute: async (sql) => {
      if (sql.includes("FROM solicitudes_usuario"))
        return [[{ id: 7, usuario_id: 4 }]];
      if (sql.includes("SELECT id,activo")) return [[{ id: 4, activo: 0 }]];
      throw new Error(
        "No debe escribir ni cambiar contraseñas de una cuenta bloqueada",
      );
    },
  };
  await assert.rejects(
    reset.completeWithPassword({
      token: "a".repeat(64),
      password: "OtraPersonal123",
    }),
    { status: 410 },
  );
});

test("crear y editar rol persiste permisos y auditoría; gobierno protegido no se modifica", async () => {
  const data = {
    etiqueta: "Consulta de stock",
    descripcion: "Consulta de ubicaciones y contexto de inventario",
    perfil: "jefe_operaciones",
    activo: true,
    permisos: ["wms.positions"],
  };
  const writes = [];
  conn = {
    execute: async (sql, params) => {
      if (sql.includes("FROM usuarios u")) return [[admin]];
      if (sql.includes("LOWER(etiqueta)")) return [[]];
      if (sql.includes("INSERT INTO roles (")) return [{ insertId: 10 }];
      if (sql.includes("SELECT * FROM roles"))
        return [
          [{ id: 10, sistema: 0, perfil: "jefe_operaciones", activo: 1 }],
        ];
      if (sql.includes("SELECT id FROM usuarios")) return [[]];
      if (sql.includes("SELECT permiso"))
        return [[{ permiso: "wms.positions" }]];
      writes.push({ sql, params });
      return [{ affectedRows: 1 }];
    },
  };
  assert.equal(await saveRole({ actorId: 1, data }), 10);
  await saveRole({
    actorId: 1,
    roleId: 10,
    data: { ...data, permisos: ["products.view"] },
  });
  assert(
    writes.some((q) => q.sql === "DELETE FROM roles_permisos WHERE rol_id=?"),
  );
  assert(
    writes.some(
      (q) =>
        q.sql.startsWith("INSERT INTO roles_permisos") &&
        q.params[1] === "products.view",
    ),
  );
  assert(
    writes.some(
      (q) =>
        q.sql.includes("seguridad_eventos") && q.params[1] === "ROL_EDITADO",
    ),
  );
  conn = {
    execute: async (sql) =>
      sql.includes("FROM usuarios u")
        ? [[admin]]
        : sql.includes("LOWER(etiqueta)")
          ? [[]]
          : [[{ id: 1, sistema: 1 }]],
  };
  await assert.rejects(saveRole({ actorId: 1, roleId: 1, data }), {
    status: 409,
  });
});
