const bcrypt = require("bcryptjs");
const { pool } = require("../config/db");
const env = require("../config/env");
const { ensureMigrations } = require("./migrate");
const {
  categories,
  brands,
  providers,
  zones,
  locations,
  products,
} = require("./demoData");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function connectWithRetry() {
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt === 20) throw error;
      await wait(2000);
    }
  }
}

function limaDateAfter(days = 0) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seedCatalogs() {
  for (const category of categories) {
    await pool.execute(
      `INSERT INTO categorias (id,nombre,descripcion,vida_util_dias) VALUES (?,?,?,?)
       ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),descripcion=VALUES(descripcion),vida_util_dias=VALUES(vida_util_dias)`,
      category,
    );
  }
  for (const brand of brands) {
    await pool.execute(
      `INSERT INTO marcas (id,nombre,descripcion) VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),descripcion=VALUES(descripcion)`,
      brand,
    );
  }
  for (const provider of providers) {
    await pool.execute(
      `INSERT INTO proveedores (id,ruc,razon_social,telefono,email,logo_url,sitio_web,activo) VALUES (?,?,?,?,?,?,?,1)
       ON DUPLICATE KEY UPDATE ruc=VALUES(ruc),razon_social=VALUES(razon_social),
       telefono=VALUES(telefono),email=VALUES(email),logo_url=VALUES(logo_url),
       sitio_web=VALUES(sitio_web),activo=1`,
      provider,
    );
  }
}

async function seedZones() {
  for (const zone of zones) {
    await pool.execute(
      `INSERT INTO zonas_almacen
       (id,codigo_zona,nombre,proposito,condicion_almacenamiento,descripcion,secuencia_operativa,activo,clase_abc)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE codigo_zona=VALUES(codigo_zona),nombre=VALUES(nombre),
       proposito=VALUES(proposito),condicion_almacenamiento=VALUES(condicion_almacenamiento),
       descripcion=VALUES(descripcion),secuencia_operativa=VALUES(secuencia_operativa),activo=1,
       clase_abc=VALUES(clase_abc)`,
      [...zone.slice(0, 8), zone[8] || null],
    );
  }
}

async function seedLocations() {
  for (const location of locations) {
    await pool.execute(
      `INSERT INTO ubicaciones_almacen
       (id,codigo_loc,zona_id,zona,pasillo,estante,tipo,capacidad_unidades,secuencia_putaway,
        secuencia_pick,permite_recepcion,permite_almacenaje,permite_picking,permite_conteo,activo,nivel,posicion)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE codigo_loc=VALUES(codigo_loc),zona_id=VALUES(zona_id),zona=VALUES(zona),
       pasillo=VALUES(pasillo),estante=VALUES(estante),tipo=VALUES(tipo),
       capacidad_unidades=VALUES(capacidad_unidades),secuencia_putaway=VALUES(secuencia_putaway),
       secuencia_pick=VALUES(secuencia_pick),permite_recepcion=VALUES(permite_recepcion),
       permite_almacenaje=VALUES(permite_almacenaje),permite_picking=VALUES(permite_picking),
       permite_conteo=VALUES(permite_conteo),activo=VALUES(activo),
       nivel=VALUES(nivel),posicion=VALUES(posicion)`,
      [...location.slice(0, 15), location[15] || 1, location[16] || 1],
    );
  }
}

