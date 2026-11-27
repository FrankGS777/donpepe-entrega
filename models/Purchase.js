const Base = require("./BaseModel");
class Purchase extends Base {
  static all({ q = "", status = "" } = {}) {
    const params = [`%${q}%`, `%${q}%`];
    let statusSql = "";
    if (["PENDIENTE", "PARCIAL", "RECIBIDA", "CANCELADA"].includes(status)) {
      statusSql = " AND oc.estado=?";
      params.push(status);
    }
    return this.query(
      `SELECT oc.*,p.razon_social proveedor,u.nombre usuario FROM ordenes_compra oc
       JOIN proveedores p ON p.id=oc.proveedor_id JOIN usuarios u ON u.id=oc.usuario_id
       WHERE (oc.codigo_orden LIKE ? OR p.razon_social LIKE ?)${statusSql}
       ORDER BY oc.fecha_emision DESC`,
      params,
    );
  }
  static async find(id) {
    const order = await this.one(
      `SELECT oc.*,p.razon_social proveedor FROM ordenes_compra oc JOIN proveedores p ON p.id=oc.proveedor_id WHERE oc.id=?`,
      [id],
    );
    if (order)
      order.items = await this.query(
        `SELECT d.*,p.sku,p.codigo_barras,p.nombre producto,p.control_lote,p.control_vencimiento,
         c.nombre categoria,c.vida_util_dias,
         COALESCE(z.condicion_almacenamiento,'AMBIENTE') condicion_requerida
         FROM ordenes_compra_detalle d JOIN productos p ON p.id=d.producto_id
         JOIN categorias c ON c.id=p.categoria_id
         LEFT JOIN ubicaciones_almacen u ON u.id=p.ubicacion_picking_id
         LEFT JOIN zonas_almacen z ON z.id=u.zona_id WHERE d.orden_id=?`,
        [id],
      );
    return order;
  }
}
module.exports = Purchase;
