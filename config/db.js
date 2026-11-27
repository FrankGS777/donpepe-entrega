const mysql = require("mysql2/promise");
const env = require("./env");

const pool = mysql.createPool(env.db);
pool.on("connection", (connection) => {
  connection.query("SET time_zone = '-05:00'");
});

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { pool, transaction };
