process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) =>
  fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("el login formal expone recuperación, pero no permite crear cuentas", () => {
  const login = read("views/auth/login.ejs");
  assert.match(login, /\/cuenta\/recuperar/);
  assert.doesNotMatch(login, /\/cuenta\/solicitar/);
  assert.match(login, /autocomplete="username"/);
  assert.match(login, /autocomplete="current-password"/);
  assert.doesNotMatch(login, /admin123|Demo:/i);
});

test("la recuperación no revela si una cuenta existe y queda bajo aprobación", () => {
  const service = read("services/userRequestService.js");
  const routes = read("routes/accountRequests.js");
  assert.match(service, /return \{ accepted: true \}/);
  assert.match(service, /tipo='RESET_PASSWORD'/);
  assert.doesNotMatch(routes, /cuenta\/solicitar/);
  assert.doesNotMatch(service, /requestAccess/);
});

test("los enlaces de cuenta son aleatorios, hasheados, temporales y de un uso", () => {
  const service = read("services/userRequestService.js");
  assert.match(service, /randomBytes\(32\)/);
  assert.match(service, /createHash\("sha256"\)/);
  assert.match(service, /token_expira_en>NOW\(\)/);
  assert.match(service, /estado='COMPLETADA',token_hash=NULL/);
  assert.match(service, /estado IN \('APROBADA','EXPIRADA'\)/);
});

test("la aprobación entrega el enlace por SMTP y registra el resultado", () => {
  const service = read("services/userRequestService.js");
  const mail = read("services/emailService.js");
  const schema = read("database/init.sql");
  assert.match(mail, /nodemailer\.createTransport/);
  assert.match(mail, /sendMail/);
  assert.match(service, /sendPasswordReset/);
  assert.match(service, /env\.appUrl/);
  assert.match(service, /envio_estado='ENVIADO'/);
  assert.match(service, /envio_estado='ERROR'/);
  assert.match(schema, /envio_estado ENUM/);
});

test("las tres interfaces usan el sistema visual propio sin Bootstrap", () => {
  for (const layout of ["main", "auth", "rf"]) {
    const source = read(`views/layouts/${layout}.ejs`);
    assert.match(source, /\/css\/ui\.css/);
    assert.match(source, /\/js\/ui\.js/);
    assert.doesNotMatch(source, /bootstrap/i);
  }
});
