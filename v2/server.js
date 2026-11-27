"use strict";
process.env.TZ = "America/Lima";
const express = require("express");
const {supplierInvoicePDF}=require("./core/supplier-invoice-pdf");
const helmet = require("helmet");
const compression = require("compression");
const bcrypt = require("bcryptjs");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { rateLimit } = require("express-rate-limit");
const { createSimulation } = require("./core/engine");
const { createIdentityStore, hashToken, newToken } = require("./security/identity");
const { PERMISSIONS, can, assertCommandAllowed } = require("./security/policy");
const { createSupplierClaimsMail } = require("./security/supplier-claims-mail");
const { createRecoveryMail } = require("./security/mail");
const { createSecurityRoutes } = require("./security/routes");
const { createCatalogMedia } = require("./security/catalog-media");
const { auditTarget } = require("./security/audit");
const { limaTimestamp, TIME_ZONE } = require("./core/time");
const { enrichRecordPresentation } = require("./core/record-presentation");

function createApp(options = {}) {
  const env = options.env || process.env;
  const mode = env.DONPEPE_MODE || (env.NODE_ENV === "production" ? "cloud" : "demo");
  if (!["demo", "cloud"].includes(mode)) throw new Error("DONPEPE_MODE debe ser demo o cloud.");
  const cloud = mode === "cloud";
  const dataDir = options.dataDir || env.DONPEPE_DATA_DIR || path.join(__dirname, "data");
  let publicUrl = options.publicUrl || env.DONPEPE_PUBLIC_URL;
  if (cloud) {
    const url = URL.canParse(publicUrl) && new URL(publicUrl);
    if (!url || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("DONPEPE_PUBLIC_URL debe ser el origen HTTPS del servicio.");
    publicUrl = url.origin;
    if (!options.dataDir && !env.DONPEPE_DATA_DIR) throw new Error("Configura DONPEPE_DATA_DIR con la ruta del disco persistente.");
  }
  const identity = createIdentityStore(options.identityFile || path.join(dataDir, "identity.sqlite"), cloud ? {
    adminEmail: env.DONPEPE_ADMIN_EMAIL,
    adminPassword: env.DONPEPE_ADMIN_PASSWORD,
  } : null);
  const simulation = options.simulation || createSimulation({ filename: options.simulationFile || path.join(dataDir, "simulation.sqlite"), realtimeClock: options.realtimeClock === true });
  const mail = createRecoveryMail({ transport: options.mailTransport, env: options.mailEnv });
  const supplierClaimsMail=createSupplierClaimsMail({env:options.supplierMailEnv||env,transport:options.supplierMailTransport,mode});
  let notificationRun=null;
  function deliverSupplierClaims(){
    if(notificationRun)return notificationRun;
    notificationRun=(async()=>{let claim;while((claim=simulation.claimNotificationNext())){
      try{const status=await supplierClaimsMail.send(claim);simulation.claimNotificationFinish(claim.id,claim.notification.attemptId,status);}
      catch(error){simulation.claimNotificationFinish(claim.id,claim.notification.attemptId,error.deliveryUnknown?'UNKNOWN':'FAILED',error.deliveryUnknown?'Envío incierto: consulta con el proveedor antes de reintentar.':'No se envió el correo. Revisa el canal SMTP y el destinatario antes de reintentar.');}
    }})().finally(()=>notificationRun=null);return notificationRun;
  }
  const security = createSecurityRoutes({ identity, simulation, mail, publicUrl });
  const catalogMedia = createCatalogMedia({ identity, security });
  const app = express();
  if (cloud && env.DONPEPE_TRUST_EDGE === "true") app.set("trust proxy", 1);
  let engineFault = false;
  const auditedDeviceEvents = new Set(identity.db.prepare("SELECT details FROM security_audit WHERE action IN ('DEVICE_SETTINGS_APPLIED','AUTONOMOUS_PROCESS_EVENT')").all().map(row => JSON.parse(row.details).sourceEventId).filter(Boolean));
  function recordDeviceAudit(events = []) {
    for (const event of events) if ((event.type === "DEVICE_SETTINGS_APPLIED" || event.type.startsWith("AUTONOMY_")) && !auditedDeviceEvents.has(event.id)) {
      const automatic = event.type.startsWith("AUTONOMY_");
      identity.audit({ id: event.actorId || "AUTOMATION", name: "Orquestador automático" }, automatic ? "AUTONOMOUS_PROCESS_EVENT" : "DEVICE_SETTINGS_APPLIED", event.jobId || event.assetId || event.purchaseId || event.orderId || null, { sourceEventId: event.id, eventType: event.type, targetLabel: event.message, before: event.before, after: event.after, correlationId: event.correlationId || event.jobId || crypto.randomUUID(), appliedAt: event.at, ...(automatic ? { jobId: event.jobId, purchaseId: event.purchaseId, orderId: event.orderId, exceptionId: event.exceptionId, evidenceIds: event.evidenceIds, sourceMode: "SIMULATED" } : {}) });
      auditedDeviceEvents.add(event.id);
    }
  }
  recordDeviceAudit(simulation.snapshot({ id: "audit-recovery", role: "admin" }).events);
  app.disable("x-powered-by");
  // ImageBitmapLoader fetches embedded GLB textures through same-origin blob
  // URLs. External network origins remain excluded from connect-src.
  app.use(helmet({ contentSecurityPolicy: { directives: { "default-src": ["'self'"], "img-src": ["'self'", "data:", "blob:"], "script-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "font-src": ["'self'"], "connect-src": ["'self'", "blob:"], "upgrade-insecure-requests": null } } }));
  // Only an avatar upload may exceed the ordinary small command/form limit.
  app.put("/api/profile/avatar", express.json({ limit: "3mb", inflate: false }));
  app.put("/api/users/:id/avatar", express.json({ limit: "3mb", inflate: false }));
  app.post("/api/catalog-media", express.json({ limit: "3mb", inflate: false }));
  app.use(express.json({ limit: "64kb", inflate: false }));
  app.use((req, res, next) => {
    if (req.body == null) req.body = {};
    if (Array.isArray(req.body) || typeof req.body !== "object") return res.status(422).json({ error: "El formulario no es válido." });
    next();
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.get("origin");
      const accepted = cloud ? [publicUrl] : ["http://" + req.get("host"), "https://" + req.get("host")];
      if ((origin && !accepted.includes(origin)) || req.get("sec-fetch-site") === "cross-site") return res.status(403).json({ error: "Solicitud de otro sitio rechazada." });
    }
    next();
  });
  app.use((req, res, next) => {
    const token = String(req.headers.cookie || "").split(";").map(x => x.trim()).find(x => x.startsWith("dpv2="))?.slice(5);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const row = identity.db.prepare("SELECT p.*,s.csrf,s.token session_token FROM web_sessions s JOIN people p ON p.id=s.user_id WHERE s.token=? AND s.expires>? AND p.active=1 AND p.archived=0").get(hashToken(token), Date.now());
      // Authorization is refreshed on every request, never trusted from cookies.
      if (row) { req.user = identity.publicUser(row); req.session = row; }
    }
    next();
  });
  // Compress the map snapshot while keeping downloads and other API routes unchanged.
  app.use(compression({ filter: (req, res) => (req.path === "/api/state" || !req.path.startsWith("/api")) && compression.filter(req, res) }));
  catalogMedia.installPublic(app);
  app.use("/images", express.static(path.join(__dirname, "../public/images"), { maxAge: "30d" }));
  app.use("/images", express.static(path.join(__dirname, "public/images"), { maxAge: "30d" }));
  app.use("/fonts", express.static(path.join(__dirname, "../public/fonts"), { maxAge: "30d" }));
  app.use("/chunks", express.static(path.join(__dirname, "public/chunks"), { maxAge: "1y", immutable: true }));
  app.get("/icons.svg", (req, res) => res.sendFile(path.join(__dirname, "../public/icons.svg")));
  app.use("/textures", express.static(path.join(__dirname,"public/textures"),{maxAge:"7d"}));
  const shell = fs.readFileSync(path.join(__dirname, "public/index.html"), "utf8");
  app.get(["/", "/index.html"], (req, res) => {
    if (!req.user) return res.redirect("/login");
    res.set("Cache-Control", "no-store").type("html").send(shell.replace("<body>", `<body data-role="${req.user.role}">`));
  });
  app.use(express.static(path.join(__dirname, "public"), { index: false }));
  app.get("/health", (req, res) => res.set("Cache-Control", "no-store").status(engineFault ? 503 : 200).json({ ok: !engineFault, version: "3.1", mode: "academic-simulation" }));
  app.get("/login", (req, res) => req.user ? res.redirect("/") : res.sendFile(path.join(__dirname, "public/login.html")));
  for (const url of ["/forgot-password", "/reset-password", "/verify-recovery-email"]) app.get(url, (req, res) => res.sendFile(path.join(__dirname, "public/login.html")));
  const dummyPassword = bcrypt.hashSync(crypto.randomBytes(24).toString("hex"), 10);
  app.post("/api/login", rateLimit({ windowMs: 600000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: "Demasiados intentos. Espera unos minutos antes de continuar." } }), async (req, res, next) => {
    try {
      const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const password = typeof req.body.password === "string" ? req.body.password : "";
      if (email.length > 120 || Buffer.byteLength(password) > 72 || password.length > 128) return res.status(401).json({ error: "Revisa el correo y la contraseña." });
      const user = identity.db.prepare("SELECT * FROM people WHERE email=? AND active=1 AND archived=0").get(email);
      const valid = await bcrypt.compare(password, user?.password || dummyPassword);
      if (!user || !valid) { identity.audit(null, "LOGIN_FAILED", null, {}, "DENIED"); return res.status(401).json({ error: "Revisa el correo y la contraseña." }); }
      const current = identity.db.prepare("SELECT * FROM people WHERE id=? AND active=1 AND archived=0").get(user.id);
      if (!current || current.password !== user.password) return res.status(401).json({ error: "La cuenta cambió. Inicia sesión de nuevo." });
      if (req.session) identity.db.prepare("DELETE FROM web_sessions WHERE token=?").run(req.session.session_token);
      identity.db.prepare("DELETE FROM web_sessions WHERE expires<?").run(Date.now());
      const token = newToken(), csrf = crypto.randomBytes(24).toString("hex");
      identity.db.prepare("INSERT INTO web_sessions VALUES(?,?,?,?)").run(hashToken(token), user.id, csrf, Date.now() + 8 * 3600000);
      res.cookie("dpv2", token, { httpOnly: true, sameSite: "strict", secure: cloud || req.secure, maxAge: 8 * 3600000, path: "/" });
      identity.audit({ id: user.id }, "LOGIN_SUCCEEDED", user.id);
      res.json({ user: identity.publicUser(current) });
    } catch (error) { next(error); }
  });
  security.installPublic(app);
  app.use("/api", (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Inicia sesión para continuar." });
    if (!["GET", "HEAD"].includes(req.method) && req.get("x-csrf-token") !== req.session.csrf) return res.status(403).json({ error: "La sesión cambió. Recarga la página." });
    next();
  });
  app.use("/api", (req, res, next) => {
    req.correlationId = crypto.randomUUID();
    const match = req.originalUrl.split("?")[0].match(/^\/api\/(?:users|recoveries|roles)\/([^/]+)/), targetId = match ? decodeURIComponent(match[1]) : req.originalUrl.startsWith("/api/profile") ? req.user.id : null;
    identity.setAuditContext(req.user, { correlationId: req.correlationId, targetId, method: req.method, path: req.originalUrl.split("?")[0], before: targetId ? identity.auditEntity(targetId) : null });
    next();
  });
  function stateFor(user) {
    const snapshot = enrichRecordPresentation(simulation.snapshot(user));
    snapshot.meta.engineFault = engineFault;
    snapshot.meta.timeZone = TIME_ZONE;
    snapshot.meta.serverTime = new Date().toISOString();
    const personNames = new Map();
    const personName = id => {
      if (id === "AUTOMATION" || id === "SYSTEM") return "Orquestador automático";
      if (!personNames.has(id)) personNames.set(id, identity.db.prepare("SELECT name FROM people WHERE id=?").get(id || "")?.name || null);
      return personNames.get(id);
    };
    for (const key of ["orders", "purchases", "returns", "maintenance", "missions"]) for (const record of snapshot[key] || []) {
      if (record.createdBy) record.createdByName = personName(record.createdBy);
      if (record.updatedBy) record.updatedByName = personName(record.updatedBy);
    }
    snapshot.permissions = user.permissions;
    if (user.role !== "admin") {
      if (!can(user, "inventory.read")) {
        snapshot.hus = []; snapshot.storeStock = []; snapshot.inventory = { hus: [], storeStock: [], availability: [] };
        snapshot.ledger = {}; snapshot.locationStatus = {}; snapshot.routeLocks = {}; snapshot.events = [];
        snapshot.catalog.skus.forEach(sku => { delete sku.availableCases; });
        snapshot.incidents = snapshot.incidents?.filter(item => item.robotId && !item.huId) || [];
        for (const key of ["warehouseCases", "storeCases", "availableCases", "inTransitCases", "quarantineCases", "discrepancyCases", "occupiedLocations", "freeLocations", "occupancy"]) if (snapshot.metrics) delete snapshot.metrics[key];
      }
      if (!can(user, "analytics.read")) { snapshot.ledger = {}; snapshot.counters = {}; }
      if (!can(user, "maintenance.read")) { snapshot.maintenance = []; snapshot.catalog.assets = []; }
      if (!can(user, "map.view")) {
        snapshot.layout = { zones: [], racks: [], locations: [], nodes: [], edges: [], stations: [], branches: [], roads: [] };
        snapshot.routeLocks = {};
        snapshot.robots = snapshot.robots.map(({ id, name, type, state, battery, missionId, faultReason, capacityKg }) => ({ id, name, type, state, battery, missionId, faultReason, capacityKg }));
        snapshot.trucks = snapshot.trucks.map(({ id, name, state, orderId, capacityCases }) => ({ id, name, state, orderId, capacityCases }));
        snapshot.equipment = { robots: snapshot.robots, trucks: snapshot.trucks };
        snapshot.missions.forEach(mission => { delete mission.route; });
      }
      return snapshot;
    }
    security.expireRequests();
    // Administrators configure rules, not hidden operational map controls.
    return { meta: snapshot.meta, supplierClaims: snapshot.supplierClaims, finance: snapshot.finance, permissions: user.permissions, configuration: snapshot.configuration || { revision: 1, settings: {} }, ...(can(user,"autonomy.read") ? { autonomy: snapshot.autonomy, autonomyConfiguration: snapshot.autonomyConfiguration } : {}), catalog: snapshot.catalog, deviceSettingSchemas: snapshot.deviceSettingSchemas, catalogSources: snapshot.catalogSources, validationCatalog: snapshot.validationCatalog, maintenance: can(user, "maintenance.read") ? snapshot.maintenance : [], ...(can(user, "inventory.summary.read") ? { inventorySummary: snapshot.inventorySummary } : {}), capabilities: ["configuration"], metrics: { users: identity.db.prepare("SELECT COUNT(*) n FROM people WHERE archived=0").get().n, activeUsers: identity.db.prepare("SELECT COUNT(*) n FROM people WHERE active=1 AND archived=0").get().n, pendingRecoveries: identity.db.prepare("SELECT COUNT(*) n FROM recovery_requests WHERE status='PENDING' AND expires_at>?").get(Date.now()).n }, clock: { now: snapshot.clock.now }, layout: { zones: [], racks: [], locations: [], nodes: [], edges: [], stations: [], branches: [], roads: [] }, hus: [], storeStock: [], inventory: { hus: [], storeStock: [], availability: [] }, equipment: { robots: [], trucks: [] }, robots: [], trucks: [], missions: [], orders: [], purchases: snapshot.purchases.map(p=>({id:p.id,supplierId:p.supplierId,state:p.state,lines:p.lines.map(l=>({skuId:l.skuId,cases:l.cases,receivedCases:l.receivedCases}))})), returns: [], events: [] };
  }
  app.get("/api/me", (req, res) => {
    const pendingRecoveries = can(req.user, "identity.recoveries.review") ? identity.db.prepare("SELECT COUNT(*) n FROM recovery_requests WHERE status='PENDING' AND expires_at>?").get(Date.now()).n : 0;
    res.json({ user: req.user, csrf: req.session.csrf, permissionCatalog: PERMISSIONS.filter(p => req.user.permissions.includes(p.id)), pendingRecoveries });
  });
  app.get("/api/state", security.permission("overview.view"), (req, res) => {
    const snapshot = stateFor(req.user);
    if (req.query.layout === "include" || typeof req.query.layout === "string" && /^[a-f0-9]{32}$/.test(req.query.layout)) {
      const tag = crypto.createHash("sha256").update(JSON.stringify(snapshot.layout)).digest("hex").slice(0, 32);
      snapshot.meta.layoutTag = tag;
      if (req.query.layout === tag) delete snapshot.layout;
    }
    res.json(snapshot);
  });
  app.get("/api/autonomy", security.permission("autonomy.read"), (req, res) => {
    const snapshot = stateFor(req.user);
    res.json({ ...snapshot.autonomy, infrastructure: snapshot.autonomyConfiguration });
  });
  const withActorNames = report => ({ ...report,items:report.items.map(row => ({ ...row,actorName:row.actorId === "AUTOMATION" ? "Orquestador automático" : row.actorId === "SYSTEM" ? "Sistema" : identity.db.prepare("SELECT name FROM people WHERE id=?").get(row.actorId)?.name || row.actorId })) });
  app.get("/api/inventory/movements", (req,res,next) => { try { res.json(withActorNames(simulation.movements(req.user,req.query))); } catch(error) { next(error); } });
  app.get("/api/inventory/movements/export.csv", (req,res,next) => {
    try {
      let report = withActorNames(simulation.movements(req.user,{...req.query,page:1,pageSize:100}));
      if (report.total > 10000) return res.status(422).json({error:"La exportación supera 10 000 movimientos. Acota el producto o las fechas."});
      const rows = [...report.items];
      for(let page=2;page<=report.pages;page++) rows.push(...withActorNames(simulation.movements(req.user,{...req.query,page,pageSize:100})).items);
      const cell = value => { const text=String(value ?? ""); return `"${(/^[=+\-@\t\r]/.test(text)?"'":"")+text.replace(/"/g,'""')}"`; };
      const csv = [["Movimiento","Fecha y hora de Lima (PET / UTC-05:00)","Zona horaria","Tipo","SKU","Producto","Lote proveedor","Vencimiento","Carga","Origen descriptivo","Destino descriptivo","Cajas","Saldo del lote en la ubicación después del hecho","Saldo lote en red","Documento","Responsable","Perfil","Equipo","Motivo","Referencia de venta o salida","Referencia de seguimiento","Qué ocurrió","Efecto sobre existencias","Ubicación del saldo","Explicación"],...rows.map(r=>[r.id,limaTimestamp(r.at),TIME_ZONE,r.typeLabel,r.skuCode,r.skuName,r.lot,r.expiry,r.huId,r.from.label,r.to.label,r.cases,r.locationBalanceCases,r.networkBalanceCases,r.documentId,r.actorName,r.actorRole,r.deviceId,r.reason,r.externalReference,r.correlationId,r.explanation?.title,r.explanation?.effectLabel,r.explanation?.balanceLocation,r.explanation?.summary])].map(row=>row.map(cell).join(",")).join("\r\n");
      res.set("Content-Type","text/csv; charset=utf-8").set("Content-Disposition",'attachment; filename="donpepe-kardex.csv"').send(`\uFEFF${csv}`);
    } catch(error) { next(error); }
  });
  app.get("/api/finance/bills/:id.pdf", async (req,res,next)=>{
    try {
      if(!req.user || !["admin","operations"].includes(req.user.role)) return res.status(403).json({error:"Tu perfil no tiene acceso a facturas de proveedores."});
      const bill=simulation.snapshot(req.user).finance.bills.find(b=>b.id===req.params.id && b.automatic);
      if(!bill) return res.status(404).json({error:"Factura de proveedor no encontrada."});
      const pdf=await supplierInvoicePDF(bill);
      res.set("Content-Type","application/pdf").set("Cache-Control","private, no-store").set("Content-Disposition",`${req.query.download === "1" ? "attachment":"inline"}; filename="Factura-${bill.issuer.code.replace(/[^A-Za-z0-9-]/g,"")}-${bill.reference}.pdf"`).send(pdf);
    }catch(error){next(error);}
  });
  app.post("/api/commands", async (req, res, next) => {
    try {
      if (typeof req.body.type !== "string" || !req.body.payload || typeof req.body.payload !== "object" || Array.isArray(req.body.payload)) return res.status(422).json({ error: "La operación no es válida." });
      assertCommandAllowed(req.user, req.body.type);
      if (req.body.type === "purchase.receive" && (typeof req.body.payload.inspectionId !== "string" || !req.body.payload.inspectionId)) { const error = new Error("Registra y revisa la inspección de recepción antes de confirmar las existencias."); error.status = 422; error.fieldErrors = { inspectionId: "Se necesita una inspección vigente para recibir." }; throw error; }
      if (["config.branch.deactivate", "config.branch.delete"].includes(req.body.type)) {
        const branchId = req.body.payload.id;
        if (typeof branchId !== "string") { const error = new Error("Selecciona una sucursal válida."); error.status = 422; throw error; }
        const deleting = req.body.type.endsWith(".delete");
        const linked = identity.db.prepare(`SELECT COUNT(*) n FROM people WHERE branch_id=? AND archived=0 ${deleting ? "" : "AND active=1"}`).get(branchId).n;
        if (linked) { const error = new Error(deleting ? "La sucursal conserva cuentas vinculadas, incluso desactivadas. Reasígnalas o elimínalas antes de eliminar la sucursal." : "La sucursal tiene usuarios activos vinculados. Reasígnalos o desactívalos antes de desactivarla."); error.status = 409; throw error; }
      }
      const beforeState = simulation.snapshot(req.user), before = auditTarget(beforeState, req.body.type, req.body.payload);
      const result = simulation.command(req.body.type, req.body.payload, req.user);
      if (req.body.type === "simulation.pause" && req.body.payload.paused === false) engineFault = false;
      const afterState = simulation.snapshot(req.user), after = auditTarget(afterState, req.body.type, req.body.payload, result.id), targetLabel = after?.name || before?.name || (after?.supplierId ? `Compra · ${afterState.catalog.suppliers.find(row => row.id === after.supplierId)?.name || "proveedor"}` : after?.branchId ? `Solicitud · ${afterState.catalog.branches.find(row => row.id === after.branchId)?.name || "sucursal"}` : after?.assetId ? `Mantenimiento · ${afterState.catalog.assets.find(row => row.id === after.assetId)?.name || "equipo"}` : req.body.type);
      const replayed = afterState.meta.revision === beforeState.meta.revision;
      identity.audit(req.user, replayed ? "COMMAND_REPLAYED" : "COMMAND_EXECUTED", result.id || req.body.payload.id || req.body.payload.huId || req.body.payload.assetId || null, { type: req.body.type, revision: result.revision, replayed, correlationId: req.body.payload.commandId || req.correlationId, targetLabel, before, after, ...(result.configurationRevision ? { configurationRevision: result.configurationRevision } : {}) }); req.auditRecorded = true;
      recordDeviceAudit(simulation.snapshot({ id: "audit-recovery", role: "admin" }).events);
      if(["supplierClaim.report","supplierClaim.retry"].includes(req.body.type)) await deliverSupplierClaims();
      res.json({ ok: true, result, state: stateFor(req.user) });
    } catch (error) { identity.audit(req.user, error.status === 403 ? "COMMAND_DENIED" : error.status < 500 ? "COMMAND_REJECTED" : "COMMAND_FAILED", req.body.payload?.id || req.body.payload?.assetId || req.body.type, { type: req.body.type, status: error.status || 500, fields: Object.keys(error.fieldErrors || {}), correlationId: req.correlationId }, error.status === 403 ? "DENIED" : error.status < 500 ? "REJECTED" : "ERROR"); req.auditRecorded = true; next(error); }
  });
  app.post("/api/logout", (req, res) => {
    identity.db.prepare("DELETE FROM web_sessions WHERE token=?").run(req.session.session_token); identity.audit(req.user, "LOGOUT", req.user.id);
    res.clearCookie("dpv2", { path: "/", httpOnly: true, sameSite: "strict", secure: cloud || req.secure }); res.json({ ok: true });
  });
  security.installPrivate(app);
  catalogMedia.installPrivate(app);
  app.use((req, res) => res.status(404).json({ error: "Este recurso no existe en la nueva versión." }));
  app.use((error, req, res, next) => {
    let status = Number(error.status || error.statusCode) || 500;
    let message = error.message;
    if (req.user && !["GET", "HEAD"].includes(req.method) && !req.auditRecorded && !identity.hasAuditEvent(req.user)) identity.audit(req.user, status === 403 ? "REQUEST_DENIED" : status >= 500 ? "REQUEST_FAILED" : "REQUEST_REJECTED", req.path, { method: req.method, status, fields: Object.keys(error.fieldErrors || {}), correlationId: req.correlationId }, status === 403 ? "DENIED" : status >= 500 ? "ERROR" : "REJECTED");
    if (error.type === "entity.parse.failed") { status = 400; message = "El formulario contiene datos JSON no válidos."; }
    if (error.type === "entity.too.large") { status = 413; message = "Los datos superan el tamaño permitido. Reduce la imagen o divide la información antes de volver a enviarla."; }
    if (error.errcode === 2067 || String(error.message).includes("UNIQUE constraint failed")) { status = 409; message = "Ya existe un registro con ese correo o identificador. Recarga e intenta de nuevo."; }
    if (status >= 500) console.error(`[${limaTimestamp()} ${TIME_ZONE}] DonPepe V2:`, error.code || error.name, "Operación no completada.");
    res.status(status >= 400 && status < 600 ? status : 500).json({ error: status < 500 || error.expose ? message : "No se pudo completar la operación. El estado anterior se conserva.", ...(status < 500 && error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}) });
  });
  let lastTick = performance.now();
  const timer = options.startClock === false ? null : setInterval(() => {
    const now = performance.now(), elapsed = Math.min((now - lastTick) / 1000, 2); lastTick = now;
    if (engineFault) return;
    try { recordDeviceAudit(simulation.advance(elapsed).auditEvents); }
    catch { engineFault = true; console.error(`[${limaTimestamp()} ${TIME_ZONE}] Simulación detenida por una incidencia interna. Revisa el estado antes de continuar.`); }
  }, 100);
  timer?.unref();
  return { app, simulation, identity, mail, close() { if (timer) clearInterval(timer); mail.close(); supplierClaimsMail.close(); simulation.close(); identity.close(); } };
}
if (require.main === module) {
  const runtime = createApp({ realtimeClock: true });
  const port = Number(process.env.PORT || process.env.DONPEPE_PORT || 3010), host = process.env.DONPEPE_HOST || "127.0.0.1";
  const server = runtime.app.listen(port, host, () => console.log(`[${limaTimestamp()} ${TIME_ZONE}] DonPepe · Plataforma logística: http://${host}:${port}`));
  function stop() { server.close(() => { runtime.close(); process.exit(0); }); }
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
}
module.exports = { createApp, createIdentityStore };
