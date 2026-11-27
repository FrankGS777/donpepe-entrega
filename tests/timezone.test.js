process.env.DB_HOST = "localhost";
process.env.DB_NAME = "test";
process.env.DB_USER = "test";
process.env.DB_PASSWORD = "test";
process.env.SESSION_SECRET = "test-secret-with-more-than-32-characters";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const env = require("../config/env");
const { todayInLima, dateTimeInLima } = require("../utils/dates");

test("la aplicación y MySQL trabajan con hora peruana", () => {
  assert.equal(env.timeZone, "America/Lima");
  assert.equal(env.db.timezone, "-05:00");
  assert.equal(process.env.TZ, "America/Lima");
});

test("las fechas cercanas a medianoche UTC conservan el día de Perú", () => {
  const instant = new Date("2026-08-28T02:30:00.000Z");
  assert.equal(todayInLima(instant), "2026-08-27");
  assert.equal(dateTimeInLima(instant), "27/08/2026 21:30");
});

test("Docker fija Lima en Node y UTC-5 en MySQL", () => {
  const root = path.join(__dirname, "..");
  const compose = fs.readFileSync(
    path.join(root, "docker-compose.yml"),
    "utf8",
  );
  const dockerfile = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
  assert.match(compose, /TZ: \$\{TZ:-America\/Lima\}/);
  assert.match(compose, /--default-time-zone=-05:00/);
  assert.match(dockerfile, /ENV TZ=America\/Lima/);
});
