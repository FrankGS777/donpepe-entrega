const { pool } = require("../config/db");
const { ensureMigrations } = require("./migrate");
const { seed, connectWithRetry } = require("./seed");

async function startup() {
  await connectWithRetry();
  await ensureMigrations();
  const [[state]] = await pool.query(
    "SELECT COUNT(*) usuarios FROM usuarios",
  );
  if (Number(state.usuarios) === 0) {
    console.log("Base vacía: cargando el escenario inicial de desarrollo.");
    await seed();
  } else {
    console.log("Migraciones listas; se conservaron los datos operativos.");
  }
}

startup()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
