const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validatePasswordPolicy } = require("../services/passwordService");

const source = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("la política de clave exige longitud, clases y el límite real de bcrypt", () => {
  assert.doesNotThrow(() => validatePasswordPolicy("ClaveNueva123"));
  for (const password of ["Corta1a", "sinmayuscula123", "SINMINUSCULA123", "SinNumeroAA",
    `LargoAa1${"é".repeat(35)}`])
    assert.throws(() => validatePasswordPolicy(password));
});

test("admin y recuperación comparten verificación de contraseña anterior", () => {
  const policy = source("services/passwordService.js");
  assert.match(policy, /bcrypt\.compare\(password, hash\)/);
  assert.match(source("services/userService.js"), /setNewPassword\(conn, targetId, data\.password\)/);
  assert.match(source("services/userRequestService.js"), /setNewPassword\(conn, request\.usuario_id, password\)/);
  assert.match(source("routes/index.js"), /router\.post\(\s*"\/mi-clave",\s*requireAuth/);
});

test("el directorio no muestra hashes y ofrece sustitución segura", () => {
  const directoryQuery = source("models/User.js").match(/static all\(\) \{([\s\S]*?)\n  \}/)?.[1];
  assert(directoryQuery);
  assert.doesNotMatch(directoryQuery, /password/);
  assert.match(source("views/usuarios/form.ejs"), /Protegida y no visible/);
  assert.match(source("database/init.sql"), /CREATE TABLE IF NOT EXISTS historial_contrasenas/);
});
