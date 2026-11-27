"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { createApp } = require("../server");
const { copyDatabases } = require("../scripts/backup-data.cjs");

const origin = "https://donpepe.example.test";
const adminEmail = "qa@donpepe.example.test";
const adminPassword = "Test-Sprint4-Cuenta-2026!";
const cloudEnv = { DONPEPE_MODE: "cloud", DONPEPE_PUBLIC_URL: origin, DONPEPE_ADMIN_EMAIL: adminEmail, DONPEPE_ADMIN_PASSWORD: adminPassword };

async function serve(runtime, work) {
  const server = runtime.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = (url, options) => fetch(`http://127.0.0.1:${server.address().port}${url}`, options);
  try { await work(request); } finally {
    await new Promise(resolve => server.close(resolve));
    runtime.close();
  }
}

function login(request, email, password, requestOrigin = origin) {
  return request("/api/login", { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
}

test("nube exige HTTPS, separa las cuentas demo y restaura una copia de ambas bases", async () => {
  const root = await mkdtemp(join(tmpdir(), "donpepe-release-"));
  const options = { startClock: false, mailEnv: {} };
  const demoDir = join(root, "demo");
  const cloudDir = join(root, "cloud");
  const restored = join(root, "restored");
  try {
    assert.throws(() => createApp({ ...options, dataDir: cloudDir, env: { ...cloudEnv, DONPEPE_PUBLIC_URL: "http://example.test" } }), /HTTPS/);
    assert.throws(() => createApp({ ...options, dataDir: cloudDir, env: { ...cloudEnv, DONPEPE_ADMIN_PASSWORD: "" } }), /contraseña/);
    createApp({ ...options, dataDir: demoDir, env: { DONPEPE_MODE: "demo" } }).close();
    assert.throws(() => createApp({ ...options, dataDir: demoDir, env: cloudEnv }), /base de identidad nueva/);
    const runtime = createApp({ ...options, dataDir: cloudDir, env: cloudEnv });
    assert.equal(runtime.identity.db.prepare("SELECT COUNT(*) n FROM people").get().n, 1);
    let cookie;
    await serve(runtime, async request => {
      assert.equal((await request("/health")).status, 200);
      assert.equal((await login(request, adminEmail, adminPassword, "https://otra.example.test")).status, 403);
      const session = await login(request, adminEmail, adminPassword);
      assert.equal(session.status, 200);
      const header = session.headers.get("set-cookie");
      for (const flag of [/; Secure/, /; HttpOnly/, /; SameSite=Strict/]) assert.match(header, flag);
      cookie = header.split(";")[0];
    });
    await copyDatabases(cloudDir, restored);
    await assert.rejects(copyDatabases(cloudDir, restored), { code: "EEXIST" });
    const reopened = createApp({ ...options, dataDir: restored, env: { ...cloudEnv, DONPEPE_ADMIN_PASSWORD: "" } });
    await serve(reopened, async request => {
      assert.equal((await request("/api/me", { headers: { cookie } })).status, 200);
      assert.equal((await request("/api/state", { headers: { cookie } })).status, 200);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("el mapa negocia compresión y sólo omite un plano idéntico autorizado", async () => {
  const runtime = createApp({ identityFile: ":memory:", simulationFile: ":memory:", startClock: false, mailEnv: {} });
  runtime.identity.db.prepare("UPDATE people SET password=? WHERE role='operations'").run(await require("bcryptjs").hash(adminPassword, 10));
  await serve(runtime, async request => {
    const localSession = await request("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "operaciones@donpepe.local", password: adminPassword }) });
    assert.equal(localSession.status, 200);
    const headers = { cookie: localSession.headers.get("set-cookie").split(";")[0], "Accept-Encoding": "gzip" };
    const first = await request("/api/state?layout=include", { headers });
    assert.equal(first.headers.get("content-encoding"), "gzip");
    assert.equal(first.headers.get("cache-control"), "no-store");
    const full = await first.json();
    assert.ok(full.layout.locations.length > 0);
    const repeat = await (await request(`/api/state?layout=${full.meta.layoutTag}`, { headers })).json();
    assert.equal(repeat.layout, undefined);
    const fallback = await (await request("/api/state?layout=00000000000000000000000000000000", { headers })).json();
    assert.deepEqual(fallback.layout, full.layout);
  });
});
