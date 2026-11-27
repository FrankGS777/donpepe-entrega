# Roles y secuencia operativa de Don Pepe WMS

Esta matriz describe las tres plantillas protegidas del servidor (`config/permissions.js`). Los roles personalizados tienen permisos persistidos y se describen en [RBAC](RBAC.md). Ocultar un enlace en la interfaz no concede ni revoca acceso: cada ruta y servicio también comprueban los permisos vigentes.

| Recurso | Administrador WMS | Jefe de operaciones | Operador RF |
| --- | --- | --- | --- |
| Usuarios y recuperaciones | Alta, edición y decisiones | Sin acceso | Sin acceso |
| Maestros, proveedores, zonas y LOC | CRUD y gobierno | Sin edición de maestros | Sin acceso administrativo |
| SKU | Alta, edición integral y desactivación | Lectura y estrategia logística únicamente | Lectura contextual en RF |
| Órdenes de compra | Crear, consultar y cancelar; no recibir físicamente | Sin acceso al panel ni a sus rutas | Recibir contra una OC existente solo desde RF |
| Pedidos de sucursales | Consultar; gestionar destinos | Registrar, planificar, asignar picking y despachar | Ejecutar picking RF asignado; sin crear ni confirmar despacho |
| Tareas WMS | Consultar seguimiento y trazabilidad | Planificar, asignar y cancelar | Ejecutar únicamente tareas asignadas y confirmar escaneos |
| Conteos | Aprobar/rechazar los de otra persona; no registrar conteos | Registrar y consultar; no aprobar ajustes | Registrar conteo RF; no aprobar |
| Reportes financieros y CSV | Acceso | Sin acceso | Sin acceso |

## Secuencia física

1. El administrador crea una orden con SKU homologados del proveedor. El operador registra las cantidades efectivamente llegadas de cada SKU contra esa orden en una LOC de recepción térmicamente compatible. Una entrega incompleta deja la OC `PARCIAL`; el faltante permanece visible y se puede recibir después, sin fabricar stock por líneas no entregadas. La recepción se confirma de forma transaccional.
2. Al confirmar la recepción, se registra el lote y se genera una tarea de `PUTAWAY` desde recepción hacia una LOC compatible, con capacidad y condición térmica adecuadas. El jefe asigna esta tarea; el operador escanea origen, lote/SKU y destino en RF.
3. Después del put-away, el stock está en reserva o picking. El jefe puede planificar reabastecimiento de la cara primaria cuando haya déficit, o reubicar stock disponible entre LOC compatibles. El picking de salida nace exclusivamente de un pedido de sucursal y asigna lote FEFO, destino staging y tarea RF vinculada.
4. Las devoluciones de sucursal se aceptan solo contra un pedido despachado y hasta la cantidad efectivamente enviada por lote/tarea. Ingresan a recepción en estado `CUARENTENA` y generan tarea RF hacia una LOC de aislamiento de igual condición térmica; una reubicación ordinaria no puede liberarlas.
5. Cada movimiento confirmado actualiza lotes y kardex. Los conteos con diferencia quedan pendientes de aprobación por el administrador, que debe ser una persona diferente al creador del conteo.

## Límites explícitos

La aplicación no contiene ventas al público, inventario de cada sucursal ni integración con un sistema de transporte. `PICKING` nuevo exige un pedido interno de sucursal existente; el número de guía y la placa se registran como trazabilidad operativa, no como documento fiscal emitido. El operador registra conteos en `/rf/count` y no accede a los formularios de escritorio. El mapa 3D representa bin y ocupación reales; X/Z es esquemático donde no existe medición física.

Secuencia de ubicación fundamentada en [SAP Help: Putaway Strategies](https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/25a41481f62e469ba0e61015a0d39d20/22e7bf532e64b44ce10000000a174cb4.html): origen en recepción intermedia, búsqueda de tipo de almacenamiento y finalmente de bin/LOC compatible. Don Pepe aplica una versión acotada para minimarket, no afirma replicar SAP EWM completo.