async function normalizeLegacyPicking(adminId) {
  const legacyIds = [6, 7, 8, 9, 10];
  await pool.query(
    `UPDATE tareas_almacen SET estado='CANCELADA',completado_en=CURRENT_TIMESTAMP,
     observaciones=LEFT(CONCAT_WS(' · ',observaciones,'Cancelada por normalización de topología WMS'),500)
     WHERE estado IN ('PENDIENTE','EN_PROCESO')
     AND (ubicacion_origen_id IN (6,7,8,9,10) OR ubicacion_destino_id IN (6,7,8,9,10))`,
  );
  await pool.query(
    "UPDATE productos SET ubicacion_picking_id=1 WHERE ubicacion_picking_id IN (6,7,8,9,10)",
  );
  for (const sourceLocationId of legacyIds) {
    const [[sourceLocation]] = await pool.execute(
      "SELECT id,codigo_loc FROM ubicaciones_almacen WHERE id=?",
      [sourceLocationId],
    );
    if (!sourceLocation) continue;
    const [positions] = await pool.execute(
      "SELECT * FROM lotes WHERE ubicacion_id=? AND cantidad_actual>0 ORDER BY id",
      [sourceLocationId],
    );
    for (const position of positions) {
      const [[target]] = await pool.execute(
        `SELECT * FROM lotes WHERE producto_id=? AND numero_lote=? AND ubicacion_id=1`,
        [position.producto_id, position.numero_lote],
      );
      if (target && target.estado_inventario !== position.estado_inventario)
        continue;
      let targetLotId = position.id;
      if (target) {
        await pool.execute(
          `UPDATE lotes SET cantidad_inicial=cantidad_inicial+?,cantidad_actual=cantidad_actual+?
           WHERE id=?`,
          [position.cantidad_actual, position.cantidad_actual, target.id],
        );
        await pool.execute("UPDATE lotes SET cantidad_actual=0 WHERE id=?", [
          position.id,
        ]);
        targetLotId = target.id;
      } else {
        await pool.execute("UPDATE lotes SET ubicacion_id=1 WHERE id=?", [
          position.id,
        ]);
      }
      const reason = `Normalización WMS: ${sourceLocation.codigo_loc} → PCK-SECO-01`;
      await pool.execute(
        `INSERT INTO movimientos_almacen
         (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,motivo)
         VALUES (?,?,?,'SALIDA',?,'TRASLADO',?),(?,?,?,'ENTRADA',?,'TRASLADO',?)`,
        [
          position.producto_id,
          position.id,
          adminId,
          position.cantidad_actual,
          reason,
          position.producto_id,
          targetLotId,
          adminId,
          position.cantidad_actual,
          reason,
        ],
      );
    }
    const [[remaining]] = await pool.execute(
      "SELECT COALESCE(SUM(cantidad_actual),0) unidades FROM lotes WHERE ubicacion_id=?",
      [sourceLocationId],
    );
    await pool.execute("UPDATE ubicaciones_almacen SET activo=? WHERE id=?", [
      Number(remaining.unidades) > 0 ? 1 : 0,
      sourceLocationId,
    ]);
  }
}

async function seedProducts() {
  const sql = `INSERT INTO productos
    (sku,codigo_barras,nombre,categoria_id,marca_id,proveedor_id,precio_compra,precio_venta,
     stock_total,stock_minimo,unidad_medida,peso_kg,volumen_m3,control_lote,
     control_vencimiento,ubicacion_picking_id,stock_objetivo_pick,imagen_url,referencia_url,activo)
    VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?,?,1)
    ON DUPLICATE KEY UPDATE codigo_barras=VALUES(codigo_barras),nombre=VALUES(nombre),
    categoria_id=VALUES(categoria_id),marca_id=VALUES(marca_id),proveedor_id=VALUES(proveedor_id),
    precio_compra=VALUES(precio_compra),precio_venta=VALUES(precio_venta),
    stock_minimo=VALUES(stock_minimo),unidad_medida=VALUES(unidad_medida),peso_kg=VALUES(peso_kg),
    volumen_m3=VALUES(volumen_m3),control_lote=VALUES(control_lote),
    control_vencimiento=VALUES(control_vencimiento),ubicacion_picking_id=VALUES(ubicacion_picking_id),
    stock_objetivo_pick=VALUES(stock_objetivo_pick),imagen_url=VALUES(imagen_url),
    referencia_url=VALUES(referencia_url),activo=1`;
  for (const item of products) {
    await pool.execute(sql, [
      item.sku,
      item.barcode,
      item.name,
      item.categoryId,
      item.brandId,
      item.providerId,
      item.cost,
      item.price,
      item.minimum,
      item.uom,
      item.weight,
      item.volume,
      item.lotControl,
      item.expiryControl,
      item.pickLocationId,
      item.pickTarget,
      item.imageUrl,
      item.referenceUrl,
    ]);
  }
}

