const session = require("express-session");
const { pool } = require("./db");

class MySQLSessionStore extends session.Store {
  constructor({ expiration, checkExpirationInterval }) {
    super();
    this.expiration = expiration;
    this.ready = null;
    this.cleanupTimer = setInterval(
      () => this.clearExpired().catch(() => {}),
      checkExpirationInterval,
    );
    this.cleanupTimer.unref();
  }

  ensureReady() {
    if (!this.ready)
      this.ready = pool.query(`CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT COLLATE utf8mb4_bin
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    return this.ready;
  }

  expiresAt(value) {
    const cookieExpiry = value?.cookie?.expires
      ? new Date(value.cookie.expires).getTime()
      : Date.now() + this.expiration;
    return Math.floor(cookieExpiry / 1000);
  }

  async clearExpired() {
    await this.ensureReady();
    await pool.execute("DELETE FROM sessions WHERE expires < UNIX_TIMESTAMP()");
  }

  get(sessionId, callback) {
    this.ensureReady()
      .then(() =>
        pool.execute(
          "SELECT data FROM sessions WHERE session_id=? AND expires>=UNIX_TIMESTAMP() LIMIT 1",
          [sessionId],
        ),
      )
      .then(([rows]) =>
        callback(null, rows[0] ? JSON.parse(rows[0].data) : null),
      )
      .catch(callback);
  }

  set(sessionId, value, callback = () => {}) {
    this.ensureReady()
      .then(() =>
        pool.execute(
          `INSERT INTO sessions (session_id,expires,data) VALUES (?,?,?)
           ON DUPLICATE KEY UPDATE expires=VALUES(expires),data=VALUES(data)`,
          [sessionId, this.expiresAt(value), JSON.stringify(value)],
        ),
      )
      .then(() => callback())
      .catch(callback);
  }

  touch(sessionId, value, callback = () => {}) {
    this.ensureReady()
      .then(() =>
        pool.execute("UPDATE sessions SET expires=? WHERE session_id=?", [
          this.expiresAt(value),
          sessionId,
        ]),
      )
      .then(() => callback())
      .catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    this.ensureReady()
      .then(() =>
        pool.execute("DELETE FROM sessions WHERE session_id=?", [sessionId]),
      )
      .then(() => callback())
      .catch(callback);
  }
}

module.exports = MySQLSessionStore;
