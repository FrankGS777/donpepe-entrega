const { pool } = require("../config/db");
const env = require("../config/env");
const { migrateWarehouseBlueprint } = require("./warehouseBlueprintMigration");

async function exists(kind, table, name) {
  const sources = {
    column: ["COLUMNS", "COLUMN_NAME"],
    constraint: ["TABLE_CONSTRAINTS", "CONSTRAINT_NAME"],
    index: ["STATISTICS", "INDEX_NAME"],
    table: ["TABLES", "TABLE_NAME"],
  };
  const [source, field] = sources[kind];
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.${source}
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND ${field}=? LIMIT 1`,
    [table, name],
  );
  return rows.length > 0;
}

const hasColumn = (table, column) => exists("column", table, column);
const hasConstraint = (table, constraint) =>
  exists("constraint", table, constraint);
const hasIndex = (table, index) => exists("index", table, index);
const hasTable = (table) => exists("table", table, table);

async function indexColumns(table, name) {
  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME=?
     ORDER BY SEQ_IN_INDEX`,
    [table, name],
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function hasUniqueColumn(table, column) {
  const [rows] = await pool.execute(
    `SELECT 1 FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? AND NON_UNIQUE=0 LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function columnMetadata(table, column) {
  const [rows] = await pool.execute(
    `SELECT IS_NULLABLE,COLUMN_TYPE FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=? LIMIT 1`,
    [table, column],
  );
  return rows[0] || null;
}

async function addColumn(table, column, definition) {
  if (!(await hasColumn(table, column)))
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

async function migrateUserRecoveryEmail() {
  await addColumn(
    "usuarios",
    "correo_recuperacion",
    "VARCHAR(100) NULL AFTER correo",
  );
}

async function migratePasswordHistory() {
  await pool.query(`CREATE TABLE IF NOT EXISTS historial_contrasenas (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_historial_contrasenas_usuario FOREIGN KEY (usuario_id)
      REFERENCES usuarios(id) ON DELETE CASCADE,
    INDEX idx_historial_contrasenas_usuario (usuario_id,id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function migrateAudits() {
  if (!(await hasColumn("inventarios_auditoria", "estado"))) {
    await pool.query(
      "ALTER TABLE inventarios_auditoria ADD COLUMN estado ENUM('PENDIENTE','APROBADA','RECHAZADA') NOT NULL DEFAULT 'APROBADA' AFTER tipo_ajuste",
    );
    await pool.query(
      "ALTER TABLE inventarios_auditoria ALTER COLUMN estado SET DEFAULT 'PENDIENTE'",
    );
  }
  await addColumn(
    "inventarios_auditoria",
    "ubicacion_id",
    "INT NULL AFTER estado",
  );
  await addColumn(
    "inventarios_auditoria",
    "codigo_lote",
    "VARCHAR(50) NULL AFTER ubicacion_id",
  );
  await addColumn(
    "inventarios_auditoria",
    "fecha_vencimiento_ajuste",
    "DATE NULL AFTER ubicacion_id",
  );
  await addColumn(
    "inventarios_auditoria",
    "aprobado_por",
    "INT NULL AFTER fecha_vencimiento_ajuste",
  );
  await addColumn(
    "inventarios_auditoria",
    "aprobado_en",
    "TIMESTAMP NULL AFTER aprobado_por",
  );
  if (!(await hasConstraint("inventarios_auditoria", "fk_ia_ubicacion")))
    await pool.query(
      "ALTER TABLE inventarios_auditoria ADD CONSTRAINT fk_ia_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT",
    );
  if (!(await hasConstraint("inventarios_auditoria", "fk_ia_aprobador")))
    await pool.query(
      "ALTER TABLE inventarios_auditoria ADD CONSTRAINT fk_ia_aprobador FOREIGN KEY (aprobado_por) REFERENCES usuarios(id) ON DELETE RESTRICT",
    );
}

async function migrateWarehouseZones() {
  if (!(await hasTable("zonas_almacen")))
    await pool.query(`CREATE TABLE zonas_almacen (
      id INT AUTO_INCREMENT PRIMARY KEY, codigo_zona VARCHAR(12) UNIQUE NOT NULL,
      nombre VARCHAR(60) UNIQUE NOT NULL,
      proposito ENUM('ENTRADA','ALMACENAJE','PICKING','CONTROL','SALIDA') NOT NULL,
      condicion_almacenamiento ENUM('AMBIENTE','REFRIGERADO','CONGELADO') NOT NULL DEFAULT 'AMBIENTE',
      descripcion VARCHAR(255) NOT NULL, secuencia_operativa INT NOT NULL DEFAULT 100,
      activo BOOLEAN NOT NULL DEFAULT TRUE,
      CONSTRAINT chk_zona_secuencia CHECK (secuencia_operativa > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  const purpose = await columnMetadata("zonas_almacen", "proposito");
  if (!purpose?.COLUMN_TYPE.includes("SALIDA"))
    await pool.query(
      "ALTER TABLE zonas_almacen MODIFY COLUMN proposito ENUM('ENTRADA','ALMACENAJE','PICKING','CONTROL','SALIDA') NOT NULL",
    );
  await addColumn(
    "zonas_almacen",
    "clase_abc",
    "ENUM('A','B','C') NULL AFTER condicion_almacenamiento",
  );
  const [[legacyDry]] = await pool.query(
    "SELECT id FROM zonas_almacen WHERE codigo_zona='SEC' LIMIT 1",
  );
  if (legacyDry) {
    await pool.query(
      `UPDATE zonas_almacen SET codigo_zona='SEC-B',clase_abc='B',
      nombre=IF(nombre='Almacenamiento seco','Reserva seca B · rotación media',nombre)
      WHERE id=?`,
      [legacyDry.id],
    );
    await pool.query(`INSERT IGNORE INTO zonas_almacen
      (codigo_zona,nombre,proposito,condicion_almacenamiento,clase_abc,descripcion,secuencia_operativa,activo)
      VALUES
      ('SEC-A','Reserva seca A · alta rotación','ALMACENAJE','AMBIENTE','A',
       'Reserva seca de alta rotación cercana a preparación',18,1),
      ('SEC-C','Reserva seca C · baja rotación','ALMACENAJE','AMBIENTE','C',
       'Reserva seca de baja rotación',28,1)`);
  }
  const [[dispatchZone]] = await pool.query(
    "SELECT id FROM zonas_almacen WHERE codigo_zona='DSP' LIMIT 1",
  );
  if (dispatchZone)
    await pool.query(`INSERT IGNORE INTO zonas_almacen
      (codigo_zona,nombre,proposito,condicion_almacenamiento,descripcion,secuencia_operativa,activo)
      VALUES
      ('DSP-F','Staging refrigerado','SALIDA','REFRIGERADO','Consolidación de pedidos refrigerados',71,1),
      ('DSP-C','Staging congelado','SALIDA','CONGELADO','Consolidación de pedidos congelados',72,1)`);
  const [[receivingZone]] = await pool.query(
    "SELECT id FROM zonas_almacen WHERE codigo_zona='REC' LIMIT 1",
  );
  const [[quarantineZone]] = await pool.query(
    "SELECT id FROM zonas_almacen WHERE codigo_zona='QUA' LIMIT 1",
  );
  if (receivingZone)
    await pool.query(`INSERT IGNORE INTO zonas_almacen
      (codigo_zona,nombre,proposito,condicion_almacenamiento,descripcion,secuencia_operativa,activo)
      VALUES
      ('REC-F','Recepción refrigerada','ENTRADA','REFRIGERADO','Descarga y verificación refrigerada contra OC',11,1),
      ('REC-C','Recepción congelada','ENTRADA','CONGELADO','Descarga y verificación congelada contra OC',12,1)`);
  if (quarantineZone)
    await pool.query(`INSERT IGNORE INTO zonas_almacen
      (codigo_zona,nombre,proposito,condicion_almacenamiento,descripcion,secuencia_operativa,activo)
      VALUES
      ('QUA-F','Cuarentena refrigerada','CONTROL','REFRIGERADO','Aislamiento refrigerado',61,1),
      ('QUA-C','Cuarentena congelada','CONTROL','CONGELADO','Aislamiento congelado',62,1)`);
  await pool.query(`UPDATE zonas_almacen
    SET nombre='Picking y preparación de sucursales',
        descripcion='Stock activo para pedidos internos de sucursales y reposición desde reserva'
    WHERE codigo_zona='VEN' AND nombre='Picking de tienda'`);
  await addColumn(
    "ubicaciones_almacen",
    "zona_id",
    "INT NULL AFTER codigo_loc",
  );
  if (!(await hasIndex("ubicaciones_almacen", "idx_loc_zona")))
    await pool.query(
      "ALTER TABLE ubicaciones_almacen ADD INDEX idx_loc_zona (zona_id)",
    );
  if (!(await hasConstraint("ubicaciones_almacen", "fk_loc_zona")))
    await pool.query(
      "ALTER TABLE ubicaciones_almacen ADD CONSTRAINT fk_loc_zona FOREIGN KEY (zona_id) REFERENCES zonas_almacen(id) ON DELETE RESTRICT",
    );
}

async function migrateDistributionBins() {
  const specifications = [
    ["SEC-A", "SEC-A-P01-M01-N01-C01", "RESERVA", 600, 18],
    ["SEC-C", "SEC-C-P03-M01-N01-C01", "RESERVA", 600, 60],
    ["DSP-F", "DSP-F-P01-M01-N01-C01", "DESPACHO", 400, 810],
    ["DSP-C", "DSP-C-P01-M01-N01-C01", "DESPACHO", 300, 820],
    ["REC-F", "REC-F-P01-M01-N01-C01", "RECEPCION", 400, 2],
    ["REC-C", "REC-C-P01-M01-N01-C01", "RECEPCION", 300, 3],
    ["QUA-F", "QUA-F-P01-M01-N01-C01", "CUARENTENA", 400, 910],
    ["QUA-C", "QUA-C-P01-M01-N01-C01", "CUARENTENA", 300, 920],
  ];
  for (const [zoneCode, code, type, capacity, sequence] of specifications) {
    const [[zone]] = await pool.execute(
      "SELECT id,nombre FROM zonas_almacen WHERE codigo_zona=?",
      [zoneCode],
    );
    if (!zone) continue;
    const receiving = ["RECEPCION", "CUARENTENA"].includes(type) ? 1 : 0;
    const storage = type === "RECEPCION" ? 0 : 1;
    await pool.execute(
      `INSERT IGNORE INTO ubicaciones_almacen
      (codigo_loc,zona_id,zona,pasillo,estante,nivel,posicion,tipo,capacidad_unidades,
       secuencia_putaway,secuencia_pick,permite_recepcion,permite_almacenaje,
       permite_picking,permite_conteo,activo)
      VALUES (?,?,?,'01','01',1,1,?,?,?,500,?,?,0,1,1)`,
      [
        code,
        zone.id,
        zone.nombre,
        type,
        capacity,
        sequence,
        receiving,
        storage,
      ],
    );
  }
}

async function migrateLocations() {
  if (!(await hasColumn("ubicaciones_almacen", "codigo_loc"))) {
    await pool.query(
      "ALTER TABLE ubicaciones_almacen ADD COLUMN codigo_loc VARCHAR(30) NULL AFTER id",
    );
    await pool.query(
      "UPDATE ubicaciones_almacen SET codigo_loc=CONCAT('LOC-',LPAD(id,4,'0')) WHERE codigo_loc IS NULL",
    );
    await pool.query(
      "ALTER TABLE ubicaciones_almacen MODIFY COLUMN codigo_loc VARCHAR(30) NOT NULL",
    );
  }
  if (!(await hasUniqueColumn("ubicaciones_almacen", "codigo_loc")))
    await pool.query(
      "ALTER TABLE ubicaciones_almacen ADD UNIQUE KEY uq_loc_codigo (codigo_loc)",
    );
  await addColumn(
    "ubicaciones_almacen",
    "nivel",
    "SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER estante",
  );
  await addColumn(
    "ubicaciones_almacen",
    "posicion",
    "SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER nivel",
  );
  await addColumn(
    "ubicaciones_almacen",
    "layout_x",
    "DECIMAL(8,2) NULL AFTER posicion",
  );
  await addColumn(
    "ubicaciones_almacen",
    "layout_z",
    "DECIMAL(8,2) NULL AFTER layout_x",
  );
  await addColumn(
    "ubicaciones_almacen",
    "layout_verificado",
    "BOOLEAN NOT NULL DEFAULT FALSE AFTER layout_z",
  );
  const physicalIndex = await indexColumns(
    "ubicaciones_almacen",
    "unica_ubicacion",
  );
  const blueprintIndexed = await hasColumn("ubicaciones_almacen", "modelo_plano");
  const expectedIndex = blueprintIndexed
    ? "modelo_plano,zona_id,pasillo,estante,nivel,posicion,profundidad"
    : "zona_id,pasillo,estante,nivel,posicion";
  if (physicalIndex.join(",") !== expectedIndex) {
    if (physicalIndex.length)
      await pool.query(
        "ALTER TABLE ubicaciones_almacen DROP INDEX unica_ubicacion",
      );
    await pool.query(`ALTER TABLE ubicaciones_almacen ADD UNIQUE KEY unica_ubicacion
      (${expectedIndex})`);
  }
  await addColumn(
    "ubicaciones_almacen",
    "tipo",
    "ENUM('RECEPCION','RESERVA','PICKING','CUARENTENA','DESPACHO') NOT NULL DEFAULT 'RESERVA' AFTER estante",
  );
  const locationType = await columnMetadata("ubicaciones_almacen", "tipo");
  if (!locationType?.COLUMN_TYPE.includes("DESPACHO"))
    await pool.query(
      "ALTER TABLE ubicaciones_almacen MODIFY COLUMN tipo ENUM('RECEPCION','RESERVA','PICKING','CUARENTENA','DESPACHO') NOT NULL DEFAULT 'RESERVA'",
    );
  await addColumn(
    "ubicaciones_almacen",
    "capacidad_unidades",
    "INT NOT NULL DEFAULT 1000 AFTER tipo",
  );
  await addColumn(
    "ubicaciones_almacen",
    "secuencia_putaway",
    "INT NOT NULL DEFAULT 100 AFTER capacidad_unidades",
  );
  await addColumn(
    "ubicaciones_almacen",
    "secuencia_pick",
    "INT NOT NULL DEFAULT 100 AFTER secuencia_putaway",
  );
  await addColumn(
    "ubicaciones_almacen",
    "permite_recepcion",
    "BOOLEAN NOT NULL DEFAULT FALSE AFTER secuencia_pick",
  );
  await addColumn(
    "ubicaciones_almacen",
    "permite_almacenaje",
    "BOOLEAN NOT NULL DEFAULT TRUE AFTER permite_recepcion",
  );
  await addColumn(
    "ubicaciones_almacen",
    "permite_picking",
    "BOOLEAN NOT NULL DEFAULT FALSE AFTER permite_almacenaje",
  );
  await addColumn(
    "ubicaciones_almacen",
    "permite_conteo",
    "BOOLEAN NOT NULL DEFAULT TRUE AFTER permite_picking",
  );
  await addColumn(
    "ubicaciones_almacen",
    "activo",
    "BOOLEAN NOT NULL DEFAULT TRUE AFTER permite_conteo",
  );
}

async function migrateProducts() {
  if (!(await hasColumn("productos", "sku"))) {
    await pool.query(
      "ALTER TABLE productos ADD COLUMN sku VARCHAR(40) NULL AFTER id",
    );
    await pool.query(
      "UPDATE productos SET sku=CONCAT('SKU-',LPAD(id,6,'0')) WHERE sku IS NULL",
    );
    await pool.query(
      "ALTER TABLE productos MODIFY COLUMN sku VARCHAR(40) NOT NULL",
    );
  }
  if (!(await hasUniqueColumn("productos", "sku")))
    await pool.query(
      "ALTER TABLE productos ADD UNIQUE KEY uq_productos_sku (sku)",
    );
  await addColumn(
    "productos",
    "unidad_medida",
    "ENUM('UND','CAJA','PAQUETE','KG','L') NOT NULL DEFAULT 'UND' AFTER activo",
  );
  await addColumn(
    "productos",
    "peso_kg",
    "DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER unidad_medida",
  );
  await addColumn(
    "productos",
    "volumen_m3",
    "DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER peso_kg",
  );
  await addColumn(
    "productos",
    "control_lote",
    "BOOLEAN NOT NULL DEFAULT TRUE AFTER volumen_m3",
  );
  await addColumn(
    "productos",
    "control_vencimiento",
    "BOOLEAN NOT NULL DEFAULT TRUE AFTER control_lote",
  );
  await addColumn(
    "productos",
    "ubicacion_picking_id",
    "INT NULL AFTER control_vencimiento",
  );
  await addColumn(
    "productos",
    "stock_objetivo_pick",
    "INT NOT NULL DEFAULT 0 AFTER ubicacion_picking_id",
  );
  await addColumn(
    "productos",
    "imagen_url",
    "VARCHAR(500) NULL AFTER stock_objetivo_pick",
  );
  await addColumn(
    "productos",
    "referencia_url",
    "VARCHAR(500) NULL AFTER imagen_url",
  );
  if (!(await hasConstraint("productos", "fk_productos_loc_picking")))
    await pool.query(
      "ALTER TABLE productos ADD CONSTRAINT fk_productos_loc_picking FOREIGN KEY (ubicacion_picking_id) REFERENCES ubicaciones_almacen(id) ON DELETE SET NULL",
    );
}

async function migrateProviderMedia() {
  await addColumn("proveedores", "logo_url", "VARCHAR(500) NULL AFTER email");
  await addColumn(
    "proveedores",
    "sitio_web",
    "VARCHAR(255) NULL AFTER logo_url",
  );
}

async function migrateCategories() {
  await addColumn(
    "categorias",
    "vida_util_dias",
    "INT NOT NULL DEFAULT 365 AFTER descripcion",
  );
}

async function migrateUserRequests() {
  if (!(await hasTable("solicitudes_usuario")))
    await pool.query(`CREATE TABLE solicitudes_usuario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo VARCHAR(24) UNIQUE NOT NULL,
    tipo ENUM('ALTA','RESET_PASSWORD') NOT NULL,
    nombre VARCHAR(100) NULL,
    correo VARCHAR(100) NOT NULL,
    rol_solicitado_id INT NULL,
    motivo VARCHAR(500) NOT NULL,
    estado ENUM('PENDIENTE','APROBADA','RECHAZADA','COMPLETADA','EXPIRADA') NOT NULL DEFAULT 'PENDIENTE',
    usuario_id INT NULL,
    revisado_por INT NULL,
    observacion_admin VARCHAR(500) NULL,
    token_hash CHAR(64) NULL,
    token_expira_en DATETIME NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revisado_en DATETIME NULL,
    completado_en DATETIME NULL,
    actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_solicitud_rol FOREIGN KEY (rol_solicitado_id) REFERENCES roles(id) ON DELETE RESTRICT,
    CONSTRAINT fk_solicitud_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
    CONSTRAINT fk_solicitud_revisor FOREIGN KEY (revisado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
    INDEX idx_solicitud_estado_fecha (estado,creado_en),
    INDEX idx_solicitud_correo_tipo (correo,tipo),
    INDEX idx_solicitud_token (token_hash)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumn(
    "solicitudes_usuario",
    "envio_estado",
    "ENUM('NO_APLICA','PENDIENTE','ENVIADO','ERROR') NOT NULL DEFAULT 'NO_APLICA' AFTER token_expira_en",
  );
  await addColumn(
    "solicitudes_usuario",
    "enviado_en",
    "DATETIME NULL AFTER envio_estado",
  );
  await addColumn(
    "solicitudes_usuario",
    "envio_error",
    "VARCHAR(500) NULL AFTER enviado_en",
  );
}

async function migrateLotsAndMovements() {
  const expiry = await columnMetadata("lotes", "fecha_vencimiento");
  if (expiry?.IS_NULLABLE !== "YES")
    await pool.query(
      "ALTER TABLE lotes MODIFY COLUMN fecha_vencimiento DATE NULL",
    );
  await addColumn(
    "lotes",
    "estado_inventario",
    "ENUM('DISPONIBLE','CUARENTENA','BLOQUEADO') NOT NULL DEFAULT 'DISPONIBLE' AFTER fecha_vencimiento",
  );
  if (await hasIndex("lotes", "uq_lotes_producto_numero"))
    await pool.query("ALTER TABLE lotes DROP INDEX uq_lotes_producto_numero");
  if (
    !(await hasIndex("lotes", "uq_lotes_producto_numero_loc")) &&
    !(await hasIndex("lotes", "uq_posicion_stock"))
  )
    await pool.query(
      "ALTER TABLE lotes ADD UNIQUE KEY uq_lotes_producto_numero_loc (producto_id,numero_lote,ubicacion_id)",
    );
  const referenceType = await columnMetadata(
    "movimientos_almacen",
    "referencia_tipo",
  );
  if (!referenceType?.COLUMN_TYPE.includes("DEVOLUCION_SUCURSAL"))
    await pool.query(`ALTER TABLE movimientos_almacen
      MODIFY COLUMN referencia_tipo ENUM('COMPRA','VENTA','AJUSTE','TRASLADO','DESPACHO_SUCURSAL','DEVOLUCION_SUCURSAL') NULL`);
}

async function migrateBranchDistribution() {
  await pool.query(`CREATE TABLE IF NOT EXISTS sucursales (
    id INT AUTO_INCREMENT PRIMARY KEY,codigo VARCHAR(15) UNIQUE NOT NULL,
    nombre VARCHAR(100) NOT NULL,direccion VARCHAR(180) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS pedidos_sucursal (
    id INT AUTO_INCREMENT PRIMARY KEY,codigo VARCHAR(24) UNIQUE NOT NULL,
    sucursal_id INT NOT NULL,creado_por INT NOT NULL,
    estado ENUM('PENDIENTE','EN_PREPARACION','LISTO','DESPACHADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,despachado_en TIMESTAMP NULL,
    referencia_guia VARCHAR(40) NULL,placa_vehiculo VARCHAR(12) NULL,
    observaciones VARCHAR(500) NULL,
    CONSTRAINT fk_ps_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE RESTRICT,
    CONSTRAINT fk_ps_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
    INDEX idx_ps_estado (estado,creado_en)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumn(
    "pedidos_sucursal",
    "referencia_guia",
    "VARCHAR(40) NULL AFTER despachado_en",
  );
  await addColumn(
    "pedidos_sucursal",
    "placa_vehiculo",
    "VARCHAR(12) NULL AFTER referencia_guia",
  );
  await pool.query(`CREATE TABLE IF NOT EXISTS pedidos_sucursal_detalle (
    id INT AUTO_INCREMENT PRIMARY KEY,pedido_id INT NOT NULL,producto_id INT NOT NULL,
    cantidad_solicitada INT NOT NULL,
    CONSTRAINT fk_psd_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_sucursal(id) ON DELETE RESTRICT,
    CONSTRAINT fk_psd_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
    CONSTRAINT uq_psd_producto UNIQUE (pedido_id,producto_id),
    CONSTRAINT chk_psd_cantidad CHECK (cantidad_solicitada>0)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumn(
    "tareas_almacen",
    "pedido_sucursal_detalle_id",
    "INT NULL AFTER referencia_operativa",
  );
  await addColumn(
    "tareas_almacen",
    "lote_destino_id",
    "INT NULL AFTER pedido_sucursal_detalle_id",
  );
  if (!(await hasConstraint("tareas_almacen", "fk_tarea_pedido_detalle")))
    await pool.query(`ALTER TABLE tareas_almacen ADD CONSTRAINT fk_tarea_pedido_detalle
      FOREIGN KEY (pedido_sucursal_detalle_id) REFERENCES pedidos_sucursal_detalle(id) ON DELETE RESTRICT`);
  if (!(await hasConstraint("tareas_almacen", "fk_tarea_lote_destino")))
    await pool.query(`ALTER TABLE tareas_almacen ADD CONSTRAINT fk_tarea_lote_destino
      FOREIGN KEY (lote_destino_id) REFERENCES lotes(id) ON DELETE RESTRICT`);
}

async function migrateBranchReturns() {
  await pool.query(`CREATE TABLE IF NOT EXISTS devoluciones_sucursal (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_id INT NOT NULL,tarea_picking_id INT NOT NULL,
    lote_retorno_id INT NULL,tarea_cuarentena_id INT NULL,
    numero_lote_original VARCHAR(50) NOT NULL,cantidad INT NOT NULL,
    motivo ENUM('RECHAZO','DANIO','SOBRANTE') NOT NULL,
    registrado_por INT NOT NULL,registrado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_devolucion_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_sucursal(id) ON DELETE RESTRICT,
    CONSTRAINT fk_devolucion_picking FOREIGN KEY (tarea_picking_id) REFERENCES tareas_almacen(id) ON DELETE RESTRICT,
    CONSTRAINT fk_devolucion_lote FOREIGN KEY (lote_retorno_id) REFERENCES lotes(id) ON DELETE RESTRICT,
    CONSTRAINT fk_devolucion_tarea FOREIGN KEY (tarea_cuarentena_id) REFERENCES tareas_almacen(id) ON DELETE RESTRICT,
    CONSTRAINT fk_devolucion_usuario FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
    CONSTRAINT chk_devolucion_cantidad CHECK (cantidad>0),
    INDEX idx_devolucion_pedido (pedido_id,registrado_en)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function migratePartialReceiving() {
  const state = await columnMetadata("ordenes_compra", "estado");
  if (!state?.COLUMN_TYPE.includes("PARCIAL"))
    await pool.query(`ALTER TABLE ordenes_compra MODIFY COLUMN estado
      ENUM('PENDIENTE','PARCIAL','RECIBIDA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE'`);
  await addColumn(
    "ordenes_compra_detalle",
    "cantidad_recibida",
    "INT NOT NULL DEFAULT 0 AFTER cantidad_solicitada",
  );
  await pool.query(`UPDATE ordenes_compra_detalle d JOIN ordenes_compra o ON o.id=d.orden_id
    SET d.cantidad_recibida=d.cantidad_solicitada
    WHERE o.estado='RECIBIDA' AND d.cantidad_recibida=0`);
  if (!(await hasConstraint("ordenes_compra_detalle", "chk_ocd_recibida")))
    await pool.query(`ALTER TABLE ordenes_compra_detalle ADD CONSTRAINT chk_ocd_recibida
      CHECK (cantidad_recibida>=0 AND cantidad_recibida<=cantidad_solicitada)`);
}

async function migrateWarehouseTasks() {
  if (await hasTable("tareas_almacen")) {
    const type = await columnMetadata("tareas_almacen", "tipo");
    if (!type?.COLUMN_TYPE.includes("PICKING"))
      await pool.query(
        "ALTER TABLE tareas_almacen MODIFY COLUMN tipo ENUM('PUTAWAY','REUBICACION','REABASTECIMIENTO','PICKING','DEVOLUCION_RUTA') NOT NULL",
      );
    await addColumn(
      "tareas_almacen",
      "referencia_operativa",
      "VARCHAR(60) NULL AFTER creado_por",
    );
    return;
  }
  await pool.query(`CREATE TABLE tareas_almacen (
    id INT AUTO_INCREMENT PRIMARY KEY, codigo_tarea VARCHAR(20) UNIQUE NOT NULL,
    tipo ENUM('PUTAWAY','REUBICACION','REABASTECIMIENTO','PICKING','DEVOLUCION_RUTA') NOT NULL,
    estado ENUM('PENDIENTE','EN_PROCESO','COMPLETADA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
    prioridad ENUM('BAJA','NORMAL','ALTA','URGENTE') NOT NULL DEFAULT 'NORMAL',
    producto_id INT NOT NULL, lote_origen_id INT NOT NULL, ubicacion_origen_id INT NOT NULL,
    ubicacion_destino_id INT NOT NULL, cantidad INT NOT NULL, asignado_a INT NULL, creado_por INT NOT NULL,
    referencia_operativa VARCHAR(60) NULL, observaciones VARCHAR(500) NULL, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    iniciado_en TIMESTAMP NULL, completado_en TIMESTAMP NULL,
    CONSTRAINT fk_tarea_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tarea_lote FOREIGN KEY (lote_origen_id) REFERENCES lotes(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tarea_origen FOREIGN KEY (ubicacion_origen_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tarea_destino FOREIGN KEY (ubicacion_destino_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tarea_asignado FOREIGN KEY (asignado_a) REFERENCES usuarios(id) ON DELETE RESTRICT,
    CONSTRAINT fk_tarea_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
    CONSTRAINT chk_tarea_cantidad CHECK (cantidad > 0),
    INDEX idx_tarea_estado_prioridad (estado,prioridad), INDEX idx_tarea_producto (producto_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

async function refreshWarehouseViews() {
  await pool.query(`CREATE OR REPLACE VIEW vw_stock_comparado AS
    SELECT p.id producto_id,p.nombre,p.stock_total stock_cacheado,
      COALESCE(SUM(l.cantidad_actual),0) stock_real_por_lotes,
      p.stock_total-COALESCE(SUM(l.cantidad_actual),0) diferencia
    FROM productos p LEFT JOIN lotes l ON l.producto_id=p.id
    GROUP BY p.id,p.nombre,p.stock_total`);
  await pool.query(`CREATE OR REPLACE VIEW vw_stock_por_loc AS
    SELECT l.id lote_id,p.id producto_id,p.sku,p.nombre producto,p.unidad_medida,
      p.imagen_url,p.referencia_url,
      l.numero_lote,l.lote_fabricante_id,CONCAT('L-',LPAD(b.id,6,'0')) codigo_lote_wms,
      l.unidad_logistica_id,hu.codigo_hu,
      b.fecha_verificada,b.requiere_revision,l.cantidad_actual,l.fecha_vencimiento,l.estado_inventario,
      u.id ubicacion_id,u.codigo_loc,u.zona_id,COALESCE(z.nombre,u.zona) zona,
      z.codigo_zona,z.proposito proposito_zona,z.condicion_almacenamiento,
      u.tipo tipo_loc,u.secuencia_pick,u.secuencia_putaway,
      u.pasillo,u.estante,u.nivel,u.posicion,u.profundidad,u.modelo_plano
    FROM lotes l JOIN productos p ON p.id=l.producto_id
    LEFT JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
    LEFT JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
    JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
    LEFT JOIN zonas_almacen z ON z.id=u.zona_id`);
  await pool.query(`CREATE OR REPLACE VIEW vw_ocupacion_loc AS
    SELECT u.id ubicacion_id,u.codigo_loc,u.zona_id,COALESCE(z.nombre,u.zona) zona,
      z.codigo_zona,z.proposito proposito_zona,z.condicion_almacenamiento,
      u.pasillo,u.estante,u.nivel,u.posicion,u.profundidad,u.modelo_plano,
      u.layout_x,u.layout_z,u.layout_verificado,u.tipo,
      u.capacidad_unidades,u.capacidad_hu,
      COALESCE(SUM(l.cantidad_actual),0) unidades_ocupadas,
      COALESCE(SUM(l.cantidad_actual>0),0) ocupacion_hu,
      GREATEST(u.capacidad_hu-COALESCE(SUM(l.cantidad_actual>0),0),0) capacidad_disponible,
      ROUND(COALESCE(SUM(l.cantidad_actual>0),0)*100/u.capacidad_hu,1) porcentaje_ocupacion,u.activo
    FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
    LEFT JOIN lotes l ON l.ubicacion_id=u.id
    GROUP BY u.id,z.id`);
}

async function migrateBatchAndHandlingUnits() {
  await pool.query(`CREATE TABLE IF NOT EXISTS lotes_fabricante (
    id INT AUTO_INCREMENT PRIMARY KEY,
    producto_id INT NOT NULL,
    codigo_lote VARCHAR(50) NOT NULL,
    fecha_vencimiento DATE NULL,
    fecha_verificada BOOLEAN NOT NULL DEFAULT FALSE,
    requiere_revision BOOLEAN NOT NULL DEFAULT FALSE,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_lote_fabricante (producto_id,codigo_lote),
    CONSTRAINT fk_lf_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await pool.query(`CREATE TABLE IF NOT EXISTS unidades_logisticas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    codigo_hu VARCHAR(60) NOT NULL UNIQUE,
    tipo ENUM('PALLET','CAJA','PEDIDO','RETORNO') NOT NULL,
    referencia VARCHAR(80) NULL,
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
  await addColumn("lotes", "lote_fabricante_id", "INT NULL AFTER numero_lote");
  await addColumn("lotes", "unidad_logistica_id", "INT NULL AFTER lote_fabricante_id");
  if (!(await hasConstraint("lotes", "fk_posicion_lote_fabricante")))
    await pool.query(`ALTER TABLE lotes ADD CONSTRAINT fk_posicion_lote_fabricante
      FOREIGN KEY (lote_fabricante_id) REFERENCES lotes_fabricante(id) ON DELETE RESTRICT`);
  if (!(await hasConstraint("lotes", "fk_posicion_hu")))
    await pool.query(`ALTER TABLE lotes ADD CONSTRAINT fk_posicion_hu
      FOREIGN KEY (unidad_logistica_id) REFERENCES unidades_logisticas(id) ON DELETE RESTRICT`);
  if (await hasIndex("lotes", "uq_lotes_producto_numero_loc"))
    await pool.query("ALTER TABLE lotes DROP INDEX uq_lotes_producto_numero_loc");

  // Una HU de expedición/retorno no es un lote de fabricante. Conservamos el
  // identificador histórico como HU y restauramos el lote original en stock.
  await pool.query(`INSERT IGNORE INTO unidades_logisticas (codigo_hu,tipo,referencia)
    SELECT DISTINCT l.numero_lote,'PEDIDO',t.referencia_operativa
    FROM tareas_almacen t JOIN lotes l ON l.id=t.lote_destino_id
    WHERE t.tipo='PICKING' AND l.numero_lote LIKE 'HU-PS-%'`);
  await pool.query(`UPDATE lotes destination
    JOIN tareas_almacen t ON t.lote_destino_id=destination.id AND t.tipo='PICKING'
    JOIN lotes origin ON origin.id=t.lote_origen_id
    JOIN unidades_logisticas hu ON hu.codigo_hu=destination.numero_lote
    SET destination.numero_lote=origin.numero_lote,destination.unidad_logistica_id=hu.id
    WHERE destination.numero_lote LIKE 'HU-PS-%'`);
  await pool.query(`INSERT IGNORE INTO unidades_logisticas (codigo_hu,tipo,referencia)
    SELECT DISTINCT l.numero_lote,'RETORNO',CAST(r.pedido_id AS CHAR)
    FROM devoluciones_sucursal r JOIN lotes l ON l.id=r.lote_retorno_id
    WHERE l.numero_lote LIKE 'RT-%'`);
  await pool.query(`UPDATE lotes l
    JOIN devoluciones_sucursal r ON r.lote_retorno_id=l.id
    JOIN unidades_logisticas hu ON hu.codigo_hu=l.numero_lote
    SET l.numero_lote=r.numero_lote_original,l.unidad_logistica_id=hu.id
    WHERE l.numero_lote LIKE 'RT-%'`);

  await pool.query(`INSERT IGNORE INTO lotes_fabricante
    (producto_id,codigo_lote,fecha_vencimiento,fecha_verificada,requiere_revision)
    SELECT producto_id,numero_lote,MIN(fecha_vencimiento),FALSE,
      COUNT(DISTINCT COALESCE(DATE_FORMAT(fecha_vencimiento,'%Y-%m-%d'),'SIN-FECHA'))>1
    FROM lotes GROUP BY producto_id,numero_lote`);
  await pool.query(`UPDATE lotes l JOIN lotes_fabricante b
    ON b.producto_id=l.producto_id AND b.codigo_lote=l.numero_lote
    SET l.lote_fabricante_id=b.id
    WHERE l.lote_fabricante_id IS NULL`);
  const batchFk = await columnMetadata("lotes", "lote_fabricante_id");
  if (batchFk?.IS_NULLABLE === "YES") {
    await pool.query("ALTER TABLE lotes DROP FOREIGN KEY fk_posicion_lote_fabricante");
    await pool.query("ALTER TABLE lotes MODIFY COLUMN lote_fabricante_id INT NOT NULL");
    await pool.query(`ALTER TABLE lotes ADD CONSTRAINT fk_posicion_lote_fabricante
      FOREIGN KEY (lote_fabricante_id) REFERENCES lotes_fabricante(id) ON DELETE RESTRICT`);
  }
  if (!(await hasColumn("lotes", "hu_key")))
    await pool.query(`ALTER TABLE lotes ADD COLUMN hu_key INT
      GENERATED ALWAYS AS (COALESCE(unidad_logistica_id,0)) STORED`);
  if (!(await hasIndex("lotes", "uq_posicion_stock")))
    await pool.query(`ALTER TABLE lotes ADD UNIQUE KEY uq_posicion_stock
      (producto_id,lote_fabricante_id,ubicacion_id,estado_inventario,hu_key)`);
}

async function ensureMigrations() {
  await migrateUserRecoveryEmail();
  await require("./securityMigration").migrateSecurity();
  await migratePasswordHistory();
  await migrateUserRequests();
  await migrateLocations();
  await migrateWarehouseZones();
  await migrateDistributionBins();
  await migrateAudits();
  await migrateCategories();
  await migrateProviderMedia();
  await migrateProducts();
  await addColumn(
    "productos",
    "clase_abc",
    "ENUM('A','B','C') NOT NULL DEFAULT 'B' AFTER activo",
  );
  await migrateLotsAndMovements();
  await migrateWarehouseTasks();
  await migrateBranchDistribution();
  await migrateBranchReturns();
  await migratePartialReceiving();
  await migrateBatchAndHandlingUnits();
  await migrateWarehouseBlueprint();
  await refreshWarehouseViews();
}

module.exports = { ensureMigrations };
