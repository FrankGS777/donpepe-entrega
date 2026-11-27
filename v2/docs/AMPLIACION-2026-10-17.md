# DonPepe — ampliación de maestros, seguridad y experiencia

## Resultado funcional

La ampliación mantiene las tres responsabilidades existentes. No crea usuarios adicionales, no reinicia el almacén ni sustituye los pedidos históricos.

| Perfil | Responsabilidad |
| --- | --- |
| Administración | Datos maestros, cuentas, permisos, recuperaciones, reglas y registro técnico de activos. Autoriza y documenta mantenimiento; no opera el mapa, no libera pedidos ni despacha. |
| Jefe de operaciones | Recepción, calidad, disponibilidad, prioridades, preparación, expedición, incidencias y solicitud de servicio técnico. No edita marcas, categorías, cuentas ni fichas físicas de maquinaria. |
| Responsable de tienda | Solicita productos para su sucursal, modifica solicitudes todavía pendientes, sigue entregas, confirma lo recibido, registra diferencias y devoluciones y consulta sus existencias. |

Los permisos se verifican nuevamente en el servidor. Ocultar un botón no constituye la protección del sistema. Las restricciones de un perfil no permiten convertirlo en otro rol mediante casillas.

## Catálogo y fotografías

- 119 referencias comerciales adicionales; 131 productos en una instalación nueva con las doce identidades originales.
- 89 marcas y 18 categorías después de resolver las coincidencias con los maestros originales.
- Cada referencia nueva conserva nombre, presentación, GTIN, vendedor, enlace y fotografía real del catálogo de Vega. Se comprobó también su canal oficial de abastecimiento empresarial.
- Las referencias nuevas comienzan **sin inventario**. No se generan lotes, palés ni recepciones al importar datos maestros.
- Las cantidades por caja, límites por palé y puntos de reposición son parámetros del escenario, no especificaciones atribuidas al fabricante.
- Las imágenes de marcas y categorías representan un producto real de su surtido; no se presentan como logotipos oficiales cuando no lo son.
- Las fotografías se sirven localmente en WebP, con carga diferida y alternativa accesible si falta una imagen.

La procedencia individual y sus límites están documentados en [Catálogo ampliado y fuentes](CATALOGO-AMPLIADO-FUENTES.md).

## Funciones útiles disponibles

### Administración

1. Sidebar clasificado en supervisión, catálogos, infraestructura y gobierno.
2. Alta, consulta, modificación, archivo y reactivación de categorías.
3. Conservación compatible por categoría, separada de la clasificación comercial.
4. Alta, consulta, modificación, archivo y reactivación de marcas.
5. Relación explícita de proveedores por marca.
6. Selección de marca y categoría mediante referencias, no textos contradictorios.
7. Biblioteca y subida segura de imágenes para todos los tipos de maestro.
8. Búsqueda, estado, orden, filtros persistentes y paginación de catálogos.
9. Exportación CSV del resultado filtrado, protegida contra fórmulas de hoja de cálculo.
10. Ficha técnica de maquinaria: clase, fabricante, modelo, serie, foto, fechas, capacidades e intervalo de servicio.
11. Activos nuevos planificados sin inventar robots ni rutas incompatibles en el mapa.
12. Horas de uso calculadas por el funcionamiento del escenario y alertas de próxima revisión.
13. Autorización de mantenimiento con técnico responsable y lista de comprobaciones por tipo de equipo.
14. Espera de parada segura y retirada del equipo antes de intervenir.
15. Informe de cierre con comprobaciones, coste y siguiente fecha; conservación del historial.
16. Rechazo o cancelación documentados de solicitudes técnicas antes de intervenir.
17. Gestión de cuentas, restricciones por perfil y recuperación a Gmail verificado, conservando la aprobación de acciones sensibles.

### Operaciones

18. Disponibilidad de cada línea antes de liberar, con faltante y lotes candidatos por vencimiento.
19. Compra prellenada de faltantes agrupados por proveedor, siempre revisable antes de enviar.
20. Cancelación de una compra únicamente antes de registrar la llegada y con motivo.
21. Fotografías y estado de los equipos que están realmente vinculados al circuito.
22. Solicitud de inspección, mantenimiento preventivo o reparación correctiva sin suplantar al administrador.
23. Consulta de cada misión, carga, origen, destino y pedido asociado.
24. Seguimiento de etapas de pedido y fechas de ejecución.
25. Avería con conservación de carga y reservas; recuperación sin perder la misión.
26. Preparación, consolidación, muelle, carga física, verificación, cierre, salida y entrega diferenciados.

### Tienda

27. Catálogo fotográfico con búsqueda por producto, marca o código de barras.
28. Filtro de categoría y páginas de doce productos, sin cargar cientos de tarjetas a la vez.
29. Edición de líneas sólo mientras la solicitud sigue pendiente y con revisión contra cambios simultáneos.
30. Notas y fecha requerida, validadas contra el calendario del escenario.
31. Repetición de un pedido como borrador, sin enviarlo de forma automática.
32. Cantidades editables, total por solicitud y conversión visible de cajas a unidades.
33. Cancelación con motivo, identidad y fecha conservados.
34. Existencias recibidas, diferencias y devoluciones dentro del ámbito de la propia sucursal.

### Experiencia compartida

35. Errores grandes, campos rojos, mensajes específicos y foco en el problema.
36. Indicador de campos obligatorios completos y contadores de longitud.
37. Respuesta visual al pulsar, indicadores de espera y prevención de reenvíos accidentales.
38. Transiciones de diálogo, tarjetas, imágenes, navegación y estados con movimiento reducido accesible.
39. Borradores locales por usuario para solicitudes y compras.
40. Restauración del foco de diálogo, navegación por teclado y atajo de búsqueda.
41. Avisos limitados y sin duplicados para no tapar toda la pantalla.
42. Temas claro/oscuro, contraste y vistas móviles comprobados.

