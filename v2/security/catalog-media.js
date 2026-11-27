"use strict";
const crypto = require("node:crypto");
const { rateLimit } = require("express-rate-limit");
const { normalizeAvatar, MAX_AVATAR_BYTES } = require("./avatar");
const { problem } = require("./identity");

const MAX_CATALOG_IMAGES = 200;
const MAX_CATALOG_IMAGE_BYTES = MAX_AVATAR_BYTES;
const PATH = "/images/catalog/uploads/";
const MEDIA_KINDS = ["sku", "supplier", "category", "brand", "branch", "asset"];
const wrapped = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);

/** Register the public image handler before static files, and the private
 * upload handler after the application's session / CSRF middleware. */
function createCatalogMedia({ identity, security }) {
  const { db, transaction, audit } = identity;
  db.exec(`CREATE TABLE IF NOT EXISTS catalog_media(
    hash TEXT PRIMARY KEY CHECK(length(hash)=64),
    data BLOB NOT NULL CHECK(length(data)>0 AND length(data)<=${MAX_CATALOG_IMAGE_BYTES}),
    mime TEXT NOT NULL CHECK(mime='image/png'),
    width INTEGER NOT NULL CHECK(width BETWEEN 64 AND 1024),
    height INTEGER NOT NULL CHECK(height=width),
    first_kind TEXT NOT NULL CHECK(first_kind IN ('sku','supplier')),
    created_by TEXT NOT NULL REFERENCES people(id),
    created_at INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS catalog_media_creator ON catalog_media(created_by);`);
  const publicApps = new WeakSet(), privateApps = new WeakSet();

  function installPublic(app) {
    if (publicApps.has(app)) return;
    publicApps.add(app);
    app.get(`${PATH}:filename`, wrapped((req, res) => {
      const filename = req.params.filename;
      if (!/^[a-f0-9]{64}\.png$/.test(filename || "")) return res.status(404).json({ error: "La imagen no está disponible." });
      const hash = filename.slice(0, -4), row = db.prepare("SELECT data FROM catalog_media WHERE hash=?").get(hash);
      if (!row) return res.status(404).json({ error: "La imagen no está disponible." });
      const etag = `"${hash}"`;
      res.set({ "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="catalogo.png"', "Cache-Control": "public, max-age=31536000, immutable", ETag: etag });
      if (req.get("if-none-match")?.split(/\s*,\s*/).includes(etag)) return res.status(304).end();
      res.send(Buffer.from(row.data));
    }));
  }

  function installPrivate(app) {
    if (privateApps.has(app)) return;
    privateApps.add(app);
    app.post("/api/catalog-media", (req, res, next) => {
      if (!req.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
      if (req.user.role !== "admin") return res.status(403).json({ error: "Solo Administración puede cambiar las imágenes del catálogo." });
      if (!req.session?.csrf || req.get("x-csrf-token") !== req.session.csrf) return res.status(403).json({ error: "La sesión cambió. Recarga la página." });
      if (!req.body || Array.isArray(req.body) || typeof req.body !== "object" || Object.keys(req.body).length !== 2 || !Object.hasOwn(req.body, "dataUrl") || !MEDIA_KINDS.includes(req.body.kind)) return res.status(422).json({ error: "Selecciona una imagen de una entidad admitida desde su formulario." });
      security.permission(`config.${req.body.kind}.manage`)(req, res, next);
    }, rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: true, legacyHeaders: false, message: { error: "Has subido varias imágenes seguidas. Espera unos minutos antes de continuar." } }), wrapped((req, res) => {
      // Reuse the independently decoded, CRC-checked, bounded PNG parser.
      // Browser normalization uses contain, never an avatar's centre crop.
      const image = normalizeAvatar(req.body.dataUrl), hash = crypto.createHash("sha256").update(image.data).digest("hex");
      const imageUrl = `${PATH}${hash}.png`;
      let created = false;
      transaction(() => {
        if (db.prepare("SELECT 1 FROM catalog_media WHERE hash=?").get(hash)) return;
        if (db.prepare("SELECT COUNT(*) n FROM catalog_media").get().n >= MAX_CATALOG_IMAGES) problem(`La biblioteca ha alcanzado ${MAX_CATALOG_IMAGES} imágenes. Reutiliza una imagen existente del catálogo.`, 409);
        // The existing storage schema distinguishes logo/photo buckets. Keep
        // its compatibility constraint; the audit retains the precise entity.
        db.prepare("INSERT INTO catalog_media(hash,data,mime,width,height,first_kind,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)").run(hash, image.data, image.mime, image.width, image.height, req.body.kind === "supplier" ? "supplier" : "sku", req.user.id, Date.now());
        audit(req.user, "CATALOG_MEDIA_UPLOADED", hash, { kind: req.body.kind, width: image.width, height: image.height });
        created = true;
      });
      res.status(created ? 201 : 200).json({ ok: true, imageUrl, width: image.width, height: image.height });
    }));
  }
  return { installPublic, installPrivate };
}

function installCatalogMedia(app, { identity, security, phase = "all" }) {
  const media = createCatalogMedia({ identity, security });
  if (phase === "public" || phase === "all") media.installPublic(app);
  if (phase === "private" || phase === "all") media.installPrivate(app);
  return media;
}

module.exports = { createCatalogMedia, installCatalogMedia, MAX_CATALOG_IMAGES, MAX_CATALOG_IMAGE_BYTES };
