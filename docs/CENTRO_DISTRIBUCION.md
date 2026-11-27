# Don Pepe como centro de distribución (CD)

## Decisión de negocio

El almacén es un local separado de las sucursales. La orden de compra inicia el **flujo de entrada**: proveedor → recepción RF contra OC → control de lote y vencimiento → put-away → reserva/picking. El **flujo de salida** no parte de otra OC: parte de un pedido interno de sucursal contra el stock disponible del CD. Vincular cada entrega a una OC concreta sería incorrecto cuando hay stock de varias compras y lotes; la trazabilidad se conserva por SKU, lote, movimientos y tareas.

El jefe de operaciones ve pedidos de sucursales y planifica RF, pero no ve ni edita compras. El administrador gestiona compras, sucursales, maestros y toda la operación. Las sucursales son destinos externos, nunca LOC del CD. El sistema no inventa existencias dentro de cada tienda ni sustituye su sistema de ventas.

## Flujo procedural

1. El administrador emite una OC a un proveedor activo. Los SKU deben pertenecer a ese proveedor.
2. RF cuenta las unidades físicas por SKU, registra lote y LOC `REC` de la misma condición térmica. Una entrega puede ser **parcial**: la OC queda `PARCIAL`, conserva por línea lo solicitado/recibido/pendiente y acepta otra recepción sin sobrepasar lo solicitado. Cada ingreso crea una HU `HU-*` y un `PUTAWAY` solo por las unidades recibidas; una línea con cero no crea stock ni tarea. Si el mismo lote del fabricante vuelve a llegar, conserva su identidad `L-*`, pero recibe otra HU y ocupa un casillero vacío distinto. El stock no está listo para picking por el mero hecho de haber llegado.
3. El jefe asigna put-away. El operador confirma etiqueta origen → SKU/lote → etiqueta destino. La estrategia considera temperatura, clase ABC seca, capacidad disponible y tareas ya planificadas. La reserva A/B/C es una política editable: no afirmamos que la clase esté calculada sin demanda histórica.
4. El administrador o jefe registra un pedido de sucursal. El pedido queda `PENDIENTE`, sin descontar stock.
5. Al planificar, el WMS selecciona lotes de LOC `PICKING` disponibles y no vencidos, por FEFO. Reserva cantidades contra tareas ya abiertas y exige staging de la misma condición térmica. Si falta picking, la transacción no crea tareas parciales: se hace reabastecimiento desde reserva y se vuelve a planificar.
6. El jefe asigna tareas de picking a operadores RF. La confirmación de escaneos mueve la cantidad a una posición de staging asociada a una unidad logística `HU-PS-*` exclusiva de la tarea. El lote de fabricante se conserva y la HU identifica el conjunto expedible; `lote_origen_id` y `lote_destino_id` apuntan a posiciones de inventario, no a lotes de fabricante distintos. Dos sucursales no se confunden aunque pidan el mismo SKU y lote. Cuando todas las líneas están preparadas, el pedido pasa a `LISTO`.
7. Tras cotejar carga, referencia de guía y placa, un responsable confirma `DESPACHADO`. Entonces, y solo entonces, se descuenta el stock del CD y se guarda el movimiento de salida. La referencia de guía es un dato operativo, no una guía electrónica legalmente emitida.
8. Una devolución solo se registra contra unidades realmente despachadas del pedido. Se elige la expedición/lote, cantidad y motivo; el WMS impide devolver más de lo enviado. La nueva unidad logística ingresa a recepción en estado `CUARENTENA`, sin mezclarse con stock vendible, y genera una tarea RF de traslado a cuarentena térmicamente compatible. Su liberación o baja exige revisión posterior; no ocurre automáticamente.

## Zonas macro y direcciones micro

| Zona | Función | Condición / política |
| --- | --- | --- |
| REC, REC-F, REC-C | Descarga y recepción temporal contra OC o retorno | Ambiente, refrigerado o congelado; no picking |
| SEC-A, SEC-B, SEC-C | Reserva seca según rotación planificada | Ambiente; A cerca de preparación, C más distante |
| VEN | Picking y preparación seca | Ambiente; cara activa del SKU |
| FRI, CON | Reserva y picking refrigerado/congelado | Cadena de frío diferenciada |
| QUA, QUA-F, QUA-C | Aislamiento y revisión de incidencias/retornos | Temperatura compatible; no apta para despacho |
| DSP, DSP-F, DSP-C | Staging y consolidación por temperatura | Ambiente/refrigerado/congelado |

Una LOC CD1 se codifica `CD1-ZONA-Axx-Rxx-Nxx-Cxx-Dxx`: zona, pasillo, rack, nivel, casillero y profundidad. Ejemplo: `CD1-SEC-B-A02-R04-N03-C02-D02`. Hay 2.412 casilleros; cada uno admite una HU o caja, no un número abstracto de unidades. Las unidades se guardan en la posición/quant. El lote interno `L-004582` identifica un lote de fabricante de forma correlativa y permanece estable aunque cambie de HU o LOC. Las direcciones legadas inactivas permanecen solo para el kardex histórico.

El mapa usa el plano CD1 de 184 × 132 m: recepción al sur, reserva/picking en el cuerpo principal y staging/expedición al norte; las cámaras frías están cerradas y señalizadas. Puede seleccionar una caja de un nivel concreto y consultar su SKU, lote, HU y cantidad. Es un **plano operativo diseñado**, no un levantamiento topográfico ni un plano de evacuación; X/Z solo se consideran medidas cuando `layout_verificado=1`.

## Referencias primarias

- [SAP, Warehouse Structure](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/34c8cb53ad377114e10000000a174cb4.html?locale=en-US): almacén → tipo/sección → bin; el bin es la dirección exacta del stock.
- [SAP, Storage Bin](https://help.sap.com/saphelp_snc70/helpdata/EN/1f/da4541c47a6e24e10000000a155106/content.htm?no_cache=true): ejemplo de coordenadas pasillo, módulo y nivel.
- [SAP, Goods Receipt Posting](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/81fc2f0699e14940918a410a336257af/67c8cb53ad377114e10000000a174cb4.html): admite recepción parcial y conserva cada contabilización en el flujo documental.
- [Oracle WMS, Outbound Orders](https://docs.oracle.com/en/cloud/saas/warehouse-management/26a/owmol/allow-expired-inventory-flag.html): pedidos para tiendas, picking, packing y envío.
- [Oracle WMS, Replenishment](https://docs.oracle.com/en/cloud/saas/warehouse-management/26a/owmol/overview-of-replenishment.html): reserva → ubicación activa, incluso a partir de necesidad de pedidos.
