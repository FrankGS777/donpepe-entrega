# Auditoría de interfaz y trazabilidad — 29 de octubre de 2026

## Alcance comprobado

La revisión utiliza bases SQLite temporales; no crea pedidos, usuarios, ventas ni mensajes de correo en los datos del usuario.

- Administración: resumen, movimientos, usuarios, permisos, catálogo de productos/proveedores/sucursales, categorías, marcas, activos, mantenimiento, configuración, recuperaciones y auditoría.
- Operaciones: mapa, pedidos, recepción, inventario, movimientos, equipos, tiendas e incidencias.
- Tienda: portada, reposición, pedidos, existencias, entregas/devoluciones y movimientos.
- Formularios y modales: alta y edición de cuentas, productos, proveedores y sucursales; marcas, categorías, equipos, configuración de dispositivos, mantenimiento, perfiles, detalle de pedidos, devoluciones, auditoría y expedientes autónomos.
- Acceso: inicio de sesión, recuperación, enlace vencido, verificación de Gmail y cambio de contraseña, incluyendo errores y confirmaciones.
- Temas claro y oscuro; revisión principal a 1440 y 390 píxeles. Banner de tienda comprobado además a 768 píxeles.

La auditoría de interfaz registra 210 recorridos/comprobaciones entre vistas, variantes y modales, sin errores JavaScript, desbordamientos ni desalineaciones pendientes detectadas. Estos recorridos incluyen repeticiones de una misma vista en distintos tamaños y temas. Acceso añade 7 recorridos y 23 capturas; el banner tiene 6 variantes comprobadas. La batería de dominio y seguridad pasó 359 pruebas. No equivale a probar todos los estados posibles ni todos los navegadores: las comprobaciones automatizadas usan Chrome.

## Correcciones aplicadas

1. Los selectores de entidades en formularios tenían un desfase de 7 px respecto a los campos nativos. Su contenedor ahora respeta el mismo espacio bajo la etiqueta.
2. Los campos de políticas logísticas en móvil se disponen en una columna para evitar que una etiqueta en dos líneas desplace sólo uno de los campos.
3. Los paneles paralelos de configuración conservan el mismo inicio y estiran sus superficies de manera coherente.
4. Cabeceras, títulos y grupos de acciones comparten espacios y permiten distribuirse sin sobreposición. Los hijos de rejillas tienen anchos mínimos acotados.
5. Los pares de etiqueta/valor del detalle de movimientos usan columnas alineadas, con ajuste de referencias largas.
6. El resaltado de selección de texto conserva contraste sin producir los grandes bloques marrones de la captura. Se mantiene la posibilidad de copiar texto.
7. A petición posterior del usuario, se restauró el diseño anterior del nombre de la sede en el banner: «San» en letra editorial y «Miguel» en cursiva dorada, con los tamaños, espaciado e interlineado originales.
8. Inventario distingue el contenido de una caja y la cantidad de cajas, y aclara que las reservadas ya forman parte del stock del centro.
9. Trazabilidad separa Lotes, Cargas y ubicaciones (Recepciones en tienda) y Movimientos, con búsquedas inmediatas, paginación y navegación cruzada. Las cantidades actuales se mantienen separadas de los movimientos históricos.

## Decisión sobre las doce cajas y su código

Se conserva el modelo por producto + lote/vencimiento + unidad de carga + cantidad. No se generan números de serie individuales que no existen en la evidencia de recepción.

| Identificador | Qué significa en DonPepe |
| --- | --- |
| Producto / SKU | Artículo y presentación del catálogo. |
| Código comercial del envase | Código registrado del producto; no identifica por sí solo una instancia individual. |
| Lote de fabricante | Fabricación de origen; conserva su relación con el vencimiento y los movimientos. |
| HU | Identificador interno de una carga que se manipula agrupada. Puede contener varias cajas. |
| Etiqueta logística | Se muestra cuando ya consta en el registro de la carga. HU y SSCC no se presentan como sinónimos. |
| Cantidad | Cajas cerradas que contiene el grupo o que intervienen en un movimiento. |

Ejemplo: **HU-00019 · lote FAB-DP-0010-1 · 12 cajas** representa una carga de doce cajas del mismo artículo/lote, no una caja con once códigos faltantes. Si cada caja contiene doce unidades, el detalle muestra **12 cajas × 12 unidades = 144 unidades de producto**.

Cuando se separan cuatro cajas, la carga de origen conserva ocho y la carga resultante conserva su referencia de origen, artículo y lote. Las sumas actuales siguen siendo doce cajas; cada traslado posterior no vuelve a sumarlas como stock nuevo. La recepción en tienda se presenta como existencia recibida por lote/pedido, sin inventar que cada saldo comercial sigue siendo una unidad de carga física intacta.

No se crea un módulo adicional de cajas serializadas: agregaría datos y operaciones de identificación que el flujo actual no captura. Si posteriormente se requiere serialización individual, tendría que incorporarse desde la identificación física de entrada y mantenerse en la separación, consolidación, despacho, recepción y salida. Una lista numerada generada sólo para la pantalla no sería evidencia de trazabilidad.

## Fundamento oficial

- [GS1: unidad logística e identificación](https://support.gs1.org/support/solutions/articles/43000734289-what-is-a-logistics-unit-and-how-is-it-identified-): una unidad logística puede agrupar artículos en una caja, palé u otra unidad de transporte/almacenaje; SSCC identifica la unidad logística.
- [GS1: arquitectura del sistema de identificación](https://ref.gs1.org/architecture/system-architecture/): distingue la identificación del artículo, el lote y el número de serie como niveles diferentes.
- [Mecalux: trazabilidad logística](https://www.mecalux.es/blog/trazabilidad-logistica): describe la identificación y seguimiento de unidades de carga o lotes y su recorrido mediante software de almacén.

La decisión implementada es una adaptación al modelo y a los datos efectivamente registrados por DonPepe; no es una certificación GS1 ni una integración con equipos físicos.

## Recursos de verificación

- `scripts/verify-store-portal.cjs`: recorrido de vistas, subcatálogos, modales y componentes.
- `scripts/ui-layout-audit.cjs`: medidas de alineación y desbordamiento por componente.
- `scripts/verify-official-traceability.cjs`: lotes, cargas, cantidades, búsqueda cruzada, aislamiento de tienda y errores de consulta.
- `scripts/verify-store-cover.cjs`: nombre de sede y banner en tres anchos y ambos temas.
- `scripts/verify-auth-premium.cjs`: acceso, recuperación y estados de error.
- `tests/inventory-identification.test.js`: equivalencias, agrupación, separación, recepción y diferencias sin duplicar cajas ni inventar seriales.
