# Configuración operativa y recepción controlada

Actualización de arquitectura: el flujo productivo actual es la [orquestación autónoma de Industria 4.0](AUTONOMIA-INDUSTRIA-4.md). Esa especificación sustituye los pasos manuales de recepción y entrega descritos más abajo. Se conservan aquí como antecedentes y soporte de fixtures de regresión; la API productiva ya no permite suplantar la evidencia de las células con confirmaciones manuales.

## Configurar equipos

Administración dispone de una configuración operativa independiente de la ficha del activo. Sus parámetros se utilizan en el motor de simulación:

| Clase | Parámetros disponibles |
| --- | --- |
| AMR | Nuevas asignaciones, preferencia de asignación, trabajos permitidos, perfil Eco/Normal y niveles de entrada/salida de recarga |
| Transelevador y transferencia de congelados | Nuevas asignaciones, trabajos permitidos y perfil Eco/Normal |
| Montacargas de muelle | Nuevas asignaciones, carga/descarga autorizada y perfil Eco/Normal |
| Camión | Nuevas asignaciones, preferencia de flota, reparto/devoluciones y perfil Eco/Normal |
| Cargador | Nuevas asignaciones y preferencia de selección |

Eco utiliza el 75 % de las velocidades nominales ya definidas para el escenario. No se editan capacidad física, recorridos, separación, detección de colisiones, geometría, PLC ni programas de control industrial. Los retornos a cuarentena y la descarga de incidencias se mantienen como capacidades de recuperación obligatorias.

Un cambio que afecta a un equipo ocupado queda pendiente. El trabajo en curso conserva sus parámetros y carga. Al terminar, el AMR vuelve vacío a su bahía mediante las reservas de circulación habituales; entonces se aplica la configuración. Deshabilitar nuevas asignaciones permite aparcar y recargar. No se puede deshabilitar el último cargador habilitado mientras haya flota activa.

La auditoría distingue el cambio solicitado de su aplicación efectiva. Ambas entradas incluyen responsable, valores anteriores y posteriores, fecha y correlación. Operaciones consulta los parámetros; la edición corresponde exclusivamente a Administración.

## Recepción de proveedores: antecedente guiado

La recepción tiene tres pasos separados:

1. La compra llega al punto de recepción. Todavía no genera existencias.
2. Operaciones documenta una inspección: guía de entrega, código leído o contrastado, lote original del fabricante, caducidad, cantidades, embalaje, identificación, decisión y temperatura observada cuando corresponda. Guardar esta inspección tampoco genera existencias.
3. La confirmación final utiliza exactamente esa inspección y su revisión vigente. Se crean las unidades de carga internas, se registra el balance y se planifica el almacenamiento automático de las cajas aceptadas. Las retenidas permanecen en cuarentena.

El lote del fabricante se conserva y no se reemplaza por la identidad interna de la unidad de carga. Una recepción puede producir varias unidades internas para el mismo lote. Cada una mantiene la relación con su compra, inspección y documento de recepción.

Las comprobaciones son declaradas por el responsable, no certificaciones automáticas de calidad alimentaria. El modo de simulación está identificado en la inspección y en el recibo. La función de rellenado de ejemplo no representa lecturas de sensores ni controles físicos realizados por un robot.

Daño de embalaje, falta de identificación, vida útil insuficiente o temperatura fuera del intervalo del producto impiden aceptar esas cajas como disponibles. Se pueden registrar cantidades aceptadas y retenidas separadas, con una decisión coherente y un motivo de retención. Las condiciones de conservación corresponden a los parámetros de este escenario.

Una inspección sustituida, consumida o cuya revisión ya no coincide no puede utilizarse para recibir. La recepción parcial deja el resto pendiente de una nueva inspección. La API pública y el motor de producción exigen el expediente vigente; el mecanismo heredado solo está disponible mediante una opción explícita de fixtures de regresión, sin exposición en la aplicación.

## Auditoría y fotografías de cuentas

La auditoría permite filtrar por acción, resultado, responsable, texto y fecha, con paginación real. Presenta nombres, recurso afectado, cambios de campos y valores anteriores/posteriores. Los reintentos idempotentes se identifican como reintentos, sin aparentar otra modificación.

Contraseñas, hashes, claves SMTP, tokens y contenido de imágenes no se guardan en los detalles. La fotografía de cada usuario puede ser gestionada por Administración y por su propio titular. Se decodifican píxeles PNG, se limitan tamaño y dimensiones y se conserva el acceso privado. Una cuenta archivada no admite cambios de foto.

## Recursos visuales y comprobaciones

Las 89 marcas del escenario tienen un recurso independiente: 62 logotipos proceden de fuentes oficiales verificadas y 27 son ilustraciones referenciales. Su procedencia se conserva en los manifiestos técnicos, sin añadir rótulos que distraigan en las tarjetas operativas. No se presenta una recreación como logotipo oficial. Las 18 categorías utilizan escenas ambientales ilustrativas, no fotografías de artículos reutilizadas. Las imágenes se muestran completas y los logotipos oficiales blancos conservan su propio fondo de contraste, sin recolorearlos.

- Archivos finales de marca: [`v2/public/images/brands`](../public/images/brands/).
- Archivos finales de categoría: [`v2/public/images/categories`](../public/images/categories/).
- Procedencia oficial y límites de búsqueda: [fuentes de logotipos](LOGOTIPOS-MARCAS-FUENTES.md).

