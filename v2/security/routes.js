"use strict";
const { timeFields } = require("../core/time");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const { PERMISSIONS, ROLE_NAMES, ROLE_CEILINGS, effectivePermissions, can, assertCommandAllowed } = require("./policy");
const { hashToken, newToken, problem, requireText, emailAddress } = require("./identity");
const { normalizeAvatar } = require("./avatar");
const GENERIC_RECOVERY = "Si la cuenta existe y está habilitada, registraremos la solicitud. El enlace se enviará exclusivamente al Gmail personal previamente verificado cuando se autorice.";
const mandatory = ["profile.manage", "overview.view", "catalog.read"];
const iso = value => value ? new Date(value).toISOString() : null;
const wrapped = fn => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next);
function createSecurityRoutes({ identity, simulation, mail, publicUrl }) {
  const { db, audit, publicUser, transaction } = identity;
  const permission = required => (req, res, next) => {
    if (!can(req.user, required)) {
      audit(req.user, "ACCESS_DENIED", required, { method: req.method }, "DENIED");
      return res.status(403).json({ error: "Tu perfil no tiene permiso para esta acción." });
    }
    next();
  };
  const account = id => { const user = db.prepare("SELECT * FROM people WHERE id=?").get(id); if (!user) problem("La cuenta no existe.", 404); return user; };
  const activeBranch = branchId => simulation.snapshot({ id: "identity-branch-validation", role: "admin" }).catalog.branches.some(branch => branch.id === branchId && branch.active !== false && !branch.archived);
  const requireActiveBranch = (role, branchId) => { if (role === "store" && !activeBranch(branchId)) problem("La sucursal ya no está activa. Selecciona otra antes de habilitar la cuenta.", 409); };
  const invalidateRecovery = userId => {
    db.prepare("UPDATE security_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL").run(Date.now(), userId);
    db.prepare("UPDATE recovery_requests SET status='EXPIRED' WHERE user_id=? AND status IN ('PENDING','APPROVED')").run(userId);
  };
  function baseUrl(req) {
    if (publicUrl) return publicUrl.replace(/\/$/, "");
    const host = req.get("host");
    if (/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host || "")) return `${req.secure ? "https" : "http"}://${host}`;
    return "http://localhost:3010";
  }
  function expireRequests() {
    db.prepare("UPDATE recovery_requests SET status='EXPIRED' WHERE status IN ('PENDING','APPROVED') AND expires_at<?").run(Date.now());
  }
  const publicRecovery = row => {
    const user = account(row.user_id);
    return { id: row.id, userId: user.id, userName: user.name, email: user.email, recoveryEmail: user.recovery_email || "", recoveryVerified: !!user.recovery_verified, status: row.status, deliveryStatus: row.delivery_status, createdAt: iso(row.created_at), expiresAt: iso(row.expires_at), decidedAt: iso(row.decided_at), completedAt: iso(row.completed_at), reason: row.reason || "", deliveryError: row.delivery_error || "", decidedBy: row.decided_by };
  };
  function tokenRow(raw, purpose) {
    if (typeof raw !== "string" || !/^[a-f0-9]{64}$/.test(raw)) problem("El enlace no es válido o ya venció.", 410);
    const row = db.prepare("SELECT * FROM security_tokens WHERE hash=? AND purpose=? AND used_at IS NULL AND expires>?").get(hashToken(raw), purpose, Date.now());
    if (!row) problem("El enlace no es válido, ya se utilizó o venció. Solicita uno nuevo.", 410);
    const user = account(row.user_id);
    if (!user.active || user.archived) problem("El enlace no está disponible para esta cuenta.", 410);
    if (purpose === "PASSWORD_RESET") {
      const request = db.prepare("SELECT * FROM recovery_requests WHERE id=?").get(row.request_id);
      if (!request || request.status !== "APPROVED" || request.delivery_status !== "SENT" || !user.recovery_verified || user.recovery_email !== row.email) problem("El enlace ya no está autorizado. Solicita una recuperación nueva.", 410);
    } else if (user.pending_recovery_email !== row.email) problem("Este correo pendiente cambió. Solicita otra confirmación.", 410);
    return { token: row, user };
  }
  async function deliverRecovery(request, actor, req) {
    const user = account(request.user_id);
    if (!user.active || user.archived || !user.recovery_verified || !user.recovery_email) problem("La cuenta necesita un Gmail personal verificado para enviar un enlace de recuperación.", 409);
    if (request.last_sent_at && Date.now() - request.last_sent_at < 60000) problem("Espera un minuto antes de reenviar el correo.", 429);
    const token = newToken(), expires = Date.now() + 30 * 60000;
    transaction(() => {
      db.prepare("UPDATE security_tokens SET used_at=? WHERE user_id=? AND purpose='PASSWORD_RESET' AND used_at IS NULL").run(Date.now(), user.id);
      db.prepare("UPDATE recovery_requests SET status='EXPIRED' WHERE user_id=? AND id<>? AND status IN ('PENDING','APPROVED')").run(user.id, request.id);
      db.prepare("INSERT INTO security_tokens(hash,user_id,purpose,request_id,email,expires,created_at) VALUES(?,?,'PASSWORD_RESET',?,?,?,?)").run(hashToken(token), user.id, request.id, user.recovery_email, expires, Date.now());
      db.prepare("UPDATE recovery_requests SET status='APPROVED',delivery_status='NOT_SENT',delivery_error=NULL,decided_at=?,decided_by=?,expires_at=?,last_sent_at=? WHERE id=?").run(Date.now(), actor?.id || "SELF_SERVICE", expires, Date.now(), request.id);
    });
    try {
      await mail.send({ to: user.recovery_email, name: user.name, url: `${baseUrl(req)}/reset-password?token=${token}`, kind: "reset" });
      db.prepare("UPDATE recovery_requests SET delivery_status='SENT' WHERE id=?").run(request.id);
      audit(actor, "RECOVERY_EMAIL_SENT", request.id, { userId: user.id });
    } catch {
      db.prepare("UPDATE security_tokens SET used_at=? WHERE hash=?").run(Date.now(), hashToken(token));
      db.prepare("UPDATE recovery_requests SET delivery_status='ERROR',delivery_error=? WHERE id=?").run("No se pudo entregar el correo. Revisa la configuración SMTP y reintenta; no se ha cambiado la contraseña.", request.id);
      audit(actor, "RECOVERY_EMAIL_FAILED", request.id, { userId: user.id }, "ERROR");
      problem("No se pudo enviar el correo. La solicitud sigue registrada; revisa SMTP y reintenta después de un minuto.", 503);
    }
  }
  const publicLimiter = rateLimit({ windowMs: 15 * 60000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { error: "Se alcanzó el límite de solicitudes. Intenta de nuevo en unos minutos." } });
  function installPublic(app) {
    app.post("/api/password-recovery", publicLimiter, wrapped(async (req, res) => {
      expireRequests();
      const input = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const user = input.length <= 120 ? db.prepare("SELECT * FROM people WHERE email=? AND active=1 AND archived=0").get(input) : null;
      if (user) {
        const previous = db.prepare("SELECT * FROM recovery_requests WHERE user_id=? AND status IN ('PENDING','APPROVED') AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(user.id, Date.now());
        if (!previous) {
          const id = crypto.randomUUID();
          db.prepare("INSERT INTO recovery_requests(id,user_id,created_at,expires_at) VALUES(?,?,?,?)").run(id, user.id, Date.now(), Date.now() + 24 * 3600000);
          audit(null, "RECOVERY_REQUESTED", id, { userId: user.id });
          // A unique administrator cannot wait for approval from a nonexistent
          // second administrator. Previously verified mailbox possession is the
          // independent factor; this explicit exception never creates an admin.
          if (user.role === "admin" && user.recovery_verified) {
            const request = db.prepare("SELECT * FROM recovery_requests WHERE id=?").get(id);
            audit(null, "ADMIN_SELF_SERVICE_RECOVERY", id);
            setImmediate(() => deliverRecovery(request, null, req).catch(() => {}));
          }
        }
      }
      res.json({ ok: true, message: GENERIC_RECOVERY });
    }));
    app.get("/api/password-reset/validate", publicLimiter, wrapped((req, res) => { const row = tokenRow(req.query.token, "PASSWORD_RESET"); res.json({ valid: true, expiresAt: iso(row.token.expires) }); }));
    app.post("/api/password-reset", publicLimiter, wrapped(async (req, res) => {
      const { token, user } = tokenRow(req.body.token, "PASSWORD_RESET");
      if (typeof req.body.confirmation !== "string") problem("Repite la nueva contraseña para confirmarla.");
      const hash = await identity.passwordHash(user, req.body.password, req.body.confirmation);
      transaction(() => {
        tokenRow(req.body.token, "PASSWORD_RESET");
        identity.changePassword(user, hash);
        db.prepare("UPDATE recovery_requests SET status='COMPLETED',completed_at=? WHERE id=?").run(Date.now(), token.request_id);
        audit({ id: user.id }, "PASSWORD_RECOVERED", user.id);
      });
      res.clearCookie("dpv2", { path: "/" });
      res.json({ ok: true, message: "Contraseña actualizada. Todas las sesiones anteriores se cerraron. Inicia sesión de nuevo." });
    }));
    app.get("/api/recovery-email/verify", publicLimiter, wrapped((req, res) => { const row = tokenRow(req.query.token, "RECOVERY_EMAIL"); res.json({ valid: true, expiresAt: iso(row.token.expires) }); }));
    app.post("/api/recovery-email/verify", publicLimiter, wrapped((req, res) => {
      const { token, user } = tokenRow(req.body.token, "RECOVERY_EMAIL");
      if (db.prepare("SELECT id FROM people WHERE recovery_email=? AND recovery_verified=1 AND archived=0 AND id<>?").get(token.email, user.id)) problem("Este Gmail ya está vinculado a otra cuenta.", 409);
      transaction(() => {
        db.prepare("UPDATE people SET recovery_email=?,recovery_verified=1,pending_recovery_email=NULL,updated_at=? WHERE id=?").run(token.email, Date.now(), user.id);
        db.prepare("UPDATE security_tokens SET used_at=? WHERE user_id=? AND used_at IS NULL").run(Date.now(), user.id);
        db.prepare("UPDATE recovery_requests SET status='EXPIRED' WHERE user_id=? AND status IN ('PENDING','APPROVED')").run(user.id);
        audit({ id: user.id }, "RECOVERY_EMAIL_VERIFIED", user.id);
      });
      res.json({ ok: true, message: "Gmail personal verificado. Los próximos enlaces de recuperación se enviarán a este correo." });
    }));
  }
  function installPrivate(app) {
    app.get("/api/profile", permission("profile.manage"), (req, res) => res.json({ user: publicUser(account(req.user.id)), security: { passwordMinimumLength: 12, passwordHistory: 5, resetMinutes: 30, recoveryApproval: req.user.role === "admin" ? "verified-mailbox-self-service" : "administrator" }, mail: { configured: mail.status().configured } }));
    app.get("/api/avatars/:id", wrapped((req, res) => {
      if (req.params.id !== req.user.id && !can(req.user, "identity.users.read")) return res.status(404).json({ error: "La foto no está disponible." });
      const avatar = db.prepare("SELECT a.data,a.mime FROM profile_avatars a JOIN people p ON p.id=a.user_id WHERE a.user_id=? AND p.archived=0").get(req.params.id);
      if (!avatar) return res.status(404).json({ error: "La foto no está disponible." });
      res.set({ "Cache-Control": "private, no-store", "Content-Type": "image/png", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="perfil.png"' });
      res.send(Buffer.from(avatar.data));
    }));
    app.put("/api/profile/avatar", permission("profile.manage"), rateLimit({ windowMs: 15 * 60000, limit: 12, standardHeaders: true, legacyHeaders: false, message: { error: "Has cambiado la foto varias veces. Espera unos minutos antes de volver a intentarlo." } }), wrapped((req, res) => {
      if (Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "dataUrl")) problem("Selecciona una foto desde tu perfil; no se admiten rutas de archivos ni imágenes de otros usuarios.");
      const avatar = normalizeAvatar(req.body.dataUrl);
      transaction(() => {
        db.prepare("INSERT INTO profile_avatars(user_id,data,mime,width,height,version,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,mime=excluded.mime,width=excluded.width,height=excluded.height,version=excluded.version,updated_at=excluded.updated_at").run(req.user.id, avatar.data, avatar.mime, avatar.width, avatar.height, avatar.version, Date.now());
        db.prepare("UPDATE people SET updated_at=? WHERE id=?").run(Date.now(), req.user.id);
        audit(req.user, "PROFILE_PHOTO_UPDATED", req.user.id, { width: avatar.width, height: avatar.height, bytes: avatar.data.length });
      });
      res.json({ ok: true, user: publicUser(account(req.user.id)) });
    }));
    app.delete("/api/profile/avatar", permission("profile.manage"), wrapped((req, res) => {
      transaction(() => {
        const removed = db.prepare("DELETE FROM profile_avatars WHERE user_id=?").run(req.user.id);
        if (removed.changes) { db.prepare("UPDATE people SET updated_at=? WHERE id=?").run(Date.now(), req.user.id); audit(req.user, "PROFILE_PHOTO_REMOVED", req.user.id); }
      });
      res.json({ ok: true, user: publicUser(account(req.user.id)) });
    }));
    app.put("/api/users/:id/avatar", permission("identity.users.manage"), rateLimit({ windowMs: 15 * 60000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Espera unos minutos antes de volver a cambiar fotografías." } }), wrapped((req, res) => {
      const user = account(req.params.id); if (user.archived) problem("La cuenta fue eliminada y no admite cambios de fotografía.", 409);
      if (Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, "dataUrl")) problem("Selecciona únicamente una fotografía para esta cuenta.");
      const avatar = normalizeAvatar(req.body.dataUrl);
      transaction(() => {
        db.prepare("INSERT INTO profile_avatars(user_id,data,mime,width,height,version,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data,mime=excluded.mime,width=excluded.width,height=excluded.height,version=excluded.version,updated_at=excluded.updated_at").run(user.id, avatar.data, avatar.mime, avatar.width, avatar.height, avatar.version, Date.now());
        db.prepare("UPDATE people SET updated_at=? WHERE id=?").run(Date.now(), user.id);
        audit(req.user, "USER_PHOTO_UPDATED", user.id, { width: avatar.width, height: avatar.height, bytes: avatar.data.length });
      });
      res.json({ ok: true, user: publicUser(account(user.id)) });
    }));
    app.delete("/api/users/:id/avatar", permission("identity.users.manage"), wrapped((req, res) => {
      const user = account(req.params.id); if (user.archived) problem("La cuenta fue eliminada y conserva su historial.", 409);
      transaction(() => { const removed = db.prepare("DELETE FROM profile_avatars WHERE user_id=?").run(user.id); if (removed.changes) { db.prepare("UPDATE people SET updated_at=? WHERE id=?").run(Date.now(), user.id); audit(req.user, "USER_PHOTO_REMOVED", user.id); } });
      res.json({ ok: true, user: publicUser(account(user.id)) });
    }));
    app.patch("/api/profile", permission("profile.manage"), wrapped((req, res) => {
      if (Object.keys(req.body).some(key => !["name"].includes(key))) problem("Desde tu perfil sólo puedes editar el nombre; usa el procedimiento protegido para contraseña o Gmail.");
      const name = requireText(req.body.name, "Nombre", 3, 100);
      db.prepare("UPDATE people SET name=?,updated_at=? WHERE id=?").run(name, Date.now(), req.user.id);
      audit(req.user, "PROFILE_UPDATED", req.user.id);
      res.json({ ok: true, user: publicUser(account(req.user.id)) });
    }));
    app.post("/api/profile/password", permission("profile.manage"), rateLimit({ windowMs: 15 * 60000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos de cambio de contraseña. Espera unos minutos." } }), wrapped(async (req, res) => {
      const user = account(req.user.id);
      if (typeof req.body.currentPassword !== "string" || Buffer.byteLength(req.body.currentPassword) > 72 || !(await bcrypt.compare(req.body.currentPassword, user.password))) problem("La contraseña actual no es correcta.", 403);
      if (typeof req.body.confirmation !== "string") problem("Repite la nueva contraseña para confirmarla.");
      const hash = await identity.passwordHash(user, req.body.password, req.body.confirmation);
      transaction(() => { identity.changePassword(user, hash); audit(req.user, "PASSWORD_CHANGED", user.id); });
      res.clearCookie("dpv2", { path: "/" }); res.json({ ok: true, logout: true, message: "Contraseña cambiada. Inicia sesión nuevamente." });
    }));
    app.post("/api/profile/recovery-email", permission("profile.manage"), rateLimit({ windowMs: 15 * 60000, limit: 6, standardHeaders: true, legacyHeaders: false, message: { error: "Espera unos minutos antes de solicitar otra confirmación." } }), wrapped(async (req, res) => {
      const user = account(req.user.id), email = emailAddress(req.body.email, true);
      if (typeof req.body.currentPassword !== "string" || Buffer.byteLength(req.body.currentPassword) > 72 || !(await bcrypt.compare(req.body.currentPassword, user.password))) problem("Confirma tu contraseña actual para cambiar el Gmail de recuperación.", 403);
      if (user.recovery_verified && email === user.recovery_email) problem("Este Gmail ya está verificado y vinculado a tu cuenta.", 409);
      if (db.prepare("SELECT id FROM people WHERE recovery_email=? AND recovery_verified=1 AND archived=0 AND id<>?").get(email, user.id)) problem("Este Gmail ya está vinculado a otra cuenta.", 409);
      const token = newToken(), expires = Date.now() + 30 * 60000;
      // Do not replace the old verified address until the new owner confirms.
      transaction(() => {
        db.prepare("UPDATE security_tokens SET used_at=? WHERE user_id=? AND purpose='RECOVERY_EMAIL' AND used_at IS NULL").run(Date.now(), user.id);
        db.prepare("UPDATE people SET pending_recovery_email=?,updated_at=? WHERE id=?").run(email, Date.now(), user.id);
        db.prepare("INSERT INTO security_tokens(hash,user_id,purpose,email,expires,created_at) VALUES(?,?,'RECOVERY_EMAIL',?,?,?)").run(hashToken(token), user.id, email, expires, Date.now());
      });
      try { await mail.send({ to: email, name: user.name, url: `${baseUrl(req)}/verify-recovery-email?token=${token}`, kind: "verification" }); }
      catch { db.prepare("UPDATE security_tokens SET used_at=? WHERE hash=?").run(Date.now(), hashToken(token)); audit(req.user, "RECOVERY_VERIFICATION_DELIVERY_FAILED", user.id, {}, "ERROR"); problem("No se pudo enviar la confirmación. El Gmail anterior no ha cambiado; revisa SMTP o reintenta más tarde.", 503); }
      audit(req.user, "RECOVERY_VERIFICATION_SENT", user.id);
      res.json({ ok: true, user: publicUser(account(user.id)), message: "Revisa el Gmail indicado y confirma el enlace. El correo anterior continúa vigente hasta entonces." });
    }));
    app.get("/api/users", permission("identity.users.read"), (req, res) => res.json({ users: db.prepare("SELECT * FROM people WHERE archived=0 ORDER BY COALESCE(updated_at,0) DESC,role,name").all().map(publicUser) }));
    async function validateAccount(body, previous) {
      const role = body.role ?? previous?.role;
      if (!Object.hasOwn(ROLE_NAMES, role) || (!previous && role === "admin") || (previous && ((previous.role === "admin") !== (role === "admin")))) problem("El administrador principal es único. No se puede crear, convertir ni degradar ese perfil.");
      const name = requireText(body.name ?? previous?.name, "Nombre", 3, 100), email = emailAddress(body.email ?? previous?.email);
      const duplicate = db.prepare("SELECT id FROM people WHERE email=? AND id<>?").get(email, previous?.id || "");
      if (duplicate) problem("Ese correo ya pertenece a una cuenta o a una identidad histórica eliminada. Usa un correo distinto.", 409);
      const branches = simulation.snapshot({ id: "identity-validation", role: "admin" }).catalog.branches;
      const branchId = role === "store" ? body.branchId ?? previous?.branch_id : null;
      if (role === "store" && !branches.some(b => b.id === branchId && b.active !== false && !b.archived)) problem("Selecciona una sucursal activa para este perfil de tienda.");
      if (body.active !== undefined && typeof body.active !== "boolean") problem("El estado de la cuenta debe ser activo o inactivo.");
      const active = body.active === undefined ? previous ? !!previous.active : true : body.active;
      if (role === "admin" && !active) problem("El administrador principal no puede desactivarse.", 409);
      let recoveryEmail = previous?.recovery_email || null, recoveryVerified = previous?.recovery_verified || 0, pendingRecoveryEmail = previous?.pending_recovery_email || null;
      if (body.recoveryEmail !== undefined) {
        const proposed = body.recoveryEmail === "" ? null : emailAddress(body.recoveryEmail, true);
        if (previous?.recovery_verified && proposed !== previous.recovery_email) problem("El Gmail verificado sólo puede cambiarlo su propietario desde Mi cuenta, con contraseña actual y validación por correo.", 409);
        if (!previous?.recovery_verified) { recoveryEmail = proposed; recoveryVerified = 0; pendingRecoveryEmail = proposed; }
      }
      const password = body.password ? await identity.passwordHash(previous, body.password, body.confirmation) : null;
      if (!previous && !password) problem("Asigna una contraseña inicial segura.");
      return { name, email, role, branchId, active, recoveryEmail, recoveryVerified, pendingRecoveryEmail, password };
    }
    app.post("/api/users", permission("identity.users.manage"), wrapped(async (req, res) => {
      const input = await validateAccount(req.body), id = crypto.randomUUID();
      requireActiveBranch(input.role, input.branchId);
      db.prepare("INSERT INTO people(id,name,email,password,role,branch_id,active,recovery_email,recovery_verified,pending_recovery_email,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(id, input.name, input.email, input.password, input.role, input.branchId, +input.active, input.recoveryEmail, input.recoveryVerified, input.pendingRecoveryEmail, Date.now());
      audit(req.user, "USER_CREATED", id, { role: input.role, branchId: input.branchId });
      res.status(201).json({ ok: true, user: publicUser(account(id)), message: "Cuenta creada. El propietario debe verificar su Gmail desde Mi cuenta." });
    }));
    app.patch("/api/users/:id", permission("identity.users.manage"), wrapped(async (req, res) => {
      const previous = account(req.params.id);
      if (previous.archived) problem("La cuenta fue eliminada; no puede editarse ni reactivarse.", 409);
      if (previous.id === req.user.id && req.body.password) problem("Para tu propia contraseña usa Mi cuenta y confirma la contraseña actual.", 409);
      const input = await validateAccount(req.body, previous);
      transaction(() => {
        requireActiveBranch(input.role, input.branchId);
        const current = account(previous.id);
        if (current.updated_at !== previous.updated_at || current.password !== previous.password || current.archived) problem("La cuenta cambió mientras editabas. Recarga antes de guardar.", 409);
        if (input.password) identity.changePassword(previous, input.password);
        db.prepare("UPDATE people SET name=?,email=?,role=?,branch_id=?,active=?,recovery_email=?,recovery_verified=?,pending_recovery_email=?,updated_at=? WHERE id=?").run(input.name, input.email, input.role, input.branchId, +input.active, input.recoveryEmail, input.recoveryVerified, input.pendingRecoveryEmail, Date.now(), previous.id);
        if (!input.active || previous.role !== input.role || previous.branch_id !== input.branchId || previous.email !== input.email) { identity.revoke(previous.id); invalidateRecovery(previous.id); }
        audit(req.user, "USER_UPDATED", previous.id, { role: input.role, branchId: input.branchId, passwordChanged: !!input.password });
      });
      res.json({ ok: true, user: publicUser(account(previous.id)) });
    }));
    app.post("/api/users/:id/status", permission("identity.users.manage"), wrapped((req, res) => {
      const user = account(req.params.id);
      if (user.role === "admin") problem("El administrador principal no puede desactivarse.", 409);
      if (user.archived) problem("La cuenta fue eliminada y no puede reactivarse.", 409);
      if (typeof req.body.active !== "boolean") problem("Selecciona el estado de la cuenta.");
      const reason = req.body.reason ? requireText(req.body.reason, "Motivo", 3, 250) : "";
      if (req.body.active) requireActiveBranch(user.role, user.branch_id);
      db.prepare("UPDATE people SET active=?,updated_at=? WHERE id=?").run(+req.body.active, Date.now(), user.id);
      identity.revoke(user.id); if (!req.body.active) invalidateRecovery(user.id); audit(req.user, req.body.active ? "USER_ACTIVATED" : "USER_DEACTIVATED", user.id, { reason });
      res.json({ ok: true, user: publicUser(account(user.id)) });
    }));
    app.delete("/api/users/:id", permission("identity.users.manage"), wrapped((req, res) => {
      const user = account(req.params.id);
      if (user.role === "admin" || user.id === req.user.id) problem("El administrador principal no puede eliminarse.", 409);
      if (user.archived) problem("Esta cuenta ya fue eliminada.", 409);
      if (user.active) problem("Desactiva la cuenta antes de eliminarla. Esta acción es irreversible.", 409);
      const reason = req.body.reason ? requireText(req.body.reason, "Motivo", 3, 250) : "Eliminación irreversible del directorio; identidad conservada para trazabilidad";
      const before = identity.auditUser(user.id);
      // Keep the identity reference for existing documents and recovery/audit
      // records. The deleted account is never listed, editable or restorable.
      transaction(() => {
        db.prepare("UPDATE people SET active=0,archived=1,password='',recovery_email=NULL,recovery_verified=0,pending_recovery_email=NULL,updated_at=? WHERE id=?").run(Date.now(), user.id);
        identity.revoke(user.id);
        invalidateRecovery(user.id);
        db.prepare("DELETE FROM password_history WHERE user_id=?").run(user.id);
        db.prepare("DELETE FROM profile_avatars WHERE user_id=?").run(user.id);
        audit(req.user, "USER_DELETED", user.id, { before, targetLabel: user.name, reason });
      });
      res.json({ ok: true, message: "Cuenta eliminada del directorio. El historial de sus operaciones se conserva." });
    }));
    app.get("/api/roles", permission("identity.roles.read"), (req, res) => res.json({ revision: Number(db.prepare("SELECT value FROM security_meta WHERE key='grants_revision'").get().value), roles: Object.keys(ROLE_NAMES).map(id => ({ id, name: ROLE_NAMES[id], permissions: identity.grants(id), ceiling: ROLE_CEILINGS[id], protected: id === "admin" })), permissions: PERMISSIONS }));
    app.put("/api/roles/:id", permission("identity.roles.manage"), wrapped((req, res) => {
      const role = req.params.id, grants = req.body.permissions;
      if (!Object.hasOwn(ROLE_CEILINGS, role)) problem("No se crean familias de rol nuevas. Selecciona uno de los tres perfiles existentes.", 404);
      if (!Array.isArray(grants) || grants.length > PERMISSIONS.length || grants.some(p => typeof p !== "string" || !ROLE_CEILINGS[role].includes(p)) || new Set(grants).size !== grants.length) problem("Los permisos exceden el ámbito permitido para este perfil. Administración no opera el almacén y los otros perfiles no gobiernan el sistema.");
      const protectedPermissions = role === "admin" ? ROLE_CEILINGS.admin : mandatory;
      if (protectedPermissions.some(p => !grants.includes(p))) problem("No pueden retirarse permisos esenciales de acceso ni bloquear al administrador principal.", 409);
      if (grants.includes("map.view") && !grants.includes("inventory.read")) problem("El mapa muestra inventario físico: habilita también la consulta de existencias o retira ambos permisos.", 409);
      if (grants.includes("purchase.receive") && !grants.includes("purchase.inspect")) problem("La recepción necesita una inspección documentada. Conserva ambos permisos o retira la confirmación de recepción.", 409);
      if (!Number.isInteger(req.body.expectedRevision) || req.body.expectedRevision < 1) problem("Recarga los permisos para obtener su versión antes de guardar.");
      let revision;
      transaction(() => {
        revision = Number(db.prepare("SELECT value FROM security_meta WHERE key='grants_revision'").get().value);
        if (revision !== req.body.expectedRevision) problem("Los permisos cambiaron desde otra sesión. Recarga antes de guardar para no sobrescribirlos.", 409);
        db.prepare("DELETE FROM role_grants WHERE role=?").run(role); const insert = db.prepare("INSERT INTO role_grants VALUES(?,?)"); for (const grant of grants) insert.run(role, grant);
        revision++; db.prepare("UPDATE security_meta SET value=? WHERE key='grants_revision'").run(String(revision));
        audit(req.user, "ROLE_PERMISSIONS_UPDATED", role, { permissions: grants, revision });
      });
      res.json({ ok: true, revision, role: { id: role, name: ROLE_NAMES[role], permissions: effectivePermissions(role, grants), ceiling: ROLE_CEILINGS[role] } });
    }));
    app.get("/api/settings", permission("settings.read"), (req, res) => {
      const snapshot = simulation.snapshot({ id: req.user.id, role: "admin" });
      res.json({ settings: snapshot.configuration?.settings || {}, revision: snapshot.configuration?.revision || 1, mail: mail.status(), security: { administratorCount: db.prepare("SELECT COUNT(*) n FROM people WHERE role='admin'").get().n, passwordHistory: 5, minimumPasswordLength: 12, tokenMinutes: 30, sessionHours: 8, roleCeilingsImmutable: true } });
    });
    app.patch("/api/settings", permission("config.settings.manage"), wrapped((req, res) => {
      assertCommandAllowed(req.user, "config.settings.update");
      const before = simulation.snapshot(req.user).configuration.settings;
      const payload = { settings: req.body.settings, expectedRevision: req.body.expectedRevision, commandId: req.body.commandId || crypto.randomUUID() };
      const result = simulation.command("config.settings.update", payload, req.user);
      audit(req.user, "CONFIG_SETTINGS_UPDATED", "scenario", { revision: result.configurationRevision, targetLabel: "Reglas del centro de distribución", before, after: simulation.snapshot(req.user).configuration.settings }); res.json({ ok: true, result });
    }));
    app.get("/api/recoveries", permission("identity.recoveries.review"), (req, res) => {
      expireRequests(); const requests = db.prepare("SELECT * FROM recovery_requests ORDER BY created_at DESC LIMIT 250").all().map(publicRecovery);
      const stats = db.prepare("SELECT SUM(status='PENDING') pending,SUM(status='APPROVED' AND delivery_status='SENT') active,SUM(delivery_status='SENT') sent,SUM(delivery_status='ERROR') errors FROM recovery_requests").get();
      res.json({ requests, stats: Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, value || 0])) });
    });
    for (const action of ["approve", "reject", "resend"]) app.post(`/api/recoveries/:id/${action}`, permission("identity.recoveries.review"), wrapped(async (req, res) => {
      expireRequests(); const request = db.prepare("SELECT * FROM recovery_requests WHERE id=?").get(req.params.id);
      if (!request) problem("La solicitud no existe.", 404);
      if (action === "reject") {
        if (!["PENDING", "APPROVED"].includes(request.status)) problem("La solicitud ya fue cerrada.", 409);
        const reason = requireText(req.body.reason || "Identidad no autorizada por Administración.", "Motivo", 3, 300);
        transaction(() => { db.prepare("UPDATE recovery_requests SET status='REJECTED',reason=?,decided_at=?,decided_by=? WHERE id=?").run(reason, Date.now(), req.user.id, request.id); db.prepare("UPDATE security_tokens SET used_at=? WHERE request_id=? AND used_at IS NULL").run(Date.now(), request.id); audit(req.user, "RECOVERY_REJECTED", request.id); });
      } else {
        if ((action === "approve" && request.status !== "PENDING") || (action === "resend" && request.status !== "APPROVED")) problem("Esta solicitud no admite esa acción; solicita una recuperación nueva si ya venció.", 409);
        await deliverRecovery(request, req.user, req);
      }
      res.json({ ok: true, request: publicRecovery(db.prepare("SELECT * FROM recovery_requests WHERE id=?").get(request.id)) });
    }));
    app.get("/api/audit", permission("audit.read"), wrapped((req, res) => {
      const integer = (value, fallback, min, max) => { if (value === undefined) return fallback; if (typeof value !== "string" || !/^\d+$/.test(value) || Number(value) < min || Number(value) > max) problem("La paginación de auditoría no es válida."); return Number(value); };
      const page = integer(req.query.page, 1, 1, 1000000), limit = integer(req.query.limit, 50, 1, 500), where = [], args = [];
      const filter = (name, max = 100) => req.query[name] === undefined || req.query[name] === "" ? "" : requireText(req.query[name], `Filtro ${name}`, 1, max);
      for (const [key, column] of [["action", "a.action"], ["outcome", "a.outcome"], ["actorId", "a.actor_id"]]) { const value = filter(key); if (value) { where.push(`${column}=?`); args.push(value); } }
      const q = filter("q", 150); if (q) { where.push("(a.action LIKE ? ESCAPE '\\' OR a.target_id LIKE ? ESCAPE '\\' OR a.details LIKE ? ESCAPE '\\' OR p.name LIKE ? ESCAPE '\\')"); const term = `%${q.replace(/[\\%_]/g, "\\$&")}%`; args.push(term, term, term, term); }
      let from, to;
      for (const key of ["from", "to"]) { const value = filter(key, 10); if (!value) continue; if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00-05:00`)) || new Date(`${value}T00:00:00-05:00`).toISOString().slice(0, 10) !== value) problem("El intervalo de fechas no es válido."); const time = Date.parse(`${value}T00:00:00-05:00`); if (key === "from") { from = time; where.push("a.at>=?"); args.push(time); } else { to = time; where.push("a.at<?"); args.push(time + 86400000); } }
      if (from !== undefined && to !== undefined && from > to) problem("La fecha inicial debe ser anterior o igual a la final.");
      const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "", total = db.prepare(`SELECT COUNT(*) n FROM security_audit a LEFT JOIN people p ON p.id=a.actor_id${clause}`).get(...args).n;
      const events = db.prepare(`SELECT a.*,p.name current_actor_name FROM security_audit a LEFT JOIN people p ON p.id=a.actor_id${clause} ORDER BY a.at DESC,a.id DESC LIMIT ? OFFSET ?`).all(...args, limit, (page - 1) * limit).map(row => { const details = JSON.parse(row.details); return { id: row.id, at: iso(row.at), ...timeFields(row.at), actorId: row.actor_id, actorName: details.actorName || row.current_actor_name || "Acceso público", action: row.action, targetId: row.target_id, targetLabel: details.targetLabel || row.target_id || "Acceso al sistema", outcome: row.outcome, correlationId: details.correlationId || null, before: details.before || null, after: details.after || null, changes: details.changes || [], details }; });
      res.json({ events, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)), filters: { actions: db.prepare("SELECT DISTINCT action FROM security_audit ORDER BY action").all().map(row => row.action), outcomes: db.prepare("SELECT DISTINCT outcome FROM security_audit ORDER BY outcome").all().map(row => row.outcome), actors: db.prepare("SELECT DISTINCT p.id,p.name FROM people p JOIN security_audit a ON a.actor_id=p.id ORDER BY p.name").all() } });
    }));
  }
  return { installPublic, installPrivate, permission, expireRequests };
}
module.exports = { createSecurityRoutes };
