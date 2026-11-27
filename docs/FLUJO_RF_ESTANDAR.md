# Flujo RF estándar — Don Pepe WMS

## Perfil operativo

Don Pepe implementa un WMS de minimarket sin funciones comerciales. La unidad ejecutable es la **tarea de almacén**: una instrucción dirigida que indica SKU/lote, cantidad, LOC origen y LOC destino. Para este tamaño de operación, cada tarea funciona como un paquete de trabajo RF de una sola actividad; una evolución futura podría agrupar varias tareas en olas u órdenes de almacén.

## Flujo físico controlado

1. **Receiving / Recepción:** el operador identifica una orden de compra pendiente, escanea el producto o lote, registra la cantidad recibida y confirma discrepancias. El sistema crea stock en la LOC de recepción y genera el put-away.
2. **Put-away / Ubicación:** la estrategia propone un casillero libre de picking si el objetivo del SKU lo requiere, o de reserva compatible con temperatura y clase ABC. La ejecución exige escanear origen, SKU/EAN/lote interno o HU, y destino.
3. **Storage / Almacenamiento:** el inventario permanece trazado por SKU, lote, estado y LOC. Las reubicaciones conservan doble asiento de kardex.
4. **Replenishment / Reabastecimiento:** se mueve stock desde reserva hacia un casillero libre de picking compatible; la cara primaria identifica al SKU propietario, pero pueden usarse caras dinámicas sin mezclar HU. El objetivo se calcula sobre todas las caras del SKU y descuenta tareas ya planificadas. La confirmación vuelve a validar el déficit y la capacidad para evitar carreras concurrentes.
5. **Pick order / Preparación:** un pedido interno de sucursal genera tareas FEFO desde LOC de picking hacia staging térmicamente compatible. RF confirma físicamente; no representa una venta ni expone precios.
6. **Count / Conteo:** el operador escanea LOC y SKU/EAN en una pantalla RF móvil; una diferencia genera auditoría y requiere aprobación antes del ajuste.
7. **Route returns / Retorno:** el jefe registra la llegada física contra una expedición ya despachada y el sistema impide superar su cantidad. El operador traslada la unidad retornada de recepción a cuarentena mediante RF, sin mezclarla con stock disponible.

## Confirmación RF a prueba de errores

Una tarea tomada cambia de `PENDIENTE` a `EN_PROCESO` y registra usuario y hora. El operador no puede completarla con un clic: debe confirmar, en este orden:

- etiqueta de la LOC origen;
- SKU, código de barras o número de lote esperado;
- etiqueta de la LOC destino.

Solo después de las tres coincidencias se actualizan el lote origen, el lote destino, el kardex y el estado `COMPLETADA` dentro de una única transacción. El jefe de operaciones planifica, asigna o cancela tareas; la confirmación física corresponde al operador RF. El administrador conserva la intervención supervisada desde escritorio para contingencias, registrada como tal en el motivo del movimiento.

## Cámara y códigos

El lector usa `BarcodeDetector` cuando el navegador lo ofrece y ZXing local como alternativa para Safari. La lista se obtiene mediante `enumerateDevices()` después de conceder permiso y conserva el `deviceId` elegido. En Mac, una Cámara de Continuidad disponible aparece en la misma lista como iPhone.

La cámara web requiere `HTTPS` o `localhost`. Para abrir el WMS directamente desde un teléfono mediante una IP de red, debe publicarse con HTTPS.

## Referencias oficiales consultadas

- SAP, [Warehouse Task](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/25cf88dfa94c49e4a440f3f1d752b8a1/d3de8b56-9dcf-48a6-9821-8d43b8917fb6.html).
- SAP, [Warehouse Order](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/25cf88dfa94c49e4a440f3f1d752b8a1/65cccb53ad377114e10000000a174cb4.html).
- SAP, [Extended Warehouse Management](https://help.sap.com/docs/PRODUCT_ID/3d97bec9bf1649099384bb8167df3cf2/4ecb88b8b2422afee10000000a42189e.html).
- SAP, [Manual Confirmation of Warehouse Tasks](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/25cf88dfa94c49e4a440f3f1d752b8a1/fdf6ba4109584a96944fbdb849cbb41c.html).
- Apple, [Use your iPhone as a webcam on Mac](https://support.apple.com/en-au/guide/mac-help/mchl77879b8a/mac).
- MDN, [MediaDevices: enumerateDevices()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices).
- MDN, [MediaDevices: getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia).
