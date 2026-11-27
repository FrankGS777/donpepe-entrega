const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("desarrollo HTTP no fuerza recursos localhost a HTTPS", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  assert.match(
    source,
    /strictTransportSecurity:\s*env\.nodeEnv\s*===\s*["']production["']\s*\?\s*undefined\s*:\s*false/,
  );
  assert.match(
    source,
    /upgradeInsecureRequests:\s*env\.nodeEnv\s*===\s*["']production["']\s*\?\s*\[\]\s*:\s*null/,
  );
});
