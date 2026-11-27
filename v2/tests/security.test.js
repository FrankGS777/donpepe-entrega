"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { DatabaseSync } = require("node:sqlite");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const { PNG } = require("pngjs");
const { createApp } = require("../server");
const { can, assertCommandAllowed, ROLE_CEILINGS } = require("../security/policy");
const { hashToken, createIdentityStore } = require("../security/identity");
const { createRecoveryMail } = require("../security/mail");
const { normalizeAvatar, MAX_AVATAR_BYTES } = require("../security/avatar");
const PASSWORD = "DonPepe2026!";
async function fixture(t, options = {}) {
  const messages = [];
  const runtime = createApp({ identityFile: ":memory:", simulationFile: ":memory:", startClock: false, mailTransport: { sendMail: async message => { messages.push(message); if (options.mailFails) throw new Error("PRIVATE SMTP FAILURE"); return {}; } }, ...options });
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await new Promise(resolve => server.close(resolve)); runtime.close(); });
  const request = async (url, { method = "GET", data, session, headers = {} } = {}) => {
    const response = await fetch(base + url, { method, headers: { ...(data ? { "content-type": "application/json" } : {}), ...(session ? { cookie: session.cookie, "x-csrf-token": session.csrf } : {}), ...headers }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (email, password = PASSWORD) => {
    const response = await request("/api/login", { method: "POST", data: { email, password } });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const me = await request("/api/me", { headers: { cookie: response.cookie } });
    return { cookie: response.cookie, csrf: me.body.csrf, user: me.body.user };
  };
  return { runtime, messages, request, login, base };
}
const tokenOf = message => new URL(message.text.match(/https?:\/\/\S+/)[0]).searchParams.get("token");
const post = (request, session, url, data) => request(url, { method: "POST", session, data });
async function linkGmail(f, session, email) {
  const sent = await post(f.request, session, "/api/profile/recovery-email", { email, currentPassword: PASSWORD });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const token = tokenOf(f.messages.at(-1));
  const verified = await f.request("/api/recovery-email/verify", { method: "POST", data: { token } });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  return token;
}

test("los techos de perfil no permiten autoasignación de privilegios ni reset", () => {
  assert.equal(can({ id: "A", role: "admin", permissions: ["order.release", "map.view"] }, "order.release"), false);
  assert.equal(can({ id: "S", role: "store", permissions: ["identity.users.manage"] }, "identity.users.manage"), false);
  assert.throws(() => assertCommandAllowed({ id: "A", role: "admin" }, "equipment.fault"), { status: 403 });
  assert.throws(() => assertCommandAllowed({ id: "A", role: "admin" }, "simulation.reset"), { status: 403 });
  assert.equal(can({ id: "O", role: "operations" }, "order.release"), true);
  assert.equal(can({ id: "X", role: "__proto__" }, "order.release"), false);
  assert.throws(() => assertCommandAllowed({ id: "X", role: "toString" }, "order.release"), { status: 403 });
});
test("admin no recibe mapa ni operativa; operaciones sí y tienda sólo su ámbito", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local"), store = await f.login("tienda@donpepe.local");
  const a = await f.request("/api/state", { session: admin }), o = await f.request("/api/state", { session: ops }), s = await f.request("/api/state", { session: store });
  assert.equal(a.body.layout.locations.length, 0); assert.equal(a.body.orders.length, 0); assert.equal(a.body.robots.length, 0); assert.ok(a.body.catalog.skus.length);
  assert.equal(o.body.layout.locations.length, 448); assert.equal(s.body.catalog.branches.length, 1); assert.equal(s.body.robots.length, 0);
  assert.equal((await post(f.request, admin, "/api/commands", { type: "simulation.pause", payload: { paused: true } })).status, 403);
  assert.equal((await f.request("/api/users", { session: ops })).status, 403);
  assert.equal((await post(f.request, store, "/api/commands", { type: "order.create", payload: { branchId: "TIENDA-2", lines: [{ skuId: "SKU-ARROZ", cases: 1 }] } })).status, 403);
});
test("operaciones recibe solicitudes oficiales de tienda sin crearlas ni simular demanda", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), store = await f.login("tienda@donpepe.local"), admin = await f.login("admin@donpepe.local");
  assert.ok(!ops.user.permissions.includes("order.create")); assert.ok(!ops.user.permissions.includes("simulation.request"));
  const line = { skuId: "SKU-ARROZ", cases: 2 };
  assert.equal((await post(f.request, ops, "/api/commands", { type: "order.create", payload: { branchId: "TIENDA-1", lines: [line] } })).status, 403);
  const real = await post(f.request, store, "/api/commands", { type: "order.create", payload: { commandId: "store-request", lines: [line], source: "SIMULATION", simulated: true } });
  assert.equal(real.status, 200); const order = real.body.state.orders.find(row => row.id === real.body.result.id);
  assert.equal(order.branchId, "TIENDA-1"); assert.equal(order.source, "STORE"); assert.equal(order.simulated, false);
  const initial = (await f.request("/api/state", { session: ops })).body;
  for (const session of [ops, store, admin]) assert.equal((await post(f.request, session, "/api/commands", { type: "simulation.request", payload: { commandId: "denied" } })).status, 403);
  const after = (await f.request("/api/state", { session: ops })).body;
  assert.deepEqual(after.orders, initial.orders);
  assert.equal(after.metrics.warehouseCases, initial.metrics.warehouseCases); assert.equal(after.metrics.availableCases, initial.metrics.availableCases);
  const summary = (await f.request("/api/state", { session: admin })).body;
  assert.equal(summary.inventorySummary.totals.warehouseCases, 360); assert.equal(summary.inventorySummary.products.length, 12 + require("../core/expanded-catalog.json").products.length);
  assert.equal(summary.hus.length, 0); assert.equal(summary.layout.locations.length, 0); assert.equal(summary.missions.length, 0);
  assert.equal((await post(f.request, admin, "/api/commands", { type: "purchase.create", payload: { supplierId: "PROV-1", lines: [line] } })).status, 403);
  assert.equal((await f.request("/api/state", { session: store })).body.inventorySummary, undefined);
});
test("la migración de permisos retira creación operativa sin reactivar permisos restringidos", t => {
  const folder = mkdtempSync(join(tmpdir(), "donpepe-permission-migration-")); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const filename = join(folder, "identity.sqlite"), first = createIdentityStore(filename); first.close();
  const db = new DatabaseSync(filename);
  db.prepare("DELETE FROM security_meta WHERE key='store_requests_grants_v2'").run();
  db.prepare("DELETE FROM security_meta WHERE key='official_store_requests_v7'").run();
  db.prepare("DELETE FROM role_grants WHERE role='operations' AND permission IN ('simulation.pause','simulation.request','map.view')").run();
  db.prepare("INSERT OR IGNORE INTO role_grants VALUES('operations','order.create')").run();
  db.prepare("INSERT OR IGNORE INTO role_grants VALUES('operations','simulation.request')").run(); db.close();
  const restored = createIdentityStore(filename); t.after(() => restored.close());
  const permissions = restored.grants("operations"); assert.ok(!permissions.includes("order.create")); assert.ok(!permissions.includes("map.view")); assert.ok(!permissions.includes("simulation.request"));
  assert.ok(restored.grants("admin").includes("inventory.summary.read")); assert.ok(restored.grants("store").includes("order.create"));
  assert.equal(restored.db.prepare("SELECT COUNT(*) n FROM role_grants WHERE permission='simulation.request'").get().n, 0);
  const expected = restored.grants("operations");
  const reopened = createIdentityStore(filename); t.after(() => reopened.close());
  assert.deepEqual(reopened.grants("operations"), expected);
});
test("errores de campos maestros se entregan identificados y conservan la configuración anterior", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), state = (await f.request("/api/state", { session: admin })).body;
  const response = await post(f.request, admin, "/api/commands", { type: "config.sku.update", payload: { id: "SKU-ARROZ", expectedRevision: state.configuration.revision, data: { reorderPoint: -1 } } });
  assert.equal(response.status, 422); assert.match(response.body.fieldErrors.reorderPoint, /Punto de reposición/);
  const after = (await f.request("/api/state", { session: admin })).body; assert.equal(after.configuration.revision, state.configuration.revision);
  assert.deepEqual(after.catalog.skus, state.catalog.skus);
});
test("los permisos se refrescan sin cerrar sesión y la UI no es la barrera", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local");
  const permissions = ROLE_CEILINGS.operations.filter(p => !["order.release", "map.view", "inventory.read"].includes(p));
  const revision = (await f.request("/api/roles", { session: admin })).body.revision;
  assert.equal((await f.request("/api/roles/operations", { method: "PUT", session: admin, data: { permissions, expectedRevision: revision } })).status, 200);
  assert.equal((await f.request("/api/roles/operations", { method: "PUT", session: admin, data: { permissions, expectedRevision: revision } })).status, 409);
  const me = await f.request("/api/me", { session: ops }); assert.ok(!me.body.user.permissions.includes("order.release"));
  assert.equal((await post(f.request, ops, "/api/commands", { type: "order.release", payload: { id: "PED-00001" } })).status, 403);
  const state = await f.request("/api/state", { session: ops }); assert.deepEqual(state.body.hus, []); assert.deepEqual(state.body.layout.locations, []); assert.deepEqual(state.body.inventory.availability, []);
  assert.equal((await f.request("/api/roles/operations", { method: "PUT", session: admin, data: { permissions: [...permissions, "identity.users.manage"] } })).status, 422);
  assert.equal((await f.request("/api/roles/admin", { method: "PUT", session: admin, data: { permissions: [] } })).status, 409);
});
test("cuentas: validación, administrador único y contraseñas nunca expuestas", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local");
  const valid = { name: "Usuario de prueba", email: "nuevo@donpepe.local", role: "store", branchId: "TIENDA-2", password: "Contraseña2026!", recoveryEmail: "persona.real@gmail.com" };
  assert.equal((await post(f.request, admin, "/api/users", { ...valid, role: "admin" })).status, 422);
  assert.equal((await post(f.request, admin, "/api/users", { ...valid, password: "123456789012" })).status, 422);
  assert.equal((await post(f.request, admin, "/api/users", { ...valid, recoveryEmail: "persona@empresa.com" })).status, 422);
  assert.equal((await post(f.request, admin, "/api/users", { ...valid, branchId: "inexistente" })).status, 422);
  const created = await post(f.request, admin, "/api/users", valid); assert.equal(created.status, 201); assert.equal(created.body.user.recoveryVerified, false); assert.equal(f.messages.length, 0);
  assert.equal((await post(f.request, admin, "/api/users", valid)).status, 409);
  const users = await f.request("/api/users", { session: admin }); assert.ok(!JSON.stringify(users.body).includes("$2")); assert.ok(!JSON.stringify(users.body).includes("Contraseña2026!"));
  for (const [method, url, data] of [["POST", "/api/users/u-admin/status", { active: false }], ["DELETE", "/api/users/u-admin", {}], ["PATCH", "/api/users/u-admin", { role: "operations" }]]) assert.equal((await f.request(url, { method, data, session: admin })).status, method === "PATCH" ? 422 : 409);
});
test("desactivar y eliminar revoca el acceso sin perder la identidad histórica", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local");
  assert.equal((await f.request("/api/users/u-operations", { method: "DELETE", data: {}, session: admin })).status, 409);
  assert.equal((await post(f.request, admin, "/api/users/u-operations/status", { active: false })).status, 200);
  assert.equal((await f.request("/api/me", { session: ops })).status, 401);
  assert.equal((await post(f.request, admin, "/api/users/u-operations/status", { active: true })).status, 200);
  assert.equal((await post(f.request, admin, "/api/users/u-operations/status", { active: false })).status, 200);
  assert.equal((await f.request("/api/users/u-operations", { method: "DELETE", data: {}, session: admin })).status, 200);
  assert.equal((await f.request("/api/me", { session: ops })).status, 401);
  assert.equal((await post(f.request, admin, "/api/users/u-operations/status", { active: true })).status, 409);
  assert.equal(f.runtime.identity.db.prepare("SELECT archived FROM people WHERE id='u-operations'").get().archived, 1);
  assert.equal(f.runtime.identity.db.prepare("SELECT password FROM people WHERE id='u-operations'").get().password, "");
  assert(!(await f.request("/api/users", { session: admin })).body.users.some(user => user.id === "u-operations"));
  assert.equal((await f.request("/api/users/u-operations", { method: "PATCH", session: admin, data: { active: true } })).status, 409);
  const removal = (await f.request("/api/audit?action=USER_DELETED", { session: admin })).body.events[0];
  assert.equal(removal.targetId, "u-operations");
  assert.equal(removal.before.name, "Daniela · Operaciones");
  assert.equal(removal.after.archived, true);
  assert.equal((await f.request("/api/login", { method: "POST", data: { email: "operaciones@donpepe.local", password: PASSWORD } })).status, 401);
});
test("cambiar rol o sucursal revoca el ámbito anterior inmediatamente", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), store = await f.login("tienda@donpepe.local");
  assert.equal((await f.request("/api/users/u-store", { method: "PATCH", session: admin, data: { branchId: "TIENDA-2" } })).status, 200);
  assert.equal((await f.request("/api/me", { session: store })).status, 401);
  const renewed = await f.login("tienda@donpepe.local"); assert.equal(renewed.user.branchId, "TIENDA-2");
});
test("contraseña propia exige actual, no se repite y cierra sesiones", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local");
  assert.equal((await post(f.request, ops, "/api/profile/password", { currentPassword: "incorrecta", password: "NuevaPassword2026!", confirmation: "NuevaPassword2026!" })).status, 403);
  assert.equal((await post(f.request, ops, "/api/profile/password", { currentPassword: PASSWORD, password: PASSWORD, confirmation: PASSWORD })).status, 422);
  assert.equal((await post(f.request, ops, "/api/profile/password", { currentPassword: PASSWORD, password: "NuevaPassword2026!", confirmation: "OtraPassword2026!" })).status, 422);
  assert.equal((await post(f.request, ops, "/api/profile/password", { currentPassword: PASSWORD, password: "NuevaPassword2026!", confirmation: "NuevaPassword2026!" })).status, 200);
  assert.equal((await f.request("/api/me", { session: ops })).status, 401);
  const user = f.runtime.identity.db.prepare("SELECT * FROM people WHERE id='u-operations'").get();
  await assert.rejects(f.runtime.identity.passwordHash(user, PASSWORD), /cinco anteriores/);
});
test("se conservan exactamente cinco hashes de contraseñas anteriores", async t => {
  const f = await fixture(t), identity = f.runtime.identity;
  for (let index = 0; index < 6; index++) {
    const user = identity.db.prepare("SELECT * FROM people WHERE id='u-store'").get();
    const hash = await identity.passwordHash(user, `HistoriaSegura${index}!`);
    identity.transaction(() => identity.changePassword(user, hash));
  }
  const user = identity.db.prepare("SELECT * FROM people WHERE id='u-store'").get();
  assert.equal(identity.db.prepare("SELECT COUNT(*) n FROM password_history WHERE user_id='u-store'").get().n, 5);
  await assert.rejects(identity.passwordHash(user, "HistoriaSegura0!"), /cinco anteriores/);
  assert.equal(typeof await identity.passwordHash(user, PASSWORD), "string");
});
test("Gmail propio requiere contraseña y prueba de propiedad sin reemplazar el anterior", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local");
  assert.equal((await post(f.request, ops, "/api/profile/recovery-email", { email: "usuario@gmail.com", currentPassword: "incorrecta" })).status, 403);
  assert.equal((await post(f.request, ops, "/api/profile/recovery-email", { email: "usuario@empresa.com", currentPassword: PASSWORD })).status, 422);
  const token = await linkGmail(f, ops, "primer.usuario@gmail.com");
  assert.equal((await f.request("/api/recovery-email/verify", { method: "POST", data: { token } })).status, 410);
  const pending = await post(f.request, ops, "/api/profile/recovery-email", { email: "segundo.usuario@gmail.com", currentPassword: PASSWORD }); assert.equal(pending.status, 200);
  assert.equal(pending.body.user.recoveryEmail, "primer.usuario@gmail.com"); assert.equal(pending.body.user.pendingRecoveryEmail, "segundo.usuario@gmail.com");
  const next = tokenOf(f.messages.at(-1)); assert.ok(!JSON.stringify(pending.body).includes(next));
  assert.equal(f.runtime.identity.db.prepare("SELECT hash FROM security_tokens WHERE hash=?").get(hashToken(next)).hash, hashToken(next));
  assert.equal((await f.request("/api/recovery-email/verify", { method: "POST", data: { token: next } })).status, 200);
  const profile = await f.request("/api/profile", { session: ops }); assert.equal(profile.body.user.recoveryEmail, "segundo.usuario@gmail.com");
});
test("admin no puede redirigir el Gmail ya verificado de otro usuario", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local");
  await linkGmail(f, ops, "dueno.personal@gmail.com");
  assert.equal((await f.request("/api/users/u-operations", { method: "PATCH", session: admin, data: { recoveryEmail: "administrador.distinto@gmail.com" } })).status, 409);
});
test("recuperación anti-enumeración genera notificación y espera aprobación", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local");
  await linkGmail(f, ops, "recuperar.personal@gmail.com");
  const known = await f.request("/api/password-recovery", { method: "POST", data: { email: "operaciones@donpepe.local" } });
  const unknown = await f.request("/api/password-recovery", { method: "POST", data: { email: "nadie@donpepe.local" } });
  assert.deepEqual(known.body, unknown.body); assert.equal(f.messages.length, 1);
  assert.equal((await f.request("/api/me", { session: admin })).body.pendingRecoveries, 1);
  const requests = await f.request("/api/recoveries", { session: admin }); assert.equal(requests.body.requests[0].status, "PENDING");
  assert.equal((await post(f.request, ops, `/api/recoveries/${requests.body.requests[0].id}/approve`, {})).status, 403);
});
test("aprobar envía al Gmail propio; enlace de un uso cambia clave y revoca sesiones", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local");
  await linkGmail(f, ops, "enlace.personal@gmail.com");
  await f.request("/api/password-recovery", { method: "POST", data: { email: ops.user.email } });
  const list = await f.request("/api/recoveries", { session: admin }), id = list.body.requests[0].id;
  const approved = await post(f.request, admin, `/api/recoveries/${id}/approve`, {}); assert.equal(approved.status, 200);
  assert.equal(f.messages.at(-1).to, "enlace.personal@gmail.com"); const token = tokenOf(f.messages.at(-1));
  assert.ok(!JSON.stringify(approved.body).includes(token));
  assert.equal((await f.request(`/api/password-reset/validate?token=${token}`)).status, 200);
  assert.equal((await f.request("/api/password-reset", { method: "POST", data: { token, password: PASSWORD, confirmation: PASSWORD } })).status, 422);
  assert.equal((await f.request("/api/password-reset", { method: "POST", data: { token, password: "AccesoRecuperado2026!", confirmation: "AccesoRecuperado2026!" } })).status, 200);
  assert.equal((await f.request("/api/me", { session: ops })).status, 401);
  assert.equal((await f.request(`/api/password-reset/validate?token=${token}`)).status, 410);
  await f.login(ops.user.email, "AccesoRecuperado2026!");
  assert.equal((await f.request("/api/recoveries", { session: admin })).body.requests[0].status, "COMPLETED");
});
test("rechazar anula enlaces aprobados sin modificar la contraseña", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local");
  await linkGmail(f, ops, "rechazo.personal@gmail.com"); await f.request("/api/password-recovery", { method: "POST", data: { email: ops.user.email } });
  const id = (await f.request("/api/recoveries", { session: admin })).body.requests[0].id;
  await post(f.request, admin, `/api/recoveries/${id}/approve`, {}); const token = tokenOf(f.messages.at(-1));
  assert.equal((await post(f.request, admin, `/api/recoveries/${id}/reject`, { reason: "Solicitud no reconocida por el propietario." })).status, 200);
  assert.equal((await f.request(`/api/password-reset/validate?token=${token}`)).status, 410); await f.login(ops.user.email);
});
test("correo no verificado no permite aprobar; caducidad invalida token", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local");
  await f.request("/api/password-recovery", { method: "POST", data: { email: ops.user.email } }); const id = (await f.request("/api/recoveries", { session: admin })).body.requests[0].id;
  assert.equal((await post(f.request, admin, `/api/recoveries/${id}/approve`, {})).status, 409);
  await post(f.request, ops, "/api/profile/recovery-email", { email: "caduca.personal@gmail.com", currentPassword: PASSWORD }); const token = tokenOf(f.messages.at(-1));
  f.runtime.identity.db.prepare("UPDATE security_tokens SET expires=?").run(Date.now() - 1);
  assert.equal((await f.request(`/api/recovery-email/verify?token=${token}`)).status, 410);
});
test("error SMTP se registra sin filtrar credenciales ni entregar token útil", async t => {
  const f = await fixture(t, { mailFails: true }), admin = await f.login("admin@donpepe.local");
  f.runtime.identity.db.prepare("UPDATE people SET recovery_email='fallo.personal@gmail.com',recovery_verified=1 WHERE id='u-operations'").run();
  await f.request("/api/password-recovery", { method: "POST", data: { email: "operaciones@donpepe.local" } }); const id = (await f.request("/api/recoveries", { session: admin })).body.requests[0].id;
  const approval = await post(f.request, admin, `/api/recoveries/${id}/approve`, {}); assert.equal(approval.status, 503); assert.ok(!JSON.stringify(approval).includes("PRIVATE SMTP"));
  const request = (await f.request("/api/recoveries", { session: admin })).body.requests[0]; assert.equal(request.deliveryStatus, "ERROR");
  const token = tokenOf(f.messages.at(-1)); assert.equal((await f.request(`/api/password-reset/validate?token=${token}`)).status, 410);
});
test("administrador único recupera con Gmail previamente verificado sin segundo admin ficticio", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"); await linkGmail(f, admin, "administrador.personal@gmail.com");
  await f.request("/api/password-recovery", { method: "POST", data: { email: admin.user.email } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.messages.at(-1).to, "administrador.personal@gmail.com"); assert.match(f.messages.at(-1).subject, /Recupera/);
  assert.equal((await f.request(`/api/password-reset/validate?token=${tokenOf(f.messages.at(-1))}`)).status, 200);
});
test("CSRF, origen ajeno y acceso anónimo no permiten mutaciones", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local");
  assert.equal((await f.request("/api/users")).status, 401);
  assert.equal((await f.request("/api/users/u-store/status", { method: "POST", data: { active: false }, headers: { cookie: admin.cookie } })).status, 403);
  assert.equal((await f.request("/api/password-recovery", { method: "POST", data: { email: "a@b.com" }, headers: { origin: "https://sitio-ajeno.example" } })).status, 403);
  assert.equal((await f.request("/api/profile", { method: "PATCH", session: admin, data: { role: "operations", name: "Intento de rol" } })).status, 422);
});
test("auditoría no expone hashes, tokens ni contraseñas", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local");
  await linkGmail(f, ops, "auditoria.personal@gmail.com");
  const audit = await f.request("/api/audit", { session: admin }); assert.equal(audit.status, 200); assert.ok(audit.body.events.length > 0);
  const output = JSON.stringify(audit.body); assert.ok(!output.includes(PASSWORD)); assert.ok(!output.includes("$2")); assert.ok(!output.includes(tokenOf(f.messages.at(-1))));
});
test("la configuración SMTP pública queda enmascarada y no existe destinatario global", () => {
  const mail = createRecoveryMail({ env: { SMTP_HOST: "smtp.gmail.com", SMTP_USER: "ejemplo.personal@gmail.com", SMTP_PASS: "SECRET_APP_PASSWORD", MAIL_FROM: "DonPepe <ejemplo.personal@gmail.com>", RECOVERY_OVERRIDE_EMAIL: "otro@gmail.com" } });
  const status = JSON.stringify(mail.status()); assert.ok(!status.includes("SECRET_APP_PASSWORD")); assert.ok(!status.includes("ejemplo.personal@gmail.com")); assert.ok(!status.includes("otro@gmail.com")); assert.equal(mail.status().configured, true); mail.close();
});
test("la migración de identidad es aditiva y conserva cuentas y sesiones anteriores", t => {
  const directory = mkdtempSync(join(tmpdir(), "donpepe-identity-migration-")), filename = join(directory, "identity.sqlite");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const old = new DatabaseSync(filename);
  old.exec("CREATE TABLE people(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','operations','store')),branch_id TEXT,active INTEGER NOT NULL DEFAULT 1); CREATE TABLE web_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES people(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL)");
  const hash = bcrypt.hashSync(PASSWORD, 10);
  old.prepare("INSERT INTO people VALUES(?,?,?,?,?,?,?)").run("preservado", "Administrador conservado", "conservado@donpepe.local", hash, "admin", null, 1);
  old.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run("token-previo", "preservado", "csrf-previo", Date.now() + 10000); old.close();
  const migrated = createIdentityStore(filename);
  assert.equal(migrated.db.prepare("SELECT COUNT(*) n FROM people").get().n, 1);
  assert.equal(migrated.db.prepare("SELECT password FROM people WHERE id='preservado'").get().password, hash);
  assert.equal(migrated.db.prepare("SELECT COUNT(*) n FROM web_sessions").get().n, 1);
  assert.equal(migrated.publicUser(migrated.db.prepare("SELECT * FROM people").get()).recoveryVerified, false);
  migrated.close();
  const reopened = createIdentityStore(filename); assert.ok(reopened.grants("admin").includes("identity.users.manage")); reopened.close();
});
test("un Gmail verificado no puede compartirse entre identidades", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), store = await f.login("tienda@donpepe.local");
  await linkGmail(f, ops, "propietario.unico@gmail.com");
  assert.equal((await post(f.request, store, "/api/profile/recovery-email", { email: "propietario.unico@gmail.com", currentPassword: PASSWORD })).status, 409);
});
test("desactivar una cuenta hace inutilizables sus enlaces aprobados", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local");
  await linkGmail(f, ops, "desactivado.personal@gmail.com"); await f.request("/api/password-recovery", { method: "POST", data: { email: ops.user.email } });
  const id = (await f.request("/api/recoveries", { session: admin })).body.requests[0].id;
  await post(f.request, admin, `/api/recoveries/${id}/approve`, {}); const token = tokenOf(f.messages.at(-1));
  await post(f.request, admin, "/api/users/u-operations/status", { active: false });
  assert.equal((await f.request(`/api/password-reset/validate?token=${token}`)).status, 410);
});
test("la recuperación pública limita intentos sin revelar si la cuenta existe", async t => {
  const f = await fixture(t);
  for (let i = 0; i < 12; i++) assert.equal((await f.request("/api/password-recovery", { method: "POST", data: { email: "inexistente@donpepe.local" } })).status, 200);
  assert.equal((await f.request("/api/password-recovery", { method: "POST", data: { email: "inexistente@donpepe.local" } })).status, 429);
});

