SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin PRIMARY KEY,
  expires INT UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) UNIQUE NOT NULL, descripcion VARCHAR(255),
  etiqueta VARCHAR(70) NULL, perfil VARCHAR(50) NOT NULL DEFAULT 'jefe_operaciones',
  activo BOOLEAN NOT NULL DEFAULT TRUE, sistema BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_etiqueta (etiqueta)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS permisos (
  codigo VARCHAR(80) PRIMARY KEY, etiqueta VARCHAR(100) NOT NULL, grupo VARCHAR(60) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS roles_permisos (
  rol_id INT NOT NULL, permiso VARCHAR(80) NOT NULL, PRIMARY KEY (rol_id,permiso),
  CONSTRAINT fk_rp_rol FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_rp_permiso FOREIGN KEY (permiso) REFERENCES permisos(codigo) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(100) NOT NULL, correo VARCHAR(100) UNIQUE NOT NULL,
  correo_recuperacion VARCHAR(100) NOT NULL,
  password VARCHAR(255) NOT NULL, rol_id INT NOT NULL, activo BOOLEAN NOT NULL DEFAULT TRUE,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_usuarios_rol FOREIGN KEY (rol_id) REFERENCES roles(id) ON DELETE RESTRICT,
  INDEX idx_usuarios_rol (rol_id), INDEX idx_usuarios_activo (activo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS historial_contrasenas (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_historial_contrasenas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  INDEX idx_historial_contrasenas_usuario (usuario_id,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seguridad_eventos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, actor_id INT NULL, accion VARCHAR(60) NOT NULL,
  entidad_id INT NULL, antes JSON NULL, despues JSON NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_evento_actor FOREIGN KEY (actor_id) REFERENCES usuarios(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cambios_correo_recuperacion (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, usuario_id INT NOT NULL, correo VARCHAR(100) NOT NULL,
  token_hash CHAR(64) UNIQUE NOT NULL, expira_en DATETIME NOT NULL, usado_en DATETIME NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_cambio_correo_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  INDEX idx_cambio_correo_usuario (usuario_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- securityMigration agrega la columna generada e índice de administrador único
-- usando el ID real del rol, no suponiendo IDs idénticos entre instalaciones.

CREATE TABLE IF NOT EXISTS solicitudes_usuario (
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
  envio_estado ENUM('NO_APLICA','PENDIENTE','ENVIADO','ERROR') NOT NULL DEFAULT 'NO_APLICA',
  enviado_en DATETIME NULL,
  envio_error VARCHAR(500) NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revisado_en DATETIME NULL,
  completado_en DATETIME NULL,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_solicitud_rol FOREIGN KEY (rol_solicitado_id) REFERENCES roles(id) ON DELETE RESTRICT,
  CONSTRAINT fk_solicitud_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_solicitud_revisor FOREIGN KEY (revisado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  INDEX idx_solicitud_estado_fecha (estado, creado_en),
  INDEX idx_solicitud_correo_tipo (correo, tipo),
  INDEX idx_solicitud_token (token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS proveedores (
  id INT AUTO_INCREMENT PRIMARY KEY, ruc VARCHAR(11) UNIQUE NOT NULL, razon_social VARCHAR(150) NOT NULL,
  telefono VARCHAR(20), email VARCHAR(100), logo_url VARCHAR(500), sitio_web VARCHAR(255),
  activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categorias (
  id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) UNIQUE NOT NULL, descripcion VARCHAR(255),
  vida_util_dias INT NOT NULL DEFAULT 365,
  CONSTRAINT chk_categoria_vida_util CHECK (vida_util_dias >= 0 AND vida_util_dias <= 3650)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS marcas (
  id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(50) UNIQUE NOT NULL, descripcion VARCHAR(255)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS zonas_almacen (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo_zona VARCHAR(12) UNIQUE NOT NULL,
  nombre VARCHAR(60) UNIQUE NOT NULL,
  proposito ENUM('ENTRADA','ALMACENAJE','PICKING','CONTROL','SALIDA') NOT NULL,
  condicion_almacenamiento ENUM('AMBIENTE','REFRIGERADO','CONGELADO') NOT NULL DEFAULT 'AMBIENTE',
  clase_abc ENUM('A','B','C') NULL,
  descripcion VARCHAR(255) NOT NULL, secuencia_operativa INT NOT NULL DEFAULT 100,
  plano_x DECIMAL(8,2) NULL, plano_z DECIMAL(8,2) NULL,
  ancho_m DECIMAL(8,2) NULL, fondo_m DECIMAL(8,2) NULL, estructura VARCHAR(24) NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT chk_zona_secuencia CHECK (secuencia_operativa > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ubicaciones_almacen (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo_loc VARCHAR(48) UNIQUE NOT NULL,
  zona_id INT NULL, zona VARCHAR(50) NOT NULL, pasillo VARCHAR(20) NOT NULL, estante VARCHAR(20) NOT NULL,
  nivel SMALLINT UNSIGNED NOT NULL DEFAULT 1, posicion SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  profundidad TINYINT UNSIGNED NOT NULL DEFAULT 1,
  layout_x DECIMAL(8,2) NULL, layout_z DECIMAL(8,2) NULL, layout_verificado BOOLEAN NOT NULL DEFAULT FALSE,
  tipo ENUM('RECEPCION','RESERVA','PICKING','CUARENTENA','DESPACHO') NOT NULL DEFAULT 'RESERVA',
  capacidad_unidades INT NOT NULL DEFAULT 1000, capacidad_hu TINYINT UNSIGNED NOT NULL DEFAULT 1,
  secuencia_putaway INT NOT NULL DEFAULT 100,
  secuencia_pick INT NOT NULL DEFAULT 100, permite_recepcion BOOLEAN NOT NULL DEFAULT FALSE,
  permite_almacenaje BOOLEAN NOT NULL DEFAULT TRUE, permite_picking BOOLEAN NOT NULL DEFAULT FALSE,
  permite_conteo BOOLEAN NOT NULL DEFAULT TRUE, activo BOOLEAN NOT NULL DEFAULT TRUE,
  modelo_plano VARCHAR(12) NOT NULL DEFAULT 'LEGADO',
  UNIQUE KEY unica_ubicacion (modelo_plano,zona_id,pasillo,estante,nivel,posicion,profundidad), INDEX idx_loc_zona (zona_id),
  CONSTRAINT fk_loc_zona FOREIGN KEY (zona_id) REFERENCES zonas_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT chk_loc_capacidad CHECK (capacidad_unidades > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS productos (
  id INT AUTO_INCREMENT PRIMARY KEY, sku VARCHAR(40) UNIQUE NOT NULL, codigo_barras VARCHAR(50) UNIQUE NULL, nombre VARCHAR(100) NOT NULL,
  categoria_id INT NOT NULL, marca_id INT NOT NULL, proveedor_id INT NULL,
  precio_compra DECIMAL(10,2) NOT NULL, precio_venta DECIMAL(10,2) NOT NULL,
  stock_total INT NOT NULL DEFAULT 0, stock_minimo INT NOT NULL DEFAULT 10, activo BOOLEAN NOT NULL DEFAULT TRUE,
  clase_abc ENUM('A','B','C') NOT NULL DEFAULT 'B',
  unidad_medida ENUM('UND','CAJA','PAQUETE','KG','L') NOT NULL DEFAULT 'UND',
  peso_kg DECIMAL(10,3) NOT NULL DEFAULT 0, volumen_m3 DECIMAL(12,6) NOT NULL DEFAULT 0,
  control_lote BOOLEAN NOT NULL DEFAULT TRUE, control_vencimiento BOOLEAN NOT NULL DEFAULT TRUE,
  ubicacion_picking_id INT NULL, stock_objetivo_pick INT NOT NULL DEFAULT 0,
  imagen_url VARCHAR(500) NULL, referencia_url VARCHAR(500) NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_productos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id) ON DELETE RESTRICT,
  CONSTRAINT fk_productos_marca FOREIGN KEY (marca_id) REFERENCES marcas(id) ON DELETE RESTRICT,
  CONSTRAINT fk_productos_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE SET NULL,
  CONSTRAINT fk_productos_loc_picking FOREIGN KEY (ubicacion_picking_id) REFERENCES ubicaciones_almacen(id) ON DELETE SET NULL,
  CONSTRAINT chk_productos_precio_compra CHECK (precio_compra >= 0),
  CONSTRAINT chk_productos_precio_venta CHECK (precio_venta >= 0),
  CONSTRAINT chk_productos_stock_total CHECK (stock_total >= 0),
  CONSTRAINT chk_productos_stock_minimo CHECK (stock_minimo >= 0),
  CONSTRAINT chk_productos_peso CHECK (peso_kg >= 0), CONSTRAINT chk_productos_volumen CHECK (volumen_m3 >= 0),
  CONSTRAINT chk_productos_objetivo_pick CHECK (stock_objetivo_pick >= 0),
  INDEX idx_productos_activo (activo), INDEX idx_productos_categoria (categoria_id), INDEX idx_productos_marca (marca_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ordenes_compra (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo_orden VARCHAR(20) UNIQUE NOT NULL, proveedor_id INT NOT NULL, usuario_id INT NOT NULL,
  fecha_emision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  estado ENUM('PENDIENTE','PARCIAL','RECIBIDA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
  total_estimado DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_oc_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id) ON DELETE RESTRICT,
  CONSTRAINT fk_oc_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_oc_total CHECK (total_estimado >= 0), INDEX idx_oc_estado (estado), INDEX idx_oc_proveedor (proveedor_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ordenes_compra_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY, orden_id INT NOT NULL, producto_id INT NOT NULL, cantidad_solicitada INT NOT NULL,
  cantidad_recibida INT NOT NULL DEFAULT 0,
  precio_unitario_compra DECIMAL(10,2) NOT NULL,
  subtotal DECIMAL(12,2) GENERATED ALWAYS AS (cantidad_solicitada * precio_unitario_compra) STORED,
  CONSTRAINT fk_ocd_orden FOREIGN KEY (orden_id) REFERENCES ordenes_compra(id) ON DELETE CASCADE,
  CONSTRAINT fk_ocd_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ocd_cantidad CHECK (cantidad_solicitada > 0),
  CONSTRAINT chk_ocd_recibida CHECK (cantidad_recibida >= 0 AND cantidad_recibida <= cantidad_solicitada),
  CONSTRAINT chk_ocd_precio CHECK (precio_unitario_compra >= 0),
  INDEX idx_ocd_producto (producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sucursales (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(15) UNIQUE NOT NULL,
  nombre VARCHAR(100) NOT NULL, direccion VARCHAR(180) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pedidos_sucursal (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo VARCHAR(24) UNIQUE NOT NULL,
  sucursal_id INT NOT NULL, creado_por INT NOT NULL,
  estado ENUM('PENDIENTE','EN_PREPARACION','LISTO','DESPACHADO','CANCELADO') NOT NULL DEFAULT 'PENDIENTE',
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP, despachado_en TIMESTAMP NULL,
  referencia_guia VARCHAR(40) NULL, placa_vehiculo VARCHAR(12) NULL,
  observaciones VARCHAR(500) NULL,
  CONSTRAINT fk_ps_sucursal FOREIGN KEY (sucursal_id) REFERENCES sucursales(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ps_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  INDEX idx_ps_estado (estado,creado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS pedidos_sucursal_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY, pedido_id INT NOT NULL, producto_id INT NOT NULL,
  cantidad_solicitada INT NOT NULL,
  CONSTRAINT fk_psd_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_sucursal(id) ON DELETE RESTRICT,
  CONSTRAINT fk_psd_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT uq_psd_producto UNIQUE (pedido_id,producto_id),
  CONSTRAINT chk_psd_cantidad CHECK (cantidad_solicitada > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS lotes_fabricante (
  id INT AUTO_INCREMENT PRIMARY KEY, producto_id INT NOT NULL,
  codigo_lote VARCHAR(50) NOT NULL, fecha_vencimiento DATE NULL,
  fecha_verificada BOOLEAN NOT NULL DEFAULT FALSE, requiere_revision BOOLEAN NOT NULL DEFAULT FALSE,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lote_fabricante (producto_id,codigo_lote),
  CONSTRAINT fk_lf_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS unidades_logisticas (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo_hu VARCHAR(60) NOT NULL UNIQUE,
  tipo ENUM('PALLET','CAJA','PEDIDO','RETORNO') NOT NULL,
  referencia VARCHAR(80) NULL, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- «lotes» se conserva por compatibilidad: cada fila es un quant/posición física,
-- no un lote distinto. El lote real vive en lotes_fabricante y la HU es opcional.
CREATE TABLE IF NOT EXISTS lotes (
  id INT AUTO_INCREMENT PRIMARY KEY, numero_lote VARCHAR(50) NOT NULL,
  lote_fabricante_id INT NOT NULL, unidad_logistica_id INT NULL,
  producto_id INT NOT NULL, ubicacion_id INT NOT NULL,
  orden_compra_id INT NULL, cantidad_inicial INT NOT NULL, cantidad_actual INT NOT NULL,
  fecha_ingreso DATE NOT NULL, fecha_vencimiento DATE NULL,
  estado_inventario ENUM('DISPONIBLE','CUARENTENA','BLOQUEADO') NOT NULL DEFAULT 'DISPONIBLE',
  hu_key INT GENERATED ALWAYS AS (COALESCE(unidad_logistica_id,0)) STORED,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lotes_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lotes_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT fk_lotes_orden_compra FOREIGN KEY (orden_compra_id) REFERENCES ordenes_compra(id) ON DELETE SET NULL,
  CONSTRAINT fk_posicion_lote_fabricante FOREIGN KEY (lote_fabricante_id) REFERENCES lotes_fabricante(id) ON DELETE RESTRICT,
  CONSTRAINT fk_posicion_hu FOREIGN KEY (unidad_logistica_id) REFERENCES unidades_logisticas(id) ON DELETE RESTRICT,
  CONSTRAINT uq_posicion_stock UNIQUE (producto_id,lote_fabricante_id,ubicacion_id,estado_inventario,hu_key),
  CONSTRAINT chk_lotes_cantidad_inicial CHECK (cantidad_inicial > 0),
  CONSTRAINT chk_lotes_cantidad_actual CHECK (cantidad_actual >= 0 AND cantidad_actual <= cantidad_inicial),
  CONSTRAINT chk_lotes_fechas CHECK (fecha_vencimiento >= fecha_ingreso),
  INDEX idx_lotes_producto (producto_id), INDEX idx_lotes_vencimiento (fecha_vencimiento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS movimientos_almacen (
  id INT AUTO_INCREMENT PRIMARY KEY, producto_id INT NOT NULL, lote_id INT NULL, usuario_id INT NOT NULL,
  tipo_movimiento ENUM('ENTRADA','SALIDA') NOT NULL, cantidad INT NOT NULL,
  referencia_tipo ENUM('COMPRA','AJUSTE','TRASLADO','DESPACHO_SUCURSAL','DEVOLUCION_SUCURSAL') NULL, referencia_id INT NULL, motivo VARCHAR(255) NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ma_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ma_lote FOREIGN KEY (lote_id) REFERENCES lotes(id) ON DELETE SET NULL,
  CONSTRAINT fk_ma_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ma_cantidad CHECK (cantidad > 0), INDEX idx_ma_producto_fecha (producto_id, creado_en),
  INDEX idx_ma_referencia (referencia_tipo, referencia_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS tareas_almacen (
  id INT AUTO_INCREMENT PRIMARY KEY, codigo_tarea VARCHAR(20) UNIQUE NOT NULL,
  tipo ENUM('PUTAWAY','REUBICACION','REABASTECIMIENTO','PICKING','DEVOLUCION_RUTA') NOT NULL,
  estado ENUM('PENDIENTE','EN_PROCESO','COMPLETADA','CANCELADA') NOT NULL DEFAULT 'PENDIENTE',
  prioridad ENUM('BAJA','NORMAL','ALTA','URGENTE') NOT NULL DEFAULT 'NORMAL',
  producto_id INT NOT NULL, lote_origen_id INT NOT NULL, ubicacion_origen_id INT NOT NULL,
  ubicacion_destino_id INT NOT NULL, cantidad INT NOT NULL, asignado_a INT NULL, creado_por INT NOT NULL,
  referencia_operativa VARCHAR(60) NULL, pedido_sucursal_detalle_id INT NULL,
  lote_destino_id INT NULL, observaciones VARCHAR(500) NULL, creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  iniciado_en TIMESTAMP NULL, completado_en TIMESTAMP NULL,
  CONSTRAINT fk_tarea_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_lote FOREIGN KEY (lote_origen_id) REFERENCES lotes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_origen FOREIGN KEY (ubicacion_origen_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_destino FOREIGN KEY (ubicacion_destino_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_asignado FOREIGN KEY (asignado_a) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_creador FOREIGN KEY (creado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_pedido_detalle FOREIGN KEY (pedido_sucursal_detalle_id) REFERENCES pedidos_sucursal_detalle(id) ON DELETE RESTRICT,
  CONSTRAINT fk_tarea_lote_destino FOREIGN KEY (lote_destino_id) REFERENCES lotes(id) ON DELETE RESTRICT,
  CONSTRAINT chk_tarea_cantidad CHECK (cantidad > 0),
  INDEX idx_tarea_estado_prioridad (estado, prioridad), INDEX idx_tarea_producto (producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS devoluciones_sucursal (
  id INT AUTO_INCREMENT PRIMARY KEY,
  pedido_id INT NOT NULL, tarea_picking_id INT NOT NULL,
  lote_retorno_id INT NULL, tarea_cuarentena_id INT NULL,
  numero_lote_original VARCHAR(50) NOT NULL,
  cantidad INT NOT NULL,
  motivo ENUM('RECHAZO','DANIO','SOBRANTE') NOT NULL,
  registrado_por INT NOT NULL, registrado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_devolucion_pedido FOREIGN KEY (pedido_id) REFERENCES pedidos_sucursal(id) ON DELETE RESTRICT,
  CONSTRAINT fk_devolucion_picking FOREIGN KEY (tarea_picking_id) REFERENCES tareas_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT fk_devolucion_lote FOREIGN KEY (lote_retorno_id) REFERENCES lotes(id) ON DELETE RESTRICT,
  CONSTRAINT fk_devolucion_tarea FOREIGN KEY (tarea_cuarentena_id) REFERENCES tareas_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT fk_devolucion_usuario FOREIGN KEY (registrado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_devolucion_cantidad CHECK (cantidad > 0),
  INDEX idx_devolucion_pedido (pedido_id,registrado_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventarios_auditoria (
  id INT AUTO_INCREMENT PRIMARY KEY, fecha_auditoria TIMESTAMP DEFAULT CURRENT_TIMESTAMP, usuario_id INT NOT NULL,
  producto_id INT NOT NULL, stock_sistema INT NOT NULL, stock_fisico INT NOT NULL,
  diferencia INT GENERATED ALWAYS AS (stock_fisico - stock_sistema) STORED,
  tipo_ajuste ENUM('INGRESO_POR_AJUSTE','SALIDA_POR_PERDIDA','CUADRE_PERFECTO') NOT NULL, observaciones TEXT,
  estado ENUM('PENDIENTE','APROBADA','RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
  ubicacion_id INT NULL, codigo_lote VARCHAR(50) NULL, fecha_vencimiento_ajuste DATE NULL,
  aprobado_por INT NULL, aprobado_en TIMESTAMP NULL,
  CONSTRAINT fk_ia_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ia_producto FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ia_ubicacion FOREIGN KEY (ubicacion_id) REFERENCES ubicaciones_almacen(id) ON DELETE RESTRICT,
  CONSTRAINT fk_ia_aprobador FOREIGN KEY (aprobado_por) REFERENCES usuarios(id) ON DELETE RESTRICT,
  CONSTRAINT chk_ia_stock_sistema CHECK (stock_sistema >= 0), CONSTRAINT chk_ia_stock_fisico CHECK (stock_fisico >= 0),
  INDEX idx_ia_producto (producto_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE OR REPLACE VIEW vw_stock_comparado AS
SELECT p.id producto_id, p.nombre, p.stock_total stock_cacheado,
  COALESCE(SUM(l.cantidad_actual), 0) stock_real_por_lotes,
  p.stock_total - COALESCE(SUM(l.cantidad_actual), 0) diferencia
FROM productos p LEFT JOIN lotes l ON l.producto_id = p.id
GROUP BY p.id, p.nombre, p.stock_total;

CREATE OR REPLACE VIEW vw_stock_por_loc AS
SELECT l.id lote_id, p.id producto_id, p.sku, p.nombre producto, p.unidad_medida,
  p.imagen_url, p.referencia_url,
  l.numero_lote,l.lote_fabricante_id,CONCAT('L-',LPAD(b.id,6,'0')) codigo_lote_wms,
  l.unidad_logistica_id,hu.codigo_hu,
  b.fecha_verificada,b.requiere_revision,l.cantidad_actual,l.fecha_vencimiento,l.estado_inventario,
  u.id ubicacion_id, u.codigo_loc, u.zona_id, COALESCE(z.nombre,u.zona) zona,
  z.codigo_zona, z.proposito proposito_zona, z.condicion_almacenamiento,
  u.tipo tipo_loc, u.secuencia_pick, u.secuencia_putaway,
  u.pasillo,u.estante,u.nivel,u.posicion,u.profundidad,u.modelo_plano
FROM lotes l JOIN productos p ON p.id=l.producto_id
LEFT JOIN lotes_fabricante b ON b.id=l.lote_fabricante_id
LEFT JOIN unidades_logisticas hu ON hu.id=l.unidad_logistica_id
JOIN ubicaciones_almacen u ON u.id=l.ubicacion_id
LEFT JOIN zonas_almacen z ON z.id=u.zona_id;

CREATE OR REPLACE VIEW vw_ocupacion_loc AS
SELECT u.id ubicacion_id, u.codigo_loc, u.zona_id, COALESCE(z.nombre,u.zona) zona,
  z.codigo_zona, z.proposito proposito_zona, z.condicion_almacenamiento,
  u.pasillo, u.estante, u.nivel, u.posicion,u.profundidad,u.modelo_plano,
  u.layout_x,u.layout_z,u.layout_verificado,u.tipo,
  u.capacidad_unidades,u.capacidad_hu, COALESCE(SUM(l.cantidad_actual),0) unidades_ocupadas,
  COALESCE(SUM(l.cantidad_actual>0),0) ocupacion_hu,
  GREATEST(u.capacidad_hu-COALESCE(SUM(l.cantidad_actual>0),0),0) capacidad_disponible,
  ROUND(COALESCE(SUM(l.cantidad_actual>0),0)*100/u.capacidad_hu,1) porcentaje_ocupacion,
  u.activo
FROM ubicaciones_almacen u LEFT JOIN zonas_almacen z ON z.id=u.zona_id
LEFT JOIN lotes l ON l.ubicacion_id=u.id
GROUP BY u.id, z.id;

SET FOREIGN_KEY_CHECKS = 1;
