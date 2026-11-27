const Base = require("./BaseModel");

class Product extends Base {
  static all({ q = "", active = "" } = {}) {
    const params = [`%${q}%`, `%${q}%`, `%${q}%`];
    let activeSql = "";
    if (active === "1" || active === "0") {
      activeSql = " AND p.activo=?";
      params.push(Number(active));
    }
    return this.query(
      `SELECT p.*,c.nombre categoria,m.nombre marca,pr.razon_social proveedor,
      pl.codigo_loc loc_picking,COALESCE(zp.nombre,pl.zona) zona_picking,
      (p.stock_total<=p.stock_minimo) stock_critico
      FROM productos p JOIN categorias c ON c.id=p.categoria_id JOIN marcas m ON m.id=p.marca_id
      LEFT JOIN proveedores pr ON pr.id=p.proveedor_id
      LEFT JOIN ubicaciones_almacen pl ON pl.id=p.ubicacion_picking_id
      LEFT JOIN zonas_almacen zp ON zp.id=pl.zona_id
      WHERE (p.nombre LIKE ? OR p.sku LIKE ? OR COALESCE(p.codigo_barras,'') LIKE ?) ${activeSql} ORDER BY p.nombre`,
      params,
    );
  }
  static active() {
    return this.query(
      `SELECT p.id,p.sku,p.nombre,p.codigo_barras,p.precio_venta,p.precio_compra,
       p.stock_total,p.unidad_medida,p.control_lote,p.control_vencimiento,
       p.proveedor_id,p.imagen_url,p.referencia_url,
       c.nombre categoria,c.vida_util_dias,m.nombre marca,pr.razon_social proveedor
       FROM productos p JOIN categorias c ON c.id=p.categoria_id
       LEFT JOIN marcas m ON m.id=p.marca_id
       LEFT JOIN proveedores pr ON pr.id=p.proveedor_id
       WHERE p.activo=1 ORDER BY p.nombre`,
    );
  }
  static saleable() {
    return this
      .query(`SELECT p.id,p.sku,p.nombre,p.codigo_barras,p.precio_venta,p.precio_compra,p.unidad_medida,
    COALESCE(SUM(CASE WHEN l.estado_inventario='DISPONIBLE' AND u.permite_picking=1
      AND (p.control_vencimiento=0 OR l.fecha_vencimiento>=CURRENT_DATE) THEN l.cantidad_actual ELSE 0 END),0) stock_total
    FROM productos p LEFT JOIN lotes l ON l.producto_id=p.id
    LEFT JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id WHERE p.activo=1
    GROUP BY p.id HAVING stock_total>0 ORDER BY p.nombre`);
  }
  static find(id) {
    return this.one("SELECT * FROM productos WHERE id=?", [id]);
  }
  static pickingLocation(id) {
    return this.one(
      `SELECT u.id,u.codigo_loc,z.condicion_almacenamiento
       FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
       WHERE u.id=? AND u.activo=1 AND u.permite_picking=1 AND u.tipo='PICKING'`,
      [id],
    );
  }
  static primaryOwner(locationId, exceptProductId = 0) {
    return this.one(`SELECT id,sku FROM productos WHERE ubicacion_picking_id=?
      AND activo=1 AND id<>? LIMIT 1`, [locationId, exceptProductId]);
  }
  static async options() {
    const [categorias, marcas, proveedores, pickingLocations] =
      await Promise.all([
        this.query(
          "SELECT id,nombre,descripcion,vida_util_dias FROM categorias ORDER BY nombre",
        ),
        this.query("SELECT id,nombre,descripcion FROM marcas ORDER BY nombre"),
        this.query(
          "SELECT id,razon_social nombre,ruc,telefono,email,logo_url,sitio_web FROM proveedores WHERE activo=1 ORDER BY razon_social",
        ),
        this.query(
          `SELECT u.id,u.codigo_loc,COALESCE(z.nombre,u.zona) zona,z.condicion_almacenamiento,u.capacidad_hu,
           (SELECT p.sku FROM productos p WHERE p.ubicacion_picking_id=u.id AND p.activo=1 LIMIT 1) owner_sku
           FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
           WHERE u.activo=1 AND u.permite_picking=1 ORDER BY z.secuencia_operativa,u.secuencia_pick,u.codigo_loc`,
        ),
      ]);
    return { categorias, marcas, proveedores, pickingLocations };
  }
  static create(d) {
    return this.query(
      `INSERT INTO productos
    (sku,codigo_barras,nombre,categoria_id,marca_id,proveedor_id,precio_compra,precio_venta,
     stock_minimo,activo,clase_abc,unidad_medida,peso_kg,volumen_m3,control_lote,control_vencimiento,
     ubicacion_picking_id,stock_objetivo_pick,imagen_url,referencia_url)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        d.sku,
        d.codigo_barras || null,
        d.nombre,
        d.categoria_id,
        d.marca_id,
        d.proveedor_id || null,
        d.precio_compra,
        d.precio_venta,
        d.stock_minimo,
        d.activo,
        d.clase_abc,
        d.unidad_medida,
        d.peso_kg,
        d.volumen_m3,
        d.control_lote,
        d.control_vencimiento,
        d.ubicacion_picking_id || null,
        d.stock_objetivo_pick,
        d.imagen_url || null,
        d.referencia_url || null,
      ],
    );
  }
  static update(id, d) {
    return this.query(
      `UPDATE productos SET sku=?,codigo_barras=?,nombre=?,categoria_id=?,marca_id=?,proveedor_id=?,
    precio_compra=?,precio_venta=?,stock_minimo=?,activo=?,clase_abc=?,unidad_medida=?,peso_kg=?,volumen_m3=?,
    control_lote=?,control_vencimiento=?,ubicacion_picking_id=?,stock_objetivo_pick=?,
    imagen_url=?,referencia_url=? WHERE id=?`,
      [
        d.sku,
        d.codigo_barras || null,
        d.nombre,
        d.categoria_id,
        d.marca_id,
        d.proveedor_id || null,
        d.precio_compra,
        d.precio_venta,
        d.stock_minimo,
        d.activo,
        d.clase_abc,
        d.unidad_medida,
        d.peso_kg,
        d.volumen_m3,
        d.control_lote,
        d.control_vencimiento,
        d.ubicacion_picking_id || null,
        d.stock_objetivo_pick,
        d.imagen_url || null,
        d.referencia_url || null,
        id,
      ],
    );
  }
  static updateLogistics(id, d) {
    return this.query(
      `UPDATE productos SET unidad_medida=?,peso_kg=?,volumen_m3=?,control_lote=?,
       control_vencimiento=?,ubicacion_picking_id=?,stock_objetivo_pick=?,stock_minimo=?,clase_abc=?
       WHERE id=?`,
      [
        d.unidad_medida,
        d.peso_kg,
        d.volumen_m3,
        d.control_lote,
        d.control_vencimiento,
        d.ubicacion_picking_id || null,
        d.stock_objetivo_pick,
        d.stock_minimo,
        d.clase_abc,
        id,
      ],
    );
  }
  static deactivate(id) {
    return this.query("UPDATE productos SET activo=0 WHERE id=?", [id]);
  }
}
module.exports = Product;
