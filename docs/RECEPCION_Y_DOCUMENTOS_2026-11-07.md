# Recepción mecánica y documentos

## Flujo de entrada

El proveedor reserva un único muelle y realiza una aproximación de seis segundos de simulación. La descarga no comienza durante esa aproximación. El mismo vehículo permanece hasta terminar sus cargas y se retira durante cinco segundos antes de liberar el muelle. Los procesos que ya estaban descargando conservan su temporización anterior.

El descargador especializado utiliza horquillas con chasis, ruedas, mástil y carro de elevación. La carga se eleva desde el remolque, se transporta sobre las horquillas y se desciende hasta los rodillos. El distribuidor de recepción mantiene su plataforma elevadora y transferencia telescópica; las estaciones de tienda mantienen sus puentes y carros de transferencia. La baliza de recepción tiene un poste hasta el suelo y base. Se ajustaron los tonos del suelo y la luz de relleno para reducir dominantes verdes y azules.

La geometría compartida conserva contactos continuos de vehículos, estructuras, racks y zonas de transferencia. Se añadieron perfiles de colisión de los laterales de transportador, armarios y postes de inspección, conservando las aperturas. Estos controles corresponden a una simulación guiada; no constituyen una certificación física de todas las mallas decorativas.

## Inspección visual

El puesto PIE existente incluye cámaras superiores y laterales e iluminación controlada. La simulación clasifica abolladuras, cierre abierto y humedad o derrame visible. Es una representación de visión artificial industrial, no inferencia real de imágenes ni análisis sanitario del contenido.

La frecuencia predeterminada es 12 % por unidad logística de nuevas recepciones, configurable de 0 a 100 % por Administración en Políticas logísticas. El resultado queda fijado al crear el aviso de entrega y no cambia al reintentar o actualizar la pantalla. Las pruebas heredadas de recepción manual conservan frecuencia cero.

Una carga observada conserva su lote, producto y cantidad. La inspección registra HOLD y una recepción segregada. Un AMR la recoge de recepción y la transporta a cuarentena compatible con su conservación. No pasa a disponible. Una cuarentena llena detiene la transferencia y conserva la carga soportada. El daño confirmado bloquea la liberación como mercancía conforme; su baja requiere una resolución documentada. La simulación no hace desaparecer mercancía ni afirma que un robot repare un derrame.

Referencias: https://www.mecalux.es/manual-almacen/palets/pie-sistemas-galibo-palets y https://www.cognex.cn/library/media/literature/pdf/packaging_guide_en.pdf

## Documentos y pagos

Al crear una compra, el adaptador del proveedor emite y entrega automáticamente una factura comercial. La operación y su factura se guardan dentro de la misma transacción. Un reintento con el mismo identificador no duplica compra, numeración ni factura.

Cada producto tiene costo neto por unidad y porcentaje de impuesto. La cantidad se pide por cajas cerradas: valor de caja = costo unitario por unidades de la caja. La factura conserva código y nombre del producto, unidades por caja, cajas compradas, costo unitario, valor de caja, base e impuesto por línea. Los cálculos monetarios se realizan en céntimos. Las tarifas iniciales son propias del escenario y no cotizaciones reales de los fabricantes.

El proveedor conserva razón social, dirección comercial, identificación fiscal opcional, serie y días de crédito. DonPepe conserva sus datos de comprador en Configuración. Si no existe un RUC verificado, el documento utiliza un código comercial interno y no inventa un RUC. No es necesario introducir estos datos al hacer una compra: los maestros están precargados. Cada factura guarda una copia de los datos y tarifas vigentes al emitirse y una huella de integridad. Cambiar un maestro no reescribe documentos anteriores.

La factura tiene numeración por proveedor, fechas de emisión y vencimiento, subtotal, IGV y total en PEN. Administración conserva el registro de pagos parciales. Una factura anulada no admite pagos. Cancelar una compra sin pagos anula su factura y conserva el historial; si tiene pagos se exige resolverlos antes de cancelar.

Administración y Operaciones acceden al PDF desde Documentos y pagos y desde la tarjeta de la compra. La tienda no recibe facturas de proveedores. Sus reposiciones son traslados internos sin deuda comercial de la sucursal. No existe un formulario manual para crear las nuevas facturas.

El PDF se sirve directamente desde `/api/finance/bills/:id.pdf`, con opción `?download=1`, sesión autenticada y autorización. Se genera en A4 con identidad DonPepe, proveedor emisor y DonPepe comprador, detalle paginado, condiciones de pago y totales. Es un documento comercial del proveedor simulado; no hay emisión electrónica SUNAT ni movimientos bancarios reales. Los registros manuales históricos se conservan sin inventar precios pasados.

## Verificación

Pruebas de llegada previa a descarga, apoyo de horquillas, recepción dañada hasta cuarentena con conservación de cantidades, clasificación y bloqueo de disponibilidad; validaciones monetarias y separación de permisos. Navegación de Administración, Operaciones y Tienda y renderizado del mapa en Chrome en un entorno temporal sin modificar los datos de la instalación.
