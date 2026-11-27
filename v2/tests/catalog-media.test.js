"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { mkdtempSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { pathToFileURL } = require("node:url");
const crypto = require("node:crypto");
const express = require("express");
const { PNG } = require("pngjs");
const { createIdentityStore } = require("../security/identity");
const { createSecurityRoutes } = require("../security/routes");
const { createCatalogMedia, MAX_CATALOG_IMAGES, MAX_CATALOG_IMAGE_BYTES } = require("../security/catalog-media");

const csrf = "catalog-test-csrf";
function photo(size = 64, red = 145, level = 6) {
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = red; data[i + 1] = 120; data[i + 2] = 70; data[i + 3] = 255; }
  return PNG.sync.write({ width: size, height: size, data }, { colorType: 6, deflateLevel: level });
}
const dataUrl = buffer => `data:image/png;base64,${buffer.toString("base64")}`;
async function fixture(t, filename = ":memory:") {
  const identity = createIdentityStore(filename);
  const security = createSecurityRoutes({ identity, simulation: {}, mail: {} });
  const media = createCatalogMedia({ identity, security }), app = express();
  app.use(express.json({ limit: "3mb" }));
  app.use((req, res, next) => {
    const user = identity.db.prepare("SELECT * FROM people WHERE role=? AND active=1 AND archived=0").get(req.get("x-test-role") || "");
    if (user) { req.user = identity.publicUser(user); req.session = { csrf }; }
    next();
  });
  media.installPublic(app);
  media.installPrivate(app);
  app.use((req, res) => res.status(404).json({ error: "Recurso no encontrado." }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await new Promise(resolve => server.close(resolve)); identity.close(); };
  t.after(close);
  const upload = async (body, role = "admin", token = csrf) => {
    const response = await fetch(`${base}/api/catalog-media`, { method: "POST", headers: { "content-type": "application/json", ...(role ? { "x-test-role": role } : {}), ...(token ? { "x-csrf-token": token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  return { identity, media, base, upload, close };
}

test("una foto real se decodifica, sirve como PNG y reutiliza su huella sin duplicar datos", async t => {
  const f = await fixture(t), first = await f.upload({ kind: "sku", dataUrl: dataUrl(photo(256)) });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.match(first.body.imageUrl, /^\/images\/catalog\/uploads\/[a-f0-9]{64}\.png$/);
  assert.equal(first.body.width, 256);
  const response = await fetch(f.base + first.body.imageUrl);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.match(response.headers.get("cache-control"), /immutable/);
  const buffer = Buffer.from(await response.arrayBuffer()), decoded = PNG.sync.read(buffer);
  assert.equal(decoded.width, 256); assert.equal(decoded.data[0], 145);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  assert.ok(first.body.imageUrl.endsWith(`${hash}.png`));
  const second = await f.upload({ kind: "supplier", dataUrl: dataUrl(photo(256, 145, 9)) });
  assert.equal(second.status, 200); assert.equal(second.body.imageUrl, first.body.imageUrl);
  assert.equal(f.identity.db.prepare("SELECT COUNT(*) n FROM catalog_media").get().n, 1);
  const audits = f.identity.db.prepare("SELECT details FROM security_audit WHERE action='CATALOG_MEDIA_UPLOADED'").all();
  assert.equal(audits.length, 1);
  const details = JSON.parse(audits[0].details);
  assert.deepEqual({ kind: details.kind, width: details.width, height: details.height }, { kind: "sku", width: 256, height: 256 });
  assert.equal(details.actorName, f.identity.db.prepare("SELECT name FROM people WHERE id='u-admin'").get().name);
  assert.equal(details.targetLabel, hash);
  assert.match(details.correlationId, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(details.before, null); assert.equal(details.after, null); assert.deepEqual(details.changes, []);
  assert.ok(!audits[0].details.includes("data:image"), "La auditoría no debe guardar el contenido de la fotografía.");
  assert.equal((await fetch(f.base + first.body.imageUrl, { headers: { "if-none-match": response.headers.get("etag") } })).status, 304);
});

test("subir imágenes exige administrador, permiso del catálogo correspondiente y CSRF", async t => {
  const f = await fixture(t), body = { kind: "sku", dataUrl: dataUrl(photo()) };
  assert.equal((await f.upload(body, null)).status, 401);
  for (const role of ["operations", "store"]) assert.equal((await f.upload(body, role)).status, 403);
  assert.equal((await f.upload(body, "admin", null)).status, 403);
  assert.equal((await f.upload(body, "admin", "expired")).status, 403);
  f.identity.db.prepare("DELETE FROM role_grants WHERE role='admin' AND permission='config.sku.manage'").run();
  assert.equal((await f.upload(body)).status, 403);
  assert.equal((await f.upload({ ...body, kind: "supplier" })).status, 201);
  assert.equal(f.identity.db.prepare("SELECT COUNT(*) n FROM catalog_media").get().n, 1);
});

test("categorías, marcas, tiendas y activos admiten imágenes sólo con su permiso administrativo específico", async t => {
  const f = await fixture(t);
  for (const [index, kind] of ["category", "brand", "branch", "asset"].entries()) {
    const body = { kind, dataUrl: dataUrl(photo(64, 150 + index)) };
    const created = await f.upload(body);
    assert.equal(created.status, 201, `${kind}: ${JSON.stringify(created.body)}`);
    assert.equal((await fetch(f.base + created.body.imageUrl)).status, 200);
    assert.equal((await f.upload(body, "operations")).status, 403);
    f.identity.db.prepare("DELETE FROM role_grants WHERE role='admin' AND permission=?").run(`config.${kind}.manage`);
    assert.equal((await f.upload(body)).status, 403);
  }
  const kinds = f.identity.db.prepare("SELECT details FROM security_audit WHERE action='CATALOG_MEDIA_UPLOADED'").all().map(row => JSON.parse(row.details).kind).sort();
  assert.deepEqual(kinds, ["asset", "brand", "branch", "category"].sort());
});

test("rechaza imágenes falsas, rutas arbitrarias, campos extra y tamaños peligrosos sin escribir archivos", async t => {
  const f = await fixture(t), valid = dataUrl(photo());
  const corrupt = photo(); corrupt[corrupt.length - 8] ^= 1;
  const huge = photo(); huge.writeUInt32BE(50000, 16);
  for (const body of [
    { kind: "unknown-kind", dataUrl: valid },
    { kind: "sku", dataUrl: valid, filename: "../../config.env" },
    { kind: "sku", dataUrl: "https://example.com/photo.jpg" },
    { kind: "sku", dataUrl: "file:///etc/passwd" },
    { kind: "sku", dataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
    { kind: "sku", dataUrl: dataUrl(Buffer.from("not a PNG")) },
    { kind: "sku", dataUrl: dataUrl(corrupt) },
    { kind: "sku", dataUrl: dataUrl(huge) },
    { kind: "sku", dataUrl: dataUrl(Buffer.concat([photo(), Buffer.from("<script>extra</script>")])) },
  ]) assert.equal((await f.upload(body)).status, 422, JSON.stringify(body).slice(0, 90));
  assert.equal((await f.upload({ kind: "sku", dataUrl: dataUrl(Buffer.alloc(MAX_CATALOG_IMAGE_BYTES + 1)) })).status, 413);
  assert.equal(f.identity.db.prepare("SELECT COUNT(*) n FROM catalog_media").get().n, 0);
  for (const url of ["/images/catalog/uploads/not-a-hash.png", `/images/catalog/uploads/${"f".repeat(64)}.png`, "/images/catalog/uploads/..%2F..%2F.env"]) assert.equal((await fetch(f.base + url)).status, 404);
});

test("la biblioteca tiene capacidad acotada y permite reutilizar una foto aun cuando esté llena", async t => {
  const f = await fixture(t), body = { kind: "sku", dataUrl: dataUrl(photo()) }, first = await f.upload(body);
  const insert = f.identity.db.prepare("INSERT INTO catalog_media VALUES(?,?,'image/png',64,64,'sku','u-admin',?)");
  f.identity.transaction(() => {
    for (let i = 1; i < MAX_CATALOG_IMAGES; i++) insert.run(crypto.createHash("sha256").update(`fixture-${i}`).digest("hex"), photo(), Date.now());
  });
  assert.equal((await f.upload(body)).body.imageUrl, first.body.imageUrl);
  const rejected = await f.upload({ kind: "sku", dataUrl: dataUrl(photo(64, 180)) });
  assert.equal(rejected.status, 409); assert.match(rejected.body.error, /200 imágenes/);
  assert.equal(f.identity.db.prepare("SELECT COUNT(*) n FROM catalog_media").get().n, MAX_CATALOG_IMAGES);
});

test("la foto persiste al reabrir identity.sqlite y no requiere un directorio público escribible", async t => {
  const directory = mkdtempSync(join(tmpdir(), "donpepe-catalog-media-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, "identity.sqlite"), first = await fixture(t, filename);
  const uploaded = await first.upload({ kind: "supplier", dataUrl: dataUrl(photo(128)) });
  await first.close();
  const second = await fixture(t, filename), response = await fetch(second.base + uploaded.body.imageUrl);
  assert.equal(response.status, 200);
  assert.equal(PNG.sync.read(Buffer.from(await response.arrayBuffer())).width, 128);
  assert.equal(second.identity.db.prepare("SELECT COUNT(*) n FROM catalog_media").get().n, 1);
});

test("normalización de catálogo conserva todo el envase y la proporción de los logotipos", async t => {
  const { normalizeCatalogPhoto } = await import(pathToFileURL(join(__dirname, "../frontend/catalog-upload.js")));
  const originalBitmap = global.createImageBitmap, originalDocument = global.document;
  t.after(() => { global.createImageBitmap = originalBitmap; global.document = originalDocument; });
  let closed = 0, options, draw, fills = 0, dimensions = [0, 0];
  global.createImageBitmap = async () => ({ width: 200, height: 800, close() { closed++; } });
  global.document = { createElement() { return {
    set width(value) { dimensions[0] = value; }, set height(value) { dimensions[1] = value; },
    getContext(type, value) { options = value; return { fillRect() { fills++; }, drawImage(...args) { draw = args; } }; },
    toDataURL() { return dataUrl(photo()); },
  }; } };
  await normalizeCatalogPhoto({ type: "image/jpeg", size: 1200 });
  assert.deepEqual(dimensions, [768, 768]); assert.equal(options.alpha, false); assert.equal(fills, 1);
  assert.deepEqual(draw.slice(1), [294, 24, 180, 720]); // Full portrait, no source crop.
  global.createImageBitmap = async () => ({ width: 1200, height: 200, close() { closed++; } });
  await normalizeCatalogPhoto({ type: "image/png", size: 1200 }, true);
  assert.equal(options.alpha, true); assert.equal(fills, 1);
  assert.deepEqual(draw.slice(1), [24, 324, 720, 120]);
  assert.equal(closed, 2);
});

test("normalización avisa sobre formatos y dimensiones y libera la imagen decodificada", async t => {
  const { normalizeCatalogPhoto } = await import(pathToFileURL(join(__dirname, "../frontend/catalog-upload.js")));
  const originalBitmap = global.createImageBitmap;
  t.after(() => { global.createImageBitmap = originalBitmap; });
  let decoded = 0, closed = 0;
  global.createImageBitmap = async () => { decoded++; return { width: 8000, height: 8000, close() { closed++; } }; };
  await assert.rejects(normalizeCatalogPhoto({ type: "image/svg+xml", size: 500 }), /JPG, PNG o WebP/);
  await assert.rejects(normalizeCatalogPhoto({ type: "image/png", size: 11 * 1024 * 1024 }), /10 MB/);
  assert.equal(decoded, 0);
  await assert.rejects(normalizeCatalogPhoto({ type: "image/png", size: 500 }), /36 megapíxeles/);
  assert.equal(closed, 1);
});
