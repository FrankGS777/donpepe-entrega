# Mapa interactivo del CD1

El mapa `/wms/mapa` consulta `/wms/mapa/datos` sin caché. Su geometría proviene de `config/warehouseBlueprint.js`; sus ID, niveles, stock, HU y tareas provienen de las tablas y vistas operativas. No hay cajas ficticias para poblar el escenario: una caja visible corresponde a una posición positiva de inventario.

## Uso

1. Elige una zona. El plano vuela hacia el área y muestra temperatura, pasillos, racks y casilleros.
2. Elige un pasillo; después un rack. La lista accesible se reduce a las LOC coincidentes (máximo 60 visibles a la vez). Selecciona nivel/casillero/profundidad desde una placa, caja o la lista.
3. El inspector muestra dirección completa, HU ocupadas, unidades dentro de la posición, SKU, lote interno `L-...`, lote del fabricante, estado y tareas abiertas. El enlace abre la trazabilidad de inventario para esa misma LOC.
4. Alterna **Planta isométrica** y **Pasillo**. Arrastra para trasladar/girar y usa rueda o pinza para acercarte. El color de la placa señala libre, ocupado, bloqueado o tarea en ejecución.

El mapa dibuja recepción al sur, reserva ABC en el centro, preparación a un lado y salida al norte. Las cámaras y cuarentenas tienen muros y puertas; el suelo marca corredores y muelles. Los racks incluyen perforaciones, anclajes y conectores; los palés, bloques y patines; las cajas, bordes suavizados, cinta, fibras y etiquetas. Muelles numerados, portones abiertos y defensas hacen reconocibles los accesos.

Materiales procedurales PBR de 1024 px, normales y rugosidad, anisotropía hasta 16, reflejos PMREM, sombras suaves 4096 y DPR hasta 2. La calidad consume más GPU que la versión previa, pero las 2.412 placas y estructuras siguen instanciadas; se dibuja ante cambios y se pausa fuera de pantalla. Las sombras no se recalculan en cada cuadro de zoom. La cámara ajusta el encuadre isométrico al edificio completo. Referencias técnicas: [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) y [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html).

Este es un **plano operativo planificado**; sus coordenadas no son un levantamiento del local. `layout_verificado=1` se reserva para medidas reales y no se asigna por defecto. No usar para seguridad, tránsito de montacargas, evacuación o selección automática de rutas físicas antes de un levantamiento aprobado.

Fuente de la jerarquía conceptual: [SAP EWM, Warehouse Structure](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/9832125c23154a179bfa1784cdc9577a/34c8cb53ad377114e10000000a174cb4.html?locale=en-US) y [Oracle WMS, Locations](https://docs.oracle.com/en/cloud/saas/warehouse-management/25d/owmim/locations.html).
