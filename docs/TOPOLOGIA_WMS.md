# Plano operativo CD1 y modelo WMS

## Alcance del modelo

Don Pepe opera un centro de distribución separado de sus sucursales. Se adaptó la jerarquía pública de SAP EWM y Oracle WMS: **almacén → zona de trabajo/almacenamiento → pasillo → rack → nivel → casillero → profundidad (bin/LOC)**. El bin es una dirección física; el inventario es otra entidad. No se copió software, configuración propietaria ni una instalación real de SAP u Oracle.

| Entidad | Regla de identidad |
| --- | --- |
| SKU | Producto comercial; proveedor, temperatura, control de vencimiento y política ABC. |
| Lote de fabricante (`lotes_fabricante`) | Único por SKU y código impreso. Código interno correlativo `L-000001`, derivado de su ID. La fecha verificada permanece con este lote durante todos los movimientos. |
| HU (`unidades_logisticas`) | Caja, palé, pedido o retorno con etiqueta propia; se puede dividir o reagrupar sin cambiar el lote fabricante. |
| Posición/quant (`lotes`) | Cantidad del SKU + lote de fabricante + HU + estado de calidad en una LOC. El nombre SQL histórico se conserva para mantener las claves y kardex. |
| LOC (`ubicaciones_almacen`) | Casillero direccionable con perfil, zona térmica y **una plaza de HU**. Puede estar vacío. `capacidad_hu=1`; `cantidad_actual` no se usa como capacidad del casillero. |
| Tarea | Movimiento planificado y confirmado con origen, destino, cantidad, asignación y escaneo RF. Una tarea pendiente reserva un casillero destino. |

La dirección se genera como `CD1-ZONA-Axx-Rxx-Nxx-Cxx-Dxx`. Por ejemplo, `CD1-SEC-B-A02-R04-N03-C02-D02` significa centro CD1, reserva seca B, pasillo 2, rack 4, nivel 3, casillero 2 y fondo 2. `D02` es la segunda profundidad del mismo módulo, **no** una segunda HU en el mismo bin. La clave física única comprende modelo, zona, pasillo, rack, nivel, casillero y profundidad. Estas claves son inmutables por la interfaz; una ampliación de nave exige versionar el plano y migrar las referencias.

## Distribución planificada

El modelo geométrico es una propuesta operativa de **184 × 132 m**, no un plano CAD levantado en una instalación existente. Las bahías de entrada están al sur (z=0), las salidas de despacho al norte (z=132), y corredores principales unen ambas. Las cámaras y cuarentenas frías tienen muros, puerta controlada y equipamiento de refrigeración en el mapa. Los muelles son posiciones de piso; reserva y picking usan racks multinivel. Un proyecto real requiere medición, límites de carga, protección contra incendios, rutas peatonales y aprobación de seguridad antes de mover mercancía con este plano.

| Área | Función y temperatura | Pasillos × racks × niveles × casilleros × fondo | LOC |
| --- | --- | ---: | ---: |
| REC | Recepción seca, piso de muelle | 2 × 6 × 1 × 2 × 1 | 24 |
| REC-F / REC-C | Recepción refrigerada / congelada | cada una 1 × 4 × 1 × 2 × 1 | 8 + 8 |
| QUA | Cuarentena seca | 1 × 6 × 2 × 2 × 1 | 24 |
| QUA-F / QUA-C | Cuarentena en cámara fría / congelada | cada una 1 × 3 × 2 × 2 × 1 | 12 + 12 |
| SEC-C | Reserva seca de baja rotación | 4 × 8 × 4 × 2 × 2 | 512 |
| SEC-B | Reserva seca de rotación media | 6 × 10 × 4 × 2 × 2 | 960 |
| SEC-A | Reserva seca de alta rotación | 5 × 8 × 4 × 2 × 1 | 320 |
| VEN | Picking seco / preparación de sucursales | 4 × 8 × 3 × 3 × 1 | 288 |
| FRI | Reserva y picking refrigerado | 3 × 6 × 3 × 2 × 1 | 108 |
| CON | Reserva y picking congelado | 2 × 6 × 3 × 2 × 1 | 72 |
| DSP | Staging ambiente / salida | 3 × 8 × 1 × 2 × 1 | 48 |
| DSP-F / DSP-C | Staging refrigerado / congelado | cada una 1 × 4 × 1 × 2 × 1 | 8 + 8 |
| **Total** | **15 áreas** | | **2.412** |

