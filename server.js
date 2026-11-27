const app = require("./app");
const env = require("./config/env");
const { pool } = require("./config/db");
const server = app.listen(env.port, () =>
  console.log(`Minimarket listo en http://localhost:${env.port}`),
);
async function shutdown(signal) {
  console.log(`${signal}: cerrando conexiones...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