async function seedInitialStock(adminId) {
  const reserveLocationByPicking = new Map([
    [1, 2],
    [3, 11],
    [12, 13],
  ]);
  const entrySql = `INSERT INTO lotes
    (numero_lote,lote_fabricante_id,producto_id,ubicacion_id,cantidad_inicial,cantidad_actual,
     fecha_ingreso,fecha_vencimiento,estado_inventario)
    VALUES (?,?,?,?,?,?,?,?,'DISPONIBLE')`;
  for (const item of products) {
    const [[dbProduct]] = await pool.execute(
      "SELECT id FROM productos WHERE sku=?",
      [item.sku],
    );
    const reserveLocationId = reserveLocationByPicking.get(item.pickLocationId);
    if (!reserveLocationId)
      throw new Error(
        `El SKU ${item.sku} no tiene pareja picking/reserva en el escenario demo`,
      );
    const expiryDate = item.expiryControl
      ? limaDateAfter(item.shelfLifeDays)
      : null;
    const positions = [
      [`DEMO-${item.sku}-P`, item.pickLocationId, item.pickQty],
      [`DEMO-${item.sku}-R`, reserveLocationId, item.reserveQty],
    ];
    for (const [lotNumber, locationId, quantity] of positions) {
      const [[present]] = await pool.execute(
        `SELECT id FROM lotes WHERE producto_id=? AND numero_lote=? AND ubicacion_id=? LIMIT 1`,
        [dbProduct.id, lotNumber, locationId],
      );
      if (present) continue;
      await pool.execute(
        `INSERT IGNORE INTO lotes_fabricante
         (producto_id,codigo_lote,fecha_vencimiento,fecha_verificada)
         VALUES (?,?,?,0)`,
        [dbProduct.id, lotNumber, expiryDate],
      );
      const [[batch]] = await pool.execute(
        "SELECT id FROM lotes_fabricante WHERE producto_id=? AND codigo_lote=?",
        [dbProduct.id, lotNumber],
      );
      const [lot] = await pool.execute(entrySql, [
        lotNumber,
        batch.id,
        dbProduct.id,
        locationId,
        quantity,
        quantity,
        limaDateAfter(0),
        expiryDate,
      ]);
      if (lot.affectedRows) {
        await pool.execute(
          `INSERT INTO movimientos_almacen
           (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,motivo)
           VALUES (?,?,?,'ENTRADA',?,'AJUSTE','Carga inicial del escenario WMS demo')`,
          [dbProduct.id, lot.insertId, adminId, quantity],
        );
      }
    }
    await pool.execute(
      `UPDATE productos SET stock_total=(
        SELECT COALESCE(SUM(cantidad_actual),0) FROM lotes WHERE producto_id=productos.id
       ) WHERE id=?`,
      [dbProduct.id],
    );
  }
}

async function productIdBySku(sku) {
  const [[product]] = await pool.execute(
    "SELECT id FROM productos WHERE sku=?",
    [sku],
  );
  return product?.id;
}

async function locationIdByCode(code) {
  const [[location]] = await pool.execute(
    "SELECT id FROM ubicaciones_almacen WHERE codigo_loc=?",
    [code],
  );
  return location?.id;
}

async function seedOpenPurchaseOrder(adminId) {
  const [[existing]] = await pool.execute(
    "SELECT id FROM ordenes_compra WHERE codigo_orden='OC-2026-WMS01'",
  );
  if (existing) return;
  const [order] = await pool.execute(
    `INSERT INTO ordenes_compra
     (codigo_orden,proveedor_id,usuario_id,total_estimado)
     VALUES ('OC-2026-WMS01',1,?,256.80)`,
    [adminId],
  );
  const items = [
    ["SKU-BEB-0005", 48, 1.8],
    ["SKU-BEB-0007", 36, 1.8],
    ["SKU-BEB-0010", 60, 1.05],
  ];
  for (const [sku, qty, cost] of items) {
    const productId = await productIdBySku(sku);
    if (!productId) continue;
    await pool.execute(
      `INSERT INTO ordenes_compra_detalle
       (orden_id,producto_id,cantidad_solicitada,precio_unitario_compra)
       VALUES (?,?,?,?)`,
      [order.insertId, productId, qty, cost],
    );
  }
}