function testPhoto(width = 64, height = width, noisy = false) {
  const data = noisy ? crypto.randomBytes(width * height * 4) : Buffer.alloc(width * height * 4, 156);
  for (let index = 3; index < data.length; index += 4) data[index] = 255;
  return PNG.sync.write({ width, height, data }, { colorType: 6 });
}
const pngDataUrl = buffer => `data:image/png;base64,${buffer.toString("base64")}`;
test("avatar decodifica píxeles reales y rechaza archivos falsos, animados o sobredimensionados", () => {
  const valid = normalizeAvatar(pngDataUrl(testPhoto()));
  assert.equal(valid.width, 64); assert.equal(valid.height, 64); assert.equal(valid.mime, "image/png");
  assert.equal(PNG.sync.read(valid.data).data.length, 64 * 64 * 4);
  const corrupt = testPhoto(); corrupt[corrupt.length - 8] ^= 1;
  const interlaced = testPhoto(); interlaced[28] = 1;
  const huge = testPhoto(); huge.writeUInt32BE(50000, 16);
  const anim = Buffer.from([0, 0, 0, 8, 97, 99, 84, 76, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const animated = Buffer.concat([testPhoto().subarray(0, 33), anim, testPhoto().subarray(33)]);
  for (const input of [pngDataUrl(Buffer.from("<svg><script>alert(1)</script></svg>")), "data:image/svg+xml;base64,PHN2Zy8+", "file:///etc/passwd", pngDataUrl(corrupt), pngDataUrl(interlaced), pngDataUrl(huge), pngDataUrl(animated), pngDataUrl(testPhoto(32)), pngDataUrl(testPhoto(64, 96)), pngDataUrl(Buffer.concat([testPhoto(), Buffer.from("<html>extra</html>")]))]) assert.throws(() => normalizeAvatar(input), { status: 422 });
  assert.throws(() => normalizeAvatar(pngDataUrl(Buffer.alloc(MAX_AVATAR_BYTES + 1))), { status: 413 });
});
test("foto propia: subir, reemplazar y quitar con contenido PNG privado y CSRF", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local"), store = await f.login("tienda@donpepe.local");
  assert.equal(ops.user.avatarUrl, null);
  const dataUrl = pngDataUrl(testPhoto(256, 256, true)); assert.ok(dataUrl.length > 64 * 1024);
  const uploaded = await f.request("/api/profile/avatar", { method: "PUT", session: ops, data: { dataUrl } });
  assert.equal(uploaded.status, 200, JSON.stringify(uploaded.body)); assert.match(uploaded.body.user.avatarUrl, /^\/api\/avatars\/u-operations\?v=[a-f0-9]{24}$/);
  const url = uploaded.body.user.avatarUrl;
  assert.equal((await fetch(f.base + url)).status, 401);
  assert.equal((await fetch(f.base + url, { headers: { cookie: store.cookie } })).status, 404);
  const photo = await fetch(f.base + url, { headers: { cookie: ops.cookie } });
  assert.equal(photo.status, 200); assert.equal(photo.headers.get("content-type"), "image/png"); assert.match(photo.headers.get("cache-control"), /no-store/); assert.equal(photo.headers.get("x-content-type-options"), "nosniff");
  assert.equal(PNG.sync.read(Buffer.from(await photo.arrayBuffer())).width, 256);
  assert.equal((await fetch(f.base + url, { headers: { cookie: admin.cookie } })).status, 200);
  assert.equal((await f.request("/api/profile/avatar", { method: "PUT", headers: { cookie: ops.cookie }, data: { dataUrl } })).status, 403);
  assert.equal((await f.request("/api/profile/avatar", { method: "PUT", session: ops, data: { dataUrl, userId: "u-admin" } })).status, 422);
  const replaced = await f.request("/api/profile/avatar", { method: "PUT", session: ops, data: { dataUrl: pngDataUrl(testPhoto(128)) } });
  assert.equal(replaced.status, 200); assert.notEqual(replaced.body.user.avatarUrl, url);
  assert.equal(f.runtime.identity.db.prepare("SELECT COUNT(*) n FROM profile_avatars WHERE user_id='u-operations'").get().n, 1);
  const deleted = await f.request("/api/profile/avatar", { method: "DELETE", session: ops, data: {} });
  assert.equal(deleted.status, 200); assert.equal(deleted.body.user.avatarUrl, null); assert.equal((await fetch(f.base + url, { headers: { cookie: ops.cookie } })).status, 404);
  assert.equal((await f.request("/api/profile/avatar", { method: "DELETE", session: ops, data: {} })).status, 200);
});
test("la foto no se publica como archivo arbitrario y una imagen inválida conserva la anterior", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local");
  const uploaded = await f.request("/api/profile/avatar", { method: "PUT", session: ops, data: { dataUrl: pngDataUrl(testPhoto()) } });
  const before = uploaded.body.user.avatarUrl;
  assert.equal((await f.request("/api/profile/avatar", { method: "PUT", session: ops, data: { dataUrl: "data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==" } })).status, 422);
  assert.equal((await f.request("/api/me", { session: ops })).body.user.avatarUrl, before);
  assert.equal((await fetch(f.base + "/api/avatars/..%2F..%2F.env", { headers: { cookie: ops.cookie } })).status, 404);
  const audit = f.runtime.identity.db.prepare("SELECT details FROM security_audit WHERE action='PROFILE_PHOTO_UPDATED'").get();
  assert.ok(!audit.details.includes("base64"));
});
test("el avatar persiste dentro de identity.sqlite sin directorio público de subidas", t => {
  const directory = mkdtempSync(join(tmpdir(), "donpepe-avatar-persistence-")), filename = join(directory, "identity.sqlite");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const first = createIdentityStore(filename), image = normalizeAvatar(pngDataUrl(testPhoto()));
  first.db.prepare("INSERT INTO profile_avatars VALUES(?,?,?,?,?,?,?)").run("u-admin", image.data, image.mime, image.width, image.height, image.version, Date.now()); first.close();
  const second = createIdentityStore(filename), user = second.publicUser(second.db.prepare("SELECT * FROM people WHERE id='u-admin'").get());
  assert.ok(user.avatarUrl.includes(image.version)); assert.equal(second.db.prepare("SELECT length(data) n FROM profile_avatars").get().n, image.data.length); second.close();
});

