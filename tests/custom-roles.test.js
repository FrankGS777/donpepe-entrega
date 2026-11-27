process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-long-enough";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { validateRole } = require("../services/roleService");
const { can } = require("../config/permissions");
const { homeByRole } = require("../utils/home");
const { requireTaskCapability } = require("../services/accessPolicy");
const fs = require("node:fs"),
  path = require("node:path");
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const identity = {
  rol: "rol_custom",
  perfil: "jefe_operaciones",
  permisos: ["wms.positions"],
};
test("un rol personalizado recibe sólo permisos persistidos y revocables", () => {
  assert(can(identity, "wms.positions"));
  assert(!can(identity, "users.update"));
  assert(!can({ ...identity, permisos: [] }, "wms.positions"));
  assert(!can({ ...identity, rol_activo: 0 }, "wms.positions"));
  assert.equal(homeByRole(identity), "/wms/posiciones");
});
test("roles personalizados rechazan gobierno, perfiles inventados y permisos huérfanos", () => {
  const data = {
    etiqueta: "Coordinador de stock",
    descripcion: "Consulta ubicaciones del centro de distribución",
    perfil: "jefe_operaciones",
    activo: true,
    permisos: ["wms.positions"],
  };
  assert.equal(validateRole(data).permisos.length, 1);
  for (const change of [
    { perfil: "administrador_wms" },
    { permisos: ["users.update"] },
    { permisos: ["wms.tasks.create"] },
    { permisos: ["rf.pick"] },
    { permisos: ["__proto__"] },
  ])
    assert.throws(() => validateRole({ ...data, ...change }), { status: 422 });
  assert.doesNotThrow(() =>
    validateRole({
      ...data,
      perfil: "operador_rf",
      permisos: ["rf.access", "rf.pick", "wms.tasks.execute"],
    }),
  );
});
test("RF personalizado no puede ejecutar otra clase de tarea", () => {
  const picker = {
    rol: "rol_picker",
    perfil: "operador_rf",
    permisos: ["rf.access", "rf.pick", "wms.tasks.execute"],
  };
  assert.doesNotThrow(() => requireTaskCapability(picker, { tipo: "PICKING" }));
  assert.throws(() => requireTaskCapability(picker, { tipo: "PUTAWAY" }), {
    status: 403,
  });
});
test("el administrador único tiene barrera transaccional y restricción SQL", () => {
  assert.match(
    read("database/securityMigration.js"),
    /UNIQUE KEY uq_administrador_unico/,
  );
  assert.match(read("services/userService.js"), /administrador es único/);
  assert.match(read("services/userService.js"), /debe permanecer activo/);
  assert.match(read("services/roleService.js"), /role\.sistema/);
});
test("la recuperación entrega al correo de la cuenta y exige verificar cambios propios", () => {
  const delivery = read("services/userRequestService.js");
  assert.doesNotMatch(delivery, /recoveryOverrideEmail/);
  assert.match(
    delivery,
    /const recoveryEmail = result\.request\.correo_recuperacion/,
  );
  const service = read("services/recoveryEmailService.js");
  assert.match(service, /bcrypt\.compare/);
  assert.match(service, /sendRecoveryVerification/);
  assert.match(service, /expira_en>NOW\(\)/);
  assert.match(service, /usuario_id=\? AND token_hash=\?/);
  assert.match(service, /invalidateRecoveryLinks\(conn, userId\)/);
});
test("el sidebar se conserva por usuario y las confirmaciones tienen cancelación accesible", () => {
  const js = read("public/js/ui.js");
  assert.match(js, /donpepe:sidebar:/);
  assert.match(js, /sessionStorage\.setItem/);
  assert.match(js, /scrollTop = Number/);
  assert.match(js, /pagehide/);
  assert.match(js, /alertdialog/);
  assert.match(js, /aria-describedby/);
  assert.doesNotMatch(read("public/js/app.js"), /if \(!confirm\(/);
});
