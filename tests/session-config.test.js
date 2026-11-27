const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("las sesiones reutilizan MySQL2 sin un segundo conector vulnerable", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const store = fs.readFileSync(
    path.join(__dirname, "..", "config", "MySQLSessionStore.js"),
    "utf8",
  );
  assert.match(source, /new MySQLSessionStore/);
  assert.doesNotMatch(source, /express-mysql-session/);
  assert.match(store, /class MySQLSessionStore extends session\.Store/);
  assert.match(store, /ON DUPLICATE KEY UPDATE/);
  assert.match(store, /expires>=UNIX_TIMESTAMP\(\)/);
});