test("administración gestiona fotos individuales con PNG seguro, privacidad, CSRF e historial", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local"), store = await f.login("tienda@donpepe.local"), data = { dataUrl: pngDataUrl(testPhoto(256, 256, true)) };
  for (const actor of [ops, store]) assert.equal((await f.request("/api/users/u-admin/avatar", { method: "PUT", session: actor, data })).status, 403);
  assert.equal((await f.request("/api/users/u-operations/avatar", { method: "PUT", headers: { cookie: admin.cookie }, data })).status, 403);
  const uploaded = await f.request("/api/users/u-operations/avatar", { method: "PUT", session: admin, data }); assert.equal(uploaded.status, 200); assert.ok(uploaded.body.user.avatarUrl);
  assert.equal((await fetch(f.base + uploaded.body.user.avatarUrl, { headers: { cookie: store.cookie } })).status, 404);
  assert.equal((await f.request("/api/users/u-operations/avatar", { method: "PUT", session: admin, data: { dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" } })).status, 422);
  assert.equal((await f.request("/api/users/u-operations/avatar", { method: "DELETE", session: admin, data: {} })).body.user.avatarUrl, null);
  const history = (await f.request("/api/audit?action=USER_PHOTO_UPDATED", { session: admin })).body.events[0]; assert.equal(history.targetLabel, ops.user.name); assert.equal(history.before.avatarUrl, null); assert.ok(history.after.avatarUrl); assert.ok(!JSON.stringify(history).includes("base64"));
  await post(f.request, admin, "/api/users/u-operations/status", { active: false });
  assert.equal((await f.request("/api/users/u-operations", { method: "DELETE", session: admin, data: {} })).status, 200);
  assert.equal((await f.request("/api/users/u-operations/avatar", { method: "PUT", session: admin, data })).status, 409);
});

test("auditoría presenta cambios, responsables, correlación y paginación filtrada sin datos sensibles", async t => {
  const f = await fixture(t), admin = await f.login("admin@donpepe.local"), ops = await f.login("operaciones@donpepe.local");
  const state = (await f.request("/api/state", { session: admin })).body;
  const configured = await post(f.request, admin, "/api/commands", { type: "config.asset.configure", payload: { id: "ASSET-AMR-1", commandId: "audit-device-eco", expectedRevision: state.configuration.revision, settings: { speedProfile: "ECO" } } }); assert.equal(configured.status, 200);
  const response = await f.request("/api/audit?action=COMMAND_EXECUTED&outcome=SUCCESS&actorId=u-admin&q=AMR&page=1&limit=1", { session: admin });
  assert.equal(response.status, 200); assert.equal(response.body.events.length, 1); assert.equal(response.body.limit, 1); assert.ok(response.body.total >= 1); assert.ok(response.body.filters.actions.includes("COMMAND_EXECUTED"));
  const event = response.body.events[0]; assert.equal(event.actorName, admin.user.name); assert.equal(event.correlationId, "audit-device-eco"); assert.ok(event.changes.some(change => change.field === "settings.speedProfile" && change.before === "NORMAL" && change.after === "ECO"));
  const replay = await post(f.request, admin, "/api/commands", { type: "config.asset.configure", payload: { id: "ASSET-AMR-1", commandId: "audit-device-eco", expectedRevision: state.configuration.revision, settings: { speedProfile: "ECO" } } }); assert.equal(replay.status, 200); assert.deepEqual(replay.body.result, configured.body.result);
  const replayLog = (await f.request("/api/audit?action=COMMAND_REPLAYED", { session: admin })).body.events; assert.equal(replayLog.length, 1); assert.equal(replayLog[0].details.replayed, true); assert.deepEqual(replayLog[0].changes, []);
  for (const query of ["page=0", "limit=10000", "from=2026-02-30", "from=2026-10-20&to=2026-10-01"]) assert.equal((await f.request(`/api/audit?${query}`, { session: admin })).status, 422);
  assert.equal((await f.request("/api/audit", { session: ops })).status, 403);
  f.runtime.identity.audit(admin.user, "REDACTION_TEST", "u-admin", { password: PASSWORD, token: "secret-token", nested: { smtpPassword: "smtp-secret", currentPassword: "also-secret" } });
  const redacted = await f.request("/api/audit?action=REDACTION_TEST", { session: admin }); const encoded = JSON.stringify(redacted.body); for (const secret of [PASSWORD, "secret-token", "smtp-secret", "also-secret", "$2"]) assert.ok(!encoded.includes(secret));
});

test("API exige evidencia de la célula autónoma y no admite recepción o inspección manual de un proceso gestionado", async t => {
  const f = await fixture(t), ops = await f.login("operaciones@donpepe.local"), admin = await f.login("admin@donpepe.local"), create = await post(f.request, ops, "/api/commands", { type: "purchase.create", payload: { supplierId: "PROV-1", lines: [{ skuId: "SKU-ARROZ", cases: 2 }] } }), id = create.body.result.id;
  assert.equal((await post(f.request, ops, "/api/commands", { type: "purchase.arrive", payload: { id } })).status, 409);
  const rejected = await post(f.request, ops, "/api/commands", { type: "purchase.receive", payload: { id, lines: [{ lineId: "LINE-1", acceptedCases: 2 }] } }); assert.equal(rejected.status, 422); assert.ok(rejected.body.fieldErrors.inspectionId);
  const state = (await f.request("/api/state", { session: ops })).body, purchase = state.purchases.find(purchase => purchase.id === id), sku = state.catalog.skus.find(sku => sku.id === "SKU-ARROZ"); assert.equal(state.metrics.warehouseCases, 360);
  const inspected = await post(f.request, ops, "/api/commands", { type: "purchase.inspect", payload: { id, mode: "SIMULATED", expectedPurchaseRevision: purchase.revision, documentNumber: "GUIA-API-001", lines: [{ lineId: "LINE-1", barcode: sku.barcode, lot: "API-FAB-2026", expiry: "2027-03-01", acceptedCases: 2, quarantineCases: 0, packaging: "OK", label: "OK", qualityDecision: "ACCEPT" }] } }); assert.equal(inspected.status, 409);
  assert.equal((await f.request("/api/state", { session: ops })).body.metrics.warehouseCases, 360);
  for (let i = 0; i < 1000 && f.runtime.simulation.snapshot({id:"qa",role:"operations"}).autonomy.jobs.find(job=>job.documentId===id).state !== "COMPLETED"; i++) f.runtime.simulation.advance(1);
  const received = (await f.request("/api/state", {session:ops})).body;
  assert.equal(received.autonomy.jobs.find(job=>job.documentId===id).state,"COMPLETED");
  assert.equal(received.metrics.warehouseCases,362);
  assert.equal(received.receipts.find(receipt=>receipt.purchaseId===id).source,"SIMULATED_DEVICE");
  const audit = (await f.request("/api/audit?action=COMMAND_REJECTED", { session: admin })).body.events; assert.ok(audit.some(event => event.details.type === "purchase.receive" && event.details.fields.includes("inspectionId")));
});
