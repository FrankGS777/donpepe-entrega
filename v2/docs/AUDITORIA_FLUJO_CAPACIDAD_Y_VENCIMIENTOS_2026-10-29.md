# Capacidad, selección del mapa y vencimientos

## Hallazgos y cambios

La capacidad original era de 92 posiciones: 48 secas, 36 refrigeradas, seis congeladas y dos para limpieza. El catálogo ampliado no implicaba disponer de posiciones suficientes para recibir todos sus productos, y el mapa no debía inventar huecos al aceptar una recepción.

Se añadieron cuatro pasillos a cada una de las cuatro zonas de almacenamiento. Recepción, preparación y expedición conservan sus superficies y accesos; no son zonas de reserva a las que añadir estanterías indiscriminadamente.

| Zona | Antes | Ahora | Infraestructura de la ampliación |
| --- | ---: | ---: | --- |
| Seca | 48 | 240 | Cuatro pasillos con transelevador dedicado, dos frentes de racks por pasillo |
| Refrigerada | 36 | 180 | Cuatro pasillos con transelevador dedicado y transferencias en cámara |
| Congelada | 6 | 14 | Cuatro pasillos de posiciones en piso, atendidos por transferencia fija |
| Limpieza | 2 | 14 | Cuatro pasillos en ala posterior separada de alimentos |
| **Total** | **92** | **448** | **16 pasillos nuevos y ocho transelevadores registrados** |

Una posición aloja una unidad de carga, cuya cantidad de cajas depende del producto. No equivale a una sola caja ni a un número fijo de unidades de venta.

La nave se extiende por detrás: piso, cubierta, paneles, cerramientos de cámaras, raíles, señalización, soporte de palés y perímetro siguen las nuevas dimensiones. La cámara exterior ajusta el encuadre. Los códigos y coordenadas de las posiciones anteriores permanecen intactos; no se traslada stock para que encaje en el dibujo.

Los cruces nuevos tienen nodos compartidos de circulación. Los segmentos superpuestos se dividen en tramos únicos. Una migración amplía las reservas de una ruta antigua a sus nuevos cruces, conservando la misión, la posición de la máquina y la custodia de la carga.

## Selección en profundidad

Actualización posterior del 29 de octubre: el selector emergente descrito abajo fue retirado por petición del usuario. La versión vigente usa cámara frontal sin ocultación de obstáculos; véase `INSPECCION_FRONTAL_Y_REFORMA_FOTORREALISTA_2026-10-29.md`. El párrafo siguiente conserva el registro de la primera intervención.

Un clic puede atravesar varias caras de cajas y volúmenes de rack. Se agrupan los impactos por entidad, evitando repetir un palé por cada caja dibujada. Cuando existen varias opciones, se abre un selector visual con imágenes, producto, lote, cantidad y ubicación; incluye las cargas alojadas en los racks implicados. La búsqueda filtra al escribir.

Cada rack añade «Ver cargas de este rack». Al seleccionar un palé, la cámara se coloca frente al pasillo que le corresponde, incluido el nuevo raíl de su pasillo. Las zonas interiores ampliadas no se confunden con el patio exterior. Estos cambios afectan la inspección: no alteran las colisiones ni autorizan movimientos de inventario.

## Política de vencimientos

Se aplica la fecha comercial de Lima. Un lote con vencimiento igual a la fecha del día se considera vigente durante ese día; queda vencido al cambiar la fecha local. Es una política explícita del escenario para etiquetas con fecha y sin hora.

