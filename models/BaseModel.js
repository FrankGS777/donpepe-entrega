const { pool } = require("../config/db");

class BaseModel {
  static async query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  }
  static async one(sql, params = []) {
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }
}
module.exports = BaseModel;
