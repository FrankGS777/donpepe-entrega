"use strict";
const { timeFields } = require("../core/time");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { DatabaseSync } = require("node:sqlite");
const { ROLE_NAMES, ROLE_CEILINGS, DEFAULT_GRANTS, effectivePermissions } = require("./policy");
const { redact, changes } = require("./audit");
const DEMO_PASSWORD = "DonPepe2026!";
const hashToken = value => crypto.createHash("sha256").update(value).digest("hex");
const newToken = () => crypto.randomBytes(32).toString("hex");
const problem = (message, status = 422) => { const error = new Error(message); error.status = status; error.expose = true; throw error; };
function requireText(value, label, min = 1, max = 120) {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) problem(`${label}: introduce un texto entre ${min} y ${max} caracteres.`);
  return value.trim();
}
function emailAddress(value, gmail = false) {
  const email = requireText(value, gmail ? "Correo de recuperación" : "Correo", 5, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (gmail && !/^[a-z0-9][a-z0-9.+_-]*@gmail\.com$/.test(email))) problem(gmail ? "Introduce un correo personal de Gmail válido." : "Introduce un correo válido.");
  return email;
}
function validatePassword(value, confirmation) {
  if (typeof value !== "string" || value.length < 12 || Buffer.byteLength(value) > 72 || !/[A-Z]/.test(value) || !/[a-z]/.test(value) || !/\d/.test(value) || !/[^\p{L}\p{N}\s]/u.test(value) || /[\u0000-\u001f\u007f]/.test(value)) problem("La contraseña debe tener al menos 12 caracteres y un máximo de 72 bytes, con mayúscula, minúscula, número y símbolo.");
  if (confirmation !== undefined && value !== confirmation) problem("Las contraseñas no coinciden.");
  return value;
}
function createIdentityStore(filename, cloud = null) {
  if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS people(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','operations','store')),branch_id TEXT,active INTEGER NOT NULL DEFAULT 1);
    CREATE UNIQUE INDEX IF NOT EXISTS singleton_admin ON people(role) WHERE role='admin';
    CREATE TABLE IF NOT EXISTS web_sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES people(id),csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS role_grants(role TEXT NOT NULL,permission TEXT NOT NULL,PRIMARY KEY(role,permission));
    CREATE TABLE IF NOT EXISTS password_history(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT NOT NULL REFERENCES people(id),password TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS recovery_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES people(id),status TEXT NOT NULL DEFAULT 'PENDING',delivery_status TEXT NOT NULL DEFAULT 'NOT_SENT',created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,decided_at INTEGER,completed_at INTEGER,reason TEXT,delivery_error TEXT,last_sent_at INTEGER,decided_by TEXT);
    CREATE TABLE IF NOT EXISTS security_tokens(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES people(id),purpose TEXT NOT NULL,request_id TEXT REFERENCES recovery_requests(id),email TEXT,expires INTEGER NOT NULL,used_at INTEGER,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS security_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,actor_id TEXT,action TEXT NOT NULL,target_id TEXT,outcome TEXT NOT NULL,details TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS profile_avatars(user_id TEXT PRIMARY KEY REFERENCES people(id),data BLOB NOT NULL,mime TEXT NOT NULL CHECK(mime='image/png'),width INTEGER NOT NULL,height INTEGER NOT NULL,version TEXT NOT NULL,updated_at INTEGER NOT NULL);`);
  const columns = new Set(db.prepare("PRAGMA table_info(people)").all().map(c => c.name));
  for (const [name, type] of Object.entries({ recovery_email: "TEXT", recovery_verified: "INTEGER NOT NULL DEFAULT 0", pending_recovery_email: "TEXT", archived: "INTEGER NOT NULL DEFAULT 0", updated_at: "INTEGER", password_changed_at: "INTEGER" })) if (!columns.has(name)) db.exec(`ALTER TABLE people ADD COLUMN ${name} ${type}`);
  const peopleCount = db.prepare("SELECT COUNT(*) n FROM people").get().n;
  if (cloud) {
    try {
      const provisioned = db.prepare("SELECT 1 FROM security_meta WHERE key='cloud_identity_v1'").get();
      if (peopleCount && !provisioned) throw new Error("Para publicar, usa una base de identidad nueva o restaura una copia del entorno publicado.");
      if (!peopleCount) {
        const email = emailAddress(cloud.adminEmail);
        const password = validatePassword(cloud.adminPassword);
        if (password === DEMO_PASSWORD) throw new Error("La contraseña inicial debe ser exclusiva de este entorno.");
        db.exec("BEGIN IMMEDIATE");
        try {
          db.prepare("INSERT INTO people(id,name,email,password,role) VALUES(?,?,?,?,?)").run("u-admin", "Administración DonPepe", email, bcrypt.hashSync(password, 12), "admin");
          db.prepare("INSERT INTO security_meta VALUES('cloud_identity_v1','1')").run();
          db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
      }
    } catch (error) { db.close(); throw error; }
  } else if (!peopleCount) {
    const insert = db.prepare("INSERT INTO people(id,name,email,password,role,branch_id) VALUES(?,?,?,?,?,?)");
    const password = bcrypt.hashSync(DEMO_PASSWORD, 10);
    insert.run("u-admin", "Alex · Administración", "admin@donpepe.local", password, "admin", null);
    insert.run("u-operations", "Daniela · Operaciones", "operaciones@donpepe.local", password, "operations", null);
    insert.run("u-store", "Lucía · Tienda", "tienda@donpepe.local", password, "store", "TIENDA-1");
  }
  if (!db.prepare("SELECT value FROM security_meta WHERE key='grants_seeded_v1'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const grant = db.prepare("INSERT OR IGNORE INTO role_grants VALUES(?,?)");
      for (const [role, permissions] of Object.entries(DEFAULT_GRANTS)) for (const permission of permissions) grant.run(role, permission);
      db.prepare("INSERT INTO security_meta VALUES('grants_seeded_v1','1')").run(); db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  db.prepare("INSERT OR IGNORE INTO security_meta VALUES('grants_revision','1')").run();
  if (!db.prepare("SELECT value FROM security_meta WHERE key='store_requests_grants_v2'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM role_grants WHERE role='operations' AND permission='order.create'").run();
      db.prepare("INSERT OR IGNORE INTO role_grants VALUES('admin','inventory.summary.read')").run();
      db.prepare("INSERT INTO security_meta VALUES('store_requests_grants_v2','1')").run();
      db.prepare("UPDATE security_meta SET value=CAST(value AS INTEGER)+1 WHERE key='grants_revision'").run();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (!db.prepare("SELECT value FROM security_meta WHERE key='catalog_asset_governance_v3'").get()) {
    transactionGrantUpgrade();
  }
  if (!db.prepare("SELECT value FROM security_meta WHERE key='controlled_receiving_v4'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try { if (db.prepare("SELECT 1 FROM role_grants WHERE role='operations' AND permission='purchase.receive'").get()) db.prepare("INSERT OR IGNORE INTO role_grants VALUES('operations','purchase.inspect')").run(); db.prepare("INSERT INTO security_meta VALUES('controlled_receiving_v4','1')").run(); db.prepare("UPDATE security_meta SET value=CAST(value AS INTEGER)+1 WHERE key='grants_revision'").run(); db.exec("COMMIT"); }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (!db.prepare("SELECT value FROM security_meta WHERE key='autonomy_grants_v5'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      // New capabilities inherit an existing responsibility once. A revoked
      // parent or a later revoked child is never silently restored on restart.
      const links = {
        admin: { "inventory.summary.read": ["autonomy.read"], "config.settings.manage": ["config.autonomy.manage"] },
        operations: { "inventory.read": ["autonomy.read"], "purchase.create": ["autonomy.authorize"], "order.release": ["autonomy.authorize"], "incident.resolve": ["autonomy.exception.resolve"] },
        store: { "inventory.read": ["autonomy.read"] },
      };
      const has = db.prepare("SELECT 1 FROM role_grants WHERE role=? AND permission=?"), insert = db.prepare("INSERT OR IGNORE INTO role_grants VALUES(?,?)");
      for (const [role, parents] of Object.entries(links)) for (const [parent, children] of Object.entries(parents)) if (has.get(role, parent)) for (const child of children) if (ROLE_CEILINGS[role].includes(child)) insert.run(role, child);
      db.prepare("INSERT INTO security_meta VALUES('autonomy_grants_v5','1')").run();
      db.prepare("UPDATE security_meta SET value=CAST(value AS INTEGER)+1 WHERE key='grants_revision'").run();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function transactionGrantUpgrade() {
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare("INSERT OR IGNORE INTO role_grants VALUES(?,?)");
      // New capabilities follow an existing entitlement. A deliberately revoked
      // parent permission must not reappear as a broader grant after migration.
      const linked = { admin: { "config.sku.manage": ["config.brand.manage", "config.category.manage"], "config.settings.manage": ["config.asset.manage", "maintenance.read", "maintenance.manage", "maintenance.request"] }, operations: { "equipment.fault": ["maintenance.read", "maintenance.request"], "purchase.create": ["purchase.cancel"] }, store: { "order.create": ["order.edit"] } };
      for (const [role, parents] of Object.entries(linked)) for (const [parent, children] of Object.entries(parents)) if (db.prepare("SELECT 1 FROM role_grants WHERE role=? AND permission=?").get(role, parent)) for (const permission of children) if (ROLE_CEILINGS[role].includes(permission)) insert.run(role, permission);
      db.prepare("INSERT INTO security_meta VALUES('catalog_asset_governance_v3','1')").run();
      db.prepare("UPDATE security_meta SET value=CAST(value AS INTEGER)+1 WHERE key='grants_revision'").run();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (!db.prepare("SELECT value FROM security_meta WHERE key='official_store_requests_v7'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM role_grants WHERE permission='simulation.request'").run();
      db.prepare("INSERT INTO security_meta VALUES('official_store_requests_v7','1')").run();
      db.prepare("UPDATE security_meta SET value=CAST(value AS INTEGER)+1 WHERE key='grants_revision'").run();
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  if (!db.prepare("SELECT value FROM security_meta WHERE key='supplier_claims_v1'").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const links={admin:{"config.settings.manage":["supplierClaim.read","supplierClaim.settle"]},operations:{"incident.resolve":["supplierClaim.read","supplierClaim.manage"]}};
      for(const [role,parents] of Object.entries(links))for(const [parent,children]of Object.entries(parents))if(db.prepare("SELECT 1 FROM role_grants WHERE role=? AND permission=?").get(role,parent))for(const child of children)db.prepare("INSERT OR IGNORE INTO role_grants VALUES(?,?)").run(role,child);
      db.prepare("INSERT INTO security_meta VALUES('supplier_claims_v1','1')").run();db.prepare("UPDATE security_meta SET value=CAST(value AS INTEGER)+1 WHERE key='grants_revision'").run();db.exec("COMMIT");
    } catch(error){db.exec("ROLLBACK");throw error;}
  }
  const grants = role => effectivePermissions(role, db.prepare("SELECT permission FROM role_grants WHERE role=?").all(role).map(r => r.permission));
  const publicUser = u => {
    if (!u) return u;
    const avatar = db.prepare("SELECT version FROM profile_avatars WHERE user_id=?").get(u.id);
    return { id: u.id, name: u.name, email: u.email, role: u.role, roleName: ROLE_NAMES[u.role], branchId: u.branch_id, active: !!u.active, archived: !!u.archived, recoveryEmail: u.recovery_email || "", recoveryVerified: !!u.recovery_verified, pendingRecoveryEmail: u.pending_recovery_email || "", permissions: grants(u.role), avatarUrl: avatar && !u.archived ? `/api/avatars/${encodeURIComponent(u.id)}?v=${avatar.version}` : null, updatedAt: u.updated_at ? new Date(u.updated_at).toISOString() : null };
  };
  const contexts = new WeakMap();
  const setAuditContext = (actor, context) => { if (actor && typeof actor === "object") contexts.set(actor, context); };
  const hasAuditEvent = actor => !!(actor && contexts.get(actor)?.recorded);
  const auditUser = id => { const row = db.prepare("SELECT id,name,email,role,branch_id,active,archived,recovery_email,recovery_verified FROM people WHERE id=?").get(id || ""); return row ? { id: row.id, name: row.name, email: row.email, role: row.role, branchId: row.branch_id, active: !!row.active, archived: !!row.archived, recoveryEmail: row.recovery_email || "", recoveryVerified: !!row.recovery_verified, avatarUrl: publicUser(row).avatarUrl } : null; };
  const auditEntity = id => {
    const person = auditUser(id); if (person) return person;
    if (Object.hasOwn(ROLE_NAMES, id || "")) return { id, name: ROLE_NAMES[id], permissions: grants(id) };
    const recovery = db.prepare("SELECT r.id,r.status,r.delivery_status,r.user_id,p.name FROM recovery_requests r JOIN people p ON p.id=r.user_id WHERE r.id=?").get(id || "");
    return recovery ? { id: recovery.id, name: `${recovery.name} · Recuperación`, userId: recovery.user_id, status: recovery.status, deliveryStatus: recovery.delivery_status } : null;
  };
  const audit = (actor, action, target, details = {}, outcome = "SUCCESS") => {
    const recordedAt = Date.now();
    const context = actor && contexts.get(actor) || {}, after = Object.hasOwn(details, "after") ? details.after : outcome === "SUCCESS" ? auditEntity(target) : null;
    const before = Object.hasOwn(details, "before") ? details.before : context.targetId === target ? context.before : null;
    const safe = redact({ ...details, ...timeFields(recordedAt), actorRole: actor?.role || (actor?.id === "AUTOMATION" ? "automation" : "public"), branchId: actor?.branchId || details.branchId || null, method: context.method || null, requestPath: context.path || null, actorName: details.actorName || auditUser(actor?.id)?.name || actor?.name || "Acceso público", targetLabel: details.targetLabel || after?.name || before?.name || (typeof target === "string" ? target : "Acceso al sistema"), correlationId: details.correlationId || context.correlationId || crypto.randomUUID(), before, after });
    if (actor?.id && !actor.role) { const person = auditUser(actor.id); if (person) { safe.actorRole = person.role; safe.branchId ||= person.branchId; } }
    safe.changes = changes(safe.before, safe.after);
    context.recorded = true;
    return db.prepare("INSERT INTO security_audit(at,actor_id,action,target_id,outcome,details) VALUES(?,?,?,?,?,?)").run(recordedAt, actor?.id || null, action, typeof target === "string" ? target : null, outcome, JSON.stringify(safe));
  };
  const revoke = userId => db.prepare("DELETE FROM web_sessions WHERE user_id=?").run(userId);
  const transaction = fn => { db.exec("BEGIN IMMEDIATE"); try { const result = fn(); db.exec("COMMIT"); return result; } catch (e) { db.exec("ROLLBACK"); throw e; } };
  async function passwordHash(user, password, confirmation) {
    validatePassword(password, confirmation);
    const hashes = user ? [user.password, ...db.prepare("SELECT password FROM password_history WHERE user_id=? ORDER BY id DESC LIMIT 5").all(user.id).map(h => h.password)] : [];
    for (const hash of hashes) if (await bcrypt.compare(password, hash)) problem("La contraseña debe ser distinta de la actual y de las cinco anteriores.");
    return bcrypt.hash(password, 10);
  }
  function changePassword(user, hash) {
    const current = db.prepare("SELECT * FROM people WHERE id=?").get(user.id);
    if (!current || current.password !== user.password) problem("La cuenta cambió mientras editabas. Vuelve a intentarlo.", 409);
    db.prepare("INSERT INTO password_history(user_id,password,created_at) VALUES(?,?,?)").run(user.id, current.password, Date.now());
    db.prepare("DELETE FROM password_history WHERE user_id=? AND id NOT IN (SELECT id FROM password_history WHERE user_id=? ORDER BY id DESC LIMIT 5)").run(user.id, user.id);
    db.prepare("UPDATE people SET password=?,password_changed_at=?,updated_at=? WHERE id=?").run(hash, Date.now(), Date.now(), user.id);
    db.prepare("UPDATE security_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL").run(Date.now(), user.id);
    db.prepare("UPDATE recovery_requests SET status='EXPIRED' WHERE user_id=? AND status IN ('PENDING','APPROVED')").run(user.id);
    revoke(user.id);
  }
  return { db, publicUser, grants, audit, auditUser, auditEntity, setAuditContext, hasAuditEvent, revoke, transaction, passwordHash, changePassword, close: () => db.close() };
}
module.exports = { createIdentityStore, hashToken, newToken, problem, requireText, emailAddress, validatePassword, ROLE_NAMES, ROLE_CEILINGS };