La verificación de esta reforma utiliza bases SQLite temporales y correo bloqueado. Incluye permisos, fotografías privadas, historial de contraseñas, parámetros efectivos de equipos, aplicación pendiente durante una misión, parciales, cuarentena, caducidad, revisión concurrente e idempotencia. Las verificaciones visuales incluyen escritorio y móvil en ambos temas. No equivalen a certificación de seguridad industrial ni a pruebas con dispositivos IoT físicos.

## Catálogo de abastecimiento

El proveedor preferido de un artículo no es su única alternativa de compra. La elegibilidad se determina por un proveedor activo, su conservación compatible y una relación con el artículo o con su marca. Cambiar el fabricante alternativo de una compra no modifica el proveedor de los documentos anteriores ni el preferido del producto.

El catálogo incorpora 12 proveedores: los mayoristas Vega y Makro, y Alicorp, Leche Gloria, Nestlé Perú, Molitalia, Arca Continental Lindley, Grupo AJE, PepsiCo, Costeño Alimentos, San Fernando y Floralp Perú. Las marcas se relacionan con los portafolios públicos verificados, no por similitud de nombre. Los mayoristas mantienen las alternativas del resto del surtido. Los 131 artículos conservan al menos una alternativa de abastecimiento.

Las relaciones se incorporan una sola vez mediante una migración aditiva; una relación retirada después por Administración no vuelve a imponerse al reiniciar. No se inventan contratos, RUC, direcciones o contactos. Los plazos de abastecimiento son parámetros propios del sistema y no promesas comerciales del fabricante. Los [portafolios y sus fuentes](../core/supplier-portfolios.json) documentan cada relación y logotipo.

Al solicitar mercancía, se elige un proveedor y se abre su catálogo completo. El diálogo muestra tarjetas con foto, marca, categoría y cantidad; admite filtro por marca o categoría, búsqueda opcional y varias selecciones. Sólo “Aplicar selección” modifica el borrador; cerrar o pulsar Escape no lo sustituye. Los límites y la elegibilidad se verifican otra vez en el servidor.

## Kardex físico de cajas

El kardex es un registro persistente de movimientos físicos, no una valoración contable ni una lista de reservas. Una reserva cambia la disponibilidad, pero no finge un traslado. Cada movimiento conserva producto, lote original, caducidad, unidad de carga, origen, destino, cajas, saldo del producto/lote/caducidad en destino, saldo de la red, documento, responsable, equipo y fecha.

Al activar el registro sobre una base existente se anotan saldos de apertura con su fecha. No se reconstruyen movimientos anteriores que no estén respaldados por evidencia. Desde ese momento se registran entradas, traslados, separaciones, salidas a tienda, recepción, ventas, devoluciones, cuarentena y bajas. El inventario y los asientos se guardan en la misma transacción; los reintentos no duplican movimientos. La tabla rechaza modificaciones y borrados de asientos.

Administración consulta el ámbito general, Operaciones la trazabilidad operativa y Tienda sólo los movimientos relacionados con su sucursal; no recibe saldos globales ni direcciones internas ajenas. Los filtros por día utilizan la zona horaria de Lima. La descarga CSV respeta el mismo permiso, los mismos filtros y un máximo de 10 000 filas.

## Disponibilidad de camiones y recepción de tienda: antecedente guiado

“En destino” no equivale a “Entregado”. Un camión en tienda sigue ocupado hasta que la tienda confirma las cajas recibidas. El responsable de esa sucursal abre el pedido llegado y pulsa “Confirmar recepción”; declara las cantidades reales. Los faltantes se conservan como diferencias, no se convierten en existencias disponibles.

Tras confirmar, el camión inicia su retorno y sólo vuelve a estar disponible al completar ese trayecto. Pausar el reloj detiene también el retorno; su duración en pantalla es tiempo de simulación, no una estimación de tráfico real. Operaciones puede consultar el motivo de ocupación y el pedido asociado, pero no confirmar por la tienda ni liberar el vehículo mediante un cambio manual de estado.

La siguiente expedición requiere un pedido preparado y un vehículo disponible, activo, compatible y habilitado para reparto. A continuación se ejecutan acople, apertura, carga mediante el equipo del muelle, verificación, cierre, salida, viaje, recepción en tienda y retorno. El historial de cajas y los estados del pedido acompañan esos eventos; la animación no crea existencias por sí sola.

## Acceso premium

El exterior del acceso representa la geometría del mapa: nave rectangular, cinco cubiertas azules y tres portales frontales. Es una representación arquitectónica ambientada en de Lurín, Lima; no acredita una instalación existente. El [manifiesto vigente de recursos](../core/autonomy-visual-assets.json) registra archivos de origen y dimensiones. La imagen nativa mide 1672 × 941; las exportaciones responsive de 1920 × 1080 y 3840 × 2160 utilizan reescalado Lanczos, no generación 4K nativa. La integración utiliza degradados, máscaras y transiciones propias, con alternativa de movimiento reducido y sin credenciales de demostración visibles. El logo se encuentra sobre las credenciales dentro de la zona difuminada; se retiró el texto de ubicación.

## Referencias oficiales

La organización de entrada, trazabilidad por lote, caducidad y conservación se relaciona con la [gestión alimentaria descrita por Mecalux](https://www.mecalux.es/software/industrias-sectores/alimentaria). La documentación de observaciones y evidencias se inspira en los [registros de calidad y fotografías de Easy WMS](https://www.mecalux.es/software/updates/photo-capture). Los parámetros concretos de la simulación y su implementación son propios de DonPepe y no certifican una instalación industrial ni un proceso real de inspección alimentaria.