La clase ABC es una política logística configurada en el SKU; no se presenta como resultado calculado de ventas históricas inexistentes. Los bienes con frío no entran a reserva seca; las salidas se separan por temperatura. No se modela una zona de materiales peligrosos ni una de alto valor sin necesidad demostrada de ese rubro.

## Secuencia operacional

1. **Abastecimiento:** solo el administrador emite una OC a proveedor activo, limitada a los SKU asociados a este. La OC puede quedar parcial.
2. **Recepción RF:** el operador verifica orden, SKU/EAN, cantidad, lote de fabricante y fecha impresa; selecciona un casillero libre de `REC`, `REC-F` o `REC-C` compatible. El sistema registra la posición y propone put-away. No deduce vencimientos a partir de categorías.
3. **Put-away:** el jefe libera/asigna la tarea; el operador escanea origen, producto/lote y destino. Primero se considera una cara de picking libre y propia del SKU si el objetivo lo requiere; de otro modo una plaza de reserva compatible, con clase ABC y temperatura. No se puede sugerir cuarentena o despacho como almacenaje normal.
4. **Reserva y reposición:** se mantiene la misma identidad de lote al dividir una HU. El objetivo de picking se calcula en **todas** las caras activas del SKU. Una cara primaria es exclusiva; las caras dinámicas libres permiten lotes adicionales sin mezclar dos HU en un casillero.
5. **Pedido de sucursal:** el jefe planifica contra inventario disponible de picking por FEFO y descuenta reservas de tareas abiertas. Cada línea recibe staging libre de la misma temperatura. Si falta stock en picking, no se planifica parcialmente: se reabastece y se reintenta.
6. **Despacho:** tras completar todas las tareas, se confirma guía operativa y vehículo; el stock sale del CD con movimiento de kardex. La sucursal es destino externo, no una LOC de este almacén.
7. **Retorno:** solo contra lo realmente expedido; llega a recepción compatible, queda bloqueado y se traslada a cuarentena. No vuelve a disponible sin revisión/aprobación.
8. **Conteo:** se cuenta SKU + lote + LOC; las diferencias requieren la aprobación de otra persona autorizada antes del ajuste. La posición y la HU conservan trazabilidad.

## Migración y mapa

La migración añade geometría y columnas de profundidad/capacidad HU, genera los 2.412 bins, asigna posiciones positivas y tareas abiertas a direcciones nuevas, conserva las claves de lote y los movimientos anteriores, y desactiva bins legados vacíos. No ejecuta borrados en cascada sobre datos operativos. Es repetible; el arranque de Docker la vuelve a comprobar. Para datos importantes, crear un respaldo antes de actualizar.

El localizador navega por zona → pasillo → rack → nivel y después muestra casillero y profundidad. El mapa lee las mismas LOC y quants de la base: las cajas ocupadas son clicables y abren SKU, lote interno/fabricante, HU, unidades, estado y tareas. Los racks y marcas del piso usan geometría procedural ligera e instancias GPU para los 2.412 bins. Las rutas dibujadas representan relaciones de tarea, **no trayectorias seguras medidas**. El mapa no sustituye inspección física ni un plano de evacuación.

## Fuentes primarias usadas como referencia conceptual

- [SAP EWM, Warehouse Structure](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/34c8cb53ad377114e10000000a174cb4.html?locale=en-US)
- [SAP EWM, Storage Bin](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/7a6fc3d598d140b0988065937035fff6/55c8cb53ad377114e10000000a174cb4.html?version=7.0.3)
- [SAP EWM, Quant](https://help.sap.com/docs/SAP_EXTENDED_WAREHOUSE_MANAGEMENT/3d97bec9bf1649099384bb8167df3cf2/4bc49585921f4c88e10000000a42189e.html)
- [SAP EWM, Creation of Warehouse Tasks for Putaway](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/7a6fc3d598d140b0988065937035fff6/ffc7cb53ad377114e10000000a174cb4.html)
- [SAP EWM, Storage Bin Determination for Putaway](https://help.sap.com/docs/SAP_SUPPLY_CHAIN_MANAGEMENT/57574d15fa1d414792d74047b66c3e41/4acdcb53ad377114e10000000a174cb4.html)
- [Oracle WMS, Locations](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmim/locations.html)
- [Oracle WMS, Replenishment](https://docs.oracle.com/en/cloud/saas/warehouse-management/26a/owmol/overview-of-replenishment.html)
