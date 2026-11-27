# DonPepe · Tienda, fechas y registros

Revisión de la aplicación activa `v2`, con corte del 26 de octubre de 2026 (Lima).

## Experiencia de Tienda

El perfil Tienda dispone de un portal propio con navegación flotante, portada de sucursal, catálogo comercial, cesta de reposición y pantallas dedicadas a sus pedidos, existencias, entregas/devoluciones y Kardex. La estructura y los componentes de navegación y compra son distintos del escritorio administrativo y de la consola operativa.

La cesta guarda el borrador de la sesión por cuenta y sucursal. Permite hasta doce productos y respeta el límite de cajas que configura Administración. Antes de enviar, la persona revisa los productos, cantidades, sucursal, prioridad, fecha requerida e indicaciones. El servidor vuelve a validar cada solicitud. El identificador de operación protege los reintentos; si se corrige la solicitud se genera una referencia nueva.

La tienda consulta exclusivamente sus existencias y documentos. Puede modificar/cancelar solicitudes pendientes, seguir la entrega, registrar salidas de inventario vigente y solicitar devoluciones de entregas recibidas. Las salidas respetan FEFO, conservan lote y responsable y pueden llevar referencia y observaciones. Los pasos automáticos de recepción siguen perteneciendo al proceso del servidor.

## Fechas y zona horaria

- Zona de negocio y del proceso del servidor: `America/Lima`, PET, UTC−05:00.
- El reloj visible se sincroniza con la hora enviada por el servidor y avanza con un reloj monotónico entre consultas. La zona del navegador no determina la hora que se presenta.
- Se conservan los instantes originales UTC/números de época para comparaciones, persistencia e idempotencia. En las respuestas y registros nuevos se ofrecen equivalentes locales con `-05:00`, fecha de Lima y zona horaria explícita.
- Los filtros de Auditoría y Kardex delimitan días de Lima, incluida la medianoche. Las exportaciones de movimientos usan la fecha y hora local con desplazamiento explícito.
- El vencimiento de un producto y la fecha requerida son días de calendario: no se desplazan al día anterior al presentarlos.
- Las fechas históricas se conservan. La presentación descriptiva no reescribe documentos ni geometría persistidos. Las pruebas del motor mantienen un reloj reproducible.
- Se corrigió el rechazo de lecturas frescas al acelerar la simulación: la antigüedad real y la simulada se validan por separado cuando los registros usan hora real. Las lecturas vencidas o futuras siguen rechazadas.

## Registros y legibilidad

Los eventos identifican fecha local, actor, perfil, operación y correlación; incorporan producto, lote, cantidades, documento y ubicación cuando el evento dispone de esos datos. La auditoría registra recurso, resultado, método y ruta de la solicitud, sucursal y comparación de los cambios. Las credenciales siguen excluidas del contenido visible.

Los detalles de pedido y misión muestran creación, responsable, actualización e hitos disponibles. Las fichas de existencias muestran lotes, vencimiento, compra/pedido de origen, recepción y custodia. No se inventa un responsable o una fecha cuando falta en un registro heredado.

Una ubicación como `CD1-SEC-A01-R01-N02-P01` se presenta también como «Centro de distribución · Reserva seca automática · Pasillo 01 · Rack 01 · Nivel 02 · Posición 01». El código técnico se conserva para identificación y búsqueda. El Kardex presenta origen y destino con ese contexto y mantiene el aislamiento de sucursales.

Las estructuras anidadas del detalle de auditoría se presentan como campos y registros con nombres comprensibles, en lugar de volcar JSON al usuario.

## Orden y filtros

- Pedidos, compras, misiones, devoluciones, procesos autónomos, movimientos y actividad administrativa presentan primero los registros recientes.
- Mantenimiento ordena fechas ISO como fechas; se corrigió una conversión a número que devolvía `NaN`.
- Catálogos y cuentas priorizan registros o actualizaciones recientes. Las personas pueden seleccionar otro orden y conservarlo. Las preferencias anteriores se actualizan una vez para aplicar el nuevo valor predeterminado.
- Se añadieron búsqueda/estado en módulos operativos que no contaban con filtros, junto con fechas de Lima en recepción.
- Los filtros de Tienda abarcan texto, categoría, marca, disponibilidad, estado y fechas según la pantalla. Ofrecen limpieza, contador de resultados y estados vacíos.
- Un intervalo invertido se señala sin ejecutar una consulta ambigua. La longitud de búsqueda de auditoría coincide entre formulario y servidor.
- Los controles de filtros, incluidos los selectores visuales de listas largas, comparten altura y alineación; los selectores originales ocultos mantienen su función de formulario.

## Verificación reproducible

`npm run test:v2`: 338 pruebas aprobadas en la revisión completa. Las pruebas adicionales comprueban medianoche de Lima, conservación del instante UTC/local, recepción acelerada con hora real sin aceptar lecturas vencidas, ubicaciones descriptivas, creación de solicitudes, autoría, ámbito por tienda, auditoría y CSV.

`v2/scripts/verify-store-portal.cjs`: recorre las 29 combinaciones de vista y perfil en escritorio (1440 px) y móvil (390 px), con capturas en temas claro y oscuro. Comprueba errores JavaScript, desbordamiento horizontal y uniformidad de filtros. Examina también formularios y detalles de cuenta, producto, categoría, marca, activo, configuración de equipo, mantenimiento, auditoría, compra, pedido y devolución.

El mismo recorrido comprueba búsqueda, persistencia de cesta, creación y orden del pedido, limpieza y fechas inválidas de filtros, autorización por Operaciones, recepción automática y salida de inventario en Tienda. Usa datos SQLite temporales y no modifica las bases de la instalación del usuario.

La prueba previa que exigía doce descargas en doscientos segundos se actualizó para comprobar capacidad y conservación de cantidades con los ciclos mecánicos actuales. Un límite de doce plazas no implica que doce cargas deban completar su descarga en ese intervalo, especialmente con los AMR sin nuevas asignaciones.

Las capturas y el resultado del recorrido se conservan en `outputs/ui-audit-20261026/`. Estas comprobaciones no equivalen a certificación de maquinaria física ni a medición de rendimiento 3D en todos los equipos.
