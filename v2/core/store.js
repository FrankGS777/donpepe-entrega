"use strict";
const { DatabaseSync } = require("node:sqlite");
const { mkdirSync } = require("node:fs");
const { dirname, resolve } = require("node:path");

function createStore(filename = ":memory:") {
  if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS simulation (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS command_receipts (command_id TEXT PRIMARY KEY, result_json TEXT NOT NULL, created_at TEXT NOT NULL);");
  db.exec(`CREATE TABLE IF NOT EXISTS inventory_movements (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, sku_id TEXT NOT NULL,
    lot TEXT NOT NULL, type TEXT NOT NULL, from_branch TEXT, to_branch TEXT,
    search_text TEXT NOT NULL, record_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS inventory_movements_sku_at ON inventory_movements(sku_id,at,sequence);
  CREATE INDEX IF NOT EXISTS inventory_movements_branches ON inventory_movements(from_branch,to_branch,sequence);
  CREATE TABLE IF NOT EXISTS inventory_kardex_metadata (id INTEGER PRIMARY KEY CHECK(id=1), record_json TEXT NOT NULL);
  CREATE TRIGGER IF NOT EXISTS inventory_movements_no_update BEFORE UPDATE ON inventory_movements BEGIN SELECT RAISE(ABORT,'El kardex es de solo anexado'); END;
  CREATE TRIGGER IF NOT EXISTS inventory_movements_no_delete BEFORE DELETE ON inventory_movements BEGIN SELECT RAISE(ABORT,'El kardex es de solo anexado'); END;`);
  const get = db.prepare("SELECT state_json FROM simulation WHERE id = 1");
  const save = db.prepare("INSERT INTO simulation (id,revision,state_json,updated_at) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state_json=excluded.state_json,updated_at=excluded.updated_at");
  return {
    read() { const row = get.get(); return row ? JSON.parse(row.state_json) : null; },
    write(state) { save.run(state.revision, JSON.stringify(state), new Date().toISOString()); },
    transaction(work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } },
    receipt(id) { if (!id) return null; const r = db.prepare("SELECT result_json FROM command_receipts WHERE command_id=?").get(id); return r ? JSON.parse(r.result_json) : null; },
    remember(id, result) { if (id) db.prepare("INSERT INTO command_receipts VALUES (?,?,?)").run(id, JSON.stringify(result), new Date().toISOString()); },
    clearReceipts() { db.exec("DELETE FROM command_receipts"); },
    kardexMetadata() { const row = db.prepare("SELECT record_json FROM inventory_kardex_metadata WHERE id=1").get(); return row ? JSON.parse(row.record_json) : null; },
    initializeKardex(metadata) { db.prepare("INSERT INTO inventory_kardex_metadata(id,record_json) VALUES(1,?)").run(JSON.stringify(metadata)); },
    appendMovements(records) {
      if (!records.length) return;
      const insert = db.prepare("INSERT INTO inventory_movements(at,sku_id,lot,type,from_branch,to_branch,search_text,record_json) VALUES(?,?,?,?,?,?,?,?)");
      for (const record of records) insert.run(record.at, record.skuId, record.lot || "", record.type, record.from?.branchId || null, record.to?.branchId || null, [record.skuCode, record.skuName, record.lot, record.huId, record.documentId, record.from?.label, record.to?.label, record.reason].filter(Boolean).join(" ").toLocaleLowerCase("es"), JSON.stringify(record));
    },
    queryMovements({ branchId, skuId, lot, type, fromDate, toDate, query, page = 1, pageSize = 25 } = {}) {
      const where = [], values = [];
      if (branchId) { where.push("(from_branch=? OR to_branch=?)"); values.push(branchId, branchId); }
      for (const [field, value] of [["sku_id", skuId], ["lot", lot], ["type", type]]) if (value) { where.push(`${field}=?`); values.push(value); }
      // Date filters are business days in Lima, not UTC calendar days.
      if (fromDate) { where.push("at>=?"); values.push(new Date(`${fromDate}T00:00:00.000-05:00`).toISOString()); }
      if (toDate) { where.push("at<=?"); values.push(new Date(`${toDate}T23:59:59.999-05:00`).toISOString()); }
      if (query) { where.push("search_text LIKE ? ESCAPE '\\'"); values.push(`%${query.toLocaleLowerCase("es").replace(/[\\%_]/g, "\\$&")}%`); }
      const clause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
      const total = db.prepare(`SELECT COUNT(*) n FROM inventory_movements${clause}`).get(...values).n;
      const rows = db.prepare(`SELECT sequence,record_json FROM inventory_movements${clause} ORDER BY sequence DESC LIMIT ? OFFSET ?`).all(...values, pageSize, (page - 1) * pageSize);
      const types = db.prepare(`SELECT DISTINCT type FROM inventory_movements${branchId ? " WHERE from_branch=? OR to_branch=?" : ""} ORDER BY type`).all(...(branchId ? [branchId, branchId] : [])).map(row => row.type);
      return { items: rows.map(row => ({ id: `MOV-${String(row.sequence).padStart(8,"0")}`, sequence: row.sequence, ...JSON.parse(row.record_json) })), total, types };
    },
    close() { db.close(); },
  };
}
module.exports = { createStore };
