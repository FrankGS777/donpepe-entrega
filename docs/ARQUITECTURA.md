# Arquitectura y reglas de negocio WMS

El proyecto es un sistema MVC de gestión de almacén para el minimarket Don Pepe. La aplicación usa Node.js, Express, EJS, MySQL y Docker. La arquitectura separa responsabilidades en rutas, controladores, modelos, servicios, validadores, middlewares y vistas. Los controladores coordinan la petición HTTP; los modelos concentran consultas; los servicios ejecutan reglas transaccionales; los middlewares resuelven sesión, CSRF, validación y autorización.

## Roles y permisos

| Recurso / acción                                             | Administrador WMS | Jefe de operaciones | Operador RF |
| ------------------------------------------------------------ | ----------------: | ------------------: | ----------: |
| Gobierno general, usuarios y roles                           |                Sí |                  No |          No |
| Recuperación de contraseña                                   | Revisar/aprobar/rechazar |             No |          No |
| Dashboard de control WMS                                     |                Sí |                  Sí |          No |
| Catálogos, proveedores, categorías, marcas y zonas            | Gestionar maestros | Sin edición | Consulta RF contextual |
| Maestro SKU: datos comerciales, estado y desactivación        |                Sí |                  No |          No |
| Maestro SKU: estrategia logística, unidad, peso, volumen, LOC |                Sí |                  Sí |          No |
| Mapa de posiciones, ocupación por LOC y stock por lote        | Consultar | Consultar | Consulta por escaneo RF |
| Órdenes de compra                                            | Crear/consultar/cancelar | Sin acceso | Recibir líneas OC en RF |
| Tareas WMS                                                   | Consultar | Planificar/asignar/cancelar | Ejecutar asignadas |
| Receiving, check-in, picking, transfer, count y returns RF    | No | No | Según permiso de módulo |
| Etiquetas QR de SKU, lote y LOC                              |                Sí |                  Sí |          No |
| Conteos físicos                                              | Consultar/aprobar/rechazar | Registrar/consultar | Registrar por RF |
| Ajustes por diferencia                                       | Aprobar los de otra persona | No aprobar | No aprobar |
| Reportes financieros y exportaciones                         | Sí | No | No |
| Roles personalizados / permisos                              | Gestionar | No | No |
| Cuenta personal / correo / contraseña                       | Propia | Propia | Propia |

El administrador único gobierna seguridad, maestros, compras y aprobaciones, sin ejecutar movimientos físicos ni asumir la delegación del jefe. El jefe planifica y supervisa sin administrar cuentas ni compras. RF ejecuta trabajo asignado y confirma escaneos. Los roles personalizados conservan esa separación y sólo habilitan subconjuntos de escritorio operativo o RF; su acceso efectivo se consulta en la base por petición. Detalle y migración: `RBAC.md`.

## Flujo operativo

- **Receiving**: recibe productos contra una orden de compra, registra lote, vencimiento y cantidad real. La mercadería entra primero a una LOC de recepción.
- **Check-in / put-away**: guía al operador para colocar la mercadería recibida en reserva o picking según capacidad, temperatura y estrategia del SKU.
- **Pick order**: solo nace de un pedido interno de sucursal; prepara desde picking hacia staging compatible, sin módulo de ventas.
- **Transfer**: mueve inventario entre ubicaciones compatibles, por ejemplo reserva a picking o reubicación entre reservas.
- **Count**: ejecuta conteos cíclicos por LOC/SKU; las diferencias requieren revisión antes de impactar el stock.
- **Route returns**: procesa devoluciones que regresan a la tienda o almacén y las dirige a cuarentena para inspección.
- **Etiquetado QR**: genera etiquetas imprimibles para SKU, lote o LOC con datos cortos y escaneables desde móvil.

## Invariantes de negocio

- La jerarquía WMS es `zona → LOC → posición`. La posición es la combinación trazable de SKU, lote, estado y ubicación.
- Las zonas representan funciones del centro de distribución: recepción, reserva seca ABC, picking de sucursales, frío, congelado, cuarentena y staging por temperatura.
- Una recepción solo se aplica a una orden pendiente. Crea o actualiza posiciones por lote y genera el movimiento de entrada.
- El stock no se mueve por interfaces de pantalla únicamente: todo cambio físico pasa por servicios transaccionales que escriben lote, movimiento, tarea y stock cacheado cuando corresponde.
- `PUTAWAY` nace desde recepción o se crea como tarea guiada; `REABASTECIMIENTO` mueve reserva a picking; `PICKING` lleva stock de picking a staging; `DEVOLUCION_RUTA` dirige devoluciones a cuarentena; `REUBICACION` ordena cambios internos compatibles.
- El destino de una tarea respeta capacidad, condición térmica, estado del inventario y perfil de LOC.
- Solo puede existir una tarea abierta por posición de lote para evitar doble movimiento simultáneo.
- Una tarea separa planificación y ejecución: `PENDIENTE → EN_PROCESO → COMPLETADA`.
- Un traslado genera salida en origen y entrada en destino, pero no cambia el stock global del SKU.
- La vista de conciliación compara el stock rápido del producto contra la suma trazable de lotes; cero diferencias significa que el control está sano.
- Los lotes vencidos o en cuarentena permanecen visibles como inventario físico, pero no se proponen para picking operativo.
- Las fechas, hora del sistema, exportaciones y vistas usan `America/Lima`.

## Seguridad y calidad

La aplicación aplica bcrypt con coste 12, sesiones persistidas en MySQL, cookies `httpOnly` y `sameSite`, token CSRF por sesión, límite de intentos de login y recuperación, Helmet, consultas parametrizadas, validadores de entrada y RBAC en rutas, acciones, vistas y navegación. La regla general es mínimo privilegio, denegación por defecto y separación de funciones.

No existe alta pública: las cuentas y roles solo se crean desde la administración interna. La recuperación devuelve una respuesta uniforme exista o no el correo para evitar enumeración. Tras verificar la identidad, el administrador aprueba la solicitud y el sistema envía por SMTP un enlace aleatorio de un solo uso al correo registrado. En la base solo se guarda su hash SHA-256; vence en una hora y se invalida al definir la contraseña. Cada solicitud conserva estado, revisor, observación, resultado de entrega y marcas de tiempo.

El arranque de Docker separa migración y demostración. `database/startup.js` aplica cambios de esquema en cada despliegue, pero solo ejecuta la carga demo cuando no existe ningún usuario. Esto evita que un reinicio normal vuelva a sembrar o modifique operaciones reales.

La justificación de la topología está en [TOPOLOGIA_WMS.md](TOPOLOGIA_WMS.md). La cobertura de tablas y vistas está en [DATA_COVERAGE.md](DATA_COVERAGE.md).