async function seedRfWorkQueue(adminId) {
  const queue = [
    {
      code: "TA-RF-REP-001",
      type: "REABASTECIMIENTO",
      sku: "SKU-BEB-0001",
      lot: "DEMO-SKU-BEB-0001-R",
      destination: "PCK-SECO-01",
      quantity: 20,
      priority: "ALTA",
      notes: "Reponer cara de picking antes del turno de mayor demanda.",
    },
    {
      code: "TA-RF-PICK-001",
      type: "PICKING",
      sku: "SKU-SNK-0015",
      lot: "DEMO-SKU-SNK-0015-P",
      destination: "DSP-01",
      quantity: 12,
      priority: "NORMAL",
      notes: "Preparar pedido interno para reposición de góndola frontal.",
    },
  ];
  for (const item of queue) {
    const [[exists]] = await pool.execute(
      "SELECT id FROM tareas_almacen WHERE codigo_tarea=?",
      [item.code],
    );
    if (exists) continue;
    const [[source]] = await pool.execute(
      `SELECT l.id,l.producto_id,l.ubicacion_id
       FROM lotes l JOIN productos p ON p.id=l.producto_id
       WHERE p.sku=? AND l.numero_lote=? LIMIT 1`,
      [item.sku, item.lot],
    );
    const destinationId = await locationIdByCode(item.destination);
    if (!source || !destinationId) continue;
    await pool.execute(
      `INSERT INTO tareas_almacen
       (codigo_tarea,tipo,prioridad,producto_id,lote_origen_id,ubicacion_origen_id,
        ubicacion_destino_id,cantidad,creado_por,observaciones)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        item.code,
        item.type,
        item.priority,
        source.producto_id,
        source.id,
        source.ubicacion_id,
        destinationId,
        item.quantity,
        adminId,
        item.notes,
      ],
    );
  }

  const returnProductId = await productIdBySku("SKU-BEB-0005");
  const dispatchId = await locationIdByCode("DSP-01");
  const quarantineId = await locationIdByCode("QUA-01");
  if (!returnProductId || !dispatchId || !quarantineId) return;
  const [[previousReturn]] = await pool.execute(
    "SELECT id FROM lotes WHERE producto_id=? AND numero_lote='RET-RUTA-COCA-001' AND ubicacion_id=? LIMIT 1",
    [returnProductId, dispatchId],
  );
  await pool.execute(
    `INSERT IGNORE INTO lotes_fabricante
     (producto_id,codigo_lote,fecha_vencimiento,fecha_verificada)
     VALUES (?,'RET-RUTA-COCA-001',?,0)`,
    [returnProductId, limaDateAfter(120)],
  );
  const [[returnBatch]] = await pool.execute(
    "SELECT id FROM lotes_fabricante WHERE producto_id=? AND codigo_lote='RET-RUTA-COCA-001'",
    [returnProductId],
  );
  const lot = previousReturn ? { insertId: previousReturn.id, affectedRows: 0 } : await pool.execute(
    `INSERT INTO lotes
     (numero_lote,lote_fabricante_id,producto_id,ubicacion_id,cantidad_inicial,cantidad_actual,
      fecha_ingreso,fecha_vencimiento,estado_inventario)
     VALUES ('RET-RUTA-COCA-001',?,?,?,6,6,?,?,'DISPONIBLE')`,
    [returnBatch.id, returnProductId, dispatchId, limaDateAfter(0), limaDateAfter(120)],
  ).then(([result]) => result);
  let returnLotId = lot.insertId;
  if (!returnLotId) {
    const [[existingLot]] = await pool.execute(
      "SELECT id FROM lotes WHERE producto_id=? AND numero_lote='RET-RUTA-COCA-001' AND ubicacion_id=?",
      [returnProductId, dispatchId],
    );
    returnLotId = existingLot?.id;
  }
  if (returnLotId && lot.affectedRows) {
    await pool.execute(
      `INSERT INTO movimientos_almacen
       (producto_id,lote_id,usuario_id,tipo_movimiento,cantidad,referencia_tipo,motivo)
       VALUES (?, ?, ?, 'ENTRADA', 6, 'AJUSTE', 'Retorno de ruta demo pendiente de revisión')`,
      [returnProductId, returnLotId, adminId],
    );
    await pool.execute(
      `UPDATE productos SET stock_total=(
        SELECT COALESCE(SUM(cantidad_actual),0) FROM lotes WHERE producto_id=productos.id
       ) WHERE id=?`,
      [returnProductId],
    );
  }
  const [[returnTask]] = await pool.execute(
    "SELECT id FROM tareas_almacen WHERE codigo_tarea='TA-RF-RET-001'",
  );
  if (!returnTask && returnLotId) {
    await pool.execute(
      `INSERT INTO tareas_almacen
       (codigo_tarea,tipo,prioridad,producto_id,lote_origen_id,ubicacion_origen_id,
        ubicacion_destino_id,cantidad,creado_por,observaciones)
       VALUES ('TA-RF-RET-001','DEVOLUCION_RUTA','ALTA',?,?,?,?,6,?,'Aislar retorno por rechazo de cliente y revisar empaque')`,
      [returnProductId, returnLotId, dispatchId, quarantineId, adminId],
    );
  }
}

async function seedBranchDistribution(adminId) {
  const branches = [
    [
      "DP-CENTRO",
      "Don Pepe Centro · demostración",
      "Dirección de entrega de demostración, Lima Centro",
    ],
    [
      "DP-NORTE",
      "Don Pepe Norte · demostración",
      "Dirección de entrega de demostración, Lima Norte",
    ],
  ];
  for (const [code, name, address] of branches)
    await pool.execute(
      `INSERT IGNORE INTO sucursales (codigo,nombre,direccion)
      VALUES (?,?,?)`,
      [code, name, address],
    );
  const [[branch]] = await pool.execute(
    "SELECT id FROM sucursales WHERE codigo='DP-CENTRO' LIMIT 1",
  );
  const [[existing]] = await pool.execute(
    "SELECT id FROM pedidos_sucursal WHERE codigo='PS-DEMO-CENTRO'",
    [],
  );
  if (existing) return;
  const productId = await productIdBySku("SKU-SNK-0015");
  if (!productId) return;
  const [order] = await pool.execute(
    `INSERT INTO pedidos_sucursal (codigo,sucursal_id,creado_por,estado,observaciones)
     VALUES ('PS-DEMO-CENTRO',?,?,'EN_PREPARACION','Pedido interno de demostración')`,
    [branch.id, adminId],
  );
  const [line] = await pool.execute(
    `INSERT INTO pedidos_sucursal_detalle (pedido_id,producto_id,cantidad_solicitada)
     VALUES (?,?,12)`,
    [order.insertId, productId],
  );
  await pool.execute(
    `UPDATE tareas_almacen SET pedido_sucursal_detalle_id=?,
    referencia_operativa='PS-DEMO-CENTRO'
    WHERE codigo_tarea='TA-RF-PICK-001' AND pedido_sucursal_detalle_id IS NULL`,
    [line.insertId],
  );
}

async function seed() {
  await connectWithRetry();
  await ensureMigrations();
  await pool.query(`INSERT INTO roles (id,nombre,descripcion) VALUES
    (1,'administrador_wms','Gobierno general del WMS, seguridad y configuración maestra'),
    (2,'jefe_operaciones','Planificación, supervisión y control operativo del almacén'),
    (3,'operador_rf','Ejecución móvil RF: recepción, check-in, picking, transferencias, conteos y retornos')
    ON DUPLICATE KEY UPDATE nombre=VALUES(nombre),descripcion=VALUES(descripcion)`);
  const users = [
    ["Frank Admin WMS", "frank@minimarket.com", "admin123", 1],
    ["Carlos Jefe Operaciones", "carlos@minimarket.com", "operaciones123", 2],
    ["Ana Operadora RF", "ana@minimarket.com", "rf123456", 3],
  ];
  for (const [name, email, plainPassword, roleId] of users) {
    const hash = await bcrypt.hash(plainPassword, 12);
    await pool.execute(
      `INSERT INTO usuarios (nombre,correo,correo_recuperacion,password,rol_id) VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE nombre=VALUES(nombre)`,
      [name, email, email, hash, roleId],
    );
  }
  await seedCatalogs();
  await seedZones();
  await seedLocations();
  await seedProducts();
  const [[admin]] = await pool.execute(
    "SELECT id FROM usuarios WHERE correo='frank@minimarket.com'",
  );
  await normalizeLegacyPicking(admin.id);
  await seedInitialStock(admin.id);
  await seedOpenPurchaseOrder(admin.id);
  await seedRfWorkQueue(admin.id);
  await seedBranchDistribution(admin.id);
  await ensureMigrations();
  const [[plan]] = await pool.query("SELECT COUNT(*) bins FROM ubicaciones_almacen WHERE modelo_plano='CD1' AND activo=1");
  console.log(
    `Datos iniciales listos: ${products.length} SKU, ${providers.length} proveedores, ${zones.length} zonas y ${plan.bins} LOC CD1.`,
  );
}

if (require.main === module)
  seed()
    .then(() => pool.end())
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });

module.exports = { seed, connectWithRetry };