1. FEFO reserva primero el lote vigente que vence antes. La vida útil mínima configurada sigue excluyendo lotes insuficientes para nuevas reservas y despachos.
2. Se muestran avisos de vencimiento a siete días. Un aviso no implica destruir mercancía vigente.
3. Al vencer, el lote queda excluido de nuevas reservas, ventas y expediciones. La detección genera un expediente de retiro con producto, lote, cantidad y hora.
4. Si todas las reservas del pedido están intactas y ninguna horquilla ha empezado a cargar, se cancela el pedido afectado y se liberan sus reservas, con motivo automático. No se crea una solicitud ficticia a nombre de la tienda.
5. Una carga ya recogida completa una transferencia segura. No se cancela una máquina cargada, no se cambia su posición ni se borra su palé.
6. Un pedido preparado vencido se retiene y vuelve físicamente a cuarentena. Una carga inmovilizada en camión utiliza la descarga de rechazo existente cuando el montacargas queda libre.
7. Desde una ubicación en rack, el transelevador extrae la carga hasta la transferencia y el AMR completa el traslado. El mecanismo de congelados conserva su recorrido específico. Las rutas tienen prioridad alta pero respetan capacidad y reservas.
8. La cuarentena conserva compartimentos ambiente, refrigerado y congelado. Limpieza tiene una retención separada en su ala, para evitar mezclar productos químicos y alimentos.
9. Si la cuarentena está llena, el retiro espera; la mercancía sigue bloqueada, identificada y contabilizada. Tampoco se vacía un robot que aún transporta una carga.
10. En tienda, las cajas vencidas se apartan del saldo vendible por su lote exacto y se crea una devolución automática cuando hay capacidad segregada reservable. La flota registrada las recoge cuando dispone de un vehículo. Las cantidades pasan a devoluciones; no se pierden ni se duplican.
11. En cuarentena, Operaciones confirma la baja con una sola confirmación y un motivo prellenado, editable. El sistema impide la baja de una carga en movimiento. Registra responsable, cantidad, lote y movimiento de salida; los reintentos no repiten el descuento.

Administración mantiene configuración y registro de activos. Operaciones controla las excepciones y confirma bajas. La tienda no recibe expedientes internos ni existencias de otra sucursal.

## Qué queda como límite del escenario

- La baja documenta una salida del inventario. No representa una certificación de destrucción ni un justificante emitido por un gestor externo de residuos. Una integración real necesitaría conservar ese documento, su receptor y la evidencia de retirada.
- El circuito inverso de tienda utiliza el transporte de devoluciones existente. Su detalle visual de carga y descarga aún es más resumido que el despacho principal; no se afirma que tenga una nueva estación robotizada de residuos.
- El control utiliza las fechas de los lotes registradas. No puede deducir una caducidad de un código comercial que sólo identifica el producto ni demostrar lecturas de equipos físicos conectados.
- El bloqueo por fecha no sustituye el control de calidad, la cadena de frío o un retiro de fabricante por lote. Esas excepciones conservan sus mecanismos específicos.

## Comprobación

- Batería principal: 368 pruebas aprobadas. Después del ajuste de segregación y privacidad, 49 pruebas específicas de vencimientos, ampliación, seguridad y selección aprobadas, con pruebas adicionales de los cruces del grafo.
- Navegador: ampliación interior/exterior, selector por imagen y código, clic sobre geometría, baja confirmada y vistas móviles/claro/oscuro; sin errores JavaScript detectados.
- Una copia privada de los datos existentes se migró y avanzó 30 segundos: conservó las 62 cargas, 24 saldos de tienda y 23 pedidos, las posiciones de las máquinas y el balance. Las 92 ubicaciones anteriores se mantuvieron y se añadieron las nuevas hasta 448.
- Se guardó respaldo íntegro de ambas bases antes de activar la migración. Las verificaciones no crean pedidos, ventas o correos en los datos del usuario.

## Fundamento consultado

- [Mecalux: Sud-Fresh, trazabilidad alimentaria y FEFO](https://www.mecalux.es/clientes/sud-fresh-trazabilidad-alimentos): gestión por lote y criterio de extracción según vencimiento.
- [Microsoft: órdenes de cuarentena](https://learn.microsoft.com/en-us/dynamics365/supply-chain/inventory/quarantine-orders): distinción entre bloquear, trasladar a cuarentena y contabilizar una baja. Sus restricciones particulares de Dynamics no se presentan como requisitos de DonPepe.
- [Microsoft: planificación de productos con vida útil limitada](https://learn.microsoft.com/en-us/dynamics365/supply-chain/master-planning/planning-optimization/shelf-life): planificación según vigencia, controles de calidad y restricción de expedir productos vencidos.

La solución es una adaptación al flujo y al modelo de datos de DonPepe; no copia una instalación industrial ni presume una integración física.
