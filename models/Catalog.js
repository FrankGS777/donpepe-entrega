const Base = require("./BaseModel");

const config = Object.freeze({
  categorias: {
    table: "categorias",
    fields: ["nombre", "descripcion", "vida_util_dias"],
  },
  marcas: { table: "marcas", fields: ["nombre", "descripcion"] },
  proveedores: {
    table: "proveedores",
    fields: [
      "ruc",
      "razon_social",
      "telefono",
      "email",
      "logo_url",
      "sitio_web",
      "activo",
    ],
  },
  ubicaciones: {
    table: "ubicaciones_almacen",
    fields: [
      "codigo_loc",
      "zona_id",
      "zona",
      "pasillo",
      "estante",
      "nivel",
      "posicion",
      "layout_x",
      "layout_z",
      "layout_verificado",
      "tipo",
      "capacidad_unidades",
      "secuencia_putaway",
      "secuencia_pick",
      "permite_recepcion",
      "permite_almacenaje",
      "permite_picking",
      "permite_conteo",
      "activo",
    ],
  },
});

class Catalog extends Base {
  static definition(type) {
    const item = config[type];
    if (!item) throw new Error("Catálogo inválido");
    return item;
  }
  static all(type, filters = {}) {
    if (type === "ubicaciones" && !filters.zone && !filters.aisle && !filters.rack && !filters.q)
      return Promise.resolve([]);
    if (type === "ubicaciones")
      return this.query(`SELECT u.*,z.codigo_zona,z.nombre zona_nombre,z.proposito,
        z.condicion_almacenamiento,z.descripcion zona_descripcion
        FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
        WHERE u.modelo_plano='CD1'
        AND (?='' OR z.codigo_zona=?) AND (?='' OR u.pasillo=?)
        AND (?='' OR u.estante=?) AND (?='' OR u.codigo_loc LIKE ?)
        ORDER BY z.secuencia_operativa,u.secuencia_putaway,u.codigo_loc LIMIT 80`,
        [filters.zone || "",filters.zone || "",filters.aisle || "",filters.aisle || "",
          filters.rack || "",filters.rack || "",filters.q || "",`%${filters.q || ""}%`]);
    const { table } = this.definition(type);
    return this.query(`SELECT * FROM ${table} ORDER BY id DESC`);
  }
  static find(type, id) {
    if (type === "ubicaciones")
      return this.one(
        `SELECT u.*,z.codigo_zona,z.nombre zona_nombre,z.proposito,z.condicion_almacenamiento
         FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id WHERE u.id=?`,
        [id],
      );
    const { table } = this.definition(type);
    return this.one(`SELECT * FROM ${table} WHERE id=?`, [id]);
  }
  static zones() {
    return this.query(
      `SELECT z.*,(SELECT COUNT(*) FROM ubicaciones_almacen u
        WHERE u.zona_id=z.id AND u.activo=1 AND u.modelo_plano='CD1') locs
       FROM zonas_almacen z WHERE z.activo=1 ORDER BY z.secuencia_operativa,z.id`,
    );
  }
  static zone(id) {
    return this.one("SELECT * FROM zonas_almacen WHERE id=? AND activo=1", [
      id,
    ]);
  }
  static locationUsage(id) {
    return this.one(
      `SELECT
       (SELECT COUNT(*) FROM productos WHERE ubicacion_picking_id=?) productos_picking,
       (SELECT COALESCE(SUM(cantidad_actual),0) FROM lotes WHERE ubicacion_id=?) unidades,
       (SELECT COUNT(*) FROM tareas_almacen WHERE estado IN ('PENDIENTE','EN_PROCESO')
        AND (ubicacion_origen_id=? OR ubicacion_destino_id=?)) tareas_abiertas`,
      [id, id, id, id],
    );
  }
  static verifiedRackAnchor({ zoneId, aisle, module, excludeId = 0 }) {
    return this.one(
      `SELECT layout_x,layout_z,codigo_loc FROM ubicaciones_almacen
      WHERE zona_id=? AND pasillo=? AND estante=? AND layout_verificado=1 AND id<>?
      LIMIT 1`,
      [zoneId, aisle, module, excludeId],
    );
  }
  static receivingLocations() {
    return this.query(`SELECT u.*,COALESCE(z.nombre,u.zona) zona,
        z.condicion_almacenamiento FROM ubicaciones_almacen u
      LEFT JOIN zonas_almacen z ON z.id=u.zona_id
      WHERE u.activo=1 AND u.permite_recepcion=1 AND u.tipo='RECEPCION'
      ORDER BY u.secuencia_putaway,u.codigo_loc`);
  }
  static countingLocations() {
    return this
      .query(`SELECT u.*,COALESCE(z.nombre,u.zona) zona FROM ubicaciones_almacen u
      LEFT JOIN zonas_almacen z ON z.id=u.zona_id
      WHERE u.activo=1 AND u.permite_conteo=1 ORDER BY z.secuencia_operativa,u.codigo_loc`);
  }
  static create(type, data) {
    const { table, fields } = this.definition(type);
    const values = fields.map((f) => data[f] ?? null);
    return this.query(
      `INSERT INTO ${table} (${fields.join(",")}) VALUES (${fields.map(() => "?").join(",")})`,
      values,
    );
  }
  static update(type, id, data) {
    const { table, fields } = this.definition(type);
    const values = fields.map((f) => data[f] ?? null);
    return this.query(
      `UPDATE ${table} SET ${fields.map((f) => `${f}=?`).join(",")} WHERE id=?`,
      [...values, id],
    );
  }
  static remove(type, id) {
    const { table } = this.definition(type);
    if (type === "proveedores")
      return this.query("UPDATE proveedores SET activo=0 WHERE id=?", [id]);
    return this.query(`DELETE FROM ${table} WHERE id=?`, [id]);
  }
}
module.exports = Catalog;