## Controles de negocio y validación

Las validaciones no son un número decorativo. Cubren formato, coherencia entre entidades, autorización, cambios concurrentes y conservación física:

- Nombres y códigos normalizados, límites de longitud, unicidad y caracteres permitidos.
- GTIN de 8/12/13/14 cifras con dígito de control; equivalencia de códigos con ceros iniciales.
- Marca, categoría y proveedor existentes y activos, con relaciones compatibles.
- Conservación, caducidad y vida útil mínima; exclusión de stock retenido, vencido o bloqueado.
- Cajas enteras positivas, líneas distintas, límites por pedido y capacidad de plazas/segregación del vehículo.
- Edición sólo antes de reservar; revisión de documento y configuración contra sobrescrituras.
- Reserva FEFO atómica: si falta una línea, no se reserva el resto parcialmente.
- Archivo lógico con comprobaciones de productos, existencias, documentos, cuentas y servicios abiertos.
- Capacidad, clase e integración física de equipos vinculados protegidas contra cambios incompatibles.
- Una intervención abierta por activo, transiciones válidas, fecha real, técnico y checklist completo.
- Sin mantenimiento mientras exista carga, misión, ruta o reserva no asegurada. El AMR vuelve a su bahía antes de ser retirado.
- Exclusión del planificador para equipos, camiones y cargadores retirados.
- Cancelación con motivo; llegada, descarga y recepción no pueden omitirse mediante cambios de pantalla.
- Aislamiento de tienda, administrador único, permisos revisados por petición, CSRF, límites de intento y auditoría.
- Contraseñas con política e historial, tokens temporales de un uso y correo de recuperación previamente verificado.
- Imágenes decodificadas y normalizadas, límites de tamaño y biblioteca, permisos por entidad y rutas locales.
- Comandos idempotentes y reversión transaccional de errores: reintentar no duplica stock ni solicitudes.

No se afirma que exista una prueba para cualquier situación imaginable. Las pruebas automatizadas y los recorridos adjuntos delimitan lo que se verificó realmente.

## Mantenimiento y referencia industrial

La decisión de asignar a Administración el registro y la autorización técnica, y a Operaciones el reporte de síntomas, es una **adaptación de DonPepe**, no una estructura de roles impuesta por Mecalux.

Mecalux describe mantenimiento preventivo y correctivo, planes adaptados, técnicos especializados e informes de intervención en su [soporte técnico oficial](https://www.mecalux.es/servicios/soporte-tecnico). Por eso el sistema no simula que un robot se repara solo: representa la retirada segura y el registro de un servicio realizado por un técnico.

La distinción entre gestión de stock y documentos, orquestación de tareas y control de los equipos toma como referencia las responsabilidades públicas de [WMS, WES y WCS de Mecalux](https://www.mecalux.es/software). DonPepe es una implementación académica propia; no incorpora software propietario de Mecalux ni está conectado a maquinaria industrial.

## Recursos visuales

Se generaron nueve recursos con la herramienta integrada de imágenes: tres sucursales ficticias y seis clases de equipos. Se inspeccionaron y optimizaron a WebP de 1200 píxeles como máximo. Se conservaron los originales.

- `v2/public/images/representations/branch-san-miguel.webp`
- `v2/public/images/representations/branch-pueblo-libre.webp`
- `v2/public/images/representations/branch-jesus-maria.webp`
- `v2/public/images/representations/equipment-amr.webp`
- `v2/public/images/representations/equipment-stacker.webp`
- `v2/public/images/representations/equipment-shuttle.webp`
- `v2/public/images/representations/equipment-forklift.webp`
- `v2/public/images/representations/equipment-truck.webp`
- `v2/public/images/representations/equipment-charger.webp`

Los locales no acreditan la existencia de tiendas reales ni domicilios específicos. Los equipos son representaciones genéricas, no fotografías certificadas de un modelo comercial.

## Verificación reproducible

- `npm test`: reglas, seguridad, catálogo, conservación, automatización y mantenimiento con bases aisladas.
- `v2/scripts/verify-expansion.cjs`: administración, CRUD, mantenimiento, errores, permisos y apariencia.
- `v2/scripts/verify-journeys.cjs`: solicitudes de tienda, edición, repetición, cancelación, compra de faltantes y revisión técnica.
- `v2/scripts/verify-map-flow.cjs`: continuidad visual y custodia durante preparación, montacargas, camión y recepción.

Las verificaciones no envían correo real y no utilizan los datos personales de la instalación. Los FPS medidos dependen del equipo y del arranque de la escena; no se promete una cifra universal para todas las cámaras, equipos o navegadores.

Resultado de la ejecución final: **252 pruebas automatizadas aprobadas**, 11 recorridos administrativos con 67 capturas, 10 recorridos de tienda/operación con 43 capturas y 36 comprobaciones del mapa con 21 capturas. Los tres informes de navegador terminaron sin errores JavaScript ni desbordamientos detectados. En las muestras sostenidas de montacargas y camión se midieron aproximadamente 60 FPS con Chrome y GPU Apple M4; el arranque y el zoom presentaron cifras inferiores y se registraron por separado.

La instalación local se actualizó con respaldo consistente de SQLite en `outputs/DonPepe-Respaldo-Ampliacion-2026-10-17-TmsyqA`. Se comprobó que conserva sus tres usuarios, los cuatro pedidos y la compra existentes, las identidades originales de producto y el balance de 360 cajas. El servicio queda disponible en `http://localhost:3010`. Los informes y capturas se conservan en `outputs/DonPepe-Ampliacion-2026-10-17`.
