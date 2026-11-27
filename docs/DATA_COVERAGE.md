# Cobertura integral de la base de datos

La aplicación conecta las tablas funcionales del WMS y la tabla técnica de sesiones con modelos, servicios, vistas o validaciones. Los identificadores, hashes, subtotales generados, diferencias y marcas de tiempo no son editables desde formularios, pero sí participan en seguridad, trazabilidad y presentación.

| Recurso                                    | Cobertura funcional |
| ------------------------------------------ | ------------------- |
| `sessions`                                 | Sesión autenticada persistida en MySQL, expiración y datos serializados. |
| `roles`, `usuarios`                        | Tres plantillas protegidas y roles personalizados, perfil visual, etiqueta, estado, login bcrypt, altas internas, cambios, bloqueo y administrador único. |
| `permisos`, `roles_permisos` | Catálogo de capacidades, asignación granular, comprobación por petición y revocación efectiva. |
| `seguridad_eventos` | Reasignación de administradores adicionales, cambios de rol/usuario y vinculación de correo, con actor, fecha y datos antes/después cuando corresponde. |
| `cambios_correo_recuperacion` | Verificación personal con contraseña actual, token SHA-256, propietario, nueva dirección, expiración de 30 minutos y consumo único. |
| `solicitudes_usuario`                      | Recuperación bajo aprobación: motivo, estado, usuario, revisor, decisión, hash/expiración del enlace, envío SMTP y trazabilidad. Campos ALTA/rol solicitado se conservan por compatibilidad; no hay solicitud pública de creación de cuenta. |
| `proveedores`                              | CRUD lógico, proveedor sugerido del SKU y origen obligatorio de compras. |
| `categorias`, `marcas`                     | Clasificación del maestro SKU con claves foráneas restrictivas. |
| `zonas_almacen`                            | Zonas normalizadas por propósito, condición térmica, secuencia y estado. |
| `ubicaciones_almacen`                      | Código LOC, zona, coordenadas, perfil, capacidad, secuencias y permisos derivados. Alimenta receiving, put-away, picking, transferencias, conteos, returns y etiquetas. |
| `productos`                                | SKU, EAN, descripción, clasificación, proveedor, precios referenciales, unidad, peso, volumen, controles, LOC primaria, objetivo de picking, mínimos, stock y vigencia. |
| `ordenes_compra`, `ordenes_compra_detalle` | Orden agrupada, costos, cantidades, subtotal generado, estados, discrepancias y cola inbound. |
| `lotes`                                    | Posición física `SKU + lote + LOC`, origen de compra, cantidad inicial/actual, ingreso, vencimiento opcional y estado de inventario. |
| `tareas_almacen`                           | Put-away, reubicación, reabastecimiento, picking y devoluciones de ruta; prioridad, origen, destino, cantidad, creador, asignado y tiempos del ciclo. |
| `sucursales`, `pedidos_sucursal`, `pedidos_sucursal_detalle` | Destinos externos, demanda interna, preparación y despacho trazado por guía referencial y vehículo. |
| `devoluciones_sucursal` | Retorno físico vinculado a una expedición real, cantidad limitada por lo enviado, motivo, lote original, unidad logística de cuarentena y tarea RF. |
| `movimientos_almacen`                      | Kardex inmutable de compra, ajuste, traslado, salida al destino y retorno. Un traslado genera salida del origen y entrada en destino. |
| `inventarios_auditoria`                    | Conteo por SKU + lote de fabricante + LOC, diferencia calculada, evidencia, decisión por doble control y ajuste transaccional. |
| `vw_stock_comparado`                       | Conciliación entre stock global cacheado y suma real de lotes. |
| `vw_stock_por_loc`                         | Mapa navegable de posiciones con SKU, lote, estado, cantidad, vencimiento, zona y secuencias. |
| `vw_ocupacion_loc`                         | Ocupación, capacidad libre y porcentaje por LOC; base visual de zonas y capacidad. |

## Reglas de mutabilidad

- El administrador gobierna usuarios, roles, catálogos críticos y atributos comerciales del SKU.
- El jefe de operaciones puede cambiar la configuración logística del SKU y planificar tareas, pero no administra usuarios críticos.
- El operador RF solo opera tareas autorizadas, escanea códigos, confirma ubicaciones y registra conteos.
- Los productos, proveedores, zonas y ubicaciones con historia se desactivan en lugar de borrarse.
- Compras, lotes, movimientos, tareas y auditorías se conservan como documentos históricos.
- Una transacción confirma o revierte conjuntamente documento, posición, stock, tarea y kardex.
- El stock global cambia con compras y ajustes; un traslado físico entre LOC no lo modifica.
- La capacidad se valida al planificar y nuevamente al completar una tarea.

La prueba `tests/database-coverage.test.js` falla si una tabla, vista o campo deja de estar conectado con la aplicación.
